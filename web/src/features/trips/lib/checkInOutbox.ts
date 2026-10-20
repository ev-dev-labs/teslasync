/**
 * Check-in outbox: localStorage-backed queue for trail points tapped
 * while offline. Entries replay with their original `recorded_at`,
 * which the server accepts (only future timestamps reject) and
 * dedupes idempotently on (session_id, recorded_at) — a double flush
 * is harmless.
 *
 * Corrupt storage degrades to an empty queue, never a throw. Failed
 * writes retain the queue in this page's memory, not across reloads.
 */

export interface QueuedCheckIn {
  session_id: number;
  recorded_at: string;
}

export interface OutboxWriteResult {
  queue: QueuedCheckIn[];
  persisted: boolean;
}

const STORAGE_KEY = 'teslasync.journey.checkin-outbox';
let memoryQueue: QueuedCheckIn[] | null = null;

/** Cap: a dead zone longer than 50 taps keeps the newest 50. */
const MAX_QUEUED = 50;

function isEntry(value: unknown): value is QueuedCheckIn {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return typeof e.session_id === 'number' && typeof e.recorded_at === 'string';
}

function readRaw(): QueuedCheckIn[] {
  if (memoryQueue !== null) return [...memoryQueue];
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

function writeRaw(entries: QueuedCheckIn[]): OutboxWriteResult {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    memoryQueue = null;
    return { queue: entries, persisted: true };
  } catch {
    // The complete queue is authoritative until a later write succeeds,
    // including removals, so stale storage cannot resurrect replayed taps.
    memoryQueue = [...entries];
    return { queue: entries, persisted: false };
  }
}

/** Loads every queued entry, oldest first. */
export function loadOutbox(): QueuedCheckIn[] {
  return readRaw();
}

/** Queues one entry; identical (session, instant) pairs queue once. */
export function enqueueCheckIn(entry: QueuedCheckIn): OutboxWriteResult {
  const queue = readRaw();
  const dup = queue.some(
    (e) => e.session_id === entry.session_id && e.recorded_at === entry.recorded_at,
  );
  if (!dup) queue.push(entry);
  while (queue.length > MAX_QUEUED) queue.shift();
  return writeRaw(queue);
}

/** Drops one entry after a successful replay. */
export function dequeueCheckIn(sessionId: number, recordedAt: string): OutboxWriteResult {
  const queue = readRaw().filter(
    (e) => !(e.session_id === sessionId && e.recorded_at === recordedAt),
  );
  return writeRaw(queue);
}

/** Loads the queued entries for one session, oldest first. */
export function outboxFor(sessionId: number): QueuedCheckIn[] {
  return readRaw().filter((e) => e.session_id === sessionId);
}
