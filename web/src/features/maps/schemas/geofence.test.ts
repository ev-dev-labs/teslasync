/**
 * Contract tests for the Geofence create/edit form schema.
 *
 * This module is pure validation logic — no DOM, no network, no React — so the
 * suite exercises {@link geofenceFormSchema} (the string-input Zod schema),
 * {@link toGeofencePayload} (the string→numeric wire converter) with `safeParse`. No MSW/QueryClient
 * harness is required.
 *
 * The `numericString` helper is exercised through the exported schema (it is not
 * itself exported). A regression case pins the hardened behaviour: a non-numeric
 * or non-finite value must yield a single "must be a number" issue and MUST NOT
 * additionally emit the range ("must be between") issue.
 */
import { describe, it, expect, expectTypeOf } from 'vitest'
import {
  geofenceFormSchema,
  toGeofencePayload,
  type GeofenceFormData,
  type GeofencePayload,
} from './geofence'

// A known-good form. Individual tests clone + override a single field so the
// failure is unambiguously attributable to that field.
const VALID_FORM: GeofenceFormData = {
  name: 'Home',
  latitude: '37.7749',
  longitude: '-122.4194',
  radius: '150',
  category: 'home',
}

function form(overrides: Partial<Record<keyof GeofenceFormData, unknown>>): Record<string, unknown> {
  return { ...VALID_FORM, ...overrides }
}

/** Collect issue messages for a single field from a failed safeParse. */
function messagesFor(input: Record<string, unknown>, field: keyof GeofenceFormData): string[] {
  const result = geofenceFormSchema.safeParse(input)
  if (result.success) return []
  return result.error.issues.filter((issue) => issue.path[0] === field).map((issue) => issue.message)
}

// ── geofenceFormSchema: happy path ────────────────────────────────────────────

describe('geofenceFormSchema — valid input', () => {
  it('accepts a well-formed form and preserves the string field types', () => {
    const result = geofenceFormSchema.safeParse(VALID_FORM)
    expect(result.success).toBe(true)
    if (!result.success) throw new Error('expected parse to succeed')
    expect(result.data).toEqual(VALID_FORM)
    // Coordinates remain strings post-parse — conversion is toGeofencePayload's job.
    expect(typeof result.data.latitude).toBe('string')
  })

  it('trims surrounding whitespace on the name and numeric strings', () => {
    const result = geofenceFormSchema.safeParse(
      form({ name: '  Office  ', latitude: '  12.5 ', longitude: ' -3 ', radius: ' 100 ' }),
    )
    expect(result.success).toBe(true)
    if (!result.success) throw new Error('expected parse to succeed')
    expect(result.data.name).toBe('Office')
    expect(result.data.latitude).toBe('12.5')
    expect(result.data.longitude).toBe('-3')
    expect(result.data.radius).toBe('100')
  })

  it.each([
    ['latitude', '-90'],
    ['latitude', '90'],
    ['longitude', '-180'],
    ['longitude', '180'],
    ['radius', '10'],
    ['radius', '50000'],
  ] as const)('accepts the inclusive boundary %s=%s', (field, value) => {
    expect(geofenceFormSchema.safeParse(form({ [field]: value })).success).toBe(true)
  })

  it('accepts a name of exactly the 120-character maximum', () => {
    expect(geofenceFormSchema.safeParse(form({ name: 'x'.repeat(120) })).success).toBe(true)
  })
})

// ── geofenceFormSchema: name validation ───────────────────────────────────────

describe('geofenceFormSchema — name', () => {
  it('rejects an empty or whitespace-only name as required', () => {
    expect(messagesFor(form({ name: '' }), 'name')).toContain('Name is required')
    expect(messagesFor(form({ name: '   ' }), 'name')).toContain('Name is required')
  })

  it('rejects a name longer than 120 characters', () => {
    expect(messagesFor(form({ name: 'x'.repeat(121) }), 'name')).toContain(
      'Name must be 120 characters or fewer',
    )
  })
})

// ── geofenceFormSchema: numeric fields ────────────────────────────────────────

describe('geofenceFormSchema — numeric fields', () => {
  it('rejects an out-of-range latitude/longitude/radius with the range message', () => {
    expect(messagesFor(form({ latitude: '200' }), 'latitude')).toContain(
      'Latitude must be between -90 and 90',
    )
    expect(messagesFor(form({ longitude: '181' }), 'longitude')).toContain(
      'Longitude must be between -180 and 180',
    )
    expect(messagesFor(form({ radius: '5' }), 'radius')).toContain(
      'Radius must be between 10 and 50000',
    )
    expect(messagesFor(form({ radius: '50001' }), 'radius')).toContain(
      'Radius must be between 10 and 50000',
    )
  })

  it('rejects an empty numeric field as required (not as NaN)', () => {
    const msgs = messagesFor(form({ latitude: '' }), 'latitude')
    expect(msgs).toContain('Latitude is required')
    expect(msgs).not.toContain('Latitude must be a number')
  })

  it('reports a NON-numeric value as "must be a number" WITHOUT a duplicate range issue', () => {
    // Regression: the previous two-`refine` implementation ran the range check
    // on `Number('abc') === NaN`, emitting BOTH messages for one field.
    const msgs = messagesFor(form({ latitude: 'abc' }), 'latitude')
    expect(msgs).toEqual(['Latitude must be a number'])
    expect(msgs).not.toContain('Latitude must be between -90 and 90')
  })

  it('treats a non-finite value (Infinity) as "must be a number", not a range error', () => {
    // `Number('1e400') === Infinity` — finite-ness, not NaN-ness, is the guard.
    const msgs = messagesFor(form({ radius: '1e400' }), 'radius')
    expect(msgs).toEqual(['Radius must be a number'])
  })
})

// ── geofenceFormSchema: multiple fields ──────────────────────────────────────

describe('geofenceFormSchema — multiple invalid fields', () => {
  it('surfaces independent issues for every invalid field at once', () => {
    const result = geofenceFormSchema.safeParse({
      name: '',
      latitude: '200',
      longitude: 'x',
      radius: '1',
      category: 'custom',
    })
    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected parse to fail')
    const fields = new Set(result.error.issues.map((issue) => issue.path[0]))
    expect(fields).toEqual(new Set(['name', 'latitude', 'longitude', 'radius']))
  })
})

// ── toGeofencePayload ─────────────────────────────────────────────────────────

describe('toGeofencePayload', () => {
  it('leaves entry/exit alerts to Notification Studio', () => {
    expect(toGeofencePayload(VALID_FORM)).not.toHaveProperty('alertOnEntry')
    expect(toGeofencePayload(VALID_FORM)).not.toHaveProperty('alertOnExit')
  })

  it('converts the numeric strings to numbers and passes through the name', () => {
    const payload = toGeofencePayload({
      name: 'Depot',
      latitude: '12.5',
      longitude: '-34.25',
      radius: '250',
      category: 'work',
    })
    expect(payload).toEqual({
      name: 'Depot',
      latitude: 12.5,
      longitude: -34.25,
      radius: 250,
      category: 'work',
    })
    expect(typeof payload.latitude).toBe('number')
    expect(typeof payload.radius).toBe('number')
  })

  it('handles negative and scientific-notation coordinate strings', () => {
    const payload = toGeofencePayload({ ...VALID_FORM, latitude: '-12.5', longitude: '1e2', radius: '10' })
    expect(payload.latitude).toBe(-12.5)
    expect(payload.longitude).toBe(100)
    expect(payload.radius).toBe(10)
  })

  it('round-trips a parsed form into a fully typed payload', () => {
    const parsed = geofenceFormSchema.safeParse(
      form({ name: '  Trip start ', latitude: ' 40 ', longitude: ' -70 ', radius: ' 500 ' }),
    )
    expect(parsed.success).toBe(true)
    if (!parsed.success) throw new Error('expected parse to succeed')
    const payload = toGeofencePayload(parsed.data)
    expect(payload).toEqual({
      name: 'Trip start',
      latitude: 40,
      longitude: -70,
      radius: 500,
      category: 'home',
    })
    expectTypeOf(payload).toEqualTypeOf<GeofencePayload>()
  })
})
