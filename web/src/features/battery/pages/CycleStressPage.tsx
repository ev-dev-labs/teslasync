import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChargingHistory } from '@/api/hooks/useCharging';
import { useDriveHistory } from '@/api/hooks/useDriving';
import { VehicleSelect } from '@/components/forms';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useTimezone } from '@/lib/timezone';
import type { ChargingSession } from '@/types/charging';
import type { Drive } from '@/types/driving';

import {
  CycleStressAccounting,
  CycleStressComposition,
  CycleStressContinuity,
  CycleStressDepthDistribution,
  CycleStressDirectory,
  CycleStressDurationProfile,
  CycleStressEvidenceSupport,
  CycleStressExponentSensitivity,
  CycleStressKpiBand,
  CycleStressMeanSocProfile,
  CycleStressMethodology,
  CycleStressMonthTrend,
  CycleStressSourceCoverage,
  CycleStressThresholdSensitivity,
  CycleStressTurningPointTimeline,
  type CycleStressQueryState,
} from '../components/cycle-stress';
import {
  analyzeCycleStress,
  DEEP_CYCLE_THRESHOLD_PCT,
  DEFAULT_CYCLE_HISTORY_LIMIT,
  DEPTH_STRESS_EXPONENT,
  type CycleSource,
} from '../lib/cycleStress';

const TWO_COLUMNS = { default: 1, xl: 2 } as const;

export default function CycleStressPage() {
  const { t, i18n } = useTranslation();
  usePageTitle(t('cycleStress.title', 'Cycle Stress'));

  const { vehicleId } = useSelectedVehicle();
  const selectedTimeZone = useTimezone('vehicle');
  const vehicleIdStr =
    vehicleId != null ? String(vehicleId) : undefined;
  const sessionsQuery = useChargingHistory(
    vehicleIdStr,
    DEFAULT_CYCLE_HISTORY_LIMIT,
  );
  const drivesQuery = useDriveHistory(
    vehicleIdStr,
    DEFAULT_CYCLE_HISTORY_LIMIT,
  );
  const [nowMs] = useState(() => Date.now());
  const [deepThresholdPct, setDeepThresholdPct] = useState(
    DEEP_CYCLE_THRESHOLD_PCT,
  );
  const [exponent, setExponent] = useState(DEPTH_STRESS_EXPONENT);

  const sessions = useMemo<ChargingSession[]>(
    () => (vehicleId != null ? sessionsQuery.data ?? [] : []),
    [sessionsQuery.data, vehicleId],
  );
  const drives = useMemo<Drive[]>(
    () => (vehicleId != null ? drivesQuery.data ?? [] : []),
    [drivesQuery.data, vehicleId],
  );
  const result = useMemo(
    () =>
      analyzeCycleStress(
        sessions,
        drives,
        nowMs,
        selectedTimeZone,
        {
          deepThresholdPct,
          exponent,
          historyLimit: DEFAULT_CYCLE_HISTORY_LIMIT,
        },
      ),
    [
      deepThresholdPct,
      drives,
      exponent,
      nowMs,
      selectedTimeZone,
      sessions,
    ],
  );

  const vehicleSelected = vehicleId != null;
  const hasSessionData =
    vehicleSelected && sessionsQuery.data !== undefined;
  const hasDriveData =
    vehicleSelected && drivesQuery.data !== undefined;
  const sessionAvailable =
    vehicleSelected && (hasSessionData || sessionsQuery.isSuccess);
  const driveAvailable =
    vehicleSelected && (hasDriveData || drivesQuery.isSuccess);
  const sessionLoading =
    vehicleSelected
    && !sessionAvailable
    && (sessionsQuery.isLoading || sessionsQuery.isFetching);
  const driveLoading =
    vehicleSelected
    && !driveAvailable
    && (drivesQuery.isLoading || drivesQuery.isFetching);
  const failedSources: CycleSource[] = [];
  if (sessionsQuery.isError && !hasSessionData) {
    failedSources.push('charging');
  }
  if (drivesQuery.isError && !hasDriveData) {
    failedSources.push('drive');
  }
  const loadingSources: CycleSource[] = [];
  if (sessionLoading) loadingSources.push('charging');
  if (driveLoading) loadingSources.push('drive');
  const anyAvailable = sessionAvailable || driveAvailable;
  const allSettled = !sessionLoading && !driveLoading;
  const initialError =
    vehicleSelected
    && !anyAvailable
    && allSettled
    && failedSources.length > 0
      ? sessionsQuery.error ?? drivesQuery.error
      : null;
  const refreshError =
    anyAvailable
    && (
      (sessionsQuery.isError && hasSessionData)
      || (drivesQuery.isError && hasDriveData)
    )
      ? sessionsQuery.error ?? drivesQuery.error
      : null;
  const retry = () => {
    if (sessionsQuery.isError || !sessionAvailable) {
      void sessionsQuery.refetch();
    }
    if (drivesQuery.isError || !driveAvailable) {
      void drivesQuery.refetch();
    }
  };
  const state: CycleStressQueryState = {
    vehicleSelected,
    isLoading:
      vehicleSelected
      && !anyAvailable
      && loadingSources.length > 0,
    isResolved:
      vehicleSelected && (anyAvailable || allSettled),
    error: initialError,
    refreshError,
    failedSources,
    loadingSources,
    onRetry: retry,
  };
  const locale = i18n.language;

  return (
    <PageContainer
      title={t('cycleStress.title', 'Cycle Stress')}
      subtitle={t(
        'cycleStress.subtitle',
        'Continuity-bounded SoC cycle reconstruction, sensitivity, source coverage, and accounting',
      )}
      actions={<VehicleSelect />}
    >
      <FadeIn>
        <CycleStressKpiBand
          result={result}
          state={state}
          locale={locale}
          deepThresholdPct={deepThresholdPct}
          exponent={exponent}
          onDeepThresholdChange={setDeepThresholdPct}
          onExponentChange={setExponent}
        />
      </FadeIn>

      <FadeIn delay={0.05}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <CycleStressDepthDistribution result={result} state={state} />
          <CycleStressMonthTrend
            result={result}
            state={state}
            locale={locale}
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.1}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <CycleStressThresholdSensitivity
            result={result}
            state={state}
          />
          <CycleStressExponentSensitivity
            result={result}
            state={state}
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.15}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <CycleStressMeanSocProfile result={result} state={state} />
          <CycleStressDurationProfile result={result} state={state} />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.2}>
        <CycleStressComposition
          result={result}
          state={state}
          locale={locale}
        />
      </FadeIn>

      <FadeIn delay={0.25}>
        <CycleStressTurningPointTimeline
          result={result}
          state={state}
          locale={locale}
        />
      </FadeIn>

      <FadeIn delay={0.3}>
        <CycleStressDirectory
          result={result}
          state={state}
          locale={locale}
        />
      </FadeIn>

      <FadeIn delay={0.35}>
        <CycleStressSourceCoverage
          result={result}
          state={state}
          locale={locale}
        />
      </FadeIn>

      <FadeIn delay={0.4}>
        <CycleStressContinuity
          result={result}
          state={state}
          locale={locale}
        />
      </FadeIn>

      <FadeIn delay={0.45}>
        <CycleStressEvidenceSupport
          result={result}
          state={state}
          locale={locale}
        />
      </FadeIn>

      <FadeIn delay={0.5}>
        <CycleStressAccounting
          result={result}
          state={state}
          locale={locale}
        />
      </FadeIn>

      <FadeIn delay={0.55}>
        <CycleStressMethodology result={result} />
      </FadeIn>
    </PageContainer>
  );
}
