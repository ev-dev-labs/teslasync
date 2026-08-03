/**
 * Explorer model — how far and how wide the car actually roams.
 *
 * Anchors on "home" (the most frequent drive END coordinate, rounded to
 * ~1 km cells) and measures exploration from there: unique destinations,
 * the farthest one, the exploration radius, and first-visit growth by month.
 * Pure and React-free.
 */

import type { Drive } from '@/types/driving';

export interface Destination {
  /** ~1 km rounded cell key. */
  cell: string;
  /** Representative display label (first non-empty address seen). */
  label: string | null;
  lat: number;
  lon: number;
  visits: number;
  /** km from the home anchor. */
  distanceFromHomeKm: number;
  /** `yyyy-mm` of the first visit. */
  firstVisitMonth: string;
}

// Type alias (not interface) so it carries an implicit index signature and
// stays assignable to ChartContainer's `ChartDataRow` fallback-table shape.
export type MonthlyDiscovery = {
  /** `yyyy-mm`. */
  month: string;
  newPlaces: number;
};

export interface ExplorerSummary {
  home: { lat: number; lon: number; label: string | null } | null;
  /** All destination cells except home, sorted by visits desc. */
  destinations: Destination[];
  uniquePlaces: number;
  /** Farthest destination from home, or null. */
  farthest: Destination | null;
  /** p90 distance-from-home over destination visits, km — the practical roaming radius. */
  radiusKm: number | null;
  monthlyDiscoveries: MonthlyDiscovery[];
  analyzed: number;
}

/** Haversine great-circle distance in km. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** ~1 km cell: 2 decimal degrees of latitude ≈ 1.1 km. */
function cellOf(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

interface CellAgg {
  lat: number;
  lon: number;
  label: string | null;
  visits: number;
  firstTs: string;
}

export function summarizeExplorer(drives: readonly Drive[]): ExplorerSummary {
  const cells = new Map<string, CellAgg>();
  let analyzed = 0;

  const dated = [...drives]
    .filter((d) => d.startTs)
    .sort((a, b) => a.startTs.localeCompare(b.startTs));

  for (const d of dated) {
    if (d.endLat == null || d.endLon == null) continue;
    if (!Number.isFinite(d.endLat) || !Number.isFinite(d.endLon)) continue;
    analyzed += 1;
    const key = cellOf(d.endLat, d.endLon);
    const agg = cells.get(key);
    if (agg) {
      agg.visits += 1;
      if (agg.label == null && d.endAddress?.trim()) agg.label = d.endAddress.trim();
    } else {
      cells.set(key, {
        lat: d.endLat,
        lon: d.endLon,
        label: d.endAddress?.trim() || null,
        visits: 1,
        firstTs: d.startTs,
      });
    }
  }

  if (cells.size === 0) {
    return {
      home: null,
      destinations: [],
      uniquePlaces: 0,
      farthest: null,
      radiusKm: null,
      monthlyDiscoveries: [],
      analyzed,
    };
  }

  // Home = most-visited cell (ties: first seen wins via insertion order).
  let homeKey = '';
  let homeAgg: CellAgg | null = null;
  for (const [key, agg] of cells) {
    if (homeAgg == null || agg.visits > homeAgg.visits) {
      homeKey = key;
      homeAgg = agg;
    }
  }

  const destinations: Destination[] = [];
  for (const [key, agg] of cells) {
    if (key === homeKey) continue;
    destinations.push({
      cell: key,
      label: agg.label,
      lat: agg.lat,
      lon: agg.lon,
      visits: agg.visits,
      distanceFromHomeKm:
        Math.round(haversineKm(homeAgg!.lat, homeAgg!.lon, agg.lat, agg.lon) * 10) / 10,
      firstVisitMonth: agg.firstTs.substring(0, 7),
    });
  }
  destinations.sort((a, b) => b.visits - a.visits);

  let farthest: Destination | null = null;
  for (const d of destinations) {
    if (farthest == null || d.distanceFromHomeKm > farthest.distanceFromHomeKm) farthest = d;
  }

  // Radius: p90 of visit-weighted distances — where 90% of arrivals land.
  const weighted: number[] = [];
  for (const d of destinations) for (let i = 0; i < d.visits; i++) weighted.push(d.distanceFromHomeKm);
  weighted.sort((a, b) => a - b);
  const radiusKm = weighted.length
    ? Math.round(weighted[Math.min(weighted.length - 1, Math.ceil(0.9 * weighted.length) - 1)]! * 10) / 10
    : null;

  const byMonth = new Map<string, number>();
  for (const d of destinations) {
    byMonth.set(d.firstVisitMonth, (byMonth.get(d.firstVisitMonth) ?? 0) + 1);
  }
  const monthlyDiscoveries: MonthlyDiscovery[] = Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([month, newPlaces]) => ({ month, newPlaces }));

  return {
    home: { lat: homeAgg!.lat, lon: homeAgg!.lon, label: homeAgg!.label },
    destinations,
    uniquePlaces: destinations.length,
    farthest,
    radiusKm,
    monthlyDiscoveries,
    analyzed,
  };
}
