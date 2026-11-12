import React, { useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  getDoc, 
  deleteDoc 
} from 'firebase/firestore';
import { 
  auth, 
  db, 
  isUserAdmin, 
  DESIGNATED_ADMIN_EMAIL 
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

  // Sync with URL routing
  useEffect(() => {
    const checkPath = () => {
      const path = window.location.pathname;
      const hash = window.location.hash;
      if (path === '/admin' || hash === '#admin') setActiveTab('admin');
      else if (path.includes('/keys') || hash === '#keys') setActiveTab('keys');
      else if (path.includes('/playground') || hash === '#playground') setActiveTab('playground');
      else if (path.includes('/models') || hash === '#models') setActiveTab('models');
      else if (path.includes('/settings') || hash === '#settings') setActiveTab('settings');
      else setActiveTab('dashboard');
    };

    checkPath();
    window.addEventListener('popstate', checkPath);
    return () => window.removeEventListener('popstate', checkPath);
  }, []);

  const handleSelectTab = (tab: NavTab) => {
    setActiveTab(tab);
    if (tab === 'dashboard') {
      window.history.pushState(null, '', '/');
    } else if (tab === 'keys') {
      window.history.pushState(null, '', '/dashboard/keys');
    } else {
      window.history.pushState(null, '', `/${tab}`);
    }
  };

  // Sync state with backend memory router
  const syncWithBackend = useCallback(async (currentApiKeys: ApiKey[], currentProviderKeys: ProviderKey[]) => {
    try {
      await fetch('/api/gateway/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKeys: currentApiKeys, providerKeys: currentProviderKeys })
      });
    } catch (e) {
      // background sync
    }
  }, []);

  // Firebase Auth State Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        setDevUser(null);
        try {
          const profileRef = doc(db, 'user_profiles', user.uid);
          const snap = await getDoc(profileRef);

          if (snap.exists()) {
            setUserProfile(snap.data() as UserProfile);
          } else {
            const isAdm = isUserAdmin(user.email);
            const initialProfile: UserProfile = {
              uid: user.uid,
              email: user.email || '',
              displayName: user.displayName || 'Developer',
              photoURL: user.photoURL || undefined,
              role: isAdm ? 'admin' : 'user',
              freeCreditsAllocated: 0,
              freeCreditsSpent: 0,
              totalRequests: 0,
              totalTokens: 0,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            await setDoc(profileRef, initialProfile);
            setUserProfile(initialProfile);
          }
        } catch (err) {
          setUserProfile({
            uid: user.uid,
            email: user.email || '',
            displayName: user.displayName || 'Developer',
            role: isUserAdmin(user.email) ? 'admin' : 'user',
            freeCreditsAllocated: 0,
            freeCreditsSpent: 0,
            totalRequests: 0,
            totalTokens: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
        }
      } else {
        setUserProfile(null);
      }
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Initialize data
  useEffect(() => {
    const initializeData = async () => {
      // 1. Fetch models
      try {
        const res = await fetch('/v1/models');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.data)) {
            setModels(data.data.map((m: any) => ({
              id: m.id,
              name: m.id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
              provider: m.owned_by || 'groq',
              discoveredAt: new Date().toISOString()
            })));
          }
        }
      } catch (e) {
        console.warn('Failed to load models:', e);
      }

      // 2. Fetch stats & logs
      try {
        const statsRes = await fetch('/api/stats');
        if (statsRes.ok) {
          const statsData = await statsRes.json();
          if (Array.isArray(statsData.logs)) {
            setRequestLogs(statsData.logs);
          }
        }
      } catch (e) {
        // Ignore
      }

      // 3. Baseline Master Key Pool
      const initialPool: ProviderKey[] = [
        {
          id: 'pk_groq_primary',
          provider: 'groq',
          key: 'gsk_master_pool_key_alpha_79x1',
          keyHint: 'gsk_...79x1',
          status: 'active',
          supportedModels: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
          requestCount: 0,
          errorCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'pk_openai_backup',
          provider: 'openai',
          key: 'sk-proj-master_pool_key_beta_99v2',
          keyHint: 'sk-p...99v2',
          status: 'active',
          supportedModels: ['gpt-4o', 'gpt-4o-mini'],
          requestCount: 0,
          errorCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'pk_gemini_rotator',
          provider: 'gemini',
          key: 'AIzaSyMasterPoolKeyGamma43k',
          keyHint: 'AIza...43k',
          status: 'active',
          supportedModels: ['gemini-2.0-flash', 'gemini-1.5-pro'],
          requestCount: 0,
          errorCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ];

      setProviderKeys(initialPool);

      // Start with clean 0 keys so endpoint remains hidden until user creates their first key
      setApiKeys([]);

      syncWithBackend([], initialPool);
    };

    initializeData();
  }, [activeUid, syncWithBackend]);

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

  // Admin Bulk Add Provider Keys
  const handleAddBulkProviderKeys = async (keysText: string, provider: string) => {
    const res = await fetch('/api/admin/bulk-add-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keysText, provider })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Bulk ingestion failed');
    }

    const data = await res.json();

    const modelsRes = await fetch('/v1/models');
    if (modelsRes.ok) {
      const modelsData = await modelsRes.json();
      if (Array.isArray(modelsData.data)) {
        setModels(modelsData.data.map((m: any) => ({
          id: m.id,
          name: m.id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
          provider: m.owned_by || 'groq',
          discoveredAt: new Date().toISOString()
        })));
      }
    }

    if (Array.isArray(data.keys)) {
      const newKeys: ProviderKey[] = data.keys.map((k: any) => ({
        id: k.id,
        provider: k.provider,
        key: k.key || 'sk-provider-secret',
        keyHint: k.keyHint,
        status: k.status || 'active',
        supportedModels: data.discoveredModelsSummary?.[k.keyHint] || [],
        requestCount: 0,
        errorCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }));
      setProviderKeys(prev => [...newKeys, ...prev]);
    }

    return {
      addedCount: data.addedCount || 0,
      modelsCount: Object.values(data.discoveredModelsSummary || {}).flat().length
    };
  };

  const handleToggleKeyStatus = async (keyId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'disabled' ? 'active' : 'disabled';
    const updated = providerKeys.map(k => k.id === keyId ? { ...k, status: newStatus as any } : k);
    setProviderKeys(updated);
    syncWithBackend(apiKeys, updated);
    showToast('Status Updated', `Key is now ${newStatus}.`, 'info');
  };

  const handleDeleteProviderKey = async (keyId: string) => {
    const updated = providerKeys.filter(k => k.id !== keyId);
    setProviderKeys(updated);
    syncWithBackend(apiKeys, updated);
    showToast('Key Removed', 'Provider key removed from Master Pool.', 'info');
  };

  const handleResetCooldowns = () => {
    const updated = providerKeys.map(k => k.status === 'rate_limited' ? { ...k, status: 'active' as const, cooldownUntil: undefined } : k);
    setProviderKeys(updated);
    syncWithBackend(apiKeys, updated);
    showToast('Cooldowns Cleared', 'All rate-limited provider keys restored.', 'success');
  };

  const handleRefreshModels = async () => {
    try {
      const res = await fetch('/v1/models');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.data)) {
          setModels(data.data.map((m: any) => ({
            id: m.id,
            name: m.id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
            provider: m.owned_by || 'groq',
            discoveredAt: new Date().toISOString()
          })));
          showToast('Models Refreshed', `${data.data.length} models discoverable.`, 'success');
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

  const isAuthenticated = Boolean(currentUser || devUser);

  if (!isAuthenticated) {
    return (
      <>
        <LandingPage
          models={models}
          onGetFreeApiKey={() => setShowAuthModal(true)}
          onOpenPlayground={() => {
            setShowAuthModal(true);
          }}
          onViewModels={() => {
            const section = document.getElementById('models-showcase');
            if (section) {
              section.scrollIntoView({ behavior: 'smooth' });
            } else {
              setShowAuthModal(true);
            }
          }}
        />

        {showAuthModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/60 backdrop-blur-xs animate-in fade-in">
            <div className="relative w-full max-w-md">
              <button
                onClick={() => setShowAuthModal(false)}
                className="absolute top-4 right-4 z-10 text-zinc-400 hover:text-zinc-600 bg-zinc-100 hover:bg-zinc-200 rounded-full w-8 h-8 flex items-center justify-center cursor-pointer transition-colors"
                title="Close"
              >
                ✕
              </button>
              <LoginModal 
                onSuccess={() => setShowAuthModal(false)} 
              />
            </div>
          </div>
        )}
      </>
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

          {activeTab === 'admin' && (
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
