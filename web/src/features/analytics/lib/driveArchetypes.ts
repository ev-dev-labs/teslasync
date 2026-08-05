/**
 * Drive Archetypes — unsupervised discovery of how this car actually gets used.
 *
 * Nobody labels their trips, so the app has no ground truth for "commute" vs
 * "errand" vs "road trip". This module finds those groupings from the data
 * itself: each drive becomes a point in a standardised feature space
 *
 *   [ log distance · average speed · sin(hour) · cos(hour) · Wh/km · ambient ]
 *
 * and **k-means++** partitions them. Two details make the result trustworthy
 * rather than decorative:
 *
 *  - Time-of-day is encoded as a *sine/cosine pair*, so 23:00 and 01:00 sit
 *    next to each other on the circle instead of at opposite ends of a line.
 *    Clustering raw hour numbers is the classic way to split a single
 *    late-night habit into two bogus archetypes.
 *  - `k` is chosen by the **mean silhouette coefficient** over k = 2…5 rather
 *    than being hard-coded, so a driver with one routine gets two clusters and
 *    a driver with genuinely varied use gets five.
 *
 * Seeding is deterministic (`mulberry32`), so the same drives always produce
 * the same archetypes — a clustering page that reshuffles its own labels on
 * every render is worse than no page at all.
 *
 * Pure and React-free.
 */

import type { Drive } from '@/types/driving';

/** Raw, human-readable centroid position (un-standardised). */
export interface ArchetypeCentroid {
  distanceKm: number;
  speedKph: number;
  /** Circular mean of start hour, 0–23.9. */
  hour: number;
  whPerKm: number;
  tempC: number;
}

export interface Archetype {
  index: number;
  /** Stable English label; the page translates it via a key map. */
  label: ArchetypeLabel;
  size: number;
  /** Share of analysed drives, 0–1. */
  share: number;
  centroid: ArchetypeCentroid;
  medianWhPerKm: number;
  totalDistanceM: number;
  driveIds: number[];
}

export interface ArchetypeSummary {
  clusters: Archetype[];
  /** Chosen cluster count. 0 when there was not enough data. */
  k: number;
  /** Mean silhouette of the chosen partition, −1…1. */
  silhouette: number;
  analyzedDrives: number;
  /** Drives dropped for missing distance / energy / speed. */
  skippedDrives: number;
}

export type ArchetypeLabel =
  | 'highwayRun'
  | 'roadTrip'
  | 'morningCommute'
  | 'eveningCommute'
  | 'shortHop'
  | 'coldWeather'
  | 'everyday';

export interface ArchetypeOptions {
  minK?: number;
  maxK?: number;
  /** Minimum drives required before clustering is attempted at all. */
  minDrives?: number;
  /** Cap on points used for the O(n²) silhouette evaluation. */
  silhouetteSample?: number;
  seed?: number;
}

const DEFAULTS = {
  minK: 2,
  maxK: 5,
  minDrives: 20,
  silhouetteSample: 400,
  seed: 0x5eed,
} as const;

const FEATURE_COUNT = 6;
const KMEANS_ITERATIONS = 40;
const KMEANS_RESTARTS = 4;

interface DrivePoint {
  driveId: number;
  distanceM: number;
  distanceKm: number;
  speedKph: number;
  hour: number;
  whPerKm: number;
  tempC: number;
  features: number[];
}

/** Deterministic 32-bit PRNG — same seed, same clusters, every render. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function usable(d: Drive): boolean {
  return (
    Number.isFinite(d.distanceM) && d.distanceM >= 500 &&
    d.energyUsedWh != null && Number.isFinite(d.energyUsedWh) && d.energyUsedWh > 0 &&
    d.avgSpeedMps != null && Number.isFinite(d.avgSpeedMps) && d.avgSpeedMps > 0
  );
}

/**
 * Project drives into the raw (un-standardised) feature space.
 *
 * Exported so the encoding — especially the circular hour treatment — can be
 * asserted independently of the clustering.
 */
export function buildDrivePoints(drives: readonly Drive[]): {
  points: DrivePoint[];
  skipped: number;
} {
  const points: DrivePoint[] = [];
  let skipped = 0;

  for (const d of drives) {
    if (!usable(d)) {
      skipped += 1;
      continue;
    }
    const startMs = new Date(d.startTs).getTime();
    if (!Number.isFinite(startMs)) {
      skipped += 1;
      continue;
    }
    const distanceKm = d.distanceM / 1000;
    const hour = new Date(startMs).getHours();
    const angle = (hour / 24) * 2 * Math.PI;
    const whPerKm = d.energyUsedWh! / distanceKm;
    const speedKph = d.avgSpeedMps! * 3.6;
    const tempC = d.outsideTempAvgC ?? 15;

    points.push({
      driveId: d.id,
      distanceM: d.distanceM,
      distanceKm,
      speedKph,
      hour,
      whPerKm,
      tempC,
      features: [Math.log1p(distanceKm), speedKph, Math.sin(angle), Math.cos(angle), whPerKm, tempC],
    });
  }

  return { points, skipped };
}

/** Z-score each dimension in place; zero-variance dimensions collapse to 0. */
function standardize(points: readonly DrivePoint[]): number[][] {
  const n = points.length;
  const means = new Array<number>(FEATURE_COUNT).fill(0);
  const sds = new Array<number>(FEATURE_COUNT).fill(0);

  for (let f = 0; f < FEATURE_COUNT; f++) {
    let sum = 0;
    for (const p of points) sum += p.features[f]!;
    means[f] = sum / n;
    let varSum = 0;
    for (const p of points) {
      const dv = p.features[f]! - means[f]!;
      varSum += dv * dv;
    }
    sds[f] = Math.sqrt(varSum / n);
  }

  return points.map((p) =>
    p.features.map((v, f) => (sds[f]! > 1e-9 ? (v - means[f]!) / sds[f]! : 0)),
  );
}

function sqDist(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    sum += d * d;
  }
  return sum;
}

/**
 * k-means++ seeding followed by Lloyd iterations.
 *
 * Exported so the partitioner can be validated on synthetic, obviously
 * separable blobs without going through drives.
 */
export function kMeans(
  data: readonly number[][],
  k: number,
  rand: () => number,
): { assignments: number[]; centroids: number[][]; inertia: number } {
  const n = data.length;
  const dim = data[0]?.length ?? 0;

  // ── k-means++ seeding ────────────────────────────────────────────────
  const centroids: number[][] = [[...data[Math.floor(rand() * n)]!]];
  const closest = data.map((p) => sqDist(p, centroids[0]!));

  while (centroids.length < k) {
    let total = 0;
    for (const d of closest) total += d;
    let target = rand() * total;
    let pick = n - 1;
    for (let i = 0; i < n; i++) {
      target -= closest[i]!;
      if (target <= 0) {
        pick = i;
        break;
      }
    }
    const next = [...data[pick]!];
    centroids.push(next);
    for (let i = 0; i < n; i++) {
      const d = sqDist(data[i]!, next);
      if (d < closest[i]!) closest[i] = d;
    }
  }

  // ── Lloyd iterations ────────────────────────────────────────────────
  const assignments = new Array<number>(n).fill(0);
  for (let iter = 0; iter < KMEANS_ITERATIONS; iter++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = sqDist(data[i]!, centroids[c]!);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best;
        moved = true;
      }
    }

    const sums = Array.from({ length: k }, () => new Array<number>(dim).fill(0));
    const counts = new Array<number>(k).fill(0);
    for (let i = 0; i < n; i++) {
      const c = assignments[i]!;
      counts[c] += 1;
      for (let f = 0; f < dim; f++) sums[c]![f]! += data[i]![f]!;
    }
    for (let c = 0; c < k; c++) {
      // An emptied centroid is re-seeded on the farthest point rather than
      // left to sit at the origin dragging the partition around.
      if (counts[c] === 0) {
        let far = 0;
        let farD = -1;
        for (let i = 0; i < n; i++) {
          const d = sqDist(data[i]!, centroids[assignments[i]!]!);
          if (d > farD) {
            farD = d;
            far = i;
          }
        }
        centroids[c] = [...data[far]!];
        continue;
      }
      for (let f = 0; f < dim; f++) centroids[c]![f] = sums[c]![f]! / counts[c]!;
    }

    if (!moved && iter > 0) break;
  }

  let inertia = 0;
  for (let i = 0; i < n; i++) inertia += sqDist(data[i]!, centroids[assignments[i]!]!);

  return { assignments, centroids, inertia };
}

/**
 * Mean silhouette coefficient over a bounded sample.
 *
 * Exported for direct testing: a clean two-blob partition must score high and
 * a partition that splits one blob in half must score low.
 */
export function meanSilhouette(
  data: readonly number[][],
  assignments: readonly number[],
  k: number,
  sampleSize: number,
): number {
  const n = data.length;
  if (n < 2 || k < 2) return 0;
  const step = Math.max(1, Math.ceil(n / sampleSize));

  let total = 0;
  let counted = 0;
  for (let i = 0; i < n; i += step) {
    const own = assignments[i]!;
    const sums = new Array<number>(k).fill(0);
    const counts = new Array<number>(k).fill(0);
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const c = assignments[j]!;
      sums[c]! += Math.sqrt(sqDist(data[i]!, data[j]!));
      counts[c]! += 1;
    }
    if (counts[own] === 0) continue;
    const a = sums[own]! / counts[own]!;
    let b = Infinity;
    for (let c = 0; c < k; c++) {
      if (c === own || counts[c] === 0) continue;
      b = Math.min(b, sums[c]! / counts[c]!);
    }
    if (!Number.isFinite(b)) continue;
    const denom = Math.max(a, b);
    if (denom > 0) {
      total += (b - a) / denom;
      counted += 1;
    }
  }

  return counted > 0 ? total / counted : 0;
}

/** Circular mean of hours so a midnight cluster averages to ~0, not to 12. */
function circularMeanHour(hours: readonly number[]): number {
  let sx = 0;
  let sy = 0;
  for (const h of hours) {
    const a = (h / 24) * 2 * Math.PI;
    sx += Math.cos(a);
    sy += Math.sin(a);
  }
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) return 0;
  let angle = Math.atan2(sy, sx);
  if (angle < 0) angle += 2 * Math.PI;
  return (angle / (2 * Math.PI)) * 24;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Assign a human-meaningful name from the centroid's physical position.
 *
 * Exported so the naming rules can be tested as a decision table without
 * running k-means.
 */
export function labelForCentroid(c: ArchetypeCentroid): ArchetypeLabel {
  if (c.distanceKm >= 150) return 'roadTrip';
  if (c.speedKph >= 70 && c.distanceKm >= 30) return 'highwayRun';
  if (c.distanceKm <= 6) return 'shortHop';
  if (c.tempC <= 3) return 'coldWeather';
  if (c.hour >= 5.5 && c.hour < 10.5) return 'morningCommute';
  if (c.hour >= 15.5 && c.hour < 20.5) return 'eveningCommute';
  return 'everyday';
}

export function summarizeArchetypes(
  drives: readonly Drive[],
  options: ArchetypeOptions = {},
): ArchetypeSummary {
  const opts = { ...DEFAULTS, ...options };
  const { points, skipped } = buildDrivePoints(drives);

  if (points.length < opts.minDrives) {
    return {
      clusters: [],
      k: 0,
      silhouette: 0,
      analyzedDrives: points.length,
      skippedDrives: skipped,
    };
  }

  const data = standardize(points);
  const maxK = Math.min(opts.maxK, Math.floor(points.length / 4));

  let best: { k: number; assignments: number[]; silhouette: number } | null = null;
  for (let k = opts.minK; k <= Math.max(opts.minK, maxK); k++) {
    // Multiple restarts: k-means++ is seeded well but not immune to a bad draw.
    let bestRun: { assignments: number[]; inertia: number } | null = null;
    for (let r = 0; r < KMEANS_RESTARTS; r++) {
      const run = kMeans(data, k, mulberry32(opts.seed + k * 131 + r * 977));
      if (bestRun == null || run.inertia < bestRun.inertia) bestRun = run;
    }
    const sil = meanSilhouette(data, bestRun!.assignments, k, opts.silhouetteSample);
    if (best == null || sil > best.silhouette) {
      best = { k, assignments: bestRun!.assignments, silhouette: sil };
    }
  }

  const chosen = best!;
  const buckets: DrivePoint[][] = Array.from({ length: chosen.k }, () => []);
  for (let i = 0; i < points.length; i++) buckets[chosen.assignments[i]!]!.push(points[i]!);

  const clusters: Archetype[] = buckets
    .map((members, index) => {
      const size = members.length;
      const mean = (pick: (p: DrivePoint) => number) =>
        size === 0 ? 0 : members.reduce((sum, p) => sum + pick(p), 0) / size;

      const centroid: ArchetypeCentroid = {
        distanceKm: Math.round(mean((p) => p.distanceKm) * 10) / 10,
        speedKph: Math.round(mean((p) => p.speedKph)),
        hour: Math.round(circularMeanHour(members.map((p) => p.hour)) * 10) / 10,
        whPerKm: Math.round(mean((p) => p.whPerKm)),
        tempC: Math.round(mean((p) => p.tempC) * 10) / 10,
      };

      return {
        index,
        label: labelForCentroid(centroid),
        size,
        share: Math.round((size / points.length) * 1000) / 1000,
        centroid,
        medianWhPerKm: Math.round(median(members.map((p) => p.whPerKm))),
        totalDistanceM: Math.round(members.reduce((sum, p) => sum + p.distanceM, 0)),
        driveIds: members.map((p) => p.driveId),
      };
    })
    .filter((c) => c.size > 0)
    .sort((a, b) => b.size - a.size);

  return {
    clusters,
    k: clusters.length,
    silhouette: Math.round(chosen.silhouette * 1000) / 1000,
    analyzedDrives: points.length,
    skippedDrives: skipped,
  };
}
