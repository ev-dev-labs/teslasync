import { describe, it, expect } from 'vitest';

import type { UserActivityEntry } from '@/types/admin';
import { deriveMyActivityAnalytics, OTHER_CATEGORY } from './myActivityAnalytics';

// ── Timezone-robust fixtures ────────────────────────────────────────────────
// The module derives day keys via `ymdInTz(date)` and hour buckets via
// `date.getHours()` — both in the *local* zone. Building timestamps from local
// Date components (then serialising to ISO) means the instant round-trips back
// to the same wall-clock day/hour regardless of the runner's TZ, so the
// assertions below stay deterministic on any machine.

/** Local `YYYY-MM-DD` calendar key (mirrors the page's `isoDate`). */
function dayKey(y: number, mIdx: number, d: number): string {
  return `${y}-${String(mIdx + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** ISO timestamp for a local wall-clock time (month is 0-based, like `Date`). */
function at(y: number, mIdx: number, d: number, h = 12, min = 0): string {
  return new Date(y, mIdx, d, h, min, 0, 0).toISOString();
}

let nextId = 1;
function entry(overrides: Partial<UserActivityEntry> = {}): UserActivityEntry {
  return {
    id: nextId++,
    ts: at(2026, 3, 4, 12, 0),
    action: 'auth.login',
    entity_type: null,
    entity_id: null,
    detail: null,
    ip: null,
    user_agent: null,
    ...overrides,
  };
}

// April 1–5, 2026 (5 inclusive days) used as the canonical window.
const range5 = { start: dayKey(2026, 3, 1), end: dayKey(2026, 3, 5) };

describe('deriveMyActivityAnalytics', () => {
  it('exposes a stable OTHER_CATEGORY sentinel', () => {
    expect(OTHER_CATEGORY).toBe('__other__');
  });

  it('returns a zeroed, gap-filled shape for empty input', () => {
    const r = deriveMyActivityAnalytics([], range5);

    expect(r.kpis).toEqual({
      total: 0,
      activeDays: 0,
      actionTypes: 0,
      entitiesTouched: 0,
      lastActivityTs: null,
    });
    expect(r.topActions).toEqual([]);
    expect(r.byCategory).toEqual([]);

    // The trend still spans the whole selected window, every day at zero.
    expect(r.dailyTrend).toHaveLength(5);
    expect(r.dailyTrend.every((p) => p.count === 0)).toBe(true);

    // 24 zero-filled, zero-padded hour buckets.
    expect(r.byHour).toHaveLength(24);
    expect(r.byHour[0].label).toBe('00');
    expect(r.byHour[23].label).toBe('23');
    expect(r.byHour.every((h) => h.count === 0)).toBe(true);
  });

  it('treats null and undefined entries like an empty array', () => {
    const fromNull = deriveMyActivityAnalytics(null, range5);
    const fromUndef = deriveMyActivityAnalytics(undefined, range5);

    expect(fromNull.kpis.total).toBe(0);
    expect(fromUndef.kpis.total).toBe(0);
    expect(fromNull.dailyTrend).toHaveLength(5);
    expect(fromUndef.byHour).toHaveLength(24);
  });

  it('aggregates KPI totals across days, actions, and entities', () => {
    const entries = [
      entry({ ts: at(2026, 3, 1, 9, 0), action: 'auth.login', entity_type: 'vehicle', entity_id: '1' }),
      entry({ ts: at(2026, 3, 1, 10, 0), action: 'vehicle.command.wake', entity_type: 'vehicle', entity_id: '1' }),
      entry({ ts: at(2026, 3, 2, 11, 0), action: 'auth.login', entity_type: 'charging_session', entity_id: '7' }),
    ];

    const r = deriveMyActivityAnalytics(entries, range5);

    expect(r.kpis.total).toBe(3);
    expect(r.kpis.activeDays).toBe(2); // Apr 1 + Apr 2
    expect(r.kpis.actionTypes).toBe(2); // auth.login, vehicle.command.wake
    expect(r.kpis.entitiesTouched).toBe(2); // vehicle:1 deduped, charging_session:7
    expect(r.kpis.lastActivityTs).toBe(entries[2].ts); // newest instant wins
  });

  it('gap-fills the daily trend and counts entries per local day', () => {
    const entries = [
      entry({ ts: at(2026, 3, 1, 8, 0) }),
      entry({ ts: at(2026, 3, 1, 9, 0) }),
      entry({ ts: at(2026, 3, 3, 9, 0) }),
    ];

    const r = deriveMyActivityAnalytics(entries, range5);

    expect(r.dailyTrend.map((p) => p.day)).toEqual([
      '2026-04-01',
      '2026-04-02',
      '2026-04-03',
      '2026-04-04',
      '2026-04-05',
    ]);
    expect(r.dailyTrend.map((p) => p.count)).toEqual([2, 0, 1, 0, 0]);

    // Labels are humanised (formatted, non-empty, and not the raw ISO key).
    const apr3 = r.dailyTrend[2];
    expect(apr3.label.length).toBeGreaterThan(0);
    expect(apr3.label).not.toBe(apr3.day);
  });

  it('returns an empty trend for an inverted or malformed range but still computes KPIs', () => {
    const entries = [entry({ ts: at(2026, 3, 2, 9, 0), action: 'auth.login' })];

    const inverted = deriveMyActivityAnalytics(entries, { start: '2026-04-05', end: '2026-04-01' });
    expect(inverted.dailyTrend).toEqual([]);
    expect(inverted.kpis.total).toBe(1);

    const malformed = deriveMyActivityAnalytics(entries, { start: 'nope', end: 'also-nope' });
    expect(malformed.dailyTrend).toEqual([]);
    expect(malformed.kpis.actionTypes).toBe(1);
  });

  it('does not throw when the range is missing', () => {
    const entries = [entry({ action: 'auth.login' })];

    expect(() => deriveMyActivityAnalytics(entries, null)).not.toThrow();

    const r = deriveMyActivityAnalytics(entries, undefined);
    expect(r.dailyTrend).toEqual([]);
    expect(r.kpis.total).toBe(1);
  });

  it('caps the daily trend at MAX_TREND_DAYS for oversized ranges', () => {
    const r = deriveMyActivityAnalytics([], { start: '2020-01-01', end: '2025-01-01' });

    expect(r.dailyTrend).toHaveLength(366);
    expect(r.dailyTrend[0].day).toBe('2020-01-01');
  });

  it('ranks the top actions with percent, palette colour, and i18n metadata', () => {
    const entries = [
      ...Array.from({ length: 5 }, () => entry({ action: 'vehicle.command.wake' })),
      ...Array.from({ length: 3 }, () => entry({ action: 'auth.login' })),
      ...Array.from({ length: 2 }, () => entry({ action: 'settings.update' })),
      entry({ action: 'a.x' }),
      entry({ action: 'b.x' }),
      entry({ action: 'c.x' }),
      entry({ action: 'd.x' }),
    ];

    const r = deriveMyActivityAnalytics(entries, range5);

    // 7 distinct actions, capped at 6, ranked by descending count.
    expect(r.topActions).toHaveLength(6);
    const counts = r.topActions.map((s) => s.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));

    const top = r.topActions[0];
    expect(top.key).toBe('vehicle.command.wake');
    expect(top.count).toBe(5);
    expect(top.percent).toBeCloseTo((5 / 14) * 100, 5); // 14 total entries
    expect(top.color).toBe('#3b82f6'); // first series colour
    expect(top.label).toBe('Wake vehicle');
    expect(top.i18nKey).toBe('activity.action.vehicleCommandWake');
    expect(top.fallback).toBe('Wake vehicle');
  });

  it('ranks categories, humanises labels, and buckets null entity types as other', () => {
    const entries = [
      ...Array.from({ length: 4 }, () => entry({ entity_type: 'charging_session', entity_id: '1' })),
      ...Array.from({ length: 2 }, () => entry({ entity_type: 'vehicle', entity_id: '2' })),
      entry({ entity_type: null }),
      entry({ entity_type: null }),
      entry({ entity_type: null }),
    ];

    const r = deriveMyActivityAnalytics(entries, range5);

    expect(r.byCategory.map((s) => s.key)).toEqual(['charging_session', OTHER_CATEGORY, 'vehicle']);

    const charging = r.byCategory[0];
    expect(charging.label).toBe('Charging session'); // snake_case humanised
    expect(charging.count).toBe(4);
    expect(charging.percent).toBeCloseTo((4 / 9) * 100, 5);

    const other = r.byCategory[1];
    expect(other.i18nKey).toBe('activity.myActivity.byCategory.other');
    expect(other.fallback).toBe('System / other');
    expect(other.label).toBe('');
  });

  it('normalises blank and whitespace-only entity types into the other bucket', () => {
    const entries = [
      entry({ entity_type: '', entity_id: 'a' }),
      entry({ entity_type: '   ', entity_id: 'b' }),
      entry({ entity_type: null, entity_id: null }),
      entry({ entity_type: 'vehicle', entity_id: '9' }),
    ];

    const r = deriveMyActivityAnalytics(entries, range5);

    // Blank, whitespace, and null all collapse into a single "other" slice.
    const otherSlices = r.byCategory.filter((s) => s.key === OTHER_CATEGORY);
    expect(otherSlices).toHaveLength(1);
    expect(otherSlices[0].count).toBe(3);

    // No label-less slice keyed on an empty/whitespace string sneaks through.
    expect(r.byCategory.some((s) => s.key.trim() === '')).toBe(false);

    // Blank/whitespace entity types are not counted as distinct touched entities.
    expect(r.kpis.entitiesTouched).toBe(1); // only vehicle:9
  });

  it('bins entries into 24 local-hour buckets with padded labels', () => {
    const entries = [
      entry({ ts: at(2026, 3, 4, 9, 0) }),
      entry({ ts: at(2026, 3, 4, 9, 30) }),
      entry({ ts: at(2026, 3, 4, 23, 15) }),
    ];

    const r = deriveMyActivityAnalytics(entries, range5);

    expect(r.byHour).toHaveLength(24);
    expect(r.byHour[9].count).toBe(2);
    expect(r.byHour[23].count).toBe(1);
    expect(r.byHour[0].count).toBe(0);
    expect(r.byHour[9].label).toBe('09');
    expect(r.byHour[23].hour).toBe(23);
  });

  it('ignores unparseable timestamps for time-based metrics but still counts them overall', () => {
    const entries = [
      entry({ ts: '', action: 'auth.login', entity_type: 'vehicle', entity_id: '1' }),
      entry({ ts: 'not-a-date', action: 'settings.update' }),
      entry({ ts: at(2026, 3, 2, 10, 0), action: 'auth.logout' }),
    ];

    const r = deriveMyActivityAnalytics(entries, range5);

    expect(r.kpis.total).toBe(3); // every entry counts toward the total
    expect(r.kpis.actionTypes).toBe(3);
    expect(r.kpis.activeDays).toBe(1); // only the valid-timestamp entry
    expect(r.kpis.lastActivityTs).toBe(entries[2].ts);
    expect(r.byHour.reduce((sum, h) => sum + h.count, 0)).toBe(1);
  });

  it('collapses blank or missing actions into a single "unknown" action', () => {
    const entries = [entry({ action: '   ' }), entry({ action: '' })];

    const r = deriveMyActivityAnalytics(entries, range5);

    expect(r.kpis.actionTypes).toBe(1);
    const slice = r.topActions.find((s) => s.key === 'unknown');
    expect(slice).toBeDefined();
    expect(slice?.count).toBe(2);
    // The unknown action resolves to the generic fallback visual descriptor.
    expect(slice?.i18nKey).toBe('activity.action.unknown');
    expect(slice?.fallback).toBe('Activity');
  });
});
