/**
 * Contract tests for the Geofence create/edit form schema.
 *
 * This module is pure validation logic — no DOM, no network, no React — so the
 * suite exercises {@link geofenceFormSchema} (the string-input Zod schema),
 * {@link toGeofencePayload} (the string→numeric wire converter) and the
 * {@link GEOFENCE_ALERT_TYPES} enum directly with `safeParse`. No MSW/QueryClient
 * harness is required.
 *
 * The `numericString` helper is exercised through the exported schema (it is not
 * itself exported). A regression case pins the hardened behaviour: a non-numeric
 * or non-finite value must yield a single "must be a number" issue and MUST NOT
 * additionally emit the range ("must be between") issue.
 */
import { describe, it, expect, expectTypeOf } from 'vitest'
import {
  GEOFENCE_ALERT_TYPES,
  geofenceFormSchema,
  toGeofencePayload,
  type GeofenceAlertType,
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
  alertType: 'both',
  enabled: true,
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

// ── GEOFENCE_ALERT_TYPES ──────────────────────────────────────────────────────

describe('GEOFENCE_ALERT_TYPES', () => {
  it('enumerates exactly the four alert modes in a stable order', () => {
    expect(GEOFENCE_ALERT_TYPES).toEqual(['entry', 'exit', 'both', 'none'])
    expect(GEOFENCE_ALERT_TYPES).toHaveLength(4)
    // No duplicate members.
    expect(new Set(GEOFENCE_ALERT_TYPES).size).toBe(GEOFENCE_ALERT_TYPES.length)
  })

  it('is the source of truth for the GeofenceAlertType union', () => {
    // Every runtime member is assignable to the type, and vice-versa.
    for (const member of GEOFENCE_ALERT_TYPES) {
      expectTypeOf(member).toEqualTypeOf<GeofenceAlertType>()
    }
    const all: GeofenceAlertType[] = ['entry', 'exit', 'both', 'none']
    expect(all).toEqual([...GEOFENCE_ALERT_TYPES])
  })
})

// ── geofenceFormSchema: happy path ────────────────────────────────────────────

describe('geofenceFormSchema — valid input', () => {
  it('accepts a well-formed form and preserves the string field types', () => {
    const result = geofenceFormSchema.safeParse(VALID_FORM)
    expect(result.success).toBe(true)
    if (!result.success) throw new Error('expected parse to succeed')
    expect(result.data).toEqual(VALID_FORM)
    // Coordinates remain strings post-parse — conversion is toGeofencePayload's job.
    expect(typeof result.data.latitude).toBe('string')
    expect(typeof result.data.enabled).toBe('boolean')
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

  it('accepts every alert-type enum member', () => {
    for (const alertType of GEOFENCE_ALERT_TYPES) {
      expect(geofenceFormSchema.safeParse(form({ alertType })).success).toBe(true)
    }
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

// ── geofenceFormSchema: enum + boolean ────────────────────────────────────────

describe('geofenceFormSchema — alertType & enabled', () => {
  it('rejects an unknown alertType value', () => {
    const result = geofenceFormSchema.safeParse(form({ alertType: 'nope' }))
    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected parse to fail')
    expect(result.error.issues.some((issue) => issue.path[0] === 'alertType')).toBe(true)
  })

  it('rejects a missing or non-boolean enabled flag', () => {
    const missing = geofenceFormSchema.safeParse(form({ enabled: undefined }))
    expect(missing.success).toBe(false)
    const wrongType = geofenceFormSchema.safeParse(form({ enabled: 'true' }))
    expect(wrongType.success).toBe(false)
  })

  it('surfaces independent issues for every invalid field at once', () => {
    const result = geofenceFormSchema.safeParse({
      name: '',
      latitude: '200',
      longitude: 'x',
      radius: '1',
      category: 'custom',
      alertType: 'both',
      enabled: true,
    })
    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected parse to fail')
    const fields = new Set(result.error.issues.map((issue) => issue.path[0]))
    expect(fields).toEqual(new Set(['name', 'latitude', 'longitude', 'radius']))
  })
})

// ── toGeofencePayload ─────────────────────────────────────────────────────────

describe('toGeofencePayload', () => {
  it('maps each alertType to the correct entry/exit boolean pair', () => {
    const expectations: Record<GeofenceAlertType, { alertOnEntry: boolean; alertOnExit: boolean }> = {
      entry: { alertOnEntry: true, alertOnExit: false },
      exit: { alertOnEntry: false, alertOnExit: true },
      both: { alertOnEntry: true, alertOnExit: true },
      none: { alertOnEntry: false, alertOnExit: false },
    }
    for (const alertType of GEOFENCE_ALERT_TYPES) {
      const payload = toGeofencePayload({ ...VALID_FORM, alertType })
      expect(payload.alertOnEntry).toBe(expectations[alertType].alertOnEntry)
      expect(payload.alertOnExit).toBe(expectations[alertType].alertOnExit)
    }
  })

  it('converts the numeric strings to numbers and passes through name + enabled', () => {
    const payload = toGeofencePayload({
      name: 'Depot',
      latitude: '12.5',
      longitude: '-34.25',
      radius: '250',
      category: 'work',
      alertType: 'entry',
      enabled: false,
    })
    expect(payload).toEqual({
      name: 'Depot',
      latitude: 12.5,
      longitude: -34.25,
      radius: 250,
      category: 'work',
      alertOnEntry: true,
      alertOnExit: false,
      enabled: false,
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
      form({ name: '  Trip start ', latitude: ' 40 ', longitude: ' -70 ', radius: ' 500 ', alertType: 'none' }),
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
      alertOnEntry: false,
      alertOnExit: false,
      enabled: true,
    })
    expectTypeOf(payload).toEqualTypeOf<GeofencePayload>()
  })
})
