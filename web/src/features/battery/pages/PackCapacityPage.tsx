import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChargingHistory } from '@/api/hooks/useCharging';
import { VehicleSelect } from '@/components/forms';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useTimezone } from '@/lib/timezone';
import type { ChargingSession } from '@/types/charging';

import {
  PackCapacityAccounting,
  PackCapacityCoverage,
  PackCapacityDirectory,
  PackCapacityEstimateTimeline,
  PackCapacityEvidenceSupport,
  PackCapacityFitDiagnostics,
  PackCapacityInfluenceTimeline,
  PackCapacityInnovationProfile,
  PackCapacityKpiBand,
  PackCapacityMethodology,
  PackCapacityMonthTrend,
  PackCapacityProcessSensitivity,
  PackCapacitySocWindowProfile,
  PackCapacityWindowSensitivity,
  type PackCapacityQueryState,
} from '../components/pack-capacity';
import {
  analyzePackCapacity,
  DEFAULT_CAPACITY_SOC_WINDOW_PCT,
  DEFAULT_PACK_CAPACITY_HISTORY_LIMIT,
  DEFAULT_PROCESS_NOISE_WH_PER_SQRT_DAY,
} from '../lib/packCapacity';

const TWO_COLUMNS = { default: 1, xl: 2 } as const;

export default function PackCapacityPage() {
  const { t, i18n } = useTranslation();
  usePageTitle(t('packCapacity.title', 'Pack Capacity'));

  const { vehicleId } = useSelectedVehicle();
  const selectedTimeZone = useTimezone('vehicle');
  const { unitPrefs, formatEnergy } = useUnits();
  const vehicleIdStr =
    vehicleId != null ? String(vehicleId) : undefined;
  const sessionsQuery = useChargingHistory(
    vehicleIdStr,
    DEFAULT_PACK_CAPACITY_HISTORY_LIMIT,
  );
  const [nowMs] = useState(() => Date.now());
  const [minSocWindowPct, setMinSocWindowPct] = useState(
    DEFAULT_CAPACITY_SOC_WINDOW_PCT,
  );
  const [
    processNoiseWhPerSqrtDay,
    setProcessNoiseWhPerSqrtDay,
  ] = useState(DEFAULT_PROCESS_NOISE_WH_PER_SQRT_DAY);

  const sessions = useMemo<ChargingSession[]>(
    () => (vehicleId != null ? sessionsQuery.data ?? [] : []),
    [sessionsQuery.data, vehicleId],
  );
  const result = useMemo(
    () =>
      analyzePackCapacity(
        sessions,
        nowMs,
        selectedTimeZone,
        {
          minSocWindowPct,
          processNoiseWhPerSqrtDay,
          historyLimit: DEFAULT_PACK_CAPACITY_HISTORY_LIMIT,
        },
      ),
    [
      minSocWindowPct,
      nowMs,
      processNoiseWhPerSqrtDay,
      selectedTimeZone,
      sessions,
    ],
  );

  const vehicleSelected = vehicleId != null;
  const hasData =
    vehicleSelected && sessionsQuery.data !== undefined;
  const dataAvailable =
    vehicleSelected && (hasData || sessionsQuery.isSuccess);
  const isLoading =
    vehicleSelected
    && !dataAvailable
    && (sessionsQuery.isLoading || sessionsQuery.isFetching);
  const initialError =
    vehicleSelected && !hasData && sessionsQuery.isError
      ? sessionsQuery.error
      : null;
  const refreshError =
    hasData && sessionsQuery.isError
      ? sessionsQuery.error
      : null;
  const state: PackCapacityQueryState = {
    vehicleSelected,
    isLoading,
    isResolved:
      vehicleSelected
      && (
        dataAvailable
        || (!isLoading && sessionsQuery.isError)
      ),
    error: initialError,
    refreshError,
    onRetry: () => {
      void sessionsQuery.refetch();
    },
  };
  const locale = i18n.language;
  const energyUnit = unitPrefs.energy;

  return (
    <PageContainer
      title={t('packCapacity.title', 'Pack Capacity')}
      subtitle={t(
        'packCapacity.subtitle',
        'Charging-derived capacity evidence, uncertainty, sensitivity, diagnostics, and exact row accounting',
      )}
      actions={<VehicleSelect />}
    >
      <FadeIn>
        <PackCapacityKpiBand
          result={result}
          state={state}
          locale={locale}
          formatEnergy={formatEnergy}
          minSocWindowPct={minSocWindowPct}
          processNoiseWhPerSqrtDay={processNoiseWhPerSqrtDay}
          onMinSocWindowChange={setMinSocWindowPct}
          onProcessNoiseChange={setProcessNoiseWhPerSqrtDay}
        />
      </FadeIn>

      <FadeIn delay={0.05}>
        <PackCapacityEstimateTimeline
          result={result}
          state={state}
          locale={locale}
          energyUnit={energyUnit}
        />
      </FadeIn>

      <FadeIn delay={0.1}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <PackCapacityMonthTrend
            result={result}
            state={state}
            locale={locale}
            energyUnit={energyUnit}
          />
          <PackCapacitySocWindowProfile
            result={result}
            state={state}
            energyUnit={energyUnit}
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.15}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <PackCapacityWindowSensitivity
            result={result}
            state={state}
            energyUnit={energyUnit}
          />
          <PackCapacityProcessSensitivity
            result={result}
            state={state}
            energyUnit={energyUnit}
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.2}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <PackCapacityInnovationProfile
            result={result}
            state={state}
          />
          <PackCapacityInfluenceTimeline
            result={result}
            state={state}
            locale={locale}
            energyUnit={energyUnit}
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.25}>
        <PackCapacityFitDiagnostics
          result={result}
          state={state}
          locale={locale}
          energyUnit={energyUnit}
          formatEnergy={formatEnergy}
        />
      </FadeIn>

      <FadeIn delay={0.3}>
        <PackCapacityDirectory
          result={result}
          state={state}
          locale={locale}
          formatEnergy={formatEnergy}
        />
      </FadeIn>

      <FadeIn delay={0.35}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <PackCapacityCoverage
            result={result}
            state={state}
            locale={locale}
          />
          <PackCapacityEvidenceSupport
            result={result}
            state={state}
            locale={locale}
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.4}>
        <PackCapacityAccounting
          result={result}
          state={state}
          locale={locale}
        />
      </FadeIn>

      <FadeIn delay={0.45}>
        <PackCapacityMethodology result={result} />
      </FadeIn>
    </PageContainer>
  );
}
