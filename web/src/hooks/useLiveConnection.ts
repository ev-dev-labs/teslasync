import { useEffect, useState, useRef } from 'react'
import { sseManager } from '../lib/sseManager'

/** Overall live-data pipeline health, derived from SSE state + freshness. */
export type LiveConnectionStatus =
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'unknown'

export interface LiveConnectionState {
  /** Overall live-data health. */
  status: LiveConnectionStatus
  /** ISO timestamp of the last live message of any kind. */
  lastMessageAt: string | null
  /** Per-channel breakdown (advanced consumers). MQTT is intentionally
   *  not surfaced to end users — it is backend-internal. */
  channels: {
    sse: 'open' | 'closed' | 'error'
  }
}

/**
 * After the SSE pipe enters the "reconnecting" state, give it this long to
 * recover before we promote the UI to "disconnected" (red). Below this
 * threshold we render amber "Reconnecting…".
 *
 * 10s matches the backend heartbeat-driven UX expectation in the prompt:
 * "Within ~10s indicator turns amber 'Reconnecting…', then red 'Offline'".
 */
const RECONNECTING_GRACE_MS = 10_000

/**
 * Single source of truth for the live-data pipeline health used by
 * `<LiveIndicator>` and `<LiveStaleDataBanner>`.
 *
 * Internally this hook subscribes to the singleton `sseManager` for three
 * lifecycle events: `connected`, `disconnected`, and `heartbeat`. That has
 * two effects:
 *   1. It keeps the singleton SSE connection alive while any LiveIndicator
 *      is mounted (the manager auto-disconnects when its last subscriber
 *      leaves).
 *   2. It re-renders consumers whenever the wire state changes, so the
 *      indicator label/color updates without polling.
 *
 * Time-based transitions (reconnecting → disconnected after 10s) are driven
 * by an internal `setTimeout` rather than waiting for another SSE event,
 * because once the pipe is down there are no further events to wake us.
 */
export function useLiveConnection(): LiveConnectionState {
  // The hook tracks two pieces of state derived from the manager:
  //   - sseState: 'connected' | 'reconnecting' (raw manager state)
  //   - sinceMs:  wall-clock time the current sseState was entered
  // Plus a tick counter to force a re-render when the grace timer expires.
  const [sseState, setSseState] = useState<'connected' | 'reconnecting'>(() =>
    sseManager.getState(),
  )
  const [, setTick] = useState(0)
  const stateEnteredAtRef = useRef<number>(Date.now())
  const lastMessageAtMsRef = useRef<number | null>(sseManager.getLastMessageAt())

  useEffect(() => {
    const onConnected = () => {
      stateEnteredAtRef.current = Date.now()
      lastMessageAtMsRef.current = sseManager.getLastMessageAt()
      setSseState('connected')
    }
    const onDisconnected = () => {
      stateEnteredAtRef.current = Date.now()
      setSseState('reconnecting')
    }
    const onHeartbeat = () => {
      lastMessageAtMsRef.current = sseManager.getLastMessageAt()
      // Force a re-render so "last message Xs ago" stays fresh.
      setTick((t) => (t + 1) & 0xfffff)
    }

    sseManager.subscribe('connected', onConnected)
    sseManager.subscribe('disconnected', onDisconnected)
    sseManager.subscribe('heartbeat', onHeartbeat)

    return () => {
      sseManager.unsubscribe('connected', onConnected)
      sseManager.unsubscribe('disconnected', onDisconnected)
      sseManager.unsubscribe('heartbeat', onHeartbeat)
    }
  }, [])

  // While reconnecting, schedule a re-render at the grace boundary so the
  // status promotes from "reconnecting" to "disconnected" without needing
  // any further server traffic.
  useEffect(() => {
    if (sseState !== 'reconnecting') return
    const elapsed = Date.now() - stateEnteredAtRef.current
    const remaining = RECONNECTING_GRACE_MS - elapsed
    if (remaining <= 0) return
    const timer = window.setTimeout(() => {
      setTick((t) => (t + 1) & 0xfffff)
    }, remaining + 50)
    return () => window.clearTimeout(timer)
  }, [sseState])

  // Compute derived status and channel state.
  const elapsedMs = Date.now() - stateEnteredAtRef.current
  let status: LiveConnectionStatus
  let sseChannel: 'open' | 'closed' | 'error'
  if (sseState === 'connected') {
    status = 'connected'
    sseChannel = 'open'
  } else if (!sseManager.hasEverConnected()) {
    // Brand-new app load and we have not yet seen a successful connection.
    status = 'unknown'
    sseChannel = 'closed'
  } else if (elapsedMs < RECONNECTING_GRACE_MS) {
    status = 'reconnecting'
    sseChannel = 'closed'
  } else {
    status = 'disconnected'
    sseChannel = 'error'
  }

  const lastMs = lastMessageAtMsRef.current
  return {
    status,
    lastMessageAt: lastMs ? new Date(lastMs).toISOString() : null,
    channels: { sse: sseChannel },
  }
}
