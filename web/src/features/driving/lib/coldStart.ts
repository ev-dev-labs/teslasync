/**
 * Cold Start Cost model — what the first kilometres after a long park cost.
 *
 * Pairs each drive with the parking gap that preceded it: drives after a long
 * gap start with a cold battery and cabin ("cold starts"), drives after a
 * short gap start warm. Comparing distance-weighted consumption between the
 * two groups isolates the warm-up penalty, and multiplying the penalty by
 * cold-start distance prices it per month. Pure and React-free.
 */

import type { Drive } from '@/types/driving';

/** Gaps at or above this many hours make the next drive a "cold start". */
export const COLD_GAP_HOURS = 6;
/** Gaps at or below this many hours make the next drive a "warm start". */
export const WARM_GAP_HOURS = 1;

export interface GroupStats {
  drives: number;
  distanceM: number;
  whPerKm: number | null;
}

export interface ColdStartSummary {
  cold: GroupStats;
  warm: GroupStats;
  /** Extra consumption on cold starts, Wh/km; null without both groups. */
  penaltyWhPerKm: number | null;
  /** Penalty as a share of warm consumption, 0–1. */
  penaltyShare: number | null;
  /** Total extra energy attributed to cold starts across the input, Wh. */
  totalPenaltyWh: number | null;
  /** Cold-start share of analyzable drives, 0–1. */
  coldShare: number | null;
  analyzed: number;
}

function usable(d: Drive): boolean {
  return (
    d.energyUsedWh != null && Number.isFinite(d.energyUsedWh) && d.energyUsedWh > 0 &&
    Number.isFinite(d.distanceM) && d.distanceM >= 1000
  );
}

function groupStats(drives: readonly Drive[]): GroupStats {
  let energy = 0;
  let distance = 0;
  for (const d of drives) {
    energy += d.energyUsedWh!;
    distance += d.distanceM;
  }
  return {
    drives: drives.length,
    distanceM: distance,
    whPerKm: distance >= 1000 ? Math.round((energy / (distance / 1000)) * 10) / 10 : null,
  };
}

export function summarizeColdStarts(drives: readonly Drive[]): ColdStartSummary {
  const sorted = [...drives]
    .filter((d) => d.startTs && Number.isFinite(new Date(d.startTs).getTime()))
    .sort((a, b) => a.startTs.localeCompare(b.startTs));

  const cold: Drive[] = [];
  const warm: Drive[] = [];
  let analyzed = 0;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (!usable(cur)) continue;

    const prevEndMs = prev.endTs
      ? new Date(prev.endTs).getTime()
      : new Date(prev.startTs).getTime() + (Number.isFinite(prev.durationS) ? prev.durationS * 1000 : 0);
    const gapH = (new Date(cur.startTs).getTime() - prevEndMs) / 3_600_000;
    if (!Number.isFinite(gapH) || gapH < 0) continue;

    analyzed += 1;
    if (gapH >= COLD_GAP_HOURS) cold.push(cur);
    else if (gapH <= WARM_GAP_HOURS) warm.push(cur);
    // Gaps in between are ambiguous — excluded from both groups on purpose.
  }

  const coldStats = groupStats(cold);
  const warmStats = groupStats(warm);

  let penaltyWhPerKm: number | null = null;
  let penaltyShare: number | null = null;
  let totalPenaltyWh: number | null = null;
  // Demand a real sample on both sides before claiming a penalty.
  if (
    coldStats.whPerKm != null && warmStats.whPerKm != null &&
    coldStats.drives >= 5 && warmStats.drives >= 5
  ) {
    penaltyWhPerKm = Math.round((coldStats.whPerKm - warmStats.whPerKm) * 10) / 10;
    penaltyShare = warmStats.whPerKm > 0 ? penaltyWhPerKm / warmStats.whPerKm : null;
    totalPenaltyWh = Math.round(Math.max(0, penaltyWhPerKm) * (coldStats.distanceM / 1000));
  }

  return {
    cold: coldStats,
    warm: warmStats,
    penaltyWhPerKm,
    penaltyShare,
    totalPenaltyWh,
    coldShare: analyzed > 0 ? cold.length / analyzed : null,
    analyzed,
  };
}
