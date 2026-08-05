/**
 * Cycle-depth stress reconstructed from sparse drive and charge boundaries.
 *
 * The state-of-charge observations are reduced to chronological reversals,
 * then counted with the ASTM-style four-point rainflow stack. Closed inner
 * ranges count as full cycles; unresolved ranges at either history boundary
 * remain half cycles. This preserves cumulative depth instead of pretending
 * every drive or charge is an independent cycle.
 *
 * Two totals are reported:
 * - equivalent full cycles: Σ count × DoD
 * - stress-equivalent cycles: Σ count × DoD^1.7
 *
 * DoD is a 0–1 fraction in those equations. The 1.7 exponent is a transparent
 * nonlinear depth-damage model: a deeper swing contributes
 * disproportionately more stress, while a 100% cycle remains exactly one
 * stress-equivalent cycle. It is a relative cycle-depth index, not predicted
 * degradation, remaining battery life, or a manufacturer pack model.
 */

import type { ChargingSession } from '@/types/charging';
import type { Drive } from '@/types/driving';

export const DEPTH_STRESS_EXPONENT = 1.7;
export const DEEP_CYCLE_THRESHOLD_PCT = 60;

export interface SocTurningPoint {
  ms: number;
  timestamp: string;
  socPct: number;
}

export interface RainflowCycle {
  depthPct: number;
  meanSocPct: number;
  count: 0.5 | 1;
  startMs: number;
  endMs: number;
  equivalentFullCycles: number;
  stressEquivalentCycles: number;
}

export interface CycleHistogramBin {
  lowerPct: number;
  upperPct: number;
  cycles: number;
  equivalentFullCycles: number;
  stressEquivalentCycles: number;
}

export interface CycleTrendPoint {
  month: string;
  cycles: number;
  equivalentFullCycles: number;
  stressEquivalentCycles: number;
  meanDepthPct: number | null;
}

export interface CycleStressSummary {
  turningPoints: SocTurningPoint[];
  cycles: RainflowCycle[];
  weightedCycleCount: number;
  equivalentFullCycles: number;
  stressEquivalentCycles: number;
  meanDepthPct: number | null;
  deepCycleShare: number | null;
  histogram: CycleHistogramBin[];
  recentTrend: CycleTrendPoint[];
}

interface RawPoint extends SocTurningPoint {
  /** At equal timestamps an event start follows an event end. */
  phase: 0 | 1;
}

const HISTOGRAM_EDGES = [0, 10, 25, 50, 75, 100] as const;

function finiteSoc(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}

function finiteMs(timestamp: string | null | undefined): number | null {
  if (!timestamp) return null;
  const ms = new Date(timestamp).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function pushPoint(
  rows: RawPoint[],
  timestamp: string | null | undefined,
  socPct: number | null | undefined,
  phase: 0 | 1,
): void {
  const ms = finiteMs(timestamp);
  const soc = finiteSoc(socPct);
  if (ms == null || soc == null || timestamp == null) return;
  rows.push({ ms, timestamp, socPct: soc, phase });
}

/**
 * Merge drive and charge boundaries and retain only local SoC extrema.
 * Monotone intermediate observations add no rainflow range and are removed.
 */
export function buildSocTurningPoints(
  sessions: readonly ChargingSession[],
  drives: readonly Drive[],
): SocTurningPoint[] {
  const rows: RawPoint[] = [];

  for (const session of sessions) {
    const startTs = session.started_at ?? session.start_ts ?? session.startedAt;
    pushPoint(rows, startTs, session.start_soc_pct, 1);

    let endTs = session.ended_at ?? null;
    if (endTs == null) {
      const startMs = finiteMs(startTs);
      if (startMs != null && Number.isFinite(session.duration_min) && session.duration_min >= 0) {
        endTs = new Date(startMs + session.duration_min * 60_000).toISOString();
      }
    }
    pushPoint(rows, endTs, session.end_soc_pct, 0);
  }

  for (const drive of drives) {
    pushPoint(rows, drive.startTs, drive.startBatteryPct, 1);
    let endTs = drive.endTs;
    if (endTs == null) {
      const startMs = finiteMs(drive.startTs);
      if (startMs != null && Number.isFinite(drive.durationS) && drive.durationS >= 0) {
        endTs = new Date(startMs + drive.durationS * 1000).toISOString();
      }
    }
    pushPoint(rows, endTs, drive.endBatteryPct, 0);
  }

  rows.sort((a, b) => a.ms - b.ms || a.phase - b.phase);

  const chronological: SocTurningPoint[] = [];
  for (const row of rows) {
    const previous = chronological[chronological.length - 1];
    if (previous?.ms === row.ms) {
      chronological[chronological.length - 1] = row;
    } else if (previous == null || Math.abs(previous.socPct - row.socPct) >= 0.05) {
      chronological.push(row);
    }
  }

  if (chronological.length <= 2) return chronological;
  const turns: SocTurningPoint[] = [chronological[0]!];
  for (let index = 1; index < chronological.length - 1; index += 1) {
    const before = chronological[index - 1]!;
    const current = chronological[index]!;
    const after = chronological[index + 1]!;
    const incoming = current.socPct - before.socPct;
    const outgoing = after.socPct - current.socPct;
    if (incoming * outgoing < 0) turns.push(current);
  }
  turns.push(chronological[chronological.length - 1]!);
  return turns;
}

function makeCycle(
  a: SocTurningPoint,
  b: SocTurningPoint,
  count: 0.5 | 1,
  closedAtMs: number,
  exponent: number,
): RainflowCycle {
  const depthPct = Math.abs(b.socPct - a.socPct);
  const depth = depthPct / 100;
  return {
    depthPct,
    meanSocPct: (a.socPct + b.socPct) / 2,
    count,
    startMs: Math.min(a.ms, b.ms),
    endMs: Math.max(a.ms, b.ms, closedAtMs),
    equivalentFullCycles: count * depth,
    stressEquivalentCycles: count * depth ** exponent,
  };
}

/**
 * ASTM-style four-point rainflow extraction over an ordered reversal series.
 * The final stack is deliberately emitted as half cycles.
 */
export function extractRainflowCycles(
  turningPoints: readonly SocTurningPoint[],
  exponent = DEPTH_STRESS_EXPONENT,
): RainflowCycle[] {
  const stack: SocTurningPoint[] = [];
  const cycles: RainflowCycle[] = [];

  for (const point of turningPoints) {
    stack.push(point);
    while (stack.length >= 3) {
      const size = stack.length;
      const a = stack[size - 3]!;
      const b = stack[size - 2]!;
      const c = stack[size - 1]!;
      const olderRange = Math.abs(b.socPct - a.socPct);
      const newerRange = Math.abs(c.socPct - b.socPct);
      if (newerRange < olderRange) break;

      if (size === 3) {
        if (olderRange > 0) cycles.push(makeCycle(a, b, 0.5, b.ms, exponent));
        stack.shift();
      } else {
        if (olderRange > 0) cycles.push(makeCycle(a, b, 1, c.ms, exponent));
        stack.splice(size - 3, 2);
      }
    }
  }

  for (let index = 0; index < stack.length - 1; index += 1) {
    const a = stack[index]!;
    const b = stack[index + 1]!;
    if (a.socPct !== b.socPct) cycles.push(makeCycle(a, b, 0.5, b.ms, exponent));
  }
  return cycles.sort((a, b) => a.endMs - b.endMs);
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function monthKey(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function addMonths(month: string, amount: number): string {
  const [year, index] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year!, index! - 1 + amount, 1));
  return monthKey(date.getTime());
}

function buildHistogram(cycles: readonly RainflowCycle[]): CycleHistogramBin[] {
  return HISTOGRAM_EDGES.slice(0, -1).map((lowerPct, index) => {
    const upperPct = HISTOGRAM_EDGES[index + 1]!;
    const members = cycles.filter(
      (cycle) =>
        cycle.depthPct >= lowerPct &&
        (index === HISTOGRAM_EDGES.length - 2
          ? cycle.depthPct <= upperPct
          : cycle.depthPct < upperPct),
    );
    return {
      lowerPct,
      upperPct,
      cycles: round(members.reduce((sum, cycle) => sum + cycle.count, 0)),
      equivalentFullCycles: round(
        members.reduce((sum, cycle) => sum + cycle.equivalentFullCycles, 0),
      ),
      stressEquivalentCycles: round(
        members.reduce((sum, cycle) => sum + cycle.stressEquivalentCycles, 0),
      ),
    };
  });
}

function buildRecentTrend(cycles: readonly RainflowCycle[]): CycleTrendPoint[] {
  if (cycles.length === 0) return [];
  const first = monthKey(cycles[0]!.endMs);
  const latest = monthKey(cycles[cycles.length - 1]!.endMs);
  const earliestAllowed = addMonths(latest, -11);
  const start = first < earliestAllowed ? earliestAllowed : first;
  const result: CycleTrendPoint[] = [];

  for (let month = start; month <= latest; month = addMonths(month, 1)) {
    const members = cycles.filter((cycle) => monthKey(cycle.endMs) === month);
    const count = members.reduce((sum, cycle) => sum + cycle.count, 0);
    result.push({
      month,
      cycles: round(count),
      equivalentFullCycles: round(
        members.reduce((sum, cycle) => sum + cycle.equivalentFullCycles, 0),
      ),
      stressEquivalentCycles: round(
        members.reduce((sum, cycle) => sum + cycle.stressEquivalentCycles, 0),
      ),
      meanDepthPct:
        count > 0
          ? round(members.reduce((sum, cycle) => sum + cycle.depthPct * cycle.count, 0) / count)
          : null,
    });
    if (month === latest) break;
  }
  return result;
}

export function summarizeCycleStress(
  sessions: readonly ChargingSession[],
  drives: readonly Drive[],
  exponent = DEPTH_STRESS_EXPONENT,
): CycleStressSummary {
  const turningPoints = buildSocTurningPoints(sessions, drives);
  const cycles = extractRainflowCycles(turningPoints, exponent);
  const weightedCycleCount = cycles.reduce((sum, cycle) => sum + cycle.count, 0);
  const equivalentFullCycles = cycles.reduce(
    (sum, cycle) => sum + cycle.equivalentFullCycles,
    0,
  );
  const stressEquivalentCycles = cycles.reduce(
    (sum, cycle) => sum + cycle.stressEquivalentCycles,
    0,
  );
  const deepCount = cycles
    .filter((cycle) => cycle.depthPct >= DEEP_CYCLE_THRESHOLD_PCT)
    .reduce((sum, cycle) => sum + cycle.count, 0);

  return {
    turningPoints,
    cycles,
    weightedCycleCount: round(weightedCycleCount),
    equivalentFullCycles: round(equivalentFullCycles),
    stressEquivalentCycles: round(stressEquivalentCycles),
    meanDepthPct:
      weightedCycleCount > 0
        ? round(
            cycles.reduce((sum, cycle) => sum + cycle.depthPct * cycle.count, 0) /
              weightedCycleCount,
          )
        : null,
    deepCycleShare: weightedCycleCount > 0 ? round(deepCount / weightedCycleCount) : null,
    histogram: buildHistogram(cycles),
    recentTrend: buildRecentTrend(cycles),
  };
}
