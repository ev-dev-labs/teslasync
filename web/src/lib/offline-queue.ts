import { addToSyncQueue, getSyncQueue, removeSyncQueueItem, updateSyncQueueItem } from './idb'

export interface QueuedCommand {
  id: string
  type: 'command'
  vehicleId: number
  vehicleName?: string
  command: string
  params?: Record<string, unknown>
  timestamp: number
  status: 'pending' | 'syncing' | 'failed'
  retries: number
  error?: string
}

export interface QueuedExport {
  id: string
  type: 'export'
  payload: Record<string, unknown>
  timestamp: number
  status: 'pending' | 'syncing' | 'failed'
  retries: number
  error?: string
}

export type QueuedItem = QueuedCommand | QueuedExport

export async function queueCommand(
  vehicleId: number,
  command: string,
  params?: Record<string, unknown>,
  vehicleName?: string
): Promise<QueuedCommand> {
  const entry = await addToSyncQueue({
    type: 'command',
    vehicleId,
    command,
    params,
    payload: { vehicleName },
  })
  return entry as unknown as QueuedCommand
}

export async function queueExport(payload: Record<string, unknown>): Promise<QueuedExport> {
  const entry = await addToSyncQueue({
    type: 'export',
    payload,
  })
  return entry as unknown as QueuedExport
}

export async function getQueuedItems(): Promise<QueuedItem[]> {
  const items = await getSyncQueue()
  return items.sort((a, b) => b.timestamp - a.timestamp) as unknown as QueuedItem[]
}

export async function getQueuedCommands(): Promise<QueuedCommand[]> {
  const items = await getSyncQueue()
  return items
    .filter(i => i.type === 'command')
    .sort((a, b) => b.timestamp - a.timestamp) as unknown as QueuedCommand[]
}

export async function removeQueuedItem(id: string) {
  await removeSyncQueueItem(id)
}

export async function processQueue(): Promise<{ success: number; failed: number }> {
  const items = await getSyncQueue()
  let success = 0
  let failed = 0

  for (const item of items) {
    if (item.status === 'syncing') continue

    // Skip stale commands (>5 minutes old)
    if (item.type === 'command' && Date.now() - item.timestamp > 5 * 60 * 1000) {
      await removeSyncQueueItem(item.id)
      continue
    }

    await updateSyncQueueItem(item.id, { status: 'syncing' })

    try {
      if (item.type === 'command' && item.vehicleId) {
        await fetch(`/api/v1/vehicles/${item.vehicleId}/command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: item.command, params: item.params }),
        })
      } else if (item.type === 'export') {
        await fetch('/api/v1/export/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.payload),
        })
      }
      await removeSyncQueueItem(item.id)
      success++
    } catch {
      const retries = (item.retries || 0) + 1
      if (retries >= 3) {
        await updateSyncQueueItem(item.id, { status: 'failed', retries, error: 'Max retries exceeded' })
        failed++
      } else {
        await updateSyncQueueItem(item.id, { status: 'pending', retries })
        failed++
      }
    }
  }

  return { success, failed }
}
