import { describe, it, expect } from 'vitest';
import {
  addDaysYmd,
  categoryOf,
  eventAccent,
  eventHref,
  eventKeywords,
  formatTimeSeconds,
  hourKeyInTz,
  isValidYmd,
} from './daylog';
import type { DayLogEvent } from '@/api/types';

describe('daylog lib', () => {
  it('validates calendar days without Date parsing', () => {
    expect(isValidYmd('2026-09-14')).toBe(true);
    expect(isValidYmd('2026-02-30')).toBe(false);
    expect(isValidYmd('14-09-2026')).toBe(false);
    expect(isValidYmd('2026-13-01')).toBe(false);
    expect(isValidYmd('')).toBe(false);
  });

  it('shifts days across month boundaries', () => {
    expect(addDaysYmd('2026-09-14', -1)).toBe('2026-09-13');
    expect(addDaysYmd('2026-09-14', 1)).toBe('2026-09-15');
    expect(addDaysYmd('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysYmd('nope', 1)).toBeNull();
  });

  it('formats seconds in the queried timezone', () => {
    expect(formatTimeSeconds('2026-09-14T15:04:05Z', 'UTC')).toBe('15:04:05');
    expect(formatTimeSeconds('2026-09-14T15:04:05Z', 'America/Los_Angeles')).toBe('08:04:05');
    expect(formatTimeSeconds('not-a-time', 'UTC')).toBe('not-a-time');
  });

  it('buckets hours in the queried timezone', () => {
    expect(hourKeyInTz('2026-09-14T15:04:05Z', 'UTC')).toBe('15');
    expect(hourKeyInTz('2026-09-14T15:04:05Z', 'America/Los_Angeles')).toBe('08');
    expect(hourKeyInTz('junk', 'UTC')).toBe('');
  });

  it('maps types to categories with an other fallback', () => {
    expect(categoryOf('drive_start')).toBe('driving');
    expect(categoryOf('turn_signal')).toBe('turn');
    expect(categoryOf('gear')).toBe('gear');
    expect(categoryOf('something_from_the_future')).toBe('other');
  });

  it('deep-links ref events and rejects the rest', () => {
    const base = { id: 'x', ts: '', type: '', layer: '', source: '', vehicle_id: 1, payload: {} };
    expect(eventHref({ ...base, ref_kind: 'drive', ref_id: 7 })).toBe('/drives/7');
    expect(eventHref({ ...base, ref_kind: 'charge', ref_id: 9 })).toBe('/charging/9');
    expect(eventHref({ ...base, ref_kind: 'drive', ref_id: null })).toBeNull();
    expect(eventHref({ ...base, ref_kind: 'starship', ref_id: 1 })).toBeNull();
    expect(eventHref({ ...base, ref_kind: 'drive', ref_id: 0 })).toBeNull();
  });

  it('falls back to neutral styling for unknown types', () => {
    expect(eventAccent('drive_start')).toBe('#0891b2');
    expect(eventAccent('nope')).toBe('#94a3b8');
  });

  it('builds lowercase keyword haystacks', () => {
    const hay = eventKeywords({
      id: 'x',
      ts: '',
      type: 'door_open',
      layer: 'doors_windows',
      source: 'signal_log',
      vehicle_id: 1,
      payload: { door: 'driver_front', from: false, to: true },
    } as DayLogEvent);
    expect(hay).toContain('door_open');
    expect(hay).toContain('driver_front');
    expect(hay).toContain('signal_log');
    expect(hay).toBe(hay.toLowerCase());
  });
});
