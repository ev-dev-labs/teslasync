import { useCallback, useMemo } from 'react';
import { useDrive } from '@/api/hooks/useDriving';
import { useVehicle } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { useDateFormat } from '@/hooks/useDateFormat';
import {
  convertDistanceFromSI,
  convertSpeedFromSI,
  convertTempFromSI,
  convertPressureFromSI,
} from '@/lib/unitConversion';
import { fmtNumber } from '@/lib/numberFormat';
import type { LatLngExpression } from '@/components/maps';
import type { ChartDataPoint, DriveStats, RoutePoint, SpeedSegment, SpeedHistogramBucket } from './types';
import { SPEED_SEGMENT_LOW_MPS, SPEED_SEGMENT_MED_MPS, SPEED_SEGMENT_HIGH_MPS } from './constants';

export function useDriveDetailData(id: string) {
  const { data: drive, isLoading, error } = useDrive(id);
  const { data: vehicle } = useVehicle(String(drive?.vehicleId ?? ''));
  // Drive aggregate fields use the SI display path; the SQL adapter already
  // exposes canonical values at the repository boundary.
  const { unitPrefs } = useUnits();
  const { formatTime } = useDateFormat();
  // Stable identities: both feed the `stats` useMemo dependency list, so
  // recreating them each render would silently defeat that memo (stats would
  // recompute on every render). useCallback keys them to the only unit pref
  // each one actually reads.
  const toDistanceDisplay = useCallback(
    (value: number) => convertDistanceFromSI(value, unitPrefs.distance),
    [unitPrefs.distance],
  );

  const toSpeedDisplay = useCallback(
    (value: number) => convertSpeedFromSI(value, unitPrefs.speed),
    [unitPrefs.speed],
  );
  // Telemetry / position fields from drive(Telemetry|Position)FieldMappings are
  // strict SI per ADR-004 (m, m/s, °C, Pa). Use the SI-aware converters from
  // @/lib/unitConversion so changing the user's display unit (km/h ↔ mph,
  // °C ↔ °F, kPa ↔ psi ↔ bar) produces correct values without re-passing data
  // through the legacy mph-input converters.


  /* ---- Route data ---- */
  const routeSource = useMemo<RoutePoint[]>(() => {
    if (!drive) return [];
    const tele = drive.telemetry ?? [];
    const pos = drive.positions ?? [];
    if (tele.length > 0) {
      return tele
        .filter((tp) => tp.latitude != null && tp.longitude != null && (tp.latitude !== 0 || tp.longitude !== 0))
        .map((tp) => ({ lat: tp.latitude!, lng: tp.longitude!, speed: tp.speed ?? 0 }));
    }
    return pos
      .filter((p) => p.latitude !== 0 || p.longitude !== 0)
      .map((p) => ({ lat: p.latitude, lng: p.longitude, speed: p.speed ?? 0 }));
  }, [drive]);

  const trail: LatLngExpression[] = useMemo(() => routeSource.map((p) => [p.lat, p.lng]), [routeSource]);
  // Anchor points feed the leaflet map (MapContainer center / CircleMarker
  // center); memoise so they keep a stable reference and don't re-center the
  // map on unrelated re-renders. The fallback chain is unchanged: first trail
  // point → drive start coord → Seattle default.
  const { startPos, endPos, centerPos } = useMemo(() => {
    const start = trail[0] as [number, number] | undefined;
    const end = trail.length > 1 ? (trail[trail.length - 1] as [number, number]) : undefined;
    const center: [number, number] = start
      ?? (drive?.startLat && drive?.startLon ? [drive.startLat, drive.startLon] : [47.6, -122.3]);
    return { startPos: start, endPos: end, centerPos: center };
  }, [trail, drive]);

  /* Speed-colored segments. routeSource[i].speed is m/s SI (raw VehicleSpeed),
   * so the colour bands are likewise expressed in m/s — see SPEED_SEGMENT_*_MPS
   * constants at the top of this file. */
  const speedSegments = useMemo<SpeedSegment[]>(() => {
    const segs: SpeedSegment[] = [];
    for (let i = 1; i < routeSource.length; i++) {
      const prev = routeSource[i - 1];
      const curr = routeSource[i];
      let color = '#10b981';
      if (curr.speed >= SPEED_SEGMENT_HIGH_MPS) color = '#ef4444';
      else if (curr.speed >= SPEED_SEGMENT_MED_MPS) color = '#f59e0b';
      else if (curr.speed >= SPEED_SEGMENT_LOW_MPS) color = '#00f0ff';
      segs.push({ positions: [[prev.lat, prev.lng], [curr.lat, curr.lng]], color });
    }
    return segs;
  }, [routeSource]);

  /* ---- Chart data ---- */
  const chartData = useMemo<ChartDataPoint[]>(() => {
    if (!drive) return [];
    const tele = drive.telemetry ?? [];
    if (tele.length > 0) {
      return tele.map((tp) => ({
        time: formatTime(tp.createdAt ?? tp.created_at ?? tp.timestamp),
        speed: convertSpeedFromSI(tp.speed ?? 0, unitPrefs.speed),
        battery: tp.batteryLevel ?? 0,
        elevation: tp.elevation ?? 0,
        power: tp.power ?? 0,
        outsideTemp: tp.outsideTemp != null ? convertTempFromSI(tp.outsideTemp, unitPrefs.temperature) : null,
        insideTemp: tp.insideTemp != null ? convertTempFromSI(tp.insideTemp, unitPrefs.temperature) : null,
        driverTemp: tp.driverTemp != null ? convertTempFromSI(tp.driverTemp, unitPrefs.temperature) : null,
        passengerTemp: tp.passengerTemp != null ? convertTempFromSI(tp.passengerTemp, unitPrefs.temperature) : null,
        idealRange: tp.idealRange != null ? convertDistanceFromSI(tp.idealRange, unitPrefs.distance) : null,
        ratedRange: tp.ratedRange != null ? convertDistanceFromSI(tp.ratedRange, unitPrefs.distance) : null,
        estRange: tp.estRange != null ? convertDistanceFromSI(tp.estRange, unitPrefs.distance) : null,
        odometer: tp.odometer != null ? convertDistanceFromSI(tp.odometer, unitPrefs.distance) : null,
        soc: tp.soc,
        usableSoc: tp.usableSoc,
        tireFl: tp.tirePressureFl != null ? convertPressureFromSI(tp.tirePressureFl / 1000, unitPrefs.pressure) : null,
        tireFr: tp.tirePressureFr != null ? convertPressureFromSI(tp.tirePressureFr / 1000, unitPrefs.pressure) : null,
        tireRl: tp.tirePressureRl != null ? convertPressureFromSI(tp.tirePressureRl / 1000, unitPrefs.pressure) : null,
        tireRr: tp.tirePressureRr != null ? convertPressureFromSI(tp.tirePressureRr / 1000, unitPrefs.pressure) : null,
        climateOn: tp.isClimateOn ?? null,
        fanStatus: tp.fanStatus ?? null,
      }));
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- positions may have snake_case fallback fields
    return (drive.positions ?? []).map((p: any) => ({
      time: formatTime(p.createdAt ?? p.created_at ?? p.timestamp),
      // Position.speed comes from drivePositionFieldMappings VehicleSpeed -> speed_mph
      // -> aliasPositionFields renames to 'speed'. The value is still m/s SI; the
      // legacy '_mph' suffix from the mapping is misleading per ADR-004 #6.
      speed: convertSpeedFromSI(p.speed ?? 0, unitPrefs.speed),
      battery: p.batteryLevel ?? p.battery_level ?? 0,
      elevation: p.elevation ?? 0,
      power: p.power ?? 0,
      outsideTemp: (p.outsideTemp ?? p.outside_temp) != null ? convertTempFromSI(p.outsideTemp ?? p.outside_temp, unitPrefs.temperature) : null,
      insideTemp: (p.insideTemp ?? p.inside_temp) != null ? convertTempFromSI(p.insideTemp ?? p.inside_temp, unitPrefs.temperature) : null,
      driverTemp: null as number | null,
      passengerTemp: null as number | null,
      idealRange: (p.idealRange ?? p.ideal_range) != null ? convertDistanceFromSI(p.idealRange ?? p.ideal_range, unitPrefs.distance) : null,
      ratedRange: (p.ratedRange ?? p.rated_range) != null ? convertDistanceFromSI(p.ratedRange ?? p.rated_range, unitPrefs.distance) : null,
      estRange: null as number | null,
      odometer: p.odometer != null ? convertDistanceFromSI(p.odometer, unitPrefs.distance) : null,
      soc: null as number | null,
      usableSoc: null as number | null,
      tireFl: null as number | null,
      tireFr: null as number | null,
      tireRl: null as number | null,
      tireRr: null as number | null,
      climateOn: p.isClimateOn ?? null,
      fanStatus: p.fanStatus ?? null,
    }));
  }, [drive, unitPrefs.speed, unitPrefs.temperature, unitPrefs.distance, unitPrefs.pressure, formatTime]);

  /* ---- Computed stats ---- */
  const stats = useMemo<DriveStats | null>(() => {
    if (!drive) return null;
    const maxSpd = drive.maxSpeedMps != null ? toSpeedDisplay(drive.maxSpeedMps) : 0;
    const avgSpd = drive.avgSpeedMps != null ? toSpeedDisplay(drive.avgSpeedMps) : 0;
    // speedMin removed from API contract; compute from per-row chart data.
    // We want the minimum *non-zero* speed during the actual moving portion of
    // the drive — pure zeroes mean parked/stopped at a light and don't tell
    // the user anything useful. Falls back to 0 only if every sample is zero.
    const movingSpeeds = chartData.map((d) => d.speed).filter((s) => s > 0);
    const minSpd = movingSpeeds.length > 0 ? Math.min(...movingSpeeds) : 0;
    // Compute power max (drive) and min (regen) from per-row chart data.
    // Backend derives power = pack_voltage * pack_current / 1000 per row;
    // sign is preserved (positive = drive, negative = regen).
    const powerValues = chartData.map((d) => d.power).filter((p) => p !== 0);
    const powerMax = powerValues.length > 0 ? Math.max(...powerValues) : ((drive.avgPowerW ?? 0) / 1000);
    const powerMin = powerValues.length > 0 ? Math.min(...powerValues) : 0;
    const avgPower = drive.avgPowerW != null
      ? drive.avgPowerW / 1000
      : (chartData.length > 0
        ? chartData.reduce((s, d) => s + d.power, 0) / chartData.length
        : 0);
    const durationH = (drive.durationS ?? 0) / 3600;
    const energyWh = drive.energyUsedWh != null
      ? drive.energyUsedWh
      : Math.abs(avgPower) * durationH * 1000;
    const regenWh = drive.regenEnergyWh != null
      ? drive.regenEnergyWh
      : (chartData.length > 0
        ? chartData.filter((d) => d.power < 0).reduce((s, d) => s + Math.abs(d.power), 0) * (durationH / chartData.length) * 1000
        : 0);
    const consumptionWhKm = drive.distanceM > 0 ? energyWh / (drive.distanceM / 1000) : 0;
    const elevGain = chartData.reduce((sum, d, i) => {
      if (i === 0) return 0;
      const diff = d.elevation - chartData[i - 1].elevation;
      return diff > 0 ? sum + diff : sum;
    }, 0);
    const elevLoss = chartData.reduce((sum, d, i) => {
      if (i === 0) return 0;
      const diff = d.elevation - chartData[i - 1].elevation;
      return diff < 0 ? sum + Math.abs(diff) : sum;
    }, 0);

    const outsideTemps = chartData.filter((d) => d.outsideTemp !== null).map((d) => d.outsideTemp!);
    const insideTemps = chartData.filter((d) => d.insideTemp !== null).map((d) => d.insideTemp!);
    const driverTemps = chartData.filter((d) => d.driverTemp !== null).map((d) => d.driverTemp!);
    const passengerTemps = chartData.filter((d) => d.passengerTemp !== null).map((d) => d.passengerTemp!);
    const avgOutsideTemp = outsideTemps.length > 0 ? outsideTemps.reduce((a, b) => a + b, 0) / outsideTemps.length : null;
    const avgInsideTemp = insideTemps.length > 0 ? insideTemps.reduce((a, b) => a + b, 0) / insideTemps.length : null;
    const hasAnyTemp = outsideTemps.length > 0 || insideTemps.length > 0 || driverTemps.length > 0 || passengerTemps.length > 0;

    const climateOnCount = chartData.filter((d) => d.climateOn === true).length;
    const climateOffCount = chartData.filter((d) => d.climateOn === false).length;
    const climateStatus = climateOnCount > 0 ? (climateOnCount >= climateOffCount ? 'On' : 'Mostly Off') : (climateOffCount > 0 ? 'Off' : null);
    const fanValues = chartData.map((d) => d.fanStatus).filter((v): v is number => v != null);
    const avgFanSpeed = fanValues.length > 0 ? fanValues.reduce((a, b) => a + b, 0) / fanValues.length : null;
    const maxFanSpeed = fanValues.length > 0 ? Math.max(...fanValues) : null;

    const firstWithRange = chartData.find((d) => d.idealRange != null || d.ratedRange != null);
    const lastWithRange = [...chartData].reverse().find((d) => d.idealRange != null || d.ratedRange != null);
    const startRange = firstWithRange ? (firstWithRange.idealRange ?? firstWithRange.ratedRange) : null;
    const endRange = lastWithRange ? (lastWithRange.idealRange ?? lastWithRange.ratedRange) : null;

    // Odometer: signal_log emits Odometer sparsely (Tesla "emit on change"),
    // so chartData[0].odometer is usually null for the first ~10 seconds while
    // VehicleSpeed/PackVoltage etc. are streaming. Scan for the first/last
    // non-null odometer reading so the panel shows real start→end values.
    const firstOdometer = chartData.find((d) => d.odometer != null && d.odometer > 0)?.odometer ?? null;
    const lastOdometer = [...chartData].reverse().find((d) => d.odometer != null && d.odometer > 0)?.odometer ?? null;
    const odometerStart = firstOdometer ?? 0;
    const odometerEnd = lastOdometer ?? 0;

    const hasTirePressure = chartData.some((d) => d.tireFl !== null || d.tireFr !== null || d.tireRl !== null || d.tireRr !== null);

    const efficiencyPctPer100 = drive.distanceM > 0 && drive.startBatteryPct != null && drive.endBatteryPct != null
      ? (drive.startBatteryPct - drive.endBatteryPct) / toDistanceDisplay(drive.distanceM) * 10
      : null;

    return {
      maxSpd, avgSpd, minSpd, powerMax, powerMin, avgPower,
      energyWh, regenWh, consumptionWhKm, elevGain, elevLoss,
      avgOutsideTemp, avgInsideTemp, hasAnyTemp,
      insideTemps, outsideTemps, driverTemps, passengerTemps,
      climateStatus, avgFanSpeed, maxFanSpeed,
      startRange, endRange, odometerStart, odometerEnd,
      hasTirePressure, efficiencyPctPer100,
    };
  }, [drive, chartData, toSpeedDisplay, toDistanceDisplay]);

  /* ---- Speed histogram ---- */
  const speedHistData = useMemo<SpeedHistogramBucket[]>(() => {
    if (chartData.length === 0) return [];
    // chartData[i].speed is already in the user's display unit (converted via
    // convertSpeedFromSI above), so the bucket edges are plain display-unit
    // values — not SI. The labels render in whatever unit the user picked.
    const defs = [
      { min: 0, max: 20 },
      { min: 20, max: 40 },
      { min: 40, max: 60 },
      { min: 60, max: 80 },
      { min: 80, max: 100 },
      { min: 100, max: 120 },
      { min: 120, max: 9999 },
    ];
    const buckets = defs.map((d) => ({
      range: d.max >= 9999 ? `${fmtNumber(d.min)}+` : `${fmtNumber(d.min)}–${fmtNumber(d.max)}`,
      count: 0,
    }));
    chartData.forEach((d) => {
      const idx = defs.findIndex((def) => d.speed >= def.min && d.speed < def.max);
      if (idx >= 0) buckets[idx].count++;
    });
    return buckets
      .filter((b) => b.count > 0)
      .map((b) => ({ range: b.range, pct: chartData.length > 0 ? Math.round((b.count / chartData.length) * 100) : 0 }));
  }, [chartData]);

  return {
    drive: drive ?? null,
    vehicle: vehicle ?? null,
    isLoading,
    error,
    chartData,
    stats,
    trail,
    startPos,
    endPos,
    centerPos,
    speedSegments,
    speedHistData,
  };
}
