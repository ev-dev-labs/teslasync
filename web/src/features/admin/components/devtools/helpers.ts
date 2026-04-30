import { useQuery } from '@tanstack/react-query'
import { request } from '@/api/client'
import type { Vehicle } from '@/api/types'

/* ─── API helper ──────────────────────────────────────────────────────── */

export async function apiFetch(
  endpoint: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: unknown,
): Promise<Record<string, unknown>> {
  try {
    return await request<Record<string, unknown>>(`/dev-tools/${endpoint}`, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Request failed' }
  }
}

/* ─── vehicle options hook ────────────────────────────────────────────── */

export function useVehicleOptions() {
  const { data } = useQuery<Vehicle[]>({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
  })
  const vehicles = data ?? []
  const options = vehicles.map((v) => ({
    value: v.vin,
    label: v.display_name || v.vin,
  }))
  return { vehicles, options }
}

/* ─── color conversion ────────────────────────────────────────────────── */

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const r1 = r / 255
  const g1 = g / 255
  const b1 = b / 255
  const max = Math.max(r1, g1, b1)
  const min = Math.min(r1, g1, b1)
  const l = (max + min) / 2
  if (max === min) return [0, 0, Math.round(l * 100)]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r1) h = ((g1 - b1) / d + (g1 < b1 ? 6 : 0)) / 6
  else if (max === g1) h = ((b1 - r1) / d + 2) / 6
  else h = ((r1 - g1) / d + 4) / 6
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)]
}

/* ─── cron helpers ────────────────────────────────────────────────────── */

export function describeCron(parts: string[]): string {
  if (parts.length !== 5) return 'Invalid cron expression'
  const [min, hr, dom, mon, dow] = parts
  const pieces: string[] = []
  if (min === '*' && hr === '*') pieces.push('Every minute')
  else if (min !== '*' && hr === '*') pieces.push(`At minute ${min} of every hour`)
  else if (min !== '*' && hr !== '*') pieces.push(`At ${hr!.padStart(2, '0')}:${min!.padStart(2, '0')}`)
  else pieces.push(`Every minute of hour ${hr}`)
  if (dom !== '*') pieces.push(`on day ${dom}`)
  if (mon !== '*') pieces.push(`in month ${mon}`)
  if (dow !== '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const idx = parseInt(dow!, 10)
    pieces.push(`on ${days[idx] ?? dow}`)
  }
  return pieces.join(' ')
}

export function getNextCronRuns(parts: string[], count: number): Date[] {
  if (parts.length !== 5) return []
  const results: Date[] = []
  const now = new Date()
  const check = new Date(now)
  check.setSeconds(0, 0)
  check.setMinutes(check.getMinutes() + 1)
  const matchField = (field: string, value: number): boolean => {
    if (field === '*') return true
    if (field.includes('/')) {
      const [, step] = field.split('/')
      return value % parseInt(step ?? '1', 10) === 0
    }
    if (field.includes(',')) return field.split(',').map(Number).includes(value)
    if (field.includes('-')) {
      const [lo, hi] = field.split('-').map(Number)
      return value >= (lo ?? 0) && value <= (hi ?? 0)
    }
    return parseInt(field, 10) === value
  }
  let safety = 0
  while (results.length < count && safety < 525960) {
    safety++
    const [min, hr, dom, mon, dow] = parts
    if (
      matchField(min ?? '*', check.getMinutes()) &&
      matchField(hr ?? '*', check.getHours()) &&
      matchField(dom ?? '*', check.getDate()) &&
      matchField(mon ?? '*', check.getMonth() + 1) &&
      matchField(dow ?? '*', check.getDay())
    ) {
      results.push(new Date(check))
    }
    check.setMinutes(check.getMinutes() + 1)
  }
  return results
}

/* ─── relative time ───────────────────────────────────────────────────── */

export function getRelativeTime(date: Date): string {
  const now = Date.now()
  const diff = Math.abs(now - date.getTime())
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}
