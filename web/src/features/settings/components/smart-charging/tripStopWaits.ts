import type { TripStopWait } from '@/types/smartTripStops'

export function parseTripStopWaits(text: string): TripStopWait[] | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length > 32) return null
  const result: TripStopWait[] = []
  for (const line of lines) {
    const [when, minutes, extra] = line.split(',').map((field) => field.trim())
    if (!when || !minutes || extra != null ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(when) ||
      !Number.isFinite(Date.parse(when)) || !/^\d+(\.\d+)?$/.test(minutes)) return null
    const seconds = Number(minutes) * 60
    const rounded = Math.round(seconds)
    if (!Number.isFinite(seconds) || rounded > 14_400 || Math.abs(seconds - rounded) > 0.0001) return null
    result.push({ arrived_at: when, wait_s: rounded })
  }
  return result
}
