import { useEffect, useRef, useCallback, useState } from 'react'

interface SSEOptions {
  onVehicleUpdate?: (data: unknown) => void
  onAlert?: (data: unknown) => void
  onExportStatus?: (data: unknown) => void
  onConnected?: (clientId: string) => void
  onDisconnected?: () => void
  enabled?: boolean
}

/**
 * React hook that establishes an SSE connection to /api/v1/events for
 * real-time vehicle updates and alerts. Automatically reconnects with
 * exponential backoff (up to 30s) on connection failure.
 */
export function useRealtimeEvents(options: SSEOptions = {}) {
  const { enabled = true } = options
  const [connected, setConnected] = useState(false)
  const sourceRef = useRef<EventSource | null>(null)
  const reconnectTimer = useRef<number>(undefined)
  const backoffRef = useRef(1000) // start at 1s, max 30s
  // Store callbacks in refs to avoid re-creating the connect function on every render
  const callbacksRef = useRef(options)
  callbacksRef.current = options

  const connect = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close()
    }

    const source = new EventSource('/api/v1/events')
    sourceRef.current = source

    source.addEventListener('connected', (e) => {
      setConnected(true)
      backoffRef.current = 1000 // reset backoff on successful connection
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
      setConnected(false)
      callbacksRef.current.onDisconnected?.()
      source.close()
      sourceRef.current = null
      // Exponential backoff with jitter, capped at 30s
      const jitter = Math.random() * 500
      const delay = Math.min(backoffRef.current + jitter, 30_000)
      backoffRef.current = Math.min(backoffRef.current * 2, 30_000)
      reconnectTimer.current = window.setTimeout(connect, delay)
    }
  }, []) // No dependencies — uses callbacksRef for stable reference

  useEffect(() => {
    if (!enabled) return
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      sourceRef.current?.close()
      sourceRef.current = null
    }
  }, [enabled, connect])

  return { connected }
}
