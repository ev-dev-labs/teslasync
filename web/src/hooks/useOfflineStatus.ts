import { useState, useEffect, useCallback } from 'react'
import { processQueue, getQueuedItems, type QueuedItem } from '../lib/offline-queue'
import { evictExpiredCache, getStorageEstimate } from '../lib/idb'

interface OfflineState {
  isOnline: boolean
  wasOffline: boolean
  queuedItems: QueuedItem[]
  storagePercent: number
  syncPending: boolean
  lastSyncedAt: number | null
  refreshQueue: () => Promise<void>
}

export function useOfflineStatus(): OfflineState {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [wasOffline, setWasOffline] = useState(false)
  const [queuedItems, setQueuedItems] = useState<QueuedItem[]>([])
  const [storagePercent, setStoragePercent] = useState(0)
  const [syncPending, setSyncPending] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(() => {
    const stored = localStorage.getItem('teslasync-last-synced')
    return stored ? parseInt(stored) : null
  })

  const refreshQueue = useCallback(async () => {
    try {
      const items = await getQueuedItems()
      setQueuedItems(items)
    } catch {
      // IDB might not be available
    }
  }, [])

  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true)
      // Process queued items when back online
      const pending = await getQueuedItems()
      if (pending.length > 0) {
        setSyncPending(true)
        await processQueue()
        setSyncPending(false)
        const now = Date.now()
        setLastSyncedAt(now)
        localStorage.setItem('teslasync-last-synced', String(now))
      }
      await refreshQueue()
    }

    const handleOffline = () => {
      setIsOnline(false)
      setWasOffline(true)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // Initial load
    refreshQueue()
    getStorageEstimate().then(({ percent }) => setStoragePercent(percent))

    // Periodic cache cleanup
    const cleanupInterval = setInterval(() => {
      evictExpiredCache()
      getStorageEstimate().then(({ percent }) => setStoragePercent(percent))
    }, 60 * 60 * 1000) // Every hour

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      clearInterval(cleanupInterval)
    }
  }, [refreshQueue])

  return { isOnline, wasOffline, queuedItems, storagePercent, syncPending, lastSyncedAt, refreshQueue }
}
