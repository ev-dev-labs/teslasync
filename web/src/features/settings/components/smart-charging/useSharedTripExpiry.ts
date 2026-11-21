import { useEffect, useReducer } from 'react'

export function useSharedTripExpiry(expiresAt: string | null | undefined) {
  const [tick, recheck] = useReducer((current: number) => current + 1, 0)
  const deadline = expiresAt ? Date.parse(expiresAt) : NaN
  useEffect(() => {
    const remaining = deadline - Date.now()
    if (!(remaining > 0)) return
    // Future departures can exceed the browser's maximum timer delay.
    const timer = window.setTimeout(recheck, Math.min(remaining, 2_147_483_647))
    return () => window.clearTimeout(timer)
  }, [deadline, tick])
  return deadline > Date.now()
}
