import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDrives } from '@/api/hooks/useDriving';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { useFormatting } from '@/hooks/useFormatting';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';

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
  const { start, end, setRange } = useRangeState({
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
      error: drivesQuery.isError ? drivesQuery.error : null,
      onRetry: retry,
    }),
    [
      drivesQuery.error,
      drivesQuery.isError,
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
    <PageContainer
      title={t('utilization.title', 'Utilization')}
      subtitle={t(
        'utilization.subtitle',
        'How intensively the car is actually used',
      )}
      query={drivesQuery}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <VehicleSelect />
          <RangePicker
            value={{ start, end }}
            onChange={setRange}
            align="end"
            triggerTestId="utilization-range"
          />
        </div>
      }
    >
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
    </PageContainer>
  );
}
