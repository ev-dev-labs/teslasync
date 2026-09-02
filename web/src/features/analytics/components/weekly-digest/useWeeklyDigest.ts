import { useState, useMemo, useCallback } from 'react';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useDrives } from '@/api/hooks/useDriving';
import { useChargingSessionsPaginated } from '@/api/hooks/useCharging';
import { useAlertHistory } from '@/api/hooks/useNotifications';
import { useFsdInsightsRange } from '@/api/hooks/useAnalytics';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { formatDateShort } from '@/lib/dateFormat';
import { fmtNumber, safeNumber } from '@/lib/numberFormat';
import { browserTimezone } from '@/lib/timezone';
import { convertDistanceFromSI, convertEnergyFromSI } from '@/lib/unitConversion';

import type {
  Drive, ChargingSession,
  DigestMetrics, FunFact, DailyDistanceEntry, DailyEnergyEntry, AlertPieEntry,
} from './types';
import { DAY_LABELS, ALERT_SEVERITY_COLORS, CO2_PER_KWH_GASOLINE_KG } from './constants';
import { CHART_COLORS } from '@/components/charts';
import { getWeekRange, isInRange, dayOfWeekIndex, findCityPair } from './helpers';

const ANALYTICS_WINDOW_LIMIT = 1000;

function averagePresent(values: Array<number | null | undefined>): number {
  const present = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  return present.length > 0
    ? present.reduce((sum, value) => sum + value, 0) / present.length
    : 0;
}

function efficiencyWhPerM(drives: readonly Drive[]): number {
  const measuredDrives = drives.filter(
    (drive) =>
      Number.isFinite(drive.distanceM)
      && drive.distanceM > 0
      && typeof drive.energyUsedWh === 'number'
      && Number.isFinite(drive.energyUsedWh),
  );
  const distanceM = measuredDrives.reduce(
    (sum, drive) => sum + safeNumber(drive.distanceM),
    0,
  );
  if (distanceM <= 0) return 0;
  const energyWh = measuredDrives.reduce(
    (sum, drive) => sum + safeNumber(drive.energyUsedWh),
    0,
  );
  return energyWh / distanceM;
}

function chargingPowerW(session: ChargingSession): number {
  const reportedPowerW = safeNumber(session.avg_power_w);
  if (reportedPowerW > 0) return reportedPowerW;

  const startMs = Date.parse(session.started_at);
  const endMs = session.ended_at ? Date.parse(session.ended_at) : Number.NaN;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;

  const durationHours = (endMs - startMs) / 3_600_000;
  return durationHours > 0
    ? safeNumber(session.total_energy_added_wh) / durationHours
    : 0;
}

export function useWeeklyDigest() {
  const [weekOffset, setWeekOffset] = useState(0);

  const [weekStart, weekEnd] = useMemo(() => getWeekRange(weekOffset), [weekOffset]);
  const [prevStart, prevEnd] = useMemo(() => getWeekRange(weekOffset - 1), [weekOffset]);

  const weekLabel = useMemo(
    () => `${formatDateShort(weekStart)} – ${formatDateShort(weekEnd)}`,
    [weekStart, weekEnd],
  );

  const isCurrentWeek = weekOffset === 0;

  /* ── Vehicle query ── */
  const { isLoading: vehiclesLoading } = useVehicles();
  const {
    vehicleId,
    vehicles,
    setVehicleId: setSelectedVehicleId,
  } = useSelectedVehicle();

  const vehicleOptions = useMemo(
    () =>
      vehicles.map((v) => ({
        value: String(v.id),
        label: v.display_name || v.vin,
      })),
    [vehicles],
  );

  const selectedVehicleId = vehicleId == null ? '' : String(vehicleId);
  const selectedVehicleNumber = vehicleId;
  const setVehicleId = useCallback(
    (nextId: string) => {
      const parsed = Number(nextId);
      setSelectedVehicleId(Number.isInteger(parsed) && parsed > 0 ? parsed : null);
    },
    [setSelectedVehicleId],
  );

  const queryStart = useMemo(() => prevStart.toISOString(), [prevStart]);
  const queryEndExclusive = useMemo(
    () => new Date(weekEnd.getTime() + 1).toISOString(),
    [weekEnd],
  );

  /* ── Data queries ──
   * Each domain query is surfaced independently so every page section can own
   * its loading / empty / error state (modern-ui §8) instead of gating the
   * whole page behind one combined flag. The drive and charge requests cover
   * exactly the selected + comparison weeks, avoiding the list endpoints'
   * default 50-row page silently dropping older weeks. */
  const drivesQuery = useDrives(selectedVehicleId || undefined, {
    start: queryStart,
    end: queryEndExclusive,
    limit: ANALYTICS_WINDOW_LIMIT,
  });
  const {
    data: drives,
    isLoading: drivesLoading,
    error: drivesError,
    refetch: refetchDrives,
  } = drivesQuery;

  const chargingQuery = useChargingSessionsPaginated(selectedVehicleNumber, {
    start: queryStart,
    end: queryEndExclusive,
    limit: ANALYTICS_WINDOW_LIMIT,
  });
  const {
    data: chargingSessions,
    isLoading: chargingLoading,
    error: chargingError,
    refetch: refetchCharging,
  } = chargingQuery;

  const alertsQuery = useAlertHistory(ANALYTICS_WINDOW_LIMIT);
  const {
    data: alerts,
    isLoading: alertsLoading,
    error: alertsError,
    refetch: refetchAlerts,
  } = alertsQuery;

  const weekStartIso = useMemo(() => weekStart.toISOString(), [weekStart]);
  const fsdQuery = useFsdInsightsRange(
    selectedVehicleId || undefined,
    weekStartIso,
    queryEndExclusive,
    browserTimezone(),
  );
  const {
    data: fsdInsights,
    isLoading: fsdLoading,
    error: fsdError,
    refetch: refetchFsd,
  } = fsdQuery;

  const isLoading = drivesLoading || chargingLoading || alertsLoading;
  const error = drivesError || chargingError || alertsError;

  // Sections show a skeleton (not a flash of empty states) while the vehicle
  // list is still resolving, since the domain queries stay disabled until a
  // vehicle id is available.
  const drivesBusy = drivesLoading || vehiclesLoading;
  const chargingBusy = chargingLoading || vehiclesLoading;
  const alertsBusy = alertsLoading || vehiclesLoading;
  const fsdBusy = fsdLoading || vehiclesLoading;

  /** Representative queries for the page-tier freshness chip (PageContainer). */
  const freshnessQueries = useMemo(
    () => [drivesQuery, chargingQuery, alertsQuery, fsdQuery],
    [drivesQuery, chargingQuery, alertsQuery, fsdQuery],
  );

  /** Refetch every domain query — used by the aggregate KPI bands' retry CTA. */
  const refetchAll = useCallback(() => {
    void refetchDrives();
    void refetchCharging();
    void refetchAlerts();
    void refetchFsd();
  }, [refetchDrives, refetchCharging, refetchAlerts, refetchFsd]);

  /* ── Filter data by week ── */
  const weekDrives = useMemo(
    () => (drives ?? []).filter((drive) => isInRange(drive.startTs, weekStart, weekEnd)),
    [drives, weekStart, weekEnd],
  );

  const prevWeekDrives = useMemo(
    () => (drives ?? []).filter((drive) => isInRange(drive.startTs, prevStart, prevEnd)),
    [drives, prevStart, prevEnd],
  );

  const weekCharging = useMemo(
    () => (chargingSessions ?? []).filter(
      (session) => isInRange(session.started_at, weekStart, weekEnd),
    ),
    [chargingSessions, weekStart, weekEnd],
  );

  const prevWeekCharging = useMemo(
    () => (chargingSessions ?? []).filter(
      (session) => isInRange(session.started_at, prevStart, prevEnd),
    ),
    [chargingSessions, prevStart, prevEnd],
  );

  const weekAlerts = useMemo(
    () => (alerts ?? []).filter(
      (alert) =>
        isInRange(alert.created_at, weekStart, weekEnd)
        && selectedVehicleNumber !== null
        && (alert.vehicle_id === selectedVehicleNumber || alert.vehicle_id === 0),
    ),
    [alerts, selectedVehicleNumber, weekStart, weekEnd],
  );

  /* ── Aggregated metrics ── */
  const metrics: DigestMetrics = useMemo(() => {
    // safeNumber() coerces null / undefined / NaN / ±Infinity to 0 so a single
    // malformed API row can't poison an aggregate into NaN (the fields are typed
    // `number`, but partial telemetry rows can arrive with missing values).
    const totalDistanceM = weekDrives.reduce((sum, drive) => sum + safeNumber(drive.distanceM), 0);
    const prevDistanceM = prevWeekDrives.reduce(
      (sum, drive) => sum + safeNumber(drive.distanceM),
      0,
    );
    const totalDrives = weekDrives.length;
    const prevDriveCount = prevWeekDrives.length;
    const energyUsedWh = weekDrives.reduce(
      (sum, drive) => sum + safeNumber(drive.energyUsedWh),
      0,
    );
    const prevEnergyWh = prevWeekDrives.reduce(
      (sum, drive) => sum + safeNumber(drive.energyUsedWh),
      0,
    );
    const chargingCost = weekCharging.reduce(
      (sum, session) => sum + safeNumber(session.cost_decimal),
      0,
    );
    const prevChargingCost = prevWeekCharging.reduce(
      (sum, session) => sum + safeNumber(session.cost_decimal),
      0,
    );
    const co2Saved =
      convertEnergyFromSI(energyUsedWh, 'kWh') * CO2_PER_KWH_GASOLINE_KG;
    const prevCo2 =
      convertEnergyFromSI(prevEnergyWh, 'kWh') * CO2_PER_KWH_GASOLINE_KG;
    const avgEfficiencyWhPerM = efficiencyWhPerM(weekDrives);
    const prevAvgEfficiencyWhPerM = efficiencyWhPerM(prevWeekDrives);
    const totalDurationS = weekDrives.reduce(
      (sum, drive) => sum + safeNumber(drive.durationS),
      0,
    );
    const topDrive =
      weekDrives.length > 0
        ? weekDrives.reduce((best, drive) =>
            safeNumber(drive.distanceM) > safeNumber(best.distanceM) ? drive : best,
          )
        : undefined;
    const chargeEnergyAddedWh = weekCharging.reduce(
      (sum, session) => sum + safeNumber(session.total_energy_added_wh),
      0,
    );
    const prevChargeEnergyWh = prevWeekCharging.reduce(
      (sum, session) => sum + safeNumber(session.total_energy_added_wh),
      0,
    );
    const chargingPowersW = weekCharging
      .map((session) => chargingPowerW(session))
      .filter((powerW) => powerW > 0);
    const avgChargePowerW = chargingPowersW.length > 0
      ? chargingPowersW.reduce((sum, powerW) => sum + powerW, 0) / chargingPowersW.length
      : 0;
    const batteryStart = averagePresent(weekCharging.map((session) => session.start_soc_pct));
    const batteryEnd = averagePresent(weekCharging.map((session) => session.end_soc_pct));

    const alertsByType: Record<string, number> = {};
    for (const a of weekAlerts) {
      alertsByType[a.severity] = (alertsByType[a.severity] ?? 0) + 1;
    }

    return {
      totalDistanceM,
      prevDistanceM,
      totalDrives,
      prevDriveCount,
      energyUsedWh,
      prevEnergyWh,
      chargingCost,
      prevChargingCost,
      co2Saved,
      prevCo2,
      avgEfficiencyWhPerM,
      prevAvgEfficiencyWhPerM,
      totalDurationS,
      topDrive,
      chargeEnergyAddedWh,
      prevChargeEnergyWh,
      avgChargePowerW,
      chargingSessionCount: weekCharging.length,
      batteryStart,
      batteryEnd,
      alertsByType,
      alertTotal: weekAlerts.length,
    };
  }, [weekDrives, prevWeekDrives, weekCharging, prevWeekCharging, weekAlerts]);

  /* ── Daily distance chart data ── */
  const dailyDistanceData: DailyDistanceEntry[] = useMemo(() => {
    const bins = DAY_LABELS.map((label) => ({ day: label, distanceM: 0 }));
    for (const drive of weekDrives) {
      const idx = dayOfWeekIndex(drive.startTs);
      if (idx < 0) continue;
      bins[idx].distanceM += safeNumber(drive.distanceM);
    }
    return bins;
  }, [weekDrives]);

  /* ── Daily energy added chart data ── */
  const dailyEnergyData: DailyEnergyEntry[] = useMemo(() => {
    const bins = DAY_LABELS.map((label) => ({ day: label, energyWh: 0 }));
    for (const session of weekCharging) {
      const idx = dayOfWeekIndex(session.started_at);
      if (idx < 0) continue;
      bins[idx].energyWh += safeNumber(session.total_energy_added_wh);
    }
    return bins;
  }, [weekCharging]);

  /* ── Alert pie data ── */
  const alertPieData: AlertPieEntry[] = useMemo(() => {
    return Object.entries(metrics.alertsByType).map(([severity, count]) => ({
      name: severity.charAt(0).toUpperCase() + severity.slice(1),
      value: count,
      color: ALERT_SEVERITY_COLORS[severity] ?? CHART_COLORS[4],
    }));
  }, [metrics.alertsByType]);

  /* ── Fun fact ── */
  const funFact: FunFact | undefined = useMemo(() => {
    const totalDistanceKm = convertDistanceFromSI(metrics.totalDistanceM, 'km');
    if (totalDistanceKm < 10) return undefined;
    const pair = findCityPair(totalDistanceKm);
    if (!pair) return undefined;
    const times = totalDistanceKm / pair.km;
    return { from: pair.from, to: pair.to, times: fmtNumber(times, 1) };
  }, [metrics.totalDistanceM]);

  /* ── Navigation callbacks ── */
  const goToPrevWeek = useCallback(() => setWeekOffset((o) => o - 1), []);
  const goToNextWeek = useCallback(() => {
    if (!isCurrentWeek) setWeekOffset((o) => o + 1);
  }, [isCurrentWeek]);

  const hasData = weekDrives.length > 0 || weekCharging.length > 0;

  return {
    weekLabel,
    weekStart,
    isCurrentWeek,
    isLoading,
    error,
    hasData,
    metrics,
    dailyDistanceData,
    dailyEnergyData,
    alertPieData,
    funFact,
    goToPrevWeek,
    goToNextWeek,
    vehicleOptions,
    selectedVehicleId,
    setVehicleId,
    // Per-domain state so each section owns its loading / empty / error.
    drivesLoading: drivesBusy,
    drivesError,
    refetchDrives,
    chargingLoading: chargingBusy,
    chargingError,
    refetchCharging,
    alertsLoading: alertsBusy,
    alertsError,
    refetchAlerts,
    fsdInsights,
    fsdLoading: fsdBusy,
    fsdError,
    refetchFsd,
    refetchAll,
    freshnessQueries,
  };
}
