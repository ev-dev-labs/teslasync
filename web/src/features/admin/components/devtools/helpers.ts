import { useQuery } from '@tanstack/react-query'
import i18n, { type TFunction } from 'i18next'
import { request } from '@/api/client'
import type { Vehicle } from '@/api/types'
import {formatRelative, type FormatOptions} from '@/lib/dateFormat'
import {formatWeekdayName} from '@/lib/dateConvert'
import { fmtInt, getGlobalLocale } from '@/lib/numberFormat'
import type { TelemetryError } from './types'

/* ─── API helper ──────────────────────────────────────────────────────── */

export async function apiFetch(
  endpoint: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: unknown,
): Promise<Record<string, unknown>> {
  // Fleet status uses POST to submit a VIN list, but only reads upstream state.
  const requiresLiveMode = method !== 'GET' &&
    !(method === 'POST' && endpoint.split('?')[0] === 'fleet-status')
  return request<Record<string, unknown>>(`/dev-tools/${endpoint}`, {
    method,
    ...(requiresLiveMode ? { requiresLiveMode: true } : {}),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
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

const CRON_BOUNDS = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]] as const

function parseCronField(field: string, min: number, max: number): Set<number> | null {
  const values = new Set<number>()
  for (const item of field.split(',')) {
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(item)
    if (!match) return null
    const base = match[1]!
    const step = match[2] === undefined ? 1 : Number(match[2])
    if (!Number.isSafeInteger(step) || step < 1 || step > max - min + 1) return null
    let start = min
    let end = max
    if (base !== '*') {
      const range = base.split('-').map(Number)
      start = range[0]!
      end = range[1] ?? (match[2] === undefined ? start : max)
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
          start < min || end > max || start > end) return null
    }
    for (let value = start; value <= end; value += step) values.add(value)
  }
  return values
}

function parseCron(parts: string[]): Set<number>[] | null {
  if (parts.length !== CRON_BOUNDS.length) return null
  const fields = parts.map((field, index) => {
    const [min, max] = CRON_BOUNDS[index]!
    return parseCronField(field, min, max)
  })
  if (fields.some(field => field === null)) return null
  return fields as Set<number>[]
}

export function isValidCron(parts: string[]): boolean {
  return parseCron(parts) !== null
}

export function describeCron(
  parts: string[],
  t: TFunction = i18n.t,
  locale = getGlobalLocale(),
): string {
  if (!isValidCron(parts)) {
    return t('devtools.utils.cronInvalid', 'Invalid cron expression')
  }
  const [min, hr, dom, mon, dow] = parts
  const pieces: string[] = []
  const displayField = (field: string | undefined) =>
    field && /^\d+$/.test(field) ? fmtInt(Number(field), locale) : field
  if (min === '*' && hr === '*') pieces.push(t('devtools.utils.cronEveryMinute', 'Every minute'))
  else if (min !== '*' && hr === '*') {
    pieces.push(t('devtools.utils.cronAtMinute', {
      defaultValue: 'At minute {{minute}} of every hour', minute: displayField(min),
    }))
  } else if (min !== '*' && hr !== '*') {
    pieces.push(t('devtools.utils.cronAtTime', {
      defaultValue: 'At {{time}}', time: `${hr!.padStart(2, '0')}:${min!.padStart(2, '0')}`,
    }))
  } else {
    pieces.push(t('devtools.utils.cronDuringHour', {
      defaultValue: 'Every minute of hour {{hour}}', hour: displayField(hr),
    }))
  }
  if (dom !== '*') pieces.push(t('devtools.utils.cronOnDay', {
    defaultValue: 'on day {{day}}', day: displayField(dom),
  }))
  if (mon !== '*') pieces.push(t('devtools.utils.cronInMonth', {
    defaultValue: 'in month {{month}}', month: displayField(mon),
  }))
  if (dow !== '*') {
    const weekday = /^\d+$/.test(dow!)
      ? formatWeekdayName(new Date(Date.UTC(2024, 0, 7 + Number(dow))), { locale, tz: 'UTC' })
      : dow
    pieces.push(t('devtools.utils.cronOnWeekday', {
      defaultValue: 'on {{weekday}}', weekday,
    }))
  }
  return pieces.join(' ')
}

export function getNextCronRuns(parts: string[], count: number): Date[] {
  const fields = parseCron(parts)
  if (!fields || !Number.isSafeInteger(count) || count < 1) return []
  const results: Date[] = []
  const now = new Date()
  const check = new Date(now)
  check.setSeconds(0, 0)
  check.setMinutes(check.getMinutes() + 1)
  const [min, hr, dom, mon, dow] = fields
  let safety = 0
  while (results.length < count && safety < 525960) {
    safety++
    if (
      min!.has(check.getMinutes()) &&
      hr!.has(check.getHours()) &&
      dom!.has(check.getDate()) &&
      mon!.has(check.getMonth() + 1) &&
      dow!.has(check.getDay())
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

export function getRelativeTime(date: Date, opts?: FormatOptions): string {
  return formatRelative(date, opts)
}
