/**
 * @module hooks/useConnectionModel
 *
 * ONE global connection model for the whole SPA.
 *
 * Four independent facts were previously conflated into a single "are we
 * online?" boolean, which made the UI lie in both directions — an offline
 * banner while the API was perfectly reachable over a captive-portal Wi-Fi,
 * and a green "Live" chip while the vehicle had not pushed a signal in an
 * hour. They are genuinely different questions with different remedies:
 *
 *   1. **browser**   — `navigator.onLine`. The device has no network at all.
 *   2. **api**       — `/healthz` round-trip. The backend is reachable and
 *                      responsive (this can fail while the browser is online,
 *                      e.g. the API pod is restarting).
 *   3. **stream**    — the SSE pipe carrying server events. This can be down
 *                      while REST reads still work; the page is then correct
 *                      but no longer self-updating. Heartbeats belong here.
 *   4. **telemetry** — how long ago the *vehicle* last produced a signal,
 *                      sourced exclusively from `vehicle_update` frames via
 *                      `useTelemetryFreshness`. The stream can be perfectly
 *                      healthy while a parked, asleep car sends nothing. This
 *                      is a property of the fleet, not of the connection, and
 *                      must never turn the connection indicator red.
 *
 * Layers 3 and 4 deliberately read from different clocks. `sseManager`'s
 * `lastMessageAt` advances on every heartbeat, so using it for layer 4 would
 * report a silent fleet as permanently `fresh` — see the module comment on
 * `hooks/useTelemetryFreshness`.
 *
 * {@link deriveConnectionModel} is a pure function of those four inputs, so
 * every transition is unit-testable without jsdom event plumbing.
 *
 * ## Relationship to panel-level staleness
 *
 * This model is deliberately **global**. It says nothing about whether one
 * particular panel's query is stale — that stays with
 * `api/dataState.ts::deriveDataState`, per panel, so a single failing
 * analytics endpoint does not paint the whole application as disconnected
 * and a global outage does not silently mark every panel as fresh.
 */

import { useMemo } from 'react'

import { useApiHealth, type ApiHealthStatus } from '@/api/hooks/useApiHealth'
import { useLiveConnection, type LiveConnectionStatus } from './useLiveConnection'
import { useOnlineStatus } from './useOnlineStatus'
import {
  TELEMETRY_STALE_AFTER_MS,
  useFleetLastTelemetryAt,
  useTelemetryClock,
} from './useTelemetryFreshness'

/**
 * Re-exported from `useTelemetryFreshness`, which owns the boundary timer that
 * makes the threshold observable.
 */
export { TELEMETRY_STALE_AFTER_MS }

export type TelemetryFreshness = 'fresh' | 'stale' | 'unknown'

/** Coarse rollup shown by the global status chip. */
export type OverallConnection = 'live' | 'degraded' | 'offline' | 'unknown'

/**
 * Why the rollup is in its current state. Exposed so the indicator can
 * explain itself without re-deriving the precedence rules.
 */
export type ConnectionReason =
  | 'ok'
  | 'browser-offline'
  | 'api-unreachable'
  | 'api-degraded'
  | 'stream-down'
  | 'stream-reconnecting'
  | 'unknown'

export interface ConnectionInputs {
  browserOnline: boolean
  apiStatus: ApiHealthStatus
  streamStatus: LiveConnectionStatus
  /**
   * Epoch-ms instant of the last **fleet-wide** vehicle telemetry frame, or
   * `null` when none has been observed. Must NOT be fed from
   * `sseManager.lastMessageAt`: that advances on heartbeats and would mask a
   * silent fleet.
   */
  lastTelemetryAtMs: number | null
  now?: number
  staleAfterMs?: number
}

export interface ConnectionModel {
  /** Layer 1 — device network. */
  browser: 'online' | 'offline'
  /** Layer 2 — API reachability. */
  api: ApiHealthStatus
  /** Layer 3 — SSE pipe. */
  stream: LiveConnectionStatus
  /**
   * Layer 4 — vehicle-side data freshness. Never affects `overall`.
   *
   * `scope: 'fleet'` is explicit because this is a high-water mark across
   * every streaming vehicle, not the selected one: a chatty second car would
   * otherwise mask a silent selected car for any consumer that assumed
   * per-vehicle semantics.
   */
  telemetry: {
    scope: 'fleet'
    status: TelemetryFreshness
    /** ISO instant of the last `vehicle_update` from any vehicle, or `null`. */
    lastTelemetryAt: string | null
    ageMs: number | null
  }
  overall: OverallConnection
  reason: ConnectionReason
  /**
   * `true` when it is worth issuing a network request at all. Polling hooks
   * consult this instead of re-deriving "online && api up".
   */
  canReachApi: boolean
  /** `true` when the SPA is receiving pushed updates and need not fast-poll. */
  isStreaming: boolean
}

function freshness(
  lastTelemetryAtMs: number | null,
  now: number,
  staleAfterMs: number,
): ConnectionModel['telemetry'] {
  if (lastTelemetryAtMs == null || !Number.isFinite(lastTelemetryAtMs)) {
    return { scope: 'fleet', status: 'unknown', lastTelemetryAt: null, ageMs: null }
  }
  const ageMs = Math.max(0, now - lastTelemetryAtMs)
  return {
    scope: 'fleet',
    status: ageMs > staleAfterMs ? 'stale' : 'fresh',
    lastTelemetryAt: new Date(lastTelemetryAtMs).toISOString(),
    ageMs,
  }
}

/**
 * Pure reducer over the four layers.
 *
 * Precedence for `overall`, strongest cause first:
 *
 *   browser offline  → `offline`   (nothing else can be established)
 *   api offline      → `offline`   (reads will fail even though Wi-Fi is up)
 *   stream down      → `degraded`  (reads work; the page stops self-updating)
 *   api degraded     → `degraded`
 *   stream unknown   → `unknown`   (first paint, nothing proven yet)
 *   otherwise        → `live`
 *
 * Telemetry freshness is reported but deliberately excluded: a sleeping car
 * is not a broken connection, and conflating the two trains operators to
 * ignore a red indicator.
 */
export function deriveConnectionModel(inputs: ConnectionInputs): ConnectionModel {
  const {
    browserOnline,
    apiStatus,
    streamStatus,
    lastTelemetryAtMs,
    now = Date.now(),
    staleAfterMs = TELEMETRY_STALE_AFTER_MS,
  } = inputs

  const telemetry = freshness(lastTelemetryAtMs, now, staleAfterMs)

  let overall: OverallConnection
  let reason: ConnectionReason

  if (!browserOnline) {
    overall = 'offline'
    reason = 'browser-offline'
  } else if (apiStatus === 'offline') {
    overall = 'offline'
    reason = 'api-unreachable'
  } else if (streamStatus === 'disconnected') {
    overall = 'degraded'
    reason = 'stream-down'
  } else if (apiStatus === 'degraded') {
    overall = 'degraded'
    reason = 'api-degraded'
  } else if (streamStatus === 'reconnecting') {
    overall = 'degraded'
    reason = 'stream-reconnecting'
  } else if (apiStatus === 'unknown' || streamStatus === 'unknown') {
    overall = 'unknown'
    reason = 'unknown'
  } else {
    overall = 'live'
    reason = 'ok'
  }

  return {
    browser: browserOnline ? 'online' : 'offline',
    api: apiStatus,
    stream: streamStatus,
    telemetry,
    overall,
    reason,
    canReachApi: browserOnline && apiStatus !== 'offline',
    isStreaming: browserOnline && streamStatus === 'connected',
  }
}

/**
 * Subscribe to the global connection model.
 *
 * Composes the three existing single-purpose hooks rather than opening its
 * own listeners, so there is still exactly one `navigator.onLine`
 * subscription, one `/healthz` poller and one shared `EventSource` no matter
 * how many components read the model.
 */
export function useConnectionModel(): ConnectionModel {
  const browserOnline = useOnlineStatus()
  const { status: apiStatus } = useApiHealth()
  // `lastMessageAt` from useLiveConnection is deliberately NOT read here: it
  // advances on heartbeats and would report a silent fleet as fresh.
  const { status: streamStatus } = useLiveConnection()
  const lastTelemetryAtMs = useFleetLastTelemetryAt()
  // Freshness is a function of `now`, and nothing in the event stream fires
  // when a reading merely ages. Without this clock the memo below stays cached
  // and a silent fleet is reported as `fresh` forever, even while heartbeats
  // re-render the SSE layer.
  const clock = useTelemetryClock()

  return useMemo(
    () => deriveConnectionModel({ browserOnline, apiStatus, streamStatus, lastTelemetryAtMs }),
    [browserOnline, apiStatus, streamStatus, lastTelemetryAtMs, clock],
  )
}
