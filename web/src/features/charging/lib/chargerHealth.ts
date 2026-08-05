/**
 * Charger Health — which plug is quietly under-delivering?
 *
 * A charger that has degraded from 11 kW to 7 kW never announces itself. The
 * session still completes, the car still charges, and the only symptom is that
 * everything takes longer. This module finds those chargers.
 *
 * The hard part is that TeslaSync has no table of charger nameplate ratings, so
 * "expected power" has to come from the data itself. The benchmark used here is
 * **self-referential and per-site**: each site's own best sustained sessions
 * define its capability, and later sessions are scored against that. A site
 * that has always been slow is therefore *healthy* (it is doing what it always
 * did) while a site that used to hit 11 kW and now tops out at 7 kW is flagged
 * — which is exactly the question an owner is actually asking.
 *
 * Two confounders are handled explicitly:
 *
 *  1. **Charge tapering.** Power falls off a cliff above ~80 % SoC on DC, so
 *     any session that spends most of its time in the taper band is excluded
 *     from the benchmark; otherwise every full charge would look like a fault.
 *  2. **Cold packs.** Preconditioning limits acceptance in winter. Sessions are
 *     compared against the site's own trailing baseline, and a site is only
 *     flagged when the shortfall persists across several recent sessions rather
 *     than a single cold morning.
 *
 * Sites are keyed by `start_place` when the geocoder supplied one, and
 * otherwise by a rounded lat/lng cell (~1 km), so an un-named home charger
 * still groups correctly.
 *
 * Pure and React-free.
 */

import type { ChargingSession } from '@/types/charging';

export type SiteStatus = 'healthy' | 'degrading' | 'degraded' | 'unknown';

export interface ChargeSessionMetric {
  id: string;
  startedMs: number;
  /** Mean power sustained over the session, W. */
  powerW: number;
  energyWh: number;
  durationS: number;
  startSocPct: number | null;
  endSocPct: number | null;
  /** True when most of the session sat above the taper threshold. */
  tapered: boolean;
}

export interface ChargerSite {
  /** Stable grouping key (place name, or rounded lat/lng cell). */
  key: string;
  label: string;
  lat: number | null;
  lng: number | null;
  /** `dc` when any session exceeded the AC ceiling, else `ac`. */
  kind: 'ac' | 'dc';
  sessions: number;
  /** Sessions clean enough to score (untapered, long enough). */
  ratedSessions: number;
  firstSeenMs: number;
  lastSeenMs: number;
  /** The site's demonstrated capability, W (95th-percentile-ish of clean sessions). */
  baselineW: number;
  /** Mean power of the most recent clean sessions, W. */
  recentW: number;
  /** recentW / baselineW, 0–1+. */
  performanceRatio: number;
  totalEnergyWh: number;
  status: SiteStatus;
  /** Extra hours per year the shortfall costs at current usage; 0 when healthy. */
  hoursLostPerYear: number;
  history: ChargeSessionMetric[];
}

export interface ChargerHealthSummary {
  sites: ChargerSite[];
  degradedCount: number;
  /** Best-performing site by baseline power, if any. */
  fastestSite: ChargerSite | null;
  /** Site the owner uses most by energy. */
  primarySite: ChargerSite | null;
  totalSessions: number;
  usableSessions: number;
}

export interface ChargerHealthOptions {
  /** SoC above which DC power tapers hard. */
  taperSocPct?: number;
  /** Minimum session length to be scorable, seconds. */
  minDurationS?: number;
  /** Minimum energy for a session to count, Wh. */
  minEnergyWh?: number;
  /** Clean sessions required before a site can be judged. */
  minRatedSessions?: number;
  /** How many recent clean sessions form the "now" sample. */
  recentWindow?: number;
  /** Ratio below which a site is fully degraded. */
  degradedRatio?: number;
  /** Ratio below which a site is degrading. */
  degradingRatio?: number;
}

const DEFAULTS = {
  taperSocPct: 80,
  minDurationS: 600,
  minEnergyWh: 2000,
  minRatedSessions: 4,
  recentWindow: 5,
  degradedRatio: 0.75,
  degradingRatio: 0.9,
} as const;

/** Above this a plug cannot be single-phase AC; used only to label the site. */
const AC_CEILING_W = 25_000;

function num(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Group key for a session.
 *
 * Exported because mis-grouping silently destroys the whole analysis: two
 * spellings of the same place would each look like a site with too little
 * history to judge.
 */
export function siteKeyOf(session: ChargingSession): { key: string; label: string } | null {
  const place = session.start_place?.trim();
  if (place != null && place.length > 0) {
    return { key: `place:${place.toLowerCase()}`, label: place };
  }
  const lat = num(session.start_lat);
  const lng = num(session.start_lng);
  if (lat == null || lng == null) return null;
  // ~1 km cells: enough to merge parking-bay GPS scatter, tight enough to keep
  // neighbouring sites apart.
  const rLat = Math.round(lat * 100) / 100;
  const rLng = Math.round(lng * 100) / 100;
  return {
    key: `geo:${rLat.toFixed(2)},${rLng.toFixed(2)}`,
    label: `${rLat.toFixed(2)}, ${rLng.toFixed(2)}`,
  };
}

/**
 * Reduce a raw session to the numbers the model needs, or `null` when it is
 * too short, too small, or missing the fields required to compute power.
 */
export function toSessionMetric(
  session: ChargingSession,
  taperSocPct: number,
  minDurationS: number,
  minEnergyWh: number,
): ChargeSessionMetric | null {
  const startedMs = new Date(session.started_at ?? session.start_ts).getTime();
  if (!Number.isFinite(startedMs)) return null;

  const energyWh = num(session.total_energy_added_wh);
  if (energyWh == null || energyWh < minEnergyWh) return null;

  // Prefer the true end timestamp; fall back to the derived duration_min that
  // the activity shape carries.
  let durationS: number | null = null;
  if (session.ended_at != null) {
    const endedMs = new Date(session.ended_at).getTime();
    if (Number.isFinite(endedMs)) durationS = (endedMs - startedMs) / 1000;
  }
  if (durationS == null || durationS <= 0) {
    const mins = num(session.duration_min);
    durationS = mins == null ? null : mins * 60;
  }
  if (durationS == null || durationS < minDurationS) return null;

  // Measured mean power beats the reported average: it is derived from the two
  // quantities that are actually reliable.
  const powerW = (energyWh * 3600) / durationS;
  if (!Number.isFinite(powerW) || powerW <= 0) return null;

  const startSoc = num(session.start_soc_pct);
  const endSoc = num(session.end_soc_pct);

  // A session is "tapered" when more than half of its SoC travel sat in the
  // taper band — those sessions cannot be compared with a 20→60 % top-up.
  let tapered = false;
  if (startSoc != null && endSoc != null && endSoc > startSoc) {
    const span = endSoc - startSoc;
    const inTaper = Math.max(0, endSoc - Math.max(startSoc, taperSocPct));
    tapered = inTaper / span > 0.5;
  } else if (startSoc != null && startSoc >= taperSocPct) {
    tapered = true;
  }

  return {
    id: session.id,
    startedMs,
    powerW: Math.round(powerW),
    energyWh: Math.round(energyWh),
    durationS: Math.round(durationS),
    startSocPct: startSoc,
    endSocPct: endSoc,
    tapered,
  };
}

/**
 * The site's demonstrated capability.
 *
 * Uses a high quantile of clean sessions rather than the maximum, so one
 * freakishly good reading (or a duration glitch) cannot set an unreachable bar
 * that makes every later session look degraded.
 */
function baselineOf(powers: readonly number[]): number {
  if (powers.length === 0) return 0;
  const sorted = [...powers].sort((a, b) => a - b);
  if (sorted.length < 4) return sorted[sorted.length - 1]!;
  const idx = Math.floor(sorted.length * 0.9);
  return sorted[Math.min(idx, sorted.length - 1)]!;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function analyzeChargerHealth(
  sessions: readonly ChargingSession[],
  options: ChargerHealthOptions = {},
): ChargerHealthSummary {
  const opts = { ...DEFAULTS, ...options };

  const groups = new Map<
    string,
    { label: string; lat: number | null; lng: number | null; metrics: ChargeSessionMetric[] }
  >();
  let usable = 0;

  for (const session of sessions) {
    const site = siteKeyOf(session);
    if (site == null) continue;
    const metric = toSessionMetric(session, opts.taperSocPct, opts.minDurationS, opts.minEnergyWh);
    if (metric == null) continue;
    usable += 1;

    let group = groups.get(site.key);
    if (group == null) {
      group = {
        label: site.label,
        lat: num(session.start_lat),
        lng: num(session.start_lng),
        metrics: [],
      };
      groups.set(site.key, group);
    }
    group.metrics.push(metric);
  }

  const sites: ChargerSite[] = [];

  for (const [key, group] of groups) {
    const history = group.metrics.sort((a, b) => a.startedMs - b.startedMs);
    const clean = history.filter((m) => !m.tapered);
    const totalEnergyWh = history.reduce((sum, m) => sum + m.energyWh, 0);
    const peak = Math.max(...history.map((m) => m.powerW));

    const baselinePool = clean.length >= opts.minRatedSessions ? clean : [];
    const baselineW = Math.round(baselineOf(baselinePool.map((m) => m.powerW)));
    const recent = clean.slice(-opts.recentWindow);
    const recentW = Math.round(mean(recent.map((m) => m.powerW)));

    let status: SiteStatus = 'unknown';
    let ratio = 0;
    if (baselineW > 0 && recent.length > 0 && clean.length >= opts.minRatedSessions) {
      ratio = recentW / baselineW;
      if (ratio < opts.degradedRatio) status = 'degraded';
      else if (ratio < opts.degradingRatio) status = 'degrading';
      else status = 'healthy';
    }

    // Translate the shortfall into the only unit an owner cares about: time.
    // Only reported for sites actually in trouble — a 1 % wobble on a healthy
    // plug is measurement noise, not a lost hour.
    let hoursLostPerYear = 0;
    if ((status === 'degraded' || status === 'degrading') && ratio > 0 && recentW > 0) {
      const spanDays = Math.max(
        1,
        (history[history.length - 1]!.startedMs - history[0]!.startedMs) / 86_400_000,
      );
      const energyPerYearWh = (totalEnergyWh / spanDays) * 365;
      const hoursAtBaseline = energyPerYearWh / baselineW;
      const hoursNow = energyPerYearWh / recentW;
      hoursLostPerYear = Math.round((hoursNow - hoursAtBaseline) * 10) / 10;
    }

    sites.push({
      key,
      label: group.label,
      lat: group.lat,
      lng: group.lng,
      kind: peak > AC_CEILING_W ? 'dc' : 'ac',
      sessions: history.length,
      ratedSessions: clean.length,
      firstSeenMs: history[0]!.startedMs,
      lastSeenMs: history[history.length - 1]!.startedMs,
      baselineW,
      recentW,
      performanceRatio: Math.round(ratio * 1000) / 1000,
      totalEnergyWh,
      status,
      hoursLostPerYear,
      history,
    });
  }

  // Worst first, then by how much the owner depends on the site.
  const rank: Record<SiteStatus, number> = { degraded: 0, degrading: 1, healthy: 2, unknown: 3 };
  sites.sort((a, b) => rank[a.status] - rank[b.status] || b.totalEnergyWh - a.totalEnergyWh);

  const judged = sites.filter((s) => s.status !== 'unknown');

  return {
    sites,
    degradedCount: sites.filter((s) => s.status === 'degraded' || s.status === 'degrading').length,
    fastestSite:
      judged.length === 0
        ? null
        : judged.reduce((best, s) => (s.baselineW > best.baselineW ? s : best)),
    primarySite:
      sites.length === 0
        ? null
        : sites.reduce((best, s) => (s.totalEnergyWh > best.totalEnergyWh ? s : best)),
    totalSessions: sessions.length,
    usableSessions: usable,
  };
}
