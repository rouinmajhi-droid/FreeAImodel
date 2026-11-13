import React, { useState } from 'react';
import { 
  ShieldCheck, 
  Key, 
  Plus, 
  RefreshCw, 
  CheckCircle2, 
  Trash2, 
  Zap, 
  Layers, 
  X, 
  Lock,
  Search,
  Check,
  AlertCircle
} from 'lucide-react';
import { ProviderKey, GatewayModel, RequestLog } from '../types/gateway';
import { useToast } from './Toast';
import { ProviderLogo } from './ProviderLogo';

interface AdminPanelProps {
  userEmail?: string | null;
  isAdmin: boolean;
  providerKeys: ProviderKey[];
  models: GatewayModel[];
  logs: RequestLog[];
  onAddBulkKeys: (keysText: string, provider: string, customBaseUrl?: string) => Promise<{ addedCount: number; modelsCount: number }>;
  onToggleKeyStatus: (keyId: string, currentStatus: string) => Promise<void>;
  onDeleteProviderKey: (keyId: string) => Promise<void>;
  onResetCooldowns: () => void;
  onRefreshModels: () => Promise<void>;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  userEmail,
  isAdmin,
  providerKeys,
  models,
  logs,
  onAddBulkKeys,
  onToggleKeyStatus,
  onDeleteProviderKey,
  onResetCooldowns,
  onRefreshModels,
}) => {
  const { showToast } = useToast();
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkKeysText, setBulkKeysText] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<string>('auto');
  const [customBaseUrl, setCustomBaseUrl] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [testedKeyId, setTestedKeyId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; latency?: number; success: boolean; msg?: string } | null>(null);

  // Filters
  const [filterProvider, setFilterProvider] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  // Unauthorized view
  if (!isAdmin) {
    return (
      <div className="bg-white rounded-xl border border-zinc-200/80 shadow-xs p-8 max-w-xl mx-auto my-12 text-center animate-in fade-in">
        <div className="w-12 h-12 rounded-xl bg-zinc-100 text-zinc-500 flex items-center justify-center mx-auto mb-4">
          <Lock className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-semibold text-zinc-900">Restricted Admin Area</h2>
        <p className="text-sm text-zinc-500 mt-2 max-w-sm mx-auto">
          The Master Key Pool and dynamic routing configurations are restricted to designated administrator accounts.
        </p>

        <div className="mt-5 p-3 bg-zinc-50 rounded-lg border border-zinc-200/60 text-xs font-mono text-zinc-600 max-w-sm mx-auto">
          Current Account: <strong className="text-zinc-900">{userEmail || 'Not Authenticated'}</strong>
        </div>

        <p className="text-xs text-zinc-400 mt-3">
          Designated Administrator: <code className="text-violet-700 font-semibold">Rouinmajhi@gmail.com</code>
        </p>
      </div>
    );
  }

  // Handle Bulk Add Submit
  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkKeysText.trim()) return;

    setIsSubmitting(true);
    try {
      const res = await onAddBulkKeys(bulkKeysText, selectedProvider, customBaseUrl.trim() || undefined);
      setBulkKeysText('');
      setCustomBaseUrl('');
      setIsBulkModalOpen(false);
      showToast(
        'Keys Ingested',
        `Added ${res.addedCount} keys to Master Pool. Auto-discovered ${res.modelsCount} models.`,
        'success'
      );
    } catch (err: any) {
      showToast('Ingestion Error', err.message || 'Failed to add keys.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Test single key via backend
  const handleTestKey = async (pk: ProviderKey) => {
    setTestedKeyId(pk.id);
    setTestResult(null);

    try {
      const res = await fetch('/api/admin/test-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: pk.provider, key: pk.key, customBaseUrl: pk.customBaseUrl })
      });
      const data = await res.json();
      if (data.success) {
        setTestResult({ id: pk.id, latency: data.latencyMs, success: true });
        showToast('Key Healthy', `${pk.keyHint} reached ${pk.provider} in ${data.latencyMs}ms.`, 'success');
      } else {
        setTestResult({ id: pk.id, success: false, msg: data.error });
        showToast('Key Failed', data.error || 'Failed upstream ping', 'error');
      }
    } catch (err: any) {
      setTestResult({ id: pk.id, success: false, msg: err.message });
      showToast('Key Check Error', err.message, 'error');
    } finally {
      setTestedKeyId(null);
    }
  };

  const filteredKeys = providerKeys.filter((k) => {
    if (filterProvider !== 'all' && k.provider !== filterProvider) return false;
    if (filterStatus !== 'all' && k.status !== filterStatus) return false;
    return true;
  });

  const activeCount = providerKeys.filter((k) => k.status === 'active').length;
  const rateLimitedCount = providerKeys.filter((k) => k.status === 'rate_limited').length;

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* 1. Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-zinc-900 tracking-tight">Master Key Pool Administration</h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-100 text-violet-700">
              Admin Only
            </span>
          </div>
          <p className="text-sm text-zinc-600 mt-1">
            Bulk-add provider keys and manage automatic model failover pools across Groq, OpenAI, Gemini, and OpenRouter.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsBulkModalOpen(true)}
            className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg font-medium text-xs shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Provider Keys (Bulk)</span>
          </button>
          <button
            onClick={onResetCooldowns}
            className="inline-flex items-center gap-1.5 border border-zinc-200 hover:bg-zinc-50 text-zinc-700 px-3 py-2 rounded-lg font-medium text-xs transition-colors cursor-pointer"
            title="Reset 429 Cooldowns"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Clear 429 Cooldowns</span>
          </button>
        </div>
      </div>

      {/* 2. Key Pool Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-zinc-200/80 p-4 shadow-xs">
          <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block">Total Pool Keys</span>
          <span className="text-2xl font-bold text-zinc-900 mt-1 block font-mono">{providerKeys.length}</span>
        </div>
        <div className="bg-white rounded-xl border border-zinc-200/80 p-4 shadow-xs">
          <span className="text-[11px] font-semibold text-emerald-600 uppercase tracking-wider block">Active & Ready</span>
          <span className="text-2xl font-bold text-emerald-600 mt-1 block font-mono">{activeCount}</span>
        </div>
        <div className="bg-white rounded-xl border border-zinc-200/80 p-4 shadow-xs">
          <span className="text-[11px] font-semibold text-amber-600 uppercase tracking-wider block">In 429 Cooldown</span>
          <span className="text-2xl font-bold text-amber-600 mt-1 block font-mono">{rateLimitedCount}</span>
        </div>
        <div className="bg-white rounded-xl border border-zinc-200/80 p-4 shadow-xs">
          <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block">Discovered Models</span>
          <span className="text-2xl font-bold text-zinc-900 mt-1 block font-mono">{models.length}</span>
        </div>
      </div>

      {/* 3. Discovered Models Bar */}
      <div className="bg-white rounded-xl border border-zinc-200/80 p-5 shadow-xs">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">Auto-Discovered Models</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Discovered dynamically by querying upstream <code className="font-mono text-violet-700">/v1/models</code></p>
          </div>
          <button
            onClick={onRefreshModels}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-zinc-200 text-zinc-600 hover:text-zinc-900 text-xs font-medium cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Re-sync</span>
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {models.map((m) => (
            <span
              key={m.id}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-100 text-zinc-800 text-xs font-mono font-medium"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-violet-600" />
              <span>{m.id}</span>
              <span className="text-[9px] uppercase font-bold text-zinc-400">{m.provider}</span>
            </span>
          ))}
        </div>
      </div>

      {/* 4. Master Pool Table */}
      <div className="bg-white rounded-xl border border-zinc-200/80 shadow-xs overflow-hidden">
        {/* Table Filters */}
        <div className="p-4 sm:p-5 border-b border-zinc-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">Upstream Master Key Pool</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Sequential rotation queue with auto 429 health detection</p>
          </div>

          <div className="flex items-center gap-2">
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
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50/60 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                <th className="py-3 px-5">Provider</th>
                <th className="py-3 px-5">Key Hint</th>
                <th className="py-3 px-5">Status</th>
                <th className="py-3 px-5">Models</th>
                <th className="py-3 px-5">Calls / Errors</th>
                <th className="py-3 px-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 text-zinc-700">
              {filteredKeys.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-zinc-400 text-xs">
                    No keys in the pool matching your filter.
                  </td>
                </tr>
              ) : (
                filteredKeys.map((pk) => {
                  const isTested = testedKeyId === pk.id;
                  const res = testResult?.id === pk.id ? testResult : null;

                  return (
                    <tr key={pk.id} className="hover:bg-zinc-50/70 transition-colors">
                      <td className="py-3 px-5">
                        <div className="flex items-center gap-2">
                          <ProviderLogo provider={pk.provider} size={15} />
                          <div>
                            <span className="font-semibold text-zinc-900 uppercase text-[11px] bg-zinc-100 px-2 py-0.5 rounded">
                              {pk.provider}
                            </span>
                            {pk.customBaseUrl && (
                              <span className="block text-[10px] font-mono text-zinc-400 mt-0.5 truncate max-w-[160px]">
                                {pk.customBaseUrl}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-5 font-mono text-zinc-800">
                        {pk.keyHint}
                      </td>

                      <td className="py-3 px-5">
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

                      <td className="py-3 px-5 font-medium text-violet-700">
                        {pk.supportedModels?.length || 0} models
                      </td>

                      <td className="py-3 px-5 font-mono">
                        <span>{pk.requestCount || 0} calls</span>
                        <span className="text-zinc-300 mx-1.5">•</span>
                        <span className={pk.errorCount && pk.errorCount > 0 ? 'text-amber-600 font-bold' : 'text-zinc-400'}>
                          {pk.errorCount || 0} errs
                        </span>
                      </td>

                      <td className="py-3 px-5 text-right">
                        <div className="inline-flex items-center gap-2 justify-end">
                          <button
                            onClick={() => handleTestKey(pk)}
                            disabled={isTested}
                            className="px-2 py-1 rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-xs font-medium cursor-pointer"
                          >
                            {isTested ? 'Ping...' : res ? `${res.latency}ms` : 'Ping'}
                          </button>

                          <button
                            onClick={() => onToggleKeyStatus(pk.id, pk.status)}
                            className="px-2 py-1 rounded text-xs font-medium text-zinc-600 hover:bg-zinc-100 cursor-pointer"
                          >
                            {pk.status === 'disabled' ? 'Enable' : 'Disable'}
                          </button>

                          <button
                            onClick={() => onDeleteProviderKey(pk.id)}
                            className="text-zinc-400 hover:text-rose-600 p-1 rounded hover:bg-rose-50 cursor-pointer"
                            title="Remove from pool"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bulk Add Provider Keys Modal */}
      {isBulkModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 border border-zinc-200 shadow-xl relative">
            <button
              onClick={() => setIsBulkModalOpen(false)}
              className="absolute top-5 right-5 text-zinc-400 hover:text-zinc-600 p-1"
            >
              <X className="w-5 h-5" />
            </button>

            <form onSubmit={handleBulkSubmit}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-violet-50 text-violet-700 flex items-center justify-center">
                  <Plus className="w-4 h-4" />
                </div>
                <h4 className="text-base font-semibold text-zinc-900">Add Provider Keys (Bulk Ingestion)</h4>
              </div>
              <p className="text-xs text-zinc-500 mb-5">
                Paste batches of API keys. The gateway appends them to the Master Pool and auto-discovers their available models without overwriting existing keys.
              </p>

              <div className="space-y-4">
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
                    <option value="auto">✨ Auto-Detect by Prefix (gsk_, sk-, AIzaSy...)</option>
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
                      Provider Base URL (for /models discovery & routing)
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
                    placeholder={`gsk_exampleKey1234567890abcdef\ngsk_anotherKey0987654321fedcba\nsk-or-v1-openrouterKey...`}
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
                  {isSubmitting ? 'Ingesting Keys...' : 'Append Keys to Pool'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
