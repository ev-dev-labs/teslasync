/**
 * Phase-46 / Prompt 47 — Draft index for crash recovery.
 *
 * Tracks every active `useFormDraft` envelope so that {@link
 * DraftRestorePrompt} can surface unsaved work after a tab close, browser
 * crash, or PWA reload. The index lives in `localStorage` under
 * {@link DRAFT_INDEX_KEY} so it survives the same destructive events that
 * `useFormDraft` itself was designed to survive.
 *
 * ## Storage layout
 *
 * ```
 * teslasync:draft-index:v1 -> {
 *   "<storageKey>": {
 *     storageKey: "teslasync:draft:v1:alertstudio:rule:42",
 *     key:        "alertstudio:rule:42",
 *     version:    1,
 *     label:      "Alert rule",
 *     route:      "/alert-studio?id=42",
 *     savedAt:    1701234567890
 *   },
 *   ...
 * }
 * ```
 *
 * Indexed by `storageKey` (the full localStorage key of the underlying
 * envelope) so the same logical key at different schema versions is treated
 * as two separate drafts.
 *
 * ## Opt-in registration
 *
 * Registration is OPT-IN from `useFormDraft`: only callers that pass a
 * `recover: { label, route? }` option get an entry. This keeps the existing
 * `useFormDraft` test contract intact (no extra `setItem` calls when no
 * label is provided) while letting new pages enrich the recovery prompt
 * with human-readable labels and resume routes.
 *
 * ## Fallback for unregistered envelopes
 *
 * Older `useFormDraft` callers that haven't been migrated to pass a
 * `recover` opt still need to be surfaced — the user's work is just as
 * valuable whether the page is migrated or not. {@link getDrafts} therefore
 * also scans `localStorage` for any envelope matching the
 * `teslasync:draft:v*:*` prefix and synthesises an entry for unregistered
 * envelopes via {@link FALLBACK_RULES}. This mirrors the Blocked Path in
 * the prompt spec — "ship a parallel registry from inside DraftRestorePrompt
 * that tails localStorage keys matching a known prefix".
 */

/** Versioned localStorage slot for the index. Bump to invalidate cleanly. */
export const DRAFT_INDEX_KEY = 'teslasync:draft-index:v1'

/** Prefix every `useFormDraft` envelope shares; mirrors the hook. */
export const DRAFT_ENVELOPE_PREFIX = 'teslasync:draft:v'

/** Matches `teslasync:draft:v{version}:{key}` and captures version + key. */
const ENVELOPE_KEY_PATTERN = /^teslasync:draft:v(\d+):(.+)$/

export interface DraftEntry {
  /** Full localStorage key of the underlying envelope. */
  storageKey: string
  /** User-supplied logical key (without the version prefix). */
  key: string
  /** Schema version embedded in the storage key. */
  version: number
  /** Human-readable label to show in the recovery prompt. */
  label: string
  /** Where to navigate when the user clicks "Resume". */
  route: string
  /** Last persistence time (epoch ms). Drives the "X minutes ago" copy. */
  savedAt: number
  /**
   * `true` when the entry was synthesised from a fallback rule because the
   * envelope had no explicit registration. The prompt may want to render
   * these slightly differently (e.g. weaker "Resume" affordance).
   */
  fallback?: boolean
}

interface IndexShape {
  drafts: Record<string, DraftEntry>
}

interface FallbackMeta {
  label: string
  route: string
}

/**
 * Best-known label + route mappings for keys used by the existing
 * `useFormDraft` callers (AlertStudio, AutomationBuilder, GeneralSettings).
 * Keeps the recovery prompt useful even before those pages opt in to
 * registering with a `recover` option.
 */
const FALLBACK_RULES: Array<{ test: (key: string) => boolean; meta: FallbackMeta }> = [
  { test: k => k.startsWith('alertstudio:rule:'),    meta: { label: 'Alert rule draft',     route: '/alert-studio' } },
  { test: k => k.startsWith('automation:edit:'),     meta: { label: 'Automation draft',     route: '/automations' } },
  { test: k => k.startsWith('automation:preset:'),   meta: { label: 'Automation draft',     route: '/automations' } },
  { test: k => k === 'automation:new',               meta: { label: 'New automation draft', route: '/automations/new' } },
  { test: k => k === 'settings:general',             meta: { label: 'Settings draft',       route: '/settings' } },
]

const DEFAULT_FALLBACK: FallbackMeta = { label: 'Unsaved draft', route: '/' }

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function readIndexRaw(): IndexShape {
  const storage = getStorage()
  if (!storage) return { drafts: {} }
  let raw: string | null
  try {
    raw = storage.getItem(DRAFT_INDEX_KEY)
  } catch {
    return { drafts: {} }
  }
  if (!raw) return { drafts: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Corrupt index — wipe it so we don't keep tripping over the same bad
    // payload on every read. Drafts themselves are untouched; the worst
    // case is that the user sees fallback labels until they re-edit each.
    try { storage.removeItem(DRAFT_INDEX_KEY) } catch { /* ignore */ }
    return { drafts: {} }
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('drafts' in (parsed as object)) ||
    typeof (parsed as { drafts: unknown }).drafts !== 'object' ||
    (parsed as { drafts: unknown }).drafts === null
  ) {
    return { drafts: {} }
  }
  const draftsObj = (parsed as { drafts: Record<string, unknown> }).drafts
  const out: Record<string, DraftEntry> = {}
  for (const [k, v] of Object.entries(draftsObj)) {
    if (!isValidEntry(v)) continue
    out[k] = v
  }
  return { drafts: out }
}

function isValidEntry(v: unknown): v is DraftEntry {
  if (!v || typeof v !== 'object') return false
  const e = v as Record<string, unknown>
  return (
    typeof e.storageKey === 'string' &&
    typeof e.key === 'string' &&
    typeof e.version === 'number' &&
    typeof e.label === 'string' &&
    typeof e.route === 'string' &&
    typeof e.savedAt === 'number' &&
    Number.isFinite(e.savedAt)
  )
}

function writeIndexRaw(shape: IndexShape): void {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.setItem(DRAFT_INDEX_KEY, JSON.stringify(shape))
    // Notify same-tab listeners. The native `storage` event only fires in
    // OTHER tabs, so we synthesise a custom event for in-tab subscribers
    // (the prompt component re-evaluates on this).
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      try {
        window.dispatchEvent(new Event(DRAFT_INDEX_LOCAL_EVENT))
      } catch {
        /* CustomEvent constructor missing in some environments */
      }
    }
  } catch {
    // Quota exceeded / disabled — best-effort, the prompt simply won't
    // surface this draft until the next successful write.
  }
}

const DRAFT_INDEX_LOCAL_EVENT = 'teslasync:draft-index-local-changed'

function envelopeRaw(storageKey: string): string | null {
  const storage = getStorage()
  if (!storage) return null
  try {
    return storage.getItem(storageKey)
  } catch {
    return null
  }
}

function readEnvelopeSavedAt(storageKey: string): number | null {
  const raw = envelopeRaw(storageKey)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { savedAt?: unknown }
    if (typeof parsed?.savedAt === 'number' && Number.isFinite(parsed.savedAt)) {
      return parsed.savedAt
    }
  } catch {
    /* corrupt envelope */
  }
  return null
}

function deriveFallback(key: string): FallbackMeta {
  for (const r of FALLBACK_RULES) {
    if (r.test(key)) return r.meta
  }
  return DEFAULT_FALLBACK
}

function parseEnvelopeKey(storageKey: string): { version: number; key: string } | null {
  const m = ENVELOPE_KEY_PATTERN.exec(storageKey)
  if (!m) return null
  const version = Number.parseInt(m[1], 10)
  const key = m[2]
  if (!Number.isFinite(version) || !key) return null
  return { version, key }
}

/**
 * Writes (or replaces) an entry in the draft index. Called from
 * `useFormDraft` after every successful envelope write when the caller
 * opted in via the `recover` option. Safe to call repeatedly — the entry
 * is keyed by `storageKey` so re-registering simply refreshes savedAt.
 */
export function registerDraft(entry: DraftEntry): void {
  if (!isValidEntry(entry)) return
  const shape = readIndexRaw()
  shape.drafts[entry.storageKey] = { ...entry, fallback: false }
  writeIndexRaw(shape)
}

/**
 * Removes an entry from the draft index without touching the underlying
 * envelope. Use this when `useFormDraft.discardDraft()` runs — the hook
 * itself removes the envelope, this just keeps the index consistent.
 */
export function unregisterDraft(storageKey: string): void {
  const shape = readIndexRaw()
  if (!(storageKey in shape.drafts)) return
  delete shape.drafts[storageKey]
  writeIndexRaw(shape)
}

/** Alias for {@link unregisterDraft} for spec-compatible naming. */
export function clearDraft(storageKey: string): void {
  unregisterDraft(storageKey)
}

/**
 * Removes BOTH the underlying envelope and the index entry. Used by the
 * recovery prompt's "Discard" button — there's no live `useFormDraft`
 * instance to call `discardDraft()` on (the form isn't mounted; that's
 * the whole point of the recovery flow).
 */
export function discardDraftEnvelope(storageKey: string): void {
  const storage = getStorage()
  if (storage) {
    try { storage.removeItem(storageKey) } catch { /* ignore */ }
  }
  unregisterDraft(storageKey)
}

/**
 * Returns every recoverable draft known to the index PLUS any envelope on
 * disk that wasn't explicitly registered (synthesised via
 * {@link FALLBACK_RULES}). The caller-facing list is the union of both
 * sources, sorted most-recent first.
 *
 * Stale entries — those whose underlying envelope has been deleted out
 * from under the index (e.g. the user discarded via `useFormDraft` in
 * another tab) — are pruned in place so the next read is consistent.
 */
export function getDrafts(): DraftEntry[] {
  const storage = getStorage()
  if (!storage) return []

  const shape = readIndexRaw()
  const result: Record<string, DraftEntry> = {}
  let prunedAny = false

  // 1. Registered entries — keep the explicit label/route, but prune those
  //    whose envelope has been removed.
  for (const [storageKey, entry] of Object.entries(shape.drafts)) {
    const envelopeSavedAt = readEnvelopeSavedAt(storageKey)
    if (envelopeSavedAt === null) {
      delete shape.drafts[storageKey]
      prunedAny = true
      continue
    }
    // If the envelope's savedAt is fresher than the index (the user typed
    // in another tab and we haven't re-registered here), trust the
    // envelope — the registry is best-effort metadata.
    result[storageKey] = {
      ...entry,
      savedAt: Math.max(entry.savedAt, envelopeSavedAt),
      fallback: false,
    }
  }

  // 2. Scan localStorage for unregistered envelopes (the Blocked-Path
  //    parallel registry from inside the prompt spec).
  let total = 0
  try { total = storage.length } catch { /* ignore */ }
  for (let i = 0; i < total; i += 1) {
    let storageKey: string | null = null
    try { storageKey = storage.key(i) } catch { break }
    if (storageKey === null) continue
    if (!storageKey.startsWith(DRAFT_ENVELOPE_PREFIX)) continue
    if (storageKey in result) continue
    const parsed = parseEnvelopeKey(storageKey)
    if (!parsed) continue
    const savedAt = readEnvelopeSavedAt(storageKey)
    if (savedAt === null) continue
    const meta = deriveFallback(parsed.key)
    result[storageKey] = {
      storageKey,
      key: parsed.key,
      version: parsed.version,
      label: meta.label,
      route: meta.route,
      savedAt,
      fallback: true,
    }
  }

  if (prunedAny) writeIndexRaw(shape)

  return Object.values(result).sort((a, b) => b.savedAt - a.savedAt)
}

/**
 * Subscribes to draft-index changes. Fires for changes made in the same
 * tab (via {@link DRAFT_INDEX_LOCAL_EVENT}) AND in other tabs (via the
 * native `storage` event). Returns an unsubscribe function.
 */
export function subscribeDraftIndex(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onLocal = () => {
    try { handler() } catch { /* never let a subscriber crash the bus */ }
  }
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== DRAFT_INDEX_KEY && !e.key.startsWith(DRAFT_ENVELOPE_PREFIX)) {
      return
    }
    try { handler() } catch { /* swallow */ }
  }
  window.addEventListener(DRAFT_INDEX_LOCAL_EVENT, onLocal)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(DRAFT_INDEX_LOCAL_EVENT, onLocal)
    window.removeEventListener('storage', onStorage)
  }
}

/** Test-only helper: wipe the entire index without affecting envelopes. */
export function __resetDraftIndexForTests(): void {
  const storage = getStorage()
  if (!storage) return
  try { storage.removeItem(DRAFT_INDEX_KEY) } catch { /* ignore */ }
}
