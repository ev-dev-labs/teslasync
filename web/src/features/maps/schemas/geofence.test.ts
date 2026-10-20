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
import { afterEach, beforeAll, describe, it, expect, expectTypeOf } from 'vitest'
import i18n from 'i18next'
import {
  geofenceFormSchema,
  toGeofencePayload,
  type GeofenceFormData,
  type GeofencePayload,
} from './geofence'

beforeAll(async () => {
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: {} } },
    interpolation: { escapeValue: false },
  })
})

afterEach(async () => {
  await i18n.changeLanguage('en')
})

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

describe('geofenceFormSchema — localized validation', () => {
  const translatedValidation = {
    nameRequired: 'Name fehlt',
    nameMaxLength: 'Name: höchstens {{max}} Zeichen',
    latitudeRequired: 'Breitengrad fehlt',
    latitudeNumber: 'Breitengrad muss eine Zahl sein',
    latitudeRange: 'Breitengrad zwischen {{min}} und {{max}}',
    longitudeRequired: 'Längengrad fehlt',
    longitudeNumber: 'Längengrad muss eine Zahl sein',
    longitudeRange: 'Längengrad zwischen {{min}} und {{max}}',
    radiusRequired: 'Radius fehlt',
    radiusNumber: 'Radius muss eine Zahl sein',
    radiusRange: 'Radius zwischen {{min}} und {{max}}',
  }

  async function useTranslatedValidation() {
    i18n.addResourceBundle('de', 'translation', {
      geofences: { validation: translatedValidation },
    }, true, true)
    await i18n.changeLanguage('de')
  }

  it.each([
    ['name', '', 'Name fehlt'],
    ['name', '   ', 'Name fehlt'],
    ['name', 'x'.repeat(121), 'Name: höchstens 120 Zeichen'],
    ['latitude', '', 'Breitengrad fehlt'],
    ['longitude', '   ', 'Längengrad fehlt'],
    ['radius', '', 'Radius fehlt'],
    ['latitude', '-90.001', 'Breitengrad zwischen -90 und 90'],
    ['latitude', '90.001', 'Breitengrad zwischen -90 und 90'],
    ['longitude', '-180.001', 'Längengrad zwischen -180 und 180'],
    ['longitude', '180.001', 'Längengrad zwischen -180 und 180'],
    ['radius', '9.999', 'Radius zwischen 10 und 50000'],
    ['radius', '50000.001', 'Radius zwischen 10 und 50000'],
  ] as const)('localizes %s=%s without changing its field association', async (field, value, message) => {
    await useTranslatedValidation()
    const result = geofenceFormSchema.safeParse(form({ [field]: value }))
    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected parse to fail')
    expect(result.error.issues.every((issue) => issue.path[0] === field)).toBe(true)
    expect(result.error.issues.map((issue) => issue.message)).toContain(message)
  })

  it.each(['latitude', 'longitude', 'radius'] as const)(
    'keeps a single localized numeric issue for every non-finite %s value',
    async (field) => {
      await useTranslatedValidation()
      const expected = {
        latitude: 'Breitengrad muss eine Zahl sein',
        longitude: 'Längengrad muss eine Zahl sein',
        radius: 'Radius muss eine Zahl sein',
      }
      for (const value of ['abc', 'NaN', 'Infinity', '-Infinity', '1e400', '-1e400']) {
        expect(messagesFor(form({ [field]: value }), field)).toEqual([expected[field]])
      }
    },
  )

  it('uses the current language on each parse of the same exported schema', async () => {
    expect(messagesFor(form({ name: '' }), 'name')).toEqual(['Name is required'])
    await useTranslatedValidation()
    expect(messagesFor(form({ name: '' }), 'name')).toEqual(['Name fehlt'])
    expect(messagesFor(form({ latitude: '' }), 'latitude')).toEqual(['Breitengrad fehlt'])
    expect(messagesFor(form({ radius: 'Infinity' }), 'radius')).toEqual(['Radius muss eine Zahl sein'])
    await i18n.changeLanguage('en')
    expect(messagesFor(form({ name: '' }), 'name')).toEqual(['Name is required'])
    expect(messagesFor(form({ longitude: '181' }), 'longitude')).toEqual([
      'Longitude must be between -180 and 180',
    ])
  })

  it('retains simultaneous field associations and existing Zod issue codes', async () => {
    await useTranslatedValidation()
    const result = geofenceFormSchema.safeParse(form({
      name: 'x'.repeat(121), latitude: '91', longitude: 'NaN', radius: '9',
    }))
    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected parse to fail')
    expect(result.error.issues.map(({ path, code, message }) => ({ path, code, message }))).toEqual([
      { path: ['name'], code: 'too_big', message: 'Name: höchstens 120 Zeichen' },
      { path: ['latitude'], code: 'custom', message: 'Breitengrad zwischen -90 und 90' },
      { path: ['longitude'], code: 'custom', message: 'Längengrad muss eine Zahl sein' },
      { path: ['radius'], code: 'custom', message: 'Radius zwischen 10 und 50000' },
    ])
  })

  it('keeps whitespace-only numeric validation behavior and issue order', async () => {
    await useTranslatedValidation()
    expect(messagesFor(form({ latitude: '   ' }), 'latitude')).toEqual(['Breitengrad fehlt'])
    expect(messagesFor(form({ longitude: '   ' }), 'longitude')).toEqual(['Längengrad fehlt'])
    expect(messagesFor(form({ radius: '   ' }), 'radius')).toEqual([
      'Radius fehlt', 'Radius zwischen 10 und 50000',
    ])
  })

  it.each([
    ['0', '0', '10'],
    ['-0', '0', '50000'],
    ['-90', '-180', '10'],
    ['90', '180', '50000'],
    ['-12.5', '1e2', '250.75'],
  ])('preserves physical payload values across locales: %s,%s,%s', async (latitude, longitude, radius) => {
    await useTranslatedValidation()
    const result = geofenceFormSchema.safeParse(form({ latitude, longitude, radius }))
    expect(result.success).toBe(true)
    if (!result.success) throw new Error('expected parse to succeed')
    expect(toGeofencePayload(result.data)).toEqual({
      ...VALID_FORM,
      latitude: Number(latitude),
      longitude: Number(longitude),
      radius: Number(radius),
    })
  })

  it('does not widen input types or accepted category values', async () => {
    await useTranslatedValidation()
    for (const field of ['name', 'latitude', 'longitude', 'radius'] as const) {
      for (const value of [null, undefined, 0, false, {}]) {
        expect(geofenceFormSchema.safeParse(form({ [field]: value })).success).toBe(false)
      }
    }
    expect(geofenceFormSchema.safeParse(form({ category: 'unknown' })).success).toBe(false)
  })
})
