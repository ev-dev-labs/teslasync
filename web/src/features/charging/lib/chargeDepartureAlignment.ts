/**
 * Charge → Departure Alignment — did the charge match what the next drive
 * actually needed?
 *
 * This module pairs the latest completed charging session before each drive
 * within a bounded window (default 24h) and compares what the charge delivered
 * against what that one drive went on to use. It is
 * deliberately narrow in scope:
 *
 *   - It is NOT a departure-time predictor (`departureForecast` handles
 *     "when will you likely leave").
 *   - It is NOT a charge-scheduling advisor (`chargeAdvisor`/`smartCharge`
 *     handle "when should you start charging").
 *   - It only asks, after the fact, whether the charge-to-drive handoff
 *     looked well-matched, too tight, or wastefully long.
 *
 * CAUSAL CAVEAT (worth repeating at every call site that surfaces this
 * data): pairing a charge with "the next drive" is a temporal adjacency,
 * not a proof of intent. A charge that added far more than the next drive
 * used is NOT necessarily wasteful — the owner may have been charging for
 * a *later* trip, or for buffer against range anxiety, and the very next
 * drive just happened to be a short errand. Every derived flag here should
 * be read as "this pairing looks like X", never "the owner did X wrong".
 *
 * Data-quality caveat: the SoC recorded at drive-start can differ slightly
 * from the charge's end SoC purely from vampire drain during the dwell —
 * that is expected and is not itself a misalignment signal.
 *
 * Pure and React-free.
 */

import type { ChargingSession } from '@/types/charging';
import type { Drive } from '@/types/driving';

export type AlignmentFlag =
  | 'tight_margin'
  | 'excess_buffer'
  | 'early_full_dwell'
  | 'long_dwell'
  | 'soc_mismatch';

export interface DeparturePair {
  chargeId: string;
  driveId: number;
  chargeEndedMs: number;
  driveStartMs: number;
  /** Gap between charge end and drive start, seconds. */
  dwellS: number;
  endSocPct: number | null;
  driveStartSocPct: number | null;
  driveEndSocPct: number | null;
  /** SoC points the paired drive actually consumed. */
  socUsedPct: number | null;
  /** driveStartSocPct - endSocPct; small negative values are normal vampire drain. */
  socDriftPct: number | null;
  /** SoC remaining once the drive ended — the realized safety buffer. */
  readinessMarginPct: number | null;
  /** Portion of dwellS spent already at a "full" SoC, seconds. */
  earlyFullDwellS: number;
  flags: AlignmentFlag[];
}

export interface ChargeDepartureAlignmentSummary {
  pairs: DeparturePair[];
  totalEndedCharges: number;
  pairedCount: number;
  unpairedCount: number;
  avgDwellS: number;
  avgReadinessMarginPct: number | null;
  misalignedCount: number;
  misalignedRatePct: number;
  totalEarlyFullDwellS: number;
  tightMarginCount: number;
  excessBufferCount: number;
}

export interface ChargeDepartureAlignmentOptions {
  /** Maximum gap between charge end and drive start to consider them paired, hours. */
  maxPairGapH?: number;
  /** Readiness margin at/below this is a "cutting it close" flag, pct. */
  tightMarginPct?: number;
  /** end_soc - socUsed at/above this suggests far more was added than this trip needed, pct points. */
  excessBufferPct?: number;
  /** SoC at/above this is considered "full" for the early-full-dwell heuristic, pct. */
  fullSocPct?: number;
  /** Minimum dwell before an already-full session counts as "early full dwell", hours. */
  earlyFullMinDwellH?: number;
  /** Dwell at/above this is flagged generically long regardless of SoC, hours. */
  longDwellH?: number;
  /** Positive SoC drift (drive-start soc above charge-end soc) beyond this is a data mismatch, pct points. */
  socMismatchPct?: number;
}

const DEFAULTS = {
  maxPairGapH: 24,
  tightMarginPct: 15,
  excessBufferPct: 40,
  fullSocPct: 95,
  earlyFullMinDwellH: 1,
  longDwellH: 4,
  socMismatchPct: 3,
} as const;

function num(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function chargeEndedMsOf(session: ChargingSession): number | null {
  if (session.ended_at == null) return null;
  const ms = new Date(session.ended_at).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function driveStartMsOf(drive: Drive): number | null {
  const ms = new Date(drive.startTs).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Binary-search the first drive (from a start-time-sorted list) whose start
 * is strictly after `afterMs`. Exported for tests.
 */
export function firstDriveAfter(sortedDrives: readonly Drive[], afterMs: number): number {
  let lo = 0;
  let hi = sortedDrives.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const startMs = driveStartMsOf(sortedDrives[mid]!) ?? Infinity;
    if (startMs <= afterMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Pair each drive with at most one ended charging session: the latest session
 * that ended within `maxPairGapH` hours before departure. This prevents split
 * or back-to-back sessions from counting the same departure more than once.
 * Exported for tests.
 */
export function pairChargesWithNextDrive(
  sessions: readonly ChargingSession[],
  drives: readonly Drive[],
  maxPairGapH: number,
): { pairs: Array<{ session: ChargingSession; drive: Drive }>; unpairedCount: number } {
  const sortedDrives = [...drives]
    .filter((d) => driveStartMsOf(d) != null)
    .sort((a, b) => driveStartMsOf(a)! - driveStartMsOf(b)!);

  const maxGapMs = maxPairGapH * 3_600_000;
  const pairByDriveIndex = new Map<
    number,
    { session: ChargingSession; drive: Drive; endedMs: number }
  >();
  let endedCount = 0;

  for (const session of sessions) {
    const endedMs = chargeEndedMsOf(session);
    if (endedMs == null) continue; // still in progress / never closed — not this module's concern
    endedCount += 1;
    const idx = firstDriveAfter(sortedDrives, endedMs);
    const candidate = sortedDrives[idx];
    const candidateStartMs = candidate != null ? driveStartMsOf(candidate) : null;
    if (candidate != null && candidateStartMs != null && candidateStartMs - endedMs <= maxGapMs) {
      const existing = pairByDriveIndex.get(idx);
      if (existing == null || endedMs > existing.endedMs) {
        pairByDriveIndex.set(idx, { session, drive: candidate, endedMs });
      }
    }
  }

  const pairs = [...pairByDriveIndex.values()].map(({ session, drive }) => ({ session, drive }));
  return { pairs, unpairedCount: endedCount - pairs.length };
}

function evaluatePair(
  session: ChargingSession,
  drive: Drive,
  opts: Required<ChargeDepartureAlignmentOptions>,
): DeparturePair {
  const chargeEndedMs = chargeEndedMsOf(session)!;
  const driveStartMs = driveStartMsOf(drive)!;
  const dwellS = Math.max(0, (driveStartMs - chargeEndedMs) / 1000);

  const endSocPct = num(session.end_soc_pct);
  const driveStartSocPct = num(drive.startBatteryPct);
  const driveEndSocPct = num(drive.endBatteryPct);

  const socUsedPct =
    driveStartSocPct != null && driveEndSocPct != null ? driveStartSocPct - driveEndSocPct : null;
  // Positive socDriftPct = drive-start SoC read HIGHER than the charge's
  // recorded end SoC, which should not happen without more charging in
  // between — a data-quality mismatch. A small NEGATIVE drift is expected
  // (ordinary vampire drain while parked) and is not itself a signal.
  const socDriftPct = driveStartSocPct != null && endSocPct != null ? driveStartSocPct - endSocPct : null;
  const readinessMarginPct = driveEndSocPct;

  const fullAtEnd = endSocPct != null && endSocPct >= opts.fullSocPct;
  const earlyFullDwellS = fullAtEnd && dwellS >= opts.earlyFullMinDwellH * 3600 ? dwellS : 0;

  // How much SoC the charge itself added, independent of what the next
  // drive used — the basis for the "excess buffer" comparison below.
  const startSocPct = num(session.start_soc_pct);
  const chargeGainPct = endSocPct != null && startSocPct != null ? endSocPct - startSocPct : null;

  const flags: AlignmentFlag[] = [];
  if (readinessMarginPct != null && readinessMarginPct <= opts.tightMarginPct) {
    flags.push('tight_margin');
  }
  if (chargeGainPct != null && socUsedPct != null && chargeGainPct - socUsedPct >= opts.excessBufferPct) {
    flags.push('excess_buffer');
  }
  if (earlyFullDwellS > 0) {
    flags.push('early_full_dwell');
  } else if (dwellS >= opts.longDwellH * 3600) {
    flags.push('long_dwell');
  }
  if (socDriftPct != null && socDriftPct >= opts.socMismatchPct) {
    flags.push('soc_mismatch');
  }

  return {
    chargeId: session.id,
    driveId: drive.id,
    chargeEndedMs,
    driveStartMs,
    dwellS: Math.round(dwellS),
    endSocPct,
    driveStartSocPct,
    driveEndSocPct,
    socUsedPct,
    socDriftPct,
    readinessMarginPct,
    earlyFullDwellS: Math.round(earlyFullDwellS),
    flags,
  };
}

export function analyzeChargeDepartureAlignment(
  sessions: readonly ChargingSession[],
  drives: readonly Drive[],
  options: ChargeDepartureAlignmentOptions = {},
): ChargeDepartureAlignmentSummary {
  const opts = { ...DEFAULTS, ...options };
  const endedSessions = sessions.filter((s) => chargeEndedMsOf(s) != null);
  const { pairs: rawPairs, unpairedCount } = pairChargesWithNextDrive(endedSessions, drives, opts.maxPairGapH);

  const pairs = rawPairs
    .map(({ session, drive }) => evaluatePair(session, drive, opts))
    .sort((a, b) => a.chargeEndedMs - b.chargeEndedMs);

  const avgDwellS = pairs.length > 0 ? pairs.reduce((sum, p) => sum + p.dwellS, 0) / pairs.length : 0;

  const margins = pairs.map((p) => p.readinessMarginPct).filter((v): v is number => v != null);
  const avgReadinessMarginPct =
    margins.length > 0 ? margins.reduce((sum, v) => sum + v, 0) / margins.length : null;

  const misaligned = pairs.filter((p) => p.flags.length > 0);
  const totalEarlyFullDwellS = pairs.reduce((sum, p) => sum + p.earlyFullDwellS, 0);
  const tightMarginCount = pairs.filter((p) => p.flags.includes('tight_margin')).length;
  const excessBufferCount = pairs.filter((p) => p.flags.includes('excess_buffer')).length;

  return {
    pairs,
    totalEndedCharges: endedSessions.length,
    pairedCount: pairs.length,
    unpairedCount,
    avgDwellS: Math.round(avgDwellS),
    avgReadinessMarginPct: avgReadinessMarginPct != null ? Math.round(avgReadinessMarginPct * 10) / 10 : null,
    misalignedCount: misaligned.length,
    misalignedRatePct: pairs.length > 0 ? Math.round((misaligned.length / pairs.length) * 1000) / 10 : 0,
    totalEarlyFullDwellS: Math.round(totalEarlyFullDwellS),
    tightMarginCount,
    excessBufferCount,
  };
}
