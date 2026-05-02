import { useEffect } from 'react'

/**
 * Phase-40 / Prompt 69 — Cross-tab synchronization.
 *
 * A small, typed message bus that lets multiple tabs of the same SPA react to
 * each other's writes without a page reload. Backed by `BroadcastChannel` in
 * modern browsers, with a `localStorage` storage-event fallback for older
 * Safari + private mode.
 *
 * ## Why
 *
 * The TeslaSync SPA is routinely opened in 2+ tabs (a pinned live dashboard
 * and a foreground "I'm editing" tab). Today, mutating something in tab A
 * (theme, alert rule, dismiss "what's new", etc.) leaves tab B looking at
 * stale data until it refetches or reloads. This bus closes that gap.
 *
 * ## Design constraints
 *
 *   1. **Single channel** named `'teslasync'` so all features share one
 *      broadcaster. Per-feature channel names would force every adapter to
 *      know its channel, and most messages are small.
 *   2. **Lazy channel construction** — never paid in SSR / tests that don't
 *      touch the bus.
 *   3. **Self-tab filter** — every envelope carries `_from: TAB_ID`. The
 *      subscriber drops messages whose `_from` matches the current tab.
 *      `BroadcastChannel.postMessage` does NOT echo to the same channel
 *      object, but the filter is defense-in-depth against:
 *        - any tab that happens to construct a second channel singleton
 *        - implementations that diverge from the spec
 *        - the storage-event fallback path (which the tag also makes safe
 *          across the same origin)
 *   4. **No PII** — message payloads carry IDs the other tab can already
 *      see in URLs / localStorage. No tokens, no draft contents, no
 *      user-typed strings.
 *   5. **No back-pressure** in the core bus — see {@link queryBroadcast}
 *      for the coalescing layer used by the query-invalidation adapter.
 */

/**
 * Discriminated-union message shape. Extend per feature, but keep the
 * payload small (IDs / version strings / counts only).
 */
export type BroadcastMessage =
  // ── Theme ────────────────────────────────────────────────────────────────
  | { type: 'theme.changed'; themeId: string; modeId: string }
  | { type: 'theme.customColors'; primary: string; accent: string }
  // ── Auth ─────────────────────────────────────────────────────────────────
  | { type: 'auth.logout' }
  // ── Notifications ────────────────────────────────────────────────────────
  | { type: 'notifications.read'; alertIds: number[] }
  | { type: 'notifications.cleared' }
  | { type: 'snooze.changed'; ruleId: number; until: number | null }
  // ── First-run / discovery surfaces ───────────────────────────────────────
  | { type: 'changelog.seen'; version: string }
  | { type: 'tour.completed'; tourId: string; version: number }
  | { type: 'tour.reset'; tourId?: string }
  | { type: 'checklist.dismissed' }
  | { type: 'onboarded' }
  | { type: 'install.dismissed' }
  // ── Layout / saved-state ─────────────────────────────────────────────────
  | { type: 'dashboard.layout' }
  | { type: 'savedView.changed'; pageId: string }
  // ── Form drafts (composes with useFormDraft / Prompt 55) ────────────────
  | { type: 'formDraft.acquired'; draftKey: string; tabId: string; ts: number }
  | { type: 'formDraft.released'; draftKey: string; tabId: string }
  | { type: 'formDraft.committed'; draftKey: string }
  // ── TanStack Query ───────────────────────────────────────────────────────
  | { type: 'queryInvalidate'; keys: ReadonlyArray<ReadonlyArray<unknown>> }

/** Internal envelope wrapper added on send and stripped on receive. */
interface Envelope {
  _from: string
  _ts: number
  msg: BroadcastMessage
}

const CHANNEL_NAME = 'teslasync'

/** Stable per-tab identifier used to filter self-broadcasts. */
export const TAB_ID: string = (() => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `tab-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
})()

let chan: BroadcastChannel | null = null

function hasBroadcastChannel(): boolean {
  return typeof BroadcastChannel !== 'undefined'
}

function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined') return null
  if (!hasBroadcastChannel()) return null
  if (!chan) {
    try {
      chan = new BroadcastChannel(CHANNEL_NAME)
    } catch {
      // Some embedded contexts disable BroadcastChannel even though the
      // constructor exists. Fall back to storage-event mode.
      chan = null
    }
  }
  return chan
}

/** Storage-key prefix used by the localStorage fallback transport. */
const FALLBACK_KEY_PREFIX = '__teslasync_bus_'

function postViaStorage(envelope: Envelope): void {
  if (typeof window === 'undefined') return
  const key = `${FALLBACK_KEY_PREFIX}${envelope._ts}_${Math.random().toString(36).slice(2)}`
  try {
    window.localStorage.setItem(key, JSON.stringify(envelope))
    // Removing immediately keeps localStorage clean. The 'storage' event
    // fires for both setItem and removeItem in OTHER tabs (not the same
    // tab), so the message has already been delivered.
    window.localStorage.removeItem(key)
  } catch {
    // Quota / private mode / disabled — best-effort drop.
  }
}

/**
 * Broadcast a message to every other tab of the same origin. The current
 * tab does NOT receive its own message.
 */
export function broadcast(msg: BroadcastMessage): void {
  if (typeof window === 'undefined') return
  const envelope: Envelope = { _from: TAB_ID, _ts: Date.now(), msg }
  const ch = getChannel()
  if (ch) {
    try {
      ch.postMessage(envelope)
      return
    } catch {
      // Fall through to the storage path on serialization errors so the
      // bus never silently swallows a message just because the channel
      // hiccuped.
    }
  }
  postViaStorage(envelope)
}

/**
 * Subscribe to messages broadcast from OTHER tabs. Returns an unsubscribe
 * function. Messages from the current tab are filtered out.
 */
export function subscribe(handler: (msg: BroadcastMessage) => void): () => void {
  if (typeof window === 'undefined') return () => {}

  // We always wire BOTH transports when available so that a tab that's
  // emitting via the channel can still receive from a tab that's emitting
  // via the storage fallback (e.g. private-mode peer + normal peer on the
  // same origin). De-duplication by `_ts + _from` would be overkill; in
  // practice a single tab uses one transport at a time.
  const cleanups: Array<() => void> = []

  const ch = getChannel()
  if (ch) {
    const fn = (e: MessageEvent) => {
      const data = e.data as Envelope | null
      if (!data || typeof data !== 'object') return
      if (data._from === TAB_ID) return
      if (!data.msg || typeof data.msg !== 'object') return
      try {
        handler(data.msg)
      } catch {
        // Subscriber threw — never let one consumer crash the bus.
      }
    }
    ch.addEventListener('message', fn)
    cleanups.push(() => ch.removeEventListener('message', fn))
  }

  const onStorage = (e: StorageEvent) => {
    if (!e.key || !e.key.startsWith(FALLBACK_KEY_PREFIX)) return
    if (!e.newValue) return
    let env: Envelope | null = null
    try {
      env = JSON.parse(e.newValue) as Envelope
    } catch {
      return
    }
    if (!env || env._from === TAB_ID) return
    if (!env.msg || typeof env.msg !== 'object') return
    try {
      handler(env.msg)
    } catch {
      /* swallow */
    }
  }
  window.addEventListener('storage', onStorage)
  cleanups.push(() => window.removeEventListener('storage', onStorage))

  return () => {
    for (const c of cleanups) c()
  }
}

/**
 * React hook variant of {@link subscribe}. Subscribes for the lifetime of the
 * component. The handler is captured by reference each render — pass a stable
 * callback (or wrap in `useCallback`) if you want to avoid re-subscribing on
 * every render.
 */
export function useBroadcast(handler: (msg: BroadcastMessage) => void): void {
  useEffect(() => {
    return subscribe(handler)
  }, [handler])
}

/**
 * Test-only helper: forces the next call to {@link getChannel} to rebuild
 * the singleton. Used by tests that swap `BroadcastChannel` between
 * defined/undefined to exercise both transports.
 */
export function __resetBroadcastForTests(): void {
  if (chan) {
    try {
      chan.close()
    } catch {
      /* ignore */
    }
  }
  chan = null
}
