/**
 * ActivityTrendPanel — the page hero. A gap-filled daily bar chart of activity
 * counts across the selected window, so the user can see their busy vs quiet
 * days at a glance. Owns its loading / empty / error states.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, PanelTitle } from '@/components/ui';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ChartTooltip,
  chartGrid,
  axisTickSm,
  EmbeddedChart,
} from '@/components/charts';
import { Icons } from '@/lib/icons';
import { chartTokens } from '@/lib/tokens';
import type { TrendPoint } from './myActivityAnalytics';

export interface ActivityTrendPanelProps {
  data: TrendPoint[];
  isLoading: boolean;
  isError: boolean;
  isEmpty: boolean;
  error: unknown;
  onRetry: () => void;
  className?: string;
}

/** Recharts hover cursor — hoisted so the <Tooltip> prop keeps a stable identity. */
const TOOLTIP_CURSOR = { fill: 'var(--surface-2)', opacity: 0.4 } as const;

/**
 * Stable, non-null error so an `isError` window can never collapse to a blank
 * panel: {@link QueryError} renders `null` for a falsy `error`, so a caller that
 * flags an error without a payload would otherwise leave only the title behind.
 * A bare Error carries no status, so QueryError shows its generic retry state.
 */
const FALLBACK_ERROR = new Error('activity trend failed to load');

/** Coerce a possibly-nullish / NaN / negative count to a finite, non-negative integer. */
function safeCount(value: number | null | undefined): number {
  return Number.isFinite(value) && (value as number) > 0 ? Math.trunc(value as number) : 0;
}

export function ActivityTrendPanel({
  data,
  isLoading,
  isError,
  isEmpty,
  error,
  onRetry,
  className,
}: ActivityTrendPanelProps) {
  const { t } = useTranslation();

  // Sanitise once per data change so recharts never receives a NaN bar and the
  // derived totals can power the chart's accessible name.
  const { rows, days, total } = useMemo(() => {
    const safeRows = (Array.isArray(data) ? data : []).map((point) => ({
      day: point?.day ?? '',
      label: point?.label ?? '—',
      count: safeCount(point?.count),
    }));
    return {
      rows: safeRows,
      days: safeRows.length,
      total: safeRows.reduce((sum, point) => sum + point.count, 0),
    };
  }, [data]);

  return (
    <GlassPanel className={className}>
      <div className="p-4 sm:p-5">
        <PanelTitle className="mb-3 flex items-center gap-2">
          <Icons.analytics className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('activity.myActivity.trend.title', 'Activity over time')}
        </PanelTitle>
        <EmbeddedChart
          title={t('activity.myActivity.trend.title', 'Activity over time')}
          ariaLabel={t(
            'activity.myActivity.trend.aria',
            '{{total}} actions across {{days}} days',
            { total, days },
          )}
          loading={isLoading}
          error={isError ? (error ?? FALLBACK_ERROR) : undefined}
          onRetry={onRetry}
          empty={!isLoading && !isError && (isEmpty || rows.length === 0)}
          emptyMessage={t('activity.myActivity.trend.empty', 'No activity recorded in this window.')}
          data={rows}
          dataColumns={[
            { key: 'label', label: t('activity.myActivity.trend.colDay', 'Day') },
            { key: 'count', label: t('activity.myActivity.trend.series', 'Actions') },
          ]}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows}>
              {chartGrid}
              <XAxis
                dataKey="label"
                tick={axisTickSm}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis tick={axisTickSm} allowDecimals={false} width={32} />
              <Tooltip content={<ChartTooltip />} cursor={TOOLTIP_CURSOR} />
              <Bar
                dataKey="count"
                name={t('activity.myActivity.trend.series', 'Actions')}
                fill={chartTokens.series[5]}
                fillOpacity={0.85}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </EmbeddedChart>
      </div>
    </GlassPanel>
  );
}
