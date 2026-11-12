import React from 'react';
import { 
  Key, 
  Terminal, 
  ArrowRight,
  Copy,
  Check,
  CheckCircle2,
  Zap,
  ShieldCheck,
  Layers
} from 'lucide-react';
import { StatsCards } from './StatsCards';
import { UsageCharts } from './UsageCharts';
import { ProviderLogo } from './ProviderLogo';
import { RequestLog, GatewayModel } from '../types/gateway';
import { useToast } from './Toast';

interface OverviewViewProps {
  totalRequests: number;
  dailyUsage: number;
  promptTokens: number;
  completionTokens: number;
  logs: RequestLog[];
  models: GatewayModel[];
  onNavigateToKeys: () => void;
  onNavigateToPlayground: () => void;
  onNavigateToModels: () => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  totalRequests,
  dailyUsage,
  promptTokens,
  completionTokens,
  logs,
  models,
  onNavigateToKeys,
  onNavigateToPlayground,
  onNavigateToModels,
}) => {
  const { showToast } = useToast();
  const [copiedUrl, setCopiedUrl] = React.useState<string | null>(null);

  // Default to live running server origin so developers can test directly
  const [useLiveUrl, setUseLiveUrl] = React.useState(true);
  const liveOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://freeaimodel.org';
  const customDomain = 'https://freeaimodel.org';
  const baseUrl = useLiveUrl ? liveOrigin : customDomain;

  const chatUrl = `${baseUrl}/v1/chat/completions`;
  const modelsUrl = `${baseUrl}/v1/models`;

  const copyEndpoint = (url: string, id: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(id);
    showToast('Copied', 'Endpoint URL copied to clipboard.', 'success');
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const avgLatency = logs.length > 0
    ? Math.round(logs.reduce((acc, l) => acc + (l.latencyMs || 0), 0) / logs.length)
    : 0;

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* 1. Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900 tracking-tight">Overview</h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            Real-time gateway routing performance and active model endpoints.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={onNavigateToKeys}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <Key className="w-3.5 h-3.5" />
            <span>Generate Key</span>
          </button>
          <button
            onClick={onNavigateToPlayground}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-zinc-200 hover:bg-zinc-50 text-zinc-700 text-xs font-medium transition-colors cursor-pointer"
          >
            <Terminal className="w-3.5 h-3.5 text-zinc-500" />
            <span>Playground</span>
          </button>
        </div>
      </div>

      {/* 2. Technical Stats Cards */}
      <StatsCards
        totalRequests={totalRequests}
        dailyUsage={dailyUsage}
        promptTokens={promptTokens}
        completionTokens={completionTokens}
        avgLatency={avgLatency}
      />

      {/* 3. Interactive Usage Charts */}
      <UsageCharts logs={logs} />

      {/* 4. Unified Endpoints & Models Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Endpoints Terminal Card (2 cols) */}
        <div className="lg:col-span-2 bg-zinc-900 rounded-xl border border-zinc-800 shadow-md p-6 text-zinc-100 flex flex-col justify-between">
          <div>
            {/* Terminal Header Bar */}
            <div className="flex items-center justify-between pb-4 border-b border-zinc-800/80 mb-5">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block" />
                  <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
                  <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
                </div>
                <span className="ml-2 font-mono text-xs text-zinc-400 font-medium">
                  FreeAIModel Gateway Router
                </span>
              </div>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-emerald-950/80 text-emerald-400 border border-emerald-800/60">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                ONLINE
              </span>
            </div>

            {/* Primary Base URL Highlight Box */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1.5 text-xs text-zinc-400">
                <span className="font-semibold uppercase tracking-wider text-[11px] text-zinc-300">
                  OpenAI SDK Base URL
                </span>
                <span className="text-[11px] text-zinc-500 font-mono">Drop-in replacement for api.openai.com</span>
              </div>
              <div className="p-3.5 bg-black/50 rounded-lg border border-zinc-800 flex items-center justify-between gap-3 font-mono text-sm">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-zinc-500 select-none text-xs">$</span>
                  <span className="text-green-400 font-semibold truncate select-all">{baseUrl}/v1</span>
                </div>
                <button
                  onClick={() => copyEndpoint(`${baseUrl}/v1`, 'base')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white text-xs font-sans font-medium transition-colors shrink-0 cursor-pointer"
                >
                  {copiedUrl === 'base' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-zinc-400" />
                      <span>Copy Base URL</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Individual Endpoints in dark terminal format */}
            <div className="space-y-2.5">
              {/* Chat Endpoint */}
              <div className="p-2.5 bg-zinc-950/60 rounded-lg border border-zinc-800/80 flex items-center justify-between gap-3 text-xs font-mono">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-violet-900/60 text-violet-300 border border-violet-700/50">
                    POST
                  </span>
                  <span className="text-zinc-300 truncate select-all">{chatUrl}</span>
                </div>
                <button
                  onClick={() => copyEndpoint(chatUrl, 'chat')}
                  className="text-zinc-400 hover:text-green-400 p-1.5 rounded hover:bg-zinc-800 transition-colors shrink-0 cursor-pointer"
                  title="Copy Chat URL"
                >
                  {copiedUrl === 'chat' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* Models Endpoint */}
              <div className="p-2.5 bg-zinc-950/60 rounded-lg border border-zinc-800/80 flex items-center justify-between gap-3 text-xs font-mono">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-zinc-800 text-zinc-300 border border-zinc-700/50">
                    GET
                  </span>
                  <span className="text-zinc-300 truncate select-all">{modelsUrl}</span>
                </div>
                <button
                  onClick={() => copyEndpoint(modelsUrl, 'models')}
                  className="text-zinc-400 hover:text-green-400 p-1.5 rounded hover:bg-zinc-800 transition-colors shrink-0 cursor-pointer"
                  title="Copy Models URL"
                >
                  {copiedUrl === 'models' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          {/* Features check row inside terminal footer */}
          <div className="mt-5 pt-4 border-t border-zinc-800/80 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-zinc-400 font-mono">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />
              <span>Auto 429 Failover</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />
              <span>SSE Streaming</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />
              <span>Multi-Provider Rotation</span>
            </div>
          </div>
        </div>

        {/* Quick Model Catalog Summary (1 col) */}
        <div className="bg-white rounded-xl border border-zinc-200/80 shadow-xs p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-zinc-900">Active Models</h3>
              <span className="text-xs font-mono text-zinc-400">{models.length} ready</span>
            </div>
            <p className="text-xs text-zinc-500 mb-4">
              Dynamically discovered from active provider keys
            </p>

            <div className="space-y-2">
              {models.slice(0, 4).map((m) => (
                <div key={m.id} className="flex items-center justify-between text-xs py-1.5 px-2 rounded-md hover:bg-zinc-50">
                  <div className="flex items-center gap-2 min-w-0">
                    <ProviderLogo provider={m.provider} size={15} />
                    <span className="font-medium text-zinc-800 truncate">{m.name || m.id}</span>
                  </div>
                  <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200/80 px-1.5 py-0.2 rounded-full">
                    FREE
                  </span>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={onNavigateToModels}
            className="mt-4 pt-3 border-t border-zinc-100 text-xs font-medium text-violet-700 hover:text-violet-800 flex items-center justify-between cursor-pointer"
          >
            <span>View All {models.length} Discovered Models</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
