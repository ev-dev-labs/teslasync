import { describe, it, expect } from 'vitest';
import { windowTransitions, nextWiderPreset } from '../windowTransitions';
import type { FSMTransition } from '@/types/fsm';

function makeTransition(overrides: Partial<FSMTransition>): FSMTransition {
  return {
    id: 1,
    vehicle_id: 1,
    fsm_name: 'vehicle',
    from_state: 'parked',
    to_state: 'driving',
    trigger: 'speed_changed',
    ts: '2025-01-15T12:00:00Z',
    ...overrides,
  };
}

describe('windowTransitions', () => {
  const anchor = new Date('2025-01-15T12:00:00Z');

  it('returns empty buckets and null last for empty input', () => {
    const r = windowTransitions([], 10, anchor);
    expect(r.inWindow).toEqual([]);
    expect(r.outsideWindow).toEqual([]);
    expect(r.lastTransition).toBeNull();
    expect(r.anchor).toBe(anchor);
    expect(r.minutes).toBe(10);
  });

  it('splits transitions inside vs outside the 10-minute window', () => {
    const inside = makeTransition({ id: 11, ts: '2025-01-15T11:55:00Z' });
    const outside = makeTransition({ id: 22, ts: '2025-01-15T10:00:00Z' });
    const r = windowTransitions([inside, outside], 10, anchor);
    expect(r.inWindow).toEqual([inside]);
    expect(r.outsideWindow).toEqual([outside]);
  });

  it('returns the chronologically newest transition as lastTransition regardless of bucket', () => {
    const oldest = makeTransition({ id: 1, ts: '2025-01-15T08:00:00Z' });
    const newest = makeTransition({ id: 2, ts: '2025-01-15T11:30:00Z' }); // outside 10-min window
    const middle = makeTransition({ id: 3, ts: '2025-01-15T09:00:00Z' });
    const r = windowTransitions([oldest, newest, middle], 10, anchor);
    expect(r.lastTransition).toEqual(newest);
    expect(r.inWindow).toEqual([]);
    expect(r.outsideWindow.map((t) => t.id)).toEqual([1, 3, 2]);
  });

  it('sorts both buckets ascending by created_at even when input is shuffled', () => {
    const a1 = makeTransition({ id: 1, ts: '2025-01-15T11:58:00Z' });
    const a2 = makeTransition({ id: 2, ts: '2025-01-15T11:55:00Z' });
    const a3 = makeTransition({ id: 3, ts: '2025-01-15T11:53:00Z' });
    const r = windowTransitions([a1, a2, a3], 10, anchor);
    expect(r.inWindow.map((t) => t.id)).toEqual([3, 2, 1]);
  });

  it('skips transitions with non-finite timestamps without throwing', () => {
    const good = makeTransition({ id: 1, ts: '2025-01-15T11:55:00Z' });
    const bad = makeTransition({ id: 99, ts: 'not a date' });
    const r = windowTransitions([good, bad], 10, anchor);
    expect(r.inWindow).toEqual([good]);
    expect(r.outsideWindow).toEqual([]);
    expect(r.lastTransition).toEqual(good);
  });

  it('defaults the anchor to now when omitted', () => {
    const before = Date.now();
    const r = windowTransitions([], 10);
    const after = Date.now();
    expect(r.anchor.getTime()).toBeGreaterThanOrEqual(before);
    expect(r.anchor.getTime()).toBeLessThanOrEqual(after);
  });
});

describe('nextWiderPreset', () => {
  const anchor = new Date('2025-01-15T12:00:00Z');

  it('returns 30 when current is 10 and gap is 20 min', () => {
    const lastTs = anchor.getTime() - 20 * 60_000;
    expect(nextWiderPreset(lastTs, anchor, 10)).toBe(30);
  });

  it('returns 120 when current is 10 and gap is 90 min', () => {
    const lastTs = anchor.getTime() - 90 * 60_000;
    expect(nextWiderPreset(lastTs, anchor, 10)).toBe(120);
  });

  it('returns 360 when current is 120 and gap is 200 min', () => {
    const lastTs = anchor.getTime() - 200 * 60_000;
    expect(nextWiderPreset(lastTs, anchor, 120)).toBe(360);
  });

  it('returns 1440 (24 h) when current is 360 and gap is 10 hours', () => {
    const lastTs = anchor.getTime() - 10 * 60 * 60_000;
    expect(nextWiderPreset(lastTs, anchor, 360)).toBe(1440);
  });

  it('returns null when the gap exceeds the largest preset (24 h)', () => {
    const lastTs = anchor.getTime() - 25 * 60 * 60_000; // 25 h ago
    expect(nextWiderPreset(lastTs, anchor, 10)).toBeNull();
  });

  it('returns null when the gap is negative (lastTs is in the future)', () => {
    const lastTs = anchor.getTime() + 60_000;
    expect(nextWiderPreset(lastTs, anchor, 10)).toBeNull();
  });

  it('returns null when lastTs is non-finite', () => {
    expect(nextWiderPreset(Number.NaN, anchor, 10)).toBeNull();
    expect(nextWiderPreset(-Infinity, anchor, 10)).toBeNull();
  });

  it('skips presets equal to or smaller than current', () => {
    // Gap of 4 minutes — current=10, smallest *wider* is 30, not 5.
    const lastTs = anchor.getTime() - 4 * 60_000;
    expect(nextWiderPreset(lastTs, anchor, 10)).toBe(30);
  });
});
