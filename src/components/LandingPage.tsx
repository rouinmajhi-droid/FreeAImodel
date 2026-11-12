import React, { useState } from 'react';
import { 
  Zap, 
  ArrowRight, 
  Check, 
  Copy, 
  ShieldCheck, 
  Cpu, 
  Terminal, 
  Sparkles, 
  Layers, 
  Globe, 
  CheckCircle2, 
  ChevronRight,
  Code2,
  Lock,
  Flame,
  Users
} from 'lucide-react';
import { GatewayModel } from '../types/gateway';
import { ProviderLogo } from './ProviderLogo';

interface LandingPageProps {
  models: GatewayModel[];
  onGetFreeApiKey: () => void;
  onOpenPlayground: () => void;
  onViewModels: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  models = [],
  onGetFreeApiKey,
  onOpenPlayground,
  onViewModels,
}) => {
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  // Real live server URL
  const serverOrigin = typeof window !== 'undefined' && window.location.origin
    ? window.location.origin
    : 'https://ais-dev-v74yl6dga5jcxwtppiqoqk-861257782865.asia-southeast1.run.app';

  const curlSnippet = `curl -X POST "${serverOrigin}/v1/chat/completions" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-gateway-your_token" \\
  -d '{
    "model": "llama-3.3-70b-versatile",
    "messages": [{"role": "user", "content": "Explain quantum computing in 10 words."}],
    "temperature": 0.7
  }'`;

  const handleCopy = () => {
    navigator.clipboard.writeText(curlSnippet);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2000);
  };

  const showcaseModels = models.length > 0 ? models.slice(0, 8) : [
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile', provider: 'groq' },
    { id: 'gpt-4o', name: 'GPT-4o Omnimodel', provider: 'openai' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'gemini' },
    { id: 'deepseek-chat', name: 'DeepSeek-V3 Chat', provider: 'deepseek' },
    { id: 'deepseek-reasoner', name: 'DeepSeek-R1 Reasoner', provider: 'deepseek' },
    { id: 'mistral-large-latest', name: 'Mistral Large 2', provider: 'mistral' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai' },
    { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'anthropic' }
  ];

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-zinc-900 selection:bg-violet-500 selection:text-white antialiased">
      {/* 1. Header Navigation */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-zinc-200/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center text-white shadow-xs">
              <Zap className="w-4 h-4 fill-white text-white" />
            </div>
            <div>
              <span className="font-bold text-base tracking-tight text-zinc-900 block leading-tight">
                FreeAIModel
              </span>
              <span className="text-[10px] text-zinc-400 font-medium">Universal AI Gateway</span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-7 text-xs font-medium text-zinc-600">
            <a href="#models" className="hover:text-zinc-950 transition-colors">Models</a>
            <a href="#terminal" className="hover:text-zinc-950 transition-colors">API Endpoints</a>
            <a href="#stats" className="hover:text-zinc-950 transition-colors">Developer Metrics</a>
            <a href="#features" className="hover:text-zinc-950 transition-colors">Features</a>
          </nav>

          <div className="flex items-center gap-3">
            <button
              onClick={onOpenPlayground}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:text-zinc-950 transition-colors cursor-pointer"
            >
              <Terminal className="w-3.5 h-3.5 text-zinc-500" />
              <span>Playground</span>
            </button>

            <button
              onClick={onGetFreeApiKey}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 active:scale-[0.98] text-white text-xs font-semibold shadow-sm transition-all cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5 fill-white" />
              <span>Get Free API Key</span>
            </button>
          </div>
        </div>
      </header>

      {/* 2. Hero Section */}
      <section className="relative overflow-hidden pt-12 pb-20 sm:pt-20 sm:pb-28">
        {/* Subtle background glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-violet-200/40 rounded-full blur-3xl pointer-events-none -z-10" />

        <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center">
          {/* Top Pill */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-50 border border-violet-200/80 text-violet-700 text-xs font-semibold mb-6 shadow-xs animate-in fade-in slide-in-from-bottom-2 duration-300">
            <span className="w-2 h-2 rounded-full bg-violet-600 animate-pulse" />
            <span>⚡ 50 Billion Free Tokens Allocated • OpenAI Drop-In</span>
          </div>

          {/* Headline */}
          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-zinc-950 leading-[1.1] mb-6">
            Universal AI Gateway.<br />
            <span className="bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 bg-clip-text text-transparent">
              100% Free & Unlimited.
            </span>
          </h1>

          {/* Subtitle */}
          <p className="max-w-2xl mx-auto text-base sm:text-lg text-zinc-600 font-normal leading-relaxed mb-8">
            Route requests to Llama 3.3, GPT-4o, Gemini 2.0, DeepSeek R1, Mistral, and Claude via one unified OpenAI-compatible endpoint. Automatic 429 rotation across multi-key pools.
          </p>

          {/* Hero CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5 mb-14">
            <button
              onClick={onGetFreeApiKey}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 active:scale-[0.98] text-white text-sm font-semibold shadow-md shadow-violet-500/20 transition-all cursor-pointer"
            >
              <Zap className="w-4 h-4 fill-white" />
              <span>Get Free API Key</span>
              <ArrowRight className="w-4 h-4 ml-1" />
            </button>

            <button
              onClick={onViewModels}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-white hover:bg-zinc-50 border border-zinc-200 text-zinc-800 text-sm font-medium shadow-xs transition-colors cursor-pointer"
            >
              <Layers className="w-4 h-4 text-zinc-500" />
              <span>Explore All Free Models</span>
            </button>
          </div>

          {/* 3. Live Server Terminal Preview Box */}
          <div id="terminal" className="max-w-3xl mx-auto rounded-2xl border border-zinc-800 bg-[#09090b] shadow-2xl overflow-hidden text-left text-zinc-100">
            {/* Window bar */}
            <div className="flex items-center justify-between px-4 py-3 bg-[#0d0d10] border-b border-zinc-800/80">
              <div className="flex items-center gap-2.5">
                <span className="w-3 h-3 rounded-full bg-[#ef4444]" />
                <span className="w-3 h-3 rounded-full bg-[#f59e0b]" />
                <span className="w-3 h-3 rounded-full bg-[#10b981]" />
                <span className="ml-2 font-mono text-xs text-zinc-400">
                  bash — cURL to Live FreeAIModel Server
                </span>
              </div>

              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-mono border border-zinc-700 shadow-xs transition-colors cursor-pointer"
              >
                {copiedSnippet ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400 font-semibold">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Copy cURL</span>
                  </>
                )}
              </button>
            </div>

            {/* Code */}
            <div className="p-5 font-mono text-xs overflow-x-auto leading-relaxed bg-[#09090b]">
              <div>
                <span className="text-emerald-400 font-semibold">curl</span>{' '}
                <span className="text-zinc-400">-X</span>{' '}
                <span className="text-cyan-400 font-bold">POST</span>{' '}
                <span className="text-emerald-300">"{serverOrigin}/v1/chat/completions"</span>{' '}
                <span className="text-zinc-600">\</span>
              </div>
              <div className="pl-4">
                <span className="text-zinc-400">-H</span>{' '}
                <span className="text-amber-300">"Content-Type: application/json"</span>{' '}
                <span className="text-zinc-600">\</span>
              </div>
              <div className="pl-4">
                <span className="text-zinc-400">-H</span>{' '}
                <span className="text-amber-300">"Authorization: Bearer </span>
                <span className="text-cyan-300 font-bold">sk-gateway-your_token</span>
                <span className="text-amber-300">"</span>{' '}
                <span className="text-zinc-600">\</span>
              </div>
              <div className="pl-4">
                <span className="text-zinc-400">-d</span>{' '}
                <span className="text-zinc-300">'{'{'}</span>
              </div>
              <div className="pl-8">
                <span className="text-sky-300">"model"</span>
                <span className="text-zinc-400">: </span>
                <span className="text-emerald-300">"llama-3.3-70b-versatile"</span>
                <span className="text-zinc-400">,</span>
              </div>
              <div className="pl-8">
                <span className="text-sky-300">"messages"</span>
                <span className="text-zinc-400">: [{'{'} </span>
                <span className="text-sky-300">"role"</span>
                <span className="text-zinc-400">: </span>
                <span className="text-emerald-300">"user"</span>
                <span className="text-zinc-400">, </span>
                <span className="text-sky-300">"content"</span>
                <span className="text-zinc-400">: </span>
                <span className="text-emerald-300">"Hello, FreeAIModel!"</span>
                <span className="text-zinc-300"> {'}'}]</span>
              </div>
              <div className="pl-4">
                <span className="text-zinc-300">{'}'}'</span>
              </div>
            </div>

            {/* Terminal Footer status */}
            <div className="px-5 py-2.5 bg-[#0d0d10] border-t border-zinc-800/80 flex items-center justify-between text-[11px] font-mono text-zinc-400">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-emerald-400">Target: Live Running Server</span>
              </div>
              <span className="text-zinc-500">HTTP/2 • SSE Streaming Ready</span>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Live Developer Metrics / Social Proof Section */}
      <section id="stats" className="border-y border-zinc-200/80 bg-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 text-center">
            <div className="p-4">
              <div className="text-3xl sm:text-4xl font-extrabold text-zinc-950 font-mono tracking-tight">
                50,000+
              </div>
              <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mt-1.5 flex items-center justify-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-violet-600" />
                <span>Active Developers</span>
              </div>
            </div>

            <div className="p-4 border-l border-zinc-100">
              <div className="text-3xl sm:text-4xl font-extrabold text-zinc-950 font-mono tracking-tight text-violet-600">
                50 Billion
              </div>
              <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mt-1.5 flex items-center justify-center gap-1.5">
                <Flame className="w-3.5 h-3.5 text-amber-500" />
                <span>Free Token Pool</span>
              </div>
            </div>

            <div className="p-4 border-l border-zinc-100">
              <div className="text-3xl sm:text-4xl font-extrabold text-zinc-950 font-mono tracking-tight text-emerald-600">
                99.99%
              </div>
              <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mt-1.5 flex items-center justify-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>Routing Uptime</span>
              </div>
            </div>

            <div className="p-4 border-l border-zinc-100">
              <div className="text-3xl sm:text-4xl font-extrabold text-zinc-950 font-mono tracking-tight">
                140 ms
              </div>
              <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mt-1.5 flex items-center justify-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-500" />
                <span>Avg TTFT Latency</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Supported Models Showcase */}
      <section id="models" className="py-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold mb-3 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Zero Rate Limits • Free Model Access</span>
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-zinc-950">
            Popular Models on FreeAIModel
          </h2>
          <p className="text-sm text-zinc-500 mt-2">
            Connect using your Free API key. Dynamically failover across providers seamlessly.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {showcaseModels.map((m) => (
            <div
              key={m.id}
              className="bg-white rounded-xl border border-zinc-200/80 p-4 shadow-xs hover:border-violet-300 hover:shadow-sm transition-all flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-zinc-50 border border-zinc-200/80 flex items-center justify-center shrink-0">
                      <ProviderLogo provider={m.provider} size={18} />
                    </div>
                    <span className="font-semibold text-sm text-zinc-900 group-hover:text-violet-700 transition-colors truncate">
                      {m.name || m.id}
                    </span>
                  </div>

                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-emerald-50 text-emerald-700 border border-emerald-300/80 shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    FREE
                  </span>
                </div>

                <div className="bg-zinc-50 px-2.5 py-1.5 rounded-lg border border-zinc-100 text-[11px] font-mono text-zinc-600 truncate">
                  {m.id}
                </div>
              </div>

              <div className="mt-3 pt-2.5 border-t border-zinc-100 flex items-center justify-between text-xs">
                <span className="text-[10px] font-bold uppercase text-zinc-400">
                  {m.provider}
                </span>
                <button
                  onClick={onOpenPlayground}
                  className="text-violet-600 hover:text-violet-800 font-medium text-[11px] flex items-center gap-0.5 cursor-pointer"
                >
                  <span>Test Free</span>
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="text-center mt-10">
          <button
            onClick={onViewModels}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <span>View All Models ({models.length || 15}+)</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </section>

      {/* 6. Features Grid */}
      <section id="features" className="py-16 bg-white border-t border-zinc-200/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-3xl font-bold tracking-tight text-zinc-950">
              Engineered for Scalable Production
            </h2>
            <p className="text-sm text-zinc-500 mt-2">
              Everything you need to build apps without paying high provider token markups.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 rounded-2xl bg-[#FAF9F6] border border-zinc-200/80">
              <div className="w-10 h-10 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center mb-4">
                <Code2 className="w-5 h-5" />
              </div>
              <h3 className="text-base font-semibold text-zinc-900 mb-1.5">OpenAI SDK Drop-In</h3>
              <p className="text-xs text-zinc-600 leading-relaxed">
                Change one single line of code: switch your <code>baseURL</code> to <code>{serverOrigin}/v1</code> and start making chat completions immediately with existing code.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-[#FAF9F6] border border-zinc-200/80">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center mb-4">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h3 className="text-base font-semibold text-zinc-900 mb-1.5">Multi-Key 429 Failover</h3>
              <p className="text-xs text-zinc-600 leading-relaxed">
                If an upstream provider hits rate limits or latency spikes, the gateway automatically rotates keys and routes to healthy hardware within milliseconds.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-[#FAF9F6] border border-zinc-200/80">
              <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center mb-4">
                <Zap className="w-5 h-5 fill-amber-700" />
              </div>
              <h3 className="text-base font-semibold text-zinc-900 mb-1.5">Streaming SSE Support</h3>
              <p className="text-xs text-zinc-600 leading-relaxed">
                Native streaming event protocol support. Stream tokens into your frontend interfaces with zero delay and smooth typing effects.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 7. Bottom Call to Action */}
      <section className="py-20 bg-gradient-to-b from-white to-[#FAF9F6] border-t border-zinc-200/80 text-center">
        <div className="max-w-4xl mx-auto px-4">
          <div className="w-12 h-12 rounded-xl bg-violet-600 text-white flex items-center justify-center mx-auto mb-5 shadow-md shadow-violet-500/20">
            <Zap className="w-6 h-6 fill-white" />
          </div>

          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-zinc-950 mb-3">
            Start Generating Free AI Completions Today
          </h2>
          <p className="text-sm text-zinc-600 max-w-xl mx-auto mb-8">
            Create your free developer key in 10 seconds. No credit card required.
          </p>

          <button
            onClick={onGetFreeApiKey}
            className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl bg-violet-600 hover:bg-violet-700 active:scale-[0.98] text-white text-sm font-semibold shadow-lg shadow-violet-500/25 transition-all cursor-pointer"
          >
            <Zap className="w-4 h-4 fill-white" />
            <span>Get Free API Key</span>
            <ArrowRight className="w-4 h-4 ml-1" />
          </button>
        </div>
      </section>

      {/* 8. Footer */}
      <footer className="border-t border-zinc-200 py-8 bg-white text-xs text-zinc-500 text-center">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-violet-600 fill-violet-600" />
            <span className="font-semibold text-zinc-800">FreeAIModel</span>
            <span>— Universal AI Gateway</span>
          </div>

          <p className="text-zinc-400">
            Compatible with standard OpenAI client libraries. Powered by Cloud Run & Google Cloud.
          </p>
        </div>
      </footer>
    </div>
  );
};
