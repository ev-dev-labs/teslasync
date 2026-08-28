import { useEffect, useMemo, useRef, useState } from 'react'
import { sseManager } from '../lib/sseManager'

export type SSEState = 'connected' | 'reconnecting'

const SSE_ENDPOINT = '/api/v1/events'

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
  onSignalChange?: (data: unknown) => void
  onAlert?: (data: unknown) => void
  onExportStatus?: (data: unknown) => void
  onAchievementUnlocked?: (data: unknown) => void
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

    // Re-sync with the shared singleton at subscribe time. The connection may
    // already be open — another consumer opened it, or `enabled` just flipped
    // false→true — in which case no fresh `connected` event will arrive and the
    // local state would otherwise remain stale.
    setState(sseManager.getState())

    const onVehicleUpdate = (data: unknown) => callbacksRef.current.onVehicleUpdate?.(data)
    const onSignalChange = (data: unknown) => callbacksRef.current.onSignalChange?.(data)
    const onAlert = (data: unknown) => callbacksRef.current.onAlert?.(data)
    const onExportStatus = (data: unknown) => callbacksRef.current.onExportStatus?.(data)
    const onAchievementUnlocked = (data: unknown) => callbacksRef.current.onAchievementUnlocked?.(data)
    const onConnected = (data: unknown) => {
      setState('connected')
      setLastConnected(new Date())
      const d = data as { client_id?: string } | null | undefined
      callbacksRef.current.onConnected?.(d?.client_id ?? '')
    }
    const onDisconnected = () => {
      const s = sseManager.getState()
      setState(s)
      if (s === 'reconnecting') callbacksRef.current.onFallbackToPolling?.()
      callbacksRef.current.onDisconnected?.()
    }

    sseManager.subscribe('vehicle_update', onVehicleUpdate)
    sseManager.subscribe('signal_change', onSignalChange)
    sseManager.subscribe('alert', onAlert)
    sseManager.subscribe('export_status', onExportStatus)
    sseManager.subscribe('achievement_unlocked', onAchievementUnlocked)
    sseManager.subscribe('connected', onConnected)
    sseManager.subscribe('disconnected', onDisconnected)

    return () => {
      sseManager.unsubscribe('vehicle_update', onVehicleUpdate)
      sseManager.unsubscribe('signal_change', onSignalChange)
      sseManager.unsubscribe('alert', onAlert)
      sseManager.unsubscribe('export_status', onExportStatus)
      sseManager.unsubscribe('achievement_unlocked', onAchievementUnlocked)
      sseManager.unsubscribe('connected', onConnected)
      sseManager.unsubscribe('disconnected', onDisconnected)
    }
  }, [enabled])

  const connected = state === 'connected'

  const diagnostics = useMemo<SSEDiagnostics>(
    () => ({
      state,
      connected,
      failCount: 0,
      lastConnected,
      endpoint: SSE_ENDPOINT,
      nextRetryIn: null,
    }),
    [state, connected, lastConnected],
  )

  return useMemo(() => ({ connected, state, diagnostics }), [connected, state, diagnostics])
}
