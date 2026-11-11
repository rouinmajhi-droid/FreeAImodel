import React, { useState } from 'react';
import { 
  Layers, 
  Search, 
  Sparkles, 
  Terminal, 
  ShieldCheck, 
  Plus, 
  RefreshCw, 
  Key, 
  Check, 
  Copy, 
  X, 
  Cpu, 
  ExternalLink,
  Trash2,
  AlertCircle
} from 'lucide-react';
import { GatewayModel, ProviderKey } from '../types/gateway';
import { ProviderLogo } from './ProviderLogo';

interface ModelsViewProps {
  models: GatewayModel[];
  providerKeys: ProviderKey[];
  onSelectModelForPlayground: (modelId: string) => void;
  onAddKeyAndFetchModels: (keysText: string, provider: string) => Promise<{ addedCount: number; modelsCount: number }>;
  onRefreshModels: () => Promise<void>;
  onDeleteKey?: (keyId: string) => void;
}

export const ModelsView: React.FC<ModelsViewProps> = ({
  models,
  providerKeys = [],
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

    setIsSubmitting(true);
    setAddResult(null);

    try {
      const res = await onAddKeyAndFetchModels(inputKeys, selectedProvider);
      setAddResult({
        message: `Success! Added ${res.addedCount} key(s) and discovered ${res.modelsCount} model(s) automatically.`,
        isError: false
      });
      setInputKeys('');
      setTimeout(() => {
        setIsAddModalOpen(false);
        setAddResult(null);
      }, 1800);
    } catch (err: any) {
      setAddResult({
        message: err.message || 'Failed to auto-discover models from provided key(s). Please verify key validity.',
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

  // Calculate provider branding color
  const getProviderBadgeStyle = (provider: string) => {
    switch (provider.toLowerCase()) {
      case 'groq':
        return 'bg-amber-50 text-amber-800 border-amber-200';
      case 'openai':
        return 'bg-emerald-50 text-emerald-800 border-emerald-200';
      case 'gemini':
        return 'bg-violet-50 text-violet-800 border-violet-200';
      case 'openrouter':
        return 'bg-purple-50 text-purple-800 border-purple-200';
      case 'deepseek':
        return 'bg-sky-50 text-sky-800 border-sky-200';
      case 'mistral':
        return 'bg-orange-50 text-orange-800 border-orange-200';
      case 'cerebras':
        return 'bg-rose-50 text-rose-800 border-rose-200';
      default:
        return 'bg-zinc-100 text-zinc-700 border-zinc-200';
    }
  };

  // Find which keys provide a given model
  const getKeysForModel = (modelId: string) => {
    return providerKeys.filter(pk => 
      pk.supportedModels && pk.supportedModels.includes(modelId)
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* 1. Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-zinc-900 tracking-tight">Models & Dynamic Discovery</h1>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
              Live Gateway
            </span>
          </div>
          <p className="text-sm text-zinc-600 mt-1 max-w-2xl">
            Automatically discover, catalog, and route to all available models from every API key you connect. Requests fail over across keys seamlessly.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
            title="Re-query /v1/models across all connected keys"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-violet-600' : 'text-zinc-500'}`} />
            <span>{isRefreshing ? 'Syncing...' : 'Sync Models'}</span>
          </button>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-lg shadow-sm transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Key & Fetch Models</span>
          </button>
        </div>
      </div>

      {/* 2. Connected Key Sources Bar */}
      <div className="bg-white border border-zinc-200/80 rounded-xl p-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-zinc-100">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-violet-600" />
            <span className="text-xs font-semibold text-zinc-900 uppercase tracking-wider">
              Connected API Key Sources ({providerKeys.length})
            </span>
            <span className="text-[11px] text-zinc-400">
              — Each key automatically queries upstream /v1/models
            </span>
          </div>

          {selectedKeyFilter && (
            <button
              onClick={() => setSelectedKeyFilter(null)}
              className="text-[11px] font-medium text-violet-600 hover:text-violet-800 flex items-center gap-1 cursor-pointer"
            >
              <X className="w-3 h-3" />
              <span>Clear Key Filter</span>
            </button>
          )}
        </div>

        {providerKeys.length === 0 ? (
          <div className="py-4 text-center">
            <p className="text-xs text-zinc-500">
              No custom provider keys connected yet. Add a Groq, OpenAI, Gemini, or OpenRouter key to unlock your models.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 pt-3">
            {providerKeys.map((pk) => {
              const isSelected = selectedKeyFilter === pk.id;
              const modelCount = pk.supportedModels?.length || 0;

              return (
                <div
                  key={pk.id}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs transition-all ${
                    isSelected
                      ? 'bg-violet-50 border-violet-400 text-violet-900 shadow-xs'
                      : 'bg-zinc-50 border-zinc-200/80 text-zinc-700 hover:border-zinc-300'
                  }`}
                >
                  <button
                    onClick={() => setSelectedKeyFilter(isSelected ? null : pk.id)}
                    className="flex items-center gap-2 cursor-pointer text-left"
                    title={`Click to filter models provided by ${pk.keyHint}`}
                  >
                    <ProviderLogo provider={pk.provider} size={14} />
                    <span className="font-semibold uppercase text-[10px] px-1.5 py-0.5 rounded bg-white border border-zinc-200 text-zinc-800">
                      {pk.provider}
                    </span>
                    <span className="font-mono text-[11px] font-medium">{pk.keyHint}</span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded-full bg-violet-100 text-violet-700">
                      {modelCount} {modelCount === 1 ? 'model' : 'models'}
                    </span>
                  </button>

                  {onDeleteKey && (
                    <button
                      onClick={() => onDeleteKey(pk.id)}
                      className="text-zinc-400 hover:text-rose-600 ml-1 p-0.5 rounded transition-colors cursor-pointer"
                      title="Remove key"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-zinc-200/80 shadow-xs">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search models by name or ID (e.g. llama-3.3, gpt-4o, gemini-2.0)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs rounded-lg border border-zinc-200 focus:border-violet-600 outline-none"
          />
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-500 font-medium">
            Showing <strong className="text-zinc-900">{filtered.length}</strong> of {models.length} models
          </span>

          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="px-3 py-2 text-xs rounded-lg border border-zinc-200 bg-white outline-none focus:border-violet-600 font-medium text-zinc-700 cursor-pointer"
          >
            <option value="all">All Providers</option>
            <option value="groq">Groq</option>
            <option value="openai">OpenAI</option>
            <option value="gemini">Google Gemini</option>
            <option value="openrouter">OpenRouter</option>
            <option value="deepseek">DeepSeek</option>
            <option value="mistral">Mistral</option>
            <option value="cerebras">Cerebras</option>
          </select>
        </div>
      </div>

      {/* 4. Models Grid */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-zinc-200/80 p-12 text-center shadow-xs">
          <div className="w-12 h-12 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center mx-auto mb-3">
            <Layers className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-zinc-900">No models match your filter</h3>
          <p className="text-xs text-zinc-500 max-w-md mx-auto mt-1 mb-4">
            Try adjusting your search criteria or add new API keys to auto-discover models from upstream providers.
          </p>
          <button
            onClick={() => {
              setSearch('');
              setProviderFilter('all');
              setSelectedKeyFilter(null);
            }}
            className="px-4 py-2 text-xs font-semibold text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors cursor-pointer"
          >
            Reset All Filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((m) => {
            const contributingKeys = getKeysForModel(m.id);
            const isCopied = copiedModelId === m.id;

            return (
              <div
                key={m.id}
                className="bg-white rounded-xl border border-zinc-200/80 p-5 shadow-xs hover:border-violet-300 transition-all flex flex-col justify-between group"
              >
                <div>
                  {/* Top: Dynamic Provider Logo + Model Name + Provider Badge */}
                  <div className="flex items-start justify-between gap-2 mb-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-zinc-50 border border-zinc-200/80 flex items-center justify-center shrink-0 shadow-2xs group-hover:border-violet-300 transition-colors">
                        <ProviderLogo provider={m.provider} size={18} />
                      </div>
                      <span className="font-semibold text-sm text-zinc-900 group-hover:text-violet-700 transition-colors leading-snug truncate">
                        {m.name || m.id}
                      </span>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border shrink-0 ${getProviderBadgeStyle(m.provider)}`}>
                      {m.provider}
                    </span>
                  </div>

                  {/* Model ID Code with Copy */}
                  <div className="flex items-center justify-between gap-2 bg-zinc-50 px-2.5 py-1.5 rounded-lg border border-zinc-100 mb-3 group/code">
                    <code className="text-[11px] text-zinc-600 font-mono select-all truncate">
                      {m.id}
                    </code>
                    <button
                      onClick={() => handleCopy(m.id)}
                      className="text-zinc-400 hover:text-zinc-700 p-1 rounded transition-colors shrink-0 cursor-pointer"
                      title="Copy Model ID"
                    >
                      {isCopied ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  {/* Spec Row */}
                  <div className="grid grid-cols-2 gap-2 text-xs text-zinc-600 py-3 border-t border-zinc-100">
                    <div>
                      <span className="text-[10px] text-zinc-400 block uppercase font-medium">Context Window</span>
                      <span className="font-medium text-zinc-800">
                        {m.contextWindow ? `${(m.contextWindow / 1000).toFixed(0)}k tokens` : '128k tokens'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-zinc-400 block uppercase font-medium">Auto-Failover</span>
                      <span className="font-medium text-emerald-600 flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        Active Pool
                      </span>
                    </div>
                  </div>

                  {/* Key Source Tag */}
                  <div className="pt-2 text-[11px] text-zinc-500 border-t border-zinc-100">
                    {contributingKeys.length > 0 ? (
                      <span className="inline-flex items-center gap-1 text-violet-700 bg-violet-50 px-2 py-0.5 rounded font-mono text-[10px]">
                        <Key className="w-3 h-3" />
                        Discovered via {contributingKeys.map(k => k.keyHint).join(', ')}
                      </span>
                    ) : (
                      <span className="text-[10px] text-zinc-400">
                        Auto-routed via {m.provider.toUpperCase()} Provider Pool
                      </span>
                    )}
                  </div>
                </div>

                {/* Bottom Playground Action */}
                <button
                  onClick={() => onSelectModelForPlayground(m.id)}
                  className="mt-4 w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border border-zinc-200 text-zinc-700 hover:bg-violet-50 hover:text-violet-700 hover:border-violet-300 text-xs font-semibold transition-colors cursor-pointer"
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>Test in Playground</span>
                </button>
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
                  <h3 className="text-base font-semibold text-zinc-900">Add API Key & Auto-Discover Models</h3>
                  <p className="text-xs text-zinc-500">Instantly query upstream provider /v1/models and populate your catalog</p>
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
                  onChange={(e) => setSelectedProvider(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-200 bg-white outline-none focus:border-violet-600 font-medium text-zinc-800"
                >
                  <option value="auto">Auto-Detect by Key Prefix (Recommended)</option>
                  <option value="groq">Groq (keys start with gsk_)</option>
                  <option value="openai">OpenAI (keys start with sk-...)</option>
                  <option value="gemini">Google Gemini (keys start with AIzaSy...)</option>
                  <option value="openrouter">OpenRouter (keys start with sk-or-...)</option>
                  <option value="deepseek">DeepSeek (keys start with sk-...)</option>
                  <option value="mistral">Mistral (32-character token)</option>
                  <option value="cerebras">Cerebras (keys start with csk-...)</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-zinc-700">
                    API Keys (Bulk Paste Supported)
                  </label>
                  <span className="text-[11px] text-zinc-400">One key per line</span>
                </div>
                <textarea
                  rows={5}
                  value={inputKeys}
                  onChange={(e) => setInputKeys(e.target.value)}
                  placeholder={`Paste one or multiple keys:\ngsk_sample_groq_key_9201a...\nsk-proj-sample_openai_key_84bc...\nAIzaSySampleGeminiKey_47xz...`}
                  className="w-full p-3 font-mono text-xs rounded-xl border border-zinc-200 focus:border-violet-600 outline-none resize-none bg-zinc-50"
                  required
                />
              </div>

              <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-100 text-[11px] text-zinc-500 space-y-1">
                <p className="font-semibold text-zinc-700 flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-violet-600" />
                  How Auto-Discovery Works:
                </p>
                <p>
                  FreeAIModel will immediately ping the provider's official <code>/v1/models</code> endpoint using the provided key(s). Any active model IDs returned will be added to your live model catalog and wired into dynamic 429 rotation.
                </p>
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
                      <span>Discover & Add Models</span>
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
