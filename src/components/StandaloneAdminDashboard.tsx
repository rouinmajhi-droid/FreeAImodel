import React, { useState } from 'react';
import {
  ShieldCheck,
  Key,
  Plus,
  RefreshCw,
  Trash2,
  X,
  Lock,
  Search,
  LogOut,
  ArrowLeft,
  Layers,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Zap,
  Globe
} from 'lucide-react';
import { ProviderKey, GatewayModel, RequestLog } from '../types/gateway';
import { useToast } from './Toast';
import { ProviderLogo } from './ProviderLogo';
import { parseJsonSafe } from '../lib/http';

type AdminSection = 'pool' | 'models' | 'logs';

interface StandaloneAdminDashboardProps {
  userEmail?: string | null;
  userDisplayName?: string | null;
  isAdmin: boolean;
  providerKeys: ProviderKey[];
  models: GatewayModel[];
  logs: RequestLog[];
  onAddBulkKeys: (
    keysText: string,
    provider: string,
    customBaseUrl?: string
  ) => Promise<{
    addedCount: number;
    modelsCount: number;
    discoveryErrors?: Record<string, string>;
  }>;
  onToggleKeyStatus: (keyId: string, currentStatus: string) => Promise<void>;
  onDeleteProviderKey: (keyId: string) => Promise<void>;
  onResetCooldowns: () => void;
  onRefreshModels: () => Promise<void>;
  onReturnToUserApp: () => void;
  onLogout: () => void;
}

export const StandaloneAdminDashboard: React.FC<StandaloneAdminDashboardProps> = ({
  userEmail,
  userDisplayName,
  isAdmin,
  providerKeys,
  models,
  logs,
  onAddBulkKeys,
  onToggleKeyStatus,
  onDeleteProviderKey,
  onResetCooldowns,
  onRefreshModels,
  onReturnToUserApp,
  onLogout,
}) => {
  const { showToast } = useToast();
  const [adminSection, setAdminSection] = useState<AdminSection>('pool');

  // Bulk Ingestion Modal
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkKeysText, setBulkKeysText] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<string>('auto');
  const [customBaseUrl, setCustomBaseUrl] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncingAll, setIsSyncingAll] = useState(false);

  // Per-key Ping Test State
  const [testedKeyId, setTestedKeyId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    id: string;
    latency?: number;
    success: boolean;
    msg?: string;
    modelsFound?: number;
  } | null>(null);

  // Filters
  const [filterProvider, setFilterProvider] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [modelSearch, setModelSearch] = useState<string>('');

  // Strict Defense-in-Depth Access Block
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#0B0C10] text-zinc-100 flex items-center justify-center p-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-8 text-center shadow-2xl">
          <div className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">Access Blocked</h1>
          <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
            This Admin Control Plane at <code className="text-violet-300 font-mono">/admin</code> is restricted exclusively to the root administrator account.
          </p>
          <div className="mt-5 p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-xs font-mono text-zinc-400">
            Signed in as: <span className="text-zinc-200 font-semibold">{userEmail || 'Guest'}</span>
          </div>
          <div className="mt-6 flex flex-col sm:flex-row gap-2.5">
            <button
              onClick={onReturnToUserApp}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Return to User Dashboard</span>
            </button>
            <button
              onClick={onLogout}
              className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition-colors cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkKeysText.trim()) return;

    setIsSubmitting(true);
    try {
      const res = await onAddBulkKeys(bulkKeysText, selectedProvider, customBaseUrl.trim() || undefined);
      setBulkKeysText('');
      setCustomBaseUrl('');
      setIsBulkModalOpen(false);

      const errorEntries = res.discoveryErrors ? Object.entries(res.discoveryErrors) : [];
      if (errorEntries.length > 0 && res.modelsCount === 0) {
        showToast(
          'Keys Saved With Discovery Warning',
          `Added ${res.addedCount} key(s), but upstream model discovery returned: ${errorEntries[0][1]}`,
          'error'
        );
      } else if (errorEntries.length > 0) {
        showToast(
          'Partial Discovery Completed',
          `Added ${res.addedCount} key(s) & synced ${res.modelsCount} model(s). ${errorEntries.length} key(s) failed upstream check.`,
          'info'
        );
      } else {
        showToast(
          'Keys Ingested & Models Synced',
          `Added ${res.addedCount} key(s) and live-synced ${res.modelsCount} real model(s) to User Panel.`,
          'success'
        );
      }
    } catch (err: any) {
      showToast('Ingestion Error', err?.message || 'Failed to ingest provider keys.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSyncAll = async () => {
    setIsSyncingAll(true);
    try {
      await onRefreshModels();
    } finally {
      setIsSyncingAll(false);
    }
  };

  const handleTestKey = async (pk: ProviderKey) => {
    setTestedKeyId(pk.id);
    setTestResult(null);

    try {
      const res = await fetch('/api/admin/test-key', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-email': userEmail || ''
        },
        body: JSON.stringify({
          provider: pk.provider,
          key: pk.key,
          customBaseUrl: pk.customBaseUrl
        })
      });
      const data = await parseJsonSafe(res);
      if (data.success) {
        setTestResult({
          id: pk.id,
          latency: data.latencyMs,
          success: true,
          modelsFound: data.modelsFound
        });
        showToast(
          'Upstream Key Verified',
          `${pk.keyHint} connected to ${pk.provider} in ${data.latencyMs}ms (${data.modelsFound} live models).`,
          'success'
        );
      } else {
        setTestResult({ id: pk.id, success: false, msg: data.error });
        showToast('Upstream Key Failed', data.error || 'Upstream rejected this key.', 'error');
      }
    } catch (err: any) {
      setTestResult({ id: pk.id, success: false, msg: err.message });
      showToast('Ping Error', err?.message || 'Could not reach gateway server.', 'error');
    } finally {
      setTestedKeyId(null);
    }
  };

  const filteredKeys = providerKeys.filter((k) => {
    if (filterProvider !== 'all' && k.provider !== filterProvider) return false;
    if (filterStatus !== 'all' && k.status !== filterStatus) return false;
    return true;
  });

  const filteredModels = models.filter((m) => {
    if (!modelSearch.trim()) return true;
    const q = modelSearch.toLowerCase();
    return (
      m.id.toLowerCase().includes(q) ||
      (m.name || '').toLowerCase().includes(q) ||
      (m.provider || '').toLowerCase().includes(q)
    );
  });

  const activeCount = providerKeys.filter((k) => k.status === 'active').length;
  const rateLimitedCount = providerKeys.filter((k) => k.status === 'rate_limited').length;

  return (
    <div className="min-h-screen bg-[#F4F5F8] text-zinc-900 flex flex-col lg:flex-row antialiased">
      {/* Standalone Admin Dark Sidebar */}
      <aside className="w-full lg:w-[270px] bg-zinc-950 text-zinc-100 shrink-0 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-zinc-800">
        <div>
          {/* Admin Brand Header */}
          <div className="px-6 py-5 border-b border-zinc-800/90 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-violet-900/40">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-sm tracking-tight text-white">FreeAIModel</span>
                  <span className="px-1.5 py-0.5 rounded bg-violet-500/20 border border-violet-500/40 text-[10px] font-bold uppercase text-violet-300">
                    Admin
                  </span>
                </div>
                <span className="text-[11px] text-zinc-400 block">Gateway Control Plane</span>
              </div>
            </div>
          </div>

          {/* Admin Navigation */}
          <nav className="p-3 space-y-1">
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Infrastructure
            </div>

            <button
              onClick={() => setAdminSection('pool')}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                adminSection === 'pool'
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Key className="w-4 h-4" />
                <span>Master Key Pool</span>
              </span>
              <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-black/25">
                {providerKeys.length}
              </span>
            </button>

            <button
              onClick={() => setAdminSection('models')}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                adminSection === 'models'
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Layers className="w-4 h-4" />
                <span>Synced Live Models</span>
              </span>
              <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-black/25">
                {models.length}
              </span>
            </button>

            <button
              onClick={() => setAdminSection('logs')}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                adminSection === 'logs'
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Activity className="w-4 h-4" />
                <span>Gateway Traffic</span>
              </span>
              <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-black/25">
                {logs.length}
              </span>
            </button>
          </nav>

          {/* Switch to User App */}
          <div className="px-3 pt-4 border-t border-zinc-800/80 mx-3">
            <button
              onClick={onReturnToUserApp}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-medium text-zinc-300 hover:text-white bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-zinc-400" />
              <span>Open User Dashboard (/)</span>
            </button>
          </div>
        </div>

        {/* Admin Identity Footer */}
        <div className="p-4 border-t border-zinc-800/90">
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-900 border border-zinc-800">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-violet-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                {(userDisplayName || userEmail || 'A')[0].toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white truncate">Root Admin</p>
                <p className="text-[11px] text-zinc-400 truncate font-mono">{userEmail}</p>
              </div>
            </div>
            <button
              onClick={onLogout}
              className="text-zinc-400 hover:text-rose-400 p-1.5 rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer shrink-0"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Standalone Admin Workspace */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Admin Header Bar */}
        <header className="bg-white border-b border-zinc-200/90 px-6 sm:px-8 h-16 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-zinc-900 tracking-tight">
              {adminSection === 'pool' && 'Master Key Pool & Ingestion'}
              {adminSection === 'models' && 'Live Upstream Model Catalog'}
              {adminSection === 'logs' && 'Gateway Request Logs'}
            </h1>
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              100% Real Model Sync
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={handleSyncAll}
              disabled={isSyncingAll}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncingAll ? 'animate-spin text-violet-600' : ''}`} />
              <span>{isSyncingAll ? 'Syncing...' : 'Re-sync Upstream'}</span>
            </button>

            <button
              onClick={() => setIsBulkModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add Provider Keys</span>
            </button>
          </div>
        </header>

        {/* Workspace Content */}
        <main className="flex-1 max-w-6xl w-full mx-auto px-6 sm:px-8 py-8 space-y-6">
          {/* Metrics Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-zinc-200/80 p-4 shadow-xs">
              <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block">
                Provider Pool Keys
              </span>
              <span className="text-2xl font-bold text-zinc-900 mt-1 block font-mono">
                {providerKeys.length}
              </span>
            </div>
            <div className="bg-white rounded-xl border border-zinc-200/80 p-4 shadow-xs">
              <span className="text-[11px] font-semibold text-emerald-600 uppercase tracking-wider block">
                Active Keys
              </span>
              <span className="text-2xl font-bold text-emerald-600 mt-1 block font-mono">
                {activeCount}
              </span>
            </div>
            <div className="bg-white rounded-xl border border-zinc-200/80 p-4 shadow-xs">
              <span className="text-[11px] font-semibold text-amber-600 uppercase tracking-wider block">
                429 Cooldown
              </span>
              <span className="text-2xl font-bold text-amber-600 mt-1 block font-mono">
                {rateLimitedCount}
              </span>
            </div>
            <div className="bg-white rounded-xl border border-zinc-200/80 p-4 shadow-xs">
              <span className="text-[11px] font-semibold text-violet-600 uppercase tracking-wider block">
                Live User Panel Models
              </span>
              <span className="text-2xl font-bold text-violet-700 mt-1 block font-mono">
                {models.length}
              </span>
            </div>
          </div>

          {/* SECTION 1: MASTER KEY POOL */}
          {adminSection === 'pool' && (
            <div className="space-y-6">
              {/* Synced Models Summary Strip */}
              <div className="bg-white rounded-xl border border-zinc-200/80 p-5 shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-900">
                      Live Auto-Discovered Models (Synced to User Panel &amp; /v1/models)
                    </h2>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Fetched directly from your added provider keys. Zero hardcoded or demo models exist.
                    </p>
                  </div>
                  <button
                    onClick={() => setAdminSection('models')}
                    className="text-xs font-semibold text-violet-700 hover:text-violet-900 cursor-pointer self-start sm:self-auto"
                  >
                    Inspect All ({models.length}) →
                  </button>
                </div>

                {models.length === 0 ? (
                  <div className="p-4 rounded-lg bg-zinc-50 border border-dashed border-zinc-200 text-xs text-zinc-500 flex items-center gap-2.5">
                    <Globe className="w-4 h-4 text-zinc-400 shrink-0" />
                    <span>
                      No live models discovered yet. Click <strong>Add Provider Keys</strong> to fetch real models directly from an upstream API.
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {models.slice(0, 24).map((m) => (
                      <span
                        key={m.id}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-100 text-zinc-800 text-xs font-mono font-medium"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        <span>{m.id}</span>
                        <span className="text-[9px] uppercase font-bold text-zinc-400">{m.provider}</span>
                      </span>
                    ))}
                    {models.length > 24 && (
                      <span className="px-2.5 py-1 text-xs font-semibold text-violet-700">
                        +{models.length - 24} more
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Upstream Keys Table */}
              <div className="bg-white rounded-xl border border-zinc-200/80 shadow-xs overflow-hidden">
                <div className="p-4 sm:p-5 border-b border-zinc-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-zinc-900">Upstream Provider Keys</h2>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Each active key automatically discovers its available models and rotates on HTTP 429
                    </p>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={filterProvider}
                      onChange={(e) => setFilterProvider(e.target.value)}
                      className="px-2.5 py-1.5 rounded-lg border border-zinc-200 text-xs font-medium bg-white outline-none focus:border-violet-600 text-zinc-700"
                    >
                      <option value="all">All Providers</option>
                      <option value="inception">Inception</option>
                      <option value="groq">Groq</option>
                      <option value="openai">OpenAI</option>
                      <option value="gemini">Google Gemini</option>
                      <option value="openrouter">OpenRouter</option>
                      <option value="deepseek">DeepSeek</option>
                      <option value="mistral">Mistral</option>
                      <option value="cerebras">Cerebras</option>
                      <option value="anthropic">Anthropic</option>
                      <option value="custom">Custom URL</option>
                    </select>

                    <select
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value)}
                      className="px-2.5 py-1.5 rounded-lg border border-zinc-200 text-xs font-medium bg-white outline-none focus:border-violet-600 text-zinc-700"
                    >
                      <option value="all">All Statuses</option>
                      <option value="active">Active</option>
                      <option value="rate_limited">Rate-Limited</option>
                      <option value="disabled">Disabled</option>
                    </select>

                    <button
                      onClick={onResetCooldowns}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-zinc-200 hover:bg-zinc-50 text-xs font-medium text-zinc-700 cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Clear 429s</span>
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-zinc-100 bg-zinc-50/70 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                        <th className="py-3 px-5">Provider</th>
                        <th className="py-3 px-5">Key Hint</th>
                        <th className="py-3 px-5">Status</th>
                        <th className="py-3 px-5">Synced Models</th>
                        <th className="py-3 px-5">Calls / Errors</th>
                        <th className="py-3 px-5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 text-zinc-700">
                      {filteredKeys.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-14 text-center text-zinc-400 text-xs">
                            No provider keys in pool. Click <strong>Add Provider Keys</strong> to connect an upstream API.
                          </td>
                        </tr>
                      ) : (
                        filteredKeys.map((pk) => {
                          const isTested = testedKeyId === pk.id;
                          const res = testResult?.id === pk.id ? testResult : null;

                          return (
                            <React.Fragment key={pk.id}>
                              <tr className="hover:bg-zinc-50/70 transition-colors">
                                <td className="py-3.5 px-5">
                                  <div className="flex items-center gap-2">
                                    <ProviderLogo provider={pk.provider} size={16} />
                                    <div>
                                      <span className="font-semibold text-zinc-900 uppercase text-[11px] bg-zinc-100 px-2 py-0.5 rounded">
                                        {pk.provider}
                                      </span>
                                      {pk.customBaseUrl && (
                                        <span className="block text-[10px] font-mono text-zinc-400 mt-0.5 truncate max-w-[180px]">
                                          {pk.customBaseUrl}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </td>

                                <td className="py-3.5 px-5 font-mono text-zinc-800">{pk.keyHint}</td>

                                <td className="py-3.5 px-5">
                                  <span
                                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                                      pk.status === 'active'
                                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                                        : pk.status === 'rate_limited'
                                        ? 'bg-amber-50 text-amber-700 border border-amber-200/60 animate-pulse'
                                        : 'bg-zinc-100 text-zinc-600'
                                    }`}
                                  >
                                    <span
                                      className={`w-1.5 h-1.5 rounded-full ${
                                        pk.status === 'active'
                                          ? 'bg-emerald-500'
                                          : pk.status === 'rate_limited'
                                          ? 'bg-amber-500'
                                          : 'bg-zinc-400'
                                      }`}
                                    />
                                    {pk.status === 'rate_limited' ? '429 Cooldown' : pk.status}
                                  </span>
                                </td>

                                <td className="py-3.5 px-5 font-semibold text-violet-700">
                                  {pk.supportedModels?.length || 0} models
                                </td>

                                <td className="py-3.5 px-5 font-mono">
                                  <span>{pk.requestCount || 0} calls</span>
                                  <span className="text-zinc-300 mx-1.5">•</span>
                                  <span className={pk.errorCount > 0 ? 'text-amber-600 font-bold' : 'text-zinc-400'}>
                                    {pk.errorCount || 0} errs
                                  </span>
                                </td>

                                <td className="py-3.5 px-5 text-right">
                                  <div className="inline-flex items-center gap-2 justify-end">
                                    <button
                                      onClick={() => handleTestKey(pk)}
                                      disabled={isTested}
                                      className="px-2.5 py-1 rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-xs font-medium cursor-pointer"
                                    >
                                      {isTested
                                        ? 'Ping...'
                                        : res?.success
                                        ? `${res.latency}ms ✓`
                                        : res && !res.success
                                        ? 'Failed'
                                        : 'Ping'}
                                    </button>

                                    <button
                                      onClick={() => onToggleKeyStatus(pk.id, pk.status)}
                                      className="px-2.5 py-1 rounded text-xs font-medium text-zinc-600 hover:bg-zinc-100 cursor-pointer"
                                    >
                                      {pk.status === 'disabled' ? 'Enable' : 'Disable'}
                                    </button>

                                    <button
                                      onClick={() => onDeleteProviderKey(pk.id)}
                                      className="text-zinc-400 hover:text-rose-600 p-1 rounded hover:bg-rose-50 cursor-pointer"
                                      title="Remove key from pool"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </td>
                              </tr>

                              {pk.lastError && (
                                <tr className="bg-amber-50/40">
                                  <td colSpan={6} className="px-5 py-2 text-[11px] text-amber-800 font-mono flex items-center gap-2">
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                    <span className="truncate">{pk.lastError}</span>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 2: SYNCED LIVE MODELS */}
          {adminSection === 'models' && (
            <div className="bg-white rounded-xl border border-zinc-200/80 shadow-xs overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-zinc-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-zinc-900">
                    Real-Time Synced Models ({models.length})
                  </h2>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    These exact models are automatically mirrored to the User Panel, Playground, and <code className="font-mono">GET /v1/models</code>
                  </p>
                </div>

                <div className="relative w-full sm:w-72">
                  <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Filter synced model ID..."
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-zinc-200 focus:border-violet-600 outline-none"
                  />
                </div>
              </div>

              {filteredModels.length === 0 ? (
                <div className="py-16 text-center px-4">
                  <Layers className="w-8 h-8 text-zinc-300 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-zinc-700">No live models discovered</p>
                  <p className="text-xs text-zinc-500 mt-1">
                    Add a valid provider API key in the Master Key Pool to populate live upstream models.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-zinc-100 bg-zinc-50/70 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                        <th className="py-3 px-5">Model ID</th>
                        <th className="py-3 px-5">Provider</th>
                        <th className="py-3 px-5">Owner Pool Key</th>
                        <th className="py-3 px-5">Synced To User Panel</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {filteredModels.map((m) => (
                        <tr key={m.id} className="hover:bg-zinc-50/70">
                          <td className="py-3 px-5 font-mono font-semibold text-zinc-900">{m.id}</td>
                          <td className="py-3 px-5">
                            <div className="inline-flex items-center gap-1.5">
                              <ProviderLogo provider={m.provider} size={14} />
                              <span className="uppercase font-semibold text-[11px] text-zinc-700">
                                {m.provider}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-5 font-mono text-zinc-500">
                            {m.ownerKeyHint || 'Pool Auto'}
                          </td>
                          <td className="py-3 px-5">
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/70 px-2 py-0.5 rounded-full">
                              <CheckCircle2 className="w-3 h-3" />
                              Live &amp; Active
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* SECTION 3: GATEWAY TRAFFIC LOGS */}
          {adminSection === 'logs' && (
            <div className="bg-white rounded-xl border border-zinc-200/80 shadow-xs overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-zinc-100">
                <h2 className="text-base font-semibold text-zinc-900">Recent Gateway Requests</h2>
                <p className="text-xs text-zinc-500 mt-0.5">Live routing telemetry from /v1/chat/completions</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-zinc-100 bg-zinc-50/70 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                      <th className="py-3 px-5">Time</th>
                      <th className="py-3 px-5">Model</th>
                      <th className="py-3 px-5">Provider</th>
                      <th className="py-3 px-5">Tokens</th>
                      <th className="py-3 px-5">Latency</th>
                      <th className="py-3 px-5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 font-mono">
                    {logs.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-zinc-400 font-sans">
                          No gateway requests recorded yet.
                        </td>
                      </tr>
                    ) : (
                      logs.slice(0, 50).map((log) => (
                        <tr key={log.id} className="hover:bg-zinc-50/70">
                          <td className="py-3 px-5 text-zinc-500">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </td>
                          <td className="py-3 px-5 font-semibold text-zinc-900">{log.model}</td>
                          <td className="py-3 px-5 uppercase text-zinc-600">{log.provider}</td>
                          <td className="py-3 px-5 text-zinc-700">{log.totalTokens}</td>
                          <td className="py-3 px-5 text-violet-700">{log.latencyMs}ms</td>
                          <td className="py-3 px-5 text-emerald-600 font-semibold">{log.status}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Bulk Add Provider Keys Modal */}
      {isBulkModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/50 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 border border-zinc-200 shadow-2xl relative">
            <button
              onClick={() => setIsBulkModalOpen(false)}
              className="absolute top-5 right-5 text-zinc-400 hover:text-zinc-600 p-1 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <form onSubmit={handleBulkSubmit}>
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-9 h-9 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center">
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-base font-semibold text-zinc-900">
                    Add Provider Keys &amp; Auto-Discover Models
                  </h4>
                  <p className="text-xs text-zinc-500">
                    Fetches live models directly from upstream and syncs to User Panel
                  </p>
                </div>
              </div>

              <div className="space-y-4 mt-5">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                    Provider Type
                  </label>
                  <select
                    value={selectedProvider}
                    onChange={(e) => {
                      const next = e.target.value;
                      setSelectedProvider(next);
                      if (next === 'inception' && !customBaseUrl) {
                        setCustomBaseUrl('https://api.inceptionlabs.ai/v1');
                      } else if (next !== 'custom' && next !== 'inception') {
                        setCustomBaseUrl('');
                      }
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-xs font-medium bg-white focus:border-violet-600 outline-none text-zinc-700"
                  >
                    <option value="auto">Auto-Detect by Key Prefix (gsk_, sk-, AIzaSy...)</option>
                    <option value="inception">Inception Labs (Mercury)</option>
                    <option value="groq">Groq (gsk_...)</option>
                    <option value="openai">OpenAI (sk-...)</option>
                    <option value="gemini">Google Gemini (AIzaSy...)</option>
                    <option value="openrouter">OpenRouter (sk-or-...)</option>
                    <option value="deepseek">DeepSeek (sk-...)</option>
                    <option value="mistral">Mistral</option>
                    <option value="cerebras">Cerebras (csk-...)</option>
                    <option value="anthropic">Anthropic (sk-ant-...)</option>
                    <option value="custom">Custom OpenAI-Compatible Endpoint</option>
                  </select>
                </div>

                {(selectedProvider === 'custom' || selectedProvider === 'inception') && (
                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                      Provider Base URL (for /models discovery &amp; routing)
                    </label>
                    <input
                      type="url"
                      value={customBaseUrl}
                      onChange={(e) => setCustomBaseUrl(e.target.value)}
                      placeholder="https://api.inceptionlabs.ai/v1"
                      className="w-full px-3 py-2 font-mono text-xs rounded-lg border border-zinc-200 focus:border-violet-600 outline-none"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1.5 flex items-center justify-between">
                    <span>API Keys (One per line)</span>
                    <span className="text-[11px] text-violet-700 font-mono">Appends line-by-line</span>
                  </label>
                  <textarea
                    rows={6}
                    required
                    value={bulkKeysText}
                    onChange={(e) => setBulkKeysText(e.target.value)}
                    placeholder={`Paste provider API keys here (one per line)...`}
                    className="w-full p-3 font-mono text-xs rounded-lg border border-zinc-200 focus:border-violet-600 outline-none"
                  />
                </div>
              </div>

              <div className="mt-6 flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsBulkModalOpen(false)}
                  className="flex-1 px-4 py-2 rounded-lg border border-zinc-200 text-zinc-700 font-medium text-xs hover:bg-zinc-50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !bulkKeysText.trim()}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-medium text-xs shadow-xs transition-colors cursor-pointer"
                >
                  {isSubmitting ? 'Discovering Live Models...' : 'Add & Sync Live Models'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
