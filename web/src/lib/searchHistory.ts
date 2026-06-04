/**
 * Per-scope recent-search history.
 *
 * Backs the "recent searches" dropdown surfaced by `<SearchInput>` when it is
 * focused with an empty value. The store is a tiny localStorage envelope:
 *
 *   { scopes: { [scope]: [{ q, ts }, ...] } }
 *
 * Scopes are independent (`'drives'` does not bleed into `'charging'`).
 * Within a scope, entries are kept newest-first, capped at {@link CAP}, and
 * de-duplicated case-insensitively (the most recent submission wins, including
 * its original casing).
 *
 * Trimming + min-length filtering happens in {@link recordSearch}, so callers
 * can safely fire on every blur / Enter without worrying about polluting the
 * list with whitespace or single-character noise.
 *
 * The store survives malformed JSON, non-object payloads, and
 * non-array scope values — anything weird is treated as an empty store rather
 * than thrown, mirroring the resilience contract of `commandFrecency.ts`.
 */

const STORAGE_KEY = 'teslasync:search-history:v1';

/** Maximum entries kept per scope; oldest entries are evicted FIFO. */
export const CAP = 12;

/** Minimum length (after trim) for a query to be recorded. */
export const MIN_QUERY_LEN = 2;

/** Default number of entries returned by {@link getRecentSearches}. */
const DEFAULT_RETURN = 8;

interface HistoryEntry {
  /** Original-cased text the user submitted. */
  q: string;
  /** Wall-clock ms of the most recent submission. */
  ts: number;
}

interface HistoryEnvelope {
  scopes: Record<string, HistoryEntry[]>;
}

function emptyEnvelope(): HistoryEnvelope {
  return { scopes: {} };
}

function isEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const e = value as Partial<HistoryEntry>;
  return (
    typeof e.q === 'string' &&
    e.q.length > 0 &&
    typeof e.ts === 'number' &&
    Number.isFinite(e.ts)
  );
}

function load(): HistoryEnvelope {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyEnvelope();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return emptyEnvelope();
    }
    const scopesIn = (parsed as { scopes?: unknown }).scopes;
    if (!scopesIn || typeof scopesIn !== 'object' || Array.isArray(scopesIn)) {
      return emptyEnvelope();
    }
    const out: HistoryEnvelope = emptyEnvelope();
    for (const [scope, value] of Object.entries(scopesIn as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      const cleaned = value.filter(isEntry).slice(0, CAP);
      if (cleaned.length > 0) out.scopes[scope] = cleaned;
    }
    return out;
  } catch {
    return emptyEnvelope();
  }
}

function save(env: HistoryEnvelope): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(env));
  } catch {
    // Quota exceeded, private browsing, or storage disabled — fail silently.
    // History is purely additive UX, so dropping a write degrades gracefully.
  }
}

/**
 * Record `query` in `scope`. Trims whitespace, ignores empty queries and
 * queries shorter than {@link MIN_QUERY_LEN} characters after trimming.
 *
 * If an entry with the same casefolded text already exists in this scope,
 * the existing entry is removed and the new submission (with its current
 * casing + timestamp) takes the top slot.
 */
export function recordSearch(scope: string, query: string): void {
  if (!scope) return;
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LEN) return;
  const env = load();
  const existing = env.scopes[scope] ?? [];
  const lower = trimmed.toLowerCase();
  const filtered = existing.filter((e) => e.q.toLowerCase() !== lower);
  const next: HistoryEntry[] = [{ q: trimmed, ts: Date.now() }, ...filtered].slice(0, CAP);
  env.scopes[scope] = next;
  save(env);
}

/**
 * Return up to `max` recent search strings for `scope`, newest-first.
 * Returns an empty array if the scope is unknown or storage is empty.
 */
export function getRecentSearches(scope: string, max: number = DEFAULT_RETURN): string[] {
  if (!scope) return [];
  const env = load();
  const entries = env.scopes[scope] ?? [];
  const limit = Math.max(0, Math.min(max, CAP));
  return entries.slice(0, limit).map((e) => e.q);
}

/**
 * Remove a single entry (matched case-insensitively) from `scope`. No-op if
 * the scope or query is unknown.
 */
export function removeSearch(scope: string, query: string): void {
  if (!scope) return;
  const lower = query.trim().toLowerCase();
  if (!lower) return;
  const env = load();
  const existing = env.scopes[scope];
  if (!existing) return;
  const next = existing.filter((e) => e.q.toLowerCase() !== lower);
  if (next.length === existing.length) return;
  if (next.length === 0) {
    delete env.scopes[scope];
  } else {
    env.scopes[scope] = next;
  }
  save(env);
}

/**
 * Wipe all entries for `scope` only. Other scopes keep their history.
 */
export function clearScope(scope: string): void {
  if (!scope) return;
  const env = load();
  if (!(scope in env.scopes)) return;
  delete env.scopes[scope];
  save(env);
}

/**
 * Test-only: drop the entire storage key so tests start from a clean slate.
 * Production code should never call this — it would erase every scope's
 * history without warning.
 */
export function _resetSearchHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore — same rationale as save() */
  }
}
