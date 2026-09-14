import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadOutbox,
  enqueueCheckIn,
  dequeueCheckIn,
  outboxFor,
} from './checkInOutbox';

beforeEach(() => {
  localStorage.clear();
});

describe('checkInOutbox', () => {
  it('round-trips entries per session', () => {
    enqueueCheckIn({ session_id: 1, recorded_at: '2026-09-14T10:00:00.000Z' });
    enqueueCheckIn({ session_id: 2, recorded_at: '2026-09-14T10:01:00.000Z' });
    expect(loadOutbox()).toHaveLength(2);
    expect(outboxFor(1)).toEqual([{ session_id: 1, recorded_at: '2026-09-14T10:00:00.000Z' }]);
    expect(outboxFor(9)).toEqual([]);
  });

  it('dedupes identical taps and dequeues on replay', () => {
    const entry = { session_id: 1, recorded_at: '2026-09-14T10:00:00.000Z' };
    enqueueCheckIn(entry);
    enqueueCheckIn(entry);
    expect(outboxFor(1)).toHaveLength(1);
    dequeueCheckIn(1, '2026-09-14T10:00:00.000Z');
    expect(loadOutbox()).toHaveLength(0);
  });

  it('caps the queue at the newest entries', () => {
    for (let i = 0; i < 55; i++) {
      enqueueCheckIn({ session_id: 1, recorded_at: `2026-09-14T10:${String(i).padStart(2, '0')}:00.000Z` });
    }
    const queue = loadOutbox();
    expect(queue).toHaveLength(50);
    expect(queue[0].recorded_at).toContain('10:05');
  });

  it('degrades corrupt storage to an empty queue', () => {
    localStorage.setItem('teslasync.journey.checkin-outbox', '{oops');
    expect(loadOutbox()).toEqual([]);
    expect(outboxFor(1)).toEqual([]);
    enqueueCheckIn({ session_id: 1, recorded_at: '2026-09-14T10:00:00.000Z' });
    expect(outboxFor(1)).toHaveLength(1);
  });

  it('drops malformed entries on read', () => {
    localStorage.setItem(
      'teslasync.journey.checkin-outbox',
      JSON.stringify([{ session_id: 1 }, { recorded_at: 'x' }, 'nope', null]),
    );
    expect(loadOutbox()).toEqual([]);
  });
});
