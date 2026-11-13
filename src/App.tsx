import React, { useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  getDoc, 
  deleteDoc,
  collection,
  getDocs,
  query,
  where
} from 'firebase/firestore';
import { 
  auth, 
  db, 
  isUserAdmin, 
  handleFirestoreError,
  OperationType,
  testConnection
} from './lib/firebase';
import { ApiKey, ProviderKey, GatewayModel, RequestLog, UserProfile } from './types/gateway';
import { ToastProvider, useToast } from './components/Toast';
import { Sidebar, NavTab } from './components/Sidebar';
import { TopHeader } from './components/TopHeader';
import { OverviewView } from './components/OverviewView';
import { ApiKeysSection } from './components/ApiKeysSection';
import { Playground } from './components/Playground';
import { ModelsView } from './components/ModelsView';
import { AdminPanel } from './components/AdminPanel';
import { SettingsView } from './components/SettingsView';
import { LoginModal } from './components/LoginModal';
import { LandingPage } from './components/LandingPage';

function GatewayApp() {
  const { showToast } = useToast();

  // Auth & Profile
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [devUser, setDevUser] = useState<{ email: string; displayName: string; uid: string } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Layout & Navigation Tab
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [isLoginRoute, setIsLoginRoute] = useState<boolean>(false);

  // Gateway Keys & State
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [providerKeys, setProviderKeys] = useState<ProviderKey[]>([]);
  const [models, setModels] = useState<GatewayModel[]>([]);
  const [requestLogs, setRequestLogs] = useState<RequestLog[]>([]);
  const [selectedKeyForPlayground, setSelectedKeyForPlayground] = useState<string>('');

  // Active user details
  const activeEmail = currentUser?.email || devUser?.email;
  const activeUid = currentUser?.uid || devUser?.uid || 'usr_developer';
  const isAdmin = isUserAdmin(activeEmail, userProfile?.role);
  const isAuthenticated = Boolean(currentUser || devUser);

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
        // preserve current tab or default to dashboard
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

  // Helper to strip undefined fields before writing to Firestore
  const sanitizeForFirestore = <T extends Record<string, any>>(obj: T): Partial<T> => {
    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) clean[k] = v;
    }
    return clean as Partial<T>;
  };

  const toFirestoreDocId = (rawId: string): string => {
    const sanitized = rawId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
    return sanitized || 'id_' + Math.random().toString(36).substring(2, 10);
  };

  // Sync state with backend memory router (keys + models from Admin Panel)
  const syncWithBackend = useCallback(async (
    currentApiKeys: ApiKey[],
    currentProviderKeys: ProviderKey[],
    currentModels?: GatewayModel[],
    replaceProviderKeys = false
  ) => {
    try {
      await fetch('/api/gateway/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
  }, []);

  // Firebase Auth State Listener — checks Rouinmajhi@gmail.com for Admin role & runs daily 50B credits reset
  useEffect(() => {
    const DAILY_CREDITS = 50_000_000_000;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        setDevUser(null);
        const isAdm = isUserAdmin(user.email);
        const expectedRole: 'admin' | 'user' = isAdm ? 'admin' : 'user';
        const today = new Date().toISOString().slice(0, 10);
        const nowIso = new Date().toISOString();

        // Notify backend session for role verification and daily credits reset
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
          const profileRef = doc(db, 'user_profiles', user.uid);
          const snap = await getDoc(profileRef);

          if (snap.exists()) {
            const existing = snap.data() as UserProfile;
            const needsDailyReset =
              !existing.updatedAt ||
              existing.updatedAt.slice(0, 10) !== today ||
              (existing.freeCreditsAllocated || 0) < DAILY_CREDITS;
            const needsRoleUpdate = existing.role !== expectedRole;

            const updatedProfile: UserProfile = {
              ...existing,
              email: user.email || existing.email,
              displayName: user.displayName || existing.displayName || 'Developer',
              role: expectedRole,
              freeCreditsAllocated: DAILY_CREDITS,
              freeCreditsSpent: needsDailyReset ? 0 : (existing.freeCreditsSpent || 0),
              updatedAt: nowIso
            };

            if (needsDailyReset || needsRoleUpdate) {
              try {
                await setDoc(profileRef, sanitizeForFirestore(updatedProfile));
              } catch (writeErr) {
                try {
                  handleFirestoreError(writeErr, OperationType.UPDATE, `user_profiles/${user.uid}`);
                } catch {
                  // Non-blocking fallback
                }
              }
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
            try {
              await setDoc(profileRef, sanitizeForFirestore(initialProfile));
            } catch (writeErr) {
              try {
                handleFirestoreError(writeErr, OperationType.CREATE, `user_profiles/${user.uid}`);
              } catch {
                // Non-blocking fallback
              }
            }
            setUserProfile(initialProfile);
          }
        } catch (err) {
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

  // Initialize data & synchronize with Firestore + Gateway Backend
  useEffect(() => {
    let cancelled = false;

    const initializeData = async () => {
      testConnection();

      let loadedModels: GatewayModel[] = [];
      let loadedApiKeys: ApiKey[] = [];
      let loadedProviderKeys: ProviderKey[] = [];

      // 1. Fetch public/cached models from gateway backend
      try {
        const res = await fetch('/api/models');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.data)) {
            loadedModels = data.data.map((m: any) => ({
              id: m.id,
              name: m.name || m.id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
              provider: m.provider || m.owned_by || 'groq',
              discoveredAt: new Date().toISOString()
            }));
          }
        }
      } catch (e) {
        console.warn('Failed to load models from backend:', e);
      }

      // 2. Fetch live stats & logs
      try {
        const statsRes = await fetch('/api/stats');
        if (statsRes.ok) {
          const statsData = await statsRes.json();
          if (!cancelled && Array.isArray(statsData.logs)) {
            setRequestLogs(statsData.logs);
          }
        }
      } catch {
        // Ignore
      }

      // 3. When authenticated with Firebase, load user's persisted API keys, models & (if admin) provider pool
      if (currentUser) {
        try {
          const keysQ = query(collection(db, 'api_keys'), where('userId', '==', currentUser.uid));
          const keysSnap = await getDocs(keysQ);
          loadedApiKeys = keysSnap.docs.map(d => d.data() as ApiKey);
        } catch (err) {
          try {
            handleFirestoreError(err, OperationType.LIST, 'api_keys');
          } catch {
            // Non-blocking fallback
          }
        }

        try {
          const modelsSnap = await getDocs(collection(db, 'models'));
          if (!modelsSnap.empty) {
            const firestoreModels = modelsSnap.docs.map(d => d.data() as GatewayModel);
            if (firestoreModels.length > 0) {
              loadedModels = firestoreModels;
            }
          }
        } catch (err) {
          console.warn('Could not read models from Firestore:', err);
        }

        if (isAdmin) {
          try {
            const pkSnap = await getDocs(collection(db, 'provider_keys'));
            const firestorePool = pkSnap.docs.map(d => d.data() as ProviderKey);

            // Also check any keys already in backend cache
            const adminKeysRes = await fetch('/api/admin/keys', {
              headers: { 'x-user-email': currentUser.email || '' }
            }).catch(() => null);
            const backendPool: ProviderKey[] = adminKeysRes && adminKeysRes.ok
              ? ((await adminKeysRes.json()).keys || [])
              : [];

            const mergedMap = new Map<string, ProviderKey>();
            for (const pk of backendPool) mergedMap.set(pk.id, pk);
            for (const pk of firestorePool) mergedMap.set(pk.id, pk);
            loadedProviderKeys = Array.from(mergedMap.values());
          } catch (err) {
            console.warn('Could not load provider_keys from Firestore:', err);
          }
        }
      }

      if (cancelled) return;

      setModels(loadedModels);
      setApiKeys(loadedApiKeys);
      setProviderKeys(loadedProviderKeys);

      await syncWithBackend(
        loadedApiKeys,
        loadedProviderKeys,
        loadedModels,
        loadedProviderKeys.length > 0
      );

      // Re-read backend models in case backend rebuilt from synced provider keys
      if (loadedProviderKeys.length > 0) {
        try {
          const refreshedRes = await fetch('/api/models');
          if (refreshedRes.ok) {
            const refreshedData = await refreshedRes.json();
            if (!cancelled && Array.isArray(refreshedData.data)) {
              setModels(refreshedData.data.map((m: any) => ({
                id: m.id,
                name: m.name || m.id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
                provider: m.provider || m.owned_by || 'groq',
                discoveredAt: new Date().toISOString()
              })));
            }
          }
        } catch {
          // Ignore
        }
      }
    };

    initializeData();
    return () => {
      cancelled = true;
    };
  }, [currentUser, isAdmin, syncWithBackend]);

  // Dev Quick Login for testing inside sandboxes
  const handleDevQuickLogin = (email: string, displayName: string) => {
    const isAdm = isUserAdmin(email);
    const mockUid = 'usr_' + email.replace(/[^a-zA-Z0-9]/g, '_');
    setDevUser({ email, displayName, uid: mockUid });
    setUserProfile({
      uid: mockUid,
      email,
      displayName,
      role: isAdm ? 'admin' : 'user',
      freeCreditsAllocated: 0,
      freeCreditsSpent: 0,
      totalRequests: 0,
      totalTokens: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    showToast('Signed In', `Welcome back, ${displayName}!`, 'success');
  };

  const handleSignOut = async () => {
    if (currentUser) {
      await signOut(auth);
    }
    setDevUser(null);
    setUserProfile(null);
    showToast('Signed Out', 'You have been disconnected from the session.', 'info');
  };

  // Create Gateway API Key
  const handleCreateApiKey = async (name: string): Promise<ApiKey> => {
    const randomHex = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    const fullKey = `sk-gateway-${randomHex}`;

    const newKey: ApiKey = {
      id: 'key_' + Math.random().toString(36).substring(2, 10),
      userId: activeUid,
      name,
      key: fullKey,
      keyPrefix: `${fullKey.slice(0, 11)}...${fullKey.slice(-4)}`,
      status: 'active',
      totalRequests: 0,
      totalTokens: 0,
      createdAt: new Date().toISOString()
    };

    const updated = [newKey, ...apiKeys];
    setApiKeys(updated);

    if (currentUser) {
      try {
        await setDoc(doc(db, 'api_keys', newKey.id), newKey);
      } catch (err) {
        console.warn('Could not persist key to Firestore:', err);
      }
    }

    syncWithBackend(updated, providerKeys);
    return newKey;
  };

  // Delete Gateway API Key
  const handleDeleteApiKey = async (keyId: string) => {
    const updated = apiKeys.filter(k => k.id !== keyId);
    setApiKeys(updated);

    if (currentUser) {
      try {
        await deleteDoc(doc(db, 'api_keys', keyId));
      } catch (err) {
        console.warn('Could not delete from Firestore:', err);
      }
    }

    syncWithBackend(updated, providerKeys);
  };

  // Persist discovered models list to Firestore (Admin only)
  const syncModelsToFirestore = useCallback(async (modelsList: GatewayModel[]) => {
    if (!currentUser || !isAdmin) return;
    try {
      // Clear removed models from Firestore and write active ones
      const existingSnap = await getDocs(collection(db, 'models'));
      const activeDocIds = new Set(modelsList.map(m => toFirestoreDocId(m.id)));
      for (const d of existingSnap.docs) {
        if (!activeDocIds.has(d.id)) {
          await deleteDoc(doc(db, 'models', d.id));
        }
      }
      for (const m of modelsList) {
        const docId = toFirestoreDocId(m.id);
        await setDoc(doc(db, 'models', docId), sanitizeForFirestore(m));
      }
    } catch (err) {
      console.warn('Could not persist models to Firestore:', err);
    }
  }, [currentUser, isAdmin]);

  // Admin Bulk Add Provider Keys & Auto-Discover Models
  const handleAddBulkProviderKeys = async (keysText: string, provider: string, customBaseUrl?: string) => {
    const res = await fetch('/api/admin/bulk-add-keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-email': activeEmail || ''
      },
      body: JSON.stringify({ keysText, provider, customBaseUrl })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Bulk ingestion failed');
    }

    const data = await res.json();

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
        const modelsData = await modelsRes.json();
        if (Array.isArray(modelsData.data)) {
          nextModels = modelsData.data.map((m: any) => ({
            id: m.id,
            name: m.name || m.id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
            provider: m.provider || m.owned_by || 'custom',
            discoveredAt: new Date().toISOString()
          }));
          setModels(nextModels);
        }
      }
    }

    if (Array.isArray(data.keys)) {
      const newKeys: ProviderKey[] = data.keys.map((k: any) => ({
        id: k.id,
        provider: k.provider,
        key: k.key,
        keyHint: k.keyHint,
        customBaseUrl: k.customBaseUrl,
        status: k.status || 'active',
        supportedModels: k.supportedModels || data.discoveredModelsSummary?.[k.keyHint] || [],
        requestCount: 0,
        errorCount: 0,
        lastError: k.lastError,
        createdAt: k.createdAt || new Date().toISOString(),
        updatedAt: k.updatedAt || new Date().toISOString()
      }));
      setProviderKeys(prev => [...newKeys, ...prev]);

      // Persist new keys & discovered models to Firestore
      if (currentUser && isAdmin) {
        for (const pk of newKeys) {
          try {
            await setDoc(doc(db, 'provider_keys', toFirestoreDocId(pk.id)), sanitizeForFirestore(pk));
          } catch (err) {
            console.warn('Could not persist provider_key to Firestore:', err);
          }
        }
        await syncModelsToFirestore(nextModels);
      }
    }

    return {
      addedCount: data.addedCount || 0,
      modelsCount: Object.values(data.discoveredModelsSummary || {}).flat().length
    };
  };

  const handleToggleKeyStatus = async (keyId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'disabled' ? 'active' : 'disabled';
    const updated = providerKeys.map(k => k.id === keyId ? { ...k, status: newStatus as any, updatedAt: new Date().toISOString() } : k);
    setProviderKeys(updated);

    try {
      const res = await fetch(`/api/admin/keys/${encodeURIComponent(keyId)}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-user-email': activeEmail || ''
        },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.models)) {
          setModels(data.models);
          await syncModelsToFirestore(data.models);
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
        try {
          await setDoc(doc(db, 'provider_keys', toFirestoreDocId(keyId)), sanitizeForFirestore(target));
        } catch (err) {
          console.warn('Could not update provider_key in Firestore:', err);
        }
      }
    }

    showToast('Status Updated', `Key is now ${newStatus}.`, 'info');
  };

  const handleDeleteProviderKey = async (keyId: string) => {
    const updated = providerKeys.filter(k => k.id !== keyId);
    setProviderKeys(updated);

    try {
      const res = await fetch(`/api/admin/keys/${encodeURIComponent(keyId)}`, {
        method: 'DELETE',
        headers: { 'x-user-email': activeEmail || '' }
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.models)) {
          setModels(data.models);
          await syncModelsToFirestore(data.models);
        }
      }
    } catch {
      await syncWithBackend(apiKeys, updated, undefined, true);
    }

    if (currentUser && isAdmin) {
      try {
        await deleteDoc(doc(db, 'provider_keys', toFirestoreDocId(keyId)));
      } catch (err) {
        console.warn('Could not delete provider_key from Firestore:', err);
      }
    }

    showToast('Key Removed', 'Provider key removed from Master Pool.', 'info');
  };

  const handleResetCooldowns = () => {
    const updated = providerKeys.map(k => k.status === 'rate_limited' ? { ...k, status: 'active' as const, cooldownUntil: undefined } : k);
    setProviderKeys(updated);
    syncWithBackend(apiKeys, updated, undefined, true);
    showToast('Cooldowns Cleared', 'All rate-limited provider keys restored.', 'success');
  };

  const handleRefreshModels = async () => {
    try {
      const res = await fetch('/api/models/refresh', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
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
          await syncModelsToFirestore(nextModels);
          showToast('Models Refreshed', `${nextModels.length} models synced from provider keys.`, 'success');
          return;
        }
      }
      const fallbackRes = await fetch('/api/models');
      if (fallbackRes.ok) {
        const fallbackData = await fallbackRes.json();
        if (Array.isArray(fallbackData.data)) {
          setModels(fallbackData.data.map((m: any) => ({
            id: m.id,
            name: m.name || m.id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
            provider: m.provider || m.owned_by || 'groq',
            discoveredAt: new Date().toISOString()
          })));
          showToast('Models Refreshed', `${fallbackData.data.length} models discoverable.`, 'success');
        }
      }
    } catch (e: any) {
      showToast('Refresh Error', e.message, 'error');
    }
  };

  // Real Metrics Calculation from live telemetry logs & keys
  const totalRequestsSum = Math.max(
    requestLogs.length,
    apiKeys.reduce((acc, k) => acc + (k.totalRequests || 0), 0) + (userProfile?.totalRequests || 0)
  );

  const logsTotalTokens = requestLogs.reduce((acc, l) => acc + (l.totalTokens || 0), 0);
  const keysTotalTokens = apiKeys.reduce((acc, k) => acc + (k.totalTokens || 0), 0) + (userProfile?.totalTokens || 0);
  const totalTokensSum = Math.max(logsTotalTokens, keysTotalTokens);

  const realPromptTokens = requestLogs.reduce((acc, l) => acc + (l.promptTokens || 0), 0);
  const realCompletionTokens = requestLogs.reduce((acc, l) => acc + (l.completionTokens || 0), 0);

  const promptTokensCount = requestLogs.length > 0 ? realPromptTokens : Math.round(totalTokensSum * 0.38);
  const completionTokensCount = requestLogs.length > 0 ? realCompletionTokens : Math.round(totalTokensSum * 0.62);

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const realDailyUsage = requestLogs.filter(l => new Date(l.timestamp).getTime() >= oneDayAgo).length;

  // If user navigated to /login or clicked "Get Free API Key" or clicked "Sign In"
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
          // If they were trying to access /admin, keep it
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

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-zinc-900 flex antialiased">
      {/* 1. Permanent Pinned Left Sidebar (width: 260px) */}
      <Sidebar
        currentTab={activeTab}
        onSelectTab={handleSelectTab}
        user={currentUser || devUser}
        isAdmin={isAdmin}
        onLogout={handleSignOut}
      />

      {/* 2. Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* Minimalist Top Header */}
        <TopHeader
          currentTab={activeTab}
          user={currentUser || devUser}
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

        {/* Tab View Container - Standardized full width container */}
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
              onSelectModelForPlayground={(modelId) => {
                handleSelectTab('playground');
              }}
              onAddKeyAndFetchModels={handleAddBulkProviderKeys}
              onRefreshModels={handleRefreshModels}
              onDeleteKey={handleDeleteProviderKey}
            />
          )}

          {activeTab === 'admin' && isAdmin && (
            <AdminPanel
              userEmail={activeEmail}
              isAdmin={isAdmin}
              providerKeys={providerKeys}
              models={models}
              logs={requestLogs}
              onAddBulkKeys={handleAddBulkProviderKeys}
              onToggleKeyStatus={handleToggleKeyStatus}
              onDeleteProviderKey={handleDeleteProviderKey}
              onResetCooldowns={handleResetCooldowns}
              onRefreshModels={handleRefreshModels}
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
