/**
 * Efficiency Landscape model — the car's consumption as a 2D field over
 * average speed × outside temperature.
 *
 * Every drive lands in one (speed band, temp band) cell; cells report
 * distance-weighted consumption and their evidence (distance, drives), so the
 * page can render a field map where color encodes Wh/km and confidence gates
 * what's shown. Includes a pure hex color interpolator for the sequential
 * scale. Pure and React-free.
 */

import type { Drive } from '@/types/driving';

export interface BandDef {
  /** Inclusive lower bound. */
  from: number;
  /** Exclusive upper bound (Infinity for the last band). */
  to: number;
}

export const SPEED_BANDS_KPH: BandDef[] = [
  { from: 0, to: 30 },
  { from: 30, to: 50 },
  { from: 50, to: 70 },
  { from: 70, to: 90 },
  { from: 90, to: 110 },
  { from: 110, to: Infinity },
];

export const TEMP_BANDS_C: BandDef[] = [
  { from: -Infinity, to: -5 },
  { from: -5, to: 5 },
  { from: 5, to: 15 },
  { from: 15, to: 25 },
  { from: 25, to: Infinity },
];

export interface LandscapeCell {
  speedBand: number;
  tempBand: number;
  whPerKm: number | null;
  distanceM: number;
  drives: number;
}

export interface LandscapeSummary {
  /** cells[tempBand][speedBand]. */
  cells: LandscapeCell[][];
  minWhPerKm: number | null;
  maxWhPerKm: number | null;
  /** Best/worst populated cells (≥ minDistanceM evidence). */
  best: LandscapeCell | null;
  worst: LandscapeCell | null;
  analyzed: number;
}

function bandIndex(bands: readonly BandDef[], v: number): number {
  for (let i = 0; i < bands.length; i++) {
    if (v >= bands[i]!.from && v < bands[i]!.to) return i;
  }
  return bands.length - 1;
}

function usable(d: Drive): boolean {
  return (
    d.energyUsedWh != null && Number.isFinite(d.energyUsedWh) && d.energyUsedWh > 0 &&
    Number.isFinite(d.distanceM) && d.distanceM >= 2000 &&
    d.avgSpeedMps != null && Number.isFinite(d.avgSpeedMps) && d.avgSpeedMps > 0 &&
    d.outsideTempAvgC != null && Number.isFinite(d.outsideTempAvgC)
  );
}

/** Cells need this much distance before their color is trustworthy. */
export const MIN_CELL_DISTANCE_M = 10_000;

export function buildLandscape(drives: readonly Drive[]): LandscapeSummary {
  const agg: { energy: number; distance: number; drives: number }[][] = TEMP_BANDS_C.map(() =>
    SPEED_BANDS_KPH.map(() => ({ energy: 0, distance: 0, drives: 0 })),
  );

  let analyzed = 0;
  for (const d of drives) {
    if (!usable(d)) continue;
    analyzed += 1;
    const ti = bandIndex(TEMP_BANDS_C, d.outsideTempAvgC!);
    const si = bandIndex(SPEED_BANDS_KPH, d.avgSpeedMps! * 3.6);
    const cell = agg[ti]![si]!;
    cell.energy += d.energyUsedWh!;
    cell.distance += d.distanceM;
    cell.drives += 1;
  }

  let min: number | null = null;
  let max: number | null = null;
  let best: LandscapeCell | null = null;
  let worst: LandscapeCell | null = null;

  const cells: LandscapeCell[][] = agg.map((row, ti) =>
    row.map((a, si) => {
      const whPerKm = a.distance >= 1000 ? Math.round((a.energy / (a.distance / 1000)) * 10) / 10 : null;
      const cell: LandscapeCell = { speedBand: si, tempBand: ti, whPerKm, distanceM: a.distance, drives: a.drives };
      if (whPerKm != null && a.distance >= MIN_CELL_DISTANCE_M) {
        if (min == null || whPerKm < min) min = whPerKm;
        if (max == null || whPerKm > max) max = whPerKm;
        if (best == null || whPerKm < best.whPerKm!) best = cell;
        if (worst == null || whPerKm > worst.whPerKm!) worst = cell;
      }
      return cell;
    }),
  );

  return { cells, minWhPerKm: min, maxWhPerKm: max, best, worst, analyzed };
}

/* ── Sequential color scale ──────────────────────────────────────── */

/** Linear interpolation between two #rrggbb colors; t clamped to [0, 1]. */
export function lerpHex(fromHex: string, toHex: string, t: number): string {
  const clamp = Math.min(1, Math.max(0, t));
  const parse = (h: string) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ] as const;
  const a = parse(fromHex);
  const b = parse(toHex);
  const mix = (i: 0 | 1 | 2) => Math.round(a[i] + (b[i] - a[i]) * clamp);
  return `#${[mix(0), mix(1), mix(2)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Normalized position of a cell's consumption inside [min, max] for the
 * color scale; 0.5 when the range is degenerate.
 */
export function scalePosition(whPerKm: number, min: number, max: number): number {
  if (!(max > min)) return 0.5;
  return Math.min(1, Math.max(0, (whPerKm - min) / (max - min)));
}
