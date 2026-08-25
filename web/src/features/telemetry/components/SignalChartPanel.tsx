/**
 * SignalChartPanel — multi-line signal chart with dual-axis + live mode.
 *
 * Owns no data fetching; consumers pass `data` (sorted ascending by
 * timestamp) and `selectedSignals`. When `isLive` is true the panel uses
 * the "live" visual treatment (red pulse, event/point counters, no
 * series animation) but the underlying chart structure is identical.
 *
 * The `chartMode` prop controls layout:
 *   - 'overlay' — single LineChart with all series stacked (legacy)
 *   - 'grid'    — SmallMultiplesChart, one cell per series
 *   - 'auto'    — overlay until `gridAutoThreshold` is exceeded, then grid
 *
 * The grid mode keeps the panel header and (for live mode) the pulse
 * indicator, only the chart body swaps. This lets the workspace page
 * stay legible when the user pins many signals at once without forcing
 * them to manage display modes themselves.
 *
 * Used by:
 *   - SignalExplorerPage    (live + historical)
 *   - SignalsWorkspacePage  (live + historical)
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, Radio } from 'lucide-react';

import { GlassPanel, SectionTitle } from '@/components/ui';
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
  ChartLegend,
  ResponsiveContainer,
  SmallMultiplesChart,
  EmbeddedChart,
} from '@/components/charts';
import { CHART_COLORS } from '@/lib/colors';
import { fmtInt } from '@/lib/numberFormat';
import { useDateFormat } from '@/hooks/useDateFormat';
import { cn } from '@/lib/cn';
import type { SignalStat } from '../hooks/useLiveSignalStream';

export type SignalChartMode = 'overlay' | 'grid' | 'auto';

type AccessibleChartValue = string | number | null | undefined;

function toAccessibleChartValue(value: unknown): AccessibleChartValue {
  if (value == null || typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  return String(value);
}

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
  /**
   * Display mode. `'auto'` switches to small-multiples grid once
   * `selectedSignals.length > gridAutoThreshold`. Default `'auto'`.
   */
  chartMode?: SignalChartMode;
  /** Threshold for `chartMode='auto'` to flip overlay → grid. Default 8. */
  gridAutoThreshold?: number;
  /**
   * Cell height for grid mode. Defaults to 140px so a 3-row stack
   * roughly matches the overlay mode's 350px footprint.
   */
  gridCellHeight?: number;
  className?: string;
}

export function SignalChartPanel({
  selectedSignals = [],
  data = [],
  stats = [],
  isLive = false,
  loading = false,
  pointsLoaded,
  liveEventCount,
  title,
  height = 350,
  chartMode = 'auto',
  gridAutoThreshold = 8,
  gridCellHeight = 140,
  className,
}: SignalChartPanelProps) {
  const { t } = useTranslation();
  const { formatTime } = useDateFormat();

  const useRightAxis = useMemo(() => {
    if (!stats || stats.length < 2) return false;
    const ranges = stats.map((s) => Math.abs(s.max - s.min) || 1);
    return ranges[0] / ranges[1] > 10 || ranges[1] / ranges[0] > 10;
  }, [stats]);

  // Resolve auto → overlay/grid. Grid requires at least 2 signals to
  // be meaningful (one cell isn't "small multiples"); for a single
  // signal we always render the larger overlay chart.
  const effectiveMode: 'overlay' | 'grid' = useMemo(() => {
    if (chartMode === 'overlay') return 'overlay';
    if (chartMode === 'grid') return selectedSignals.length >= 2 ? 'grid' : 'overlay';
    return selectedSignals.length > gridAutoThreshold ? 'grid' : 'overlay';
  }, [chartMode, selectedSignals.length, gridAutoThreshold]);

  const resolvedTitle = title ?? (isLive ? t('Live Signal Stream') : t('Signal Chart'));
  const accessibleRows = useMemo(
    () => data.map((point) => {
      const row: Record<string, AccessibleChartValue> = {
        timestamp: toAccessibleChartValue(point.timestamp),
      };
      for (const signal of selectedSignals) {
        row[signal] = toAccessibleChartValue(point[signal]);
      }
      return row;
    }),
    [data, selectedSignals],
  );

  return (
    <FadeIn>
      <GlassPanel className={cn('p-4 sm:p-5', className)}>
        <div className="flex items-center gap-2 mb-4">
          {isLive ? (
            <Radio className="h-4 w-4 text-red-500 animate-pulse" aria-hidden="true" />
          ) : (
            <BarChart3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          )}
          <SectionTitle>{resolvedTitle}</SectionTitle>
          {isLive ? (
            <span className="ml-auto flex items-center gap-1.5 text-2xs text-red-400">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />
              {fmtInt(liveEventCount ?? 0)} {t('events')} · {fmtInt(data.length)} {t('points')}
            </span>
          ) : data.length > 0 && pointsLoaded != null ? (
            <span className="ml-auto text-2xs text-[var(--text-muted)]">
              {fmtInt(pointsLoaded)} {t('points loaded')}
            </span>
          ) : null}
        </div>

        {loading && !isLive ? (
          <div style={{ height }} role="status" aria-label={t('Loading chart…')}>
            <Skeleton className="h-full w-full" />
          </div>
        ) : effectiveMode === 'grid' ? (
          <SmallMultiplesChart
            data={data}
            series={selectedSignals}
            cellHeight={gridCellHeight}
            syncId={`signal-chart-${isLive ? 'live' : 'historical'}`}
          />
        ) : (
          <EmbeddedChart
            chartKey="signal-chart-overlay"
            title={resolvedTitle}
            ariaLabel={isLive
              ? t('signalChart.liveAria', 'Live signal stream chart')
              : t('signalChart.histAria', 'Historical signal chart')}
            loading={loading && !isLive}
            empty={data.length === 0}
            emptyMessage={isLive
              ? t('signalChart.waitingLive', 'Waiting for live signal data…')
              : t('signalChart.emptyRange', 'No signal samples were recorded in this time range.')}
            emptyDescription={isLive
              ? t('signalChart.waitingLiveDescription', 'Samples will appear when the selected vehicle publishes the chosen signals.')
              : t('signalChart.emptyRangeDescription', 'Expand the range or select another signal to inspect available history.')}
            height={height}
            data={accessibleRows}
            dataColumns={[
              { key: 'timestamp', label: t('common.timestamp', 'Timestamp') },
              ...selectedSignals.map((sig) => ({ key: sig, label: sig })),
            ]}
          >
            {({ hiddenSeries }) => (
              <ResponsiveContainer width="100%" height={height}>
                <LineChart data={data} margin={{ top: 10, right: useRightAxis ? 20 : 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis
                    dataKey="timestamp"
                    tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                    tickFormatter={(v: string) => formatTime(v)}
                  />
                  <YAxis yAxisId="left" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  {useRightAxis ? (
                    <YAxis yAxisId="right" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  ) : null}
                  <Tooltip content={<ChartTooltip />} />
                  <ChartLegend />
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
                      hide={hiddenSeries?.isHidden(sig) ?? false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </EmbeddedChart>
        )}
      </GlassPanel>
    </FadeIn>
  );
}
