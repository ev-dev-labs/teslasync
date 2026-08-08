import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChargingHistory } from '@/api/hooks/useCharging';
import { useDriveHistory } from '@/api/hooks/useDriving';
import { VehicleSelect } from '@/components/forms';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';

import {
  ArrivalSocEvidence,
  BatteryCareKpiBand,
  BatteryCareMethodology,
  CareScoreBreakdown,
  ChargingEnergyMix,
  EndSocDistribution,
  MonthlyCareTrend,
  RankedCareHabits,
  type BatteryCareSectionState,
} from '../components/battery-care';
import {
  BATTERY_CARE_HISTORY_LIMIT,
  computeBatteryCare,
} from '../lib/batteryCare';

const ANALYSIS_COLUMNS = { default: 1, xl: 5 } as const;

export default function BatteryCarePage() {
  const { t } = useTranslation();
  usePageTitle(t('batteryCare.title', 'Battery Care'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const [analysisNowMs] = useState(() => Date.now());

  const sessionsQuery = useChargingHistory(
    vehicleIdStr,
    BATTERY_CARE_HISTORY_LIMIT,
  );
  const drivesQuery = useDriveHistory(
    vehicleIdStr,
    BATTERY_CARE_HISTORY_LIMIT,
  );
  const sessions = useMemo(
    () => sessionsQuery.data ?? [],
    [sessionsQuery.data],
  );
  const drives = useMemo(
    () => drivesQuery.data ?? [],
    [drivesQuery.data],
  );
  const care = useMemo(
    () =>
      computeBatteryCare(sessions, drives, {
        nowMs: analysisNowMs,
        sessionLimit: BATTERY_CARE_HISTORY_LIMIT,
        driveLimit: BATTERY_CARE_HISTORY_LIMIT,
      }),
    [analysisNowMs, drives, sessions],
  );

  if (vehicleId == null) {
    return (
      <NoVehicleSelected
        pageTitle={t('batteryCare.title', 'Battery Care')}
      />
    );
  }

  const chargingState: BatteryCareSectionState = {
    isLoading: sessionsQuery.isLoading,
    error: sessionsQuery.isError ? sessionsQuery.error : null,
    onRetry: () => {
      void sessionsQuery.refetch();
    },
  };
  const driveState: BatteryCareSectionState = {
    isLoading: drivesQuery.isLoading,
    error: drivesQuery.isError ? drivesQuery.error : null,
    onRetry: () => {
      void drivesQuery.refetch();
    },
  };
  const combinedState: BatteryCareSectionState = {
    isLoading: sessionsQuery.isLoading || drivesQuery.isLoading,
    error: sessionsQuery.isError
      ? sessionsQuery.error
      : drivesQuery.isError
        ? drivesQuery.error
        : null,
    onRetry: () => {
      if (sessionsQuery.isError) void sessionsQuery.refetch();
      if (drivesQuery.isError) void drivesQuery.refetch();
    },
  };

  return (
    <PageContainer
      title={t('batteryCare.title', 'Battery Care')}
      subtitle={t(
        'batteryCare.subtitle',
        'How gently your charging habits treat the pack',
      )}
      query={[sessionsQuery, drivesQuery]}
      actions={<VehicleSelect />}
    >
      <FadeIn>
        <BatteryCareKpiBand care={care} state={combinedState} />
      </FadeIn>

      <FadeIn delay={0.05}>
        <Grid cols={ANALYSIS_COLUMNS} gap={4}>
          <CareScoreBreakdown
            care={care}
            state={combinedState}
            className="xl:col-span-3"
          />
          <EndSocDistribution
            care={care}
            state={chargingState}
            className="xl:col-span-2"
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.1}>
        <Grid cols={ANALYSIS_COLUMNS} gap={4}>
          <ChargingEnergyMix
            care={care}
            state={chargingState}
            className="xl:col-span-3"
          />
          <ArrivalSocEvidence
            care={care}
            state={driveState}
            className="xl:col-span-2"
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.15}>
        <MonthlyCareTrend care={care} state={combinedState} />
      </FadeIn>

      <FadeIn delay={0.2}>
        <Grid cols={ANALYSIS_COLUMNS} gap={4}>
          <RankedCareHabits
            care={care}
            state={combinedState}
            className="xl:col-span-3"
          />
          <BatteryCareMethodology
            care={care}
            state={combinedState}
            sessionLimit={BATTERY_CARE_HISTORY_LIMIT}
            driveLimit={BATTERY_CARE_HISTORY_LIMIT}
            className="xl:col-span-2"
          />
        </Grid>
      </FadeIn>
    </PageContainer>
  );
}
