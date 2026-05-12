/**
 * Generic A–F score-scale helpers shared across pages that render a
 * letter-grade badge (Drives, Charging, future Trips). Pure functions
 * with no React or domain knowledge so any caller can use them.
 *
 * The palette and thresholds match the existing per-drive grade badge
 * (see `lib/drivesAggregation.ts > GRADE_PALETTE`) so a screen showing
 * both a Drive grade and a Charging grade uses the same colours for
 * "A", "B", etc — no per-page palette drift.
 */

export type ScoreGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' | '—';

export interface ScoreGradeInfo {
  /** Display label. `—` when input is null / NaN. */
  label: ScoreGrade;
  /** Hex colour for the badge text. */
  color: string;
  /**
   * Numeric weight for averaging across many items. `null` for the "no
   * data" sentinel so callers can skip it in arithmetic.
   */
  numeric: number | null;
}

/** Shared palette. Keep in lock-step with `lib/drivesAggregation` GRADE_PALETTE. */
const GRADE_PALETTE: Record<ScoreGrade, { color: string; numeric: number | null }> = {
  'A+': { color: '#10b981', numeric: 4.5 },
  A:    { color: '#10b981', numeric: 4.0 },
  B:    { color: '#00f0ff', numeric: 3.0 },
  C:    { color: '#f59e0b', numeric: 2.0 },
  D:    { color: '#ef4444', numeric: 1.0 },
  F:    { color: '#b91c1c', numeric: 0.5 },
  '—':  { color: '#6b7280', numeric: null },
};

/** Default 0–100 thresholds. Lower bound inclusive. */
export const DEFAULT_SCORE_THRESHOLDS: ReadonlyArray<{ min: number; label: ScoreGrade }> = [
  { min: 90, label: 'A+' },
  { min: 80, label: 'A'  },
  { min: 65, label: 'B'  },
  { min: 50, label: 'C'  },
  { min: 35, label: 'D'  },
  { min: 0,  label: 'F'  },
];

/**
 * Map a 0–100 numeric score to a letter grade. Caller can override
 * thresholds (Wh/km efficiency, latency ms, anything ordered).
 */
export function numericToGrade(
  score: number | null | undefined,
  thresholds: ReadonlyArray<{ min: number; label: ScoreGrade }> = DEFAULT_SCORE_THRESHOLDS,
): ScoreGradeInfo {
  if (score == null || !Number.isFinite(score)) {
    return { label: '—', ...GRADE_PALETTE['—'] };
  }
  // Thresholds are evaluated highest-first so the first match wins.
  const sorted = [...thresholds].sort((a, b) => b.min - a.min);
  for (const t of sorted) {
    if (score >= t.min) {
      return { label: t.label, ...GRADE_PALETTE[t.label] };
    }
  }
  return { label: 'F', ...GRADE_PALETTE.F };
}

/** Lookup the colour + numeric weight for a known grade label. */
export function gradeInfo(label: ScoreGrade): ScoreGradeInfo {
  return { label, ...GRADE_PALETTE[label] };
}

/**
 * Average a list of grade-numerics (skipping `null`) and map back to
 * a letter grade. Returns `—` when no graded inputs are present.
 */
export function averageGrade(values: ReadonlyArray<number | null>): ScoreGradeInfo {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (v != null && Number.isFinite(v)) {
      sum += v;
      n += 1;
    }
  }
  if (n === 0) return { label: '—', ...GRADE_PALETTE['—'] };
  // Map averaged numeric back to a label using inverse of GRADE_PALETTE.
  const avg = sum / n;
  if (avg >= 4.25) return { label: 'A+', ...GRADE_PALETTE['A+'] };
  if (avg >= 3.5)  return { label: 'A',  ...GRADE_PALETTE.A };
  if (avg >= 2.5)  return { label: 'B',  ...GRADE_PALETTE.B };
  if (avg >= 1.5)  return { label: 'C',  ...GRADE_PALETTE.C };
  if (avg >= 0.75) return { label: 'D',  ...GRADE_PALETTE.D };
  return { label: 'F', ...GRADE_PALETTE.F };
}
