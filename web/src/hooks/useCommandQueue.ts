import { useState, useEffect, useCallback } from 'react'
import { queueCommand, getQueuedCommands, removeQueuedItem, type QueuedCommand } from '../lib/offline-queue'
import { useOfflineStatus } from './useOfflineStatus'

interface CommandQueueState {
  queuedCommands: QueuedCommand[]
  sendCommand: (vehicleId: number, command: string, params?: Record<string, unknown>, vehicleName?: string) => Promise<boolean>
  removeCommand: (id: string) => Promise<void>
  isQueued: boolean
}

export function useCommandQueue(): CommandQueueState {
  const { isOnline, refreshQueue } = useOfflineStatus()
  const [queuedCommands, setQueuedCommands] = useState<QueuedCommand[]>([])

  const refresh = useCallback(async () => {
    const cmds = await getQueuedCommands()
    setQueuedCommands(cmds)
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 5000)
    return () => clearInterval(interval)
  }, [refresh])

  const sendCommand = useCallback(async (
    vehicleId: number,
    command: string,
    params?: Record<string, unknown>,
    vehicleName?: string
  ): Promise<boolean> => {
    if (isOnline) {
      // Try direct send first
      try {
        const res = await fetch(`/api/v1/vehicles/${vehicleId}/command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command, params }),
        })
        if (res.ok) return true
      } catch {
        // Network failed — fall through to queue
      }
    }
    // Queue for later
    await queueCommand(vehicleId, command, params, vehicleName)
    await refresh()
    await refreshQueue()
    return false
  }, [isOnline, refresh, refreshQueue])

  const removeCommand = useCallback(async (id: string) => {
    await removeQueuedItem(id)
    await refresh()
  }, [refresh])

  return {
    queuedCommands,
    sendCommand,
    removeCommand,
    isQueued: queuedCommands.length > 0,
  }
}
