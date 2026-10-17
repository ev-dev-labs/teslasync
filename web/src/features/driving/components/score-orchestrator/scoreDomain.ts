import type { Drive } from '@/types/driving';
import { MIN_EFFICIENCY_DISTANCE_M } from '@/lib/drivesAggregation';
import { chartTokens, gaugeTone, neonColorMap, typography } from '@/lib/tokens';
import type { TFunction } from 'i18next';

export function localScoreExplanation(t: TFunction): string {
  return t('driveScore.localHeuristicInputs', {
    defaultValue: 'Local heuristic: efficiency uses recorded energy divided by distance; smoothness uses average power, not acceleration or braking events; speed uses maximum speed, not speed-limit compliance. These inputs do not establish causes or driving safety.',
  });
}

export function localScoreInsight(
  t: TFunction,
  kind: 'best' | 'worst',
  score: ComputedScore | undefined,
): string {
  if (!score) return '';
  if (kind === 'best') {
    if (score.efficiency >= 35) return t('driveScore.heuristicBestEfficiency', {
      defaultValue: 'Local heuristic: low recorded energy per distance contributes to the efficiency score.',
    });
    if (score.smoothness >= 25) return t('driveScore.heuristicBestPower', {
      defaultValue: 'Local heuristic: low average power contributes to the smoothness score; acceleration and braking were not assessed.',
    });
    return t('driveScore.heuristicBestSpeed', {
      defaultValue: 'Local heuristic: maximum speed contributes to the speed score; speed-limit compliance was not assessed.',
    });
  }
  if (score.efficiency < 15) return t('driveScore.heuristicWorstEfficiency', {
    defaultValue: 'Local heuristic: high recorded energy per distance lowers the efficiency score; the cause is not established.',
  });
  if (score.smoothness < 10) return t('driveScore.heuristicWorstPower', {
    defaultValue: 'Local heuristic: high average power lowers the smoothness score; aggressive acceleration or braking was not detected.',
  });
  return t('driveScore.heuristicWorstSpeed', {
    defaultValue: 'Local heuristic: the speed component uses maximum speed, with a penalty above 40.2336 m/s; it does not establish unsafe driving.',
  });
}

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
  'A+': gaugeTone.success,
  A: gaugeTone.success,
  B: gaugeTone.info,
  C: gaugeTone.warning,
  D: gaugeTone.danger,
  F: gaugeTone.danger,
};

/** Category accent colors for gauges + chart series (dynamic fills only). */
export const CATEGORY_COLORS = {
  efficiency: chartTokens.series[1],
  smoothness: chartTokens.series[0],
  speed: chartTokens.series[4],
};

export type ScoreAdmissionReason = 'missing' | 'invalid' | 'shortDistance';

type ScoreInputs = Pick<Drive, 'distanceM' | 'energyUsedWh' | 'avgPowerW' | 'maxSpeedMps'>;

export function scoreAdmissionReasons(drive: ScoreInputs): ScoreAdmissionReason[] {
  const reasons: ScoreAdmissionReason[] = [];
  const inputs = [drive.distanceM, drive.energyUsedWh, drive.avgPowerW, drive.maxSpeedMps];
  if (inputs.some((value) => value == null)) reasons.push('missing');
  if (
    inputs.some((value) => value != null && !Number.isFinite(value))
    || (Number.isFinite(drive.distanceM) && drive.distanceM < 0)
    || (drive.maxSpeedMps != null && Number.isFinite(drive.maxSpeedMps) && drive.maxSpeedMps < 0)
  ) reasons.push('invalid');
  if (Number.isFinite(drive.distanceM) && drive.distanceM >= 0
    && drive.distanceM < MIN_EFFICIENCY_DISTANCE_M) reasons.push('shortDistance');
  return reasons;
}

export function summarizeScoreAdmission(drives: readonly ScoreInputs[]) {
  const counts: Record<ScoreAdmissionReason, number> = { missing: 0, invalid: 0, shortDistance: 0 };
  let excluded = 0;
  for (const drive of drives) {
    const reasons = scoreAdmissionReasons(drive);
    if (reasons.length > 0) excluded++;
    for (const reason of reasons) counts[reason]++;
  }
  return { excluded, counts };
}

export function scoreDrive(drive: Drive): ComputedScore | null {
  if (scoreAdmissionReasons(drive).length > 0
    || drive.energyUsedWh == null || drive.avgPowerW == null || drive.maxSpeedMps == null) return null;

  // Net energy and power can be zero or negative during regenerative driving.
  const whPerKm = drive.energyUsedWh / (drive.distanceM / 1_000);
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
  return GRADE_COLORS[grade] ?? gaugeTone.neutral;
}

/** Mode-aware semantic text roles, matching the grade's status variant. */
const GRADE_TEXT_CLASS: Record<string, string> = {
  'A+': neonColorMap.green.text,
  A: neonColorMap.green.text,
  B: neonColorMap.blue.text,
  C: neonColorMap.amber.text,
  D: neonColorMap.red.text,
  F: neonColorMap.red.text,
};

export function gradeTextClass(grade: string): string {
  return GRADE_TEXT_CLASS[grade] ?? typography.color.secondary;
}
