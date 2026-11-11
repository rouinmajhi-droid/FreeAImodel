import React, { useState, useMemo } from 'react';
import { BarChart3, Layers, Info, Activity } from 'lucide-react';
import { RequestLog } from '../types/gateway';

interface UsageChartsProps {
  logs: RequestLog[];
}

export const UsageCharts: React.FC<UsageChartsProps> = ({ logs = [] }) => {
  const [timeRange, setTimeRange] = useState<'24h' | '7d' | '30d'>('7d');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const daysCount = timeRange === '24h' ? 24 : timeRange === '7d' ? 7 : 30;
  const isHourly = timeRange === '24h';

  // Compute real bucketed telemetry from actual logs
  const chartData = useMemo(() => {
    const buckets = Array.from({ length: daysCount }).map((_, i) => {
      const d = new Date();
      let startTime = 0;
      let endTime = 0;
      let label = '';

      if (isHourly) {
        d.setHours(d.getHours() - (daysCount - 1 - i));
        d.setMinutes(0, 0, 0);
        startTime = d.getTime();
        endTime = startTime + 3600 * 1000;
        label = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else {
        d.setDate(d.getDate() - (daysCount - 1 - i));
        d.setHours(0, 0, 0, 0);
        startTime = d.getTime();
        endTime = startTime + 86400 * 1000;
        label = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      }

      // Filter real logs in this bucket
      const matchingLogs = logs.filter(l => {
        const t = new Date(l.timestamp).getTime();
        return t >= startTime && t < endTime;
      });

      const requests = matchingLogs.length;
      const promptTokens = matchingLogs.reduce((acc, l) => acc + (l.promptTokens || 0), 0);
      const completionTokens = matchingLogs.reduce((acc, l) => acc + (l.completionTokens || 0), 0);
      const totalTokens = promptTokens + completionTokens;

      return {
        label,
        requests,
        promptTokens,
        completionTokens,
        totalTokens
      };
    });

    return buckets;
  }, [logs, daysCount, isHourly]);

  const maxRequests = Math.max(...chartData.map(d => d.requests), 10);
  const totalRequestsInWindow = chartData.reduce((acc, d) => acc + d.requests, 0);
  const totalTokensInWindow = chartData.reduce((acc, d) => acc + d.totalTokens, 0);

  // Real token breakdown
  const totalPromptTokens = logs.reduce((acc, l) => acc + (l.promptTokens || 0), 0);
  const totalCompletionTokens = logs.reduce((acc, l) => acc + (l.completionTokens || 0), 0);
  const totalTokensAll = totalPromptTokens + totalCompletionTokens;

  const promptPct = totalTokensAll > 0 ? Math.round((totalPromptTokens / totalTokensAll) * 100) : 0;
  const completionPct = totalTokensAll > 0 ? 100 - promptPct : 0;

  // Real provider distribution
  const providerStats = useMemo(() => {
    if (logs.length === 0) return [];
    const counts: Record<string, number> = {};
    for (const l of logs) {
      const p = (l.provider || 'custom').toLowerCase();
      counts[p] = (counts[p] || 0) + 1;
    }
    const total = logs.length;
    return Object.entries(counts)
      .map(([provider, count]) => ({
        provider,
        count,
        pct: Math.round((count / total) * 100)
      }))
      .sort((a, b) => b.count - a.count);
  }, [logs]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Main Request Volume Chart (2 cols) */}
      <div className="lg:col-span-2 bg-white rounded-xl p-6 border border-zinc-200/80 shadow-xs flex flex-col justify-between">
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
            <div>
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-zinc-100 flex items-center justify-center text-zinc-700">
                  <BarChart3 className="w-4 h-4" />
                </div>
                <h3 className="text-base font-semibold text-zinc-900">Request Throughput</h3>
              </div>
              <p className="text-xs text-zinc-500 mt-0.5">Real-time incoming API calls routed by FreeAIModel</p>
            </div>

            <div className="flex items-center gap-1 bg-zinc-100 p-1 rounded-lg text-xs font-medium self-start sm:self-auto">
              <button
                onClick={() => setTimeRange('24h')}
                className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                  timeRange === '24h'
                    ? 'bg-white text-zinc-900 shadow-xs font-semibold'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                24h
              </button>
              <button
                onClick={() => setTimeRange('7d')}
                className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                  timeRange === '7d'
                    ? 'bg-white text-zinc-900 shadow-xs font-semibold'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                7d
              </button>
              <button
                onClick={() => setTimeRange('30d')}
                className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                  timeRange === '30d'
                    ? 'bg-white text-zinc-900 shadow-xs font-semibold'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                30d
              </button>
            </div>
          </div>

          {/* Chart Area */}
          {totalRequestsInWindow === 0 ? (
            <div className="h-60 w-full flex flex-col items-center justify-center border-b border-zinc-100 text-center px-4">
              <div className="w-10 h-10 rounded-xl bg-zinc-100 text-zinc-400 flex items-center justify-center mb-2">
                <Activity className="w-5 h-5" />
              </div>
              <p className="text-xs font-semibold text-zinc-700">No Request Activity in this Window</p>
              <p className="text-[11px] text-zinc-400 max-w-xs mt-0.5">
                Make inference calls using your API key or test in the Playground to populate real-time graphs.
              </p>
            </div>
          ) : (
            <div className="relative h-60 w-full flex items-end gap-1.5 sm:gap-2 pt-6 pb-6 px-1 border-b border-zinc-100">
              {chartData.map((item, idx) => {
                const heightPct = item.requests > 0 
                  ? Math.max(8, (item.requests / maxRequests) * 100)
                  : 4;
                const isHovered = hoveredIndex === idx;

                return (
                  <div
                    key={idx}
                    onMouseEnter={() => setHoveredIndex(idx)}
                    onMouseLeave={() => setHoveredIndex(null)}
                    className="flex-1 flex flex-col items-center h-full justify-end group relative cursor-pointer"
                  >
                    {/* Tooltip on hover */}
                    {isHovered && (
                      <div className="absolute -top-16 z-30 bg-zinc-900 text-white text-xs rounded-lg py-1.5 px-2.5 shadow-lg pointer-events-none whitespace-nowrap animate-in fade-in">
                        <p className="font-semibold text-zinc-200">{item.label}</p>
                        <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-zinc-400 font-mono">
                          <span>{item.requests} calls</span>
                          <span>•</span>
                          <span>{item.totalTokens.toLocaleString()} tokens</span>
                        </div>
                      </div>
                    )}

                    {/* Bar */}
                    <div
                      className={`w-full rounded-t-md transition-all duration-150 ${
                        item.requests === 0
                          ? 'bg-zinc-100 hover:bg-zinc-200'
                          : isHovered
                          ? 'bg-violet-600 shadow-xs'
                          : 'bg-violet-400/80 hover:bg-violet-500'
                      }`}
                      style={{ height: `${heightPct}%` }}
                    />

                    {/* Label */}
                    <span className="absolute -bottom-5 text-[10px] text-zinc-400 font-medium truncate max-w-[40px]">
                      {daysCount <= 7 || idx % Math.ceil(daysCount / 7) === 0 ? item.label : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-between text-xs text-zinc-500">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-violet-600" />
              <span>Inference Calls ({totalRequestsInWindow})</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-zinc-300" />
              <span>Tokens ({totalTokensInWindow.toLocaleString()})</span>
            </span>
          </div>
          <span className="text-zinc-400 text-[11px] font-mono">Real-time gateway stream</span>
        </div>
      </div>

      {/* Side Token Split & Provider Distribution (1 col) */}
      <div className="bg-white rounded-xl p-6 border border-zinc-200/80 shadow-xs flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-zinc-100 flex items-center justify-center text-zinc-700">
                <Layers className="w-4 h-4" />
              </div>
              <h3 className="text-base font-semibold text-zinc-900">Token Distribution</h3>
            </div>
          </div>
          <p className="text-xs text-zinc-500 mb-5">Ratio of Prompt Input vs Output Generation</p>

          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-xs font-medium mb-1.5 text-zinc-700 font-mono">
                <span>Prompt ({promptPct}%)</span>
                <span>Completion ({completionPct}%)</span>
              </div>
              <div className="w-full h-2.5 bg-zinc-100 rounded-full overflow-hidden flex">
                {totalTokensAll > 0 ? (
                  <>
                    <div className="bg-zinc-400 h-full transition-all" style={{ width: `${promptPct}%` }} />
                    <div className="bg-violet-600 h-full transition-all" style={{ width: `${completionPct}%` }} />
                  </>
                ) : (
                  <div className="bg-zinc-200 h-full w-full" />
                )}
              </div>
            </div>

            {/* Provider Breakdown */}
            <div className="pt-4 border-t border-zinc-100 space-y-3">
              <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block">
                Provider Traffic Share
              </span>

              {providerStats.length === 0 ? (
                <div className="p-3 bg-zinc-50 rounded-lg text-center text-xs text-zinc-400">
                  No upstream provider traffic recorded yet.
                </div>
              ) : (
                <div className="space-y-2.5 text-xs">
                  {providerStats.map((item) => (
                    <div key={item.provider}>
                      <div className="flex justify-between text-zinc-600 mb-1">
                        <span className="font-medium text-zinc-800 capitalize">{item.provider}</span>
                        <span className="font-bold text-zinc-900 font-mono">{item.pct}% ({item.count})</span>
                      </div>
                      <div className="w-full h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                        <div
                          className="bg-violet-600 h-full transition-all"
                          style={{ width: `${item.pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-zinc-100 text-[11px] text-zinc-400 flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5 shrink-0" />
          <span>Automatic 429 rotation active across all endpoints</span>
        </div>
      </div>
    </div>
  );
};
