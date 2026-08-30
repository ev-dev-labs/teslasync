/**
 * @module hooks/usePwaUpdate
 *
 * Predictable service-worker update lifecycle (PWA-03 / PWA-04).
 *
 * ## What changed and why
 *
 * The previous build ran vite-plugin-pwa in `registerType: 'autoUpdate'`.
 * That mode reloads every controlled page the instant a new worker activates.
 * It is a good default for a marketing site and a bad one for an operations
 * console: a phone can be swapped out mid-form, and a pinned dashboard can
 * discard an in-progress alert rule with no warning. Worse, the "Reload now"
 * banner it left behind was dead code — `onNeedRefresh` is only wired in
 * `prompt` mode — so the app had no user-visible update affordance at all.
 *
 * This hook owns the whole lifecycle instead:
 *
 *   - **Detect.** `useRegisterSW` reports a waiting worker; a 5-minute
 *     `registration.update()` poll and a foreground-transition check make a
 *     long-lived tab notice new deploys promptly.
 *   - **Explain.** The banner gets real release context: the build currently
 *     running, and the backend version it is talking to (via the existing
 *     `useVersionWatcher`).
 *   - **Handshake.** `evaluateContractHandshake` compares this build's
 *     version against the live backend's `app_version`. When the server has
 *     moved ahead by a major/minor, the assets in this tab predate the
 *     current API contract, so the update stops being optional
 *     ({@link PwaUpdateState.updateRequired}) and the cached API reads from
 *     the previous contract are purged from the service worker.
 *   - **Guard.** Applying an update never discards unsaved work silently: it
 *     routes through the same `NavigationGuardProvider` confirm dialog that
 *     protects in-app navigation.
 *   - **Defer.** "Later" snoozes for 30 minutes rather than dismissing
 *     forever — except for a required update, which cannot be snoozed.
 *   - **Coordinate.** Sibling tabs learn over a dedicated `BroadcastChannel`
 *     that an update is being applied. Clean tabs reload themselves; a tab
 *     with unsaved work keeps its banner instead of losing the user's work.
 *
 * The channel is deliberately local rather than an addition to
 * `@/lib/broadcast`, matching the precedent set by `useVersionWatcher`:
 * infrastructural signals stay off the user-facing settings/theme/auth bus.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

import { useNavigationGuardContext } from '@/components/feedback/NavigationGuardProvider'
import {
  APP_VERSION,
  BUILD_ID,
  GIT_SHA,
  evaluateContractHandshake,
  type ContractHandshake,
} from '@/sw/buildContract'
import { purgeServiceWorkerApiCache } from '@/sw/purgeApiCache'
import { useVersionWatcher } from '@/hooks/useVersionWatcher'

/** How often a long-lived tab asks the browser to re-fetch the worker. */
export const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000

/** How long "Later" hides an optional update. */
export const UPDATE_SNOOZE_MS = 30 * 60 * 1000

/**
 * Minimum time a tab must have been hidden before returning to the
 * foreground triggers an out-of-band update check. Prevents a check on every
 * incidental tab switch.
 */
export const FOREGROUND_UPDATE_CHECK_AFTER_MS = 60 * 1000

const UPDATE_CHANNEL = 'teslasync:pwa-update'

interface UpdateEnvelope {
  kind: 'applying'
  buildId: string
}

function openChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined') return null
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    return new BroadcastChannel(UPDATE_CHANNEL)
  } catch {
    // Private mode / hardened browsers: every tab still updates on its own
    // banner. Coordination is an enhancement, not a requirement.
    return null
  }
}

export interface PwaReleaseContext {
  /** Build identity of the assets currently executing in this tab. */
  runningBuildId: string
  runningAppVersion: string
  runningGitSha: string
  /** `app_version` the backend reported at boot, or `null` while unknown. */
  bootServerVersion: string | null
  /** Most recent `app_version` seen from the backend. */
  latestServerVersion: string | null
  /** `true` when the backend version moved since this tab booted. */
  serverRedeployed: boolean
}

export interface PwaUpdateState {
  /** A new service worker is installed and waiting for permission to take over. */
  updateReady: boolean
  /** `updateReady` AND not currently snoozed — i.e. the banner should render. */
  showPrompt: boolean
  /** Cached assets predate the running API contract; deferral is disallowed. */
  updateRequired: boolean
  handshake: ContractHandshake
  release: PwaReleaseContext
  /** `true` while the reload is in flight. */
  applying: boolean
  /** Set when the last apply attempt was cancelled by the unsaved-work guard. */
  blockedByUnsavedWork: boolean
  /** Epoch ms the snooze expires, or `null` when not snoozed. */
  snoozedUntil: number | null
  applyUpdate: () => Promise<void>
  deferUpdate: () => void
  checkForUpdate: () => Promise<void>
}

/**
 * Ask the service worker to drop every cached API read.
 *
 * Re-exported from `@/sw/purgeApiCache`, which is where the implementation
 * lives so `lib/resilience.ts` can call it on sign-out without importing this
 * hook (that would close an import cycle through `useVersionWatcher` →
 * `api/client` → `resilience`).
 */
export { purgeServiceWorkerApiCache }

export function usePwaUpdate(): PwaUpdateState {
  const { confirmIfDirty } = useNavigationGuardContext()
  const { bootVersion, latestVersion } = useVersionWatcher()

  const [applying, setApplying] = useState(false)
  const [blockedByUnsavedWork, setBlockedByUnsavedWork] = useState(false)
  const [snoozedUntil, setSnoozedUntil] = useState<number | null>(null)

  const registrationRef = useRef<ServiceWorkerRegistration | null>(null)
  const channelRef = useRef<BroadcastChannel | null>(null)
  const hiddenSinceRef = useRef<number | null>(null)

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl: string, registration?: ServiceWorkerRegistration) {
      registrationRef.current = registration ?? null
    },
    onRegisterError(error: unknown) {
      console.error('[SW] Registration error:', error)
    },
  })

  const checkForUpdate = useCallback(async () => {
    const registration = registrationRef.current
    if (registration == null) return
    try {
      await registration.update()
    } catch {
      // Offline, or the worker script 404s during a rolling deploy. The next
      // interval retries; surfacing this would be noise.
    }
  }, [])

  // Periodic poll so a tab that stays open for a week still notices deploys.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const id = window.setInterval(() => {
      void checkForUpdate()
    }, UPDATE_CHECK_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [checkForUpdate])

  // Foreground transition check. A phone that was backgrounded for an hour
  // has almost certainly missed at least one interval tick because mobile
  // browsers throttle timers in hidden tabs to a standstill.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const onVisibility = () => {
      if (document.hidden) {
        hiddenSinceRef.current = Date.now()
        return
      }
      const hiddenAt = hiddenSinceRef.current
      hiddenSinceRef.current = null
      if (hiddenAt != null && Date.now() - hiddenAt >= FOREGROUND_UPDATE_CHECK_AFTER_MS) {
        void checkForUpdate()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [checkForUpdate])

  const handshake = useMemo(
    () =>
      evaluateContractHandshake({
        serverAppVersion: latestVersion ?? bootVersion ?? undefined,
      }),
    [latestVersion, bootVersion],
  )

  // A failed handshake means anything this build cached against the previous
  // API contract is suspect. Drop it immediately rather than waiting for the
  // user to accept the update.
  const purgedForRef = useRef<string | null>(null)
  useEffect(() => {
    if (!handshake.updateRequired) return
    const key = handshake.serverVersion ?? 'unknown'
    if (purgedForRef.current === key) return
    purgedForRef.current = key
    purgeServiceWorkerApiCache()
  }, [handshake.updateRequired, handshake.serverVersion])

  // Expire the snooze without needing a user interaction to re-render.
  useEffect(() => {
    if (snoozedUntil == null || typeof window === 'undefined') return undefined
    const remaining = snoozedUntil - Date.now()
    if (remaining <= 0) {
      setSnoozedUntil(null)
      return undefined
    }
    const id = window.setTimeout(() => setSnoozedUntil(null), remaining)
    return () => window.clearTimeout(id)
  }, [snoozedUntil])

  const applyUpdate = useCallback(async () => {
    setBlockedByUnsavedWork(false)
    // Same dialog that protects in-app navigation. Resolves `true` when
    // nothing is dirty, or when the user explicitly chose to discard.
    const proceed = await confirmIfDirty()
    if (!proceed) {
      setBlockedByUnsavedWork(true)
      return
    }
    setApplying(true)
    try {
      channelRef.current?.postMessage({
        kind: 'applying',
        buildId: BUILD_ID,
      } satisfies UpdateEnvelope)
    } catch {
      // A closed channel must never block the update the user asked for.
    }
    try {
      await updateServiceWorker(true)
    } catch {
      setApplying(false)
    }
  }, [confirmIfDirty, updateServiceWorker])

  /**
   * Snooze an optional update.
   *
   * Deliberately does NOT call `setNeedRefresh(false)`. That flag is
   * vite-plugin-pwa's record of "a worker is installed and waiting", and it is
   * only ever set again when a *different* worker finishes installing.
   * Clearing it here permanently discarded the prompt for the worker that is
   * already waiting: after the snooze expired there was nothing left to
   * re-surface, so "Later" silently meant "never" until the next deploy.
   *
   * Visibility is therefore gated solely by `snoozedUntil`; `needRefresh`
   * stays true for as long as the worker is genuinely waiting.
   */
  const deferUpdate = useCallback(() => {
    if (handshake.updateRequired) return
    setBlockedByUnsavedWork(false)
    setSnoozedUntil(Date.now() + UPDATE_SNOOZE_MS)
  }, [handshake.updateRequired])

  // Sibling-tab coordination.
  useEffect(() => {
    const channel = openChannel()
    channelRef.current = channel
    if (channel == null) return undefined

    const onMessage = async (event: MessageEvent<UpdateEnvelope>) => {
      if (event.data?.kind !== 'applying') return
      // Another tab released the waiting worker. It will claim this client
      // too, so reload — but only when nothing here would be lost. A dirty
      // tab keeps its own banner and the user reloads it deliberately.
      const proceed = await confirmIfDirty()
      if (!proceed) {
        setNeedRefresh(true)
        return
      }
      window.location.reload()
    }

    channel.addEventListener('message', onMessage)
    return () => {
      channel.removeEventListener('message', onMessage)
      try {
        channel.close()
      } catch {
        /* already closed */
      }
      channelRef.current = null
    }
  }, [confirmIfDirty, setNeedRefresh])

  const release: PwaReleaseContext = useMemo(
    () => ({
      runningBuildId: BUILD_ID,
      runningAppVersion: APP_VERSION,
      runningGitSha: GIT_SHA,
      bootServerVersion: bootVersion,
      latestServerVersion: latestVersion,
      serverRedeployed:
        bootVersion != null && latestVersion != null && bootVersion !== latestVersion,
    }),
    [bootVersion, latestVersion],
  )

  // A required update is surfaced even when the SW has not finished
  // downloading its replacement: the user needs to know NOW that the tab is
  // running against an API it no longer matches.
  const updateReady = needRefresh || handshake.updateRequired
  const showPrompt =
    updateReady && (handshake.updateRequired || snoozedUntil == null)

  return {
    updateReady,
    showPrompt,
    updateRequired: handshake.updateRequired,
    handshake,
    release,
    applying,
    blockedByUnsavedWork,
    snoozedUntil,
    applyUpdate,
    deferUpdate,
    checkForUpdate,
  }
}
