import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDrives } from '@/api/hooks/useDriving';

import { Grid, PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { useDateFormat } from '@/hooks/useDateFormat';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useDataState } from '@/hooks/useDataState';
import { StaleRefreshWarning } from '@/components/feedback';
import { EmptyState, QueryError } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { VehicleEvidenceBrief } from '../components/operationalbrief-n-z/VehicleEvidenceBrief';

import {
  DurationDistributionChart,
  LongestParkingStints,
  MonthlyDwellTrend,
  OvernightParkingContext,
  ParkingCoverageMethodology,
  ParkingTemporalProfile,
  TopParkingLocations,
  type ParkingSectionState,
} from '../components/parking-analytics';
import {
  PARKING_DRIVE_LIMIT,
  summarizeParking,
} from '../lib/parkingDwell';

const TWO_COLUMNS = { default: 1, xl: 2 } as const;

export default function ParkingAnalyticsPage() {
  const { t } = useTranslation();
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const { formatDuration } = useUnits();
  usePageTitle(t('parking.title', 'Parking analytics'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { tz } = useDateFormat();
  const [pageNowMs] = useState(() => Date.now());
  const { start, end } = useRangeState({
    persistKey: 'parking-analytics.range',
  });

  const drivesQuery = useDrives(vehicleIdStr, {
    start,
    end,
    limit: PARKING_DRIVE_LIMIT,
  });
  const drives = useMemo(() => drivesQuery.data ?? [], [drivesQuery.data]);
  const drivesState = useDataState(drivesQuery, { provenance: 'historical' });
  const summary = useMemo(
    () =>
      summarizeParking(drives, {
        nowMs: pageNowMs,
        rangeStart: start,
        rangeEnd: end,
        timeZone: tz,
        rowLimit: PARKING_DRIVE_LIMIT,
      }),
    [drives, end, pageNowMs, start, tz],
  );
  const onRetry = useCallback(() => {
    void drivesQuery.refetch();
  }, [drivesQuery.refetch]);
  const sectionState = useMemo<ParkingSectionState>(
    () => ({
      isLoading: drivesQuery.isLoading,
      error: drivesState.fatalError,
      onRetry,
    }),
    [
      drivesState.fatalError,
      drivesQuery.isLoading,
      onRetry,
    ],
  );

  if (vehicleId == null) {
    return (
      <NoVehicleSelected pageTitle={t('parking.title', 'Parking analytics')} />
    );
  }

  return (
    <PageLayout
      title={t('parking.title', 'Parking analytics')}
      subtitle={t(
        'parking.subtitle',
        'Where your car spends its time between drives',
      )}
      query={drivesQuery}
    >
      <StaleRefreshWarning state={drivesState} label={t('parking.title', 'Parking analytics')} />
      <FadeIn>
        <section data-testid="parking-kpis" aria-label={t('parking.kpis', 'Parking summary metrics')}>
          {sectionState.error ? <QueryError error={sectionState.error} onRetry={onRetry} /> : null}
          <VehicleEvidenceBrief id="parking-summary"
            title={t('parking.kpis', 'Parking summary metrics')}
            description={t('parking.briefDescription', 'Parking is reconstructed between usable drives, not observed continuously. Missing locations and incomplete history remain explicit.')}
            status={drivesState.status} loading={drivesQuery.isLoading}
            provenance={t('parking.briefSource', 'Drive-derived parking reconstruction')}
            scope={t('parking.briefWindow', '{{sample}} · {{start}} → {{end}} · {{timezone}}', {
              sample: t('parking.kpis.observedSample', '{{drives}} usable drives · {{stints}} reconstructed stints', {
                drives: fmtInt(summary.coverage.validDrives), stints: fmtInt(summary.stints.length),
              }),
              start: start || t('vehicles.evidenceBrief.unbounded', 'Unbounded'),
              end: end || t('vehicles.evidenceBrief.unbounded', 'Unbounded'), timezone: tz,
            })}
            metrics={[
              { metricId: 'percent', occurrenceId: 'parked-share', label: t('parking.parkedShare', 'Time parked'),
                rawValue: drivesState.data == null || summary.parkedShare == null ? null : summary.parkedShare * 100,
                display: { formatter: raw => ({ value: `${fmtNumber(raw)}%`, unit: '' }) },
                context: t('parking.kpis.observedSample', '{{drives}} usable drives · {{stints}} reconstructed stints', {
                  drives: fmtInt(summary.coverage.validDrives), stints: fmtInt(summary.stints.length),
                }) },
              { metricId: 'percent', occurrenceId: 'night-share', label: t('parking.nightShare', 'Overnight share'),
                rawValue: drivesState.data == null || summary.nightShare == null ? null : summary.nightShare * 100,
                display: { formatter: raw => ({ value: `${fmtNumber(raw)}%`, unit: '' }) },
                context: t('parking.kpis.overnightSample', '22:00–06:00 · {{count}} stints', { count: summary.stints.length }) },
              { metricId: 'duration', occurrenceId: 'longest-stint', label: t('parking.longestStint', 'Longest stint'),
                rawValue: drivesState.data == null || !summary.longestStint ? null : summary.longestStint.durationMs / 1000,
                display: { formatter: raw => ({ value: formatDuration(raw), unit: '' }) },
                context: summary.longestStint ? t('parking.kpis.longestSample', '{{location}} · longest of {{count}} stints', {
                  location: summary.longestStint.location ?? t('parking.unknown', 'Unknown location'), count: summary.stints.length,
                }) : null },
              { metricId: 'count', occurrenceId: 'locations', label: t('parking.locations', 'Locations'),
                rawValue: drivesState.data == null ? null : summary.locations.filter(location => location.location != null).length,
                context: t('parking.kpis.locationQuality', '{{known}} located · {{missing}} missing', {
                  known: fmtInt(summary.coverage.knownLocationStints), missing: fmtInt(summary.coverage.missingLocationStints),
                }) },
            ]} />
          {!drivesQuery.isLoading && !sectionState.error && summary.stints.length === 0 ? <EmptyState
            message={t('parking.noData', 'Not enough drives in this period to reconstruct parking.')}
            actionTo={{ label: t('parking.browseDrives', 'Browse drives'), to: '/drives' }} /> : null}
        </section>
      </FadeIn>

      <FadeIn delay={0.05}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <DurationDistributionChart
            summary={summary}
            state={sectionState}
          />
          <OvernightParkingContext summary={summary} state={sectionState} />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.1}>
        <ParkingTemporalProfile summary={summary} state={sectionState} />
      </FadeIn>

      <FadeIn delay={0.15}>
        <MonthlyDwellTrend summary={summary} state={sectionState} />
      </FadeIn>

      <FadeIn delay={0.2}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <TopParkingLocations summary={summary} state={sectionState} />
          <LongestParkingStints summary={summary} state={sectionState} />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.25}>
        <ParkingCoverageMethodology
          summary={summary}
          state={sectionState}
          sourceStatus={drivesState.status}
          hasSource={drivesState.data != null}
          rangeStart={start}
          rangeEnd={end}
        />
      </FadeIn>
    </PageLayout>
  );
}
