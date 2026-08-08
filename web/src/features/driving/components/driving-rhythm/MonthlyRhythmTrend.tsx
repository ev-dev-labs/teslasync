import { CalendarDays } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartContainer } from '@/components/charts';
import { EmptyState, QueryError } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';

import type { DrivingRhythm } from '../../lib/drivingRhythm';
import { MonthlyRhythmPlot } from './MonthlyRhythmPlot';
import type { DrivingRhythmSectionState } from './types';

function formatMonth(month: string, locale?: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  try {
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC',
    }).format(
      new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1, 12)),
    );
  } catch {
    return month;
  }
}

interface MonthlyRhythmTrendProps {
  summary: DrivingRhythm;
  state: DrivingRhythmSectionState;
}

export function MonthlyRhythmTrend({
  summary,
  state,
}: MonthlyRhythmTrendProps) {
  const { t } = useTranslation();
  const { unitPrefs, formatDistance } = useUnits();
  const drivesName = t('rhythm.monthly.drives', 'Valid drives');
  const scoreName = t(
    'rhythm.monthly.predictability',
    'Predictability score',
  );
  const rows = useMemo(
    () =>
      summary.monthly.map((month) => ({
        month: formatMonth(month.month, unitPrefs.locale),
        drives: month.drives,
        predictability: month.predictability,
        activeDays: month.activeDays,
        activeSlots: month.activeSlots,
        distance: formatDistance(
          month.measuredDistanceDrives > 0 ? month.distanceM : null,
          { precision: 1 },
        ),
      })),
    [formatDistance, summary.monthly, unitPrefs.locale],
  );
  const hasData = rows.length > 0;

  return (
    <section
      aria-label={t(
        'rhythm.sections.monthly',
        'Monthly rhythm and predictability trend',
      )}
      data-testid="driving-rhythm-monthly"
    >
      <ChartContainer
        title={t('rhythm.monthly.title', 'Monthly rhythm & predictability')}
        subtitle={t(
          'rhythm.monthly.subtitle',
          'Drive volume and local-hour concentration by month; scores require at least {{count}} valid drives in that month.',
          { count: summary.minPredictabilityDrives },
        )}
        ariaLabel={t(
          'rhythm.monthly.aria',
          'Monthly valid drive counts and departure-hour predictability scores',
        )}
        loading={state.isLoading}
        empty={false}
        height={370}
        chartKey="driving-rhythm-monthly"
        exportable={!state.error && !state.isLoading && hasData}
        exportFilename="driving-rhythm-monthly"
        exportData={rows}
        data={state.error ? [] : rows}
        dataColumns={[
          { key: 'month', label: t('rhythm.monthly.month', 'Local month') },
          {
            key: 'drives',
            label: drivesName,
            format: (value) => fmtInt(value),
          },
          {
            key: 'predictability',
            label: scoreName,
            format: (value) =>
              typeof value === 'number' ? fmtNumber(value, 0) : '—',
          },
          {
            key: 'activeDays',
            label: t('rhythm.monthly.activeDays', 'Active local days'),
            format: (value) => fmtInt(value),
          },
          {
            key: 'activeSlots',
            label: t('rhythm.monthly.activeSlots', 'Active weekday-hour slots'),
            format: (value) => fmtInt(value),
          },
          {
            key: 'distance',
            label: t('rhythm.monthly.distance', 'Logged distance'),
          },
        ]}
      >
        {({ hiddenSeries }) =>
          state.error ? (
            <div className="flex h-full items-center justify-center">
              <QueryError error={state.error} onRetry={state.onRetry} />
            </div>
          ) : !hasData ? (
            <EmptyState
              className="h-full"
              icon={<CalendarDays className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'rhythm.monthly.empty',
                'No valid local months are available for a trend.',
              )}
            />
          ) : (
            <MonthlyRhythmPlot
              rows={rows}
              isHidden={(key) => hiddenSeries?.isHidden(key) ?? false}
            />
          )
        }
      </ChartContainer>
    </section>
  );
}
