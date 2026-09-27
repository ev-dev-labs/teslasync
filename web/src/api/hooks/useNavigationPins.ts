import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { isApiError, request } from '../client'
import type { PinnedItem } from '../types'
import { pinnedKeys, usePinned, useTogglePin } from './usePinned'
import { useMutationToast } from './_toastHelpers'
import { useRefreshInterval } from '@/hooks/useRefreshPolicy'

const INITIALIZED_PIN = '@navigation-initialized'
const PENDING_PINS_KEY = 'teslasync-navigation-pins-pending'

function readPendingPins(): Map<string, boolean> {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(PENDING_PINS_KEY) ?? '[]')
    if (!Array.isArray(stored)) return new Map()
    return new Map(stored.filter((entry): entry is [string, boolean] =>
      Array.isArray(entry) && typeof entry[0] === 'string'
      && entry[0].startsWith('/') && !entry[0].startsWith('//')
      && typeof entry[1] === 'boolean'))
  } catch {
    return new Map()
  }
}

function writePendingPins(pending: Map<string, boolean>) {
  try {
    if (pending.size > 0) window.localStorage.setItem(PENDING_PINS_KEY, JSON.stringify([...pending]))
    else window.localStorage.removeItem(PENDING_PINS_KEY)
  } catch {
    // Keep the in-memory queue if browser storage is unavailable.
  }
}

export function navigationPaths(rows: readonly PinnedItem[]): string[] {
  return rows
    .filter(row => row.item_id.startsWith('/') && !row.item_id.startsWith('//'))
    .sort((a, b) => a.position - b.position || a.id - b.id)
    .map(row => row.item_id)
}

export function useNavigationPins(initialPaths: readonly string[], onServerPaths: (paths: string[]) => void) {
  const refreshInterval = useRefreshInterval(30_000)
  const query = usePinned('navigation', undefined, {
    refetchInterval: refreshInterval,
    refetchOnWindowFocus: 'always',
  })
  const mutation = useTogglePin('navigation', { notifyError: false })
  const qc = useQueryClient()
  const { error } = useMutationToast()
  const bootstrapping = useRef(false)
  const lastAppliedAt = useRef(0)
  const [pendingPins] = useState(readPendingPins)
  const pending = useRef(pendingPins)
  const inFlight = useRef<Promise<unknown>>(Promise.resolve())
  const initialPathsRef = useRef(initialPaths)
  initialPathsRef.current = initialPaths
  const [ready, setReady] = useState(false)
  const [syncRevision, setSyncRevision] = useState(0)

  useEffect(() => {
    if (!query.isSuccess || !query.data || mutation.isPending) return
    if (query.data.some(row => row.item_id === INITIALIZED_PIN)) {
      if (pending.current.size > 0) {
        if (bootstrapping.current) return
        bootstrapping.current = true
        void (async () => {
          let synced = false
          try {
            for (const [path, pin] of pending.current) {
              const rows = await request<PinnedItem[]>('/pinned?type=navigation')
              const existing = rows.find(row => row.item_id === path)
              if (pin && !existing) {
                try {
                  await request<PinnedItem>('/pinned', {
                    method: 'POST',
                    body: JSON.stringify({ item_type: 'navigation', item_id: path }),
                  })
                } catch (cause) {
                  if (!isApiError(cause) || cause.status !== 409) throw cause
                }
              } else if (!pin && existing) {
                await request<void>(`/pinned/${existing.id}`, { method: 'DELETE' })
              }
              if (pending.current.get(path) === pin) pending.current.delete(path)
              writePendingPins(pending.current)
            }
            await qc.invalidateQueries({ queryKey: pinnedKeys.type('navigation') })
            synced = true
          } catch (cause) {
            error(cause, 'toast.pin.navigation.migrateError', 'Could not sync existing navigation pins')
          } finally {
            bootstrapping.current = false
            if (synced) setSyncRevision(revision => revision + 1)
          }
        })()
        return
      }
      if (query.dataUpdatedAt !== lastAppliedAt.current) {
        lastAppliedAt.current = query.dataUpdatedAt
        onServerPaths(navigationPaths(query.data))
      }
      setReady(true)
      return
    }
    if (bootstrapping.current) return
    bootstrapping.current = true
    const save = async (itemId: string) => {
      try {
        await request<PinnedItem>('/pinned', {
          method: 'POST',
          body: JSON.stringify({ item_type: 'navigation', item_id: itemId }),
        })
      } catch (cause) {
        if (isApiError(cause) && cause.status === 409) return
        throw cause
      }
    }
    void (async () => {
      let synced = false
      try {
        for (const path of [...initialPathsRef.current].reverse()) await save(path)
        await save(INITIALIZED_PIN)
        await qc.invalidateQueries({ queryKey: pinnedKeys.type('navigation') })
        synced = true
      } catch (cause) {
        error(cause, 'toast.pin.navigation.migrateError', 'Could not sync existing navigation pins')
      } finally {
        bootstrapping.current = false
        if (synced) setSyncRevision(revision => revision + 1)
      }
    })()
  }, [query.isSuccess, query.data, query.dataUpdatedAt, mutation.isPending, qc, onServerPaths, error, syncRevision])

  const toggle = useCallback(
    (itemId: string, pin: boolean) => {
      if (!ready) {
        pending.current.set(itemId, pin)
        writePendingPins(pending.current)
        if (query.isError) {
          error(query.error, 'toast.pin.navigation.pending', 'Saved on this device; pin will sync when connected')
        }
        void qc.invalidateQueries({ queryKey: pinnedKeys.type('navigation') })
        return Promise.resolve()
      }
      const operation = inFlight.current.catch(() => undefined).then(() => {
        if (pending.current.has(itemId)) {
          pending.current.set(itemId, pin)
          writePendingPins(pending.current)
          void qc.invalidateQueries({ queryKey: pinnedKeys.type('navigation') })
          return undefined
        }
        return mutation.mutateAsync({ itemId, pin }).catch(cause => {
          if (isApiError(cause) && cause.status < 500 && cause.status !== 429) {
            error(cause, 'toast.pin.navigation.migrateError', 'Could not sync navigation pin')
            throw cause
          }
          pending.current.set(itemId, pin)
          writePendingPins(pending.current)
          setReady(false)
          error(cause, 'toast.pin.navigation.pending', 'Saved on this device; pin will sync when connected')
          return undefined
        })
      })
      inFlight.current = operation
      return operation
    },
    [ready, mutation.mutateAsync, qc, error, query.isError, query.error],
  )
  const restore = useCallback(() => {
    const cached = qc.getQueryData<PinnedItem[]>(pinnedKeys.list('navigation'))
    if (cached?.some(row => row.item_id === INITIALIZED_PIN)) {
      onServerPaths(navigationPaths(cached))
    }
    void qc.invalidateQueries({ queryKey: pinnedKeys.type('navigation') })
  }, [qc, onServerPaths])

  return { ready, syncUnavailable: query.isError, toggle, restore }
}
