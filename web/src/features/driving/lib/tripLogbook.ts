/**
 * Trip Logbook model — business / commute / personal drive classification
 * with reimbursement math and route-corridor auto-classification.
 *
 * Everything here is pure and synchronous so it unit-tests without React:
 * the page owns fetching (drives come from `useDrives`) and persistence
 * (categories + rates live in localStorage via `useTripLogbook`), while this
 * module owns:
 *
 *   - the category vocabulary and rate defaults,
 *   - corridor keys (direction-insensitive route fingerprints),
 *   - per-category distance/amount summaries,
 *   - "classify similar" suggestions driven by corridor majority vote,
 *   - validation of the persisted localStorage payload.
 *
 * # Units
 *
 * Distances are SI meters end-to-end (matching `Drive.distanceM`).
 * Reimbursement rates are stored **per kilometre in major currency units**
 * (e.g. 0.44 = $0.44/km) regardless of the user's display unit — the page
 * converts to/from a per-mile rate at the edit boundary the same way every
 * other formatter converts at the display boundary. Amounts are therefore
 * `distanceM / 1000 * ratePerKm`, in major currency units.
 */

import type { Drive } from '@/types/driving';

/* ------------------------------------------------------------------ */
/*  Vocabulary                                                        */
/* ------------------------------------------------------------------ */

export const TRIP_CATEGORIES = ['business', 'commute', 'personal'] as const;
export type TripCategory = (typeof TRIP_CATEGORIES)[number];

/** driveId → category. A drive absent from the map is unclassified. */
export type CategoryMap = Record<number, TripCategory>;

/** Reimbursement rate per kilometre, in major currency units. */
export type RateMap = Record<TripCategory, number>;

/**
 * Starting rates for a fresh logbook, per km. Business defaults to the
 * ballpark of the IRS standard mileage rate (~$0.70/mi ≈ $0.44/km); commute
 * mirrors the common EU commuter allowance (~€0.30/km); personal drives are
 * not reimbursable. All three are user-editable — these only seed the store.
 */
export const DEFAULT_RATES_PER_KM: RateMap = {
  business: 0.44,
  commute: 0.3,
  personal: 0,
};

export function isTripCategory(v: unknown): v is TripCategory {
  return typeof v === 'string' && (TRIP_CATEGORIES as readonly string[]).includes(v);
}

/* ------------------------------------------------------------------ */
/*  Corridor keys                                                     */
/* ------------------------------------------------------------------ */

/**
 * Direction-insensitive route fingerprint for a drive, or `null` when the
 * drive can't be located.
 *
 * Coordinates are rounded to 3 decimals (~110 m) so GPS jitter between the
 * same two parking spots still buckets together, then the two endpoints are
 * sorted lexicographically so A→B and B→A share a key — if the morning
 * home→office leg is a commute, the evening office→home leg is too.
 *
 * Falls back to normalised addresses when either endpoint lacks coordinates,
 * so imported drives without GPS still corridor-match by geocoded label.
 */
export function corridorKey(drive: Pick<Drive, 'startLat' | 'startLon' | 'endLat' | 'endLon' | 'startAddress' | 'endAddress'>): string | null {
  const a = endpointKey(drive.startLat, drive.startLon, drive.startAddress);
  const b = endpointKey(drive.endLat, drive.endLon, drive.endAddress);
  if (a == null || b == null) return null;
  return a <= b ? `${a}→${b}` : `${b}→${a}`;
}

function endpointKey(lat: number | null, lon: number | null, address: string | null): string | null {
  if (lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)) {
    return `${lat.toFixed(3)},${lon.toFixed(3)}`;
  }
  const addr = address?.trim().toLowerCase();
  return addr ? `@${addr}` : null;
}

/* ------------------------------------------------------------------ */
/*  Summaries                                                         */
/* ------------------------------------------------------------------ */

export interface CategoryTotals {
  count: number;
  distanceM: number;
  /** Reimbursable amount in major currency units. */
  amount: number;
}

export interface LogbookSummary {
  perCategory: Record<TripCategory, CategoryTotals>;
  unclassified: { count: number; distanceM: number };
  totalCount: number;
  totalDistanceM: number;
  /** Sum of every category's reimbursable amount. */
  totalAmount: number;
}

/** Reimbursable amount for one drive under a per-km rate map. */
export function driveAmount(distanceM: number, category: TripCategory, ratesPerKm: RateMap): number {
  const rate = ratesPerKm[category] ?? 0;
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(distanceM) || distanceM <= 0) return 0;
  return (distanceM / 1000) * rate;
}

export function summarizeLogbook(
  drives: readonly Drive[],
  categories: CategoryMap,
  ratesPerKm: RateMap,
): LogbookSummary {
  const perCategory: Record<TripCategory, CategoryTotals> = {
    business: { count: 0, distanceM: 0, amount: 0 },
    commute: { count: 0, distanceM: 0, amount: 0 },
    personal: { count: 0, distanceM: 0, amount: 0 },
  };
  const unclassified = { count: 0, distanceM: 0 };
  let totalDistanceM = 0;

  for (const d of drives) {
    const dist = Number.isFinite(d.distanceM) ? Math.max(0, d.distanceM) : 0;
    totalDistanceM += dist;
    const cat = categories[d.id];
    if (cat == null) {
      unclassified.count += 1;
      unclassified.distanceM += dist;
      continue;
    }
    const bucket = perCategory[cat];
    bucket.count += 1;
    bucket.distanceM += dist;
    bucket.amount += driveAmount(dist, cat, ratesPerKm);
  }

  return {
    perCategory,
    unclassified,
    totalCount: drives.length,
    totalDistanceM,
    totalAmount: TRIP_CATEGORIES.reduce((sum, c) => sum + perCategory[c].amount, 0),
  };
}

/* ------------------------------------------------------------------ */
/*  Corridor suggestions                                              */
/* ------------------------------------------------------------------ */

export interface CorridorSuggestion {
  driveId: number;
  category: TripCategory;
}

/**
 * Propose categories for unclassified drives whose corridor already has a
 * clear precedent.
 *
 * Every classified drive votes its category onto its corridor; a corridor
 * with a strict-majority winner then suggests that category for each of its
 * unclassified drives. Ties suggest nothing — silence beats a coin-flip in
 * a tax document. Deterministic: output order follows the input drive order.
 */
export function suggestByCorridor(
  drives: readonly Drive[],
  categories: CategoryMap,
): CorridorSuggestion[] {
  const votes = new Map<string, Partial<Record<TripCategory, number>>>();

  for (const d of drives) {
    const cat = categories[d.id];
    if (cat == null) continue;
    const key = corridorKey(d);
    if (key == null) continue;
    const tally = votes.get(key) ?? {};
    tally[cat] = (tally[cat] ?? 0) + 1;
    votes.set(key, tally);
  }

  const winners = new Map<string, TripCategory>();
  for (const [key, tally] of votes) {
    let best: TripCategory | null = null;
    let bestCount = 0;
    let tied = false;
    for (const cat of TRIP_CATEGORIES) {
      const n = tally[cat] ?? 0;
      if (n > bestCount) {
        best = cat;
        bestCount = n;
        tied = false;
      } else if (n === bestCount && n > 0) {
        tied = true;
      }
    }
    if (best != null && !tied) winners.set(key, best);
  }

  const out: CorridorSuggestion[] = [];
  for (const d of drives) {
    if (categories[d.id] != null) continue;
    const key = corridorKey(d);
    if (key == null) continue;
    const winner = winners.get(key);
    if (winner != null) out.push({ driveId: d.id, category: winner });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Persistence payload                                               */
/* ------------------------------------------------------------------ */

export interface LogbookStore {
  categories: CategoryMap;
  ratesPerKm: RateMap;
}

export const EMPTY_LOGBOOK_STORE: LogbookStore = {
  categories: {},
  ratesPerKm: DEFAULT_RATES_PER_KM,
};

/**
 * Parse the persisted localStorage payload defensively. Unknown categories,
 * non-numeric drive ids, and non-finite/negative rates are dropped so a
 * corrupted or future-versioned payload degrades to defaults instead of
 * crashing the page. Never throws.
 */
export function parseLogbookStore(raw: string | null): LogbookStore {
  if (!raw) return EMPTY_LOGBOOK_STORE;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== 'object') return EMPTY_LOGBOOK_STORE;
    const obj = parsed as Record<string, unknown>;

    const categories: CategoryMap = {};
    if (obj.categories != null && typeof obj.categories === 'object') {
      for (const [k, v] of Object.entries(obj.categories as Record<string, unknown>)) {
        const id = Number(k);
        if (Number.isInteger(id) && isTripCategory(v)) categories[id] = v;
      }
    }

    const ratesPerKm: RateMap = { ...DEFAULT_RATES_PER_KM };
    if (obj.ratesPerKm != null && typeof obj.ratesPerKm === 'object') {
      for (const cat of TRIP_CATEGORIES) {
        const v = (obj.ratesPerKm as Record<string, unknown>)[cat];
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) ratesPerKm[cat] = v;
      }
    }

    return { categories, ratesPerKm };
  } catch {
    return EMPTY_LOGBOOK_STORE;
  }
}

export function serializeLogbookStore(store: LogbookStore): string {
  return JSON.stringify(store);
}
