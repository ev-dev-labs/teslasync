import { MapPin, Moon, ParkingCircle, Timer } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Grid } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';

import type { ParkingSummary } from '../../lib/parkingDwell';
import type { ParkingSectionState } from './types';

const KPI_COLUMNS = { default: 2, xl: 4 } as const;

interface ParkingKpiBandProps extends ParkingSectionState {
  summary: ParkingSummary;
}

/** Four headline metrics, each labelled with its observed sample. */
export function ParkingKpiBand({
  summary,
  isLoading,
  error,
  onRetry,
}: ParkingKpiBandProps) {
  const { t } = useTranslation();
  const { formatDuration } = useUnits();
  const knownLocations = summary.locations.filter(
    (location) => location.location != null,
  ).length;
  const commonSample = t(
    'parking.kpis.observedSample',
    '{{drives}} usable drives · {{stints}} reconstructed stints',
    {
      drives: fmtInt(summary.coverage.validDrives),
      stints: fmtInt(summary.stints.length),
    },
  );

  return (
    <section
      aria-label={t('parking.kpis', 'Parking summary metrics')}
      data-testid="parking-kpis"
    >
      <Grid cols={KPI_COLUMNS} gap={4}>
        {error ? (
          <GlassPanel className="col-span-full p-4 sm:p-5">
            <QueryError error={error} onRetry={onRetry} />
          </GlassPanel>
        ) : isLoading ? (
          Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} height={96} className="rounded-xl" />
          ))
        ) : (
          <>
            <MetricCard
              label={t('parking.parkedShare', 'Time Parked')}
              value={
                summary.parkedShare != null
                  ? `${fmtNumber(summary.parkedShare * 100, 0)}%`
                  : '—'
              }
              subtitle={commonSample}
              icon={<ParkingCircle className="h-5 w-5" aria-hidden="true" />}
              color="cyan"
            />
            <MetricCard
              label={t('parking.nightShare', 'Overnight Share')}
              value={
                summary.nightShare != null
                  ? `${fmtNumber(summary.nightShare * 100, 0)}%`
                  : '—'
              }
              subtitle={t(
                'parking.kpis.overnightSample',
                '22:00–06:00 · {{count}} stints',
                { count: summary.stints.length },
              )}
              icon={<Moon className="h-5 w-5" aria-hidden="true" />}
              color="purple"
            />
            <MetricCard
              label={t('parking.longestStint', 'Longest Stint')}
              value={
                summary.longestStint
                  ? formatDuration(summary.longestStint.durationMs / 1_000, {
                      precision: 1,
                    })
                  : '—'
              }
              subtitle={
                summary.longestStint
                  ? t(
                      'parking.kpis.longestSample',
                      '{{location}} · longest of {{count}} stints',
                      {
                        location:
                          summary.longestStint.location
                          ?? t('parking.unknown', 'Unknown location'),
                        count: summary.stints.length,
                      },
                    )
                  : commonSample
              }
              icon={<Timer className="h-5 w-5" aria-hidden="true" />}
              color="amber"
            />
            <MetricCard
              label={t('parking.locations', 'Locations')}
              value={fmtInt(knownLocations)}
              subtitle={t(
                'parking.kpis.locationQuality',
                '{{known}} located · {{missing}} missing',
                {
                  known: fmtInt(summary.coverage.knownLocationStints),
                  missing: fmtInt(summary.coverage.missingLocationStints),
                },
              )}
              icon={<MapPin className="h-5 w-5" aria-hidden="true" />}
              color="green"
            />
            {summary.stints.length === 0 ? (
              <EmptyState
                className="col-span-full py-6"
                icon={<ParkingCircle className="h-7 w-7" aria-hidden="true" />}
                message={t(
                  'parking.noData',
                  'Not enough drives in this period to reconstruct parking.',
                )}
                actionTo={{
                  label: t('parking.browseDrives', 'Browse drives'),
                  to: '/drives',
                }}
              />
            ) : null}
          </>
        )}
      </Grid>
    </section>
  );
}
