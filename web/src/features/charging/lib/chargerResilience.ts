/**
 * Charger Resilience — how dependent are you on a single charging location?
 *
 * This module answers a portfolio-diversification question, not a
 * performance one: if your single most-used charging site vanished
 * tomorrow (closed, moved, went out of service), how much trouble would
 * you be in? It deliberately ignores whether any site is fast, slow, or
 * degrading (that is `chargerHealth`'s job) and ignores *when* charging
 * happens (that is `chargingHeatmap`'s job). It only looks at *where*
 * energy came from and how concentrated that is.
 *
 * Site identity is resolved with an explicit three-step fallback so that
 * no session's energy is silently dropped from the analysis, even when the
 * location is only partially known:
 *
 *   1. `start_place` — the reverse-geocoded label, when present.
 *   2. A coarse ~1 km rounded lat/lng cell, when coordinates exist but no
 *      place name was resolved.
 *   3. `charger_type` — a last-resort bucket (e.g. "Supercharger") so a
 *      session with neither a place nor coordinates still counts toward
 *      the totals instead of quietly vanishing and making the fleet look
 *      artificially more diversified than it is.
 *
 * The core measure is an energy-weighted Herfindahl-Hirschman Index (HHI),
 * the standard concentration measure from economics: HHI = Σ(share_i²)
 * over each site's share of total energy delivered. HHI runs 0 (perfectly
 * spread out) to 1 (100% from one site). Its reciprocal, 1/HHI, is the
 * "effective site count" — the number of *equally-sized* sites that would
 * produce the same concentration, which is usually smaller and more
 * honest than a raw count of distinct locations ever visited once.
 *
 * Pure and React-free.
 */

import type { ChargingSession } from '@/types/charging';

export type SiteGroupedBy = 'place' | 'geo' | 'charger_type';

export interface ResilienceSite {
  key: string;
  label: string;
  groupedBy: SiteGroupedBy;
  sessions: number;
  totalEnergyWh: number;
  /** Share of total fleet-wide energy delivered at this site, 0..1. */
  energyShare: number;
}

export interface WhatIfTopSiteLoss {
  topSiteLabel: string;
  energyAtRiskWh: number;
  /** Same value as `topSiteDependencyPct / 100` — how much energy disappears. */
  energyAtRiskShare: number;
  newTopSiteLabel: string | null;
  /** The new top site's share of the *remaining* energy after removal, 0..1. */
  newTopSiteShare: number | null;
  resilienceScoreBefore: number;
  resilienceScoreAfter: number;
  resilienceScoreDelta: number;
}

export interface ChargerResilienceSummary {
  sites: ResilienceSite[];
  totalSessions: number;
  totalEnergyWh: number;
  /** Energy-weighted concentration index, 0 (spread out) .. 1 (single site). */
  hhi: number;
  /** 1/hhi — the number of equally-sized sites this portfolio behaves like. */
  effectiveSiteCount: number;
  topSiteDependencyPct: number;
  /**
   * Share of SESSIONS (not energy) that happened somewhere other than the
   * top site — evidence that alternates have actually been used, not just
   * a mathematical complement of dependency.
   */
  fallbackCoveragePct: number;
  /** Composite 0-100 score; see `computeResilienceScore` for the weights. */
  resilienceScore: number;
  topSite: ResilienceSite | null;
  whatIfTopSiteLoss: WhatIfTopSiteLoss | null;
}

export interface ChargerResilienceOptions {
  /** Effective-site count at which the diversification term saturates. */
  diversificationCapSites?: number;
}

const DEFAULTS = {
  diversificationCapSites: 5,
} as const;

function num(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Resolve a session's site identity using the documented three-step
 * fallback. Exported for tests. Returns a bucket even for a session with
 * no location data whatsoever, so total energy is never understated.
 */
export function resolveResilienceSite(
  session: ChargingSession,
): { key: string; label: string; groupedBy: SiteGroupedBy } {
  const place = session.start_place?.trim();
  if (place != null && place.length > 0) {
    return { key: `place:${place.toLowerCase()}`, label: place, groupedBy: 'place' };
  }
  const lat = num(session.start_lat);
  const lng = num(session.start_lng);
  if (lat != null && lng != null) {
    const rLat = Math.round(lat * 100) / 100;
    const rLng = Math.round(lng * 100) / 100;
    return {
      key: `geo:${rLat.toFixed(2)},${rLng.toFixed(2)}`,
      label: `${rLat.toFixed(2)}, ${rLng.toFixed(2)}`,
      groupedBy: 'geo',
    };
  }
  const type = session.charger_type?.trim();
  if (type != null && type.length > 0) {
    return { key: `type:${type.toLowerCase()}`, label: titleCase(type), groupedBy: 'charger_type' };
  }
  return { key: 'type:unknown', label: 'Unknown location', groupedBy: 'charger_type' };
}

interface SiteAccumulator {
  label: string;
  groupedBy: SiteGroupedBy;
  sessions: number;
  totalEnergyWh: number;
}

function buildSites(
  sessions: readonly ChargingSession[],
): { sites: ResilienceSite[]; totalEnergyWh: number; totalSessions: number } {
  const groups = new Map<string, SiteAccumulator>();
  let totalEnergyWh = 0;

  for (const s of sessions) {
    const { key, label, groupedBy } = resolveResilienceSite(s);
    const energyWh = Math.max(0, num(s.total_energy_added_wh) ?? 0);
    totalEnergyWh += energyWh;
    let acc = groups.get(key);
    if (acc == null) {
      acc = { label, groupedBy, sessions: 0, totalEnergyWh: 0 };
      groups.set(key, acc);
    }
    acc.sessions += 1;
    acc.totalEnergyWh += energyWh;
  }

  const sites: ResilienceSite[] = Array.from(groups.entries()).map(([key, acc]) => ({
    key,
    label: acc.label,
    groupedBy: acc.groupedBy,
    sessions: acc.sessions,
    totalEnergyWh: Math.round(acc.totalEnergyWh),
    energyShare: totalEnergyWh > 0 ? acc.totalEnergyWh / totalEnergyWh : 0,
  }));

  sites.sort((a, b) => b.totalEnergyWh - a.totalEnergyWh || b.sessions - a.sessions || a.key.localeCompare(b.key));

  return { sites, totalEnergyWh: Math.round(totalEnergyWh), totalSessions: sessions.length };
}

/** Energy-weighted HHI, 0..1. Empty input yields 0 (nothing to concentrate). */
export function computeHHI(sites: readonly ResilienceSite[]): number {
  return sites.reduce((sum, s) => sum + s.energyShare * s.energyShare, 0);
}

/**
 * Composite 0-100 resilience score. Weighted sum of three normalized 0..1
 * terms, documented so the weighting is auditable rather than a magic
 * number:
 *   - 40% — energy NOT concentrated in the top site (the acute risk: an
 *     outage or closure at the top site is what actually hurts).
 *   - 30% — share of sessions that have proven out an alternate site (a
 *     portfolio only "on paper" diversified but never actually used
 *     elsewhere doesn't get full credit).
 *   - 30% — effective site count, normalized against a saturating cap
 *     (`diversificationCapSites`) because going from 1 to 3 real sites
 *     matters far more than going from 8 to 10.
 */
export function computeResilienceScore(
  topShare: number,
  fallbackCoverageFraction: number,
  effectiveSiteCount: number,
  capSites: number,
): number {
  const diversificationTerm = clamp01(1 - topShare);
  const fallbackTerm = clamp01(fallbackCoverageFraction);
  const normalizedEffective = clamp01((effectiveSiteCount - 1) / Math.max(1, capSites - 1));
  const score = 100 * (0.4 * diversificationTerm + 0.3 * fallbackTerm + 0.3 * normalizedEffective);
  return Math.round(clamp01(score / 100) * 100);
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

export function analyzeChargerResilience(
  sessions: readonly ChargingSession[],
  options: ChargerResilienceOptions = {},
): ChargerResilienceSummary {
  const opts = { ...DEFAULTS, ...options };
  const { sites, totalEnergyWh, totalSessions } = buildSites(sessions);

  if (sites.length === 0) {
    return {
      sites: [],
      totalSessions: 0,
      totalEnergyWh: 0,
      hhi: 0,
      effectiveSiteCount: 0,
      topSiteDependencyPct: 0,
      fallbackCoveragePct: 0,
      resilienceScore: 0,
      topSite: null,
      whatIfTopSiteLoss: null,
    };
  }

  const hhi = computeHHI(sites);
  const effectiveSiteCount = totalEnergyWh > 0 && hhi > 0 ? 1 / hhi : sites.length;

  // When no energy was ever recorded (all-zero sessions), fall back to
  // ranking "top site" by session count so the summary degrades gracefully
  // instead of reporting a meaningless 0% dependency.
  const topSite =
    totalEnergyWh > 0
      ? sites[0]!
      : [...sites].sort((a, b) => b.sessions - a.sessions)[0]!;

  const topShare = totalEnergyWh > 0 ? topSite.energyShare : topSite.sessions / Math.max(1, totalSessions);
  const topSiteDependencyPct = Math.round(topShare * 1000) / 10;

  const sessionsElsewhere = totalSessions - topSite.sessions;
  const fallbackCoverageFraction = totalSessions > 0 ? sessionsElsewhere / totalSessions : 0;
  const fallbackCoveragePct = Math.round(fallbackCoverageFraction * 1000) / 10;

  const resilienceScore = computeResilienceScore(
    topShare,
    fallbackCoverageFraction,
    effectiveSiteCount,
    opts.diversificationCapSites,
  );

  const whatIfTopSiteLoss = computeWhatIfTopSiteLoss(sites, topSite, totalEnergyWh, totalSessions, resilienceScore, opts);

  return {
    sites,
    totalSessions,
    totalEnergyWh,
    hhi: Math.round(hhi * 1000) / 1000,
    effectiveSiteCount: Math.round(effectiveSiteCount * 100) / 100,
    topSiteDependencyPct,
    fallbackCoveragePct,
    resilienceScore,
    topSite,
    whatIfTopSiteLoss,
  };
}

function computeWhatIfTopSiteLoss(
  sites: readonly ResilienceSite[],
  topSite: ResilienceSite,
  totalEnergyWh: number,
  totalSessions: number,
  resilienceScoreBefore: number,
  opts: Required<ChargerResilienceOptions>,
): WhatIfTopSiteLoss {
  const remaining = sites.filter((s) => s.key !== topSite.key);
  const remainingEnergyWh = totalEnergyWh - topSite.totalEnergyWh;
  const remainingSessions = totalSessions - topSite.sessions;

  if (remaining.length === 0 || remainingEnergyWh <= 0) {
    return {
      topSiteLabel: topSite.label,
      energyAtRiskWh: topSite.totalEnergyWh,
      energyAtRiskShare: totalEnergyWh > 0 ? topSite.totalEnergyWh / totalEnergyWh : 1,
      newTopSiteLabel: null,
      newTopSiteShare: null,
      resilienceScoreBefore,
      resilienceScoreAfter: 0,
      resilienceScoreDelta: 0 - resilienceScoreBefore,
    };
  }

  const rescaled = remaining
    .map((s) => ({ ...s, energyShare: s.totalEnergyWh / remainingEnergyWh }))
    .sort((a, b) => b.energyShare - a.energyShare);

  const newTop = rescaled[0]!;
  const hhiAfter = computeHHI(rescaled);
  const effectiveAfter = hhiAfter > 0 ? 1 / hhiAfter : rescaled.length;
  const fallbackFractionAfter =
    remainingSessions > 0 ? (remainingSessions - newTop.sessions) / remainingSessions : 0;

  const resilienceScoreAfter = computeResilienceScore(
    newTop.energyShare,
    fallbackFractionAfter,
    effectiveAfter,
    opts.diversificationCapSites,
  );

  return {
    topSiteLabel: topSite.label,
    energyAtRiskWh: topSite.totalEnergyWh,
    energyAtRiskShare: totalEnergyWh > 0 ? topSite.totalEnergyWh / totalEnergyWh : 1,
    newTopSiteLabel: newTop.label,
    newTopSiteShare: Math.round(newTop.energyShare * 1000) / 1000,
    resilienceScoreBefore,
    resilienceScoreAfter,
    resilienceScoreDelta: resilienceScoreAfter - resilienceScoreBefore,
  };
}
