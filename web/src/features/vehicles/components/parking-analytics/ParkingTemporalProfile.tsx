import { Clock3 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartContainer } from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { Subhead } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import { fmtInt } from '@/lib/numberFormat';

import type { ParkingSummary } from '../../lib/parkingDwell';
import { ParkingSectionBody } from './ParkingSectionBody';
import { ParkingStartBarChart } from './ParkingStartBarChart';
import type { ParkingSectionState } from './types';

interface ParkingTemporalProfileProps {
  summary: ParkingSummary;
  state: ParkingSectionState;
  className?: string;
}

/** Local parking-start frequency by hour and weekday. */
export function ParkingTemporalProfile({
  summary,
  state,
  className,
}: ParkingTemporalProfileProps) {
  const { t } = useTranslation();
  const { locale } = useDateFormat();
  const hourRows = useMemo(
    () =>
      summary.hourly.map((bucket) => ({
        label: t('parking.temporal.hourLabel', '{{hour}}:00', {
          hour: String(bucket.hour).padStart(2, '0'),
        }),
        stints: bucket.stints,
      })),
    [summary.hourly, t],
  );
  const weekdayRows = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      timeZone: 'UTC',
    });
    return summary.weekdays.map((bucket) => ({
      label: formatter.format(
        new Date(Date.UTC(2026, 0, 4 + bucket.weekday, 12)),
      ),
      stints: bucket.stints,
    }));
  }, [locale, summary.weekdays]);
  const hasData = summary.stints.length > 0;
  const fallbackRows = hasData
    ? [
        ...hourRows.map((row) => ({
          profile: t('parking.temporal.hourProfile', 'Hour'),
          period: row.label,
          stints: row.stints,
        })),
        ...weekdayRows.map((row) => ({
          profile: t('parking.temporal.weekdayProfile', 'Weekday'),
          period: row.label,
          stints: row.stints,
        })),
      ]
    : [];
  const seriesName = t('parking.temporal.startsSeries', 'Parking starts');

  return (
    <section
      className={className}
      aria-label={t(
        'parking.sections.temporal',
        'Time-of-day and weekday parking profile',
      )}
      data-testid="parking-temporal"
    >
      <ChartContainer
        title={t('parking.temporal.title', 'When Parking Starts')}
        subtitle={t(
          'parking.temporal.subtitle',
          '{{count}} reconstructed starts grouped in {{timeZone}}; dwell is credited to its start period.',
          {
            count: summary.stints.length,
            timeZone: summary.coverage.timeZone,
          },
        )}
        ariaLabel={t(
          'parking.temporal.aria',
          'Bar charts of reconstructed parking starts by local hour and weekday',
        )}
        loading={state.isLoading}
        height={420}
        exportable={!state.error && !state.isLoading && hasData}
        exportFilename="parking-temporal-profile"
        data={state.error ? [] : fallbackRows}
        dataColumns={[
          {
            key: 'profile',
            label: t('parking.temporal.profile', 'Profile'),
          },
          {
            key: 'period',
            label: t('parking.temporal.period', 'Period'),
          },
          {
            key: 'stints',
            label: seriesName,
            format: (value) => fmtInt(value),
          },
        ]}
      >
        <ParkingSectionBody state={state} className="h-full min-h-0">
          {!hasData ? (
            <EmptyState
              className="h-full"
              icon={<Clock3 className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'parking.temporal.empty',
                'No reconstructed parking starts are available for a time profile.',
              )}
            />
          ) : (
            <div className="grid h-full grid-cols-1 gap-5 lg:grid-cols-2">
              <div className="min-w-0">
                <Subhead className="mb-2">
                  {t('parking.temporal.byHour', 'By local hour')}
                </Subhead>
                <ParkingStartBarChart
                  rows={hourRows}
                  seriesName={seriesName}
                  colorIndex={0}
                  interval={3}
                />
              </div>
              <div className="min-w-0">
                <Subhead className="mb-2">
                  {t('parking.temporal.byWeekday', 'By local weekday')}
                </Subhead>
                <ParkingStartBarChart
                  rows={weekdayRows}
                  seriesName={seriesName}
                  colorIndex={2}
                  interval={0}
                />
              </div>
            </div>
          )}
        </ParkingSectionBody>
      </ChartContainer>
    </section>
  );
}
