import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { EmptyState, QueryError } from '@/components/feedback';
import {
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from '@/components/charts';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { chartTokens } from '@/lib/tokens';
import { fmtNumber } from '@/lib/numberFormat';
import type { TimelineRow } from '../lib/rootCauseIntelligence';

const CHART_KEY = 'diagnostics-root-cause-timeline';

function formatTick(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export interface RootCauseSignalTimelineChartProps {
  timeline: TimelineRow[];
  seriesNames: string[];
  focalSignal: string;
  hasChosenSignal: boolean;
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
}

/**
 * Normalized multi-signal timeline: the focal signal plus its bounded set
 * of related candidates, each independently min-max normalized to [0,1] so
 * series on very different physical scales (temperature, voltage, percent)
 * stay visually comparable. Ranking itself uses the raw robust statistics
 * elsewhere in the analysis — this view is for visual pattern-spotting
 * only.
 */
export function RootCauseSignalTimelineChart({
  timeline,
  seriesNames,
  focalSignal,
  hasChosenSignal,
  isLoading,
  isError,
  error,
  onRetry,
  className,
}: RootCauseSignalTimelineChartProps) {
  const { t } = useTranslation();
  const hidden = useHiddenSeries(CHART_KEY);

  const dataColumns = [
    {
      key: 'time',
      label: t('rootCauseIntelligence.timeline.col.time', 'Time'),
      format: (value: unknown) => (typeof value === 'string' ? formatTick(value) : '—'),
    },
    ...seriesNames.map((name) => ({
      key: name,
      label: name,
      format: (value: unknown) => (typeof value === 'number' ? fmtNumber(value, 2) : '—'),
    })),
  ];

  if (!isLoading && !isError && timeline.length === 0) {
    return (
      <GlassPanel className={className ?? 'p-4 sm:p-5'}>
        <EmptyState /* no-action: the timeline appears once a focal signal with resolved history is chosen. */
          icon={<Activity className="h-8 w-8" />}
          message={
            hasChosenSignal
              ? t('rootCauseIntelligence.timeline.notEnough', 'Not enough history yet for this signal and window.')
              : t('rootCauseIntelligence.timeline.pickOne', 'Choose a signal above to see its normalized timeline.')
          }
        />
      </GlassPanel>
    );
  }

  if (isError) {
    return (
      <GlassPanel className={className ?? 'p-4 sm:p-5'}>
        <QueryError error={error} onRetry={onRetry} />
      </GlassPanel>
    );
  }

  return (
    <ChartContainer
      title={t('rootCauseIntelligence.timeline.title', 'Normalized Signal Timeline')}
      subtitle={t('rootCauseIntelligence.timeline.subtitle', 'Each series independently scaled to 0–1 for visual comparison; ranking uses the raw robust statistics, not this view')}
      ariaLabel={t('rootCauseIntelligence.timeline.ariaLabel', 'Line chart of the focal signal and its related candidates, each independently normalized to a 0 to 1 scale')}
      ariaDescription={t('rootCauseIntelligence.timeline.ariaDescription', '{{count}} series shown; the focal signal is {{focal}}', { count: seriesNames.length, focal: focalSignal })}
      loading={isLoading}
      height={340}
      chartKey={CHART_KEY}
      data={timeline}
      dataColumns={dataColumns}
      className={className}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={timeline}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
          <XAxis dataKey="time" tickFormatter={formatTick} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} minTickGap={40} />
          <YAxis domain={[0, 1]} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
          <Tooltip content={<ChartTooltip />} />
          <ChartLegend state={hidden} />
          {seriesNames.map((name, i) => (
            <Line
              key={name}
              type="monotone"
              dataKey={name}
              name={name}
              stroke={chartTokens.series[i % chartTokens.series.length]}
              strokeWidth={name === focalSignal ? 2.5 : 1.5}
              dot={false}
              connectNulls={false}
              hide={hidden.isHidden(name)}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
