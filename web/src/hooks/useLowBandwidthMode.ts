/**
 * @module hooks/useLowBandwidthMode
 *
 * The single source of truth for "should this device spend bandwidth?"
 * (PWA-07).
 *
 * Two independent signals feed one answer:
 *
 *   1. **The user's persisted choice** — an explicit tri-state stored in
 *      `localStorage` and mirrored across tabs. `auto` defers to the network,
 *      `on` forces low-bandwidth behaviour even on fibre (useful when a phone
 *      is tethered or on a metered hotspot the browser cannot detect), and
 *      `off` opts out of the automatic downgrade entirely.
 *   2. **The network's own signal** — `navigator.connection.saveData` (the
 *      OS/browser Data Saver switch) or a 2G-class `effectiveType`. Only
 *      Chromium implements `NetworkInformation`; a missing API means "no
 *      signal", which is treated as "spend freely", matching the behaviour
 *      the app had before this module existed.
 *
 * Everything that must throttle under a constrained link reads from here so
 * there is exactly one rule, not five subtly different ones:
 *
 *   - polling              → `hooks/useRefreshPolicy.ts` (`useSaveData`)
 *   - animations           → `hooks/useMotionPreference.ts`
 *   - chart point budgets  → `components/charts/chartSampling.ts`
 *   - map tiles            → `components/maps/MapTileLayer.tsx`
 *   - service worker media caching → `src/sw/sw.ts` via
 *     `PAGE_TO_SW.lowBandwidth`
 *
 * The store deliberately exposes an imperative `subscribe`/`read` pair in
 * addition to the React hook so non-React callers (the service-worker bridge,
 * the prefetch policy) share the same state without a provider.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react'

export const LOW_BANDWIDTH_STORAGE_KEY = 'teslasync:low-bandwidth:v1'

/**
 * Dedicated cross-tab channel.
 *
 * The central `@/lib/broadcast` bus is deliberately NOT used, for the same
 * reason `useVersionWatcher` avoids it: this store is read by
 * `useMotionPreference`, which is mounted by virtually every animated
 * component in the app. Routing it through the shared bus would make every
 * component test that stubs `@/lib/broadcast` accidentally observe (and
 * unsubscribe) this store's traffic.
 */
const LOW_BANDWIDTH_CHANNEL = 'teslasync:low-bandwidth'

export const LOW_BANDWIDTH_MODES = ['auto', 'on', 'off'] as const
export type LowBandwidthMode = (typeof LOW_BANDWIDTH_MODES)[number]

export const DEFAULT_LOW_BANDWIDTH_MODE: LowBandwidthMode = 'auto'

/** Effective connection types that are treated as constrained. */
const SLOW_EFFECTIVE_TYPES = new Set(['slow-2g', '2g'])

interface NetworkInformationLike {
  saveData?: boolean
  effectiveType?: string
  addEventListener?: (type: 'change', listener: () => void) => void
  removeEventListener?: (type: 'change', listener: () => void) => void
}

function connection(): NetworkInformationLike | null {
  if (typeof navigator === 'undefined') return null
  const nav = navigator as Navigator & {
    connection?: NetworkInformationLike
    mozConnection?: NetworkInformationLike
    webkitConnection?: NetworkInformationLike
  }
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection ?? null
}

/**
 * `true` when the network stack itself reports a constrained link.
 * Exported so `useRefreshPolicy` and the tests can reason about the raw
 * signal separately from the user's preference.
 */
export function readNetworkSaveData(): boolean {
  const conn = connection()
  if (conn == null) return false
  if (conn.saveData === true) return true
  return (
    typeof conn.effectiveType === 'string'
    && SLOW_EFFECTIVE_TYPES.has(conn.effectiveType)
  )
}

/** Subscribe to `NetworkInformation` changes. No-ops where unsupported. */
export function subscribeNetworkSaveData(onChange: () => void): () => void {
  const conn = connection()
  if (conn?.addEventListener == null) return () => {}
  conn.addEventListener('change', onChange)
  return () => conn.removeEventListener?.('change', onChange)
}

function isLowBandwidthMode(value: unknown): value is LowBandwidthMode {
  return (
    typeof value === 'string'
    && (LOW_BANDWIDTH_MODES as readonly string[]).includes(value)
  )
}

function readStoredMode(): LowBandwidthMode {
  if (typeof window === 'undefined') return DEFAULT_LOW_BANDWIDTH_MODE
  try {
    const raw = window.localStorage.getItem(LOW_BANDWIDTH_STORAGE_KEY)
    return isLowBandwidthMode(raw) ? raw : DEFAULT_LOW_BANDWIDTH_MODE
  } catch {
    // Private mode / storage disabled: fall back to the automatic policy
    // rather than failing the render.
    return DEFAULT_LOW_BANDWIDTH_MODE
  }
}

let mode: LowBandwidthMode = readStoredMode()
const listeners = new Set<() => void>()
let detachExternal: (() => void) | null = null
let channel: BroadcastChannel | null = null

function notify(): void {
  for (const listener of listeners) listener()
}

function syncFromStorage(): void {
  const next = readStoredMode()
  if (next === mode) return
  mode = next
  notify()
}

function handleStorage(event: StorageEvent): void {
  if (event.key !== LOW_BANDWIDTH_STORAGE_KEY && event.key !== null) return
  syncFromStorage()
}

function openChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    return new BroadcastChannel(LOW_BANDWIDTH_CHANNEL)
  } catch {
    // Private mode / hardened browsers: the `storage` event still covers
    // most cross-tab cases.
    return null
  }
}

function attachExternalListeners(): void {
  if (detachExternal != null || typeof window === 'undefined') return
  window.addEventListener('storage', handleStorage)
  channel = openChannel()
  const onChannelMessage = () => syncFromStorage()
  channel?.addEventListener('message', onChannelMessage)
  const stopNetwork = subscribeNetworkSaveData(notify)
  detachExternal = () => {
    window.removeEventListener('storage', handleStorage)
    channel?.removeEventListener('message', onChannelMessage)
    try {
      channel?.close()
    } catch {
      /* already closed */
    }
    channel = null
    stopNetwork()
  }
}

/** Current persisted preference, without the network signal folded in. */
export function getLowBandwidthMode(): LowBandwidthMode {
  return mode
}

/** Persist a new preference and fan it out to this tab and its siblings. */
export function setLowBandwidthMode(next: LowBandwidthMode): LowBandwidthMode {
  const resolved = isLowBandwidthMode(next) ? next : DEFAULT_LOW_BANDWIDTH_MODE
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(LOW_BANDWIDTH_STORAGE_KEY, resolved)
    } catch {
      // Keep the in-memory value so the current tab still honours the choice.
    }
  }
  if (resolved !== mode) {
    mode = resolved
    notify()
    try {
      channel?.postMessage({ mode: resolved })
    } catch {
      /* closed channel — siblings still get the `storage` event */
    }
  }
  return resolved
}

/** Subscribe to preference OR network changes. */
export function subscribeLowBandwidth(listener: () => void): () => void {
  attachExternalListeners()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && detachExternal != null) {
      detachExternal()
      detachExternal = null
    }
  }
}

/** Where the effective answer came from. Surfaced in the settings UI. */
export type LowBandwidthSource = 'user' | 'network' | 'none'

export interface LowBandwidthState {
  mode: LowBandwidthMode
  enabled: boolean
  source: LowBandwidthSource
}

/**
 * Pure resolution of the two signals. Extracted so the precedence rules are
 * testable without jsdom `navigator.connection` plumbing.
 *
 * `off` deliberately wins over a network `saveData` hint: the user has made
 * an explicit, informed choice and the browser heuristic must not override it.
 */
export function resolveLowBandwidth(
  preferred: LowBandwidthMode,
  networkSaveData: boolean,
): LowBandwidthState {
  if (preferred === 'on') return { mode: preferred, enabled: true, source: 'user' }
  if (preferred === 'off') return { mode: preferred, enabled: false, source: 'none' }
  return networkSaveData
    ? { mode: preferred, enabled: true, source: 'network' }
    : { mode: preferred, enabled: false, source: 'none' }
}

/** Imperative read for non-React callers (service-worker bridge, tests). */
export function isLowBandwidthActive(): boolean {
  return resolveLowBandwidth(mode, readNetworkSaveData()).enabled
}

function getSnapshot(): string {
  const state = resolveLowBandwidth(mode, readNetworkSaveData())
  // `useSyncExternalStore` compares snapshots by identity, so the store must
  // hand back a primitive rather than a fresh object on every read.
  return `${state.mode}|${state.enabled ? '1' : '0'}|${state.source}`
}

function getServerSnapshot(): string {
  return `${DEFAULT_LOW_BANDWIDTH_MODE}|0|none`
}

function parseSnapshot(snapshot: string): LowBandwidthState {
  const [rawMode, rawEnabled, rawSource] = snapshot.split('|')
  return {
    mode: isLowBandwidthMode(rawMode) ? rawMode : DEFAULT_LOW_BANDWIDTH_MODE,
    enabled: rawEnabled === '1',
    source: (rawSource as LowBandwidthSource) ?? 'none',
  }
}

export interface UseLowBandwidthModeResult extends LowBandwidthState {
  setMode: (next: LowBandwidthMode) => void
}

/**
 * Read + write the low-bandwidth preference.
 *
 * ```tsx
 * const { enabled, mode, setMode } = useLowBandwidthMode()
 * ```
 */
export function useLowBandwidthMode(): UseLowBandwidthModeResult {
  const snapshot = useSyncExternalStore(
    subscribeLowBandwidth,
    getSnapshot,
    getServerSnapshot,
  )
  const state = useMemo(() => parseSnapshot(snapshot), [snapshot])
  const setMode = useCallback((next: LowBandwidthMode) => {
    setLowBandwidthMode(next)
  }, [])
  return { ...state, setMode }
}

/**
 * The concrete knobs derived from low-bandwidth mode.
 *
 * Kept as data (not booleans scattered through components) so a future change
 * to "what low bandwidth means" happens in exactly one place and every
 * consumer inherits it.
 */
export interface DataSaverPolicy {
  /** `true` when the device is currently in low-bandwidth mode. */
  lowBandwidth: boolean
  /** Run entrance/loop animations. */
  animations: boolean
  /** Download speculative route chunks on hover/focus. */
  prefetch: boolean
  /** Keep imagery/satellite basemaps, or fall back to the lightest raster. */
  richMapTiles: boolean
  /** Ceiling on rendered chart points before stride downsampling kicks in. */
  chartPointBudget: number
  /** Multiplier applied to non-essential polling intervals. */
  pollingIntervalMultiplier: number
}

const FULL_POLICY: Readonly<DataSaverPolicy> = Object.freeze({
  lowBandwidth: false,
  animations: true,
  prefetch: true,
  richMapTiles: true,
  chartPointBudget: 400,
  pollingIntervalMultiplier: 1,
})

const SAVER_POLICY: Readonly<DataSaverPolicy> = Object.freeze({
  lowBandwidth: true,
  animations: false,
  prefetch: false,
  richMapTiles: false,
  chartPointBudget: 120,
  pollingIntervalMultiplier: 4,
})

/** Pure form of {@link useDataSaverPolicy}. */
export function resolveDataSaverPolicy(lowBandwidth: boolean): DataSaverPolicy {
  return lowBandwidth ? { ...SAVER_POLICY } : { ...FULL_POLICY }
}

/** Hook form — re-renders when the effective mode changes. */
export function useDataSaverPolicy(): DataSaverPolicy {
  const { enabled } = useLowBandwidthMode()
  return useMemo(() => resolveDataSaverPolicy(enabled), [enabled])
}

/** Test seam: reset module state between cases. */
export function __resetLowBandwidthStoreForTests(): void {
  detachExternal?.()
  detachExternal = null
  listeners.clear()
  mode = readStoredMode()
}
