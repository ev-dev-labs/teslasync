// Native parity port of web/src/lib/commandFrecency.ts.
//
// Command palette usage ranking (frecency).
//
// Tracks per-command usage so the palette can surface a user's go-to commands
// at the top. "Frecency" combines Frequency × Recency: a command that was used
// 10 times last week ranks higher than one used 10 times six months ago.
//
//   score = count × 2^(-ageDays / HALF_LIFE_DAYS)
//
// with HALF_LIFE_DAYS = 14, so an entry's contribution halves every two weeks.
// Entries are NEVER deleted automatically; the score simply decays toward zero
// and gets overwritten/refreshed the next time the command runs.
//
// Web -> native adaptation (conversion contract rule 7):
//   * The web payload lived in a single `localStorage` key. React Native has no
//     synchronous `localStorage`, so reads/writes run against the shared
//     process-scoped in-memory store (lib/nativeWebStorage.ts ->
//     getNativeStorage('local')), exactly like the other web-parity ports. The
//     storage KEY (`teslasync:cmd-frecency:v1`) is preserved verbatim, so a
//     future AsyncStorage-backed synchronous cache can drop in unchanged and a
//     prior payload would still load.
//   * The store is small (<= ~50 entries × ~32 bytes each) so a JSON.parse on
//     every read stays well below any sensible perf budget, just as on the web.
//   * The defensive try/catch wrappers are retained for source parity even
//     though the in-memory store never throws; that keeps the graceful-degrade
//     semantics (a failed write silently drops, frecency being additive UX).

import {getNativeStorage} from './nativeWebStorage';

const STORAGE_KEY = 'teslasync:cmd-frecency:v1';
const HALF_LIFE_DAYS = 14;
const MS_PER_DAY = 86_400_000;

export interface FrecencyEntry {
  /** Total times the command has been recorded. Monotonically increasing. */
  count: number;
  /** Wall-clock ms (Date.now) of the most recent recording. */
  lastUsed: number;
}

type Store = Record<string, FrecencyEntry>;

function load(): Store {
  try {
    const raw = getNativeStorage('local').getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    // Defensive: filter out malformed entries so a single bad row can't poison
    // the whole store. We don't try to repair them — they're effectively zero.
    const out: Store = {};
    for (const [id, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        entry &&
        typeof entry === 'object' &&
        typeof (entry as FrecencyEntry).count === 'number' &&
        typeof (entry as FrecencyEntry).lastUsed === 'number' &&
        Number.isFinite((entry as FrecencyEntry).count) &&
        Number.isFinite((entry as FrecencyEntry).lastUsed)
      ) {
        out[id] = entry as FrecencyEntry;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function save(store: Store): void {
  try {
    getNativeStorage('local').setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Quota exceeded, private browsing, or storage disabled — fail silently.
    // Frecency is purely additive UX, so dropping a write degrades gracefully.
  }
}

function decayScore(entry: FrecencyEntry, now: number): number {
  const ageDays = Math.max(0, (now - entry.lastUsed) / MS_PER_DAY);
  const decay = Math.pow(2, -ageDays / HALF_LIFE_DAYS);
  return entry.count * decay;
}

/**
 * Record a single use of `commandId`. Increments the count and refreshes
 * `lastUsed` to now, persisting back to storage.
 */
export function recordCommandUse(commandId: string): void {
  if (!commandId) {
    return;
  }
  const store = load();
  const existing = store[commandId] ?? {count: 0, lastUsed: 0};
  store[commandId] = {count: existing.count + 1, lastUsed: Date.now()};
  save(store);
}

/**
 * Returns the current decayed frecency score for `commandId`, or 0 if it
 * has never been recorded. Higher = more frecent.
 */
export function getCommandScore(commandId: string): number {
  const entry = load()[commandId];
  if (!entry) {
    return 0;
  }
  return decayScore(entry, Date.now());
}

/**
 * Snapshot of every recorded command's current decayed score. Use this when
 * scoring many items in one pass to avoid N independent storage reads.
 */
export function getAllCommandScores(): Record<string, number> {
  const store = load();
  const now = Date.now();
  const out: Record<string, number> = {};
  for (const [id, entry] of Object.entries(store)) {
    out[id] = decayScore(entry, now);
  }
  return out;
}

/**
 * Wipe all stored frecency data. Surfaced through a palette command so users
 * on shared devices can clear their history without diving into devtools.
 */
export function _resetFrecency(): void {
  try {
    getNativeStorage('local').removeItem(STORAGE_KEY);
  } catch {
    /* ignore — same rationale as save() */
  }
}
