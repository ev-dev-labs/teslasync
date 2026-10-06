import type { Drive } from '@/types/driving';
import { getEnergyIntensityWhPerKm } from '@/lib/drivesAggregation';
import { typography } from '@/lib/tokens';

/** Per-drive heuristic computed only when all required evidence is measured. */
export interface ComputedScore {
  total: number;
  efficiency: number;
  smoothness: number;
  speed: number;
  grade: string;
  whPerKm: number;
}

export interface ScoredDrive {
  drive: Drive;
  score: ComputedScore;
}

/** Flat row shape for the shared DataTable (sortable by numeric fields). */
export interface HistoryRow {
  id: number;
  ts: string;
  route: string;
  distanceM: number;
  durationS: number | null;
  whPerKm: number;
  total: number;
  grade: string;
  efficiency: number;
  smoothness: number;
  speed: number;
}

/**
 * Gauge / chart fill colors keyed by grade. These are passed as dynamic
 * `color` props to LinearGauge / recharts fills — never used as body text.
 */
const GRADE_COLORS: Record<string, string> = {
  'A+': '#39ff14',
  A: '#4ade80',
  B: '#22d3ee',
  C: '#fbbf24',
  D: '#fb923c',
  F: '#f87171',
};

/** Category accent colors for gauges + chart series (dynamic fills only). */
export const CATEGORY_COLORS = {
  efficiency: '#4ade80',
  smoothness: '#22d3ee',
  speed: '#a78bfa',
};

export function scoreDrive(drive: Drive): ComputedScore | null {
  const whPerKm = getEnergyIntensityWhPerKm(drive.distanceM, drive.energyUsedWh);
  if (
    whPerKm == null
    || drive.avgPowerW == null
    || !Number.isFinite(drive.avgPowerW)
    || drive.avgPowerW < 0
    || drive.maxSpeedMps == null
    || !Number.isFinite(drive.maxSpeedMps)
    || drive.maxSpeedMps < 0
  ) {
    return null;
  }

  const effScore = Math.max(0, Math.min(40, 40 - (whPerKm - 130) / 3));
  const smoothScore = Math.max(0, Math.min(30, 30 - drive.avgPowerW / 3_000));
  const highSpeedExcessMps = Math.max(0, drive.maxSpeedMps - 40.2336);
  const speedScore = Math.max(
    0,
    Math.min(30, 30 - highSpeedExcessMps * 1.1184681460272),
  );

  const total = Math.round(effScore + smoothScore + speedScore);
  const grade =
    total >= 90
      ? 'A+'
      : total >= 80
        ? 'A'
        : total >= 70
          ? 'B'
          : total >= 60
            ? 'C'
            : total >= 50
              ? 'D'
              : 'F';

  return {
    total,
    efficiency: Math.round(effScore),
    smoothness: Math.round(smoothScore),
    speed: Math.round(speedScore),
    grade,
    whPerKm: Math.round(whPerKm),
  };
}

export function gradeFromScore(score: number): string {
  return score >= 90
    ? 'A+'
    : score >= 80
      ? 'A'
      : score >= 70
        ? 'B'
        : score >= 60
          ? 'C'
          : score >= 50
            ? 'D'
            : 'F';
}

export function gradeVariant(grade: string): 'success' | 'info' | 'warning' | 'danger' {
  if (grade === 'A+' || grade === 'A') return 'success';
  if (grade === 'B') return 'info';
  if (grade === 'C') return 'warning';
  return 'danger';
}

export function gradeColor(grade: string): string {
  return GRADE_COLORS[grade] ?? '#94a3b8';
}

/** Toned body-text color per grade (300-level shades, never neon). */
const GRADE_TEXT_CLASS: Record<string, string> = {
  'A+': 'text-emerald-300',
  A: 'text-emerald-300',
  B: 'text-cyan-300',
  C: 'text-amber-300',
  D: 'text-orange-300',
  F: 'text-rose-300',
};

export function gradeTextClass(grade: string): string {
  return GRADE_TEXT_CLASS[grade] ?? typography.color.secondary;
}
