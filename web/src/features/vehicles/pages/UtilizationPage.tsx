import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDrives } from '@/api/hooks/useDriving';

import { Grid, PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { useFormatting } from '@/hooks/useFormatting';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useDataState } from '@/hooks/useDataState';
import { StaleRefreshWarning } from '@/components/feedback';
import { EmptyState, QueryError } from '@/components/feedback';
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
  const { distanceUnit, formatDistance } = useUtilizationDisplay();
  usePageTitle(t('utilization.title', 'Utilization'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr =
    vehicleId != null ? String(vehicleId) : undefined;
  const { costPerKwh, formatCurrency } = useFormatting();
  const [asOfMs] = useState(() => Date.now());
  const { start, end } = useRangeState({
    persistKey: 'utilization.range',
    defaultPresetId: 'all',
  });

  const drivesQuery = useDrives(vehicleIdStr, {
    start,
    end,
    limit: UTILIZATION_DRIVE_LIMIT,
  });
  const drives = useMemo(
    () => drivesQuery.data ?? [],
    [drivesQuery.data],
  );
  const drivesState = useDataState(drivesQuery, { provenance: 'historical' });
  const summary = useMemo(
    () =>
      summarizeUtilization(drives, costPerKwh, {
        rangeStart: start,
        rangeEnd: end,
        asOfMs,
        historyLimit: UTILIZATION_DRIVE_LIMIT,
      }),
    [asOfMs, costPerKwh, drives, end, start],
  );
  const retry = useCallback(() => {
    void drivesQuery.refetch();
  }, [drivesQuery.refetch]);
  const sectionState = useMemo<UtilizationSectionState>(
    () => ({
      isLoading: drivesQuery.isLoading,
      error: drivesState.fatalError,
      onRetry: retry,
    }),
    [
      drivesState.fatalError,
      drivesQuery.isLoading,
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
            status={drivesState.status} loading={drivesQuery.isLoading}
            provenance={t('utilization.briefSource', 'Returned drive history and configured energy price')}
            scope={t('utilization.briefWindow', 'Requested {{start}} → {{end}}; metrics use the observed window', {
              start: start || t('vehicles.evidenceBrief.unbounded', 'Unbounded'),
              end: end || t('vehicles.evidenceBrief.unbounded', 'Unbounded'),
            })}
            metrics={[
              { metricId: 'percent', occurrenceId: 'driving-share', label: t('utilization.drivingShare', 'Time driving'),
                rawValue: drivesState.data == null || summary.drivingShare == null ? null : summary.drivingShare * 100,
                display: { formatter: raw => ({ value: `${fmtNumber(raw)}%`, unit: '' }) },
                context: t('utilization.ofWindow', 'of the observed window') },
              { metricId: 'percent', occurrenceId: 'active-days', label: t('utilization.activeDays', 'Days used'),
                rawValue: drivesState.data == null || summary.activeDayShare == null ? null : summary.activeDayShare * 100,
                display: { formatter: raw => ({ value: `${fmtNumber(raw)}%`, unit: '' }) },
                context: t('utilization.observedCalendarDays', '{{active}} of {{days}} observed UTC days', {
                  active: fmtInt(summary.consistency.activeDays), days: fmtInt(summary.observedCalendarDays),
                }) },
              { metricId: 'distance', occurrenceId: 'distance-per-day', label: t('utilization.perDay', 'Distance per day'),
                rawValue: drivesState.data == null ? null : summary.distancePerDayM,
                display: { formatter: raw => ({ value: formatDistance(raw), unit: '' }) },
                context: t('utilization.driveCount', '{{count}} drives', { count: summary.drives }) },
              { metricId: 'rate', occurrenceId: 'cost-per-distance', label: t('utilization.costPerKmCard', 'Cost per distance'),
                rawValue: drivesState.data == null ? null : summary.costPerKm,
                display: { formatter: raw => ({ value: `${formatCurrency(raw * convertDistanceToSI(1, distanceUnit) / 1000)}/${distanceUnit}`, unit: '' }) },
                context: <>{t('utilization.energyOnly', 'energy only')}<div>{t('utilization.costInput', 'Source estimate is cost per kilometre before display-unit conversion.')}</div></> },
            ]} />
          {!drivesQuery.isLoading && !sectionState.error && summary.accounting.eligibleRows === 0 ? <EmptyState
            message={t('utilization.noData', 'No drives in this period yet.')}
            actionTo={{ label: t('utilization.browseDrives', 'Browse drives'), to: '/drives' }} /> : null}
        </section>
      </FadeIn>

      <FadeIn delay={0.05}>
        <TimeCostOverview
          summary={summary}
          state={sectionState}
        />
      </FadeIn>

      <FadeIn delay={0.1}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <UtilizationTrend
            summary={summary}
            state={sectionState}
          />
          <WeekdayProfile
            summary={summary}
            state={sectionState}
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.15}>
        <DriveDistributions
          summary={summary}
          state={sectionState}
        />
      </FadeIn>

      <FadeIn delay={0.2}>
        <ActiveDayConsistency
          summary={summary}
          state={sectionState}
        />
      </FadeIn>

      <FadeIn delay={0.25}>
        <BusiestDays
          summary={summary}
          state={sectionState}
        />
      </FadeIn>

      <FadeIn delay={0.3}>
        <UtilizationMethodology
          summary={summary}
          historyLimit={UTILIZATION_DRIVE_LIMIT}
          state={sectionState}
        />
      </FadeIn>
    </PageLayout>
  );
}
