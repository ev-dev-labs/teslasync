import { Clock3 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartContainer } from '@/components/charts';
import { EmptyState, QueryError } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { convertDistanceFromSI } from '@/lib/unitConversion';

import type { DrivingRhythm } from '../../lib/drivingRhythm';
import { HourlyDistributionPlot } from './HourlyDistributionPlot';
import type { DrivingRhythmSectionState } from './types';

interface HourlyDistributionProps {
  summary: DrivingRhythm;
  state: DrivingRhythmSectionState;
  className?: string;
}

export function HourlyDistribution({
  summary,
  state,
  className,
}: HourlyDistributionProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const driveName = t('rhythm.hourly.drives', 'Drive starts');
  const distanceName = t('rhythm.hourly.distance', 'Logged distance');
  const rows = useMemo(
    () =>
      summary.hourly.map((hour) => ({
        hour: `${String(hour.hour).padStart(2, '0')}:00`,
        drives: hour.drives,
        distance:
          hour.measuredDistanceDrives > 0
            ? Math.round(
                convertDistanceFromSI(
                  hour.distanceM,
                  unitPrefs.distance,
                ) * 10,
              ) / 10
            : null,
        share: Math.round(hour.share * 1_000) / 10,
      })),
    [summary.hourly, unitPrefs.distance],
  );
  const hasData = summary.total > 0;

  return (
    <section
      className={className}
      aria-label={t(
        'rhythm.sections.hourly',
        'Hourly departure distribution',
      )}
      data-testid="driving-rhythm-hourly"
    >
      <ChartContainer
        className="h-full"
        title={t('rhythm.hourly.title', 'Hourly departure distribution')}
        subtitle={t(
          'rhythm.hourly.subtitle',
          'Valid starts by local hour; the distance line shows measured SI distance converted to your display unit.',
        )}
        ariaLabel={t(
          'rhythm.hourly.aria',
          'Drive starts and logged distance across all 24 local departure hours',
        )}
        loading={state.isLoading}
        empty={false}
        height={360}
        chartKey="driving-rhythm-hourly"
        exportable={!state.error && !state.isLoading && hasData}
        exportFilename="driving-rhythm-hourly"
        exportData={rows}
        data={state.error ? [] : rows}
        dataColumns={[
          {
            key: 'hour',
            label: t('rhythm.hourly.hour', 'Local hour'),
          },
          {
            key: 'drives',
            label: driveName,
            format: (value) => fmtInt(value),
          },
          {
            key: 'distance',
            label: `${distanceName} (${unitPrefs.distance})`,
            format: (value) =>
              typeof value === 'number'
                ? `${fmtNumber(value, 1)} ${unitPrefs.distance}`
                : '—',
          },
          {
            key: 'share',
            label: t('rhythm.hourly.share', 'Drive share'),
            format: (value) => `${fmtNumber(value, 1)}%`,
          },
        ]}
      >
        {({ hiddenSeries }) =>
          state.error ? (
            <div className="flex h-full items-center justify-center">
              <QueryError error={state.error} onRetry={state.onRetry} />
            </div>
          ) : !hasData ? (
            <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */
              className="h-full"
              icon={<Clock3 className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'rhythm.hourly.empty',
                'No valid departure hours are available in this window.',
              )}
            />
          ) : (
            <HourlyDistributionPlot
              rows={rows}
              isHidden={(key) => hiddenSeries?.isHidden(key) ?? false}
            />
          )
        }
      </ChartContainer>
    </section>
  );
}
