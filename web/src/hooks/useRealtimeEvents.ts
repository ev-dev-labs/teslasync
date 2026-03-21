import { useEffect, useRef, useCallback, useState } from 'react'

export type SSEConnectionStatus = 'connected' | 'reconnecting' | 'disconnected'

interface BufferedEvent {
  type: string
  data: unknown
  timestamp: number
}

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
 * exponential backoff (up to 30s) on connection failure. Buffers missed
 * events during disconnect and replays them on reconnect.
 */
export function useRealtimeEvents(options: SSEOptions = {}) {
  const { enabled = true, onVehicleUpdate, onAlert, onConnected, onDisconnected } = options
  const [connected, setConnected] = useState(false)
  const [status, setStatus] = useState<SSEConnectionStatus>('disconnected')
  const [reconnectCount, setReconnectCount] = useState(0)
  const sourceRef = useRef<EventSource | null>(null)
  const reconnectTimer = useRef<number>(undefined)
  const backoffRef = useRef(1000) // start at 1s, max 30s
  const eventBufferRef = useRef<BufferedEvent[]>([])
  const hasConnectedOnce = useRef(false)

  const flushEventBuffer = useCallback(() => {
    const buffer = eventBufferRef.current
    eventBufferRef.current = []
    for (const event of buffer) {
      if (event.type === 'vehicle_update') onVehicleUpdate?.(event.data)
      else if (event.type === 'alert') onAlert?.(event.data)
    }
  }, [onVehicleUpdate, onAlert])

  const connect = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close()
    }

    const source = new EventSource('/api/v1/events')
    sourceRef.current = source

    source.addEventListener('connected', (e) => {
      setConnected(true)
      setStatus('connected')
      backoffRef.current = 1000 // reset backoff on successful connection
      if (hasConnectedOnce.current) {
        setReconnectCount(c => c + 1)
      }
      hasConnectedOnce.current = true
      const data = JSON.parse(e.data)
      onConnected?.(data.client_id)
      // Flush any events buffered during disconnect
      flushEventBuffer()
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
      setConnected(false)
      const wasConnected = hasConnectedOnce.current
      setStatus(wasConnected ? 'reconnecting' : 'disconnected')
      onDisconnected?.()
      source.close()
      sourceRef.current = null
      // Exponential backoff with jitter, capped at 30s
      const jitter = Math.random() * 500
      const delay = Math.min(backoffRef.current + jitter, 30_000)
      backoffRef.current = Math.min(backoffRef.current * 2, 30_000)
      reconnectTimer.current = window.setTimeout(connect, delay)
    }
  }, [onVehicleUpdate, onAlert, onConnected, onDisconnected, flushEventBuffer])

  /** Buffer an event to replay after reconnection */
  const bufferEvent = useCallback((type: string, data: unknown) => {
    eventBufferRef.current.push({ type, data, timestamp: Date.now() })
    // Keep buffer bounded to prevent memory leaks
    if (eventBufferRef.current.length > 200) {
      eventBufferRef.current = eventBufferRef.current.slice(-100)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      sourceRef.current?.close()
      sourceRef.current = null
      setStatus('disconnected')
    }
  }, [enabled, connect])

  return { connected, status, reconnectCount, bufferEvent }
}
