// "Don't ask me again" storage for confirm dialogs.

// `<ConfirmDialog>` and `useConfirm` accept an optional `silenceKey`.
// When the user opts in via the dialog's "Don't ask again" checkbox,
// we persist that choice here and short-circuit future calls so the
// dialog never re-prompts for that action.

// One key, one set, one schema version:
//   Single allowlist key `STORAGE_KEY` keeps the surface area tiny.
//   Stored as a JSON array of action ids (deduped via Set on read).
//   The `:v1` suffix lets us migrate the shape later without colliding.

// Caller contract:
//   Treat keys as stable, namespaced action ids: `discard-draft`,
//     `remove-widget`, etc. Never reuse a key for a different action.
//   Do NOT silence danger-variant or typed-confirmation prompts
//     `<ConfirmDialog>` ignores `silenceKey` for those by design.

const STORAGE_KEY = 'teslasync:confirm-silence:v1';

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return new Set();
  }
}

function save(set: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // Quota exceeded, private mode, or no storage at all — silently skip;
    // worst case the dialog re-prompts next time, which is the safe default.
  }
}

/** Returns true when the user previously opted to silence this action id. */
export function isSilenced(key: string): boolean {
  if (!key) return false;
  return load().has(key);
}

/** Persist that the user no longer wants to be asked about this action. */
export function silence(key: string): void {
  if (!key) return;
  const s = load();
  if (s.has(key)) return;
  s.add(key);
  save(s);
}

/** Re-enable the prompt for a single action id. */
export function unsilence(key: string): void {
  if (!key) return;
  const s = load();
  if (!s.delete(key)) return;
  save(s);
}

/** All currently-silenced action ids, sorted for stable rendering. */
export function listSilenced(): string[] {
  return [...load()].sort();
}

/** Wipe every silenced action id ("Restore all confirmation prompts"). */
export function clearAllSilenced(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same defensive ignore as `save` — a failed clear is recoverable.
  }
}

/** Test-only escape hatch matching the other lib helpers. */
export const _STORAGE_KEY_INTERNAL = STORAGE_KEY;
