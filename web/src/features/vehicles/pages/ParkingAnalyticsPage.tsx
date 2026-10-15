import { useCallback, useMemo } from 'react';
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
import { AlertBanner, EmptyState, QueryError, StaleRefreshWarning } from '@/components/feedback';
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
  const { start, end, startInstant, endInstantExclusive, timezone } = useRangeState({
    persistKey: 'parking-analytics.range',
    timezone: tz,
  });

  const drivesQuery = useDrives(vehicleIdStr, {
    start: startInstant,
    end: endInstantExclusive,
    limit: PARKING_DRIVE_LIMIT,
  });
  const drives = useMemo(() => drivesQuery.data ?? [], [drivesQuery.data]);
  // This is the client acceptance time, not a server completeness watermark.
  // Retained snapshots keep their edge; a new snapshot or scope renews the fallback.
  const sourceNowMs = useMemo(
    () => Number.isFinite(drivesQuery.dataUpdatedAt) && drivesQuery.dataUpdatedAt > 0
      ? drivesQuery.dataUpdatedAt
      : Date.now(),
    [drivesQuery.dataUpdatedAt, drives, vehicleIdStr, startInstant, endInstantExclusive, timezone],
  );
  const drivesState = useDataState(drivesQuery, { provenance: 'historical' });
  const awaitingSource = drivesState.status === 'initial' && !drivesState.hasData;
  const loadingSource = awaitingSource && !drivesState.isRefreshBlocked
    && (drivesQuery.isFetching || drivesQuery.isLoading);
  const refreshPaused = drivesState.isRefreshBlocked && !drivesState.fatalError
    && !drivesState.refreshError;
  const summary = useMemo(
    () =>
      summarizeParking(drives, {
        nowMs: sourceNowMs,
        startInstant,
        endInstantExclusive,
        timeZone: timezone,
        rowLimit: PARKING_DRIVE_LIMIT,
      }),
    [drives, endInstantExclusive, sourceNowMs, startInstant, timezone],
  );
  const summaryStatus =
    drivesState.status === 'ok' && summary.coverage.possiblyCapped
      ? 'partial'
      : drivesState.status;
  const onRetry = useCallback(() => {
    void drivesQuery.refetch();
  }, [drivesQuery.refetch]);
  const sectionState = useMemo<ParkingSectionState>(
    () => ({
      isLoading: awaitingSource,
      error: drivesState.fatalError,
      onRetry,
    }),
    [
      drivesState.fatalError,
      awaitingSource,
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
      <StaleRefreshWarning state={drivesState} label={t('parking.title', 'Parking analytics')}
        title={refreshPaused ? t('dataSources.status.paused', 'Refresh paused') : undefined}
        message={refreshPaused ? t('dataSources.staleMessage', 'Previously loaded data remains visible while affected sources recover.') : undefined} />
      {awaitingSource && refreshPaused ? (
        <AlertBanner variant="info" role="status" title={t('dataSources.status.paused', 'Refresh paused')}>
          {t('system.outage.awaitingSource', 'This source has not resolved yet; missing evidence is not a confirmed empty result.')}
        </AlertBanner>
      ) : null}
      <FadeIn>
        <section data-testid="parking-kpis" aria-label={t('parking.kpis', 'Parking summary metrics')}>
          {sectionState.error ? <QueryError error={sectionState.error} onRetry={onRetry} /> : null}
          <VehicleEvidenceBrief id="parking-summary"
            title={t('parking.kpis', 'Parking summary metrics')}
            description={t('parking.briefDescription', 'Parking is reconstructed between usable drives, not observed continuously. Missing locations and incomplete history remain explicit.')}
            status={summaryStatus} loading={loadingSource}
            freshness={refreshPaused ? t('dataSources.status.paused', 'Refresh paused') : undefined}
            provenance={t('parking.briefSource', 'Drive-derived parking reconstruction')}
            scope={t('parking.briefWindow', '{{sample}} · {{start}} → {{end}} · {{timezone}}', {
              sample: t('parking.kpis.observedSample', '{{drives}} usable drives · {{stints}} reconstructed stints', {
                drives: fmtInt(summary.coverage.validDrives), stints: fmtInt(summary.stints.length),
              }),
              start: start || t('vehicles.evidenceBrief.unbounded', 'Unbounded'),
              end: end || t('vehicles.evidenceBrief.unbounded', 'Unbounded'), timezone,
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
          {drivesState.hasData && !sectionState.error && summary.stints.length === 0 ? <EmptyState
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
          hasSource={drivesState.hasData}
          rangeStart={startInstant}
          rangeEnd={endInstantExclusive}
        />
      </FadeIn>
    </PageLayout>
  );
}
