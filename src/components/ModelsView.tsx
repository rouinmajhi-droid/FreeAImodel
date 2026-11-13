import React, { useState } from 'react';
import { 
  Search, 
  Sparkles, 
  Terminal, 
  Plus, 
  RefreshCw, 
  Check, 
  Copy, 
  X, 
  AlertCircle,
  Key,
  Layers
} from 'lucide-react';
import { GatewayModel, ProviderKey } from '../types/gateway';
import { ProviderLogo } from './ProviderLogo';

interface ModelsViewProps {
  models: GatewayModel[];
  providerKeys: ProviderKey[];
  isAdmin?: boolean;
  onSelectModelForPlayground: (modelId: string) => void;
  onAddKeyAndFetchModels: (keysText: string, provider: string, customBaseUrl?: string) => Promise<{ addedCount: number; modelsCount: number }>;
  onRefreshModels: () => Promise<void>;
  onDeleteKey?: (keyId: string) => void;
}

export const ModelsView: React.FC<ModelsViewProps> = ({
  models,
  providerKeys = [],
  isAdmin = false,
  onSelectModelForPlayground,
  onAddKeyAndFetchModels,
  onRefreshModels,
  onDeleteKey,
}) => {
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState('all');
  const [selectedKeyFilter, setSelectedKeyFilter] = useState<string | null>(null);

  // Add Key Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [inputKeys, setInputKeys] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('auto');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [addResult, setAddResult] = useState<{ message: string; isError?: boolean } | null>(null);

  // Copied model ID state
  const [copiedModelId, setCopiedModelId] = useState<string | null>(null);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedModelId(text);
    setTimeout(() => setCopiedModelId(null), 2000);
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputKeys.trim()) return;

    const lines = inputKeys
      .split(/[\r\n,]+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));

    for (const line of lines) {
      if (line.includes('…') || line.includes('...') || line.includes('•')) {
        setAddResult({
          message: 'Masked key detected, please paste the full raw API key',
          isError: true
        });
        return;
      }
      if (/[^\x21-\x7E]/.test(line)) {
        setAddResult({
          message: 'Invalid non-ASCII characters detected. Please paste the full raw API key.',
          isError: true
        });
        return;
      }
    }

    setIsSubmitting(true);
    setAddResult(null);

    try {
      const res = await onAddKeyAndFetchModels(inputKeys, selectedProvider, customBaseUrl.trim() || undefined);
      setAddResult({
        message: `Success! Added ${res.addedCount} key(s) and discovered ${res.modelsCount} model(s).`,
        isError: false
      });
      setInputKeys('');
      setCustomBaseUrl('');
      setTimeout(() => {
        setIsAddModalOpen(false);
        setAddResult(null);
      }, 1500);
    } catch (err: any) {
      setAddResult({
        message: err.message || 'Failed to auto-discover models from provided key(s).',
        isError: true
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefreshModels();
    } finally {
      setIsRefreshing(false);
    }
  };

  // Filter models based on search, provider dropdown, and clicked key source filter
  const filtered = models.filter((m) => {
    if (providerFilter !== 'all' && m.provider !== providerFilter) return false;
    
    // If filtered by a specific key source
    if (selectedKeyFilter) {
      const activeKeyObj = providerKeys.find(pk => pk.id === selectedKeyFilter || pk.keyHint === selectedKeyFilter);
      if (activeKeyObj && activeKeyObj.supportedModels && activeKeyObj.supportedModels.length > 0) {
        if (!activeKeyObj.supportedModels.includes(m.id)) return false;
      }
    }

    if (search) {
      const query = search.toLowerCase();
      const matchId = m.id.toLowerCase().includes(query);
      const matchName = m.name?.toLowerCase().includes(query);
      const matchProvider = m.provider?.toLowerCase().includes(query);
      if (!matchId && !matchName && !matchProvider) return false;
    }

    return true;
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* 1. Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">Models</h1>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/80">
              {models.length} Free Models Available
            </span>
          </div>
          <p className="text-sm text-zinc-500 mt-1">
            Browse and query AI models with free access via OpenAI-compatible endpoints.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
            title="Sync /v1/models across active provider keys"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-violet-600' : 'text-zinc-500'}`} />
            <span>{isRefreshing ? 'Syncing...' : 'Sync Models'}</span>
          </button>

          {isAdmin && (
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-lg shadow-sm transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add Provider Key</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Connected Key Sources (Admin Only) */}
      {isAdmin && providerKeys.length > 0 && (
        <div className="bg-white border border-zinc-200/80 rounded-xl px-4 py-3 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-violet-600" />
              <span>Connected Sources:</span>
            </span>

            {providerKeys.map((pk) => {
              const isSelected = selectedKeyFilter === pk.id;
              const modelCount = pk.supportedModels?.length || 0;

              return (
                <div
                  key={pk.id}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                    isSelected
                      ? 'bg-violet-50 border-violet-400 text-violet-900 shadow-xs'
                      : 'bg-zinc-50 border-zinc-200/80 text-zinc-700 hover:border-zinc-300'
                  }`}
                >
                  <button
                    onClick={() => setSelectedKeyFilter(isSelected ? null : pk.id)}
                    className="flex items-center gap-1.5 cursor-pointer text-left"
                    title={`Filter by ${pk.keyHint}`}
                  >
                    <ProviderLogo provider={pk.provider} size={13} />
                    <span className="font-mono text-[11px] font-medium">{pk.keyHint}</span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded-full bg-violet-100 text-violet-700">
                      {modelCount}
                    </span>
                  </button>

                  {onDeleteKey && (
                    <button
                      onClick={() => onDeleteKey(pk.id)}
                      className="text-zinc-400 hover:text-rose-600 ml-0.5 p-0.5 rounded transition-colors cursor-pointer"
                      title="Remove key"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {selectedKeyFilter && (
            <button
              onClick={() => setSelectedKeyFilter(null)}
              className="text-xs font-medium text-violet-600 hover:text-violet-800 flex items-center gap-1 shrink-0 cursor-pointer self-start sm:self-auto"
            >
              <X className="w-3.5 h-3.5" />
              <span>Clear Filter</span>
            </button>
          )}
        </div>
      )}

      {/* 3. Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-zinc-200/80 shadow-xs">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search live discovered models by name or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs rounded-lg border border-zinc-200 focus:border-violet-600 outline-none"
          />
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-500 font-medium">
            Showing <strong className="text-zinc-900">{filtered.length}</strong> of {models.length}
          </span>

          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="px-3 py-2 text-xs rounded-lg border border-zinc-200 bg-white outline-none focus:border-violet-600 font-medium text-zinc-700 cursor-pointer"
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
        </div>
      </div>

      {/* 4. Compact Clean Models Grid - Zero Clutter, Vercel/OpenAI style */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-zinc-200/80 p-12 text-center shadow-xs">
          <div className="w-12 h-12 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center mx-auto mb-3">
            <Layers className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-zinc-900">
            {models.length === 0 ? 'No Live Models Discovered Yet' : 'No Matching Models Found'}
          </h3>
          <p className="text-xs text-zinc-500 max-w-md mx-auto mt-1 mb-4">
            {models.length === 0
              ? 'Models appear here automatically as soon as valid upstream provider API keys are synced in the Admin Dashboard.'
              : 'Try clearing your search query or provider filter.'}
          </p>
          {models.length > 0 && (
            <button
              onClick={() => {
                setSearch('');
                setProviderFilter('all');
                setSelectedKeyFilter(null);
              }}
              className="px-4 py-2 text-xs font-semibold text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors cursor-pointer"
            >
              Reset Filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((m) => {
            const isCopied = copiedModelId === m.id;

            return (
              <div
                key={m.id}
                className="bg-white rounded-xl border border-zinc-200/80 p-4 shadow-xs hover:border-violet-300 hover:shadow-sm transition-all flex flex-col justify-between group relative"
              >
                <div>
                  {/* Top Row: Provider Logo + Model Name + Glowing FREE Badge */}
                  <div className="flex items-start justify-between gap-2.5 mb-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-zinc-50 border border-zinc-200/70 flex items-center justify-center shrink-0 group-hover:border-violet-200 transition-colors shadow-2xs">
                        <ProviderLogo provider={m.provider} size={18} />
                      </div>
                      <span className="font-semibold text-sm text-zinc-900 group-hover:text-violet-700 transition-colors leading-snug truncate">
                        {m.name || m.id}
                      </span>
                    </div>

                    {/* Glowing FREE Badge */}
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-emerald-50 text-emerald-700 border border-emerald-300/80 shadow-xs shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      FREE
                    </span>
                  </div>

                  {/* Model ID with 1-Click Copy Icon */}
                  <div className="flex items-center justify-between gap-2 bg-zinc-50 group-hover:bg-zinc-100/70 px-2.5 py-1.5 rounded-lg border border-zinc-100 group-hover:border-zinc-200/80 transition-colors">
                    <code className="text-[11px] text-zinc-600 font-mono select-all truncate">
                      {m.id}
                    </code>
                    <button
                      onClick={() => handleCopy(m.id)}
                      className="text-zinc-400 hover:text-zinc-800 p-1 rounded transition-colors shrink-0 cursor-pointer"
                      title="Copy Model ID"
                    >
                      {isCopied ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Subtle Playground Quick Action */}
                <div className="mt-3 pt-2.5 border-t border-zinc-100 flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
                    {m.provider}
                  </span>
                  <button
                    onClick={() => onSelectModelForPlayground(m.id)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-600 hover:text-violet-800 transition-colors cursor-pointer"
                  >
                    <Terminal className="w-3 h-3" />
                    <span>Playground</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 5. Modal: Add Provider Key & Auto-Discover Models */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl border border-zinc-200/90 shadow-2xl max-w-xl w-full p-6 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-zinc-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-zinc-900">Add Provider Key</h3>
                  <p className="text-xs text-zinc-500">Auto-discover available models from upstream providers</p>
                </div>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-zinc-400 hover:text-zinc-700 p-1.5 rounded-lg hover:bg-zinc-100 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="space-y-4 mt-4">
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  Target Provider
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
                  className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-200 bg-white outline-none focus:border-violet-600 font-medium text-zinc-800"
                >
                  <option value="auto">Auto-Detect by Key Prefix (Recommended)</option>
                  <option value="inception">Inception Labs (Mercury)</option>
                  <option value="groq">Groq (keys start with gsk_)</option>
                  <option value="openai">OpenAI (keys start with sk-...)</option>
                  <option value="gemini">Google Gemini (keys start with AIzaSy...)</option>
                  <option value="openrouter">OpenRouter (keys start with sk-or-...)</option>
                  <option value="deepseek">DeepSeek (keys start with sk-...)</option>
                  <option value="mistral">Mistral (32-character token)</option>
                  <option value="cerebras">Cerebras (keys start with csk-...)</option>
                  <option value="anthropic">Anthropic (keys start with sk-ant-...)</option>
                  <option value="custom">Custom OpenAI-Compatible Endpoint</option>
                </select>
              </div>

              {(selectedProvider === 'custom' || selectedProvider === 'inception') && (
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                    Provider Base URL
                  </label>
                  <input
                    type="url"
                    value={customBaseUrl}
                    onChange={(e) => setCustomBaseUrl(e.target.value)}
                    placeholder="https://api.inceptionlabs.ai/v1"
                    className="w-full px-3 py-2 font-mono text-xs rounded-lg border border-zinc-200 focus:border-violet-600 outline-none bg-zinc-50"
                  />
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-zinc-700">
                    API Keys (Bulk Paste Supported)
                  </label>
                  <span className="text-[11px] text-zinc-400">One key per line</span>
                </div>
                <textarea
                  rows={4}
                  value={inputKeys}
                  onChange={(e) => setInputKeys(e.target.value)}
                  placeholder={`Paste one or multiple keys:\ngsk_sample_groq_key_9201a...\nsk-proj-sample_openai_key_84bc...\nAIzaSySampleGeminiKey_47xz...`}
                  className="w-full p-3 font-mono text-xs rounded-xl border border-zinc-200 focus:border-violet-600 outline-none resize-none bg-zinc-50"
                  required
                />
              </div>

              {addResult && (
                <div className={`p-3 rounded-lg text-xs flex items-start gap-2 ${
                  addResult.isError 
                    ? 'bg-rose-50 text-rose-700 border border-rose-200' 
                    : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                }`}>
                  {addResult.isError ? (
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : (
                    <Check className="w-4 h-4 shrink-0 mt-0.5" />
                  )}
                  <span>{addResult.message}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !inputKeys.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Discovering Models...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Add & Fetch Models</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
