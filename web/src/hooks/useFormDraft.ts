import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { registerDraft, unregisterDraft } from '@/lib/draftIndex'
import { broadcast, TAB_ID } from '@/lib/broadcast'

/**
 * Default draft expiry — drafts older than this are silently discarded on
 * hydration. 7 days is enough for a long weekend of interrupted work but
 * short enough that a stale draft from a prior schema doesn't haunt the user.
 */
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Default debounce window between user keystrokes and a localStorage write. */
const DEFAULT_DEBOUNCE_MS = 800

/**
 * Storage envelope written under the `teslasync:draft:v{version}:{key}`
 * namespace. Keeping the version in the key (not just the envelope) means
 * bumping the version invalidates old drafts cleanly without a separate
 * migration step.
 */
interface DraftEnvelope<T> {
  version: number
  savedAt: number
  value: T
}

export interface FormDraftRecoverOptions {
  /**
   * Human-readable label for the recovery prompt
   * (e.g. "Alert rule", "Automation", "Settings"). Required to opt in to
   * the index — the prompt has nothing useful to show without it.
   */
  label: string
  /**
   * Where to navigate when the user clicks "Resume" in the recovery
   * prompt. Defaults to `window.location.pathname` captured at register
   * time so a draft saved on `/alert-studio?id=42` resumes on that exact
   * URL after a crash.
   */
  route?: string
}

export interface FormDraftOptions<T> {
  /** Debounce in ms (default 800). 0 = synchronous on every change. */
  debounceMs?: number
  /** Storage backend: 'local' = localStorage, 'session' = sessionStorage. Default 'local'. */
  storage?: 'local' | 'session'
  /**
   * Skip persistence when the supplied predicate returns true. Useful to
   * avoid writing pristine forms (e.g. brand-new editor at default values)
   * or to pause writes while a save mutation is in flight.
   */
  skipPersist?: (value: T) => boolean
  /** Optional schema-version stamp; bumping this invalidates older drafts silently. */
  version?: number
  /** Maximum age in ms before the draft is treated as expired (default 7 days). */
  maxAgeMs?: number
  /**
   * Opt in to the global crash-recovery prompt.
   *
   * When provided, every successful persist also writes an entry into
   * the {@link import('@/lib/draftIndex').DraftEntry draft index} keyed
   * by this hook's `localStorage` key, and broadcasts
   * `formDraft.acquired` / `formDraft.released` so other tabs can avoid
   * double-prompting. When omitted, the hook behaves identically to
   * its previous contract — no extra storage writes, no broadcasts.
   *
   * Existing callers that haven't migrated are still surfaced by the
   * recovery prompt via fallback rules in `draftIndex.ts`; passing
   * `recover` here just enriches the surfaced label and resume route.
   */
  recover?: FormDraftRecoverOptions
}

export interface FormDraftState<T> {
  /** Current value. Identical to a normal useState getter. */
  value: T
  /** Setter — same signature as React's useState setter. */
  setValue: Dispatch<SetStateAction<T>>
  /** True iff a saved draft was hydrated for the current key. */
  hasDraft: boolean
  /** When the most recent draft was persisted (Date or null). */
  draftSavedAt: Date | null
  /** Discards the draft from storage AND resets value to `initial`. */
  discardDraft: () => void
  /** Persists immediately, bypassing debounce. Useful before navigating away. */
  flush: () => void
}

interface InternalState<T> {
  value: T
  savedAt: Date | null
  hasDraft: boolean
}

function getStorage(kind: 'local' | 'session'): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage
  } catch {
    return null
  }
}

function buildFullKey(key: string, version: number): string {
  return `teslasync:draft:v${version}:${key}`
}

function readDraft<T>(
  storage: Storage | null,
  fullKey: string,
  expectedVersion: number,
  maxAgeMs: number,
): { value: T; savedAt: Date } | null {
  if (!storage) return null
  let raw: string | null
  try {
    raw = storage.getItem(fullKey)
  } catch {
    return null
  }
  if (!raw) return null
  let parsed: Partial<DraftEnvelope<T>>
  try {
    parsed = JSON.parse(raw) as Partial<DraftEnvelope<T>>
  } catch {
    // Corrupt entry: silently delete so it doesn't trip us up again.
    try { storage.removeItem(fullKey) } catch { /* ignore */ }
    return null
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    parsed.version !== expectedVersion ||
    typeof parsed.savedAt !== 'number'
  ) {
    return null
  }
  if (Date.now() - parsed.savedAt > maxAgeMs) {
    // Expired: drop it so we don't keep re-reading and re-rejecting.
    try { storage.removeItem(fullKey) } catch { /* ignore */ }
    return null
  }
  return { value: parsed.value as T, savedAt: new Date(parsed.savedAt) }
}

function writeDraft<T>(
  storage: Storage | null,
  fullKey: string,
  value: T,
  version: number,
): Date | null {
  if (!storage) return null
  const savedAt = Date.now()
  const envelope: DraftEnvelope<T> = { version, savedAt, value }
  try {
    storage.setItem(fullKey, JSON.stringify(envelope))
    return new Date(savedAt)
  } catch {
    // Quota exceeded / disabled / private mode. Drafts are best-effort —
    // a write failure must never crash the form.
    return null
  }
}

/**
 * Resolves the recovery `route` option to a concrete URL. Falls back to
 * the current `pathname + search` when the caller didn't pass one — this
 * covers the common case where a user is editing a form on
 * `/alert-studio?id=42` and we want to resume on the same URL.
 */
function resolveRecoverRoute(explicit: string | undefined): string {
  if (typeof explicit === 'string' && explicit.length > 0) return explicit
  if (typeof window === 'undefined') return '/'
  try {
    return `${window.location.pathname}${window.location.search}` || '/'
  } catch {
    return '/'
  }
}

/**
 * Local-storage-backed form draft with hydration, recovery metadata, and
 * navigate-away flushing.
 *
 * Long-form editors (alert rules, automations, settings) lose all in-progress
 * work when the tab closes, an SSO redirect happens, or the PWA reload prompt
 * fires. `useFormDraft` persists the form value under a versioned key in
 * `localStorage` (or `sessionStorage`) on a debounce, hydrates it on mount,
 * and surfaces `hasDraft` + `draftSavedAt` so the page can offer the user a
 * "draft restored from N minutes ago" banner.
 *
 * Storage layout: each draft is written to
 * `teslasync:draft:v{version}:{key}`. Bumping `opts.version` invalidates
 * every existing draft for that key without a migration step.
 *
 * **Cross-tab safety**: if two tabs edit the same draft key, the last write
 * wins. Cross-tab broadcasting via `BroadcastChannel` is intentionally out
 * of scope.
 *
 * @example
 *   const { value, setValue, hasDraft, draftSavedAt, discardDraft } =
 *     useFormDraft<EditorState>(`alertstudio:rule:${ruleId ?? 'new'}`, freshEditor(), {
 *       version: 1,
 *       skipPersist: (v) => isPristine(v),
 *     })
 */
export function useFormDraft<T>(
  key: string,
  initial: T,
  opts: FormDraftOptions<T> = {},
): FormDraftState<T> {
  const {
    debounceMs = DEFAULT_DEBOUNCE_MS,
    storage = 'local',
    skipPersist,
    version = 1,
    maxAgeMs = DEFAULT_MAX_AGE_MS,
    recover,
  } = opts

  const fullKey = buildFullKey(key, version)
  const storageObj = getStorage(storage)

  // Lazy init: read from storage on first mount.
  const [state, setState] = useState<InternalState<T>>(() => {
    const stored = readDraft<T>(storageObj, fullKey, version, maxAgeMs)
    return stored
      ? { value: stored.value, savedAt: stored.savedAt, hasDraft: true }
      : { value: initial, savedAt: null, hasDraft: false }
  })

  // Refs that always point at the freshest values, so stable callbacks
  // (flush, discardDraft) don't churn on every render.
  const stateRef = useRef(state)
  const fullKeyRef = useRef(fullKey)
  const versionRef = useRef(version)
  const skipPersistRef = useRef(skipPersist)
  const initialRef = useRef(initial)
  const storageRef = useRef(storageObj)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // True iff the user has called setValue since hydration. Without this,
  // the debounce effect would persist the very value we just read from
  // storage, churning savedAt for no reason.
  const dirtyRef = useRef(false)

  // Recovery metadata lives in refs so callbacks (`persist`, `discardDraft`)
  // stay stable across renders even
  // as the caller's `recover.label` / `recover.route` change.
  const recoverRef = useRef(recover)
  const recoverKeyRef = useRef(key)
  recoverRef.current = recover
  recoverKeyRef.current = key

  stateRef.current = state
  fullKeyRef.current = fullKey
  versionRef.current = version
  skipPersistRef.current = skipPersist
  initialRef.current = initial
  storageRef.current = storageObj

  // Re-hydrate when the key changes mid-mount (e.g. user switches between
  // editing rule #5 and creating a new rule). Adjust state during render —
  // documented React 18 pattern — so the next render sees the right value
  // immediately rather than flashing the previous draft.
  const lastKeyRef = useRef(fullKey)
  let currentState = state
  if (lastKeyRef.current !== fullKey) {
    lastKeyRef.current = fullKey
    const stored = readDraft<T>(storageObj, fullKey, version, maxAgeMs)
    currentState = stored
      ? { value: stored.value, savedAt: stored.savedAt, hasDraft: true }
      : { value: initial, savedAt: null, hasDraft: false }
    setState(currentState)
    stateRef.current = currentState
    dirtyRef.current = false
    if (debounceTimerRef.current != null) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
  }

  const persist = useCallback(() => {
    // No user edit since hydration → nothing meaningful to write.
    if (!dirtyRef.current) return
    const v = stateRef.current.value
    if (skipPersistRef.current?.(v)) return
    const written = writeDraft(storageRef.current, fullKeyRef.current, v, versionRef.current)
    if (written) {
      setState(s => ({ ...s, savedAt: written, hasDraft: true }))
      // Opt-in recovery enriches the global index and signals sibling tabs
      // that this draft is being actively edited.
      const rec = recoverRef.current
      if (rec) {
        const route = resolveRecoverRoute(rec.route)
        registerDraft({
          storageKey: fullKeyRef.current,
          key: recoverKeyRef.current,
          version: versionRef.current,
          label: rec.label,
          route,
          savedAt: written.getTime(),
        })
        broadcast({
          type: 'formDraft.acquired',
          draftKey: fullKeyRef.current,
          tabId: TAB_ID,
          ts: written.getTime(),
        })
      }
    }
  }, [])

  const flush = useCallback(() => {
    if (debounceTimerRef.current != null) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    persist()
  }, [persist])

  const setValue: Dispatch<SetStateAction<T>> = useCallback(updater => {
    dirtyRef.current = true
    setState(prev => {
      const next = typeof updater === 'function'
        ? (updater as (p: T) => T)(prev.value)
        : updater
      return { ...prev, value: next }
    })
  }, [])

  const discardDraft = useCallback(() => {
    if (debounceTimerRef.current != null) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    try {
      storageRef.current?.removeItem(fullKeyRef.current)
    } catch {
      // best-effort
    }
    // Keep the recovery index in sync with envelope deletion. Broadcast
    // `released` so a sibling tab's prompt
    // doesn't keep listing this draft as active.
    if (recoverRef.current) {
      unregisterDraft(fullKeyRef.current)
      broadcast({
        type: 'formDraft.released',
        draftKey: fullKeyRef.current,
        tabId: TAB_ID,
      })
    }
    dirtyRef.current = false
    setState({ value: initialRef.current, savedAt: null, hasDraft: false })
  }, [])

  // Debounced write whenever the value changes.
  useEffect(() => {
    if (!dirtyRef.current) return
    if (debounceTimerRef.current != null) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    if (debounceMs <= 0) {
      persist()
      return
    }
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      persist()
    }, debounceMs)
    return () => {
      if (debounceTimerRef.current != null) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [currentState.value, debounceMs, persist])

  // Synchronous flush on `beforeunload` so closing the tab doesn't lose the
  // last keystroke.
  useEffect(() => {
    const handler = () => { flush() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [flush])

  // Synchronous flush on unmount. Cleanup runs after the last commit, so
  // stateRef.current holds the latest value.
  useEffect(() => () => { flush() }, [flush])

  // Recovery surface integration (opt-in).
  //
  // When the caller opted in via `recover`, we:
  //   1. Re-register the index entry on hydration of an existing draft so
  //      a tab opened freshly after a crash refreshes the index entry's
  //      route/label even before the user types anything new.
  //   2. Broadcast `formDraft.acquired` on mount and on key changes so
  //      sibling tabs can suppress their recovery prompt for drafts being
  //      actively edited here.
  //   3. Broadcast `formDraft.released` on unmount and key changes so
  //      sibling tabs immediately re-evaluate their suppression set.
  //
  // The whole effect is a no-op when `recover` is undefined — preserves
  // the previous behavioural contract (no extra storage writes, no bus
  // traffic) for callers that haven't migrated.
  useEffect(() => {
    const rec = recoverRef.current
    if (!rec) return
    const acquiredKey = fullKey
    const acquiredAt = stateRef.current.savedAt?.getTime() ?? Date.now()
    if (stateRef.current.hasDraft) {
      registerDraft({
        storageKey: acquiredKey,
        key,
        version,
        label: rec.label,
        route: resolveRecoverRoute(rec.route),
        savedAt: acquiredAt,
      })
    }
    broadcast({
      type: 'formDraft.acquired',
      draftKey: acquiredKey,
      tabId: TAB_ID,
      ts: acquiredAt,
    })
    return () => {
      broadcast({
        type: 'formDraft.released',
        draftKey: acquiredKey,
        tabId: TAB_ID,
      })
    }
    // We intentionally re-run only on full-key (key+version) transitions —
    // label/route changes are picked up by the next persist via
    // `recoverRef.current`.
  }, [fullKey])

  return {
    value: currentState.value,
    setValue,
    hasDraft: currentState.hasDraft,
    draftSavedAt: currentState.savedAt,
    discardDraft,
    flush,
  }
}
