// Native parity port of web/src/lib/draftIndex.ts.
//
// Draft index for crash recovery. Tracks every active `useFormDraft` envelope so
// a DraftRestorePrompt can surface unsaved work after the app is killed or
// backgrounded out of memory. On the web the index lived in `localStorage` so it
// survived the same destructive events `useFormDraft` was designed to survive.
//
// Web -> native adaptation (conversion contract rule 7):
//   * `window.localStorage` has no synchronous RN equivalent, so the index and
//     the envelope scan run against the shared process-scoped in-memory store
//     (lib/nativeWebStorage.ts → getNativeStorage('local')). `useFormDraft`
//     writes its envelopes into that same 'local' store, so getDrafts' fallback
//     scan still finds unregistered envelopes. The storage KEYS
//     (`teslasync:draft-index:v1`, `teslasync:draft:v{version}:{key}`) are
//     preserved verbatim.
//   * The web same-tab `window.dispatchEvent(new Event(DRAFT_INDEX_LOCAL_EVENT))`
//     notification and the cross-tab `window` 'storage' listener have no RN
//     analogue; same-process subscribers are driven by a module listener Set
//     instead. DRAFT_INDEX_LOCAL_EVENT is retained as the stable channel id.

import {
  getNativeStorage,
  type NativeKeyValueStorage,
} from './nativeWebStorage';

/** Versioned storage slot for the index. Bump to invalidate cleanly. */
export const DRAFT_INDEX_KEY = 'teslasync:draft-index:v1';

/** Prefix every `useFormDraft` envelope shares; mirrors the hook. */
export const DRAFT_ENVELOPE_PREFIX = 'teslasync:draft:v';

/** Matches `teslasync:draft:v{version}:{key}` and captures version + key. */
const ENVELOPE_KEY_PATTERN = /^teslasync:draft:v(\d+):(.+)$/;

export interface DraftEntry {
  /** Full storage key of the underlying envelope. */
  storageKey: string;
  /** User-supplied logical key (without the version prefix). */
  key: string;
  /** Schema version embedded in the storage key. */
  version: number;
  /** Human-readable label to show in the recovery prompt. */
  label: string;
  /** Where to navigate when the user clicks "Resume". */
  route: string;
  /** Last persistence time (epoch ms). Drives the "X minutes ago" copy. */
  savedAt: number;
  /**
   * `true` when the entry was synthesised from a fallback rule because the
   * envelope had no explicit registration.
   */
  fallback?: boolean;
}

interface IndexShape {
  drafts: Record<string, DraftEntry>;
}

interface FallbackMeta {
  label: string;
  route: string;
}

/**
 * Best-known label + route mappings for keys used by the existing
 * `useFormDraft` callers (AlertStudio, AutomationBuilder, GeneralSettings).
 */
const FALLBACK_RULES: Array<{
  test: (key: string) => boolean;
  meta: FallbackMeta;
}> = [
  {
    test: k => k.startsWith('alertstudio:rule:'),
    meta: { label: 'Alert rule draft', route: '/notifications/studio' },
  },
  {
    test: k => k.startsWith('automation:edit:'),
    meta: { label: 'Automation draft', route: '/automations' },
  },
  {
    test: k => k.startsWith('automation:preset:'),
    meta: { label: 'Automation draft', route: '/automations' },
  },
  {
    test: k => k === 'automation:new',
    meta: { label: 'New automation draft', route: '/automations/new' },
  },
  {
    test: k => k === 'settings:general',
    meta: { label: 'Settings draft', route: '/settings' },
  },
];

const DEFAULT_FALLBACK: FallbackMeta = { label: 'Unsaved draft', route: '/' };

// Same-process subscribers. Replaces the web window 'storage' /
// 'teslasync:draft-index-local-changed' CustomEvent listeners — React Native has
// neither tabs nor a window.
const indexListeners = new Set<() => void>();

function notifyIndexListeners(): void {
  for (const cb of indexListeners) {
    try {
      cb();
    } catch {
      /* never let one subscriber crash the bus */
    }
  }
}

function getStorage(): NativeKeyValueStorage | null {
  return getNativeStorage('local');
}

function readIndexRaw(): IndexShape {
  const storage = getStorage();
  if (!storage) {
    return { drafts: {} };
  }
  let raw: string | null;
  try {
    raw = storage.getItem(DRAFT_INDEX_KEY);
  } catch {
    return { drafts: {} };
  }
  if (!raw) {
    return { drafts: {} };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt index — wipe it so we don't keep tripping over the same bad
    // payload on every read. Drafts themselves are untouched.
    try {
      storage.removeItem(DRAFT_INDEX_KEY);
    } catch {
      /* ignore */
    }
    return { drafts: {} };
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('drafts' in (parsed as object)) ||
    typeof (parsed as { drafts: unknown }).drafts !== 'object' ||
    (parsed as { drafts: unknown }).drafts === null
  ) {
    return { drafts: {} };
  }
  const draftsObj = (parsed as { drafts: Record<string, unknown> }).drafts;
  const out: Record<string, DraftEntry> = {};
  for (const [k, v] of Object.entries(draftsObj)) {
    if (!isValidEntry(v)) {
      continue;
    }
    out[k] = v;
  }
  return { drafts: out };
}

function isValidEntry(v: unknown): v is DraftEntry {
  if (!v || typeof v !== 'object') {
    return false;
  }
  const e = v as Record<string, unknown>;
  return (
    typeof e.storageKey === 'string' &&
    typeof e.key === 'string' &&
    typeof e.version === 'number' &&
    typeof e.label === 'string' &&
    typeof e.route === 'string' &&
    typeof e.savedAt === 'number' &&
    Number.isFinite(e.savedAt)
  );
}

function writeIndexRaw(shape: IndexShape): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(DRAFT_INDEX_KEY, JSON.stringify(shape));
    // Notify same-process listeners. The web synthesised a custom window event
    // (DRAFT_INDEX_LOCAL_EVENT) for in-tab subscribers; native fans out through
    // the module listener Set instead.
    notifyIndexListeners();
  } catch {
    // Best-effort — the prompt simply won't surface this draft until the next
    // successful write.
  }
}

function envelopeRaw(storageKey: string): string | null {
  const storage = getStorage();
  if (!storage) {
    return null;
  }
  try {
    return storage.getItem(storageKey);
  } catch {
    return null;
  }
}

function readEnvelopeSavedAt(storageKey: string): number | null {
  const raw = envelopeRaw(storageKey);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { savedAt?: unknown };
    if (
      typeof parsed?.savedAt === 'number' &&
      Number.isFinite(parsed.savedAt)
    ) {
      return parsed.savedAt;
    }
  } catch {
    /* corrupt envelope */
  }
  return null;
}

function deriveFallback(key: string): FallbackMeta {
  for (const r of FALLBACK_RULES) {
    if (r.test(key)) {
      return r.meta;
    }
  }
  return DEFAULT_FALLBACK;
}

function parseEnvelopeKey(
  storageKey: string,
): { version: number; key: string } | null {
  const m = ENVELOPE_KEY_PATTERN.exec(storageKey);
  if (!m) {
    return null;
  }
  const version = Number.parseInt(m[1], 10);
  const key = m[2];
  if (!Number.isFinite(version) || !key) {
    return null;
  }
  return { version, key };
}

/**
 * Writes (or replaces) an entry in the draft index. Called from `useFormDraft`
 * after every successful envelope write when the caller opted in via the
 * `recover` option. Safe to call repeatedly.
 */
export function registerDraft(entry: DraftEntry): void {
  if (!isValidEntry(entry)) {
    return;
  }
  const shape = readIndexRaw();
  shape.drafts[entry.storageKey] = { ...entry, fallback: false };
  writeIndexRaw(shape);
}

/**
 * Removes an entry from the draft index without touching the underlying
 * envelope. Use this when `useFormDraft.discardDraft()` runs.
 */
export function unregisterDraft(storageKey: string): void {
  const shape = readIndexRaw();
  if (!(storageKey in shape.drafts)) {
    return;
  }
  delete shape.drafts[storageKey];
  writeIndexRaw(shape);
}

/** Alias for {@link unregisterDraft} for spec-compatible naming. */
export function clearDraft(storageKey: string): void {
  unregisterDraft(storageKey);
}

/**
 * Removes BOTH the underlying envelope and the index entry. Used by the
 * recovery prompt's "Discard" button.
 */
export function discardDraftEnvelope(storageKey: string): void {
  const storage = getStorage();
  if (storage) {
    try {
      storage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }
  unregisterDraft(storageKey);
}

/**
 * Returns every recoverable draft known to the index PLUS any envelope in the
 * store that wasn't explicitly registered (synthesised via {@link
 * FALLBACK_RULES}). Sorted most-recent first. Stale entries (envelope deleted
 * out from under the index) are pruned in place.
 */
export function getDrafts(): DraftEntry[] {
  const storage = getStorage();
  if (!storage) {
    return [];
  }

  const shape = readIndexRaw();
  const result: Record<string, DraftEntry> = {};
  let prunedAny = false;

  // 1. Registered entries — keep the explicit label/route, but prune those
  //    whose envelope has been removed.
  for (const [storageKey, entry] of Object.entries(shape.drafts)) {
    const envelopeSavedAt = readEnvelopeSavedAt(storageKey);
    if (envelopeSavedAt === null) {
      delete shape.drafts[storageKey];
      prunedAny = true;
      continue;
    }
    result[storageKey] = {
      ...entry,
      savedAt: Math.max(entry.savedAt, envelopeSavedAt),
      fallback: false,
    };
  }

  // 2. Scan the store for unregistered envelopes.
  let total = 0;
  try {
    total = storage.length;
  } catch {
    /* ignore */
  }
  for (let i = 0; i < total; i += 1) {
    let storageKey: string | null = null;
    try {
      storageKey = storage.key(i);
    } catch {
      break;
    }
    if (storageKey === null) {
      continue;
    }
    if (!storageKey.startsWith(DRAFT_ENVELOPE_PREFIX)) {
      continue;
    }
    if (storageKey in result) {
      continue;
    }
    const parsed = parseEnvelopeKey(storageKey);
    if (!parsed) {
      continue;
    }
    const savedAt = readEnvelopeSavedAt(storageKey);
    if (savedAt === null) {
      continue;
    }
    const meta = deriveFallback(parsed.key);
    result[storageKey] = {
      storageKey,
      key: parsed.key,
      version: parsed.version,
      label: meta.label,
      route: meta.route,
      savedAt,
      fallback: true,
    };
  }

  if (prunedAny) {
    writeIndexRaw(shape);
  }

  return Object.values(result).sort((a, b) => b.savedAt - a.savedAt);
}

/**
 * Subscribes to draft-index changes. Fires for changes made anywhere in the
 * current process. Returns an unsubscribe function. (Web also fired for OTHER
 * tabs via the native `storage` event; React Native has no peer tabs.)
 */
export function subscribeDraftIndex(handler: () => void): () => void {
  const onLocal = () => {
    try {
      handler();
    } catch {
      /* never let a subscriber crash the bus */
    }
  };
  indexListeners.add(onLocal);
  return () => {
    indexListeners.delete(onLocal);
  };
}

/** Test-only helper: wipe the entire index without affecting envelopes. */
export function __resetDraftIndexForTests(): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(DRAFT_INDEX_KEY);
  } catch {
    /* ignore */
  }
}
