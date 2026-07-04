/**
 * devtools/helpers unit suite.
 *
 * Covers EVERY export of ./helpers with behavioural, multi-facet assertions —
 * never a smoke check and never the real network:
 *
 *   apiFetch            — path/method/body forwarding, Error vs non-Error
 *                         failure normalisation to `{ error }`.
 *   useVehicleOptions   — react-query hook: option mapping, display_name→vin
 *                         fallback, empty-data null-safety.
 *   rgbToHsl            — achromatic (black/white/grey) + the three primary
 *                         hue branches (max===r/g/b).
 *   describeCron        — arity guard + each minute/hour branch, day-of-month,
 *                         month, and day-of-week name mapping (+ unknown dow).
 *   getNextCronRuns     — arity guard, count honouring, and the wildcard /
 *                         exact / step / list / range matcher branches, all
 *                         asserted TZ-independently via local getMinutes().
 *   extractTelemetryErrors — every wire variant (envelope, root.errors,
 *                         array-only, envelope-less object) + the healthy
 *                         empty-array ok:true contract + malformed inputs.
 *   pickString          — key precedence, empty-string skip, number coercion,
 *                         no-match empty string.
 *   getRelativeTime     — s/m/h/d buckets, future via abs(), invalid-Date guard.
 *
 * Network is mocked at the @/api/client boundary (repo convention — see
 * api/hooks/useEnergy.test.tsx / __tests__/useFleetTelemetry.test.tsx). The
 * cron/relative-time clock is frozen with fake timers so assertions are
 * deterministic regardless of when the suite runs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Vehicle } from '@/api/types'

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, request: vi.fn() }
})

import { request } from '@/api/client'
import {
  apiFetch,
  useVehicleOptions,
  rgbToHsl,
  describeCron,
  getNextCronRuns,
  extractTelemetryErrors,
  pickString,
  getRelativeTime,
} from './helpers'

const requestMock = vi.mocked(request)

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

function vehicle(overrides: Partial<Vehicle>): Vehicle {
  return {
    id: 1,
    vehicle_id: 100,
    vin: 'VIN0',
    display_name: 'Car',
    model: 'model3',
    trim_badging: '',
    exterior_color: '',
    wheel_type: '',
    state: 'online',
    healthy: true,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

beforeEach(() => {
  requestMock.mockReset()
})

/* ─── apiFetch ────────────────────────────────────────────────────────── */

describe('apiFetch', () => {
  it('prefixes /dev-tools/, defaults to GET, and returns the raw response', async () => {
    requestMock.mockResolvedValue({ ok: true, count: 3 })

    const result = await apiFetch('fleet-api-info')

    expect(requestMock).toHaveBeenCalledWith('/dev-tools/fleet-api-info', {
      method: 'GET',
    })
    expect(result).toEqual({ ok: true, count: 3 })
  })

  it('forwards method and JSON-serialises the body only when one is supplied', async () => {
    requestMock.mockResolvedValue({})

    await apiFetch('register-partner', 'POST', { domain: 'example.com' })

    expect(requestMock).toHaveBeenCalledWith('/dev-tools/register-partner', {
      method: 'POST',
      body: JSON.stringify({ domain: 'example.com' }),
    })
    // No body key should be present when the caller omits the body arg.
    await apiFetch('public-key', 'DELETE')
    expect(requestMock).toHaveBeenLastCalledWith('/dev-tools/public-key', {
      method: 'DELETE',
    })
  })

  it('normalises an Error rejection into an { error } payload instead of throwing', async () => {
    requestMock.mockRejectedValue(new Error('upstream 500'))

    const result = await apiFetch('generate-keypair', 'POST')

    expect(result).toEqual({ error: 'upstream 500' })
  })

  it('falls back to a generic message when a non-Error value is thrown', async () => {
    requestMock.mockRejectedValue('boom-string')

    const result = await apiFetch('fleet-status', 'POST')

    expect(result).toEqual({ error: 'Request failed' })
  })
})

/* ─── useVehicleOptions ───────────────────────────────────────────────── */

describe('useVehicleOptions', () => {
  it('maps vehicles to {value,label} options and exposes the raw list', async () => {
    requestMock.mockResolvedValue([
      vehicle({ vin: 'VINA', display_name: 'Model 3' }),
      vehicle({ id: 2, vin: 'VINB', display_name: 'Model Y' }),
    ])

    const { result } = renderHook(() => useVehicleOptions(), { wrapper: makeWrapper() })

    await waitFor(() => expect(result.current.vehicles).toHaveLength(2))
    expect(requestMock).toHaveBeenCalledWith('/vehicles')
    expect(result.current.options).toEqual([
      { value: 'VINA', label: 'Model 3' },
      { value: 'VINB', label: 'Model Y' },
    ])
  })

  it('falls back to the vin as the label when display_name is empty', async () => {
    requestMock.mockResolvedValue([vehicle({ vin: 'BARE-VIN', display_name: '' })])

    const { result } = renderHook(() => useVehicleOptions(), { wrapper: makeWrapper() })

    await waitFor(() => expect(result.current.options).toHaveLength(1))
    expect(result.current.options[0]).toEqual({ value: 'BARE-VIN', label: 'BARE-VIN' })
  })

  it('defaults to empty arrays before data resolves (no crash on .map)', () => {
    requestMock.mockReturnValue(new Promise(() => {})) // never resolves

    const { result } = renderHook(() => useVehicleOptions(), { wrapper: makeWrapper() })

    expect(result.current.vehicles).toEqual([])
    expect(result.current.options).toEqual([])
  })
})

/* ─── rgbToHsl ────────────────────────────────────────────────────────── */

describe('rgbToHsl', () => {
  it('handles the achromatic short-circuit (white / black / grey → s=0)', () => {
    expect(rgbToHsl(255, 255, 255)).toEqual([0, 0, 100])
    expect(rgbToHsl(0, 0, 0)).toEqual([0, 0, 0])
    expect(rgbToHsl(128, 128, 128)).toEqual([0, 0, 50])
  })

  it('resolves each hue branch: red=0°, green=120°, blue=240° at full saturation', () => {
    expect(rgbToHsl(255, 0, 0)).toEqual([0, 100, 50])
    expect(rgbToHsl(0, 255, 0)).toEqual([120, 100, 50])
    expect(rgbToHsl(0, 0, 255)).toEqual([240, 100, 50])
  })

  it('wraps the red hue past magenta when blue exceeds green (g<b branch)', () => {
    // magenta (255,0,255): max===r with g<b adds the +6 wrap → 300°.
    expect(rgbToHsl(255, 0, 255)).toEqual([300, 100, 50])
  })
})

/* ─── describeCron ────────────────────────────────────────────────────── */

describe('describeCron', () => {
  it('rejects any expression that is not exactly five fields', () => {
    expect(describeCron(['*', '*', '*'])).toBe('Invalid cron expression')
    expect(describeCron([])).toBe('Invalid cron expression')
  })

  it('describes the minute/hour combinations', () => {
    expect(describeCron(['*', '*', '*', '*', '*'])).toBe('Every minute')
    expect(describeCron(['5', '*', '*', '*', '*'])).toBe('At minute 5 of every hour')
    expect(describeCron(['30', '9', '*', '*', '*'])).toBe('At 09:30')
    expect(describeCron(['*', '9', '*', '*', '*'])).toBe('Every minute of hour 9')
  })

  it('appends day-of-month, month, and named day-of-week clauses', () => {
    expect(describeCron(['0', '0', '15', '*', '*'])).toBe('At 00:00 on day 15')
    expect(describeCron(['0', '0', '1', '6', '*'])).toBe('At 00:00 on day 1 in month 6')
    // dow 1 → Monday.
    expect(describeCron(['0', '0', '*', '*', '1'])).toBe('At 00:00 on Mon')
  })

  it('echoes the raw dow token when it is out of the Sun–Sat range', () => {
    expect(describeCron(['0', '0', '*', '*', '9'])).toBe('At 00:00 on 9')
  })
})

/* ─── getNextCronRuns ─────────────────────────────────────────────────── */

describe('getNextCronRuns', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // A fixed instant keeps the "next minute" seed deterministic. Assertions
    // below read LOCAL clock fields (getMinutes) so they hold in any TZ.
    vi.setSystemTime(new Date('2024-03-15T12:00:30.000Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns [] for a non-5-field expression', () => {
    expect(getNextCronRuns(['*', '*'], 3)).toEqual([])
  })

  it('honours the requested count and steps by one minute from the next boundary', () => {
    const runs = getNextCronRuns(['*', '*', '*', '*', '*'], 3)

    expect(runs).toHaveLength(3)
    expect(runs[0]!.getSeconds()).toBe(0)
    // Consecutive every-minute runs are exactly 60s apart.
    expect(runs[1]!.getTime() - runs[0]!.getTime()).toBe(60_000)
    expect(runs[2]!.getTime() - runs[1]!.getTime()).toBe(60_000)
  })

  it('matches an exact minute field', () => {
    const runs = getNextCronRuns(['30', '*', '*', '*', '*'], 2)

    expect(runs).toHaveLength(2)
    expect(runs.every((d) => d.getMinutes() === 30)).toBe(true)
  })

  it('matches a step (*/15) field', () => {
    const runs = getNextCronRuns(['*/15', '*', '*', '*', '*'], 4)

    expect(runs).toHaveLength(4)
    expect(runs.every((d) => d.getMinutes() % 15 === 0)).toBe(true)
  })

  it('matches a comma list and a hyphen range field', () => {
    const list = getNextCronRuns(['0,30', '*', '*', '*', '*'], 3)
    expect(list.every((d) => d.getMinutes() === 0 || d.getMinutes() === 30)).toBe(true)

    const range = getNextCronRuns(['10-12', '*', '*', '*', '*'], 3)
    expect(range.every((d) => d.getMinutes() >= 10 && d.getMinutes() <= 12)).toBe(true)
  })
})

/* ─── extractTelemetryErrors ──────────────────────────────────────────── */

describe('extractTelemetryErrors', () => {
  it('returns ok:false for null, primitives, and shapes with no array anywhere', () => {
    expect(extractTelemetryErrors(null)).toEqual({ errors: [], ok: false })
    expect(extractTelemetryErrors('nope')).toEqual({ errors: [], ok: false })
    expect(extractTelemetryErrors({ response: { status: 'green' } })).toEqual({
      errors: [],
      ok: false,
    })
  })

  it('unwraps the {response:{errors:[…]}} envelope and canonical snake_case fields', () => {
    const { errors, ok } = extractTelemetryErrors({
      response: {
        errors: [
          {
            vin: 'VIN9',
            error_code: 'DISCONNECTED',
            error_message: 'stream dropped',
            reported_at: '2024-03-15T10:00:00Z',
          },
        ],
      },
    })

    expect(ok).toBe(true)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      code: 'DISCONNECTED',
      message: 'stream dropped',
      timestamp: '2024-03-15T10:00:00Z',
    })
    // rowKey is a stable composite of timestamp|code|vin|index.
    expect(errors[0]!.rowKey).toBe('2024-03-15T10:00:00Z|DISCONNECTED|VIN9|0')
  })

  it('reads root.errors and the alternate field names (topic/body/ts)', () => {
    const { errors, ok } = extractTelemetryErrors({
      errors: [{ topic: 'auth', body: 'token expired', ts: '2024-01-01T00:00:00Z' }],
    })

    expect(ok).toBe(true)
    expect(errors[0]).toMatchObject({
      code: 'auth',
      message: 'token expired',
      timestamp: '2024-01-01T00:00:00Z',
    })
  })

  it('accepts a bare array response and tolerates null rows without throwing', () => {
    const { errors, ok } = extractTelemetryErrors([
      null,
      { code: 'X', message: 'y' },
    ])

    expect(ok).toBe(true)
    expect(errors).toHaveLength(2)
    expect(errors[0]).toMatchObject({ code: '', message: '', timestamp: '' })
    expect(errors[1]).toMatchObject({ code: 'X', message: 'y' })
  })

  it('reports ok:true with an empty list for a healthy vehicle (zero errors)', () => {
    expect(extractTelemetryErrors({ response: { errors: [] } })).toEqual({
      errors: [],
      ok: true,
    })
  })
})

/* ─── pickString ──────────────────────────────────────────────────────── */

describe('pickString', () => {
  it('returns the first key that holds a non-empty string, honouring order', () => {
    expect(pickString({ a: '', b: 'second', c: 'third' }, ['a', 'b', 'c'])).toBe('second')
  })

  it('coerces a numeric value (including 0) to its string form', () => {
    expect(pickString({ n: 0 }, ['n'])).toBe('0')
    expect(pickString({ n: 42 }, ['n'])).toBe('42')
  })

  it('returns an empty string when no key matches or values are unusable', () => {
    expect(pickString({ a: '', b: null, c: undefined }, ['a', 'b', 'c'])).toBe('')
    expect(pickString({ x: 1 }, ['missing'])).toBe('')
  })
})

/* ─── getRelativeTime ─────────────────────────────────────────────────── */

describe('getRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-03-15T12:00:00.000Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('buckets the delta into seconds, minutes, hours, and days', () => {
    const now = Date.now()
    expect(getRelativeTime(new Date(now - 5_000))).toBe('5s ago')
    expect(getRelativeTime(new Date(now - 5 * 60_000))).toBe('5m ago')
    expect(getRelativeTime(new Date(now - 3 * 3_600_000))).toBe('3h ago')
    expect(getRelativeTime(new Date(now - 2 * 86_400_000))).toBe('2d ago')
  })

  it('uses the absolute delta so a future timestamp still reads "ago"', () => {
    expect(getRelativeTime(new Date(Date.now() + 45_000))).toBe('45s ago')
  })

  it('returns an em-dash for an invalid Date instead of "NaN…"', () => {
    expect(getRelativeTime(new Date('not-a-date'))).toBe('—')
  })
})
