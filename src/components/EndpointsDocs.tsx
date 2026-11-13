import React, { useState } from 'react';
import { Terminal, Copy, Check, Code2, Globe, FileCode, CheckCircle2, ChevronRight } from 'lucide-react';
import { useToast } from './Toast';
import { GatewayModel } from '../types/gateway';

interface EndpointsDocsProps {
  userApiKey?: string;
  models?: GatewayModel[];
}

export const EndpointsDocs: React.FC<EndpointsDocsProps> = ({ userApiKey, models = [] }) => {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'curl' | 'python' | 'node' | 'langchain'>('curl');
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://freeaimodel.vercel.app';
  const chatEndpoint = `${currentOrigin}/v1/chat/completions`;
  const modelsEndpoint = `${currentOrigin}/v1/models`;
  const keyPlaceholder = userApiKey || 'sk-gateway-your_api_key_here';
  const dynamicModel = models[0]?.id || 'YOUR_ACTIVE_MODEL_ID';

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(id);
    showToast('Copied', 'Snippet copied to clipboard.', 'success');
    setTimeout(() => setCopiedSection(null), 2500);
  };

  const curlSnippet = `curl -X POST "${chatEndpoint}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${keyPlaceholder}" \\
  -d '{
    "model": "${dynamicModel}",
    "messages": [
      {
        "role": "user",
        "content": "Explain quantum computing in two sentences."
      }
    ],
    "temperature": 0.7,
    "stream": false
  }'`;

  const pythonSnippet = `import os
from openai import OpenAI

# Drop-in replacement for OpenAI SDK:
client = OpenAI(
    base_url="${currentOrigin}/v1",
    api_key="${keyPlaceholder}"
)

response = client.chat.completions.create(
    model="${dynamicModel}",
    messages=[
        {"role": "system", "content": "You are a helpful AI assistant."},
        {"role": "user", "content": "Explain quantum computing in two sentences."}
    ],
    temperature=0.7
)

print(response.choices[0].message.content)
print(f"Provider routed: {response.gateway_meta['provider_used']}")`;

  const nodeSnippet = `import OpenAI from 'openai';

// Direct OpenAI Node SDK drop-in:
const client = new OpenAI({
  baseURL: '${currentOrigin}/v1',
  apiKey: '${keyPlaceholder}',
});

async function main() {
  const stream = await client.chat.completions.create({
    model: '${dynamicModel}',
    messages: [{ role: 'user', content: 'Explain quantum computing in two sentences.' }],
    stream: true,
  });

  for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta?.content || '');
  }
}

main();`;

  const langchainSnippet = `from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    base_url="${currentOrigin}/v1",
    api_key="${keyPlaceholder}",
    model="${dynamicModel}",
    temperature=0.7
)

response = llm.invoke("What are the advantages of an API gateway?")
print(response.content)`;

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 mb-8">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center text-violet-600">
              <Globe className="w-4 h-4" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Unified Gateway Endpoints & Integration</h3>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Universal OpenAI-compatible API base URL with standard Bearer authorization
          </p>
        </div>
      </div>

      {/* Endpoint Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-6">
        {/* Chat Endpoint */}
        <div className="bg-slate-50/80 rounded-xl p-4 border border-slate-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Chat Completions Endpoint
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-violet-100 text-violet-700">
              POST
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 bg-white px-3 py-2 rounded-lg border border-slate-200 text-xs font-mono text-slate-800">
            <span className="truncate select-all">{chatEndpoint}</span>
            <button
              onClick={() => handleCopy('endpoint-chat', chatEndpoint)}
              className="text-slate-400 hover:text-violet-600 transition-colors p-1"
              title="Copy endpoint"
            >
              {copiedSection === 'endpoint-chat' ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>

        {/* Models Endpoint */}
        <div className="bg-slate-50/80 rounded-xl p-4 border border-slate-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Models Catalog Endpoint
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">
              GET
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 bg-white px-3 py-2 rounded-lg border border-slate-200 text-xs font-mono text-slate-800">
            <span className="truncate select-all">{modelsEndpoint}</span>
            <button
              onClick={() => handleCopy('endpoint-models', modelsEndpoint)}
              className="text-slate-400 hover:text-violet-600 transition-colors p-1"
              title="Copy endpoint"
            >
              {copiedSection === 'endpoint-models' ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Code Snippets Section */}
      <div className="rounded-xl border border-slate-200 overflow-hidden bg-slate-900 text-white">
        {/* Header Tabs */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-800/90 border-b border-slate-700">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab('curl')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'curl'
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              cURL
            </button>
            <button
              onClick={() => setActiveTab('python')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'python'
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Python (OpenAI)
            </button>
            <button
              onClick={() => setActiveTab('node')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'node'
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Node.js / TS
            </button>
            <button
              onClick={() => setActiveTab('langchain')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'langchain'
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              LangChain
            </button>
          </div>

          <button
            onClick={() => {
              const code =
                activeTab === 'curl'
                  ? curlSnippet
                  : activeTab === 'python'
                  ? pythonSnippet
                  : activeTab === 'node'
                  ? nodeSnippet
                  : langchainSnippet;
              handleCopy(`code-${activeTab}`, code);
            }}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-700/80 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
          >
            {copiedSection === `code-${activeTab}` ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Code</span>
              </>
            )}
          </button>
        </div>

        {/* Code View */}
        <pre className="p-4 text-xs font-mono overflow-x-auto leading-relaxed text-slate-300">
          <code>
            {activeTab === 'curl' && curlSnippet}
            {activeTab === 'python' && pythonSnippet}
            {activeTab === 'node' && nodeSnippet}
            {activeTab === 'langchain' && langchainSnippet}
          </code>
        </pre>
      </div>

      {/* Highlights */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-slate-600">
        <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <span><strong>Standard Bearer Auth:</strong> Pass your <code className="text-violet-700 font-mono">sk-gateway-...</code> key in headers.</span>
        </div>
        <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <span><strong>OpenAI SDK Drop-in:</strong> Just change <code className="text-violet-700 font-mono">base_url</code> to this domain.</span>
        </div>
        <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <span><strong>SSE Streaming:</strong> Full support for streaming tokens chunk-by-chunk.</span>
        </div>
      </div>
    </div>
  );
};
