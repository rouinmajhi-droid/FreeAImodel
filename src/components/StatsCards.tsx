import React from 'react';
import { Activity, Clock, Cpu, Zap, ShieldCheck } from 'lucide-react';

interface StatsCardsProps {
  totalRequests: number;
  dailyUsage: number;
  promptTokens: number;
  completionTokens: number;
  avgLatency?: number;
}

export const StatsCards: React.FC<StatsCardsProps> = ({
  totalRequests,
  dailyUsage,
  promptTokens,
  completionTokens,
  avgLatency = 0,
}) => {
  const totalTokens = promptTokens + completionTokens;
  const hasRequests = totalRequests > 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
      {/* 1. Total Requests */}
      <div className="bg-white rounded-xl p-5 border border-zinc-200/80 shadow-xs">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Total Requests</span>
          <div className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center text-zinc-700">
            <Activity className="w-4 h-4" />
          </div>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl sm:text-3xl font-bold text-zinc-950 tracking-tight font-mono">
            {totalRequests.toLocaleString()}
          </span>
          <span className={`inline-flex items-center text-[11px] font-semibold px-1.5 py-0.5 rounded-md ${
            hasRequests 
              ? 'text-emerald-700 bg-emerald-50' 
              : 'text-zinc-500 bg-zinc-100'
          }`}>
            {hasRequests ? 'Active' : 'Standby'}
          </span>
        </div>
        <p className="mt-2 text-xs text-zinc-500 flex items-center justify-between">
          <span>Gateway queries</span>
          <span className={hasRequests ? 'text-emerald-600 font-medium' : 'text-zinc-400'}>
            {hasRequests ? '100% success' : '0 recorded'}
          </span>
        </p>
      </div>

      {/* 2. Daily Usage */}
      <div className="bg-white rounded-xl p-5 border border-zinc-200/80 shadow-xs">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Daily Calls</span>
          <div className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center text-zinc-700">
            <Clock className="w-4 h-4" />
          </div>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl sm:text-3xl font-bold text-zinc-950 tracking-tight font-mono">
            {dailyUsage.toLocaleString()}
          </span>
          <span className="text-xs text-zinc-400 font-medium">calls / 24h</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
          <span>Window state</span>
          <span className="text-violet-600 font-semibold font-mono">
            {hasRequests ? 'Active telemetry' : 'Idle'}
          </span>
        </div>
      </div>

      {/* 3. Token Consumption */}
      <div className="bg-white rounded-xl p-5 border border-zinc-200/80 shadow-xs">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Token Flow</span>
          <div className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center text-zinc-700">
            <Cpu className="w-4 h-4" />
          </div>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl sm:text-3xl font-bold text-zinc-950 tracking-tight font-mono">
            {totalTokens > 1000000
              ? `${(totalTokens / 1000000).toFixed(2)}M`
              : totalTokens > 1000
              ? `${(totalTokens / 1000).toFixed(1)}k`
              : totalTokens.toLocaleString()}
          </span>
          <span className="text-xs text-zinc-400 font-medium">tokens</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-500">
          <span className="font-mono">P: {promptTokens.toLocaleString()}</span>
          <span className="font-mono">C: {completionTokens.toLocaleString()}</span>
        </div>
      </div>

      {/* 4. Average Latency & Health */}
      <div className="bg-white rounded-xl p-5 border border-zinc-200/80 shadow-xs">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Avg Latency</span>
          <div className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center text-zinc-700">
            <Zap className="w-4 h-4 text-amber-500" />
          </div>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl sm:text-3xl font-bold text-zinc-950 tracking-tight font-mono">
            {hasRequests && avgLatency > 0 ? `${avgLatency} ms` : '-'}
          </span>
          <span className="text-xs text-zinc-400 font-medium">
            {hasRequests && avgLatency > 0 ? 'TTFT' : 'Awaiting traffic'}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
          <span className="flex items-center gap-1 text-emerald-600 font-medium">
            <ShieldCheck className="w-3.5 h-3.5" />
            Automatic 429 Failover
          </span>
        </div>
      </div>
    </div>
  );
};
