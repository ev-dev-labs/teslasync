import { useEffect, useRef, useCallback, useState } from 'react'

export type SSEConnectionStatus = 'connected' | 'reconnecting' | 'disconnected'

interface SSEOptions {
  onVehicleUpdate?: (data: unknown) => void
  onAlert?: (data: unknown) => void
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
  const { enabled = true, onVehicleUpdate, onAlert, onConnected, onDisconnected } = options
  const [status, setStatus] = useState<SSEConnectionStatus>('disconnected')
  const [reconnectCount, setReconnectCount] = useState(0)
  const sourceRef = useRef<EventSource | null>(null)
  const reconnectTimer = useRef<number>(undefined)
  const backoffRef = useRef(1000) // start at 1s, max 30s

  const connect = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close()
    }

    const source = new EventSource('/api/v1/events')
    sourceRef.current = source

    source.addEventListener('connected', (e) => {
      setStatus('connected')
      setReconnectCount(0)
      backoffRef.current = 1000 // reset backoff on successful connection
      const data = JSON.parse(e.data)
      onConnected?.(data.client_id)
    })

    source.addEventListener('vehicle_update', (e) => {
      const data = JSON.parse(e.data)
      onVehicleUpdate?.(data)
    })

    source.addEventListener('alert', (e) => {
      const data = JSON.parse(e.data)
      onAlert?.(data)
    })

    source.addEventListener('heartbeat', () => {
      // Keep-alive received
    })

    source.onerror = () => {
      setStatus('reconnecting')
      setReconnectCount((c) => c + 1)
      onDisconnected?.()
      source.close()
      sourceRef.current = null
      // Exponential backoff with jitter, capped at 30s
      const jitter = Math.random() * 500
      const delay = Math.min(backoffRef.current + jitter, 30_000)
      backoffRef.current = Math.min(backoffRef.current * 2, 30_000)
      reconnectTimer.current = window.setTimeout(connect, delay)
    }
  }, [onVehicleUpdate, onAlert, onConnected, onDisconnected])

  useEffect(() => {
    if (!enabled) return
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      sourceRef.current?.close()
      sourceRef.current = null
    }
  }, [enabled, connect])

  const connected = status === 'connected'
  return { connected, status, reconnectCount }
}
