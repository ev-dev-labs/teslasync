import { ParkingCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { StatStrip } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Grid } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';


import type { ParkingSummary } from '../../lib/parkingDwell';
import type { ParkingSectionState } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

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
  const { fmtInt, fmtNumber } = useNumberFormatting();
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
            <StatStrip id="parking-summary" className="col-span-full"
              period={{ kind: 'unknown', label: t('parking.kpis', 'Parking summary metrics'), reason: commonSample }}
              metrics={[
                { metricId: 'text', occurrenceId: 'parked-share', label: t('parking.parkedShare', 'Time parked'),
                  rawValue: summary.parkedShare != null ? `${fmtNumber(summary.parkedShare * 100)}%` : null,
                  context: commonSample },
                { metricId: 'text', occurrenceId: 'night-share', label: t('parking.nightShare', 'Overnight share'),
                  rawValue: summary.nightShare != null ? `${fmtNumber(summary.nightShare * 100)}%` : null,
                  context: t('parking.kpis.overnightSample', '22:00–06:00 · {{count}} stints', { count: summary.stints.length }) },
                { metricId: 'text', occurrenceId: 'longest-stint', label: t('parking.longestStint', 'Longest stint'),
                  rawValue: summary.longestStint ? formatDuration(summary.longestStint.durationMs / 1_000) : null,
                  context: summary.longestStint ? t('parking.kpis.longestSample', '{{location}} · longest of {{count}} stints', {
                    location: summary.longestStint.location ?? t('parking.unknown', 'Unknown location'),
                    count: summary.stints.length,
                  }) : commonSample },
                { metricId: 'count', occurrenceId: 'locations', label: t('parking.locations', 'Locations'), rawValue: knownLocations,
                  context: t('parking.kpis.locationQuality', '{{known}} located · {{missing}} missing', {
                    known: fmtInt(summary.coverage.knownLocationStints), missing: fmtInt(summary.coverage.missingLocationStints),
                  }) },
              ]}
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
