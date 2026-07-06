import { useQuery } from '@tanstack/react-query'
import { request } from '@/api/client'
import type { Vehicle } from '@/api/types'
import type { TelemetryError } from './types'

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
  const [min, hr, dom, mon, dow] = parts
  let safety = 0
  while (results.length < count && safety < 525960) {
    safety++
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

/* ─── fleet-telemetry error extraction ────────────────────────────────── */

// extractTelemetryErrors normalises Tesla's per-vehicle fleet-telemetry
// errors response into a UI-friendly shape. Handles all observed wire
// variants — envelope-wrapped, envelope-less, array-only, snake/camel
// field names — without throwing on partial data, since the alternative
// is the silent-empty-table bug (no UI feedback at all when Tesla's
// shape drifts).
// Returns ([], true) for a successful response with zero errors so the
// caller can distinguish "vehicle is healthy" from "no request made yet".
export function extractTelemetryErrors(
  data: unknown,
): { errors: TelemetryError[]; ok: boolean } {
  if (data == null || typeof data !== 'object') return { errors: [], ok: false }

  const root = data as Record<string, unknown>
  const candidates: unknown[] = [
    root.errors,
    (root.response as Record<string, unknown> | undefined)?.errors,
    root.response,
    data,
  ]
  let raw: unknown[] | null = null
  for (const c of candidates) {
    if (Array.isArray(c)) {
      raw = c
      break
    }
  }
  if (raw == null) return { errors: [], ok: false }

  const errors: TelemetryError[] = raw.map((row, i) => {
    const r = (row ?? {}) as Record<string, unknown>
    const timestamp = pickString(r, ['reported_at', 'timestamp', 'created_at', 'ts'])
    const code = pickString(r, ['error_code', 'code', 'name', 'topic'])
    const message = pickString(r, ['error_message', 'message', 'body', 'description'])
    const vin = pickString(r, ['vin'])
    return {
      rowKey: `${timestamp}|${code}|${vin}|${i}`,
      timestamp,
      code,
      message,
    }
  })
  return { errors, ok: true }
}

export function pickString(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k]
    if (typeof v === 'string' && v !== '') return v
    if (typeof v === 'number') return String(v)
  }
  return ''
}

/* ─── relative time ───────────────────────────────────────────────────── */

export function getRelativeTime(date: Date): string {
  const ms = date.getTime()
  // Guard against an invalid Date (getTime() === NaN); the arithmetic below
  // otherwise cascades NaN through every branch and renders "NaNd ago".
  if (!Number.isFinite(ms)) return '—'
  const diff = Math.abs(Date.now() - ms)
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}
