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
});
