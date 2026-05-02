import { useEffect, useState } from 'react'
import { broadcast, subscribe, type BroadcastMessage } from './broadcast'

/**
 * Phase-40 / Prompt 69 — small reusable hook for the §7 pattern:
 *
 *   "feature writes a localStorage value, broadcasts a one-line message,
 *    other tabs subscribe to the message and re-read the value"
 *
 * Returns the parsed value plus a setter that (a) writes localStorage,
 * (b) updates local React state, and (c) broadcasts the supplied message
 * type so every other tab re-reads.
 *
 * The bus message itself does NOT carry the value — the value lives in
 * localStorage. Other tabs receive the signal, read localStorage fresh,
 * and update their own state. This keeps the bus payload small and avoids
 * version-skew between what's broadcast and what's in storage.
 */
export function useLocalStorageSync<T>(
  key: string,
  parse: (raw: string | null) => T,
  serialize: (value: T) => string | null,
  msgType: BroadcastMessage['type'],
): [T, (next: T) => void] {
  const read = (): T => {
    if (typeof window === 'undefined') return parse(null)
    try {
      return parse(window.localStorage.getItem(key))
    } catch {
      return parse(null)
    }
  }

  const [value, setValue] = useState<T>(read)

  // Subscribe to bus + 'storage' events: another tab may also be writing
  // straight to localStorage without going through this hook.
  useEffect(() => {
    const refresh = () => setValue(read())
    const off = subscribe((m) => {
      if (m.type === msgType) refresh()
    })
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) refresh()
    }
    window.addEventListener('storage', onStorage)
    return () => {
      off()
      window.removeEventListener('storage', onStorage)
    }
  }, [key, msgType])

  const set = (next: T) => {
    if (typeof window !== 'undefined') {
      try {
        const serialized = serialize(next)
        if (serialized === null) window.localStorage.removeItem(key)
        else window.localStorage.setItem(key, serialized)
      } catch {
        /* quota / private mode — best-effort */
      }
    }
    setValue(next)
    // The discriminated union forbids constructing a payload from a bare
    // type tag — every adapter that uses this helper happens to be one of
    // the no-payload variants ('checklist.dismissed', 'onboarded',
    // 'install.dismissed', 'dashboard.layout'). Cast through unknown to
    // keep this helper generic over those.
    broadcast({ type: msgType } as unknown as BroadcastMessage)
  }

  return [value, set]
}
