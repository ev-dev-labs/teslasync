/**
 * Check-in outbox: localStorage-backed queue for trail points tapped
 * while offline. Entries replay with their original `recorded_at`,
 * which the server accepts (only future timestamps reject) and
 * dedupes idempotently on (session_id, recorded_at) — a double flush
 * is harmless.
 *
 * Corrupt storage degrades to an empty queue, never a throw.
 */

export interface QueuedCheckIn {
  session_id: number;
  recorded_at: string;
}

const STORAGE_KEY = 'teslasync.journey.checkin-outbox';

/** Cap: a dead zone longer than 50 taps keeps the newest 50. */
const MAX_QUEUED = 50;

function isEntry(value: unknown): value is QueuedCheckIn {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return typeof e.session_id === 'number' && typeof e.recorded_at === 'string';
}

function readRaw(): QueuedCheckIn[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null || raw === '') return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry);
  } catch {
    return [];
  }
}

function writeRaw(entries: QueuedCheckIn[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage full or unavailable: the queue stays in memory for this
    // session via the hook state. Never throw from a queue write.
  }
}

/** Loads every queued entry, oldest first. */
export function loadOutbox(): QueuedCheckIn[] {
  return readRaw();
}

/** Queues one entry; identical (session, instant) pairs queue once. */
export function enqueueCheckIn(entry: QueuedCheckIn): QueuedCheckIn[] {
  const queue = readRaw();
  const dup = queue.some(
    (e) => e.session_id === entry.session_id && e.recorded_at === entry.recorded_at,
  );
  if (!dup) queue.push(entry);
  while (queue.length > MAX_QUEUED) queue.shift();
  writeRaw(queue);
  return queue;
}

/** Drops one entry after a successful replay. */
export function dequeueCheckIn(sessionId: number, recordedAt: string): QueuedCheckIn[] {
  const queue = readRaw().filter(
    (e) => !(e.session_id === sessionId && e.recorded_at === recordedAt),
  );
  writeRaw(queue);
  return queue;
}

/** Loads the queued entries for one session, oldest first. */
export function outboxFor(sessionId: number): QueuedCheckIn[] {
  return readRaw().filter((e) => e.session_id === sessionId);
}
