import { CalendarRange } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  CHART_COLORS,
  ChartContainer,
  ChartTooltip,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
  chartGrid,
} from '@/components/charts';
import { useUnits } from '@/hooks/useUnits';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import type { FsdInsights } from '@/types/fsd';

import { bucketSharePct, buildWeekdayPattern } from './helpers';
import type { FsdSectionState } from './types';
import { useFsdWeekdayLabel } from './useFsdWeekdayLabel';

interface FsdWeekdayPatternProps {
  insights: FsdInsights | undefined;
  state: FsdSectionState;
}

/**
 * Day-of-week pattern: which weekdays accumulate supervised self-driving
 * distance, derived from the dense daily series the API already returned.
 *
 * This is a descriptive distribution, not a prediction — the copy and the
 * accessible name say so, and nothing here is presented as behaviour scoring.
 */
export function FsdWeekdayPattern({ insights, state }: FsdWeekdayPatternProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const weekdayLabel = useFsdWeekdayLabel();
  const unitLabel = unitPrefs.distance;

  const rows = useMemo(() => {
    const buckets = buildWeekdayPattern(
      insights?.daily ?? [],
      insights?.quality.share_basis_available ?? false,
    );
    return buckets.map((bucket) => ({
      weekday: bucket.weekday,
      label: weekdayLabel(bucket.weekday),
      distance:
        bucket.fsdDistanceM != null
          ? convertDistanceFromSI(bucket.fsdDistanceM, unitLabel)
          : null,
      share: bucketSharePct(bucket),
      activeDays: bucket.activeDays,
      measuredDays: bucket.measuredDays,
      counterObservationDays: bucket.counterObservationDays,
    }));
  }, [insights, unitLabel, weekdayLabel]);

  const hasData = rows.some((row) => row.distance != null);
  const blocked = state.noVehicle || Boolean(state.error);
  const empty = state.noVehicle || (!state.isLoading && !state.error && !hasData);
  const seriesName = t('fsd.weekday.series', 'Self-driving distance');

  return (
    <section
      aria-label={t('fsd.weekday.section', 'Supervised self-driving by day of week')}
      data-testid="fsd-weekday-pattern"
    >
      <ChartContainer
        title={t('fsd.weekday.title', 'Day-of-week pattern')}
        subtitle={t(
          'fsd.weekday.subtitle',
          'Where supervised self-driving distance lands across the week. Descriptive only.',
        )}
        ariaLabel={t(
          'fsd.weekday.aria',
          'Supervised self-driving distance totalled by day of the week',
        )}
        loading={state.isLoading && !blocked}
        error={state.noVehicle ? undefined : state.error}
        onRetry={state.onRetry}
        empty={empty}
        emptyIcon={<CalendarRange className="h-8 w-8" aria-hidden="true" />}
        emptyMessage={
          state.noVehicle
            ? t('fsd.noVehicle', 'Select a vehicle to see supervised self-driving telemetry.')
            : t(
                'fsd.weekday.empty',
                'The supervised self-driving counter did not report a measurable distance on any weekday.',
              )
        }
        emptyActionTo={
          state.noVehicle
            ? { label: t('fsd.chooseVehicle', 'Choose a vehicle'), to: '/vehicles' }
            : undefined
        }
        height={300}
        exportable={!blocked && !state.isLoading && hasData}
        exportFilename="fsd-weekday-pattern"
        exportData={rows}
        data={blocked ? [] : rows}
        dataColumns={[
          { key: 'label', label: t('fsd.weekday.colDay', 'Weekday') },
          {
            key: 'distance',
            label: seriesName,
            format: (value) =>
              typeof value === 'number'
                ? `${value.toFixed(1)} ${unitLabel}`
                : t('fsd.notReported', 'Not reported'),
          },
          {
            key: 'share',
            label: t('fsd.share.series', 'Self-driving share'),
            format: (value) =>
              typeof value === 'number'
                ? `${fmtNumber(value, 1)}%`
                : t('fsd.notReported', 'Not reported'),
          },
          {
            key: 'measuredDays',
            label: t('fsd.weekday.colMeasuredDays', 'Measured days'),
            format: (value) => fmtInt(value),
          },
          {
            key: 'activeDays',
            label: t('fsd.weekday.colActiveDays', 'Days with distance'),
            format: (value) => fmtInt(value),
          },
        ]}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
            {chartGrid}
            <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} width={52} />
            <Tooltip
              content={
                <ChartTooltip
                  valueFormatter={(value) =>
                    typeof value === 'number'
                      ? t('fsd.trend.value', '{{value}} {{unit}}', {
                          value: value.toFixed(1),
                          unit: unitLabel,
                        })
                      : t('fsd.notReported', 'Not reported')
                  }
                />
              }
            />
            <Bar
              dataKey="distance"
              name={seriesName}
              fill={CHART_COLORS[0]}
              fillOpacity={0.6}
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </ChartContainer>
    </section>
  );
}
