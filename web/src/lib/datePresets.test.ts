import { describe, it, expect } from 'vitest';
import { DATE_PRESETS, DEFAULT_PRESET_IDS, getDatePreset, matchPresetId } from './datePresets';

// Fixed reference: Friday 2026-05-15 (May = month index 4, Q2 starts at month 3 = April).
const NOW = new Date(2026, 4, 15, 14, 30, 0);

function preset(id: string) {
  const p = DATE_PRESETS.find(x => x.id === id);
  if (!p) throw new Error(`unknown preset: ${id}`);
  return p;
}

describe('DATE_PRESETS — resolve()', () => {
  it('today → start=end=now (local date)', () => {
    expect(preset('today').resolve(NOW)).toEqual({ start: '2026-05-15', end: '2026-05-15' });
  });

  it('live → today as the calendar compatibility window', () => {
    expect(preset('live').resolve(NOW)).toEqual({ start: '2026-05-15', end: '2026-05-15' });
  });

  it('24h → yesterday through today for calendar-only APIs', () => {
    expect(preset('24h').resolve(NOW)).toEqual({ start: '2026-05-14', end: '2026-05-15' });
  });

  it('yesterday → start=end=now-1', () => {
    expect(preset('yesterday').resolve(NOW)).toEqual({ start: '2026-05-14', end: '2026-05-14' });
  });

  it('7d → 6 days back through today (inclusive 7-day window)', () => {
    expect(preset('7d').resolve(NOW)).toEqual({ start: '2026-05-09', end: '2026-05-15' });
  });

  it('30d → 29 days back through today (inclusive 30-day window)', () => {
    expect(preset('30d').resolve(NOW)).toEqual({ start: '2026-04-16', end: '2026-05-15' });
  });

  it('90d → 89 days back through today (inclusive 90-day window)', () => {
    // 2026-05-15 minus 89 days = 2026-02-15
    expect(preset('90d').resolve(NOW)).toEqual({ start: '2026-02-15', end: '2026-05-15' });
  });

  it('mtd → first of current month through today', () => {
    expect(preset('mtd').resolve(NOW)).toEqual({ start: '2026-05-01', end: '2026-05-15' });
  });

  it('qtd → first of current quarter through today (Q2 starts April)', () => {
    expect(preset('qtd').resolve(NOW)).toEqual({ start: '2026-04-01', end: '2026-05-15' });
  });

  it('qtd → Q1 when in February', () => {
    const feb = new Date(2026, 1, 10);
    expect(preset('qtd').resolve(feb)).toEqual({ start: '2026-01-01', end: '2026-02-10' });
  });

  it('qtd → Q3 when in August', () => {
    const aug = new Date(2026, 7, 20);
    expect(preset('qtd').resolve(aug)).toEqual({ start: '2026-07-01', end: '2026-08-20' });
  });

  it('qtd → Q4 when in November', () => {
    const nov = new Date(2026, 10, 5);
    expect(preset('qtd').resolve(nov)).toEqual({ start: '2026-10-01', end: '2026-11-05' });
  });

  it('ytd → Jan 1 of current year through today', () => {
    expect(preset('ytd').resolve(NOW)).toEqual({ start: '2026-01-01', end: '2026-05-15' });
  });

  it('lastMonth → first through last day of previous month', () => {
    // April 2026 has 30 days
    expect(preset('lastMonth').resolve(NOW)).toEqual({ start: '2026-04-01', end: '2026-04-30' });
  });

  it('lastMonth → handles year rollover (January → previous December)', () => {
    const jan = new Date(2026, 0, 10);
    expect(preset('lastMonth').resolve(jan)).toEqual({ start: '2025-12-01', end: '2025-12-31' });
  });

  it('lastMonth → February in leap year has 29 days', () => {
    // 2024 was a leap year; from March, lastMonth = Feb 1..29
    const mar = new Date(2024, 2, 5);
    expect(preset('lastMonth').resolve(mar)).toEqual({ start: '2024-02-01', end: '2024-02-29' });
  });

  it('1y → one calendar year back through today', () => {
    expect(preset('1y').resolve(NOW)).toEqual({ start: '2025-05-15', end: '2026-05-15' });
  });

  it('all → fixed 2015-01-01 floor through today', () => {
    expect(preset('all').resolve(NOW)).toEqual({ start: '2015-01-01', end: '2026-05-15' });
  });
});

describe('DATE_PRESETS — schema', () => {
  it('every preset has unique id', () => {
    const ids = DATE_PRESETS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every preset has i18nKey starting with date.preset.', () => {
    for (const p of DATE_PRESETS) {
      expect(p.i18nKey.startsWith('date.preset.')).toBe(true);
    }
  });

  it('every preset has non-empty fallback', () => {
    for (const p of DATE_PRESETS) {
      expect(p.fallback.length).toBeGreaterThan(0);
    }
  });

  it('DEFAULT_PRESET_IDS only references known preset ids', () => {
    const known = new Set(DATE_PRESETS.map(p => p.id));
    for (const id of DEFAULT_PRESET_IDS) {
      expect(known.has(id)).toBe(true);
    }
  });
});

describe('getDatePreset', () => {
  it('returns the preset for a known id', () => {
    expect(getDatePreset('today')?.id).toBe('today');
    expect(getDatePreset('mtd')?.fallback).toBe('Month to date');
  });

  it('returns undefined for an unknown id', () => {
    expect(getDatePreset('not-a-real-preset')).toBeUndefined();
  });
});

describe('matchPresetId', () => {
  it('returns id when range matches a preset exactly', () => {
    expect(matchPresetId('2026-05-15', '2026-05-15', NOW)).toBe('today');
    expect(matchPresetId('2026-05-09', '2026-05-15', NOW)).toBe('7d');
    expect(matchPresetId('2026-05-01', '2026-05-15', NOW)).toBe('mtd');
    expect(matchPresetId('2026-04-01', '2026-04-30', NOW)).toBe('lastMonth');
    expect(matchPresetId('2015-01-01', '2026-05-15', NOW)).toBe('all');
  });

  it('returns undefined for an arbitrary range that no preset produces', () => {
    expect(matchPresetId('2026-03-07', '2026-04-12', NOW)).toBeUndefined();
  });

  it('does not infer rolling scopes from ambiguous calendar dates', () => {
    expect(matchPresetId('2026-05-14', '2026-05-15', NOW)).toBeUndefined();
  });
});
