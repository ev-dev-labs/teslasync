import { useCallback, useMemo } from 'react';
import { useDrive } from '@/api/hooks/useDriving';
import { useVehicle } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useSettings } from '@/hooks/useSettings';
import { resolveTimezone } from '@/lib/timezone';
import { chartTokens } from '@/lib/tokens';
import {
  convertDistanceFromSI,
  convertSpeedFromSI,
  convertTempFromSI,
  convertPressureFromSI,
  convertPowerFromSI,
} from '@/lib/unitConversion';

import type { LatLngExpression } from '@/components/maps';
import type { ChartDataPoint, RoutePoint, SpeedSegment, SpeedHistogramBucket } from './types';
import { SPEED_SEGMENT_LOW_MPS, SPEED_SEGMENT_MED_MPS, SPEED_SEGMENT_HIGH_MPS } from './constants';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { asFiniteNumber } from '@/lib/typeGuards';
import { isGpsFix } from '@/lib/geo';
import { driveEnergyEvidence, type DriveEnergyStats } from './energyEvidence';

function displaySpeed(value: unknown, unit: 'km/h' | 'mph'): number | null {
  const speed = asFiniteNumber(value);
  return speed == null ? null : asFiniteNumber(convertSpeedFromSI(speed, unit));
}

export interface DriveElevationEvidence {
  gainM: number | null;
  lossM: number | null;
  eligiblePairCount: number;
  pairCount: number;
  coverage: number | null;
}

export function useDriveDetailData(id: string) {
  const { fmtNumber } = useNumberFormatting();
  const driveQuery = useDrive(id);
  const { data: drive, isLoading, error } = driveQuery;
  const { data: vehicle } = useVehicle(String(drive?.vehicleId ?? ''));
  const { settings } = useSettings();
  const timezone = resolveTimezone('vehicle', vehicle?.timezone, settings.timezone_user);
  const displayTimezone = resolveTimezone(
    settings.tz_display_default === 'user' || settings.tz_display_default === 'utc'
      ? settings.tz_display_default : 'vehicle',
    vehicle?.timezone, settings.timezone_user,
  );
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
      const points = tele
        .filter((tp) => tp.latitude != null && tp.longitude != null && isGpsFix(tp.latitude, tp.longitude))
        .map((tp) => ({
          lat: tp.latitude!,
          lng: tp.longitude!,
          ...(asFiniteNumber(tp.speed) == null ? {} : { speed: asFiniteNumber(tp.speed)! }),
          timestamp: tp.createdAt ?? tp.created_at ?? tp.timestamp ?? null,
        }));
      if (points.length > 0) return points;
    }
    return pos
      .filter((p) => isGpsFix(p.latitude, p.longitude))
      .map((p) => ({
        lat: p.latitude,
        lng: p.longitude,
        ...(asFiniteNumber(p.speed) == null ? {} : { speed: asFiniteNumber(p.speed)! }),
        timestamp: p.createdAt ?? p.created_at ?? p.timestamp ?? null,
      }));
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
      ?? (drive?.startLat != null && drive?.startLon != null ? [drive.startLat, drive.startLon] : [47.6, -122.3]);
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
      let color: string = chartTokens.tooltipMutedText;
      if (curr.speed != null) {
        color = curr.speed >= SPEED_SEGMENT_HIGH_MPS ? chartTokens.series[3]
          : curr.speed >= SPEED_SEGMENT_MED_MPS ? chartTokens.series[2]
          : curr.speed >= SPEED_SEGMENT_LOW_MPS ? chartTokens.series[0]
          : chartTokens.series[1];
      }
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
        time: formatTime(tp.createdAt ?? tp.created_at ?? tp.timestamp, { tz: displayTimezone }),
        speed: displaySpeed(tp.speed, unitPrefs.speed),
        battery: tp.batteryLevel ?? null,
        elevation: asFiniteNumber(tp.elevation),
        power: asFiniteNumber(tp.power) == null ? null : convertPowerFromSI(tp.power!, 'kW'),
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
    // Legacy aliases can appear in historical position records. Keep the
    // compatibility at this boundary typed, never leak untyped rows to UI.
    type PositionAliases = {
      battery_level?: number | null;
      outside_temp?: number | null;
      inside_temp?: number | null;
      ideal_range?: number | null;
      rated_range?: number | null;
    };
    return (drive.positions ?? []).map((row) => {
      const p = row as typeof row & PositionAliases;
      return ({
      time: formatTime(p.createdAt ?? p.created_at ?? p.timestamp, { tz: displayTimezone }),
      // Position.speed comes from drivePositionFieldMappings VehicleSpeed -> speed_mph
      // -> aliasPositionFields renames to 'speed'. The value is still m/s SI; the
      // legacy '_mph' suffix from the mapping is misleading per ADR-004 #6.
      speed: displaySpeed(p.speed, unitPrefs.speed),
      battery: p.batteryLevel ?? p.battery_level ?? null,
      elevation: asFiniteNumber(p.elevation),
      power: asFiniteNumber(p.power) == null ? null : convertPowerFromSI(p.power!, 'kW'),
      outsideTemp: (p.outsideTemp ?? p.outside_temp) != null ? convertTempFromSI((p.outsideTemp ?? p.outside_temp)!, unitPrefs.temperature) : null,
      insideTemp: (p.insideTemp ?? p.inside_temp) != null ? convertTempFromSI((p.insideTemp ?? p.inside_temp)!, unitPrefs.temperature) : null,
      driverTemp: null as number | null,
      passengerTemp: null as number | null,
      idealRange: (p.idealRange ?? p.ideal_range) != null ? convertDistanceFromSI((p.idealRange ?? p.ideal_range)!, unitPrefs.distance) : null,
      ratedRange: (p.ratedRange ?? p.rated_range) != null ? convertDistanceFromSI((p.ratedRange ?? p.rated_range)!, unitPrefs.distance) : null,
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
      });
    });
  }, [drive, unitPrefs.speed, unitPrefs.temperature, unitPrefs.distance, unitPrefs.pressure, formatTime, displayTimezone]);

  /* ---- Computed stats ---- */
  const stats = useMemo<(DriveEnergyStats & { elevationEvidence: DriveElevationEvidence }) | null>(() => {
    if (!drive) return null;
    const maxSpd = drive.maxSpeedMps != null ? toSpeedDisplay(drive.maxSpeedMps) : 0;
    const avgSpd = drive.avgSpeedMps != null ? toSpeedDisplay(drive.avgSpeedMps) : 0;
    // speedMin removed from API contract; compute from per-row chart data.
    // We want the minimum *non-zero* speed during the actual moving portion of
    // the drive — pure zeroes mean parked/stopped at a light and don't tell
    // the user anything useful. Falls back to 0 only if every sample is zero.
    const movingSpeeds = chartData.map((d) => d.speed).filter((s): s is number => s != null && Number.isFinite(s) && s > 0);
    const minSpd = movingSpeeds.length > 0 ? movingSpeeds.reduce((min, value) => Math.min(min, value), Infinity) : 0;
    // Compute power max (drive) and min (regen) from per-row chart data.
    // Backend derives power = pack_voltage * pack_current in watts per row and
    // the chart rows carry it converted to kW; sign is preserved
    // (positive = drive, negative = regen).
    const powerValues = chartData.map((d) => d.power).filter((p): p is number => p != null && Number.isFinite(p));
    const powerMax = powerValues.length > 0 ? powerValues.reduce((max, value) => Math.max(max, value), -Infinity) : 0;
    const powerMin = powerValues.length > 0 ? powerValues.reduce((min, value) => Math.min(min, value), Infinity) : 0;
    const avgPower = drive.avgPowerW != null
      ? drive.avgPowerW / 1000
      : (powerValues.length > 0
        ? powerValues.reduce((sum, value) => sum + value, 0) / powerValues.length
        : 0);
    const energyEvidence = driveEnergyEvidence(drive);
    const energyWh = energyEvidence.energyWh ?? 0;
    const regenWh = energyEvidence.regenWh ?? 0;
    const consumptionWhKm = drive.distanceM > 0 ? energyWh / (drive.distanceM / 1000) : 0;
    let elevGain = 0;
    let elevLoss = 0;
    let eligiblePairCount = 0;
    for (let i = 1; i < chartData.length; i++) {
      const current = chartData[i].elevation;
      const previous = chartData[i - 1].elevation;
      if (current == null || previous == null) continue;
      const diff = asFiniteNumber(current - previous);
      if (diff == null) continue;
      eligiblePairCount++;
      elevGain += Math.max(diff, 0);
      elevLoss += Math.max(-diff, 0);
    }
    const pairCount = Math.max(chartData.length - 1, 0);
    // Keep nullable evidence beside the legacy numeric stats contract.
    // Only adjacent observed pairs contribute; gaps are never bridged.
    const elevationEvidence: DriveElevationEvidence = {
      gainM: eligiblePairCount > 0 ? asFiniteNumber(elevGain) : null,
      lossM: eligiblePairCount > 0 ? asFiniteNumber(elevLoss) : null,
      eligiblePairCount,
      pairCount,
      coverage: pairCount > 0 ? eligiblePairCount / pairCount : null,
    };

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
      ? (drive.startBatteryPct - drive.endBatteryPct) / toDistanceDisplay(drive.distanceM) * 100
      : null;

    return {
      maxSpd, avgSpd, minSpd, powerMax, powerMin, avgPower,
      energyWh, regenWh, consumptionWhKm, elevGain, elevLoss,
      energyEvidence,
      elevationEvidence,
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
      { min: -Infinity, max: 0 },
      { min: 0, max: 20 },
      { min: 20, max: 40 },
      { min: 40, max: 60 },
      { min: 60, max: 80 },
      { min: 80, max: 100 },
      { min: 100, max: 120 },
      { min: 120, max: Infinity },
    ];
    const buckets = defs.map((d) => ({
      range: d.min === -Infinity ? `<${fmtNumber(d.max)}`
        : d.max === Infinity ? `${fmtNumber(d.min)}+` : `${fmtNumber(d.min)}–${fmtNumber(d.max)}`,
      count: 0,
    }));
    const observedSpeeds = chartData.filter((d) => d.speed != null && Number.isFinite(d.speed));
    observedSpeeds.forEach((d) => {
      if (d.speed == null) return;
      const speed = d.speed;
      const idx = defs.findIndex((def) => speed >= def.min && speed < def.max);
      if (idx >= 0) buckets[idx].count++;
    });
    return buckets
      .filter((b) => b.count > 0)
      .map((b) => ({ range: b.range, pct: observedSpeeds.length > 0 ? Math.round((b.count / observedSpeeds.length) * 100) : 0 }));
  }, [chartData, fmtNumber]);

  return {
    drive: drive ?? null,
    vehicle: vehicle ?? null,
    timezone,
    isLoading,
    error,
    /**
     * Raw query result, forwarded so the page can derive the shared
     * `DataState` trust contract (`api/dataState.ts`) instead of treating
     * every `error` as fatal — a failed background refresh must keep the
     * already-rendered drive on screen.
     */
    driveQuery,
    chartData,
    stats,
    routeSource,
    trail,
    startPos,
    endPos,
    centerPos,
    speedSegments,
    speedHistData,
  };
}
