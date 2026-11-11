import React, { useState, useEffect } from 'react';
import { 
  Play, 
  RotateCcw, 
  ShieldCheck, 
  Sliders, 
  Terminal, 
  Copy, 
  Check, 
  Sparkles,
  Zap
} from 'lucide-react';
import { ApiKey, GatewayModel } from '../types/gateway';
import { useToast } from './Toast';

interface PlaygroundProps {
  apiKeys: ApiKey[];
  models: GatewayModel[];
  selectedKey?: string;
}

export const Playground: React.FC<PlaygroundProps> = ({
  apiKeys,
  models,
  selectedKey: initialSelectedKey,
}) => {
  const { showToast } = useToast();
  const [selectedApiKey, setSelectedApiKey] = useState(initialSelectedKey || apiKeys[0]?.key || '');
  const [selectedModel, setSelectedModel] = useState(models[0]?.id || 'llama-3.3-70b-versatile');
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful, senior technical AI assistant.');
  const [userPrompt, setUserPrompt] = useState('Explain how an API Gateway with multi-provider 429 rotation ensures 99.99% uptime.');
  const [temperature, setTemperature] = useState(0.7);
  const [isStreaming, setIsStreaming] = useState(true);
  const [maxTokens, setMaxTokens] = useState(1024);

  const [isLoading, setIsLoading] = useState(false);
  const [responseText, setResponseText] = useState('');
  const [rawResponse, setRawResponse] = useState<any>(null);
  const [viewMode, setViewMode] = useState<'text' | 'json'>('text');
  const [copiedOutput, setCopiedOutput] = useState(false);
  
  // Telemetry
  const [metaStats, setMetaStats] = useState<{
    latencyMs?: number;
    provider?: string;
    failovers?: number;
    tokens?: number;
  } | null>(null);

  useEffect(() => {
    if (initialSelectedKey) {
      setSelectedApiKey(initialSelectedKey);
    } else if (!selectedApiKey && apiKeys.length > 0) {
      setSelectedApiKey(apiKeys[0].key);
    }
  }, [initialSelectedKey, apiKeys]);

  useEffect(() => {
    if (!selectedModel && models.length > 0) {
      setSelectedModel(models[0].id);
    }
  }, [models]);

  const handleSend = async () => {
    if (!selectedApiKey) {
      showToast('Key Required', 'Please select or generate a Gateway API key first.', 'error');
      return;
    }
    if (!userPrompt.trim()) {
      showToast('Prompt Empty', 'Please enter a message prompt.', 'error');
      return;
    }

    setIsLoading(true);
    setResponseText('');
    setRawResponse(null);
    setMetaStats(null);
    const start = Date.now();

    try {
      const messages = [];
      if (systemPrompt.trim()) {
        messages.push({ role: 'system', content: systemPrompt.trim() });
      }
      messages.push({ role: 'user', content: userPrompt.trim() });

      const payload = {
        model: selectedModel,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: isStreaming
      };

      const response = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${selectedApiKey}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({ error: { message: response.statusText } }));
        throw new Error(errJson.error?.message || `Gateway returned HTTP ${response.status}`);
      }

      const providerHeader = response.headers.get('x-gateway-provider') || 'auto-resolved';
      const failoverHeader = parseInt(response.headers.get('x-gateway-failover-count') || '0', 10);

      // Handle Streaming
      if (isStreaming && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
              try {
                const parsed = JSON.parse(trimmed.substring(6));
                const delta = parsed.choices?.[0]?.delta?.content || '';
                accumulated += delta;
                setResponseText(accumulated);
              } catch (e) {
                // Ignore parse errors on partial frames
              }
            }
          }
        }

        const totalLatency = Date.now() - start;
        const estTokens = Math.round(accumulated.length / 4) + Math.round(userPrompt.length / 4);
        setMetaStats({
          latencyMs: totalLatency,
          provider: providerHeader,
          failovers: failoverHeader,
          tokens: estTokens,
        });
        setRawResponse({
          stream: true,
          provider: providerHeader,
          failovers: failoverHeader,
          latency_ms: totalLatency,
          content: accumulated
        });
      } else {
        // Non-streaming response
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        setResponseText(content);
        setRawResponse(data);

        setMetaStats({
          latencyMs: data.gateway_meta?.latency_ms || (Date.now() - start),
          provider: data.gateway_meta?.provider_used || providerHeader,
          failovers: data.gateway_meta?.failover_count ?? failoverHeader,
          tokens: data.usage?.total_tokens || Math.round(content.length / 4),
        });
      }

      showToast('Completed', 'Response received from gateway.', 'success');
    } catch (err: any) {
      setResponseText(`[FreeAIModel Error]: ${err.message}`);
      showToast('Request Failed', err.message, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const copyOutput = () => {
    if (!responseText) return;
    navigator.clipboard.writeText(responseText);
    setCopiedOutput(true);
    showToast('Copied', 'Output copied to clipboard.', 'success');
    setTimeout(() => setCopiedOutput(false), 2000);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* 1. Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900 tracking-tight">Interactive Playground</h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            Test real requests against the `/v1/chat/completions` endpoint with live streaming and failover telemetry.
          </p>
        </div>

        {metaStats && (
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200/60 px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-800">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Routed via {metaStats.provider}</span>
            <span className="text-emerald-400">•</span>
            <span>{metaStats.latencyMs}ms</span>
          </div>
        )}
      </div>

      {/* 2. Main Two-Column Layout (Pristine Light Theme - No Black Boxes) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Settings & Prompts (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white rounded-xl border border-zinc-200/80 p-5 shadow-xs space-y-4">
            {/* Key Selection */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                Authentication Key
              </label>
              {apiKeys.length > 0 ? (
                <select
                  value={selectedApiKey}
                  onChange={(e) => setSelectedApiKey(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-xs font-mono bg-white focus:border-violet-600 outline-none text-zinc-800"
                >
                  {apiKeys.map((k) => (
                    <option key={k.id} value={k.key}>
                      {k.name} ({k.key.slice(0, 11)}...{k.key.slice(-4)})
                    </option>
                  ))}
                </select>
              ) : (
                <div className="p-3 bg-zinc-50 rounded-lg border border-zinc-200 text-xs text-zinc-600">
                  Please generate an API key in the Keys section.
                </div>
              )}
            </div>

            {/* Model Selection */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5 flex items-center justify-between">
                <span>Model</span>
                <span className="text-[10px] text-violet-700 font-semibold uppercase">Auto-failover enabled</span>
              </label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-xs font-medium bg-white focus:border-violet-600 outline-none text-zinc-800"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.id} ({m.provider})
                  </option>
                ))}
              </select>
            </div>

            {/* System Prompt */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                System Instructions (Optional)
              </label>
              <textarea
                rows={2}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-zinc-200 text-xs outline-none focus:border-violet-600 resize-none font-sans text-zinc-800"
                placeholder="e.g. You are a senior engineer..."
              />
            </div>

            {/* User Prompt */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                User Prompt
              </label>
              <textarea
                rows={4}
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-zinc-200 text-xs outline-none focus:border-violet-600 resize-none font-sans text-zinc-800"
                placeholder="Type your prompt here..."
              />
            </div>

            {/* Parameters */}
            <div className="p-3 bg-zinc-50 rounded-lg border border-zinc-200/60 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-zinc-700 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-zinc-500" />
                  <span>Stream SSE Response</span>
                </label>
                <input
                  type="checkbox"
                  checked={isStreaming}
                  onChange={(e) => setIsStreaming(e.target.checked)}
                  className="w-4 h-4 text-violet-600 rounded focus:ring-violet-500 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-zinc-600 mb-1">
                  <span>Temperature</span>
                  <span className="font-mono font-bold text-zinc-900">{temperature}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1.5"
                  step="0.1"
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  className="w-full accent-violet-600 cursor-pointer"
                />
              </div>
            </div>

            {/* Run Button */}
            <button
              onClick={handleSend}
              disabled={isLoading || !selectedApiKey}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-medium text-xs shadow-xs transition-colors cursor-pointer"
            >
              {isLoading ? (
                <>
                  <RotateCcw className="w-4 h-4 animate-spin" />
                  <span>Routing Prompt...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-white" />
                  <span>Send Request</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right Output & Telemetry View (7 cols) - Clean Light Enterprise Container (No Black Box) */}
        <div className="lg:col-span-7 flex flex-col bg-white rounded-xl overflow-hidden border border-zinc-200/80 shadow-xs">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-zinc-50/80 border-b border-zinc-200/80">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-xs font-semibold text-zinc-800">Gateway Response</span>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-zinc-200/70 p-0.5 rounded text-[11px]">
                <button
                  onClick={() => setViewMode('text')}
                  className={`px-2.5 py-0.5 rounded transition-colors cursor-pointer ${
                    viewMode === 'text' ? 'bg-white text-zinc-900 font-semibold shadow-xs' : 'text-zinc-600 hover:text-zinc-900'
                  }`}
                >
                  Text
                </button>
                <button
                  onClick={() => setViewMode('json')}
                  className={`px-2.5 py-0.5 rounded transition-colors cursor-pointer ${
                    viewMode === 'json' ? 'bg-white text-zinc-900 font-semibold shadow-xs' : 'text-zinc-600 hover:text-zinc-900'
                  }`}
                >
                  Raw JSON
                </button>
              </div>

              {responseText && (
                <button
                  onClick={copyOutput}
                  className="text-zinc-500 hover:text-zinc-800 p-1 cursor-pointer"
                  title="Copy Output"
                >
                  {copiedOutput ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
          </div>

          {/* Response Box - Clean Light Theme */}
          <div className="flex-1 p-5 font-mono text-xs overflow-y-auto min-h-[320px] max-h-[460px] text-zinc-800 bg-zinc-50/50 leading-relaxed whitespace-pre-wrap select-text">
            {viewMode === 'text' ? (
              responseText ? (
                responseText
              ) : isLoading ? (
                <span className="text-zinc-400 animate-pulse font-sans">Streaming response from gateway...</span>
              ) : (
                <span className="text-zinc-400 font-sans">Output will stream here after sending your request...</span>
              )
            ) : (
              <pre className="text-zinc-800 text-[11px]">
                {rawResponse ? JSON.stringify(rawResponse, null, 2) : 'No payload received yet.'}
              </pre>
            )}
          </div>

          {/* Live Telemetry Bar */}
          {metaStats && (
            <div className="bg-zinc-50 px-4 py-3 border-t border-zinc-200/80 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <span className="text-[10px] text-zinc-400 uppercase block font-semibold">Provider</span>
                <span className="text-zinc-800 font-semibold truncate block">{metaStats.provider}</span>
              </div>
              <div>
                <span className="text-[10px] text-zinc-400 uppercase block font-semibold">Latency</span>
                <span className="text-violet-700 font-semibold font-mono">{metaStats.latencyMs} ms</span>
              </div>
              <div>
                <span className="text-[10px] text-zinc-400 uppercase block font-semibold">Tokens</span>
                <span className="text-zinc-800 font-mono font-medium">{metaStats.tokens} tokens</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
