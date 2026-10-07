import { Gauge } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Area,
  AreaChart,
  CHART_COLORS,
  ChartContainer,
  ChartGradient,
  ChartTooltip,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
  chartGrid,
} from '@/components/charts';
import { useUnits } from '@/hooks/useUnits';
import { formatDayKey } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import type { FsdInsights } from '@/types/fsd';

import { hasAnyShare } from './helpers';
import type { FsdSectionState } from './types';

interface FsdShareTrendProps {
  insights: FsdInsights | undefined;
  state: FsdSectionState;
}

/**
 * Adoption trend: what share of each day's observed driving distance the
 * supervised self-driving counter accounted for.
 *
 * Days without a denominator are `null`, and `connectNulls={false}` renders
 * them as gaps — an interpolated line there would assert an adoption level the
 * telemetry never reported.
 */
export function FsdShareTrend({ insights, state }: FsdShareTrendProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const days = useMemo(() => insights?.daily ?? [], [insights]);

  const rows = useMemo(
    () =>
      days.map((day) => ({
        date: day.date,
        label: formatDayKey(day.date, { locale: unitPrefs.locale, style: 'short' }),
        share: day.fsd_share_pct,
      })),
    [days, unitPrefs.locale],
  );

  const hasData = hasAnyShare(days);
  const blocked = state.noVehicle || Boolean(state.error);
  const empty = state.noVehicle || (!state.isLoading && !state.error && !hasData);
  const seriesName = t('fsd.share.series', 'Self-driving share');

  return (
    <section
      aria-label={t('fsd.share.section', 'Supervised self-driving adoption trend')}
      data-testid="fsd-share-trend"
    >
      <ChartContainer
        title={t('fsd.share.title', 'Usage share trend')}
        subtitle={t(
          'fsd.share.subtitle',
          'Supervised self-driving distance as a percentage of observed driving distance.',
        )}
        ariaLabel={t(
          'fsd.share.aria',
          'Daily percentage of observed driving distance covered by supervised self-driving',
        )}
        loading={state.isLoading && !blocked}
        error={state.noVehicle ? undefined : state.error}
        onRetry={state.onRetry}
        empty={empty}
        emptyIcon={<Gauge className="h-8 w-8" aria-hidden="true" />}
        emptyMessage={
          state.noVehicle
            ? t('fsd.noVehicle', 'Select a vehicle to see supervised self-driving telemetry.')
            : t(
                'fsd.share.empty',
                'Usage share needs aligned self-driving and observed-driving counters for this period.',
              )
        }
        emptyActionTo={
          state.noVehicle
            ? { label: t('fsd.chooseVehicle', 'Choose a vehicle'), to: '/vehicles' }
            : undefined
        }
        height={300}
        exportable={!blocked && !state.isLoading && hasData}
        exportFilename="fsd-usage-share"
        exportData={rows}
        data={blocked ? [] : rows}
        dataColumns={[
          { key: 'label', label: t('fsd.trend.colDay', 'Local day') },
          {
            key: 'share',
            label: seriesName,
            format: (value) => (typeof value === 'number' ? `${fmtNumber(value, 1)}%` : '—'),
          },
        ]}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 12, right: 8, left: -16, bottom: 0 }}>
            <defs>
              <ChartGradient id="fsdShareFill" color={CHART_COLORS[2]} opacity={0.45} />
            </defs>
            {chartGrid}
            <XAxis
              dataKey="label"
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              minTickGap={24}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              domain={[0, 100]}
              width={44}
            />
            <Tooltip
              content={
                <ChartTooltip
                  valueFormatter={(value) =>
                    typeof value === 'number' ? `${fmtNumber(value, 1)}%` : '—'
                  }
                />
              }
            />
            <Area
              type="monotone"
              dataKey="share"
              name={seriesName}
              stroke={CHART_COLORS[2]}
              strokeWidth={2.5}
              fill="url(#fsdShareFill)"
              connectNulls={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartContainer>
    </section>
  );
}
