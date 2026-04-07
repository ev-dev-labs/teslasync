import { useEffect, useRef, useCallback, useState } from 'react'

export type SSEState = 'connected' | 'reconnecting' | 'unavailable'

export interface SSEDiagnostics {
  state: SSEState
  connected: boolean
  failCount: number
  lastConnected: Date | null
  endpoint: string
  nextRetryIn: number | null
}

interface SSEOptions {
  onVehicleUpdate?: (data: unknown) => void
  onAlert?: (data: unknown) => void
  onExportStatus?: (data: unknown) => void
  onConnected?: (clientId: string) => void
  onDisconnected?: () => void
  enabled?: boolean
}

/**
 * Fetches an SSE auth token from the backend. The /sse-token endpoint is
 * behind authentik ForwardAuth, so it returns the JWT that was injected by
 * Traefik. Returns null if the endpoint isn't available (dev mode).
 */
async function fetchSSEToken(): Promise<string | null> {
  try {
    const res = await fetch('/api/v1/sse-token')
    if (!res.ok) return null
    const data = await res.json()
    return data.token || null
  } catch {
    return null
  }
}

/**
 * React hook that establishes an SSE connection to /api/v1/events for
 * real-time vehicle updates and alerts. Automatically reconnects with
 * exponential backoff (up to 30s) on connection failure.
 *
 * Returns a richer state:
 * - `connected`: live SSE stream active
 * - `reconnecting`: temporarily lost, retrying (1-3 attempts)
 * - `unavailable`: SSE not available, app uses polling fallback
 *
 * After giving up, retries every 5 minutes in case the issue resolves.
 */
export function useRealtimeEvents(options: SSEOptions = {}) {
  const { enabled = true } = options
  const [state, setState] = useState<SSEState>('reconnecting')
  const [failCount, setFailCount] = useState(0)
  const [lastConnected, setLastConnected] = useState<Date | null>(null)
  const [nextRetryIn, setNextRetryIn] = useState<number | null>(null)
  const sourceRef = useRef<EventSource | null>(null)
  const reconnectTimer = useRef<number>(undefined)
  const retryTimer = useRef<number>(undefined)
  const backoffRef = useRef(1000) // start at 1s, max 30s
  const failCountRef = useRef(0)
  const callbacksRef = useRef(options)
  callbacksRef.current = options

  const connect = useCallback(async () => {
    if (sourceRef.current) {
      sourceRef.current.close()
    }

    const token = await fetchSSEToken()
    const url = token ? `/api/v1/events?token=${encodeURIComponent(token)}` : '/api/v1/events'

    const source = new EventSource(url)
    sourceRef.current = source

    source.addEventListener('connected', (e) => {
      setState('connected')
      backoffRef.current = 1000
      failCountRef.current = 0
      setFailCount(0)
      setLastConnected(new Date())
      setNextRetryIn(null)
      if (retryTimer.current) {
        clearTimeout(retryTimer.current)
        retryTimer.current = undefined
      }
      const data = JSON.parse(e.data)
      callbacksRef.current.onConnected?.(data.client_id)
    })

    source.addEventListener('vehicle_update', (e) => {
      const data = JSON.parse(e.data)
      callbacksRef.current.onVehicleUpdate?.(data)
    })

    source.addEventListener('alert', (e) => {
      const data = JSON.parse(e.data)
      callbacksRef.current.onAlert?.(data)
    })

    source.addEventListener('export_status', (e) => {
      const data = JSON.parse(e.data)
      callbacksRef.current.onExportStatus?.(data)
    })

    source.addEventListener('heartbeat', () => {
      // Keep-alive received
    })

    source.onerror = () => {
      callbacksRef.current.onDisconnected?.()
      source.close()
      sourceRef.current = null
      failCountRef.current++
      setFailCount(failCountRef.current)

      if (failCountRef.current >= 3) {
        setState('unavailable')
        setNextRetryIn(300)
        console.debug('[SSE] Falling back to polling — will retry in 5m')
        if (!retryTimer.current) {
          retryTimer.current = window.setInterval(() => {
            failCountRef.current = 0
            backoffRef.current = 1000
            setFailCount(0)
            setState('reconnecting')
            setNextRetryIn(null)
            connect()
          }, 5 * 60_000)
        }
        return
      }

      setState('reconnecting')
      const jitter = Math.random() * 500
      const delay = Math.min(backoffRef.current + jitter, 30_000)
      backoffRef.current = Math.min(backoffRef.current * 2, 30_000)
      reconnectTimer.current = window.setTimeout(connect, delay)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      if (retryTimer.current) clearInterval(retryTimer.current)
      sourceRef.current?.close()
      sourceRef.current = null
    }
  }, [enabled, connect])

  const endpoint = '/api/v1/events'

  const diagnostics: SSEDiagnostics = {
    state,
    connected: state === 'connected',
    failCount,
    lastConnected,
    endpoint,
    nextRetryIn,
  }

  return { connected: state === 'connected', state, diagnostics }
}
