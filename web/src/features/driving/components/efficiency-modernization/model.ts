import type { Drive, DrivingStats } from '@/types/driving';
import type { UnitPref } from '@/lib/unitConversion';
import {
  convertDistanceFromSI, convertSpeedFromSI, convertTempFromSI,
  convertEfficiencyFromSI,
} from '@/lib/unitConversion';
import { getEfficiency } from '@/lib/drivesAggregation';
import { formatDateShort } from '@/lib/dateFormat';

/** This is still a Wh/km ceiling, not a display-unit ceiling. */
export const EFFICIENCY_GAUGE_MAX_WH_PER_KM = 300;

/** Existing semantic chart ramp; never used to color body text. */
export function efficiencyColor(wh: number): string {
  if (wh < 140) return '#39ff14';
  if (wh < 170) return '#10b981';
  if (wh < 200) return '#00f0ff';
  if (wh < 240) return '#f59e0b';
  return '#ef4444';
}

export function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

const statsFields = [
  'totalDrives', 'totalDistanceKm', 'totalDurationS', 'avgEfficiencyWhKm',
  'avgSpeedKmh', 'topSpeedKmh', 'regenRatio', 'regenEnergyWh', 'co2SavedKg',
] as const;

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/** Guard malformed wire envelopes without mutating the query cache or renaming fields. */
export function inspectStats(value: unknown) {
  const valid = record(value) && statsFields.some(key => key in value);
  return {
    valid,
    partial: valid && statsFields.some(key => !finite(value[key])),
    data: valid ? value as unknown as DrivingStats : undefined,
  };
}

export function inspectDrives(value: unknown) {
  const valid = Array.isArray(value);
  // Retain object rows with missing measurements; eligibility is per series.
  const rows: Drive[] = valid ? value.filter(record) as unknown as Drive[] : [];
  const partial = valid && (rows.length !== value.length || rows.some(d =>
    !finite(d.distanceM) || !finite(d.energyUsedWh) || !finite(d.avgSpeedMps)
    || !finite(d.outsideTempAvgC) || typeof d.startTs !== 'string'
    || !Number.isFinite(Date.parse(d.startTs))));
  return { valid, partial, rows };
}

export function displayConverters(prefs: UnitPref) {
  return {
    toDistanceDisplay: (m: number) => convertDistanceFromSI(m, prefs.distance),
    toSpeedDisplay: (mps: number) => convertSpeedFromSI(mps, prefs.speed),
    toTemperatureDisplay: (c: number) => convertTempFromSI(c, prefs.temperature),
    toEfficiencyDisplay: (whPerKm: number) => convertEfficiencyFromSI(whPerKm, prefs.distance),
    // Verified legacy /drives/stats semantics: km, km/h, Wh/km. NOT SI wire fields.
    toStatsDistanceDisplay: (km: number) => convertDistanceFromSI(km * 1000, prefs.distance),
    toStatsSpeedDisplay: (kmh: number) => convertSpeedFromSI(kmh * 1000 / 3600, prefs.speed),
  };
}

export interface TemperatureBucket {
  range: string;
  count: number;
  avgEff: number | null;
  totalDist: number | null;
  avgSpeed: number | null;
}

/**
 * Original half-open range, newest 30 eligible drives reversed, display-speed
 * buckets and Celsius temperature boundaries. No aggregate is fabricated from
 * a different source. getEfficiency's positive-energy / minimum-distance
 * eligibility remains the canonical policy (zero energy does NOT imply intensity).
 */
export function buildEfficiencyModel(
  rows: readonly Drive[],
  prefs: UnitPref,
  startInstant?: string,
  endInstantExclusive?: string,
) {
  const converters = displayConverters(prefs);
  const { toDistanceDisplay, toSpeedDisplay, toTemperatureDisplay, toEfficiencyDisplay } = converters;
  const startMs = startInstant ? new Date(startInstant).getTime() : undefined;
  const endMs = endInstantExclusive ? new Date(endInstantExclusive).getTime() : undefined;
  const filteredDrives = rows.filter(d => {
    // Preserve original admission of undated rows, explicitly mark their date unknown below.
    if (!d.startTs) return true;
    const time = new Date(d.startTs).getTime();
    if (Number.isNaN(time)) return true;
    if (startMs !== undefined && time < startMs) return false;
    if (endMs !== undefined && time >= endMs) return false;
    return true;
  });
  const dateLabel = (date: string) =>
    typeof date === 'string' && Number.isFinite(Date.parse(date)) ? formatDateShort(date) : '—';
  const dailyTrend = filteredDrives.filter(d => getEfficiency(d) !== null)
    .slice(0, 30).reverse().map(d => ({
      date: dateLabel(d.startTs),
      efficiency: Math.round(toEfficiencyDisplay(getEfficiency(d)!)),
      distance: finite(d.distanceM) ? toDistanceDisplay(d.distanceM) : null,
    })).filter(d => finite(d.efficiency) && (d.distance == null || finite(d.distance)));
  const speedVsEff = filteredDrives
    .filter(d => finite(d.avgSpeedMps) && getEfficiency(d) !== null)
    .map(d => ({
      speed: Math.round(toSpeedDisplay(d.avgSpeedMps!)),
      efficiency: Math.round(toEfficiencyDisplay(getEfficiency(d)!)),
    })).filter(d => finite(d.speed) && finite(d.efficiency));
  const tempVsEff = filteredDrives
    .filter(d => finite(d.outsideTempAvgC) && getEfficiency(d) !== null)
    .map(d => ({
      temp: Math.round(toTemperatureDisplay(d.outsideTempAvgC!)),
      efficiency: Math.round(toEfficiencyDisplay(getEfficiency(d)!)),
    })).filter(d => finite(d.temp) && finite(d.efficiency));
  const speedRanges = [
    { range: '0–30', min: 0, max: 30, count: 0, totalEff: 0 },
    { range: '30–60', min: 30, max: 60, count: 0, totalEff: 0 },
    { range: '60–90', min: 60, max: 90, count: 0, totalEff: 0 },
    { range: '90–120', min: 90, max: 120, count: 0, totalEff: 0 },
    { range: '120+', min: 120, max: 999, count: 0, totalEff: 0 },
  ];
  filteredDrives.forEach(d => {
    if (!finite(d.avgSpeedMps)) return;
    const eff = getEfficiency(d);
    if (eff === null) return;
    const speed = toSpeedDisplay(d.avgSpeedMps);
    const bucket = speedRanges.find(b => speed >= b.min && speed < b.max);
    if (bucket) { bucket.count++; bucket.totalEff += eff; }
  });
  const speedDist = speedRanges.filter(b => b.count > 0).map(b => ({
    range: `${b.range} ${prefs.speed}`,
    avgEff: Math.round(toEfficiencyDisplay(b.totalEff / b.count)),
    count: b.count,
  })).filter(b => finite(b.avgEff));
  const isFahrenheit = prefs.temperature === '°F';
  const ranges = [
    { range: isFahrenheit ? '< 32°F' : '< 0°C', min: -999, max: 0 },
    { range: isFahrenheit ? '32–50°F' : '0–10°C', min: 0, max: 10 },
    { range: isFahrenheit ? '50–68°F' : '10–20°C', min: 10, max: 20 },
    { range: isFahrenheit ? '68–86°F' : '20–30°C', min: 20, max: 30 },
    { range: isFahrenheit ? '> 86°F' : '> 30°C', min: 30, max: 999 },
  ].map(r => ({ ...r, count: 0, totalEff: 0, totalDist: 0, totalSpeed: 0, missingSpeed: false }));
  filteredDrives.forEach(d => {
    if (!finite(d.outsideTempAvgC)) return;
    const eff = getEfficiency(d);
    if (eff === null) return;
    const b = ranges.find(r => d.outsideTempAvgC! >= r.min && d.outsideTempAvgC! < r.max);
    if (!b) return;
    b.count++;
    b.totalEff += eff;
    b.totalDist += d.distanceM;
    if (finite(d.avgSpeedMps)) b.totalSpeed += d.avgSpeedMps;
    else b.missingSpeed = true;
  });
  const tempBuckets: TemperatureBucket[] = ranges.filter(b => b.count > 0).map(b => ({
    range: b.range, count: b.count,
    avgEff: finite(b.totalEff) ? b.totalEff / b.count : null,
    totalDist: finite(b.totalDist) ? b.totalDist : null,
    // Original denominator remains count; incomplete coverage is unknown, never assumed zero.
    avgSpeed: b.missingSpeed || !finite(b.totalSpeed) ? null : b.totalSpeed / b.count,
  }));
  return { ...converters, filteredDrives, dailyTrend, speedVsEff, tempVsEff, speedDist, tempBuckets };
}

export type EfficiencyModel = ReturnType<typeof buildEfficiencyModel>;
