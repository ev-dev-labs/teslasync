/**
 * Drive Anomaly model — which drives don't fit YOUR car's normal behavior.
 *
 * Fits a quadratic least-squares curve of consumption (Wh/km) against average
 * speed over the driver's own history — the personal baseline — then scores
 * every drive by its studentized residual. Drives beyond ±2σ are outliers,
 * each annotated with data-backed candidate explanations (cold weather, hot
 * weather, missing regen, stop-and-go crawling). Pure and React-free.
 */

import type { Drive } from '@/types/driving';

export interface FitPoint {
  driveId: number;
  startTs: string;
  speedKph: number;
  whPerKm: number;
  predicted: number;
  /** Studentized residual: (actual − predicted) / σ. */
  z: number;
}

export type AnomalyReason = 'cold' | 'hot' | 'lowRegen' | 'crawl' | 'unknown' | 'efficient';

export interface AnomalyDrive extends FitPoint {
  reasons: AnomalyReason[];
}

export interface CurveSample {
  speedKph: number;
  predicted: number;
  upper2: number;
  lower2: number;
}

export interface AnomalySummary {
  points: FitPoint[];
  /** |z| ≥ 2 drives, most extreme first. */
  outliers: AnomalyDrive[];
  /** Residual standard deviation, Wh/km. */
  sigma: number | null;
  /** Quadratic coefficients [c0, c1, c2] of predicted = c0 + c1·v + c2·v². */
  coefficients: [number, number, number] | null;
  /** Curve with ±2σ band, sampled across the observed speed range. */
  curve: CurveSample[];
  analyzed: number;
}

function usable(d: Drive): boolean {
  return (
    d.energyUsedWh != null && Number.isFinite(d.energyUsedWh) && d.energyUsedWh > 0 &&
    Number.isFinite(d.distanceM) && d.distanceM >= 2000 &&
    d.avgSpeedMps != null && Number.isFinite(d.avgSpeedMps) && d.avgSpeedMps > 0
  );
}

/** Solve the 3×3 linear system A·x = b by Gaussian elimination with pivoting. */
export function solve3(a: number[][], b: number[]): [number, number, number] | null {
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    }
    if (Math.abs(m[pivot]![col]!) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const factor = m[r]![col]! / m[col]![col]!;
      for (let c = col; c < 4; c++) m[r]![c]! -= factor * m[col]![c]!;
    }
  }
  return [m[0]![3]! / m[0]![0]!, m[1]![3]! / m[1]![1]!, m[2]![3]! / m[2]![2]!];
}

/** Least-squares quadratic fit y = c0 + c1·x + c2·x². */
export function fitQuadratic(xs: readonly number[], ys: readonly number[]): [number, number, number] | null {
  const n = xs.length;
  if (n < 8) return null; // demand a real sample before claiming a baseline
  let sx = 0, sx2 = 0, sx3 = 0, sx4 = 0, sy = 0, sxy = 0, sx2y = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    const x2 = x * x;
    sx += x; sx2 += x2; sx3 += x2 * x; sx4 += x2 * x2;
    sy += y; sxy += x * y; sx2y += x2 * y;
  }
  return solve3(
    [[n, sx, sx2], [sx, sx2, sx3], [sx2, sx3, sx4]],
    [sy, sxy, sx2y],
  );
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function summarizeAnomalies(drives: readonly Drive[]): AnomalySummary {
  const rows = drives.filter(usable).map((d) => ({
    drive: d,
    speedKph: d.avgSpeedMps! * 3.6,
    whPerKm: d.energyUsedWh! / (d.distanceM / 1000),
  }));

  const empty: AnomalySummary = {
    points: [], outliers: [], sigma: null, coefficients: null, curve: [], analyzed: rows.length,
  };
  const coeffs = fitQuadratic(rows.map((r) => r.speedKph), rows.map((r) => r.whPerKm));
  if (coeffs == null) return empty;

  const [c0, c1, c2] = coeffs;
  const predict = (v: number) => c0 + c1 * v + c2 * v * v;

  const residuals = rows.map((r) => r.whPerKm - predict(r.speedKph));
  // Residual σ with the 3 fitted parameters removed from the dof.
  const dof = Math.max(1, rows.length - 3);
  const sigma = Math.sqrt(residuals.reduce((s, e) => s + e * e, 0) / dof);
  if (!(sigma > 0)) return { ...empty, coefficients: coeffs, sigma: 0 };

  const points: FitPoint[] = rows.map((r, i) => ({
    driveId: r.drive.id,
    startTs: r.drive.startTs,
    speedKph: Math.round(r.speedKph * 10) / 10,
    whPerKm: Math.round(r.whPerKm * 10) / 10,
    predicted: Math.round(predict(r.speedKph) * 10) / 10,
    z: Math.round((residuals[i]! / sigma) * 100) / 100,
  }));

  // Data-backed reasons for each outlier, judged against the cohort medians.
  const medTemp = median(
    rows.map((r) => r.drive.outsideTempAvgC).filter((t): t is number => t != null && Number.isFinite(t)),
  );
  const regenShares = rows.map((r) => {
    const rg = r.drive.regenEnergyWh;
    return rg != null && Number.isFinite(rg) && rg >= 0 ? rg / r.drive.energyUsedWh! : null;
  });
  const medRegen = median(regenShares.filter((s): s is number => s != null));

  const outliers: AnomalyDrive[] = points
    .map((p, i) => ({ p, row: rows[i]!, regenShare: regenShares[i] }))
    .filter(({ p }) => Math.abs(p.z) >= 2)
    .sort((a, b) => Math.abs(b.p.z) - Math.abs(a.p.z))
    .slice(0, 10)
    .map(({ p, row, regenShare }) => {
      const reasons: AnomalyReason[] = [];
      if (p.z < 0) {
        reasons.push('efficient');
      } else {
        const temp = row.drive.outsideTempAvgC;
        if (temp != null && medTemp != null && temp <= medTemp - 8) reasons.push('cold');
        if (temp != null && medTemp != null && temp >= medTemp + 8) reasons.push('hot');
        if (regenShare != null && medRegen != null && regenShare <= medRegen * 0.5) reasons.push('lowRegen');
        if (p.speedKph < 20) reasons.push('crawl');
        if (reasons.length === 0) reasons.push('unknown');
      }
      return { ...p, reasons };
    });

  // Band curve across the observed speed range.
  const speeds = rows.map((r) => r.speedKph);
  const minV = Math.floor(Math.min(...speeds));
  const maxV = Math.ceil(Math.max(...speeds));
  const curve: CurveSample[] = [];
  const step = Math.max(1, Math.round((maxV - minV) / 40));
  for (let v = minV; v <= maxV; v += step) {
    const mid = predict(v);
    curve.push({
      speedKph: v,
      predicted: Math.round(mid * 10) / 10,
      upper2: Math.round((mid + 2 * sigma) * 10) / 10,
      lower2: Math.round(Math.max(0, mid - 2 * sigma) * 10) / 10,
    });
  }

  return {
    points,
    outliers,
    sigma: Math.round(sigma * 10) / 10,
    coefficients: coeffs,
    curve,
    analyzed: rows.length,
  };
}
