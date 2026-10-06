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

import {
  ActiveDayConsistency,
  BusiestDays,
  DriveDistributions,
  TimeCostOverview,
  UtilizationKpis,
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
  usePageTitle(t('utilization.title', 'Utilization'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr =
    vehicleId != null ? String(vehicleId) : undefined;
  const { costPerKwh } = useFormatting();
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
        <UtilizationKpis summary={summary} {...sectionState} />
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
