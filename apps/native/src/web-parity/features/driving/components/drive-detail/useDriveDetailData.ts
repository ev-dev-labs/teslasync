/**
 * Native parity port of
 * web/src/features/driving/components/drive-detail/useDriveDetailData.ts.
 *
 * `useDriveDetailData(id)` is the non-visual data hook behind the Drive Detail
 * screen: it loads one drive (+ its parent vehicle), derives the route trail,
 * speed-coloured map segments, the per-row chart series, aggregate drive stats,
 * and the speed histogram — all in the user's display units. There is no JSX,
 * DOM, Recharts, Leaflet, or browser-only API in the original, so this port is a
 * faithful 1:1 logic translation; only the cross-module dependencies that have
 * no native runtime yet are inlined as native-safe shims (documented in the
 * .parity.json sidecar):
 *
 *   - `@/api/hooks/useDriving` `useDrive` (web L2)      -> native useDriving useDrive.
 *   - `@/api/hooks/useVehicles` `useVehicle` (web L3)   -> native useVehicles useVehicle.
 *   - `@/hooks/useUnits` `useUnits` (web L4)            -> inline native-safe useUnits()
 *     that derives {distance, speed, temperature, pressure} from the web-parity
 *     useSettings() query exactly as the web hook does (unit_of_length 'mi' ->
 *     'mi'/'mph' else 'km'/'km/h'; unit_of_temp 'F' -> '\u00b0F' else '\u00b0C';
 *     unit_of_pressure 'psi' -> 'psi' else 'bar'), useMemo-stable over the primitive
 *     prefs. Only the four prefs this hook reads are surfaced.
 *   - `@/hooks/useDateFormat` `formatTime` (web L5)     -> inline module-level
 *     formatTime ported as the web default-locale branch (the established native
 *     DriveTimeline convention): '\u2014' for nullish/invalid, else
 *     toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) in the device
 *     locale/timezone (no native tz library is ported yet).
 *   - `@/lib/unitConversion` convert{Distance,Speed,Temp,Pressure}FromSI (web L6-11)
 *     -> ported byte-for-byte (pure SI -> display converters, NIST factors).
 *   - `@/lib/numberFormat` `fmtNumber` (web L12)        -> ported (safeNumber +
 *     fmtNumber) with the en-US / precision-2 default standing in for the web's
 *     useSettings-mutated module globals (the established native numberFormat
 *     convention; histogram labels call fmtNumber(min)/fmtNumber(max)).
 *   - `@/components/maps` `LatLngExpression` type (web L13) -> native-safe
 *     [number, number] | {lat; lng; alt?} union (Leaflet is DOM-only); the hook only
 *     ever produces [lat, lng] tuples so the contextual-tuple inference is preserved.
 *   - `./types` ChartDataPoint/DriveStats/RoutePoint/SpeedSegment/SpeedHistogramBucket
 *     (web L14) -> inlined + re-exported verbatim (the file is self-contained per the
 *     file-by-file native convention; sibling ports inline their consumed subsets).
 *   - `./constants` SPEED_SEGMENT_{LOW,MED,HIGH}_MPS (web L15) -> inlined + re-exported
 *     verbatim (30/60/100 mph in m/s; route colour bands compared against raw m/s SI).
 *
 * All state names, API paths, SI unit handling, and computed-stat semantics match
 * the web source exactly.
 */

import {useCallback, useMemo} from 'react';

import {useDrive} from '../../../../api/hooks/useDriving';
import {useVehicle} from '../../../../api/hooks/useVehicles';
import {useSettings} from '../../../../api/hooks/useSettings';

/* ── ported: @/components/maps LatLngExpression (Leaflet is DOM-only) ──────── */

type LatLngTuple = [number, number];

interface LatLngLiteral {
  lat: number;
  lng: number;
  alt?: number;
}

export type LatLngExpression = LatLngTuple | LatLngLiteral;

/* ── ported: ./types ──────────────────────────────────────────────────────── */

export interface ChartDataPoint {
  time: string;
  speed: number;
  battery: number;
  elevation: number;
  power: number;
  outsideTemp: number | null;
  insideTemp: number | null;
  driverTemp: number | null;
  passengerTemp: number | null;
  idealRange: number | null;
  ratedRange: number | null;
  estRange: number | null;
  odometer: number | null;
  soc: number | null;
  usableSoc: number | null;
  tireFl: number | null;
  tireFr: number | null;
  tireRl: number | null;
  tireRr: number | null;
  climateOn: boolean | null;
  fanStatus: number | null;
}

export interface DriveStats {
  maxSpd: number;
  avgSpd: number;
  minSpd: number;
  powerMax: number;
  powerMin: number;
  avgPower: number;
  energyWh: number;
  regenWh: number;
  consumptionWhKm: number;
  elevGain: number;
  elevLoss: number;
  avgOutsideTemp: number | null;
  avgInsideTemp: number | null;
  hasAnyTemp: boolean;
  insideTemps: number[];
  outsideTemps: number[];
  driverTemps: number[];
  passengerTemps: number[];
  climateStatus: string | null;
  avgFanSpeed: number | null;
  maxFanSpeed: number | null;
  startRange: number | null;
  endRange: number | null;
  odometerStart: number;
  odometerEnd: number;
  hasTirePressure: boolean;
  efficiencyPctPer100: number | null;
}

export interface RoutePoint {
  lat: number;
  lng: number;
  speed: number;
}

export interface SpeedSegment {
  positions: LatLngExpression[];
  color: string;
}

export interface SpeedHistogramBucket {
  range: string;
  pct: number;
}

/* ── ported: ./constants (route-map speed thresholds, SI m/s) ─────────────────
 * 30 / 60 / 100 mph (1 mph = 0.44704 m/s). Telemetry speed arrives as raw m/s,
 * so the segment colours are compared against these SI values directly. */

export const SPEED_SEGMENT_LOW_MPS = 30 * 0.44704;
export const SPEED_SEGMENT_MED_MPS = 60 * 0.44704;
export const SPEED_SEGMENT_HIGH_MPS = 100 * 0.44704;

/* ── ported: @/lib/unitConversion SI -> display converters (NIST factors) ──── */

type DistanceUnitPref = 'km' | 'mi' | 'ft';
type SpeedUnitPref = 'km/h' | 'mph';
type TemperatureUnitPref = '\u00b0C' | '\u00b0F';
type PressureUnitPref = 'kPa' | 'psi' | 'bar';

const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const METERS_PER_FOOT = 0.3048;
const KPA_PER_PSI = 6.894757;
const KPA_PER_BAR = 100;
const SECONDS_PER_HOUR = 3600;

function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'km':
      return meters / METERS_PER_KM;
    case 'mi':
      return meters / METERS_PER_MILE;
    case 'ft':
      return meters / METERS_PER_FOOT;
  }
}

function convertSpeedFromSI(mps: number, to: SpeedUnitPref): number {
  switch (to) {
    case 'km/h':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
    case 'mph':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_MILE;
  }
}

function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  switch (to) {
    case '\u00b0C':
      return celsius;
    case '\u00b0F':
      return (celsius * 9) / 5 + 32;
  }
}

function convertPressureFromSI(kpa: number, to: PressureUnitPref): number {
  switch (to) {
    case 'kPa':
      return kpa;
    case 'psi':
      return kpa / KPA_PER_PSI;
    case 'bar':
      return kpa / KPA_PER_BAR;
  }
}

/* ── ported: @/lib/numberFormat fmtNumber (en-US / precision-2 default) ────── */

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function fmtNumber(value: unknown, decimals = 2): string {
  const n = safeNumber(value);
  try {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return n.toFixed(decimals);
  }
}

/* ── ported: @/hooks/useDateFormat formatTime (default-locale branch) ──────── */

function formatTime(value: string | Date | null | undefined): string {
  if (!value) {
    return '\u2014';
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    return '\u2014';
  }
  return d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

/* ── native-safe useUnits (web useUnits -> useSettings derivation, inlined) ── */

interface UnitPrefs {
  distance: DistanceUnitPref;
  speed: SpeedUnitPref;
  temperature: TemperatureUnitPref;
  pressure: PressureUnitPref;
}

function useUnits(): {unitPrefs: UnitPrefs} {
  const {data: settings} = useSettings();
  const unitOfLength = settings?.unit_of_length;
  const unitOfTemp = settings?.unit_of_temp;
  const unitOfPressure = settings?.unit_of_pressure;
  const unitPrefs = useMemo<UnitPrefs>(
    () => ({
      distance: unitOfLength === 'mi' ? 'mi' : 'km',
      speed: unitOfLength === 'mi' ? 'mph' : 'km/h',
      temperature: unitOfTemp === 'F' ? '\u00b0F' : '\u00b0C',
      pressure: unitOfPressure === 'psi' ? 'psi' : 'bar',
    }),
    [unitOfLength, unitOfTemp, unitOfPressure],
  );
  return {unitPrefs};
}

export function useDriveDetailData(id: string) {
  const {data: drive, isLoading, error} = useDrive(id);
  const {data: vehicle} = useVehicle(String(drive?.vehicleId ?? ''));
  // Drive aggregate fields use the SI display path; the SQL adapter already
  // exposes canonical values at the repository boundary.
  const {unitPrefs} = useUnits();
  // Web parity note: the web source declares these as plain (unmemoized) arrow
  // functions and relies on its lint config treating react-hooks/exhaustive-deps
  // as a warning. The native lint config treats it as an error, so they are
  // wrapped in useCallback over the same primitive prefs. The computed `stats`
  // output is identical — only the (internal, unobservable) recompute frequency
  // changes — so behavior, unit handling, and values are preserved.
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
    if (!drive) {
      return [];
    }
    const tele = drive.telemetry ?? [];
    const pos = drive.positions ?? [];
    if (tele.length > 0) {
      return tele
        .filter(
          tp =>
            tp.latitude != null &&
            tp.longitude != null &&
            (tp.latitude !== 0 || tp.longitude !== 0),
        )
        .map(tp => ({lat: tp.latitude!, lng: tp.longitude!, speed: tp.speed ?? 0}));
    }
    return pos
      .filter(p => p.latitude !== 0 || p.longitude !== 0)
      .map(p => ({lat: p.latitude, lng: p.longitude, speed: p.speed ?? 0}));
  }, [drive]);

  const trail: LatLngExpression[] = useMemo(
    () => routeSource.map(p => [p.lat, p.lng]),
    [routeSource],
  );
  const startPos = trail[0] as [number, number] | undefined;
  const endPos =
    trail.length > 1
      ? (trail[trail.length - 1] as [number, number])
      : undefined;
  const centerPos: [number, number] =
    startPos ??
    (drive?.startLat && drive?.startLon
      ? [drive.startLat, drive.startLon]
      : [47.6, -122.3]);

  /* Speed-colored segments. routeSource[i].speed is m/s SI (raw VehicleSpeed),
   * so the colour bands are likewise expressed in m/s — see SPEED_SEGMENT_*_MPS
   * constants at the top of this file. */
  const speedSegments = useMemo<SpeedSegment[]>(() => {
    const segs: SpeedSegment[] = [];
    for (let i = 1; i < routeSource.length; i++) {
      const prev = routeSource[i - 1];
      const curr = routeSource[i];
      let color = '#10b981';
      if (curr.speed >= SPEED_SEGMENT_HIGH_MPS) {
        color = '#ef4444';
      } else if (curr.speed >= SPEED_SEGMENT_MED_MPS) {
        color = '#f59e0b';
      } else if (curr.speed >= SPEED_SEGMENT_LOW_MPS) {
        color = '#00f0ff';
      }
      segs.push({
        positions: [
          [prev.lat, prev.lng],
          [curr.lat, curr.lng],
        ],
        color,
      });
    }
    return segs;
  }, [routeSource]);

  /* ---- Chart data ---- */
  const chartData = useMemo<ChartDataPoint[]>(() => {
    if (!drive) {
      return [];
    }
    const tele = drive.telemetry ?? [];
    if (tele.length > 0) {
      return tele.map(tp => ({
        time: formatTime(tp.createdAt ?? tp.created_at ?? tp.timestamp),
        speed: convertSpeedFromSI(tp.speed ?? 0, unitPrefs.speed),
        battery: tp.batteryLevel ?? 0,
        elevation: tp.elevation ?? 0,
        power: tp.power ?? 0,
        outsideTemp:
          tp.outsideTemp != null
            ? convertTempFromSI(tp.outsideTemp, unitPrefs.temperature)
            : null,
        insideTemp:
          tp.insideTemp != null
            ? convertTempFromSI(tp.insideTemp, unitPrefs.temperature)
            : null,
        driverTemp:
          tp.driverTemp != null
            ? convertTempFromSI(tp.driverTemp, unitPrefs.temperature)
            : null,
        passengerTemp:
          tp.passengerTemp != null
            ? convertTempFromSI(tp.passengerTemp, unitPrefs.temperature)
            : null,
        idealRange:
          tp.idealRange != null
            ? convertDistanceFromSI(tp.idealRange, unitPrefs.distance)
            : null,
        ratedRange:
          tp.ratedRange != null
            ? convertDistanceFromSI(tp.ratedRange, unitPrefs.distance)
            : null,
        estRange:
          tp.estRange != null
            ? convertDistanceFromSI(tp.estRange, unitPrefs.distance)
            : null,
        odometer:
          tp.odometer != null
            ? convertDistanceFromSI(tp.odometer, unitPrefs.distance)
            : null,
        soc: tp.soc,
        usableSoc: tp.usableSoc,
        tireFl:
          tp.tirePressureFl != null
            ? convertPressureFromSI(tp.tirePressureFl / 1000, unitPrefs.pressure)
            : null,
        tireFr:
          tp.tirePressureFr != null
            ? convertPressureFromSI(tp.tirePressureFr / 1000, unitPrefs.pressure)
            : null,
        tireRl:
          tp.tirePressureRl != null
            ? convertPressureFromSI(tp.tirePressureRl / 1000, unitPrefs.pressure)
            : null,
        tireRr:
          tp.tirePressureRr != null
            ? convertPressureFromSI(tp.tirePressureRr / 1000, unitPrefs.pressure)
            : null,
        climateOn: tp.isClimateOn ?? null,
        fanStatus: tp.fanStatus ?? null,
      }));
    }
     
    return (drive.positions ?? []).map((p: any) => ({
      time: formatTime(p.createdAt ?? p.created_at ?? p.timestamp),
      // Position.speed comes from drivePositionFieldMappings VehicleSpeed -> speed_mph
      // -> aliasPositionFields renames to 'speed'. The value is still m/s SI; the
      // legacy '_mph' suffix from the mapping is misleading per ADR-004 #6.
      speed: convertSpeedFromSI(p.speed ?? 0, unitPrefs.speed),
      battery: p.batteryLevel ?? p.battery_level ?? 0,
      elevation: p.elevation ?? 0,
      power: p.power ?? 0,
      outsideTemp:
        (p.outsideTemp ?? p.outside_temp) != null
          ? convertTempFromSI(p.outsideTemp ?? p.outside_temp, unitPrefs.temperature)
          : null,
      insideTemp:
        (p.insideTemp ?? p.inside_temp) != null
          ? convertTempFromSI(p.insideTemp ?? p.inside_temp, unitPrefs.temperature)
          : null,
      driverTemp: null as number | null,
      passengerTemp: null as number | null,
      idealRange:
        (p.idealRange ?? p.ideal_range) != null
          ? convertDistanceFromSI(p.idealRange ?? p.ideal_range, unitPrefs.distance)
          : null,
      ratedRange:
        (p.ratedRange ?? p.rated_range) != null
          ? convertDistanceFromSI(p.ratedRange ?? p.rated_range, unitPrefs.distance)
          : null,
      estRange: null as number | null,
      odometer:
        p.odometer != null
          ? convertDistanceFromSI(p.odometer, unitPrefs.distance)
          : null,
      soc: null as number | null,
      usableSoc: null as number | null,
      tireFl: null as number | null,
      tireFr: null as number | null,
      tireRl: null as number | null,
      tireRr: null as number | null,
      climateOn: p.isClimateOn ?? null,
      fanStatus: p.fanStatus ?? null,
    }));
  }, [
    drive,
    unitPrefs.speed,
    unitPrefs.temperature,
    unitPrefs.distance,
    unitPrefs.pressure,
  ]);

  /* ---- Computed stats ---- */
  const stats = useMemo<DriveStats | null>(() => {
    if (!drive) {
      return null;
    }
    const maxSpd = drive.maxSpeedMps != null ? toSpeedDisplay(drive.maxSpeedMps) : 0;
    const avgSpd = drive.avgSpeedMps != null ? toSpeedDisplay(drive.avgSpeedMps) : 0;
    // speedMin removed from API contract; compute from per-row chart data.
    // We want the minimum *non-zero* speed during the actual moving portion of
    // the drive — pure zeroes mean parked/stopped at a light and don't tell
    // the user anything useful. Falls back to 0 only if every sample is zero.
    const movingSpeeds = chartData.map(d => d.speed).filter(s => s > 0);
    const minSpd = movingSpeeds.length > 0 ? Math.min(...movingSpeeds) : 0;
    // Compute power max (drive) and min (regen) from per-row chart data.
    // Backend derives power = pack_voltage * pack_current / 1000 per row;
    // sign is preserved (positive = drive, negative = regen).
    const powerValues = chartData.map(d => d.power).filter(p => p !== 0);
    const powerMax =
      powerValues.length > 0
        ? Math.max(...powerValues)
        : (drive.avgPowerW ?? 0) / 1000;
    const powerMin = powerValues.length > 0 ? Math.min(...powerValues) : 0;
    const avgPower =
      drive.avgPowerW != null
        ? drive.avgPowerW / 1000
        : chartData.length > 0
        ? chartData.reduce((s, d) => s + d.power, 0) / chartData.length
        : 0;
    const durationH = (drive.durationS ?? 0) / 3600;
    const energyWh =
      drive.energyUsedWh != null
        ? drive.energyUsedWh
        : Math.abs(avgPower) * durationH * 1000;
    const regenWh =
      drive.regenEnergyWh != null
        ? drive.regenEnergyWh
        : chartData.length > 0
        ? chartData
            .filter(d => d.power < 0)
            .reduce((s, d) => s + Math.abs(d.power), 0) *
          (durationH / chartData.length) *
          1000
        : 0;
    const consumptionWhKm =
      drive.distanceM > 0 ? energyWh / (drive.distanceM / 1000) : 0;
    const elevGain = chartData.reduce((sum, d, i) => {
      if (i === 0) {
        return 0;
      }
      const diff = d.elevation - chartData[i - 1].elevation;
      return diff > 0 ? sum + diff : sum;
    }, 0);
    const elevLoss = chartData.reduce((sum, d, i) => {
      if (i === 0) {
        return 0;
      }
      const diff = d.elevation - chartData[i - 1].elevation;
      return diff < 0 ? sum + Math.abs(diff) : sum;
    }, 0);

    const outsideTemps = chartData
      .filter(d => d.outsideTemp !== null)
      .map(d => d.outsideTemp!);
    const insideTemps = chartData
      .filter(d => d.insideTemp !== null)
      .map(d => d.insideTemp!);
    const driverTemps = chartData
      .filter(d => d.driverTemp !== null)
      .map(d => d.driverTemp!);
    const passengerTemps = chartData
      .filter(d => d.passengerTemp !== null)
      .map(d => d.passengerTemp!);
    const avgOutsideTemp =
      outsideTemps.length > 0
        ? outsideTemps.reduce((a, b) => a + b, 0) / outsideTemps.length
        : null;
    const avgInsideTemp =
      insideTemps.length > 0
        ? insideTemps.reduce((a, b) => a + b, 0) / insideTemps.length
        : null;
    const hasAnyTemp =
      outsideTemps.length > 0 ||
      insideTemps.length > 0 ||
      driverTemps.length > 0 ||
      passengerTemps.length > 0;

    const climateOnCount = chartData.filter(d => d.climateOn === true).length;
    const climateOffCount = chartData.filter(d => d.climateOn === false).length;
    const climateStatus =
      climateOnCount > 0
        ? climateOnCount >= climateOffCount
          ? 'On'
          : 'Mostly Off'
        : climateOffCount > 0
        ? 'Off'
        : null;
    const fanValues = chartData
      .map(d => d.fanStatus)
      .filter((v): v is number => v != null);
    const avgFanSpeed =
      fanValues.length > 0
        ? fanValues.reduce((a, b) => a + b, 0) / fanValues.length
        : null;
    const maxFanSpeed = fanValues.length > 0 ? Math.max(...fanValues) : null;

    const firstWithRange = chartData.find(
      d => d.idealRange != null || d.ratedRange != null,
    );
    const lastWithRange = [...chartData]
      .reverse()
      .find(d => d.idealRange != null || d.ratedRange != null);
    const startRange = firstWithRange
      ? firstWithRange.idealRange ?? firstWithRange.ratedRange
      : null;
    const endRange = lastWithRange
      ? lastWithRange.idealRange ?? lastWithRange.ratedRange
      : null;

    // Odometer: signal_log emits Odometer sparsely (Tesla "emit on change"),
    // so chartData[0].odometer is usually null for the first ~10 seconds while
    // VehicleSpeed/PackVoltage etc. are streaming. Scan for the first/last
    // non-null odometer reading so the panel shows real start→end values.
    const firstOdometer =
      chartData.find(d => d.odometer != null && d.odometer > 0)?.odometer ?? null;
    const lastOdometer =
      [...chartData].reverse().find(d => d.odometer != null && d.odometer > 0)
        ?.odometer ?? null;
    const odometerStart = firstOdometer ?? 0;
    const odometerEnd = lastOdometer ?? 0;

    const hasTirePressure = chartData.some(
      d =>
        d.tireFl !== null ||
        d.tireFr !== null ||
        d.tireRl !== null ||
        d.tireRr !== null,
    );

    const efficiencyPctPer100 =
      drive.distanceM > 0 &&
      drive.startBatteryPct != null &&
      drive.endBatteryPct != null
        ? ((drive.startBatteryPct - drive.endBatteryPct) /
            toDistanceDisplay(drive.distanceM)) *
          10
        : null;

    return {
      maxSpd,
      avgSpd,
      minSpd,
      powerMax,
      powerMin,
      avgPower,
      energyWh,
      regenWh,
      consumptionWhKm,
      elevGain,
      elevLoss,
      avgOutsideTemp,
      avgInsideTemp,
      hasAnyTemp,
      insideTemps,
      outsideTemps,
      driverTemps,
      passengerTemps,
      climateStatus,
      avgFanSpeed,
      maxFanSpeed,
      startRange,
      endRange,
      odometerStart,
      odometerEnd,
      hasTirePressure,
      efficiencyPctPer100,
    };
  }, [drive, chartData, toSpeedDisplay, toDistanceDisplay]);

  /* ---- Speed histogram ---- */
  const speedHistData = useMemo<SpeedHistogramBucket[]>(() => {
    if (chartData.length === 0) {
      return [];
    }
    // chartData[i].speed is already in the user's display unit (converted via
    // convertSpeedFromSI above), so the bucket edges are plain display-unit
    // values — not SI. The labels render in whatever unit the user picked.
    const defs = [
      {min: 0, max: 20},
      {min: 20, max: 40},
      {min: 40, max: 60},
      {min: 60, max: 80},
      {min: 80, max: 100},
      {min: 100, max: 120},
      {min: 120, max: 9999},
    ];
    const buckets = defs.map(d => ({
      range:
        d.max >= 9999
          ? `${fmtNumber(d.min)}+`
          : `${fmtNumber(d.min)}–${fmtNumber(d.max)}`,
      count: 0,
    }));
    chartData.forEach(d => {
      const idx = defs.findIndex(def => d.speed >= def.min && d.speed < def.max);
      if (idx >= 0) {
        buckets[idx].count++;
      }
    });
    return buckets
      .filter(b => b.count > 0)
      .map(b => ({
        range: b.range,
        pct:
          chartData.length > 0
            ? Math.round((b.count / chartData.length) * 100)
            : 0,
      }));
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
