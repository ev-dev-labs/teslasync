import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDriveCalendarHistory } from '@/api/hooks/useDriving';

import { Grid, PageLayout } from '@/components/layout';
import { Button, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { useFormatting } from '@/hooks/useFormatting';
import { useDateFormat } from '@/hooks/useDateFormat';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useDataState } from '@/hooks/useDataState';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { convertDistanceToSI } from '@/lib/unitConversion';
import { useUtilizationDisplay } from '../components/utilization/useUtilizationDisplay';
import { VehicleEvidenceBrief } from '../components/operationalbrief-n-z/VehicleEvidenceBrief';

import {
  ActiveDayConsistency,
  BusiestDays,
  DriveDistributions,
  TimeCostOverview,
  UtilizationMethodology,
  UtilizationTrend,
  WeekdayProfile,
  type UtilizationSectionState,
} from '../components/utilization';
import {
  UTILIZATION_DRIVE_LIMIT,
  summarizeUtilization,
} from '../lib/utilization';

const TWO_COLUMNS = { default: 1, xl: 2 } as const;

export default function UtilizationPage() {
  const { t } = useTranslation();
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const { distanceUnit, formatDistance, formatDay } = useUtilizationDisplay();
  usePageTitle(t('utilization.title', 'Utilization'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr =
    vehicleId != null ? String(vehicleId) : undefined;
  const { costPerKwh, formatCurrency, pricingState } = useFormatting();
  // Pricing has its own source lifecycle; never borrow drive-history trust.
  const availableCostPerKwh = pricingState && !pricingState.hasData ? null : costPerKwh;
  const { tz } = useDateFormat();
  const { start, end, startInstant, endInstantExclusive } = useRangeState({
    persistKey: 'utilization.range',
    defaultPresetId: 'all',
    timezone: tz,
  });
  const scopeKey = JSON.stringify([vehicleId, startInstant, endInstantExclusive]);
  const [clock, setClock] = useState(() => ({ scopeKey, asOfMs: Date.now() }));
  // Freeze refreshes within a scope, but rebase when the header window moves.
  if (clock.scopeKey !== scopeKey) {
    setClock({ scopeKey, asOfMs: Date.now() });
  }
  const asOfMs = clock.asOfMs;

  const drivesQuery = useDriveCalendarHistory(vehicleIdStr, startInstant, endInstantExclusive);
  const drives = useMemo(
    () => drivesQuery.data ?? [],
    [drivesQuery.data],
  );
  const drivesState = useDataState(drivesQuery, {
    provenance: 'historical',
    partial: drivesQuery.isFetching,
  });
  const initialDeferred = drivesState.status === 'initial'
    && (drivesState.isRefreshBlocked || !drivesQuery.isFetching);
  const initialLoading = drivesState.status === 'initial' && !initialDeferred;
  const summary = useMemo(
    () => summarizeUtilization(drives, availableCostPerKwh, {
      rangeStart: start, rangeEnd: end, startInstant, endInstantExclusive,
      timezone: tz, asOfMs,
      // The history hook publishes only after the final server page succeeds.
      historyLimit: Number.POSITIVE_INFINITY,
    }),
    [asOfMs, availableCostPerKwh, drives, end, endInstantExclusive, start, startInstant, tz],
  );
  // Coverage does not erase returned rows or override a retained-source warning.
  const incompleteMeasurements = summary.accounting.eligibleRows > 0 && (
    summary.accounting.usableDurationRows < summary.accounting.eligibleRows ||
    summary.accounting.usableDistanceRows < summary.accounting.eligibleRows ||
    summary.accounting.usableEnergyRows < summary.accounting.eligibleRows
  );
  const summaryStatus = drivesState.status === 'ok' && (
    summary.accounting.historyCapReached || incompleteMeasurements
  ) ? 'partial' : drivesState.status;
  const retry = useCallback(() => {
    void drivesQuery.refetch();
  }, [drivesQuery.refetch]);
  const sectionState = useMemo<UtilizationSectionState>(
    () => ({
      isLoading: initialLoading,
      error: drivesState.fatalError,
      onRetry: retry,
    }),
    [
      drivesState.fatalError,
      initialLoading,
      retry,
    ],
  );

  if (vehicleId == null) {
    return (
      <NoVehicleSelected
        pageTitle={t('utilization.title', 'Utilization')}
      />
    );
  }

  return (
    <PageLayout
      title={t('utilization.title', 'Utilization')}
      subtitle={t(
        'utilization.subtitle',
        'How intensively the car is actually used',
      )}
      query={drivesQuery}
    >
      <StaleRefreshWarning state={drivesState} label={t('utilization.title', 'Utilization')} />
      <FadeIn>
        <section data-testid="utilization-kpis" aria-label={t('utilization.kpis', 'Utilization summary metrics')}
          data-as-of={summary.window.asOfMs} data-start={summary.window.rangeStart} data-end={summary.window.rangeEnd}>
          {sectionState.error ? <QueryError error={sectionState.error} onRetry={retry} /> : null}
          <VehicleEvidenceBrief id="utilization-summary"
            title={t('utilization.kpis', 'Utilization summary metrics')}
            description={t('utilization.briefDescription', 'Drive-derived utilization over the observed window; energy-only cost is an estimate, not a billed total.')}
            status={summaryStatus} loading={initialLoading}
            freshness={initialDeferred ? t('system.outage.awaitingSource', 'This source has not resolved yet; missing evidence is not a confirmed empty result.') : undefined}
            provenance={t('utilization.briefSource', 'Returned drive history and configured energy price')}
            scope={t('utilization.briefWindow', 'Requested {{start}} → {{end}}; metrics use the observed window', {
              start: start ? formatDay(start) : t('vehicles.evidenceBrief.unbounded', 'Unbounded'),
              end: end ? formatDay(end) : t('vehicles.evidenceBrief.unbounded', 'Unbounded'),
            })}
            metrics={[
              { metricId: 'percent', occurrenceId: 'driving-share', label: t('utilization.drivingShare', 'Time driving'),
                rawValue: drivesState.data == null || summary.accounting.usableDurationRows === 0 || summary.drivingShare == null ? null : summary.drivingShare * 100,
                display: { formatter: raw => ({ value: `${fmtNumber(raw)}%`, unit: '' }) },
                context: t('utilization.ofWindow', 'of the observed window') },
              { metricId: 'percent', occurrenceId: 'active-days', label: t('utilization.activeDays', 'Days used'),
                rawValue: drivesState.data == null || summary.activeDayShare == null ? null : summary.activeDayShare * 100,
                display: { formatter: raw => ({ value: `${fmtNumber(raw)}%`, unit: '' }) },
                context: !drivesState.hasData ? t('dataSources.status.pending', 'Pending') : t('utilization.observedCalendarDays', '{{active}} of {{days}} observed calendar days', {
                  active: fmtInt(summary.consistency.activeDays), days: fmtInt(summary.observedCalendarDays),
                }) },
              { metricId: 'distance', occurrenceId: 'distance-per-day', label: t('utilization.perDay', 'Distance per day'),
                rawValue: drivesState.data == null || summary.accounting.usableDistanceRows === 0 ? null : summary.distancePerDayM,
                display: { formatter: raw => ({ value: formatDistance(raw), unit: '' }) },
                context: !drivesState.hasData ? t('dataSources.status.pending', 'Pending') : t('utilization.driveCount', '{{count}} drives', { count: summary.drives }) },
              { metricId: 'rate', occurrenceId: 'cost-per-distance', label: t('utilization.costPerKmCard', 'Cost per distance'),
                rawValue: drivesState.data == null ? null : summary.costPerKm,
                display: { formatter: raw => ({ value: `${formatCurrency(raw * convertDistanceToSI(1, distanceUnit) / 1000)}/${distanceUnit}`, unit: '' }) },
                context: <>{t('utilization.energyOnly', 'energy only')}<div>{t('utilization.costInput', 'Source estimate is cost per kilometre before display-unit conversion.')}</div></> },
            ]} />
          {drivesState.hasData && summary.accounting.eligibleRows === 0 ? <EmptyState
            message={t('utilization.noData', 'No drives in this period yet.')}
            actionTo={{ label: t('utilization.browseDrives', 'Browse drives'), to: '/drives' }} /> : null}
        </section>
      </FadeIn>

      <FadeIn delay={0.05}>
        {pricingState ? (
          <div data-testid="utilization-pricing" role="group"
            aria-label={t('utilization.energyRate', 'Settings electricity rate')}>
            <StaleRefreshWarning state={pricingState}
              label={t('utilization.energyRate', 'Settings electricity rate')} />
            {pricingState.fatalError ? (
              <QueryError error={pricingState.fatalError} onRetry={pricingState.retry ?? undefined} />
            ) : !pricingState.hasData && pricingState.isRefreshBlocked ? (
              <div className="space-y-3" role="status">
                <Text as="p" variant="bodySm" color="secondary">
                  {t('fleetOps.brief.refreshBlocked', 'Refresh paused')}
                  {' · '}
                  {t('system.outage.awaitingSource', 'This source has not resolved yet; missing evidence is not a confirmed empty result.')}
                </Text>
                {pricingState.retry ? <Button variant="secondary" onClick={pricingState.retry}>
                  {t('error.retry', 'Retry')}
                </Button> : null}
              </div>
            ) : pricingState.status === 'initial' ? (
              <div role="status" aria-busy="true"
                aria-label={t('utilization.energyRate', 'Settings electricity rate')}>
                <Skeleton className="h-11" />
              </div>
            ) : null}
          </div>
        ) : null}
      </FadeIn>

      {initialDeferred ? (
        [
          { id: 'utilization-time-cost', title: t('utilization.sections.timeCost', 'Observed time split and energy-only cost ledger') },
          { id: 'utilization-trend', title: t('utilization.sections.trend', 'Monthly utilization trend') },
          { id: 'utilization-weekday', title: t('utilization.sections.weekday', 'Weekday utilization profile') },
          { id: 'utilization-distributions', title: t('utilization.sections.distributions', 'Drive duration and distance distributions') },
          { id: 'utilization-consistency', title: t('utilization.sections.consistency', 'Active-day consistency') },
          { id: 'utilization-busiest', title: t('utilization.sections.busiest', 'Ranked busiest observed days') },
          { id: 'utilization-method', title: t('utilization.sections.method', 'Coverage and methodology') },
        ].map(section => (
          <GlassPanel key={section.id} className="min-w-0 space-y-3 p-6" data-testid={section.id}>
            <PanelTitle>{section.title}</PanelTitle>
            <Text as="p" variant="bodySm" color="secondary" role="status">
              {drivesState.isRefreshBlocked ? <>{t('fleetOps.brief.refreshBlocked', 'Refresh paused')}{' · '}</> : null}
              {t('system.outage.awaitingSource', 'This source has not resolved yet; missing evidence is not a confirmed empty result.')}
            </Text>
            <Button variant="secondary" onClick={retry}>{t('error.retry', 'Retry')}</Button>
          </GlassPanel>
        ))
      ) : <>
      <FadeIn delay={0.05}>
        <TimeCostOverview summary={summary} state={sectionState} hasSource={drivesState.hasData} />
      </FadeIn>

      <FadeIn delay={0.1}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <UtilizationTrend summary={summary} state={sectionState} />
          <WeekdayProfile summary={summary} state={sectionState} />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.15}>
        <DriveDistributions summary={summary} state={sectionState} />
      </FadeIn>

      <FadeIn delay={0.2}>
        <ActiveDayConsistency summary={summary} state={sectionState} />
      </FadeIn>

      <FadeIn delay={0.25}>
        <BusiestDays summary={summary} state={sectionState} />
      </FadeIn>

      <FadeIn delay={0.3}>
        <UtilizationMethodology
          summary={summary}
          historyLimit={UTILIZATION_DRIVE_LIMIT}
          state={sectionState}
          sourceStatus={drivesState.status}
          hasSource={drivesState.data != null}
        />
      </FadeIn>
      </>}
    </PageLayout>
  );
}
