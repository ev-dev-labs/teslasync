import { describe, it, expect } from 'vitest';
import { groupActivityByDay } from './helpers';
import type { ActivityItem } from '@/types/activity';

function item(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: 'drives:1',
    kind: 'drive',
    occurred_at: '2026-01-15T12:00:00Z',
    title: 'Drive',
    summary: '',
    status: 'completed',
    source_table: 'drives',
    source_id: 1,
    ...overrides,
  };
}

describe('groupActivityByDay', () => {
  it('buckets items sharing a UTC calendar day together', () => {
    const groups = groupActivityByDay(
      [
        item({ id: 'a', occurred_at: '2026-01-15T22:00:00Z' }),
        item({ id: 'b', occurred_at: '2026-01-15T08:00:00Z' }),
        item({ id: 'c', occurred_at: '2026-01-14T10:00:00Z' }),
      ],
      'UTC',
    );
    expect(groups).toHaveLength(2);
    expect(groups[0].dayKey).toBe('2026-01-15');
    expect(groups[0].items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(groups[1].dayKey).toBe('2026-01-14');
    expect(groups[1].items.map((i) => i.id)).toEqual(['c']);
  });

  it('preserves within-day and across-day order from the input list', () => {
    const groups = groupActivityByDay(
      [
        item({ id: 'first', occurred_at: '2026-01-15T23:00:00Z' }),
        item({ id: 'second', occurred_at: '2026-01-15T01:00:00Z' }),
        item({ id: 'third', occurred_at: '2026-01-13T12:00:00Z' }),
      ],
      'UTC',
    );
    expect(groups.map((g) => g.dayKey)).toEqual(['2026-01-15', '2026-01-13']);
    expect(groups[0].items.map((i) => i.id)).toEqual(['first', 'second']);
  });

  it('produces a friendly long-form label for each day key', () => {
    const groups = groupActivityByDay([item({ occurred_at: '2026-03-04T12:00:00Z' })], 'UTC');
    expect(groups[0].label).toBe('Mar 4, 2026');
  });

  it('returns an empty array for an empty item list', () => {
    expect(groupActivityByDay([], 'UTC')).toEqual([]);
  });

  it('falls back to a placeholder bucket for an unparsable occurred_at', () => {
    const groups = groupActivityByDay([item({ occurred_at: 'not-a-date' })], 'UTC');
    expect(groups).toHaveLength(1);
    expect(groups[0].dayKey).toBe('unknown');
    expect(groups[0].label).toBe('—');
  });

  it('groups by the requested IANA timezone rather than always UTC', () => {
    // 2026-01-01T02:00:00Z is still 2025-12-31 in America/Los_Angeles (UTC-8 in Jan).
    const groups = groupActivityByDay(
      [item({ occurred_at: '2026-01-01T02:00:00Z' })],
      'America/Los_Angeles',
    );
    expect(groups[0].dayKey).toBe('2025-12-31');
  });

  it.each([
    ['de-DE', '31. Dez. 2025'],
    ['fr-FR', '31 déc. 2025'],
    ['en-US', 'Dec 31, 2025'],
  ])('uses selected locale %s for labels without shifting timezone-defined day keys', (locale, label) => {
    const original = Object.freeze(item({ occurred_at: '2026-01-01T02:00:00Z' }));
    const groups = groupActivityByDay(Object.freeze([original]), 'America/Los_Angeles', locale);
    expect(groups[0].dayKey).toBe('2025-12-31');
    expect(groups[0].label).toBe(label);
    expect(groups[0].items[0]).toBe(original);
  });

  it('keeps unknown and valid buckets in input order with selected locale', () => {
    const events = [
      item({ id: 'invalid', occurred_at: 'not-a-date' }),
      item({ id: 'valid', occurred_at: '2026-01-15T12:00:00Z' }),
      item({ id: 'invalid-again', occurred_at: '' }),
    ];
    const groups = groupActivityByDay(events, 'UTC', 'de-DE');
    expect(groups.map((group) => group.dayKey)).toEqual(['unknown', '2026-01-15']);
    expect(groups.map((group) => group.label)).toEqual(['—', '15. Jan. 2026']);
    expect(groups[0].items.map((event) => event.id)).toEqual(['invalid', 'invalid-again']);
  });
});
