import { useCallback, useEffect, useRef, useState } from 'react'
import { broadcast, subscribe, type BroadcastMessage } from './broadcast'

/**
 * Reusable hook for cross-tab localStorage sync:
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
  // parse / serialize / msgType are frequently inline closures at the call
  // site. Hold the latest ones in refs so the long-lived bus + 'storage'
  // subscription and the stable `set` callback always invoke the current
  // variant instead of resurrecting a stale value on the next cross-tab
  // refresh (the effect deliberately does not re-subscribe on every render).
  const parseRef = useRef(parse)
  const serializeRef = useRef(serialize)
  const msgTypeRef = useRef(msgType)
  parseRef.current = parse
  serializeRef.current = serialize
  msgTypeRef.current = msgType

  const read = useCallback((): T => {
    if (typeof window === 'undefined') return parseRef.current(null)
    try {
      return parseRef.current(window.localStorage.getItem(key))
    } catch {
      return parseRef.current(null)
    }
  }, [key])

  const [value, setValue] = useState<T>(read)

  // Subscribe to bus + 'storage' events: another tab may also be writing
  // straight to localStorage without going through this hook.
  useEffect(() => {
    const refresh = () => setValue(read())
    const off = subscribe((m) => {
      if (m.type === msgTypeRef.current) refresh()
    })
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) refresh()
    }
    window.addEventListener('storage', onStorage)
    return () => {
      off()
      window.removeEventListener('storage', onStorage)
    }
  }, [key, read])

  const set = useCallback(
    (next: T) => {
      if (typeof window !== 'undefined') {
        try {
          const serialized = serializeRef.current(next)
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
      broadcast({ type: msgTypeRef.current } as unknown as BroadcastMessage)
    },
    [key],
  )

  return [value, set]
}
