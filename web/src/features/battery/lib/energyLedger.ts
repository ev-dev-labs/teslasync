/**
 * Energy Ledger — closing the books on every watt-hour.
 *
 * Owners ask a deceptively simple question: "I put 300 kWh into the car this
 * month and only drove 240 kWh worth. Where did the rest go?" Every existing
 * view answers half of it — charging totals here, drive consumption there —
 * and nothing reconciles the two.
 *
 * This module performs a **double-entry reconciliation in state-of-charge
 * space**. Charging and driving are debits and credits; the difference between
 * them must equal the change in stored energy plus everything that happened
 * while the car sat still. Formally, per month:
 *
 *     charged − driven − standby − Δstored = residual
 *
 * The clever part is `standby`. Idle drain is never reported directly, but it
 * is *observable*: if a drive ends at 71 % and the next event begins at 66 %,
 * the car quietly consumed 5 % of its pack while parked. Summing those gaps
 * over a month gives sentry mode, cabin overheat protection, preconditioning
 * and 12 V upkeep in one honest number.
 *
 * Converting SoC to watt-hours needs a pack capacity, and hard-coding one per
 * model would be wrong for every car with a degraded pack. Instead the
 * capacity is **derived from the vehicle's own charging history**: energy added
 * divided by SoC gained, taken as a median across sessions with a wide enough
 * SoC span to be trustworthy. The ledger therefore self-calibrates and stays
 * correct as the pack ages.
 *
 * `residual` is deliberately left visible rather than smoothed away. A large
 * residual is real information: it means drives or charges are missing from the
 * database, or the capacity estimate is off.
 *
 * Pure and React-free.
 */

import type { ChargingSession } from '@/types/charging';
import type { Drive } from '@/types/driving';

export type LedgerEventKind = 'drive' | 'charge';

export interface LedgerEvent {
  kind: LedgerEventKind;
  startMs: number;
  endMs: number;
  startSocPct: number | null;
  endSocPct: number | null;
  /** Positive for charging, negative for driving. Wh. */
  energyWh: number;
}

export interface IdleGap {
  startMs: number;
  endMs: number;
  hours: number;
  /** SoC lost across the gap, percentage points. Never negative. */
  socDropPct: number;
  wh: number;
  /** Mean standby draw across the gap, W. */
  powerW: number;
}

export interface LedgerMonth {
  /** `YYYY-MM`. */
  month: string;
  chargedWh: number;
  drivenWh: number;
  standbyWh: number;
  /** Change in stored energy across the month, Wh. Positive = ended fuller. */
  storedDeltaWh: number;
  /** charged − driven − standby − Δstored. Ideally near zero. */
  residualWh: number;
  /** 1 − |residual| / charged, clamped to 0–1. */
  closureRate: number;
  chargeSessions: number;
  drives: number;
  idleHours: number;
  /** Mean standby draw across idle time this month, W. */
  standbyPowerW: number;
  distanceM: number;
}

export interface EnergyLedgerSummary {
  months: LedgerMonth[];
  /** Derived usable pack capacity, Wh; `null` when it could not be estimated. */
  packCapacityWh: number | null;
  /** Charge sessions that contributed to the capacity estimate. */
  capacitySamples: number;
  totalChargedWh: number;
  totalDrivenWh: number;
  totalStandbyWh: number;
  totalResidualWh: number;
  /** Share of charged energy that reached the wheels. */
  drivingShare: number;
  /** Share of charged energy lost to standing still. */
  standbyShare: number;
  /** Mean vampire drain, Wh per parked day. */
  vampireWhPerDay: number;
  /** Mean standby draw across all idle time, W. */
  meanStandbyPowerW: number;
  gaps: IdleGap[];
  /** Overall books-closure quality, 0–1. */
  closureRate: number;
}

export interface EnergyLedgerOptions {
  /** Minimum SoC span for a charge to inform the capacity estimate. */
  minCapacitySocSpan?: number;
  /** Idle gaps shorter than this are ignored as measurement noise. Hours. */
  minGapHours?: number;
  /** Idle gaps longer than this are treated as data outages, not standing. */
  maxGapHours?: number;
  /** Implausible standby draw above which a gap is rejected. W. */
  maxStandbyPowerW?: number;
}

const DEFAULTS = {
  minCapacitySocSpan: 20,
  minGapHours: 0.5,
  maxGapHours: 24 * 14,
  maxStandbyPowerW: 2000,
} as const;

function num(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Usable pack capacity implied by the car's own charging history.
 *
 * Exported and independently tested because every watt-hour of standby drain
 * is scaled by this number — a bad estimate silently corrupts the whole ledger.
 * The median is used rather than the mean so one session with a mis-recorded
 * SoC cannot drag the estimate away.
 */
export function estimatePackCapacityWh(
  sessions: readonly ChargingSession[],
  minSocSpan: number = DEFAULTS.minCapacitySocSpan,
): { capacityWh: number | null; samples: number } {
  const estimates: number[] = [];
  for (const s of sessions) {
    const energy = num(s.total_energy_added_wh);
    const start = num(s.start_soc_pct);
    const end = num(s.end_soc_pct);
    const delta = num(s.delta_soc_pct) ?? (start != null && end != null ? end - start : null);
    if (energy == null || delta == null || delta < minSocSpan) continue;
    const capacity = energy / (delta / 100);
    // A plausible EV pack sits between 20 and 250 kWh; anything else is a
    // corrupt row, not a discovery.
    if (capacity < 20_000 || capacity > 250_000) continue;
    estimates.push(capacity);
  }
  const capacityWh = median(estimates);
  return {
    capacityWh: capacityWh == null ? null : Math.round(capacityWh),
    samples: estimates.length,
  };
}

/**
 * Merge drives and charges into one chronological ledger.
 *
 * Exported because the idle gaps — the entire point of the module — are
 * defined by the spaces *between* these events.
 */
export function buildTimeline(
  sessions: readonly ChargingSession[],
  drives: readonly Drive[],
): LedgerEvent[] {
  const events: LedgerEvent[] = [];

  for (const s of sessions) {
    const startMs = new Date(s.started_at ?? s.start_ts).getTime();
    if (!Number.isFinite(startMs)) continue;
    let endMs = s.ended_at == null ? Number.NaN : new Date(s.ended_at).getTime();
    if (!Number.isFinite(endMs)) {
      const mins = num(s.duration_min);
      endMs = mins == null ? startMs : startMs + mins * 60_000;
    }
    events.push({
      kind: 'charge',
      startMs,
      endMs: Math.max(startMs, endMs),
      startSocPct: num(s.start_soc_pct),
      endSocPct: num(s.end_soc_pct),
      energyWh: num(s.total_energy_added_wh) ?? 0,
    });
  }

  for (const d of drives) {
    const startMs = new Date(d.startTs).getTime();
    if (!Number.isFinite(startMs)) continue;
    let endMs = d.endTs == null ? Number.NaN : new Date(d.endTs).getTime();
    if (!Number.isFinite(endMs)) {
      endMs = startMs + (num(d.durationS) ?? 0) * 1000;
    }
    events.push({
      kind: 'drive',
      startMs,
      endMs: Math.max(startMs, endMs),
      startSocPct: num(d.startBatteryPct),
      endSocPct: num(d.endBatteryPct),
      energyWh: -(num(d.energyUsedWh) ?? 0),
    });
  }

  return events.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

export function buildEnergyLedger(
  sessions: readonly ChargingSession[],
  drives: readonly Drive[],
  options: EnergyLedgerOptions = {},
): EnergyLedgerSummary {
  const opts = { ...DEFAULTS, ...options };
  const { capacityWh, samples } = estimatePackCapacityWh(sessions, opts.minCapacitySocSpan);
  const timeline = buildTimeline(sessions, drives);

  interface Accumulator {
    chargedWh: number;
    drivenWh: number;
    standbyWh: number;
    chargeSessions: number;
    drives: number;
    idleHours: number;
    distanceM: number;
    firstSocPct: number | null;
    lastSocPct: number | null;
  }

  const buckets = new Map<string, Accumulator>();
  const bucketFor = (ms: number): Accumulator => {
    const key = monthKey(ms);
    let acc = buckets.get(key);
    if (acc == null) {
      acc = {
        chargedWh: 0,
        drivenWh: 0,
        standbyWh: 0,
        chargeSessions: 0,
        drives: 0,
        idleHours: 0,
        distanceM: 0,
        firstSocPct: null,
        lastSocPct: null,
      };
      buckets.set(key, acc);
    }
    return acc;
  };

  for (const event of timeline) {
    const acc = bucketFor(event.startMs);
    if (event.kind === 'charge') {
      acc.chargedWh += event.energyWh;
      acc.chargeSessions += 1;
    } else {
      acc.drivenWh += -event.energyWh;
      acc.drives += 1;
    }
    // Track the month's opening and closing SoC so stored energy can be
    // separated from consumed energy.
    if (acc.firstSocPct == null && event.startSocPct != null) acc.firstSocPct = event.startSocPct;
    if (event.endSocPct != null) acc.lastSocPct = event.endSocPct;
    else if (event.startSocPct != null) acc.lastSocPct = event.startSocPct;
  }

  for (const d of drives) {
    const ms = new Date(d.startTs).getTime();
    if (!Number.isFinite(ms)) continue;
    bucketFor(ms).distanceM += num(d.distanceM) ?? 0;
  }

  const gaps: IdleGap[] = [];
  for (let i = 1; i < timeline.length; i++) {
    const prev = timeline[i - 1]!;
    const next = timeline[i]!;
    const startMs = prev.endMs;
    const endMs = next.startMs;
    const hours = (endMs - startMs) / 3_600_000;
    if (hours < opts.minGapHours || hours > opts.maxGapHours) continue;
    if (prev.endSocPct == null || next.startSocPct == null) continue;

    // A rise across an idle gap means an unrecorded charge, not negative
    // drain: it belongs in the residual, not the standby figure.
    const dropPct = prev.endSocPct - next.startSocPct;
    if (dropPct <= 0) continue;
    if (capacityWh == null) continue;

    const wh = (dropPct / 100) * capacityWh;
    const powerW = wh / hours;
    if (powerW > opts.maxStandbyPowerW) continue;

    gaps.push({
      startMs,
      endMs,
      hours: Math.round(hours * 100) / 100,
      socDropPct: Math.round(dropPct * 10) / 10,
      wh: Math.round(wh),
      powerW: Math.round(powerW),
    });

    const acc = bucketFor(startMs);
    acc.standbyWh += wh;
    acc.idleHours += hours;
  }

  const months: LedgerMonth[] = [];
  for (const [month, acc] of [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const storedDeltaWh =
      capacityWh != null && acc.firstSocPct != null && acc.lastSocPct != null
        ? ((acc.lastSocPct - acc.firstSocPct) / 100) * capacityWh
        : 0;
    const residualWh = acc.chargedWh - acc.drivenWh - acc.standbyWh - storedDeltaWh;
    months.push({
      month,
      chargedWh: Math.round(acc.chargedWh),
      drivenWh: Math.round(acc.drivenWh),
      standbyWh: Math.round(acc.standbyWh),
      storedDeltaWh: Math.round(storedDeltaWh),
      residualWh: Math.round(residualWh),
      closureRate:
        acc.chargedWh > 0
          ? Math.round(Math.max(0, Math.min(1, 1 - Math.abs(residualWh) / acc.chargedWh)) * 1000) /
            1000
          : 0,
      chargeSessions: acc.chargeSessions,
      drives: acc.drives,
      idleHours: Math.round(acc.idleHours * 10) / 10,
      standbyPowerW: acc.idleHours > 0 ? Math.round(acc.standbyWh / acc.idleHours) : 0,
      distanceM: Math.round(acc.distanceM),
    });
  }

  const totalChargedWh = months.reduce((s, m) => s + m.chargedWh, 0);
  const totalDrivenWh = months.reduce((s, m) => s + m.drivenWh, 0);
  const totalStandbyWh = months.reduce((s, m) => s + m.standbyWh, 0);
  const totalResidualWh = months.reduce((s, m) => s + m.residualWh, 0);
  const totalIdleHours = months.reduce((s, m) => s + m.idleHours, 0);

  return {
    months,
    packCapacityWh: capacityWh,
    capacitySamples: samples,
    totalChargedWh,
    totalDrivenWh,
    totalStandbyWh,
    totalResidualWh,
    drivingShare:
      totalChargedWh > 0 ? Math.round((totalDrivenWh / totalChargedWh) * 1000) / 1000 : 0,
    standbyShare:
      totalChargedWh > 0 ? Math.round((totalStandbyWh / totalChargedWh) * 1000) / 1000 : 0,
    vampireWhPerDay:
      totalIdleHours > 0 ? Math.round((totalStandbyWh / totalIdleHours) * 24) : 0,
    meanStandbyPowerW: totalIdleHours > 0 ? Math.round(totalStandbyWh / totalIdleHours) : 0,
    gaps: gaps.sort((a, b) => b.wh - a.wh),
    closureRate:
      totalChargedWh > 0
        ? Math.round(
            Math.max(0, Math.min(1, 1 - Math.abs(totalResidualWh) / totalChargedWh)) * 1000,
          ) / 1000
        : 0,
  };
}
