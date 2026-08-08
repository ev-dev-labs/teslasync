/**
 * Alert Fatigue — the notifications you have stopped reading.
 *
 * Every alerting system decays the same way: a rule that fires twice a day for
 * three months stops being information and becomes wallpaper. The user does not
 * disable it (that feels risky), they just stop looking — and then miss the one
 * time it mattered. This module measures that decay so noisy rules can be
 * retired on evidence rather than annoyance.
 *
 * Three signals are combined into a single 0–100 noise score:
 *
 *  1. **Volume** — firings per day, on a log scale, because the difference
 *     between 1/day and 2/day matters far more than 20/day versus 21/day.
 *  2. **Burstiness** — the share of firings that arrived within the burst window
 *     of a previous firing from the same rule. Bursts are the signature of a
 *     flapping threshold (SoC oscillating across a limit), and they are far more
 *     fatiguing than the same count spread evenly.
 *  3. **Ignored rate** — the share of delivered notifications never marked read.
 *     This is the strongest signal of all: it is the user's own revealed
 *     judgement of the rule's worth.
 *
 * Read tracking is optional in the API, so the score degrades gracefully: when
 * a group has no `read_at` information at all, the weight is redistributed onto
 * volume and burstiness rather than assuming everything was ignored.
 *
 * Pure and React-free.
 */

import type { NotificationLog } from '@/api/types';

export type FatigueVerdict = 'healthy' | 'chatty' | 'noisy' | 'fatiguing';

export interface AlertGroup {
  /** Normalised title — the human-recognisable identity of the rule. */
  key: string;
  title: string;
  severity: string | null;
  alertId: number | null;
  total: number;
  delivered: number;
  failed: number;
  /** Delivered notifications with a `read_at` timestamp. */
  read: number;
  /** Delivered notifications that carried read tracking at all. */
  trackable: number;
  firstMs: number;
  lastMs: number;
  spanDays: number;
  perDay: number;
  /** Share of firings that arrived inside the burst window of a previous one. */
  burstRate: number;
  /** Largest number of firings inside one burst window. */
  maxBurst: number;
  /** Share of trackable notifications never read; `null` when untracked. */
  ignoredRate: number | null;
  /** Median seconds from delivery to read; `null` when never read. */
  medianTimeToReadS: number | null;
  noiseScore: number;
  verdict: FatigueVerdict;
  /** Firings per weekday index 0–6 (Sun–Sat). */
  weekdayCounts: number[];
  /** Firings per hour 0–23. */
  hourCounts: number[];
}

export interface AlertFatigueSummary {
  groups: AlertGroup[];
  totalNotifications: number;
  /** Groups scoring `fatiguing`. */
  fatiguingCount: number;
  /** Overall share of trackable notifications never read. */
  overallIgnoredRate: number | null;
  /** Notifications per day across all rules. */
  overallPerDay: number;
  /** Share of all firings that were part of a burst. */
  overallBurstRate: number;
  analyzedDays: number;
}

export interface AlertFatigueOptions {
  /** Two firings of one rule within this many minutes count as a burst. */
  burstWindowMin?: number;
  /** Minimum firings before a group is scored at all. */
  minFirings?: number;
  /** Score at or above which a group is `fatiguing`. */
  fatiguingScore?: number;
  /** Score at or above which a group is `noisy`. */
  noisyScore?: number;
  /** Score at or above which a group is `chatty`. */
  chattyScore?: number;
}

const DEFAULTS = {
  burstWindowMin: 30,
  minFirings: 3,
  fatiguingScore: 70,
  noisyScore: 45,
  chattyScore: 25,
} as const;

const MS_PER_DAY = 86_400_000;

/**
 * Collapse titles that differ only by an embedded value so
 * "Battery at 19%" and "Battery at 18%" are recognised as one rule.
 *
 * Exported because grouping decides everything downstream: leave the numbers in
 * and every firing looks unique, so nothing is ever flagged as repetitive.
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\d+([.,]\d+)?\s*%/g, '#%')
    .replace(/\d+([.,]\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Blend the three fatigue signals into 0–100.
 *
 * Exported so the weighting is pinned by tests — a scoring change that silently
 * reclassifies every rule would otherwise be invisible.
 */
export function noiseScoreOf(
  perDay: number,
  burstRate: number,
  ignoredRate: number | null,
): number {
  // Log scale: 0.5/day ≈ 0, 1/day ≈ 0.3, 4/day ≈ 0.7, 20/day ≈ 1.
  const volume = Math.min(1, Math.max(0, Math.log10(Math.max(perDay, 0.01) / 0.5) / Math.log10(40)));
  const burst = Math.min(1, Math.max(0, burstRate));

  if (ignoredRate == null) {
    // No read tracking: redistribute the ignored weight rather than guessing.
    return Math.round((volume * 0.6 + burst * 0.4) * 100);
  }
  const ignored = Math.min(1, Math.max(0, ignoredRate));
  return Math.round((volume * 0.4 + burst * 0.25 + ignored * 0.35) * 100);
}

export function analyzeAlertFatigue(
  logs: readonly NotificationLog[],
  options: AlertFatigueOptions = {},
): AlertFatigueSummary {
  const opts = { ...DEFAULTS, ...options };
  const burstWindowMs = opts.burstWindowMin * 60_000;

  interface Bucket {
    title: string;
    severity: string | null;
    alertId: number | null;
    events: Array<{
      ms: number;
      delivered: boolean;
      failed: boolean;
      readAtMs: number | null;
      trackable: boolean;
    }>;
  }

  const buckets = new Map<string, Bucket>();
  let globalMin = Infinity;
  let globalMax = -Infinity;

  for (const log of logs) {
    const ms = new Date(log.sent_at ?? log.created_at).getTime();
    if (!Number.isFinite(ms)) continue;

    const key = normalizeTitle(log.title ?? '');
    if (key.length === 0) continue;

    let bucket = buckets.get(key);
    if (bucket == null) {
      bucket = {
        title: log.title,
        severity: log.severity ?? null,
        alertId: log.alert_id ?? null,
        events: [],
      };
      buckets.set(key, bucket);
    }

    const delivered = log.status === 'sent';
    // `read_at` is only meaningful on delivered notifications, and a field that
    // is absent entirely (vs. explicitly null) means the backend never tracked
    // reads for this row.
    const trackable = delivered && log.read_at !== undefined;
    const readMs = log.read_at == null ? null : new Date(log.read_at).getTime();

    bucket.events.push({
      ms,
      delivered,
      failed: log.status === 'failed',
      readAtMs: readMs != null && Number.isFinite(readMs) ? readMs : null,
      trackable,
    });

    if (ms < globalMin) globalMin = ms;
    if (ms > globalMax) globalMax = ms;
  }

  const groups: AlertGroup[] = [];
  let globalTrackable = 0;
  let globalRead = 0;
  let globalBursts = 0;
  let globalFirings = 0;

  for (const [key, bucket] of buckets) {
    const events = bucket.events.sort((a, b) => a.ms - b.ms);
    const total = events.length;
    const firstMs = events[0]!.ms;
    const lastMs = events[total - 1]!.ms;

    // A rule seen once cannot have a rate; clamp the span so a single-day
    // burst does not divide by zero and report an infinite frequency.
    const spanDays = Math.max(1, (lastMs - firstMs) / MS_PER_DAY);

    let bursts = 0;
    let maxBurst = 1;
    let runStart = 0;
    for (let i = 1; i < total; i++) {
      if (events[i]!.ms - events[i - 1]!.ms <= burstWindowMs) {
        bursts += 1;
        maxBurst = Math.max(maxBurst, i - runStart + 1);
      } else {
        runStart = i;
      }
    }

    const delivered = events.filter((e) => e.delivered).length;
    const failed = events.filter((e) => e.failed).length;
    const trackable = events.filter((e) => e.trackable).length;
    const readEvents = events.filter((e) => e.trackable && e.readAtMs != null);
    const read = readEvents.length;

    const perDay = Math.round((total / spanDays) * 100) / 100;
    const burstRate = total > 1 ? bursts / (total - 1) : 0;
    const ignoredRate = trackable > 0 ? (trackable - read) / trackable : null;

    const timeToRead = readEvents
      .map((e) => (e.readAtMs! - e.ms) / 1000)
      .filter((s) => s >= 0);

    const noiseScore =
      total < opts.minFirings ? 0 : noiseScoreOf(perDay, burstRate, ignoredRate);

    let verdict: FatigueVerdict = 'healthy';
    if (total >= opts.minFirings) {
      if (noiseScore >= opts.fatiguingScore) verdict = 'fatiguing';
      else if (noiseScore >= opts.noisyScore) verdict = 'noisy';
      else if (noiseScore >= opts.chattyScore) verdict = 'chatty';
    }

    const weekdayCounts = Array.from({ length: 7 }, () => 0);
    const hourCounts = Array.from({ length: 24 }, () => 0);
    for (const e of events) {
      const d = new Date(e.ms);
      weekdayCounts[d.getDay()]! += 1;
      hourCounts[d.getHours()]! += 1;
    }

    globalTrackable += trackable;
    globalRead += read;
    globalBursts += bursts;
    globalFirings += total;

    groups.push({
      key,
      title: bucket.title,
      severity: bucket.severity,
      alertId: bucket.alertId,
      total,
      delivered,
      failed,
      read,
      trackable,
      firstMs,
      lastMs,
      spanDays: Math.round(spanDays * 10) / 10,
      perDay,
      burstRate: Math.round(burstRate * 1000) / 1000,
      maxBurst,
      ignoredRate: ignoredRate == null ? null : Math.round(ignoredRate * 1000) / 1000,
      medianTimeToReadS: (() => {
        const m = median(timeToRead);
        return m == null ? null : Math.round(m);
      })(),
      noiseScore,
      verdict,
      weekdayCounts,
      hourCounts,
    });
  }

  groups.sort((a, b) => b.noiseScore - a.noiseScore || b.total - a.total);

  const analyzedDays =
    groups.length === 0 ? 0 : Math.max(1, Math.round((globalMax - globalMin) / MS_PER_DAY));

  return {
    groups,
    totalNotifications: logs.length,
    fatiguingCount: groups.filter((g) => g.verdict === 'fatiguing').length,
    overallIgnoredRate:
      globalTrackable > 0
        ? Math.round(((globalTrackable - globalRead) / globalTrackable) * 1000) / 1000
        : null,
    overallPerDay: analyzedDays > 0 ? Math.round((globalFirings / analyzedDays) * 100) / 100 : 0,
    overallBurstRate:
      globalFirings > 1 ? Math.round((globalBursts / (globalFirings - 1)) * 1000) / 1000 : 0,
    analyzedDays,
  };
}
