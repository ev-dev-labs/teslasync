import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChargingHistory } from '@/api/hooks/useCharging';
import { useDriveCalendarHistory, useDriveHistory } from '@/api/hooks/useDriving';

import { CardGrid, PageLayout } from '@/components/layout';
import { AlertBanner, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { Select } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useRangeState } from '@/hooks/useRangeState';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { isLiveFieldFresh, liveFieldAge, LIVE_FRESHNESS_MS, useVehicleLive } from '@/hooks/useVehicleLive';
import { calendarRangeToInstants } from '@/lib/dateRange';
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
import { chargeAdvisorCoverageWindow, computeChargeAdvice, validSoc } from '../lib/chargeAdvisor';

const HISTORY_LIMIT = 1_000;
const CURRENT_STATE_CLOCK_INTERVAL_MS = 60_000;

export default function ChargeAdvisorPage() {
  const { t } = useTranslation();
  usePageTitle(t('chargeAdvisor.title', 'Charge Advisor'));

  const { vehicleId } = useSelectedVehicle();
  const operationalMode = useOperationalMode();
  const liveRecommendationsBlocked = operationalMode.mode !== 'live';
  const { formatEnergy } = useUnits();
  const timeZone = useTimezone('vehicle');
  const { startInstant, endInstantExclusive } = useRangeState({ timezone: timeZone });
  const vehicleIdStr = vehicleId == null ? undefined : String(vehicleId);
  const historyWindow = { start: startInstant, end: endInstantExclusive };
  const drivesQuery = useDriveHistory(vehicleIdStr, HISTORY_LIMIT, historyWindow);
  const chargingQuery = useChargingHistory(vehicleIdStr, HISTORY_LIMIT, historyWindow);
  const driveSource = useDataState(drivesQuery, { provenance: 'historical' });
  const chargingSource = useDataState(chargingQuery, { provenance: 'historical' });
  const live = useVehicleLive(vehicleId ?? undefined);
  const [analysisNowMs] = useState(() => Date.now());
  // The scenario gate needs independently established complete drive
  // coverage. The paginated calendar fetch below spans the whole analysis
  // window, so its success certifies every complete date in it (drives or
  // certified absence) — a capped history list alone cannot.
  const coverageWindow = useMemo(
    () => chargeAdvisorCoverageWindow(analysisNowMs, timeZone),
    [analysisNowMs, timeZone],
  );
  const coverageBounds = useMemo(
    () => calendarRangeToInstants({
      startDate: coverageWindow.startDate,
      endDate: coverageWindow.lastCompleteDate,
      timezone: timeZone,
    }),
    [coverageWindow, timeZone],
  );
  const coverageQuery = useDriveCalendarHistory(
    vehicleIdStr, coverageBounds.startInstant, coverageBounds.endInstantExclusive,
  );
  const coveredLocalDates = useMemo(
    () => (vehicleIdStr != null && coverageQuery.isSuccess
      ? coverageWindow.coveredLocalDates
      : []),
    [coverageQuery.isSuccess, coverageWindow, vehicleIdStr],
  );
  const [currentStateNowMs, setCurrentStateNowMs] = useState(analysisNowMs);
  const liveUpdatedMs = live.state.lastUpdated?.getTime() ?? null;
  const previousLiveUpdatedMs = useRef(liveUpdatedMs);
  useEffect(() => {
    if (previousLiveUpdatedMs.current === liveUpdatedMs) return;
    previousLiveUpdatedMs.current = liveUpdatedMs;
    setCurrentStateNowMs((previous) => Math.max(previous, Date.now()));
  }, [liveUpdatedMs]);
  useEffect(() => {
    if (vehicleId == null) return;
    // Age retained observations without shifting the historical analysis window.
    const timer = window.setInterval(() => {
      setCurrentStateNowMs((previous) => Math.max(previous, Date.now()));
    }, CURRENT_STATE_CLOCK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [vehicleId]);
  const [reserveFloorPct, setReserveFloorPct] = useState(20);

  const drives = useMemo(() => drivesQuery.data ?? [], [drivesQuery.data]);
  const chargingSessions = useMemo(
    () => chargingQuery.data ?? [],
    [chargingQuery.data],
  );
  const liveSnapshot = useMemo<ChargeAdvisorLiveSnapshot>(
    () => ({
      batteryPct: live.state.batteryLevelObservation.value,
      observedAtMs: live.state.advisorProvenance.batteryLevel?.observedAtMs ?? null,
      source: live.state.batteryLevelObservation.present ? 'live' : 'unknown',
      retrievalState: live.state.signalCount > 0
        ? live.connected ? 'connected' : 'disconnected'
        : 'unavailable',
      connected: live.state.signalCount > 0 ? live.connected : null,
      isCharging: isLiveFieldFresh(live.state.advisorProvenance.isCharging, currentStateNowMs)
        ? live.state.isChargingObservation.value : null,
      chargeLimitPct: isLiveFieldFresh(live.state.advisorProvenance.chargeLimitSoc, currentStateNowMs)
        ? live.state.chargeLimitSocObservation.value : null,
    }),
    [currentStateNowMs, live.connected, live.state],
  );
  const analysis = useMemo(
    () => {
      const options = {
        historyLimit: HISTORY_LIMIT,
        reserveFloorPct,
        currentStateNowMs,
        coveredLocalDates,
      };
      let result = computeChargeAdvice(
        drives, chargingSessions, liveSnapshot, analysisNowMs, timeZone, options,
      );
      // Endpoint fallback remains two days; only a selected live SoC uses two minutes.
      if (result.current.source === 'live') {
        result = computeChargeAdvice(
          drives, chargingSessions, liveSnapshot, analysisNowMs, timeZone,
          { ...options, fallbackMaxAgeMs: LIVE_FRESHNESS_MS },
        );
        result = {
          ...result,
          current: { ...result.current, ageMs: liveFieldAge(live.state.advisorProvenance.batteryLevel, currentStateNowMs) },
        };
        if (!isLiveFieldFresh(live.state.advisorProvenance.batteryLevel, currentStateNowMs)) {
          result = { ...result, current: { ...result.current, freshness: 'stale' }, guidance: 'stale' };
        }
      }
      const isCharging = isLiveFieldFresh(live.state.advisorProvenance.isCharging, currentStateNowMs)
        ? live.state.isChargingObservation.value : null;
      const rawChargeLimitPct = isLiveFieldFresh(live.state.advisorProvenance.chargeLimitSoc, currentStateNowMs)
        ? live.state.chargeLimitSocObservation.value : null;
      // Keep the model's sanitization: a fresh but invalid limit is unknown, never a raw value.
      const chargeLimitPct = validSoc(rawChargeLimitPct) ? rawChargeLimitPct : null;
      // Neither retained live signals nor completed endpoints are an as-of advice contract.
      if (liveRecommendationsBlocked) {
        return {
          ...result,
          current: {
            ...result.current,
            freshness: result.current.batteryPct == null ? 'unavailable' as const : 'stale' as const,
            connected: null,
            retrievalState: 'unknown' as const,
            isCharging: null,
            chargeLimitPct: null,
          },
          guidance: result.current.batteryPct == null ? 'current_state_unavailable' as const : 'stale' as const,
        };
      }
      return {
        ...result,
        current: { ...result.current, isCharging, chargeLimitPct },
        guidance: isCharging === true ? 'already_charging' as const : result.guidance,
      };
    },
    [
      analysisNowMs,
      chargingSessions,
      coveredLocalDates,
      currentStateNowMs,
      drives,
      liveSnapshot,
      live.state,
      liveRecommendationsBlocked,
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
    initialError: driveSource.fatalError ?? chargingSource.fatalError,
    refreshError: driveSource.refreshError ?? chargingSource.refreshError,
    onRetry: () => {
      if (drivesQuery.isError) void drivesQuery.refetch();
      if (chargingQuery.isError) void chargingQuery.refetch();
      if (coverageQuery.isError) void coverageQuery.refetch();
    },
  };
  const reserveOptions = [10, 20, 30].map((value) => ({
    value: String(value),
    label: t('chargeAdvisor.reserveOption', '{{value}}% planning threshold', { value }),
  }));

  return (
    <PageLayout
      title={t('chargeAdvisor.title', 'Charge Advisor')}
      subtitle={t(
        'chargeAdvisor.subtitle',
        'Historical-use evidence for planning the next complete local day.',
      )}
      contextActions={(
        <div className="flex flex-wrap items-end gap-2">
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
      {liveRecommendationsBlocked && (
        <AlertBanner
          variant="warning"
          role="status"
          data-testid="charge-advisor-operational-notice"
          title={t('chargeAdvisor.kpis.currentStale', 'Displayed as stale; guidance is blocked')}
        >
          {operationalMode.label}
          {' '}{operationalMode.writeBlockReason}
        </AlertBanner>
      )}
      <FadeIn>
        <ChargeAdvisorKpiBand analysis={analysis} state={state} />
      </FadeIn>
      {state.vehicleSelected && driveSource.isRefreshBlocked && !driveSource.refreshError && (
        <StaleRefreshWarning
          state={driveSource}
          label={t('chargeAdvisor.accounting.drives', 'Drive rows')}
          hideRetry={Boolean(state.initialError || state.refreshError)}
        />
      )}
      {state.vehicleSelected && chargingSource.isRefreshBlocked && !chargingSource.refreshError && (
        <StaleRefreshWarning
          state={chargingSource}
          label={t('chargeAdvisor.accounting.charging', 'Charging rows')}
          hideRetry={Boolean(state.initialError || state.refreshError)}
        />
      )}
      <FadeIn delay={0.05}>
        <ChargeAdvisorCurrentState analysis={analysis} state={state} provenance={liveRecommendationsBlocked ? {} : live.state.advisorProvenance} />
      </FadeIn>
      <FadeIn delay={0.1}>
        <ChargeAdvisorScenarioChart analysis={analysis} state={state} />
      </FadeIn>
      <FadeIn delay={0.15}>
        <ChargeAdvisorScenarioDirectory analysis={analysis} state={state} />
      </FadeIn>
      <FadeIn delay={0.2}>
        <CardGrid label={t('chargeAdvisor.weekdayEvidence', 'Weekday and frequency evidence')} items={[
          { id: 'advisor-weekday-profile', size: 'half', content: <ChargeAdvisorWeekdayProfile analysis={analysis} state={state} /> },
          { id: 'advisor-frequency-support', size: 'half', content: <ChargeAdvisorFrequencySupport analysis={analysis} state={state} /> },
        ]} />
      </FadeIn>
      <FadeIn delay={0.25}>
        <CardGrid label={t('chargeAdvisor.burnEvidence', 'Daily trend and consumption distribution')} items={[
          { id: 'advisor-daily-trend', size: 'half', content: <ChargeAdvisorDailyTrend analysis={analysis} state={state} /> },
          { id: 'advisor-burn-distribution', size: 'half', content: <ChargeAdvisorBurnDistribution analysis={analysis} state={state} /> },
        ]} />
      </FadeIn>
      <FadeIn delay={0.3}>
        <ChargeAdvisorReserveSensitivity analysis={analysis} state={state} />
      </FadeIn>
      <FadeIn delay={0.35}>
        <CardGrid label={t('chargeAdvisor.chargingEvidence', 'Charging profile and timing')} items={[
          { id: 'advisor-charging-profile', size: 'half', content: <ChargeAdvisorChargingProfile
            analysis={analysis}
            state={state}
            formatEnergy={formatEnergy}
          /> },
          { id: 'advisor-charging-timing', size: 'half', content: <ChargeAdvisorChargingTiming analysis={analysis} state={state} /> },
        ]} />
      </FadeIn>
      <FadeIn delay={0.4}>
        <ChargeAdvisorAccounting analysis={analysis} state={state} />
      </FadeIn>
      <FadeIn delay={0.45}>
        <ChargeAdvisorMethodology analysis={analysis} state={state} />
      </FadeIn>
    </PageLayout>
  );
}
