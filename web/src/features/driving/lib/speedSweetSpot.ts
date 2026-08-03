/**
 * Speed Sweet Spot model — the average speed at which this car sips least.
 *
 * Buckets drives by average speed and computes distance-weighted consumption
 * (Wh/km) per bucket, then picks the qualified bucket with the lowest
 * consumption as the "sweet spot". Consumption stays in SI Wh/km throughout —
 * the page converts to Wh/mi at the display boundary.
 */

import type { Drive } from '@/types/driving';

export interface SweetSpotOptions {
  /** Bucket width in km/h. */
  bucketKph?: number;
  /** Buckets need at least this many drives to qualify for the sweet spot. */
  minDrivesPerBucket?: number;
}

export interface SpeedBucketPoint {
  /** Bucket midpoint, km/h. */
  speedKph: number;
  /** Distance-weighted consumption, Wh/km. */
  whPerKm: number;
  drives: number;
  distanceM: number;
}

export interface SweetSpotBand {
  fromKph: number;
  toKph: number;
  whPerKm: number;
}

export interface SweetSpotResult {
  points: SpeedBucketPoint[];
  /** Lowest-consumption qualified bucket; null when no bucket qualifies. */
  sweetSpot: SweetSpotBand | null;
  /** Distance-weighted consumption across every analyzed drive, Wh/km. */
  overallWhPerKm: number | null;
  /**
   * Relative saving if all driving matched the sweet-spot consumption,
   * 0–1 (e.g. 0.12 = 12% less energy). Null without both inputs.
   */
  savingShare: number | null;
  analyzed: number;
}

/**
 * Noise filters: town crawls under 2 km or 5 minutes have consumption
 * dominated by HVAC warm-up and parking-lot maneuvering, not by speed.
 */
function analyzable(d: Drive): boolean {
  return (
    d.avgSpeedMps != null && Number.isFinite(d.avgSpeedMps) && d.avgSpeedMps > 0 &&
    d.energyUsedWh != null && Number.isFinite(d.energyUsedWh) && d.energyUsedWh > 0 &&
    Number.isFinite(d.distanceM) && d.distanceM >= 2000 &&
    Number.isFinite(d.durationS) && d.durationS >= 300
  );
}

export function computeSweetSpot(
  drives: readonly Drive[],
  options: SweetSpotOptions = {},
): SweetSpotResult {
  const bucketKph = options.bucketKph ?? 10;
  const minDrives = options.minDrivesPerBucket ?? 3;

  const usable = drives.filter(analyzable);

  const buckets = new Map<number, { energyWh: number; distanceM: number; drives: number }>();
  let totalEnergyWh = 0;
  let totalDistanceM = 0;

  for (const d of usable) {
    const speedKph = d.avgSpeedMps! * 3.6;
    const idx = Math.floor(speedKph / bucketKph);
    const agg = buckets.get(idx) ?? { energyWh: 0, distanceM: 0, drives: 0 };
    agg.energyWh += d.energyUsedWh!;
    agg.distanceM += d.distanceM;
    agg.drives += 1;
    buckets.set(idx, agg);
    totalEnergyWh += d.energyUsedWh!;
    totalDistanceM += d.distanceM;
  }

  const points: SpeedBucketPoint[] = Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([idx, agg]) => ({
      speedKph: idx * bucketKph + bucketKph / 2,
      whPerKm: Math.round((agg.energyWh / (agg.distanceM / 1000)) * 10) / 10,
      drives: agg.drives,
      distanceM: agg.distanceM,
    }));

  let sweetSpot: SweetSpotBand | null = null;
  for (const p of points) {
    if (p.drives < minDrives) continue;
    if (sweetSpot == null || p.whPerKm < sweetSpot.whPerKm) {
      sweetSpot = {
        fromKph: p.speedKph - bucketKph / 2,
        toKph: p.speedKph + bucketKph / 2,
        whPerKm: p.whPerKm,
      };
    }
  }

  const overallWhPerKm =
    totalDistanceM > 0 ? Math.round((totalEnergyWh / (totalDistanceM / 1000)) * 10) / 10 : null;

  const savingShare =
    sweetSpot != null && overallWhPerKm != null && overallWhPerKm > 0
      ? Math.max(0, (overallWhPerKm - sweetSpot.whPerKm) / overallWhPerKm)
      : null;

  return { points, sweetSpot, overallWhPerKm, savingShare, analyzed: usable.length };
}
