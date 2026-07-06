/**
 * Subscribes to GET /api/v1/status/live.
 *
 * The backend pushes a `status` SSE event every 30s carrying the full
 * status snapshot. This hook owns the connection lifecycle and surfaces
 * three bits of state to the UI:
 *
 *   • snapshot — the latest snapshot received (null until first event)
 *   • state    — connection state ('live' | 'reconnecting' | 'offline')
 *   • lastUpdateAt — timestamp the last snapshot landed
 *
 * Reconnect strategy: exponential backoff capped at 30s, restarted
 * when the tab returns to the foreground.
 *
 * Why a dedicated hook (not the existing useSSE)? The existing hook is
 * tightly coupled to the typed `signal_change` event shape and routes
 * through the singleton `sseManager`. The status stream is a different
 * channel with its own envelope, and it's consumed only by /system-status.
 * Forking keeps both paths simple.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export type StatusSeverity = 'operational' | 'degraded' | 'down' | 'maintenance'

export interface StatusV1Snapshot {
  status: StatusSeverity
  generated_at: string
  version?: { build: string; go_version: string; started_at: string }
  components?: Array<{
    name: string
    status: string
    consecutive_failures: number
    last_check_at?: string
  }>
  resources?: { goroutines: number; uptime_seconds: number; go_version: string }
  maintenance?: { mode: string; message?: string; until?: string; source: string; updated_at?: string }
  incidents?: Array<{
    id: string
    title: string
    status: string
    severity: string
    started_at: string
    updated_at: string
    resolved_at?: string
    affected_components?: string[]
  }>
  counts?: {
    components_total: number
    components_healthy: number
    components_degraded: number
    components_unhealthy: number
  }
}

export type StatusLiveState = 'live' | 'reconnecting' | 'offline'

export interface UseStatusLiveSSEOptions {
  enabled?: boolean
  endpoint?: string
}

export interface UseStatusLiveSSEResult {
  snapshot: StatusV1Snapshot | null
  state: StatusLiveState
  lastUpdateAt: number | null
  reconnect: () => void
}

const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000

/**
 * Parse a raw `status` SSE frame body into a snapshot, or null when the frame
 * must be ignored (keeping the prior snapshot on screen).
 *
 * Two classes of frame are rejected:
 *   • malformed JSON — a partial write, or a proxy-injected keep-alive that
 *     leaked into the `data:` field; and
 *   • valid JSON that is NOT a snapshot object — `null`, a bare number, a
 *     string, or an array. This second guard matters: `JSON.parse('null')`
 *     does not throw, so without it a stray `data: null` frame would call
 *     setSnapshot(null) and blank the entire status page.
 *
 * Exported for direct unit testing, mirroring `parseSignalChangeEvent` in
 * hooks/useSSE.
 */
export function parseStatusSnapshot(raw: string): StatusV1Snapshot | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    return parsed as StatusV1Snapshot
  } catch {
    return null
  }
}

export function useStatusLiveSSE(opts: UseStatusLiveSSEOptions = {}): UseStatusLiveSSEResult {
  const { enabled = true, endpoint = '/api/v1/status/live' } = opts
  const [snapshot, setSnapshot] = useState<StatusV1Snapshot | null>(null)
  const [state, setState] = useState<StatusLiveState>('reconnecting')
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null)
  const sourceRef = useRef<EventSource | null>(null)
  const retryRef = useRef<number>(0)
  const timerRef = useRef<number | null>(null)
  const cancelledRef = useRef(false)

  const closeSource = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close()
      sourceRef.current = null
    }
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const connect = useCallback(() => {
    if (!enabled) return
    if (cancelledRef.current) return
    closeSource()
    setState((prev) => (prev === 'live' ? 'reconnecting' : prev))

    let es: EventSource
    try {
      es = new EventSource(endpoint, { withCredentials: true })
    } catch {
      setState('offline')
      return
    }
    sourceRef.current = es

    es.addEventListener('open', () => {
      retryRef.current = 0
      setState('live')
    })

    es.addEventListener('status', (ev) => {
      const next = parseStatusSnapshot((ev as MessageEvent).data)
      if (next === null) {
        // Malformed or non-object frame — keep the prior snapshot, stay live.
        return
      }
      setSnapshot(next)
      setLastUpdateAt(Date.now())
      setState('live')
    })

    es.addEventListener('heartbeat', () => {
      setState('live')
    })

    es.addEventListener('error', () => {
      if (es.readyState === EventSource.CLOSED) {
        setState('offline')
        const retry = retryRef.current++
        const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, retry), RECONNECT_MAX_MS)
        timerRef.current = window.setTimeout(connect, delay)
      } else {
        setState('reconnecting')
      }
    })
  }, [enabled, endpoint, closeSource])

  const reconnect = useCallback(() => {
    retryRef.current = 0
    connect()
  }, [connect])

  useEffect(() => {
    cancelledRef.current = false
    if (!enabled) {
      closeSource()
      setState('offline')
      return undefined
    }
    connect()

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && sourceRef.current === null) {
        reconnect()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelledRef.current = true
      document.removeEventListener('visibilitychange', onVisibility)
      closeSource()
    }
  }, [enabled, connect, closeSource, reconnect])

  return { snapshot, state, lastUpdateAt, reconnect }
}
