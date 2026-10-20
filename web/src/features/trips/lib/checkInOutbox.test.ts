import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
let {
  loadOutbox,
  enqueueCheckIn,
  dequeueCheckIn,
  outboxFor,
} = await import('./checkInOutbox');

beforeEach(async () => {
  vi.resetModules();
  ({ loadOutbox, enqueueCheckIn, dequeueCheckIn, outboxFor } = await import('./checkInOutbox'));
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('checkInOutbox', () => {
  it('returns the successful persistence result', () => {
    const entry = { session_id: 1, recorded_at: '2026-09-14T10:00:00.000Z' };
    expect(enqueueCheckIn(entry)).toEqual({ queue: [entry], persisted: true });
    expect(dequeueCheckIn(entry.session_id, entry.recorded_at)).toEqual({
      queue: [],
      persisted: true,
    });
  });

  it('retains populated queues, identity, order and deduplication when writes fail', () => {
    const first = { session_id: 1, recorded_at: '2026-09-14T10:00:00.000Z' };
    const second = { session_id: 2, recorded_at: '2026-09-14T10:01:00.000Z' };
    enqueueCheckIn(first);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage full', 'QuotaExceededError');
    });
    expect(enqueueCheckIn(second)).toEqual({ queue: [first, second], persisted: false });
    expect(enqueueCheckIn(second)).toEqual({ queue: [first, second], persisted: false });
    expect(loadOutbox()).toEqual([first, second]);
    expect(outboxFor(2)).toEqual([second]);
    expect(dequeueCheckIn(first.session_id, first.recorded_at)).toEqual({
      queue: [second],
      persisted: false,
    });
    expect(loadOutbox()).toEqual([second]);
    vi.restoreAllMocks();
    expect(enqueueCheckIn(second)).toEqual({ queue: [second], persisted: true });
    expect(loadOutbox()).toEqual([second]);
  });

  it('keeps the newest 50 memory-only entries when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError');
    });
    for (let i = 0; i < 55; i++) {
      expect(enqueueCheckIn({ session_id: 1, recorded_at: String(i) }).persisted).toBe(false);
    }
    expect(outboxFor(1)).toHaveLength(50);
    expect(outboxFor(1)[0].recorded_at).toBe('5');
    expect(outboxFor(1)[49].recorded_at).toBe('54');
  });

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
