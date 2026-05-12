/**
 * SignalChartPanel — multi-line signal chart with dual-axis + live mode.
 *
 * Owns no data fetching; consumers pass `data` (sorted ascending by
 * timestamp) and `selectedSignals`. When `isLive` is true the panel uses
 * the "live" visual treatment (red pulse, event/point counters, no
 * series animation) but the underlying chart structure is identical.
 *
 * Used by:
 *   - SignalExplorerPage    (live + historical)
 *   - SignalsWorkspacePage  (live + historical)
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, BarChart3, Radio } from 'lucide-react';

import { GlassPanel } from '@/components/ui';
import { Skeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { ChartTooltip } from '@/components/charts/ChartTooltip';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from '@/components/charts';
import { CHART_COLORS } from '@/lib/colors';
import { fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import type { SignalStat } from '../hooks/useLiveSignalStream';

export interface SignalChartPanelProps {
  selectedSignals: string[];
  data: Record<string, unknown>[];
  /** Per-signal stats — drives auto dual-axis decision. */
  stats: SignalStat[];
  isLive?: boolean;
  loading?: boolean;
  /** Total points loaded (historical) or live event count. Header annotation. */
  pointsLoaded?: number;
  liveEventCount?: number;
  /** Override panel title. */
  title?: string;
  /** Height in px (default 350). */
  height?: number;
  className?: string;
}

export function SignalChartPanel({
  selectedSignals,
  data,
  stats,
  isLive = false,
  loading = false,
  pointsLoaded,
  liveEventCount,
  title,
  height = 350,
  className,
}: SignalChartPanelProps) {
  const { t } = useTranslation();

  const useRightAxis = useMemo(() => {
    if (!stats || stats.length < 2) return false;
    const ranges = stats.map((s) => Math.abs(s.max - s.min) || 1);
    return ranges[0] / ranges[1] > 10 || ranges[1] / ranges[0] > 10;
  }, [stats]);

  const resolvedTitle = title ?? (isLive ? t('Live Signal Stream') : t('Signal Chart'));

  return (
    <FadeIn>
      <GlassPanel className={cn('p-4 sm:p-5', className)}>
        <div className="flex items-center gap-2 mb-4">
          {isLive ? (
            <Radio className="h-4 w-4 text-red-500 animate-pulse" />
          ) : (
            <BarChart3 className="h-4 w-4 text-neon-cyan" />
          )}
          <span className="section-title">{resolvedTitle}</span>
          {isLive ? (
            <span className="ml-auto flex items-center gap-1.5 text-[10px] text-red-400">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
              {fmtInt(liveEventCount ?? 0)} {t('events')} · {fmtInt(data.length)} {t('points')}
            </span>
          ) : data.length > 0 && pointsLoaded != null ? (
            <span className="ml-auto text-[10px] text-[var(--text-muted)]">
              {fmtInt(pointsLoaded)} {t('points loaded')}
            </span>
          ) : null}
        </div>

        {loading && !isLive ? (
          <div style={{ height }}>
            <Skeleton className="h-full w-full" />
          </div>
        ) : data.length > 0 ? (
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={data} margin={{ top: 10, right: useRightAxis ? 20 : 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
              <XAxis
                dataKey="timestamp"
                tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                tickFormatter={(v: string) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              />
              <YAxis yAxisId="left" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
              {useRightAxis ? (
                <YAxis yAxisId="right" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
              ) : null}
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, cursor: 'pointer' }} iconType="circle" />
              {selectedSignals.map((sig, i) => (
                <Line
                  key={sig}
                  type="monotone"
                  dataKey={sig}
                  stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  strokeWidth={1.5}
                  dot={false}
                  name={sig}
                  yAxisId={useRightAxis && i === 1 ? 'right' : 'left'}
                  connectNulls
                  isAnimationActive={!isLive}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : isLive ? (
          <div className="flex items-center justify-center" style={{ height }}>
            <span className="text-[var(--text-muted)] flex items-center gap-2">
              <Radio className="h-4 w-4 animate-pulse text-red-500" />
              {t('Waiting for signal data…')}
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-center" style={{ height }}>
            <span className="text-[var(--text-muted)] flex items-center gap-2">
              <Activity className="h-4 w-4" />
              {t('No data for this time range')}
            </span>
          </div>
        )}
      </GlassPanel>
    </FadeIn>
  );
}
