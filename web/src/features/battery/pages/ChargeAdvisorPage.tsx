import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChargingHistory } from '@/api/hooks/useCharging';
import { useDriveHistory } from '@/api/hooks/useDriving';
import { VehicleSelect } from '@/components/forms';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Select } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useVehicleLive } from '@/hooks/useVehicleLive';
import { useTimezone } from '@/lib/timezone';
import type { ChargeAdvisorLiveSnapshot } from '../lib/chargeAdvisor';
import {
  ChargeAdvisorAccounting,
  ChargeAdvisorBurnDistribution,
  ChargeAdvisorChargingProfile,
  ChargeAdvisorChargingTiming,
  ChargeAdvisorCurrentState,
  ChargeAdvisorDailyTrend,
  ChargeAdvisorFrequencySupport,
  ChargeAdvisorKpiBand,
  ChargeAdvisorMethodology,
  ChargeAdvisorReserveSensitivity,
  ChargeAdvisorScenarioChart,
  ChargeAdvisorScenarioDirectory,
  ChargeAdvisorWeekdayProfile,
  type ChargeAdvisorQueryState,
} from '../components/charge-advisor';
import { computeChargeAdvice } from '../lib/chargeAdvisor';

const HISTORY_LIMIT = 1_000;
const TWO_COLUMNS = { default: 1, xl: 2 } as const;

export default function ChargeAdvisorPage() {
  const { t } = useTranslation();
  usePageTitle(t('chargeAdvisor.title', 'Charge Advisor'));

  const { vehicleId } = useSelectedVehicle();
  const { formatEnergy } = useUnits();
  const timeZone = useTimezone('vehicle');
  const vehicleIdStr = vehicleId == null ? undefined : String(vehicleId);
  const drivesQuery = useDriveHistory(vehicleIdStr, HISTORY_LIMIT);
  const chargingQuery = useChargingHistory(vehicleIdStr, HISTORY_LIMIT);
  const live = useVehicleLive(vehicleId ?? undefined);
  const [analysisNowMs] = useState(() => Date.now());
  const [currentStateNowMs, setCurrentStateNowMs] = useState(analysisNowMs);
  const liveUpdatedMs = live.state.lastUpdated?.getTime() ?? null;
  const previousLiveUpdatedMs = useRef(liveUpdatedMs);
  useEffect(() => {
    if (previousLiveUpdatedMs.current === liveUpdatedMs) return;
    previousLiveUpdatedMs.current = liveUpdatedMs;
    setCurrentStateNowMs((previous) => Math.max(previous, Date.now()));
  }, [liveUpdatedMs]);
  const [reserveFloorPct, setReserveFloorPct] = useState(20);

  const drives = useMemo(() => drivesQuery.data ?? [], [drivesQuery.data]);
  const chargingSessions = useMemo(
    () => chargingQuery.data ?? [],
    [chargingQuery.data],
  );
  const liveSnapshot = useMemo<ChargeAdvisorLiveSnapshot>(
    () => ({
      batteryPct: live.state.signalCount > 0 ? live.state.batteryLevel : null,
      observedAtMs: live.state.signalCount > 0 ? live.state.lastUpdated?.getTime() ?? null : null,
      source: live.state.signalCount > 0 ? 'live' : 'unknown',
      retrievalState: live.state.signalCount > 0
        ? live.connected ? 'connected' : 'disconnected'
        : 'unavailable',
      connected: live.state.signalCount > 0 ? live.connected : null,
      isCharging: live.state.signalCount > 0 ? live.state.isCharging : null,
      chargeLimitPct: live.state.signalCount > 0 ? live.state.chargeLimitSoc : null,
    }),
    [live.connected, live.state],
  );
  const analysis = useMemo(
    () => computeChargeAdvice(
      drives,
      chargingSessions,
      liveSnapshot,
      analysisNowMs,
      timeZone,
      {
        historyLimit: HISTORY_LIMIT,
        reserveFloorPct,
        currentStateNowMs,
      },
    ),
    [
      analysisNowMs,
      chargingSessions,
      currentStateNowMs,
      drives,
      liveSnapshot,
      reserveFloorPct,
      timeZone,
    ],
  );

  const driveCached = vehicleId != null && drivesQuery.data !== undefined;
  const chargingCached = vehicleId != null && chargingQuery.data !== undefined;
  const driveAvailable = vehicleId != null && (driveCached || drivesQuery.isSuccess);
  const chargingAvailable = vehicleId != null && (chargingCached || chargingQuery.isSuccess);
  const state: ChargeAdvisorQueryState = {
    vehicleSelected: vehicleId != null,
    isLoading: vehicleId != null && (
      (!driveAvailable && drivesQuery.isLoading)
      || (!chargingAvailable && chargingQuery.isLoading)
    ),
    driveLoading: vehicleId != null && !driveAvailable && drivesQuery.isLoading,
    chargingLoading: vehicleId != null && !chargingAvailable && chargingQuery.isLoading,
    driveAvailable,
    chargingAvailable,
    initialError: !driveCached && drivesQuery.isError
      ? drivesQuery.error
      : !chargingCached && chargingQuery.isError
        ? chargingQuery.error
        : null,
    refreshError: (driveCached && drivesQuery.isError)
      || (chargingCached && chargingQuery.isError)
      ? drivesQuery.error ?? chargingQuery.error
      : null,
    onRetry: () => {
      if (drivesQuery.isError) void drivesQuery.refetch();
      if (chargingQuery.isError) void chargingQuery.refetch();
    },
  };
  const reserveOptions = [10, 20, 30].map((value) => ({
    value: String(value),
    label: t('chargeAdvisor.reserveOption', '{{value}}% planning threshold', { value }),
  }));

  return (
    <PageContainer
      title={t('chargeAdvisor.title', 'Charge Advisor')}
      subtitle={t(
        'chargeAdvisor.subtitle',
        'Historical-use evidence for planning the next complete local day.',
      )}
      actions={(
        <div className="flex flex-wrap items-end gap-2">
          <VehicleSelect />
          <Select
            id="charge-advisor-reserve-floor"
            label={t('chargeAdvisor.reserveLabel', 'Reserve floor')}
            aria-label={t('chargeAdvisor.reserveLabel', 'Reserve floor')}
            value={String(reserveFloorPct)}
            onChange={(event) => setReserveFloorPct(Number(event.target.value))}
            options={reserveOptions}
            size="sm"
          />
        </div>
      )}
    >
      <FadeIn>
        <ChargeAdvisorKpiBand analysis={analysis} state={state} />
      </FadeIn>
      <FadeIn delay={0.05}>
        <ChargeAdvisorCurrentState analysis={analysis} state={state} />
      </FadeIn>
      <FadeIn delay={0.1}>
        <ChargeAdvisorScenarioChart analysis={analysis} state={state} />
      </FadeIn>
      <FadeIn delay={0.15}>
        <ChargeAdvisorScenarioDirectory analysis={analysis} state={state} />
      </FadeIn>
      <FadeIn delay={0.2}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <ChargeAdvisorWeekdayProfile analysis={analysis} state={state} />
          <ChargeAdvisorFrequencySupport analysis={analysis} state={state} />
        </Grid>
      </FadeIn>
      <FadeIn delay={0.25}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <ChargeAdvisorDailyTrend analysis={analysis} state={state} />
          <ChargeAdvisorBurnDistribution analysis={analysis} state={state} />
        </Grid>
      </FadeIn>
      <FadeIn delay={0.3}>
        <ChargeAdvisorReserveSensitivity analysis={analysis} state={state} />
      </FadeIn>
      <FadeIn delay={0.35}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <ChargeAdvisorChargingProfile
            analysis={analysis}
            state={state}
            formatEnergy={formatEnergy}
          />
          <ChargeAdvisorChargingTiming analysis={analysis} state={state} />
        </Grid>
      </FadeIn>
      <FadeIn delay={0.4}>
        <ChargeAdvisorAccounting analysis={analysis} state={state} />
      </FadeIn>
      <FadeIn delay={0.45}>
        <ChargeAdvisorMethodology analysis={analysis} state={state} />
      </FadeIn>
    </PageContainer>
  );
}
