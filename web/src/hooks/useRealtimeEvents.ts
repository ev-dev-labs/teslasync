import { useEffect, useRef, useState } from 'react'
import { sseManager } from '../lib/sseManager'

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
  onFallbackToPolling?: () => void
  enabled?: boolean
}

/**
 * React hook for real-time SSE events. Uses a SINGLETON connection
 * shared across all hook instances — only ONE SSE connection is open
 * no matter how many pages use useVehicleLive or useRealtimeEvents.
 */
export function useRealtimeEvents(options: SSEOptions = {}) {
  const { enabled = true } = options
  const [state, setState] = useState<SSEState>(() => sseManager.getState())
  const [lastConnected, setLastConnected] = useState<Date | null>(null)
  const callbacksRef = useRef(options)
  callbacksRef.current = options

  useEffect(() => {
    if (!enabled) return

    const onVehicleUpdate = (data: unknown) => callbacksRef.current.onVehicleUpdate?.(data)
    const onAlert = (data: unknown) => callbacksRef.current.onAlert?.(data)
    const onExportStatus = (data: unknown) => callbacksRef.current.onExportStatus?.(data)
    const onConnected = (data: unknown) => {
      setState('connected')
      setLastConnected(new Date())
      const d = data as { client_id?: string }
      callbacksRef.current.onConnected?.(d?.client_id ?? '')
    }
    const onDisconnected = () => {
      const s = sseManager.getState()
      setState(s)
      if (s === 'unavailable') callbacksRef.current.onFallbackToPolling?.()
      callbacksRef.current.onDisconnected?.()
    }

    sseManager.subscribe('vehicle_update', onVehicleUpdate)
    sseManager.subscribe('alert', onAlert)
    sseManager.subscribe('export_status', onExportStatus)
    sseManager.subscribe('connected', onConnected)
    sseManager.subscribe('disconnected', onDisconnected)

    return () => {
      sseManager.unsubscribe('vehicle_update', onVehicleUpdate)
      sseManager.unsubscribe('alert', onAlert)
      sseManager.unsubscribe('export_status', onExportStatus)
      sseManager.unsubscribe('connected', onConnected)
      sseManager.unsubscribe('disconnected', onDisconnected)
    }
  }, [enabled])

  const diagnostics: SSEDiagnostics = {
    state,
    connected: state === 'connected',
    failCount: 0,
    lastConnected,
    endpoint: '/api/v1/events',
    nextRetryIn: null,
  }

  return { connected: state === 'connected', state, diagnostics }
}
