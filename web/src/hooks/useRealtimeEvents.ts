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
  const backoffRef = useRef(1000)
  const eventBufferRef = useRef<BufferedEvent[]>([])
  const hasConnectedOnce = useRef(false)

  // Store callbacks in refs to avoid recreating the connection on every render
  const cbRefs = useRef({ onVehicleUpdate, onAlert, onConnected, onDisconnected })
  cbRefs.current = { onVehicleUpdate, onAlert, onConnected, onDisconnected }

  const connect = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close()
    }

    const source = new EventSource('/api/v1/events')
    sourceRef.current = source

    source.addEventListener('connected', (e) => {
      setConnected(true)
      setStatus('connected')
      backoffRef.current = 1000
      if (hasConnectedOnce.current) {
        setReconnectCount(c => c + 1)
      }
      hasConnectedOnce.current = true
      const data = JSON.parse(e.data)
      cbRefs.current.onConnected?.(data.client_id)
      // Flush buffered events
      const buffer = eventBufferRef.current
      eventBufferRef.current = []
      for (const evt of buffer) {
        if (evt.type === 'vehicle_update') cbRefs.current.onVehicleUpdate?.(evt.data)
        else if (evt.type === 'alert') cbRefs.current.onAlert?.(evt.data)
      }
    })

    source.addEventListener('vehicle_update', (e) => {
      cbRefs.current.onVehicleUpdate?.(JSON.parse(e.data))
    })

    source.addEventListener('alert', (e) => {
      cbRefs.current.onAlert?.(JSON.parse(e.data))
    })

    source.addEventListener('heartbeat', () => {
      // Keep-alive received
    })

    source.onerror = () => {
      setConnected(false)
      const wasConnected = hasConnectedOnce.current
      setStatus(wasConnected ? 'reconnecting' : 'disconnected')
      cbRefs.current.onDisconnected?.()
      source.close()
      sourceRef.current = null
      const jitter = Math.random() * 500
      const delay = Math.min(backoffRef.current + jitter, 30_000)
      backoffRef.current = Math.min(backoffRef.current * 2, 30_000)
      reconnectTimer.current = window.setTimeout(connect, delay)
    }
  }, []) // no deps — callbacks accessed via stable refs

  const bufferEvent = useCallback((type: string, data: unknown) => {
    eventBufferRef.current.push({ type, data, timestamp: Date.now() })
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
