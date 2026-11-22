import { useEffect, useState } from 'react'

interface Deadlines {
  open: boolean
  departure: number
  expiry: number
  snoozedUntil: number
  nextCheck?: number
}

export function usePrivateTripClock({ open, departure, expiry, snoozedUntil, nextCheck }: Deadlines) {
  const [clock, setClock] = useState(Date.now)
  useEffect(() => {
    if (!open) return
    const now = Date.now()
    const deadlines = [departure, expiry, snoozedUntil, nextCheck ?? 0]
      .filter((time) => Number.isFinite(time) && time > now)
    if (!deadlines.length) return
    const delay = Math.min(Math.min(...deadlines) - now + 1, 2_147_483_647)
    const timer = window.setTimeout(() => setClock(Date.now()), delay)
    return () => window.clearTimeout(timer)
  }, [open, departure, expiry, snoozedUntil, nextCheck, clock])
  return Math.max(clock, Date.now())
}
