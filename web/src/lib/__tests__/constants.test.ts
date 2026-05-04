import { describe, expect, it } from 'vitest';
import { matchTimeRangePreset, TIME_RANGE_PRESETS } from '../constants';

describe('matchTimeRangePreset', () => {
  it.each(TIME_RANGE_PRESETS.map((p) => p))('matches preset %o', (p) => {
    const end = new Date('2025-01-15T12:00:00Z');
    const start = new Date(end.getTime() - p.hours * 3600_000);
    expect(matchTimeRangePreset(start.toISOString(), end.toISOString())).toBe(p.hours);
  });

  it('returns null for non-matching ranges', () => {
    expect(
      matchTimeRangePreset('2025-01-15T00:00:00Z', '2025-01-15T03:30:00Z'),
    ).toBeNull();
  });

  it('honours tolerance for off-by-seconds drift', () => {
    const end = new Date('2025-01-15T12:00:00Z');
    // 1h + 30s drift — within ±60s tolerance
    const start = new Date(end.getTime() - 3600_000 - 30_000);
    expect(matchTimeRangePreset(start.toISOString(), end.toISOString())).toBe(1);
  });

  it('rejects drifts beyond tolerance', () => {
    const end = new Date('2025-01-15T12:00:00Z');
    // 1h + 5min drift — well outside ±60s
    const start = new Date(end.getTime() - 3600_000 - 5 * 60_000);
    expect(matchTimeRangePreset(start.toISOString(), end.toISOString())).toBeNull();
  });

  it('honours custom tolerance arg', () => {
    const end = new Date('2025-01-15T12:00:00Z');
    const start = new Date(end.getTime() - 3600_000 - 5 * 60_000);
    // With a generous tolerance, 1h + 5min still matches the 1h preset.
    expect(
      matchTimeRangePreset(start.toISOString(), end.toISOString(), 10 * 60_000),
    ).toBe(1);
  });

  it('returns null on empty input', () => {
    expect(matchTimeRangePreset('', '')).toBeNull();
    expect(matchTimeRangePreset('', '2025-01-15T00:00:00Z')).toBeNull();
    expect(matchTimeRangePreset('2025-01-15T00:00:00Z', '')).toBeNull();
  });

  it('returns null on invalid date strings', () => {
    expect(
      matchTimeRangePreset('not-a-date', '2025-01-15T00:00:00Z'),
    ).toBeNull();
    expect(
      matchTimeRangePreset('2025-01-15T00:00:00Z', 'also-not-a-date'),
    ).toBeNull();
  });
});
