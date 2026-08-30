/**
 * @module hooks/useRefreshPolicy
 *
 * Decides whether a query is allowed to poll right now, and how fast.
 *
 * TanStack Query's `refetchIntervalInBackground: false` (set app-wide in
 * `api/queryClient.ts`) already pauses polling on a hidden tab. That covers
 * one of the four conditions under which a background refresh is pure waste:
 *
 *   1. the tab is hidden                      → handled by the query client
 *   2. the device has no network              → the request cannot succeed
 *   3. the API is unreachable                 → every poll is a guaranteed 5xx
 *   4. the user asked for reduced data usage  → the persisted low-bandwidth
 *      preference (`hooks/useLowBandwidthMode`) or `navigator.connection`
 *      reporting `saveData` / a 2G-class effective connection type
 *
 * This module handles 2–4 and layers a priority system on top so that the
 * handful of genuinely essential pollers (an in-progress charge, a live drive)
 * behave differently from decorative ones.
 *
 * All of the logic lives in the pure {@link resolveRefreshInterval} so the
 * matrix is testable without jsdom media/visibility plumbing.
 */

import { useMemo, useSyncExternalStore } from 'react'

import { useConnectionModel } from './useConnectionModel'
import { isLowBandwidthActive, subscribeLowBandwidth } from './useLowBandwidthMode'

/**
 * How badly a surface needs to keep polling.
 *
 * - `essential`  — an operator is watching a live operation. Keeps polling
 *   while the tab is hidden IF the caller also sets
 *   `refetchIntervalInBackground: true` with the required `ALLOW-BG-POLLING`
 *   annotation; this hook never sets that flag itself.
 * - `standard`   — the default. Pauses while hidden/offline, slows down under
 *   save-data.
 * - `background` — nice-to-have counters and decorative tickers. Suppressed
 *   entirely under save-data or on a degraded API.
 */
export type RefreshPriority = 'essential' | 'standard' | 'background'

/** Multiplier applied to `standard` pollers when the user requested less data. */
export const SAVE_DATA_INTERVAL_MULTIPLIER = 4

export interface RefreshContext {
  documentHidden: boolean
  /** Device-level network availability. */
  online: boolean
  /** API reachability, independent of the device network. */
  apiReachable: boolean
  /** User/network requested reduced data usage. */
  saveData: boolean
  /** SSE is delivering pushed updates, so polling is only a safety net. */
  streaming?: boolean
  priority?: RefreshPriority
}

/**
 * Resolve the effective `refetchInterval` for a poller.
 *
 * Returns `false` (polling disabled) rather than a large number when a poll
 * would be wasted, because `false` also stops TanStack Query from scheduling
 * a timer at all.
 *
 * Order of evaluation is significant — a suppressing condition short-circuits
 * before any interval arithmetic, so a `NaN`/negative base can never leak into
 * the scheduler.
 */
export function resolveRefreshInterval(
  baseMs: number | false,
  context: RefreshContext,
): number | false {
  if (baseMs === false) return false
  if (!Number.isFinite(baseMs) || baseMs <= 0) return false

  const priority = context.priority ?? 'standard'

  // No network: the request cannot succeed, and TanStack would pause it in
  // `offlineFirst` mode anyway. Returning false avoids the wake-up timer.
  if (!context.online) return false
  // API unreachable: keep the essential pollers probing for recovery, but
  // stop everything else from hammering a dead backend.
  if (!context.apiReachable && priority !== 'essential') return false

  if (context.documentHidden && priority !== 'essential') return false

  if (context.saveData) {
    if (priority === 'background') return false
    if (priority === 'standard') return baseMs * SAVE_DATA_INTERVAL_MULTIPLIER
  }

  // With SSE delivering pushes, the poll is only a safety net for missed
  // events; halving the frequency of decorative pollers costs nothing.
  if (context.streaming === true && priority === 'background') {
    return baseMs * 2
  }

  return baseMs
}

function serverSaveData(): boolean {
  return false
}

/**
 * `true` when reduced data usage is in effect: either the user's persisted
 * low-bandwidth preference (`hooks/useLowBandwidthMode`) or the network's own
 * signal — an OS/browser Data Saver toggle, or an effective connection type of
 * 2G/slow-2G where a background poll would measurably degrade the foreground
 * experience.
 *
 * The network detection itself lives in `useLowBandwidthMode` so polling,
 * animations, chart budgets, map tiles and the service worker all answer the
 * question identically instead of each re-implementing `navigator.connection`.
 */
export function useSaveData(): boolean {
  return useSyncExternalStore(
    subscribeLowBandwidth,
    isLowBandwidthActive,
    serverSaveData,
  )
}

function subscribeVisibility(onStoreChange: () => void): () => void {
  if (typeof document === 'undefined') return () => {}
  document.addEventListener('visibilitychange', onStoreChange)
  return () => document.removeEventListener('visibilitychange', onStoreChange)
}

function readHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden === true
}

function serverHidden(): boolean {
  return false
}

/** `true` while the tab is not visible. Backed by `visibilitychange`. */
export function useDocumentHidden(): boolean {
  return useSyncExternalStore(subscribeVisibility, readHidden, serverHidden)
}

export interface UseRefreshIntervalOptions {
  priority?: RefreshPriority
  /** Force polling off regardless of connection state (e.g. a paused view). */
  enabled?: boolean
}

/**
 * Hook form of {@link resolveRefreshInterval}, wired to the global connection
 * model, the tab's visibility and the user's data-saver preference.
 *
 * ```ts
 * useQuery({
 *   ...queryPolicy('live'),
 *   refetchInterval: useRefreshInterval(INTERVALS.REALTIME),
 * })
 * ```
 */
export function useRefreshInterval(
  baseMs: number | false,
  options: UseRefreshIntervalOptions = {},
): number | false {
  const { priority = 'standard', enabled = true } = options
  const connection = useConnectionModel()
  const saveData = useSaveData()
  const documentHidden = useDocumentHidden()

  return useMemo(() => {
    if (!enabled) return false
    return resolveRefreshInterval(baseMs, {
      documentHidden,
      online: connection.browser === 'online',
      apiReachable: connection.canReachApi,
      saveData,
      streaming: connection.isStreaming,
      priority,
    })
  }, [
    baseMs,
    enabled,
    priority,
    saveData,
    documentHidden,
    connection.browser,
    connection.canReachApi,
    connection.isStreaming,
  ])
}
