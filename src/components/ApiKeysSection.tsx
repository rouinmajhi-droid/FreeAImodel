import React, { useState } from 'react';
import { 
  Key, 
  Plus, 
  Copy, 
  Check, 
  Eye, 
  EyeOff, 
  Trash2, 
  X,
  AlertTriangle,
  Zap,
  Globe,
  Sparkles
} from 'lucide-react';
import { ApiKey } from '../types/gateway';
import { useToast } from './Toast';

interface ApiKeysSectionProps {
  apiKeys: ApiKey[];
  onCreateKey: (name: string) => Promise<ApiKey>;
  onDeleteKey: (keyId: string) => Promise<void>;
  onSelectForPlayground?: (key: string) => void;
}

export const ApiKeysSection: React.FC<ApiKeysSectionProps> = ({
  apiKeys,
  onCreateKey,
  onDeleteKey,
  onSelectForPlayground,
}) => {
  const { showToast } = useToast();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [unmaskedKeys, setUnmaskedKeys] = useState<Record<string, boolean>>({});
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);
  const [justCreatedKey, setJustCreatedKey] = useState<ApiKey | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Snippet Tab
  const [activeSnippetTab, setActiveSnippetTab] = useState<'curl' | 'python' | 'node'>('curl');
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [useLiveUrl, setUseLiveUrl] = useState(false);

  const toggleMask = (id: string) => {
    setUnmaskedKeys((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKeyId(id);
    showToast('Copied to Clipboard', 'API key copied successfully.', 'success');
    setTimeout(() => setCopiedKeyId(null), 2000);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;

    setIsSubmitting(true);
    try {
      const created = await onCreateKey(newKeyName.trim());
      setJustCreatedKey(created);
      setNewKeyName('');
      showToast('Key Created', 'New API key has been generated.', 'success');
    } catch (err: any) {
      showToast('Creation Failed', err.message || 'Could not create key.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await onDeleteKey(id);
      setDeleteConfirmId(null);
      showToast('API Key Revoked', 'The key has been deleted.', 'info');
    } catch (err: any) {
      showToast('Revoke Failed', err.message || 'Could not delete key.', 'error');
    }
  };

  // Custom Domain Placeholder
  const customDomain = 'https://yourdomain.com';
  const liveOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://yourdomain.com';
  const baseUrl = useLiveUrl ? liveOrigin : customDomain;

  // Seamlessly populate the user's active API key
  const activeKeyToken = justCreatedKey?.key || apiKeys[0]?.key || 'sk-gateway-live-your_token_here';

  const snippets = {
    curl: `curl -X POST "${baseUrl}/v1/chat/completions" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${activeKeyToken}" \\
  -d '{
    "model": "llama-3.3-70b-versatile",
    "messages": [
      { "role": "user", "content": "Hello, FreeAIModel!" }
    ],
    "temperature": 0.7
  }'`,
    python: `from openai import OpenAI

# Direct OpenAI SDK Drop-in
client = OpenAI(
    base_url="${baseUrl}/v1",
    api_key="${activeKeyToken}"
)

completion = client.chat.completions.create(
    model="llama-3.3-70b-versatile",
    messages=[{"role": "user", "content": "Explain quantum computing in one sentence."}]
)

print(completion.choices[0].message.content)`,
    node: `import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: '${baseUrl}/v1',
  apiKey: '${activeKeyToken}',
});

const response = await client.chat.completions.create({
  model: 'llama-3.3-70b-versatile',
  messages: [{ role: 'user', content: 'Explain quantum computing in one sentence.' }],
});

console.log(response.choices[0].message.content);`
  };

  const handleCopySnippet = () => {
    navigator.clipboard.writeText(snippets[activeSnippetTab]);
    setCopiedSnippet(true);
    showToast('Code Copied', 'Integration snippet copied to clipboard.', 'success');
    setTimeout(() => setCopiedSnippet(false), 2000);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* 1. Sleek, Premium Free Credits Banner */}
      <div className="relative overflow-hidden rounded-xl border border-violet-300/80 bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 p-4 sm:p-5 text-white shadow-md shadow-violet-500/15">
        <div className="absolute -top-16 -right-16 w-56 h-56 bg-white/10 rounded-full blur-2xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-white/15 backdrop-blur-sm flex items-center justify-center shrink-0 border border-white/20 text-amber-300">
              <Zap className="w-5 h-5 fill-amber-300" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-sm sm:text-base tracking-tight text-white">
                  ⚡ 50 Billion Free Tokens / 50 Million Free Credits Allocated for Unlimited Developer Testing
                </span>
              </div>
              <p className="text-xs text-violet-100/90 mt-0.5">
                Multi-provider failover active across Groq, OpenAI, Gemini, and OpenRouter with zero 429 downtime.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
            <span className="px-3 py-1 rounded-full bg-white/15 backdrop-blur-sm text-xs font-semibold text-white border border-white/25">
              Active Tier
            </span>
          </div>
        </div>
      </div>

      {/* 2. Header Action Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900 tracking-tight">API Key Management</h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            Create secret tokens to route requests through the unified OpenAI-compatible router.
          </p>
        </div>

        <button
          onClick={() => {
            setJustCreatedKey(null);
            setIsModalOpen(true);
          }}
          className="inline-flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg font-medium text-sm shadow-xs transition-colors cursor-pointer self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Create API Key</span>
        </button>
      </div>

      {/* 3. Keys Table Card */}
      <div className="bg-white rounded-xl border border-zinc-200/80 shadow-xs overflow-hidden">
        {apiKeys.length === 0 ? (
          <div className="py-14 text-center px-4">
            <div className="w-12 h-12 rounded-xl bg-zinc-100 text-zinc-500 flex items-center justify-center mx-auto mb-3">
              <Key className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold text-zinc-900">No API Keys Generated</h3>
            <p className="text-sm text-zinc-500 max-w-sm mx-auto mt-1 mb-5">
              Generate a secret key to authenticate your requests against Groq, OpenAI, Gemini, and OpenRouter models.
            </p>
            <button
              onClick={() => setIsModalOpen(true)}
              className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg font-medium text-xs shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create First Key</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50/60 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                  <th className="py-3 px-5">Name</th>
                  <th className="py-3 px-5">Secret Key</th>
                  <th className="py-3 px-5">Created</th>
                  <th className="py-3 px-5">Last Used</th>
                  <th className="py-3 px-5">Status</th>
                  <th className="py-3 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 text-sm">
                {apiKeys.map((k) => {
                  const isUnmasked = Boolean(unmaskedKeys[k.id]);
                  const isCopied = copiedKeyId === k.id;
                  const maskedValue = `${k.key.slice(0, 11)}••••••••••••••••${k.key.slice(-4)}`;

                  return (
                    <tr key={k.id} className="hover:bg-zinc-50/70 transition-colors">
                      <td className="py-3.5 px-5 font-medium text-zinc-900">
                        <span className="font-semibold">{k.name}</span>
                        <span className="text-[11px] text-zinc-400 font-mono block mt-0.5">{k.id}</span>
                      </td>

                      <td className="py-3.5 px-5">
                        <div className="inline-flex items-center gap-1.5 font-mono text-xs bg-zinc-50 px-2.5 py-1 rounded-md border border-zinc-200 text-zinc-800">
                          <span className="select-all font-mono">
                            {isUnmasked ? k.key : maskedValue}
                          </span>
                          <button
                            onClick={() => toggleMask(k.id)}
                            className="text-zinc-400 hover:text-zinc-700 p-1 cursor-pointer"
                            title={isUnmasked ? 'Mask' : 'Reveal'}
                          >
                            {isUnmasked ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => handleCopy(k.id, k.key)}
                            className="text-zinc-400 hover:text-violet-600 p-1 cursor-pointer"
                            title="Copy Key"
                          >
                            {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </td>

                      <td className="py-3.5 px-5 text-xs text-zinc-500">
                        {new Date(k.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>

                      <td className="py-3.5 px-5 text-xs text-zinc-500">
                        {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never'}
                      </td>

                      <td className="py-3.5 px-5">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            k.status === 'active'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                              : 'bg-zinc-100 text-zinc-600'
                          }`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          <span>Active</span>
                        </span>
                      </td>

                      <td className="py-3.5 px-5 text-right">
                        <div className="inline-flex items-center gap-2 justify-end">
                          {onSelectForPlayground && (
                            <button
                              onClick={() => onSelectForPlayground(k.key)}
                              className="px-2.5 py-1 rounded-md text-xs font-medium text-violet-700 hover:bg-violet-50 transition-colors cursor-pointer"
                            >
                              Test
                            </button>
                          )}
                          <button
                            onClick={() => setDeleteConfirmId(k.id)}
                            className="text-zinc-400 hover:text-rose-600 p-1.5 rounded-md hover:bg-rose-50 transition-colors cursor-pointer"
                            title="Revoke / Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 4. Pristine Clean Code Snippet Box (Clean Light Theme - No Black Box) */}
      <div className="bg-white rounded-xl border border-zinc-200/80 shadow-xs p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-semibold text-zinc-900">cURL & SDK Integration</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              Authenticate requests with standard Bearer authorization headers.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Custom domain toggle indicator */}
            <button
              onClick={() => setUseLiveUrl(!useLiveUrl)}
              className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-800 bg-zinc-100 hover:bg-zinc-200/80 px-2.5 py-1 rounded-md transition-colors cursor-pointer"
              title="Toggle between Custom Domain and Live Origin"
            >
              <Globe className="w-3 h-3 text-violet-600" />
              <span>{useLiveUrl ? 'Using Live Origin' : 'Using yourdomain.com'}</span>
            </button>

            {/* Snippet Tabs */}
            <div className="flex items-center gap-1 bg-zinc-100 p-1 rounded-lg text-xs font-medium">
              <button
                onClick={() => setActiveSnippetTab('curl')}
                className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                  activeSnippetTab === 'curl' ? 'bg-white text-zinc-900 shadow-xs font-semibold' : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                cURL
              </button>
              <button
                onClick={() => setActiveSnippetTab('python')}
                className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                  activeSnippetTab === 'python' ? 'bg-white text-zinc-900 shadow-xs font-semibold' : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                Python
              </button>
              <button
                onClick={() => setActiveSnippetTab('node')}
                className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                  activeSnippetTab === 'node' ? 'bg-white text-zinc-900 shadow-xs font-semibold' : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                Node.js
              </button>
            </div>
          </div>
        </div>

        {/* Crisp Light Editor Box (No Black Box) */}
        <div className="relative bg-zinc-50 rounded-xl p-5 font-mono text-xs overflow-x-auto border border-zinc-200/90 text-zinc-800 shadow-inner">
          <button
            onClick={handleCopySnippet}
            className="absolute top-4 right-4 flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white hover:bg-zinc-100 text-zinc-700 text-xs font-sans transition-colors cursor-pointer border border-zinc-200 shadow-xs"
          >
            {copiedSnippet ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-emerald-700 font-medium">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-zinc-500" />
                <span>Copy Snippet</span>
              </>
            )}
          </button>

          <pre className="pr-24 text-zinc-800 leading-relaxed font-mono">
            <code>{snippets[activeSnippetTab]}</code>
          </pre>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-xl max-w-sm w-full p-6 border border-zinc-200 shadow-xl">
            <div className="w-10 h-10 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center mb-3">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <h4 className="text-base font-semibold text-zinc-900">Revoke API Key?</h4>
            <p className="text-xs text-zinc-500 mt-1 mb-5">
              Any client application using this token will immediately be rejected by the gateway.
            </p>
            <div className="flex gap-2.5">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 px-4 py-2 rounded-lg border border-zinc-200 text-zinc-700 font-medium text-xs hover:bg-zinc-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirmId)}
                className="flex-1 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-medium text-xs transition-colors cursor-pointer"
              >
                Revoke Key
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Key Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-xl max-w-md w-full p-6 border border-zinc-200 shadow-xl relative">
            <button
              onClick={() => {
                setIsModalOpen(false);
                setJustCreatedKey(null);
              }}
              className="absolute top-5 right-5 text-zinc-400 hover:text-zinc-600 p-1"
            >
              <X className="w-5 h-5" />
            </button>

            {!justCreatedKey ? (
              <form onSubmit={handleCreateSubmit}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-violet-50 text-violet-700 flex items-center justify-center">
                    <Key className="w-4 h-4" />
                  </div>
                  <h4 className="text-lg font-semibold text-zinc-900">Create Gateway Key</h4>
                </div>
                <p className="text-xs text-zinc-500 mb-5">
                  Give your key a label to identify which application or service is calling the gateway.
                </p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                      Key Name
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Production Backend, Claude Code, Next.js Webhook"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-lg border border-zinc-300 focus:border-violet-600 focus:ring-1 focus:ring-violet-600 text-sm outline-none transition-all"
                      autoFocus
                    />
                  </div>
                </div>

                <div className="mt-6 flex gap-2.5">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 px-4 py-2 rounded-lg border border-zinc-200 text-zinc-700 font-medium text-xs hover:bg-zinc-50 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || !newKeyName.trim()}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-medium text-xs shadow-xs transition-all cursor-pointer"
                  >
                    {isSubmitting ? 'Generating...' : 'Generate Key'}
                  </button>
                </div>
              </form>
            ) : (
              <div>
                <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3">
                  <Check className="w-5 h-5" />
                </div>
                <h4 className="text-base font-semibold text-zinc-900">API Key Created</h4>
                <p className="text-xs text-zinc-500 mt-1 mb-4">
                  Please copy your secret key now. It is ready for immediate use with any OpenAI SDK client.
                </p>

                <div className="p-3 bg-zinc-50 rounded-lg border border-zinc-200 font-mono text-xs text-zinc-900 break-all select-all flex items-center justify-between gap-2">
                  <span>{justCreatedKey.key}</span>
                  <button
                    onClick={() => handleCopy(justCreatedKey.id, justCreatedKey.key)}
                    className="px-2.5 py-1.5 rounded-md bg-violet-600 hover:bg-violet-700 text-white font-sans text-xs font-semibold shrink-0 transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy</span>
                  </button>
                </div>

                <div className="mt-6 flex justify-end">
                  <button
                    onClick={() => {
                      setIsModalOpen(false);
                      setJustCreatedKey(null);
                    }}
                    className="px-4 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white font-medium text-xs transition-colors cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
