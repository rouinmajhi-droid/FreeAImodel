import React, { useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { ref, get, set, update, remove, onValue } from 'firebase/database';
import {
  auth,
  rtdb,
  isUserAdmin,
  toRtdbKey,
  sanitizeForRtdb,
  testRtdbConnection
} from './lib/firebase';
import { ApiKey, ProviderKey, GatewayModel, RequestLog, UserProfile } from './types/gateway';
import { ToastProvider, useToast } from './components/Toast';
import { Sidebar, NavTab } from './components/Sidebar';
import { TopHeader } from './components/TopHeader';
import { OverviewView } from './components/OverviewView';
import { ApiKeysSection } from './components/ApiKeysSection';
import { Playground } from './components/Playground';
import { ModelsView } from './components/ModelsView';
import { StandaloneAdminDashboard } from './components/StandaloneAdminDashboard';
import { SettingsView } from './components/SettingsView';
import { LoginModal } from './components/LoginModal';
import { LandingPage } from './components/LandingPage';
import { parseJsonSafe } from './lib/http';

function rtdbMapToList<T>(val: unknown): T[] {
  if (!val || typeof val !== 'object') return [];
  if (Array.isArray(val)) return val.filter(Boolean) as T[];
  return Object.entries(val as Record<string, any>)
    .filter(([, item]) => item && typeof item === 'object')
    .map(([key, item]) => ({ ...item, id: item.id || key })) as T[];
}

function GatewayApp() {
  const { showToast } = useToast();

  // Auth & Profile
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Layout & Navigation Tab
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [isLoginRoute, setIsLoginRoute] = useState<boolean>(false);

  // Gateway Keys & State (100% live from Firebase RTDB + Node.js Gateway)
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [providerKeys, setProviderKeys] = useState<ProviderKey[]>([]);
  const [models, setModels] = useState<GatewayModel[]>([]);
  const [requestLogs, setRequestLogs] = useState<RequestLog[]>([]);
  const [publicStats, setPublicStats] = useState<{
    totalRequests: number;
    avgLatencyMs: number;
    activeKeys: number;
  }>({ totalRequests: 0, avgLatencyMs: 0, activeKeys: 0 });
  const [selectedKeyForPlayground, setSelectedKeyForPlayground] = useState<string>('');

  // Active user details
  const activeEmail = currentUser?.email || undefined;
  const activeUid = currentUser?.uid || '';
  const isAdmin = isUserAdmin(activeEmail, userProfile?.role);
  const isAuthenticated = Boolean(currentUser);

  // Sync with URL routing
  useEffect(() => {
    const checkPath = () => {
      const path = window.location.pathname.toLowerCase();
      const hash = window.location.hash.toLowerCase();

      if (path === '/login' || hash === '#login') {
        setIsLoginRoute(true);
      } else {
        setIsLoginRoute(false);
      }

      if (path === '/admin' || hash === '#admin') setActiveTab('admin');
      else if (path.includes('/keys') || hash === '#keys') setActiveTab('keys');
      else if (path.includes('/playground') || hash === '#playground') setActiveTab('playground');
      else if (path.includes('/models') || hash === '#models') setActiveTab('models');
      else if (path.includes('/settings') || hash === '#settings') setActiveTab('settings');
      else if (path === '/login' || hash === '#login') {
        // preserve current tab
      } else {
        setActiveTab('dashboard');
      }
    };

    checkPath();
    window.addEventListener('popstate', checkPath);
    return () => window.removeEventListener('popstate', checkPath);
  }, []);

  // Hide /admin route for non-admin authenticated users
  useEffect(() => {
    if (!authLoading && isAuthenticated && activeTab === 'admin' && !isAdmin) {
      setActiveTab('dashboard');
      window.history.replaceState(null, '', '/');
    }
  }, [authLoading, isAuthenticated, activeTab, isAdmin]);

  const handleSelectTab = (tab: NavTab) => {
    if (tab === 'admin' && !isAdmin) {
      setActiveTab('dashboard');
      window.history.pushState(null, '', '/');
      return;
    }
    setActiveTab(tab);
    if (tab === 'dashboard') {
      window.history.pushState(null, '', '/');
    } else if (tab === 'keys') {
      window.history.pushState(null, '', '/dashboard/keys');
    } else {
      window.history.pushState(null, '', `/${tab}`);
    }
  };

  // Strict sanitization for Realtime Database ProviderKey entries
  const buildSafeProviderKeyRecord = (pk: ProviderKey): Record<string, any> => {
    const nowIso = new Date().toISOString().slice(0, 64);
    const keyStr = String(pk.key || '').slice(0, 512);
    const hint = (pk.keyHint || (keyStr.length > 8 ? `${keyStr.slice(0, 4)}...${keyStr.slice(-4)}` : keyStr)).slice(0, 32);
    const validStatus = ['active', 'rate_limited', 'exhausted', 'disabled'].includes(pk.status)
      ? pk.status
      : 'active';

    return sanitizeForRtdb({
      id: toRtdbKey(String(pk.id || 'pk_key')).slice(0, 128),
      provider: String(pk.provider || 'custom').slice(0, 64),
      key: keyStr,
      keyHint: hint || undefined,
      customBaseUrl: pk.customBaseUrl ? String(pk.customBaseUrl).slice(0, 512) : undefined,
      supportedModels: Array.isArray(pk.supportedModels)
        ? pk.supportedModels.map(String).slice(0, 1000)
        : [],
      status: validStatus,
      requestCount: typeof pk.requestCount === 'number' && pk.requestCount >= 0 ? pk.requestCount : 0,
      errorCount: typeof pk.errorCount === 'number' && pk.errorCount >= 0 ? pk.errorCount : 0,
      lastError: pk.lastError ? String(pk.lastError).slice(0, 500) : undefined,
      cooldownUntil: typeof pk.cooldownUntil === 'number' ? pk.cooldownUntil : undefined,
      lastUsedAt: pk.lastUsedAt ? String(pk.lastUsedAt).slice(0, 64) : undefined,
      createdAt: String(pk.createdAt || nowIso).slice(0, 64),
      updatedAt: String(pk.updatedAt || nowIso).slice(0, 64)
    });
  };

  const buildSafeModelRecord = (m: GatewayModel): Record<string, any> => {
    const nowIso = new Date().toISOString().slice(0, 64);
    return sanitizeForRtdb({
      id: String(m.id).slice(0, 128),
      name: String(m.name || m.id).slice(0, 128),
      provider: String(m.provider || 'custom').slice(0, 64),
      ownerKeyId: m.ownerKeyId ? String(m.ownerKeyId).slice(0, 128) : undefined,
      ownerKeyHint: m.ownerKeyHint ? String(m.ownerKeyHint).slice(0, 64) : undefined,
      contextWindow: typeof m.contextWindow === 'number' ? m.contextWindow : undefined,
      pricingPrompt: typeof m.pricingPrompt === 'number' ? m.pricingPrompt : undefined,
      pricingCompletion: typeof m.pricingCompletion === 'number' ? m.pricingCompletion : undefined,
      activeKeysCount: typeof m.activeKeysCount === 'number' ? m.activeKeysCount : undefined,
      isActive: true,
      discoveredAt: String(m.discoveredAt || nowIso).slice(0, 64),
      updatedAt: nowIso,
      description: m.description ? String(m.description).slice(0, 512) : undefined
    });
  };

  const getFirebaseIdToken = useCallback(async (): Promise<string | undefined> => {
    try {
      if (auth.currentUser) {
        return await auth.currentUser.getIdToken();
      }
    } catch {
      // ignore
    }
    return undefined;
  }, []);

  // Sync live RTDB state with Node.js gateway router memory
  const syncWithBackend = useCallback(async (
    currentApiKeys: ApiKey[],
    currentProviderKeys: ProviderKey[],
    currentModels?: GatewayModel[],
    replaceProviderKeys = false
  ) => {
    try {
      const fbToken = await getFirebaseIdToken();
      await fetch('/api/gateway/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(fbToken ? { 'x-firebase-token': fbToken } : {})
        },
        body: JSON.stringify({
          apiKeys: currentApiKeys,
          providerKeys: currentProviderKeys,
          models: currentModels,
          replaceProviderKeys
        })
      });
    } catch {
      // background sync
    }
  }, [getFirebaseIdToken]);

  const syncModelsToRtdb = useCallback(async (modelsList: GatewayModel[]) => {
    if (!currentUser || !isAdmin) return;
    try {
      const modelMap: Record<string, any> = {};
      for (const m of modelsList) {
        if (!m?.id) continue;
        modelMap[toRtdbKey(m.id)] = buildSafeModelRecord(m);
      }
      await set(ref(rtdb, 'models'), Object.keys(modelMap).length > 0 ? modelMap : null);
    } catch (err) {
      console.warn('RTDB models sync error:', err);
    }
  }, [currentUser, isAdmin]);

  // Firebase Auth State Listener — checks Rouinmajhi@gmail.com for Admin role & runs daily 50B credits reset in RTDB
  useEffect(() => {
    const DAILY_CREDITS = 50_000_000_000;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        const isAdm = isUserAdmin(user.email);
        const expectedRole: 'admin' | 'user' = isAdm ? 'admin' : 'user';
        const today = new Date().toISOString().slice(0, 10);
        const nowIso = new Date().toISOString();

        fetch('/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uid: user.uid,
            email: user.email || '',
            displayName: user.displayName || 'Developer'
          })
        }).catch(() => {});

        try {
          const profileRef = ref(rtdb, `user_profiles/${toRtdbKey(user.uid)}`);
          const snap = await get(profileRef);

          if (snap.exists()) {
            const existing = snap.val() as UserProfile;
            const needsDailyReset =
              !existing.updatedAt ||
              existing.updatedAt.slice(0, 10) !== today ||
              (existing.freeCreditsAllocated || 0) < DAILY_CREDITS;
            const needsRoleUpdate = existing.role !== expectedRole;

            const updatedProfile: UserProfile = {
              ...existing,
              uid: user.uid,
              email: user.email || existing.email,
              displayName: user.displayName || existing.displayName || 'Developer',
              photoURL: user.photoURL || existing.photoURL,
              role: expectedRole,
              freeCreditsAllocated: DAILY_CREDITS,
              freeCreditsSpent: needsDailyReset ? 0 : (existing.freeCreditsSpent || 0),
              updatedAt: nowIso
            };

            if (needsDailyReset || needsRoleUpdate) {
              await set(profileRef, sanitizeForRtdb(updatedProfile)).catch(() => {});
            }
            setUserProfile(updatedProfile);
          } else {
            const initialProfile: UserProfile = {
              uid: user.uid,
              email: user.email || '',
              displayName: user.displayName || 'Developer',
              photoURL: user.photoURL || undefined,
              role: expectedRole,
              freeCreditsAllocated: DAILY_CREDITS,
              freeCreditsSpent: 0,
              totalRequests: 0,
              totalTokens: 0,
              createdAt: nowIso,
              updatedAt: nowIso
            };
            await set(profileRef, sanitizeForRtdb(initialProfile)).catch(() => {});
            setUserProfile(initialProfile);
          }
        } catch {
          setUserProfile({
            uid: user.uid,
            email: user.email || '',
            displayName: user.displayName || 'Developer',
            role: expectedRole,
            freeCreditsAllocated: DAILY_CREDITS,
            freeCreditsSpent: 0,
            totalRequests: 0,
            totalTokens: 0,
            createdAt: nowIso,
            updatedAt: nowIso
          });
        }
      } else {
        setUserProfile(null);
      }
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Initialize data directly from Firebase Realtime Database (aisdd-6f89e-default-rtdb) & Node.js server
  useEffect(() => {
    let cancelled = false;

    const initializeData = async () => {
      testRtdbConnection();

      let loadedModels: GatewayModel[] = [];
      let loadedApiKeys: ApiKey[] = [];
      let loadedProviderKeys: ProviderKey[] = [];
      let adminRtdbLoaded = false;

      if (currentUser) {
        // 1. Read user's sk-gateway API keys from RTDB
        try {
          const keysSnap = await get(ref(rtdb, 'api_keys'));
          if (keysSnap.exists()) {
            loadedApiKeys = rtdbMapToList<ApiKey>(keysSnap.val())
              .filter(k => k.userId === currentUser.uid)
              .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
          }
        } catch (err) {
          console.warn('Could not read api_keys from RTDB:', err);
        }

        // 2. Read live models from RTDB
        try {
          const modelsSnap = await get(ref(rtdb, 'models'));
          if (modelsSnap.exists()) {
            loadedModels = rtdbMapToList<GatewayModel>(modelsSnap.val())
              .filter(m => Boolean(m?.id && m?.ownerKeyId))
              .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
          }
        } catch (err) {
          console.warn('Could not read models from RTDB:', err);
        }

        // 3. Read live request logs from RTDB
        try {
          const logsSnap = await get(ref(rtdb, 'request_logs'));
          if (logsSnap.exists()) {
            const allLogs = rtdbMapToList<RequestLog>(logsSnap.val())
              .filter(l => isAdmin || l.userId === currentUser.uid)
              .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
              .slice(0, 200);
            if (!cancelled) setRequestLogs(allLogs);
          }
        } catch {
          // Ignore if no logs yet
        }

        // 4. If Admin, read Master Provider Key Pool from RTDB
        if (isAdmin) {
          try {
            const pkSnap = await get(ref(rtdb, 'provider_keys'));
            if (pkSnap.exists()) {
              const byKey = new Map<string, ProviderKey>();
              for (const pk of rtdbMapToList<ProviderKey>(pkSnap.val())) {
                if (pk?.key) byKey.set(pk.key, pk);
              }
              loadedProviderKeys = Array.from(byKey.values()).sort((a, b) =>
                (b.createdAt || '').localeCompare(a.createdAt || '')
              );
            }
            adminRtdbLoaded = true;
          } catch (err) {
            console.warn('Could not read provider_keys from RTDB:', err);
          }
        }
      } else {
        // Public landing page: fetch live discovered models & stats from Node.js server
        try {
          const [modelsRes, statsRes] = await Promise.all([
            fetch('/api/models'),
            fetch('/api/stats')
          ]);
          if (modelsRes.ok) {
            const data = await parseJsonSafe(modelsRes);
            if (Array.isArray(data.data)) {
              loadedModels = data.data.map((m: any) => ({
                id: m.id,
                name: m.name || m.id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
                provider: m.provider || m.owned_by || 'custom',
                ownerKeyId: m.ownerKeyId,
                ownerKeyHint: m.ownerKeyHint,
                discoveredAt: m.discoveredAt || new Date().toISOString()
              }));
            }
          }
          if (statsRes.ok && !cancelled) {
            const s = await parseJsonSafe(statsRes);
            setPublicStats({
              totalRequests: Number(s.totalRequests || 0),
              avgLatencyMs: Number(s.avgLatencyMs || 0),
              activeKeys: Number(s.activeKeys || 0)
            });
          }
        } catch (e) {
          console.warn('Failed to load public models:', e);
        }
      }

      if (cancelled) return;

      setModels(loadedModels);
      setApiKeys(loadedApiKeys);
      setProviderKeys(loadedProviderKeys);

      if (currentUser) {
        await syncWithBackend(
          loadedApiKeys,
          isAdmin ? loadedProviderKeys : [],
          loadedModels,
          isAdmin && adminRtdbLoaded
        );
      }
    };

    initializeData();
    return () => {
      cancelled = true;
    };
  }, [currentUser, isAdmin, syncWithBackend]);

  // Real-time RTDB listener for /models
  useEffect(() => {
    if (!currentUser) return;
    const unsubscribe = onValue(
      ref(rtdb, 'models'),
      (snapshot) => {
        const liveModels = rtdbMapToList<GatewayModel>(snapshot.val())
          .filter((m) => Boolean(m?.id && m?.ownerKeyId))
          .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
        setModels(liveModels);
      },
      (error) => {
        console.warn('RTDB models listener error:', error);
      }
    );
    return () => unsubscribe();
  }, [currentUser]);

  // Real-time RTDB listener for user's /api_keys
  useEffect(() => {
    if (!currentUser) return;
    const unsubscribe = onValue(
      ref(rtdb, 'api_keys'),
      (snapshot) => {
        const liveApiKeys = rtdbMapToList<ApiKey>(snapshot.val())
          .filter((k) => k.userId === currentUser.uid)
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        setApiKeys(liveApiKeys);
        syncWithBackend(liveApiKeys, [], undefined, false).catch(() => {});
      },
      (error) => {
        console.warn('RTDB api_keys listener error:', error);
      }
    );
    return () => unsubscribe();
  }, [currentUser, syncWithBackend]);

  // Real-time RTDB listener for /request_logs
  useEffect(() => {
    if (!currentUser) return;
    const unsubscribe = onValue(
      ref(rtdb, 'request_logs'),
      (snapshot) => {
        const liveLogs = rtdbMapToList<RequestLog>(snapshot.val())
          .filter((l) => isAdmin || l.userId === currentUser.uid)
          .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
          .slice(0, 200);
        setRequestLogs(liveLogs);
      },
      (error) => {
        console.warn('RTDB request_logs listener error:', error);
      }
    );
    return () => unsubscribe();
  }, [currentUser, isAdmin]);

  // Real-time RTDB listener for Admin /provider_keys
  useEffect(() => {
    if (!currentUser || !isAdmin) return;
    const unsubscribe = onValue(
      ref(rtdb, 'provider_keys'),
      (snapshot) => {
        const byKey = new Map<string, ProviderKey>();
        for (const pk of rtdbMapToList<ProviderKey>(snapshot.val())) {
          if (pk?.key) byKey.set(pk.key, pk);
        }
        const docs = Array.from(byKey.values()).sort((a, b) =>
          (b.createdAt || '').localeCompare(a.createdAt || '')
        );
        setProviderKeys(docs);
        syncWithBackend([], docs, undefined, true).catch(() => {});
      },
      (error) => {
        console.warn('RTDB provider_keys listener error:', error);
      }
    );
    return () => unsubscribe();
  }, [currentUser, isAdmin, syncWithBackend]);

  const handleSignOut = async () => {
    if (currentUser) {
      await signOut(auth);
    }
    setUserProfile(null);
    setApiKeys([]);
    setProviderKeys([]);
    setRequestLogs([]);
    showToast('Signed Out', 'You have been disconnected from the session.', 'info');
  };

  // Create Gateway API Key via Node.js server -> generated sk-gateway-... saved directly in Firebase RTDB
  const handleCreateApiKey = async (name: string): Promise<ApiKey> => {
    if (!currentUser) {
      throw new Error('Please sign in first to generate an API key.');
    }

    const fbToken = await getFirebaseIdToken();
    const res = await fetch('/api/keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(fbToken ? { 'x-firebase-token': fbToken } : {})
      },
      body: JSON.stringify({
        userId: currentUser.uid,
        name
      })
    });

    const data = await parseJsonSafe(res);
    if (!res.ok || !data?.key?.key) {
      throw new Error(data?.error || 'Node.js gateway failed to generate API key.');
    }

    const createdKey = data.key as ApiKey;

    // Guarantee RTDB persistence if server didn't have direct RTDB auth
    if (!data.persistedToDb) {
      await set(ref(rtdb, `api_keys/${toRtdbKey(createdKey.id)}`), sanitizeForRtdb(createdKey));
    }

    setApiKeys((prev) => {
      const filtered = prev.filter(k => k.id !== createdKey.id && k.key !== createdKey.key);
      return [createdKey, ...filtered];
    });

    return createdKey;
  };

  // Delete Gateway API Key from Node.js server + Firebase RTDB
  const handleDeleteApiKey = async (keyId: string) => {
    setApiKeys((prev) => prev.filter(k => k.id !== keyId));

    const fbToken = await getFirebaseIdToken();
    await Promise.all([
      fetch(`/api/keys/${encodeURIComponent(keyId)}`, {
        method: 'DELETE',
        headers: fbToken ? { 'x-firebase-token': fbToken } : {}
      }).catch(() => {}),
      remove(ref(rtdb, `api_keys/${toRtdbKey(keyId)}`)).catch(() => {})
    ]);
  };

  // Admin Bulk Add Provider Keys & Auto-Discover Models -> saved directly in Firebase RTDB
  const handleAddBulkProviderKeys = async (keysText: string, provider: string, customBaseUrl?: string) => {
    const fbToken = await getFirebaseIdToken();
    const res = await fetch('/api/admin/bulk-add-keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-email': activeEmail || '',
        ...(fbToken ? { 'x-firebase-token': fbToken } : {})
      },
      body: JSON.stringify({ keysText, provider, customBaseUrl })
    });

    const data = await parseJsonSafe(res);

    let nextModels: GatewayModel[] = [];
    if (Array.isArray(data.models)) {
      nextModels = data.models.map((m: any) => ({
        id: m.id,
        name: m.name || m.id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
        provider: m.provider || 'custom',
        ownerKeyId: m.ownerKeyId,
        ownerKeyHint: m.ownerKeyHint,
        contextWindow: m.contextWindow,
        discoveredAt: m.discoveredAt || new Date().toISOString()
      }));
      setModels(nextModels);
    } else {
      const modelsRes = await fetch('/api/models');
      if (modelsRes.ok) {
        const modelsData = await parseJsonSafe(modelsRes);
        if (Array.isArray(modelsData.data)) {
          nextModels = modelsData.data.map((m: any) => ({
            id: m.id,
            name: m.name || m.id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
            provider: m.provider || m.owned_by || 'custom',
            ownerKeyId: m.ownerKeyId,
            ownerKeyHint: m.ownerKeyHint,
            discoveredAt: new Date().toISOString()
          }));
          setModels(nextModels);
        }
      }
    }

    if (Array.isArray(data.keys)) {
      const upsertedKeys: ProviderKey[] = data.keys.map((k: any) => ({
        id: String(k.id).slice(0, 128),
        provider: String(k.provider || 'custom').slice(0, 64) as any,
        key: String(k.key).slice(0, 512),
        keyHint: k.keyHint ? String(k.keyHint).slice(0, 32) : undefined,
        customBaseUrl: k.customBaseUrl ? String(k.customBaseUrl).slice(0, 512) : undefined,
        status: k.status || 'active',
        supportedModels: Array.isArray(k.supportedModels)
          ? k.supportedModels.slice(0, 1000)
          : (data.discoveredModelsSummary?.[k.keyHint] || []).slice(0, 1000),
        requestCount: typeof k.requestCount === 'number' ? k.requestCount : 0,
        errorCount: typeof k.errorCount === 'number' ? k.errorCount : 0,
        lastError: k.lastError ? String(k.lastError).slice(0, 500) : undefined,
        createdAt: String(k.createdAt || new Date().toISOString()).slice(0, 64),
        updatedAt: String(k.updatedAt || new Date().toISOString()).slice(0, 64)
      }));

      setProviderKeys(prev => {
        const byKey = new Map<string, ProviderKey>();
        for (const item of prev) {
          if (item?.key) byKey.set(item.key, item);
        }
        for (const k of upsertedKeys) {
          if (k?.key) byKey.set(k.key, k);
        }
        return Array.from(byKey.values());
      });

      // Guarantee Realtime Database persistence via client SDK if server RTDB write didn't complete all items
      if (currentUser && isAdmin) {
        try {
          const updates: Record<string, any> = {};
          for (const pk of upsertedKeys) {
            const safeRecord = buildSafeProviderKeyRecord(pk);
            updates[`provider_keys/${safeRecord.id}`] = safeRecord;
          }
          await update(ref(rtdb), updates);
          await syncModelsToRtdb(nextModels);
        } catch (err: any) {
          showToast(
            'RTDB Persistence Warning',
            err?.message || 'Keys active in gateway, but RTDB write failed. Check RTDB rules.',
            'error'
          );
        }
      }
    }

    return {
      addedCount: data.addedCount || 0,
      modelsCount: Object.values(data.discoveredModelsSummary || {}).flat().length,
      discoveryErrors: data.discoveryErrors as Record<string, string> | undefined
    };
  };

  const handleToggleKeyStatus = async (keyId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'disabled' ? 'active' : 'disabled';
    const updated = providerKeys.map(k =>
      k.id === keyId ? { ...k, status: newStatus as any, updatedAt: new Date().toISOString() } : k
    );
    setProviderKeys(updated);

    const fbToken = await getFirebaseIdToken();
    try {
      const res = await fetch(`/api/admin/keys/${encodeURIComponent(keyId)}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-user-email': activeEmail || '',
          ...(fbToken ? { 'x-firebase-token': fbToken } : {})
        },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        const data = await parseJsonSafe(res);
        if (Array.isArray(data.models)) {
          setModels(data.models);
          await syncModelsToRtdb(data.models);
        }
      } else {
        await syncWithBackend(apiKeys, updated, undefined, true);
      }
    } catch {
      await syncWithBackend(apiKeys, updated, undefined, true);
    }

    if (currentUser && isAdmin) {
      const target = updated.find(k => k.id === keyId);
      if (target) {
        const safeRecord = buildSafeProviderKeyRecord(target);
        await set(ref(rtdb, `provider_keys/${safeRecord.id}`), safeRecord).catch(() => {});
      }
    }

    showToast('Status Updated', `Key is now ${newStatus}.`, 'info');
  };

  const handleDeleteProviderKey = async (keyId: string) => {
    const updated = providerKeys.filter(k => k.id !== keyId);
    setProviderKeys(updated);

    const fbToken = await getFirebaseIdToken();
    try {
      const res = await fetch(`/api/admin/keys/${encodeURIComponent(keyId)}`, {
        method: 'DELETE',
        headers: {
          'x-user-email': activeEmail || '',
          ...(fbToken ? { 'x-firebase-token': fbToken } : {})
        }
      });
      if (res.ok) {
        const data = await parseJsonSafe(res);
        if (Array.isArray(data.models)) {
          setModels(data.models);
          await syncModelsToRtdb(data.models);
        }
      }
    } catch {
      await syncWithBackend(apiKeys, updated, undefined, true);
    }

    if (currentUser && isAdmin) {
      await remove(ref(rtdb, `provider_keys/${toRtdbKey(keyId)}`)).catch(() => {});
    }

    showToast('Key Removed', 'Provider key removed from Master Pool.', 'info');
  };

  const handleResetCooldowns = async () => {
    const updated = providerKeys.map(k =>
      (k.status === 'rate_limited' || k.status === 'exhausted')
        ? { ...k, status: 'active' as const, cooldownUntil: undefined, lastError: undefined, updatedAt: new Date().toISOString() }
        : k
    );
    setProviderKeys(updated);

    const fbToken = await getFirebaseIdToken();
    try {
      await fetch('/api/admin/keys/reset-cooldowns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-email': activeEmail || '',
          ...(fbToken ? { 'x-firebase-token': fbToken } : {})
        }
      });
    } catch {
      syncWithBackend(apiKeys, updated, undefined, true);
    }

    if (currentUser && isAdmin) {
      const updates: Record<string, any> = {};
      for (const pk of updated) {
        const safeRecord = buildSafeProviderKeyRecord(pk);
        updates[`provider_keys/${safeRecord.id}`] = safeRecord;
      }
      if (Object.keys(updates).length > 0) {
        await update(ref(rtdb), updates).catch(() => {});
      }
    }

    showToast('Cooldowns Cleared', 'All rate-limited and exhausted provider keys restored to active.', 'success');
  };

  const handleRefreshModels = async () => {
    try {
      const fbToken = await getFirebaseIdToken();
      const res = await fetch('/api/models/refresh', {
        method: 'POST',
        headers: fbToken ? { 'x-firebase-token': fbToken } : {}
      });
      const data = await parseJsonSafe(res);
      if (Array.isArray(data.models)) {
        const nextModels: GatewayModel[] = data.models.map((m: any) => ({
          id: m.id,
          name: m.name || m.id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
          provider: m.provider || 'custom',
          ownerKeyId: m.ownerKeyId,
          ownerKeyHint: m.ownerKeyHint,
          discoveredAt: m.discoveredAt || new Date().toISOString()
        }));
        setModels(nextModels);
        if (isAdmin) {
          await syncModelsToRtdb(nextModels);
        }
        showToast('Models Synced', `${nextModels.length} live model(s) synced from active keys.`, 'success');
        return;
      }

      const liveRes = await fetch('/api/models');
      const liveData = await parseJsonSafe(liveRes);
      if (Array.isArray(liveData.data)) {
        setModels(liveData.data.map((m: any) => ({
          id: m.id,
          name: m.name || m.id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
          provider: m.provider || m.owned_by || 'custom',
          ownerKeyId: m.ownerKeyId,
          ownerKeyHint: m.ownerKeyHint,
          discoveredAt: m.discoveredAt || new Date().toISOString()
        })));
        showToast('Models Refreshed', `${liveData.data.length} live model(s) loaded.`, 'success');
      }
    } catch (e: any) {
      showToast('Refresh Error', e.message, 'error');
    }
  };

  // Real Metrics Calculation from live RTDB telemetry logs & keys
  const totalRequestsSum = Math.max(
    requestLogs.length,
    apiKeys.reduce((acc, k) => acc + (k.totalRequests || 0), 0) + (userProfile?.totalRequests || 0)
  );

  const logsTotalTokens = requestLogs.reduce((acc, l) => acc + (l.totalTokens || 0), 0);
  const keysTotalTokens = apiKeys.reduce((acc, k) => acc + (k.totalTokens || 0), 0) + (userProfile?.totalTokens || 0);
  const totalTokensSum = Math.max(logsTotalTokens, keysTotalTokens);

  const realPromptTokens = requestLogs.reduce((acc, l) => acc + (l.promptTokens || 0), 0);
  const realCompletionTokens = requestLogs.reduce((acc, l) => acc + (l.completionTokens || 0), 0);

  const promptTokensCount = realPromptTokens > 0 || requestLogs.length > 0
    ? realPromptTokens
    : 0;
  const completionTokensCount = realCompletionTokens > 0 || requestLogs.length > 0
    ? realCompletionTokens
    : totalTokensSum;

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const realDailyUsage = requestLogs.filter(l => new Date(l.timestamp).getTime() >= oneDayAgo).length;

  // If user navigated to /login or clicked "Get Free API Key"
  if (!isAuthenticated && (isLoginRoute || showAuthModal)) {
    return (
      <LoginModal
        isFullPage={true}
        onBack={() => {
          setShowAuthModal(false);
          setIsLoginRoute(false);
          window.history.pushState(null, '', '/');
        }}
        onSuccess={() => {
          setShowAuthModal(false);
          setIsLoginRoute(false);
          if (window.location.pathname.toLowerCase() === '/admin' || window.location.hash.toLowerCase() === '#admin') {
            setActiveTab('admin');
          }
        }}
      />
    );
  }

  // If unauthenticated and visited /admin directly, show Admin authentication page
  if (!isAuthenticated && activeTab === 'admin') {
    return (
      <div className="min-h-screen bg-[#FAF9F6] flex flex-col justify-center items-center p-4">
        <div className="w-full max-w-md">
          <div className="mb-4 text-center">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-violet-100 text-violet-800 text-xs font-semibold">
              🔒 Admin Access Portal
            </span>
          </div>
          <LoginModal
            isFullPage={false}
            onBack={() => {
              setActiveTab('dashboard');
              window.history.pushState(null, '', '/');
            }}
            onSuccess={() => {
              setActiveTab('admin');
            }}
          />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <LandingPage
        models={models}
        liveStats={publicStats}
        onGetFreeApiKey={() => {
          setIsLoginRoute(true);
          window.history.pushState(null, '', '/login');
        }}
        onOpenPlayground={() => {
          setIsLoginRoute(true);
          window.history.pushState(null, '', '/login');
        }}
        onViewModels={() => {
          const section = document.getElementById('models');
          if (section) {
            section.scrollIntoView({ behavior: 'smooth' });
          } else {
            setIsLoginRoute(true);
            window.history.pushState(null, '', '/login');
          }
        }}
      />
    );
  }

  // Standalone /admin layout (completely separate from the User Dashboard layout)
  if (activeTab === 'admin') {
    return (
      <StandaloneAdminDashboard
        userEmail={activeEmail}
        userDisplayName={currentUser?.displayName || undefined}
        isAdmin={isAdmin}
        providerKeys={providerKeys}
        models={models}
        logs={requestLogs}
        onAddBulkKeys={handleAddBulkProviderKeys}
        onToggleKeyStatus={handleToggleKeyStatus}
        onDeleteProviderKey={handleDeleteProviderKey}
        onResetCooldowns={handleResetCooldowns}
        onRefreshModels={handleRefreshModels}
        onReturnToUserApp={() => handleSelectTab('dashboard')}
        onLogout={handleSignOut}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-zinc-900 flex antialiased">
      {/* 1. Permanent Pinned Left Sidebar (width: 260px) */}
      <Sidebar
        currentTab={activeTab}
        onSelectTab={handleSelectTab}
        user={currentUser}
        isAdmin={isAdmin}
        onLogout={handleSignOut}
      />

      {/* 2. Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* Minimalist Top Header */}
        <TopHeader
          currentTab={activeTab}
          user={currentUser}
          onLogout={handleSignOut}
        />

        {/* Top Notification Banner: 50 Billion Free Credits Daily Reset */}
        <div className="bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 text-white px-6 sm:px-8 py-2.5 border-b border-violet-700/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <span className="font-semibold tracking-tight">
            ⚡ 50 Billion Free Credits Allocated — Refreshes &amp; Resets Daily for Unlimited Developer Testing
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/15 border border-white/20 text-[11px] font-mono font-semibold w-fit shrink-0">
            50.0B Credits • Daily Reset Active
          </span>
        </div>

        {/* Tab View Container */}
        <main className="flex-1 max-w-6xl w-full mx-auto px-6 sm:px-8 py-8">
          {activeTab === 'dashboard' && (
            <OverviewView
              totalRequests={totalRequestsSum}
              dailyUsage={realDailyUsage}
              promptTokens={promptTokensCount}
              completionTokens={completionTokensCount}
              logs={requestLogs}
              models={models}
              onNavigateToKeys={() => handleSelectTab('keys')}
              onNavigateToPlayground={() => handleSelectTab('playground')}
              onNavigateToModels={() => handleSelectTab('models')}
            />
          )}

          {activeTab === 'keys' && (
            <ApiKeysSection
              apiKeys={apiKeys}
              models={models}
              onCreateKey={handleCreateApiKey}
              onDeleteKey={handleDeleteApiKey}
              onSelectForPlayground={(key) => {
                setSelectedKeyForPlayground(key);
                handleSelectTab('playground');
              }}
            />
          )}

          {activeTab === 'playground' && (
            <Playground
              apiKeys={apiKeys}
              models={models}
              selectedKey={selectedKeyForPlayground}
            />
          )}

          {activeTab === 'models' && (
            <ModelsView
              models={models}
              providerKeys={providerKeys}
              isAdmin={isAdmin}
              onSelectModelForPlayground={() => {
                handleSelectTab('playground');
              }}
              onAddKeyAndFetchModels={handleAddBulkProviderKeys}
              onRefreshModels={handleRefreshModels}
              onDeleteKey={handleDeleteProviderKey}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              userEmail={activeEmail}
              isAdmin={isAdmin}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <GatewayApp />
    </ToastProvider>
  );
}
