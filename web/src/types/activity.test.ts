// Type-contract tests for the unified activity timeline wire shape.
//
// There is no runtime projection function here (the backend already emits
// the exact shape the page renders), so coverage focuses on the two runtime
// exports — ACTIVITY_KINDS and ACTIVITY_KIND_LABELS — staying in lockstep
// with the ActivityKind union, plus a couple of typed fixtures that
// exercise the interface shapes through `tsc --noEmit`.

import { describe, it, expect } from 'vitest';
import { ACTIVITY_KINDS, ACTIVITY_KIND_LABELS } from './activity';
import type { ActivityItem, ActivityKind, ActivityListResponse } from './activity';

describe('ACTIVITY_KINDS', () => {
  it('enumerates exactly the five known domains with no duplicates', () => {
    expect(ACTIVITY_KINDS).toHaveLength(5);
    expect(new Set(ACTIVITY_KINDS).size).toBe(5);
  });

  it('matches the ActivityKind union exactly', () => {
    const expected: ActivityKind[] = [
      'drive',
      'charging',
      'alert',
      'software_update',
      'annotation',
    ];
    expect([...ACTIVITY_KINDS].sort()).toEqual([...expected].sort());
  });
});

describe('ACTIVITY_KIND_LABELS', () => {
  it('provides a non-empty label for every kind', () => {
    for (const kind of ACTIVITY_KINDS) {
      expect(ACTIVITY_KIND_LABELS[kind].length).toBeGreaterThan(0);
    }
  });

  it('shares the exact key set with ACTIVITY_KINDS', () => {
    expect(Object.keys(ACTIVITY_KIND_LABELS).sort()).toEqual([...ACTIVITY_KINDS].sort());
  });
});

describe('type contracts', () => {
  function makeItem(overrides: Partial<ActivityItem> = {}): ActivityItem {
    return {
      id: 'drives:1',
      kind: 'drive',
      occurred_at: '2026-01-01T00:00:00Z',
      vehicle_id: 7,
      title: 'Drive',
      summary: '12 min',
      status: 'completed',
      source_table: 'drives',
      source_id: 1,
      path: '/drives/1',
      duration_s: 720,
      start_soc_pct: 80,
      end_soc_pct: 76,
      ...overrides,
    };
  }

  it('accepts a fully populated item for every kind', () => {
    for (const kind of ACTIVITY_KINDS) {
      const item = makeItem({ kind });
      expect(ACTIVITY_KIND_LABELS[item.kind]).toBeDefined();
    }
  });

  it('allows the nullable fields to be absent, null, or populated', () => {
    const minimal = makeItem({ vehicle_id: null, severity: null, path: null });
    expect(minimal.vehicle_id).toBeNull();
    expect(minimal.path).toBeNull();

    const withoutOptionalKeys: ActivityItem = {
      id: 'chart_annotations:2',
      kind: 'annotation',
      occurred_at: '2026-02-01T00:00:00Z',
      title: 'Tire rotation',
      summary: 'Rotated all four',
      status: 'maintenance',
      source_table: 'chart_annotations',
      source_id: 2,
    };
    expect(withoutOptionalKeys.vehicle_id).toBeUndefined();
    expect(withoutOptionalKeys.energy_added_wh).toBeUndefined();
  });

  it('shapes a full ActivityListResponse envelope', () => {
    const response: ActivityListResponse = {
      items: [makeItem()],
      total: 1,
      limit: 50,
      offset: 0,
      generated_at: '2026-01-01T00:00:01Z',
    };
    expect(response.items).toHaveLength(1);
    expect(response.total).toBe(1);
  });
});
