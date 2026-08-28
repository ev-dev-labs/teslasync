/**
 * @module hooks/useAppLifecycle
 *
 * Correct recovery after mobile background / foreground / process suspension
 * (PWA-08).
 *
 * ## The problem
 *
 * An installed PWA on a phone is not a long-running program. The OS routinely:
 *
 *   - throttles every timer in a hidden tab to a standstill, so
 *     `setInterval` pollers silently stop;
 *   - fires `freeze` and discards the page's CPU budget entirely
 *     (Page Lifecycle API), then `resume` when the user comes back;
 *   - restores the whole document from the back/forward cache, where
 *     `pageshow.persisted === true` and NO React state was ever unmounted —
 *     so nothing remounts, no query refetches, and the UI silently shows
 *     data from before the suspension;
 *   - kills the network while backgrounded, leaving a zombie `EventSource`
 *     whose `readyState` still reads OPEN.
 *
 * The visible symptom is always the same: the user reopens TeslaSync after
 * lunch and sees a confident, wrong, three-hour-old battery percentage.
 *
 * ## The contract
 *
 * {@link deriveResumeAction} is a pure function of the observable facts, so
 * every branch of the matrix is unit-testable without jsdom lifecycle
 * plumbing. {@link useAppLifecycle} is a thin adapter that feeds it real
 * events and performs the three recovery actions it can return.
 */

import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { sseManager } from '@/lib/sseManager'

/**
 * How long the app must have been away before a resume is treated as a real
 * suspension rather than an incidental tab switch. Below this, TanStack
 * Query's own `refetchOnWindowFocus` already does the right thing and an
 * extra full invalidation would be a wasteful thundering herd.
 */
export const RESUME_REFETCH_AFTER_MS = 30 * 1000

/**
 * Above this, the SSE pipe is assumed dead regardless of what `readyState`
 * claims: mobile OSes tear the socket down without notifying the page.
 */
export const RESUME_STREAM_RESET_AFTER_MS = 60 * 1000

/** How the app came back to the foreground. */
export type ResumeTrigger =
  /** `visibilitychange` → visible. */
  | 'visible'
  /** Page Lifecycle API `resume` after a `freeze`. */
  | 'resume'
  /** `pageshow` with `persisted === true` — restored from the bfcache. */
  | 'bfcache-restore'
  /** `online` after the device regained connectivity. */
  | 'reconnect'

export interface ResumeContext {
  trigger: ResumeTrigger
  /** Milliseconds the app spent hidden/frozen. `null` when never hidden. */
  awayMs: number | null
  /** `navigator.onLine` at the moment of resume. */
  online: boolean
  /** `true` when the SSE manager reports a live pipe. */
  streamConnected: boolean
  /** Epoch ms of the last SSE message, or `null`. */
  lastStreamMessageAt: number | null
  now: number
}

export interface ResumeAction {
  /** Invalidate every active query so visible panels refetch. */
  refetch: boolean
  /** Tear down and reopen the SSE pipe. */
  resetStream: boolean
  /** Ask the service worker to look for a new build. */
  checkForUpdate: boolean
  /** Why this action set was chosen — asserted by the tests, logged in dev. */
  reason: string
}

const NO_ACTION: ResumeAction = {
  refetch: false,
  resetStream: false,
  checkForUpdate: false,
  reason: 'no-op',
}

/**
 * Decide what recovery a resume needs.
 *
 * Rules, in evaluation order:
 *
 *  1. **Offline** → do nothing. Refetching with no network burns battery and
 *     floods the query cache with errors that the offline banner already
 *     explains. The `online` event will trigger recovery later.
 *  2. **bfcache restore** → always full recovery. Nothing remounted, so every
 *     value on screen predates the restore no matter how brief it was.
 *  3. **Short absence** (< {@link RESUME_REFETCH_AFTER_MS}) → nothing;
 *     `refetchOnWindowFocus` covers it.
 *  4. **Long absence** → refetch, and additionally reset the stream when it
 *     is disconnected or has been silent past
 *     {@link RESUME_STREAM_RESET_AFTER_MS}.
 *  5. **Any recovery** also triggers an update check: a phone that was away
 *     for hours has missed every `registration.update()` interval.
 */
export function deriveResumeAction(context: ResumeContext): ResumeAction {
  if (!context.online) {
    return { ...NO_ACTION, reason: 'offline' }
  }

  const away = context.awayMs ?? 0
  const streamSilentMs =
    context.lastStreamMessageAt == null
      ? Number.POSITIVE_INFINITY
      : context.now - context.lastStreamMessageAt
  const streamStale =
    !context.streamConnected || streamSilentMs > RESUME_STREAM_RESET_AFTER_MS

  if (context.trigger === 'bfcache-restore') {
    return {
      refetch: true,
      resetStream: streamStale,
      checkForUpdate: true,
      reason: 'bfcache-restore',
    }
  }

  if (context.trigger === 'reconnect') {
    return {
      refetch: true,
      resetStream: true,
      checkForUpdate: true,
      reason: 'network-reconnect',
    }
  }

  if (away < RESUME_REFETCH_AFTER_MS) {
    return { ...NO_ACTION, reason: 'brief-absence' }
  }

  return {
    refetch: true,
    resetStream: streamStale,
    checkForUpdate: true,
    reason: context.trigger === 'resume' ? 'process-resume' : 'foreground',
  }
}

export interface UseAppLifecycleOptions {
  /** Invoked when the resume action asks for a service-worker update check. */
  onCheckForUpdate?: () => void
  /** Observability seam — called with every executed action. */
  onResume?: (action: ResumeAction, context: ResumeContext) => void
}

export interface AppLifecycleApi {
  /** Force the resume path (used by tests and by manual "Refresh now"). */
  recoverNow: (trigger?: ResumeTrigger) => ResumeAction
}

/**
 * Wire the browser's lifecycle events to {@link deriveResumeAction}.
 *
 * Mount ONCE, near the application root. Mounting twice would double every
 * invalidation on resume.
 */
export function useAppLifecycle(
  options: UseAppLifecycleOptions = {},
): AppLifecycleApi {
  const queryClient = useQueryClient()
  const awaySinceRef = useRef<number | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const runRecovery = useCallback(
    (trigger: ResumeTrigger): ResumeAction => {
      const now = Date.now()
      const awaySince = awaySinceRef.current
      const context: ResumeContext = {
        trigger,
        awayMs: awaySince == null ? null : now - awaySince,
        online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
        streamConnected: sseManager.getState() === 'connected',
        lastStreamMessageAt: sseManager.getLastMessageAt(),
        now,
      }
      const action = deriveResumeAction(context)

      if (action.resetStream) {
        // Only reconnect a pipe that was genuinely in use. `hasEverConnected`
        // is the cheapest proxy for "this session has SSE subscribers";
        // calling connect() on a session that never used SSE would open a
        // socket nobody reads.
        if (sseManager.hasEverConnected()) {
          sseManager.disconnect()
          sseManager.connect()
        }
      }
      if (action.refetch) {
        // `type: 'active'` limits the storm to queries with a mounted
        // observer — exactly the panels the user is looking at. Inactive
        // cache entries refetch lazily when their page is next opened.
        void queryClient.invalidateQueries({ type: 'active' })
      }
      if (action.checkForUpdate) {
        optionsRef.current.onCheckForUpdate?.()
      }

      awaySinceRef.current = null
      optionsRef.current.onResume?.(action, context)
      return action
    },
    [queryClient],
  )

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return undefined
    }

    const markAway = () => {
      if (awaySinceRef.current == null) awaySinceRef.current = Date.now()
    }

    const onVisibility = () => {
      if (document.hidden) {
        markAway()
        return
      }
      runRecovery('visible')
    }
    // `freeze`/`resume` only fire in Chromium. Where unsupported, the
    // visibility path above already covers the same transition.
    const onFreeze = () => markAway()
    const onResume = () => runRecovery('resume')
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) runRecovery('bfcache-restore')
    }
    const onPageHide = () => markAway()
    const onOnline = () => runRecovery('reconnect')
    const onOffline = () => markAway()

    document.addEventListener('visibilitychange', onVisibility)
    document.addEventListener('freeze', onFreeze)
    document.addEventListener('resume', onResume)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      document.removeEventListener('freeze', onFreeze)
      document.removeEventListener('resume', onResume)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [runRecovery])

  return { recoverNow: (trigger: ResumeTrigger = 'visible') => runRecovery(trigger) }
}
