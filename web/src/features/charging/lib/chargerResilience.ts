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
import { normalizePlaceGeoSite } from './siteIdentity';

export type SiteGroupedBy = 'place' | 'geo' | 'charger_type';
export type EnergyDenominator = 'available' | 'missing' | 'nonpositive';

export interface ResilienceSite {
  key: string;
  label: string | null;
  groupedBy: SiteGroupedBy;
  sessions: number;
  totalEnergyWh: number;
  recordedEnergySessions: number;
  positiveEnergyWh: number;
  /** Positive-energy share, 0..1; meaningful only with an available denominator. */
  energyShare: number;
}

export interface WhatIfTopSiteLoss {
  topSiteLabel: string | null;
  energyAtRiskWh: number;
  /** Positive-energy share lost; null when the energy denominator is unavailable. */
  energyAtRiskShare: number | null;
  energyAtRiskAvailable: boolean;
  remainingSiteCount: number;
  energyDenominator: EnergyDenominator;
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
  energyDenominator: EnergyDenominator;
  /** Energy-weighted concentration index; null without a complete positive denominator. */
  hhi: number | null;
  /** 1/hhi — the number of equally-sized sites this portfolio behaves like. */
  effectiveSiteCount: number | null;
  topSiteDependencyPct: number;
  /**
   * Share of SESSIONS (not energy) that happened somewhere other than the
   * top site — evidence that alternates have actually been used, not just
   * a mathematical complement of dependency.
   */
  fallbackCoveragePct: number;
  /** Composite 0-100 score; uses disclosed session/site-count fallback without energy. */
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

/**
 * Resolve a session's site identity using the documented three-step
 * fallback. Exported for tests. Returns a bucket even for a session with
 * no location data whatsoever, so total energy is never understated.
 */
export function resolveResilienceSite(
  session: ChargingSession,
): { key: string; label: string | null; groupedBy: SiteGroupedBy } {
  const placeGeo = normalizePlaceGeoSite(session);
  if (placeGeo != null) {
    return {
      ...placeGeo,
      groupedBy: placeGeo.key.startsWith('place:') ? 'place' : 'geo',
    };
  }
  const type = session.charger_type?.trim();
  if (type != null && type.length > 0) {
    return { key: `type:${type.toLowerCase()}`, label: type, groupedBy: 'charger_type' };
  }
  return { key: 'type:unknown', label: null, groupedBy: 'charger_type' };
}

interface SiteAccumulator {
  label: string | null;
  groupedBy: SiteGroupedBy;
  sessions: number;
  totalEnergyWh: number;
  recordedEnergySessions: number;
  positiveEnergyWh: number;
}

function buildSites(
  sessions: readonly ChargingSession[],
): { sites: ResilienceSite[]; totalEnergyWh: number; totalSessions: number } {
  const groups = new Map<string, SiteAccumulator>();
  let totalEnergyWh = 0;
  let positiveEnergyWh = 0;
  let recordedEnergySessions = 0;

  for (const s of sessions) {
    const { key, label, groupedBy } = resolveResilienceSite(s);
    const energyWh = num(s.total_energy_added_wh);
    totalEnergyWh += energyWh ?? 0;
    positiveEnergyWh += Math.max(0, energyWh ?? 0);
    if (energyWh != null) recordedEnergySessions += 1;
    let acc = groups.get(key);
    if (acc == null) {
      acc = { label, groupedBy, sessions: 0, totalEnergyWh: 0, recordedEnergySessions: 0, positiveEnergyWh: 0 };
      groups.set(key, acc);
    }
    acc.sessions += 1;
    acc.totalEnergyWh += energyWh ?? 0;
    acc.positiveEnergyWh += Math.max(0, energyWh ?? 0);
    if (energyWh != null) acc.recordedEnergySessions += 1;
  }

  const sites: ResilienceSite[] = Array.from(groups.entries()).map(([key, acc]) => ({
    key,
    label: acc.label,
    groupedBy: acc.groupedBy,
    sessions: acc.sessions,
    totalEnergyWh: acc.totalEnergyWh,
    recordedEnergySessions: acc.recordedEnergySessions,
    positiveEnergyWh: acc.positiveEnergyWh,
    energyShare: recordedEnergySessions === sessions.length && positiveEnergyWh > 0
      ? acc.positiveEnergyWh / positiveEnergyWh : 0,
  }));

  sites.sort((a, b) => b.positiveEnergyWh - a.positiveEnergyWh || b.sessions - a.sessions || a.key.localeCompare(b.key));

  return { sites, totalEnergyWh, totalSessions: sessions.length };
}

function energyDenominator(sites: readonly ResilienceSite[]): EnergyDenominator {
  if (sites.some(site => site.recordedEnergySessions !== site.sessions)) return 'missing';
  return sites.some(site => site.positiveEnergyWh > 0) ? 'available' : 'nonpositive';
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
  const denominator = energyDenominator(sites);
  const energyAvailable = denominator === 'available';

  if (sites.length === 0) {
    return {
      sites: [],
      totalSessions: 0,
      totalEnergyWh: 0,
      energyDenominator: denominator,
      hhi: null,
      effectiveSiteCount: null,
      topSiteDependencyPct: 0,
      fallbackCoveragePct: 0,
      resilienceScore: 0,
      topSite: null,
      whatIfTopSiteLoss: null,
    };
  }

  const hhi = energyAvailable ? computeHHI(sites) : null;
  const effectiveSiteCount = hhi != null && hhi > 0 ? 1 / hhi : null;

  // Session fallback is explicitly disclosed by consumers, never energy evidence.
  const topSite =
    energyAvailable
      ? sites[0]!
      : [...sites].sort((a, b) => b.sessions - a.sessions)[0]!;

  const topShare = energyAvailable ? topSite.energyShare : topSite.sessions / Math.max(1, totalSessions);
  const topSiteDependencyPct = Math.round(topShare * 1000) / 10;

  const sessionsElsewhere = totalSessions - topSite.sessions;
  const fallbackCoverageFraction = totalSessions > 0 ? sessionsElsewhere / totalSessions : 0;
  const fallbackCoveragePct = Math.round(fallbackCoverageFraction * 1000) / 10;

  const resilienceScore = computeResilienceScore(
    topShare,
    fallbackCoverageFraction,
    effectiveSiteCount ?? sites.length,
    opts.diversificationCapSites,
  );

  const whatIfTopSiteLoss = computeWhatIfTopSiteLoss(sites, topSite, totalSessions, resilienceScore, opts);

  return {
    sites,
    totalSessions,
    totalEnergyWh,
    energyDenominator: denominator,
    hhi: hhi == null ? null : Math.round(hhi * 1000) / 1000,
    effectiveSiteCount: effectiveSiteCount == null ? null : Math.round(effectiveSiteCount * 100) / 100,
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
  totalSessions: number,
  resilienceScoreBefore: number,
  opts: Required<ChargerResilienceOptions>,
): WhatIfTopSiteLoss {
  const remaining = sites.filter((s) => s.key !== topSite.key);
  const remainingEnergyWh = remaining.reduce((sum, site) => sum + site.positiveEnergyWh, 0);
  const remainingSessions = totalSessions - topSite.sessions;
  const denominator = energyDenominator(remaining);
  const energyAvailable = denominator === 'available';
  const risk = {
    energyAtRiskWh: topSite.totalEnergyWh,
    energyAtRiskAvailable: topSite.recordedEnergySessions === topSite.sessions,
    energyAtRiskShare: energyDenominator(sites) === 'available' ? topSite.energyShare : null,
    remainingSiteCount: remaining.length,
    energyDenominator: denominator,
  };

  if (remaining.length === 0) {
    return {
      topSiteLabel: topSite.label,
      ...risk,
      newTopSiteLabel: null,
      newTopSiteShare: null,
      resilienceScoreBefore,
      resilienceScoreAfter: 0,
      resilienceScoreDelta: 0 - resilienceScoreBefore,
    };
  }

  const rescaled = remaining
    .map((s) => ({ ...s, energyShare: energyAvailable ? s.positiveEnergyWh / remainingEnergyWh : 0 }))
    .sort((a, b) => energyAvailable ? b.energyShare - a.energyShare : b.sessions - a.sessions);

  const newTop = rescaled[0]!;
  const hhiAfter = computeHHI(rescaled);
  const effectiveAfter = hhiAfter > 0 ? 1 / hhiAfter : rescaled.length;
  const fallbackFractionAfter =
    remainingSessions > 0 ? (remainingSessions - newTop.sessions) / remainingSessions : 0;

  const resilienceScoreAfter = computeResilienceScore(
    energyAvailable ? newTop.energyShare : newTop.sessions / remainingSessions,
    fallbackFractionAfter,
    effectiveAfter,
    opts.diversificationCapSites,
  );

  return {
    topSiteLabel: topSite.label,
    ...risk,
    newTopSiteLabel: newTop.label,
    newTopSiteShare: energyAvailable ? Math.round(newTop.energyShare * 1000) / 1000 : null,
    resilienceScoreBefore,
    resilienceScoreAfter,
    resilienceScoreDelta: resilienceScoreAfter - resilienceScoreBefore,
  };
}
