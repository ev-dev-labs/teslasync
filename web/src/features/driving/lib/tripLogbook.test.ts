import { describe, it, expect } from 'vitest';
import type { Drive } from '@/types/driving';
import {
  DEFAULT_RATES_PER_KM,
  EMPTY_LOGBOOK_STORE,
  corridorKey,
  driveAmount,
  isTripCategory,
  parseLogbookStore,
  serializeLogbookStore,
  suggestByCorridor,
  summarizeLogbook,
  type CategoryMap,
  type RateMap,
} from './tripLogbook';

let nextId = 1;

function drive(over: Partial<Drive>): Drive {
  return {
    id: nextId++,
    vehicleId: 1,
    startTs: '2026-07-01T08:00:00Z',
    endTs: '2026-07-01T08:30:00Z',
    durationS: 1800,
    distanceM: 10_000,
    startAddress: 'Home',
    endAddress: 'Office',
    startLat: 37.1,
    startLon: -122.1,
    endLat: 37.2,
    endLon: -122.2,
    startBatteryPct: 80,
    endBatteryPct: 75,
    energyUsedWh: 2000,
    regenEnergyWh: 300,
    avgSpeedMps: 15,
    maxSpeedMps: 30,
    avgPowerW: 10_000,
    outsideTempAvgC: 18,
    insideTempAvgC: 21,
    score: null,
    endedStatus: null,
    createdAt: '2026-07-01T08:30:00Z',
    updatedAt: '2026-07-01T08:30:00Z',
    ...over,
  };
}

const RATES: RateMap = { business: 0.5, commute: 0.2, personal: 0 };

/* ── corridorKey ─────────────────────────────────────────────────── */

describe('corridorKey', () => {
  it('is direction-insensitive: A→B equals B→A', () => {
    const out = drive({ startLat: 37.1, startLon: -122.1, endLat: 37.2, endLon: -122.2 });
    const back = drive({ startLat: 37.2, startLon: -122.2, endLat: 37.1, endLon: -122.1 });
    expect(corridorKey(out)).toBe(corridorKey(back));
    expect(corridorKey(out)).not.toBeNull();
  });

  it('buckets GPS jitter within ~110 m together', () => {
    const a = drive({ startLat: 37.1001, startLon: -122.1002 });
    const b = drive({ startLat: 37.1004, startLon: -122.0998 });
    expect(corridorKey(a)).toBe(corridorKey(b));
  });

  it('separates genuinely different destinations', () => {
    const office = drive({ endLat: 37.2, endLon: -122.2 });
    const gym = drive({ endLat: 37.9, endLon: -122.9 });
    expect(corridorKey(office)).not.toBe(corridorKey(gym));
  });

  it('falls back to normalised addresses when coordinates are missing', () => {
    const a = drive({ startLat: null, startLon: null, startAddress: ' Home ' });
    const b = drive({ startLat: null, startLon: null, startAddress: 'home' });
    expect(corridorKey(a)).toBe(corridorKey(b));
  });

  it('returns null when an endpoint has neither coordinates nor address', () => {
    const d = drive({ startLat: null, startLon: null, startAddress: null });
    expect(corridorKey(d)).toBeNull();
    const blank = drive({ endLat: null, endLon: null, endAddress: '   ' });
    expect(corridorKey(blank)).toBeNull();
  });
});

/* ── driveAmount ─────────────────────────────────────────────────── */

describe('driveAmount', () => {
  it('computes km × rate in major units', () => {
    expect(driveAmount(10_000, 'business', RATES)).toBeCloseTo(5);
    expect(driveAmount(10_000, 'commute', RATES)).toBeCloseTo(2);
  });

  it('returns 0 for zero-rate categories and degenerate inputs', () => {
    expect(driveAmount(10_000, 'personal', RATES)).toBe(0);
    expect(driveAmount(0, 'business', RATES)).toBe(0);
    expect(driveAmount(-5, 'business', RATES)).toBe(0);
    expect(driveAmount(NaN, 'business', RATES)).toBe(0);
  });
});

/* ── summarizeLogbook ────────────────────────────────────────────── */

describe('summarizeLogbook', () => {
  it('splits totals across categories and the unclassified bucket', () => {
    const d1 = drive({ distanceM: 10_000 });
    const d2 = drive({ distanceM: 20_000 });
    const d3 = drive({ distanceM: 5_000 });
    const d4 = drive({ distanceM: 7_000 });
    const categories: CategoryMap = { [d1.id]: 'business', [d2.id]: 'business', [d3.id]: 'commute' };

    const s = summarizeLogbook([d1, d2, d3, d4], categories, RATES);

    expect(s.perCategory.business).toEqual({ count: 2, distanceM: 30_000, amount: 15 });
    expect(s.perCategory.commute).toEqual({ count: 1, distanceM: 5_000, amount: 1 });
    expect(s.perCategory.personal.count).toBe(0);
    expect(s.unclassified).toEqual({ count: 1, distanceM: 7_000 });
    expect(s.totalCount).toBe(4);
    expect(s.totalDistanceM).toBe(42_000);
    expect(s.totalAmount).toBeCloseTo(16);
  });

  it('handles an empty drive list', () => {
    const s = summarizeLogbook([], {}, RATES);
    expect(s.totalCount).toBe(0);
    expect(s.totalDistanceM).toBe(0);
    expect(s.totalAmount).toBe(0);
    expect(s.unclassified.count).toBe(0);
  });
});

/* ── suggestByCorridor ───────────────────────────────────────────── */

describe('suggestByCorridor', () => {
  const HOME = { startLat: 37.1, startLon: -122.1 };
  const WORK = { endLat: 37.2, endLon: -122.2 };

  it('suggests the corridor majority for unclassified drives, both directions', () => {
    const classified = drive({ ...HOME, ...WORK });
    const sameRoute = drive({ ...HOME, ...WORK });
    const returnLeg = drive({
      startLat: WORK.endLat, startLon: WORK.endLon,
      endLat: HOME.startLat, endLon: HOME.startLon,
    });
    const elsewhere = drive({ endLat: 38.5, endLon: -121.5 });
    const categories: CategoryMap = { [classified.id]: 'commute' };

    const suggestions = suggestByCorridor([classified, sameRoute, returnLeg, elsewhere], categories);

    expect(suggestions).toEqual([
      { driveId: sameRoute.id, category: 'commute' },
      { driveId: returnLeg.id, category: 'commute' },
    ]);
  });

  it('stays silent on tied corridors', () => {
    const asBusiness = drive({ ...HOME, ...WORK });
    const asPersonal = drive({ ...HOME, ...WORK });
    const unclassified = drive({ ...HOME, ...WORK });
    const categories: CategoryMap = {
      [asBusiness.id]: 'business',
      [asPersonal.id]: 'personal',
    };

    expect(suggestByCorridor([asBusiness, asPersonal, unclassified], categories)).toEqual([]);
  });

  it('breaks a tie once one category gains a strict majority', () => {
    const b1 = drive({ ...HOME, ...WORK });
    const b2 = drive({ ...HOME, ...WORK });
    const p1 = drive({ ...HOME, ...WORK });
    const unclassified = drive({ ...HOME, ...WORK });
    const categories: CategoryMap = { [b1.id]: 'business', [b2.id]: 'business', [p1.id]: 'personal' };

    expect(suggestByCorridor([b1, b2, p1, unclassified], categories)).toEqual([
      { driveId: unclassified.id, category: 'business' },
    ]);
  });

  it('never suggests for drives without a locatable corridor', () => {
    const classified = drive({ ...HOME, ...WORK });
    const unlocatable = drive({ startLat: null, startLon: null, startAddress: null });
    const categories: CategoryMap = { [classified.id]: 'business' };

    expect(suggestByCorridor([classified, unlocatable], categories)).toEqual([]);
  });
});

/* ── persistence ─────────────────────────────────────────────────── */

describe('parseLogbookStore', () => {
  it('round-trips a serialized store', () => {
    const store = {
      categories: { 1: 'business', 2: 'personal' } as CategoryMap,
      ratesPerKm: RATES,
    };
    expect(parseLogbookStore(serializeLogbookStore(store))).toEqual(store);
  });

  it('returns defaults for null, junk, and non-JSON input', () => {
    expect(parseLogbookStore(null)).toEqual(EMPTY_LOGBOOK_STORE);
    expect(parseLogbookStore('not json {')).toEqual(EMPTY_LOGBOOK_STORE);
    expect(parseLogbookStore('42')).toEqual(EMPTY_LOGBOOK_STORE);
  });

  it('drops unknown categories, non-integer ids, and bad rates', () => {
    const raw = JSON.stringify({
      categories: { 1: 'business', 2: 'vacation', abc: 'commute', 3.5: 'personal' },
      ratesPerKm: { business: -1, commute: Infinity, personal: 0.1, vacation: 9 },
    });
    const parsed = parseLogbookStore(raw);
    expect(parsed.categories).toEqual({ 1: 'business' });
    expect(parsed.ratesPerKm).toEqual({
      business: DEFAULT_RATES_PER_KM.business,
      commute: DEFAULT_RATES_PER_KM.commute,
      personal: 0.1,
    });
  });
});

describe('isTripCategory', () => {
  it('accepts the vocabulary and rejects everything else', () => {
    expect(isTripCategory('business')).toBe(true);
    expect(isTripCategory('commute')).toBe(true);
    expect(isTripCategory('personal')).toBe(true);
    expect(isTripCategory('vacation')).toBe(false);
    expect(isTripCategory(null)).toBe(false);
    expect(isTripCategory(1)).toBe(false);
  });
});
