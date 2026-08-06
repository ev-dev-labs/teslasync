/**
 * LiveThroughputPanel — hero visual for the Live Signal Monitor. Plots the
 * live "signals / sec" rate over a rolling window so operators can see the
 * firehose ebb and flow in real time.
 *
 * The series is sampled by `useThroughputHistory` from the same rate the tail
 * reports — it never fetches. Empty and disconnected states are handled here
 * so the panel is always visible.
 */

import { useTranslation } from 'react-i18next';
import { Radio, WifiOff } from 'lucide-react';

import { GlassPanel, PanelTitle, Caption } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { VisuallyHidden } from '@/components/a11y';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ChartTooltip,
} from '@/components/charts';
import { chartTokens } from '@/lib/tokens';
import { formatTime } from '@/lib/dateFormat';
import { fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import type { ThroughputPoint } from '../hooks/useThroughputHistory';

const LINE_COLOR = chartTokens.series[5];
const GRADIENT_ID = 'live-throughput-gradient';
const CHART_MARGIN = { top: 8, right: 12, bottom: 4, left: 0 } as const;

// Stable, module-level formatter so the memoised recharts axis + tooltip
// children don't get a fresh function identity on every ~1 Hz sample tick.
const formatTs = (v: unknown): string => formatTime(v as string);

export interface LiveThroughputPanelProps {
  history: ThroughputPoint[];
  rate: number;
  peak: number;
  connected: boolean;
  className?: string;
}

export function LiveThroughputPanel({
  history,
  rate,
  peak,
  connected,
  className,
}: LiveThroughputPanelProps) {
  const { t } = useTranslation();
  const points = history ?? [];
  const hasData = points.length >= 2;

  return (
    <GlassPanel className={cn('p-4 sm:p-5', className)}>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <PanelTitle className="flex items-center gap-2">
          <Radio
            className={connected ? 'h-4 w-4 text-rose-400' : 'h-4 w-4 text-[var(--text-muted)]'}
            aria-hidden="true"
          />
          {t('liveMonitor.throughputTitle', 'Signal Throughput')}
        </PanelTitle>
        <Caption className="sm:ml-auto">
          {t('liveMonitor.throughputNow', 'Now')}: {fmtInt(rate ?? 0)}/s ·{' '}
          {t('liveMonitor.throughputPeak', 'Peak')}: {fmtInt(peak ?? 0)}/s
        </Caption>
        {/* Text alternative for the colour-only "live" dot so the stream state
            is perceivable without relying on the icon colour. */}
        <VisuallyHidden>
          {connected
            ? t('liveMonitor.streamConnected', 'Live throughput stream connected')
            : t('liveMonitor.streamDisconnected', 'Live throughput stream disconnected')}
        </VisuallyHidden>
      </div>

      <div className="h-56 sm:h-64 xl:h-72">
        {!hasData ? (
          // no-action: transient — SSE auto-reconnects and the page-level banner already surfaces disconnect state; nothing to trigger here.
          <EmptyState
            icon={
              connected ? (
                <Radio className="h-8 w-8" aria-hidden="true" />
              ) : (
                <WifiOff className="h-8 w-8" aria-hidden="true" />
              )
            }
            message={
              connected
                ? t('liveMonitor.throughputWaiting', 'Waiting for live throughput…')
                : t('liveMonitor.throughputOffline', 'Stream disconnected — no live throughput')
            }
          />
        ) : (
          <div
            className="h-full"
            role="img"
            aria-label={t(
              'liveMonitor.throughputAria',
              'Live signals per second over the recent window',
            )}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={CHART_MARGIN}>
                <defs>
                  <linearGradient id={GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={LINE_COLOR} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={LINE_COLOR} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" strokeOpacity={0.4} />
                <XAxis
                  dataKey="ts"
                  tickFormatter={formatTs}
                  tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                  minTickGap={40}
                />
                <YAxis
                  width={32}
                  allowDecimals={false}
                  tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                />
                <Tooltip content={<ChartTooltip />} labelFormatter={formatTs} />
                <Area
                  type="monotone"
                  dataKey="rate"
                  name={t('liveMonitor.sigPerSec', 'Signals / sec')}
                  stroke={LINE_COLOR}
                  strokeWidth={2}
                  fill={`url(#${GRADIENT_ID})`}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </GlassPanel>
  );
}
