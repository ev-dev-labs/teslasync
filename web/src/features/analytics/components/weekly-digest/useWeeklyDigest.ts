import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useVehicles } from '@/api/hooks/useVehicles';
import { request } from '@/api/client';
import { formatDateShort } from '@/lib/dateFormat';
import { fmtNumber, safeNumber } from '@/lib/numberFormat';

import type {
  Drive, ChargingSession, Alert,
  DigestMetrics, FunFact, DailyDistanceEntry, DailyEnergyEntry, AlertPieEntry,
} from './types';
import { DAY_LABELS, ALERT_SEVERITY_COLORS, CO2_PER_KWH_GASOLINE_KG } from './constants';
import { CHART_COLORS } from '@/components/charts';
import { getWeekRange, isInRange, dayOfWeekIndex, findCityPair } from './helpers';

export function useWeeklyDigest() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [vehicleId, setVehicleId] = useState<string>('');

  const [weekStart, weekEnd] = useMemo(() => getWeekRange(weekOffset), [weekOffset]);
  const [prevStart, prevEnd] = useMemo(() => getWeekRange(weekOffset - 1), [weekOffset]);

  const weekLabel = useMemo(
    () => `${formatDateShort(weekStart)} – ${formatDateShort(weekEnd)}`,
    [weekStart, weekEnd],
  );

  const isCurrentWeek = weekOffset === 0;

  /* ── Vehicle query ── */
  const { data: vehicles, isLoading: vehiclesLoading } = useVehicles();

  const vehicleOptions = useMemo(
    () =>
      (vehicles ?? []).map((v) => ({
        value: String(v.id),
        label: v.display_name || v.vin,
      })),
    [vehicles],
  );

  const selectedVehicleId = vehicleId || String(vehicles?.[0]?.id ?? '');

  /* ── Data queries ──
   * Each domain query is surfaced independently so every page section can own
   * its loading / empty / error state (modern-ui §8) instead of gating the
   * whole page behind one combined flag. */
  const drivesQuery = useQuery({
    queryKey: ['drives', selectedVehicleId],
    queryFn: () => request<Drive[]>(`/drives?vehicle_id=${selectedVehicleId}`),
    enabled: !!selectedVehicleId,
  });
  const {
    data: drives,
    isLoading: drivesLoading,
    error: drivesError,
    refetch: refetchDrives,
  } = drivesQuery;

  const chargingQuery = useQuery({
    queryKey: ['charging', selectedVehicleId],
    queryFn: () => request<ChargingSession[]>(`/charging?vehicle_id=${selectedVehicleId}`),
    enabled: !!selectedVehicleId,
  });
  const {
    data: chargingSessions,
    isLoading: chargingLoading,
    error: chargingError,
    refetch: refetchCharging,
  } = chargingQuery;

  const alertsQuery = useQuery({
    queryKey: ['alerts', selectedVehicleId],
    queryFn: () => request<Alert[]>('/alerts'),
    enabled: !!selectedVehicleId,
  });
  const {
    data: alerts,
    isLoading: alertsLoading,
    error: alertsError,
    refetch: refetchAlerts,
  } = alertsQuery;

  const isLoading = drivesLoading || chargingLoading || alertsLoading;
  const error = drivesError || chargingError || alertsError;

  // Sections show a skeleton (not a flash of empty states) while the vehicle
  // list is still resolving, since the domain queries stay disabled until a
  // vehicle id is available.
  const drivesBusy = drivesLoading || vehiclesLoading;
  const chargingBusy = chargingLoading || vehiclesLoading;
  const alertsBusy = alertsLoading || vehiclesLoading;

  /** Representative queries for the page-tier freshness chip (PageContainer). */
  const freshnessQueries = useMemo(
    () => [drivesQuery, chargingQuery, alertsQuery],
    [drivesQuery, chargingQuery, alertsQuery],
  );

  /** Refetch every domain query — used by the aggregate KPI bands' retry CTA. */
  const refetchAll = useCallback(() => {
    void refetchDrives();
    void refetchCharging();
    void refetchAlerts();
  }, [refetchDrives, refetchCharging, refetchAlerts]);

  /* ── Filter data by week ── */
  const weekDrives = useMemo(
    () => (drives ?? []).filter((d) => isInRange(d.start_date, weekStart, weekEnd)),
    [drives, weekStart, weekEnd],
  );

  const prevWeekDrives = useMemo(
    () => (drives ?? []).filter((d) => isInRange(d.start_date, prevStart, prevEnd)),
    [drives, prevStart, prevEnd],
  );

  const weekCharging = useMemo(
    () => (chargingSessions ?? []).filter((c) => isInRange(c.start_ts, weekStart, weekEnd)),
    [chargingSessions, weekStart, weekEnd],
  );

  const prevWeekCharging = useMemo(
    () => (chargingSessions ?? []).filter((c) => isInRange(c.start_ts, prevStart, prevEnd)),
    [chargingSessions, prevStart, prevEnd],
  );

  const weekAlerts = useMemo(
    () => (alerts ?? []).filter((a) => isInRange(a.created_at, weekStart, weekEnd)),
    [alerts, weekStart, weekEnd],
  );

  /* ── Aggregated metrics ── */
  const metrics: DigestMetrics = useMemo(() => {
    // safeNumber() coerces null / undefined / NaN / ±Infinity to 0 so a single
    // malformed API row can't poison an aggregate into NaN (the fields are typed
    // `number`, but partial telemetry rows can arrive with missing values).
    const totalDistance = weekDrives.reduce((s, d) => s + safeNumber(d.distance), 0);
    const prevDistance = prevWeekDrives.reduce((s, d) => s + safeNumber(d.distance), 0);
    const totalDrives = weekDrives.length;
    const prevDriveCount = prevWeekDrives.length;
    const energyUsed = weekDrives.reduce((s, d) => s + safeNumber(d.energy_used), 0);
    const prevEnergy = prevWeekDrives.reduce((s, d) => s + safeNumber(d.energy_used), 0);
    const chargingCost = weekCharging.reduce((s, c) => s + safeNumber(c.cost), 0);
    const prevChargingCost = prevWeekCharging.reduce((s, c) => s + safeNumber(c.cost), 0);
    const co2Saved = energyUsed * CO2_PER_KWH_GASOLINE_KG;
    const prevCo2 = prevEnergy * CO2_PER_KWH_GASOLINE_KG;
    const avgEfficiency =
      totalDrives > 0
        ? weekDrives.reduce((s, d) => s + safeNumber(d.efficiency_wh_km), 0) / totalDrives
        : 0;
    const prevAvgEfficiency =
      prevDriveCount > 0
        ? prevWeekDrives.reduce((s, d) => s + safeNumber(d.efficiency_wh_km), 0) / prevDriveCount
        : 0;
    const totalDuration = weekDrives.reduce((s, d) => s + safeNumber(d.duration_min), 0);
    const topDrive =
      weekDrives.length > 0
        ? weekDrives.reduce((best, d) =>
            safeNumber(d.distance) > safeNumber(best.distance) ? d : best,
          )
        : undefined;
    const chargeEnergyAdded = weekCharging.reduce(
      (s, c) => s + safeNumber(c.total_energy_added_wh),
      0,
    );
    const prevChargeEnergy = prevWeekCharging.reduce(
      (s, c) => s + safeNumber(c.total_energy_added_wh),
      0,
    );
    const avgChargeRate =
      weekCharging.length > 0
        ? weekCharging.reduce(
            (s, c) =>
              s + (c.duration_min > 0 ? (safeNumber(c.total_energy_added_wh) / c.duration_min) * 60 : 0),
            0,
          ) / weekCharging.length
        : 0;
    const batteryStart =
      weekCharging.length > 0
        ? weekCharging.reduce((s, c) => s + safeNumber(c.start_battery_pct), 0) / weekCharging.length
        : 0;
    const batteryEnd =
      weekCharging.length > 0
        ? weekCharging.reduce((s, c) => s + safeNumber(c.end_battery_pct), 0) / weekCharging.length
        : 0;

    const alertsByType: Record<string, number> = {};
    for (const a of weekAlerts) {
      alertsByType[a.severity] = (alertsByType[a.severity] ?? 0) + 1;
    }

    return {
      totalDistance,
      prevDistance,
      totalDrives,
      prevDriveCount,
      energyUsed,
      prevEnergy,
      chargingCost,
      prevChargingCost,
      co2Saved,
      prevCo2,
      avgEfficiency,
      prevAvgEfficiency,
      totalDuration,
      topDrive,
      chargeEnergyAdded,
      prevChargeEnergy,
      avgChargeRate,
      chargingSessionCount: weekCharging.length,
      batteryStart,
      batteryEnd,
      alertsByType,
      alertTotal: weekAlerts.length,
    };
  }, [weekDrives, prevWeekDrives, weekCharging, prevWeekCharging, weekAlerts]);

  /* ── Daily distance chart data ── */
  const dailyDistanceData: DailyDistanceEntry[] = useMemo(() => {
    const bins = DAY_LABELS.map((label) => ({ day: label, distance: 0 }));
    for (const d of weekDrives) {
      const idx = dayOfWeekIndex(d.start_date);
      if (idx < 0) continue; // unparseable start_date — skip rather than crash
      bins[idx].distance += safeNumber(d.distance);
    }
    return bins;
  }, [weekDrives]);

  /* ── Daily energy added chart data ── */
  const dailyEnergyData: DailyEnergyEntry[] = useMemo(() => {
    const bins = DAY_LABELS.map((label) => ({ day: label, energy: 0 }));
    for (const c of weekCharging) {
      const idx = dayOfWeekIndex(c.start_ts);
      if (idx < 0) continue; // unparseable start_ts — skip rather than crash
      bins[idx].energy += safeNumber(c.total_energy_added_wh);
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
    if (metrics.totalDistance < 10) return undefined;
    const pair = findCityPair(metrics.totalDistance);
    if (!pair) return undefined;
    const times = metrics.totalDistance / pair.km;
    return { from: pair.from, to: pair.to, times: fmtNumber(times, 1) };
  }, [metrics.totalDistance]);

  /* ── Navigation callbacks ── */
  const goToPrevWeek = useCallback(() => setWeekOffset((o) => o - 1), []);
  const goToNextWeek = useCallback(() => {
    if (!isCurrentWeek) setWeekOffset((o) => o + 1);
  }, [isCurrentWeek]);

  const hasData = weekDrives.length > 0 || weekCharging.length > 0;

  return {
    weekLabel,
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
    refetchAll,
    freshnessQueries,
  };
}
