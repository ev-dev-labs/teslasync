import { describe, it, expect } from 'vitest'
import {
  signalCatalog,
  signalCategories,
  getSignalMeta,
  normalizeGpsState,
  type SignalMeta,
  type GpsFixState,
} from './signalCatalog'

const VALID_TYPES = ['number', 'string', 'boolean']
const VALID_FIX_STATES: GpsFixState[] = ['locked', 'unlocked', 'unknown']

describe('signalCatalog (data integrity)', () => {
  it('is a non-empty array of well-formed entries', () => {
    expect(Array.isArray(signalCatalog)).toBe(true)
    expect(signalCatalog.length).toBeGreaterThan(0)
    for (const s of signalCatalog) {
      expect(typeof s.name).toBe('string')
      expect(s.name.length).toBeGreaterThan(0)
      expect(typeof s.category).toBe('string')
      expect(s.category.length).toBeGreaterThan(0)
      expect(VALID_TYPES).toContain(s.type)
      expect(typeof s.description).toBe('string')
      expect(s.description.length).toBeGreaterThan(0)
    }
  })

  it('has no duplicate signal names (a dup would be silently dropped by the lookup map)', () => {
    const names = signalCatalog.map(s => s.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('only attaches enumValues to string signals, and each list is non-empty', () => {
    const withEnums = signalCatalog.filter(s => s.enumValues !== undefined)
    expect(withEnums.length).toBeGreaterThan(0)
    for (const s of withEnums) {
      expect(s.type).toBe('string')
      expect(Array.isArray(s.enumValues)).toBe(true)
      expect(s.enumValues?.length ?? 0).toBeGreaterThan(0)
    }
  })

  it('never attaches a unit to a boolean signal', () => {
    for (const s of signalCatalog) {
      if (s.type === 'boolean') expect(s.unit).toBeUndefined()
    }
  })

  it('models a known numeric signal with its full metadata', () => {
    expect(getSignalMeta('BatteryLevel')).toEqual({
      name: 'BatteryLevel',
      category: 'Battery',
      type: 'number',
      unit: '%',
      description: 'State of charge percentage',
    })
  })

  it('exposes entries assignable to the SignalMeta contract', () => {
    const sample: SignalMeta = { name: 'X', category: 'Y', type: 'number', description: 'd' }
    expect(sample.name).toBe('X')
    const battery: SignalMeta | undefined = getSignalMeta('BatteryLevel')
    expect(battery?.type).toBe('number')
  })
})

describe('signalCategories', () => {
  it('is exactly the unique set of catalog categories', () => {
    const expected = new Set(signalCatalog.map(s => s.category))
    expect(new Set(signalCategories)).toEqual(expected)
    expect(signalCategories.length).toBe(expected.size)
  })

  it('is sorted ascending with no duplicates', () => {
    const sorted = [...signalCategories].sort()
    expect(signalCategories).toEqual(sorted)
    expect(new Set(signalCategories).size).toBe(signalCategories.length)
  })

  it('contains the core Tesla telemetry domains', () => {
    for (const cat of ['Battery', 'Charging', 'Climate', 'Driving', 'Location']) {
      expect(signalCategories).toContain(cat)
    }
  })
})

describe('getSignalMeta', () => {
  it('resolves a known signal to its exact catalog entry (by reference)', () => {
    const entry = signalCatalog.find(s => s.name === 'BatteryLevel')
    expect(getSignalMeta('BatteryLevel')).toBe(entry)
  })

  it('resolves a signal from a later category (the map is fully populated)', () => {
    const meta = getSignalMeta('PowershareStatus')
    expect(meta?.category).toBe('Powershare')
    expect(meta?.type).toBe('string')
  })

  it('returns undefined for unknown and empty names', () => {
    expect(getSignalMeta('NoSuchSignal')).toBeUndefined()
    expect(getSignalMeta('')).toBeUndefined()
  })

  it('is case-sensitive because proto identifiers are exact', () => {
    expect(getSignalMeta('batterylevel')).toBeUndefined()
    expect(getSignalMeta('BATTERYLEVEL')).toBeUndefined()
  })

  it('round-trips every catalog entry back to the same object', () => {
    for (const s of signalCatalog) {
      expect(getSignalMeta(s.name)).toBe(s)
    }
  })
})

describe('normalizeGpsState', () => {
  it('treats missing / empty input as unknown', () => {
    expect(normalizeGpsState(null)).toBe('unknown')
    expect(normalizeGpsState(undefined)).toBe('unknown')
    expect(normalizeGpsState('')).toBe('unknown')
    expect(normalizeGpsState('   ')).toBe('unknown')
  })

  it('maps truthy / valid fixes to locked', () => {
    for (const raw of ['true', '1', 'yes', 'GPSValid', 'GpsValid', 'Fix2D', 'Fix3D', 'normal', 'good', 'strong', 'ok', 'valid']) {
      expect(normalizeGpsState(raw), raw).toBe('locked')
    }
  })

  it('maps falsy / invalid fixes to unlocked', () => {
    for (const raw of ['false', '0', 'no', 'GPSInvalid', 'NoFix', 'invalid', 'none']) {
      expect(normalizeGpsState(raw), raw).toBe('unlocked')
    }
  })

  it('recognises the Tesla firmware wire value "GpsLocked" as locked', () => {
    // The backend stores GpsState verbatim (internal/tesla/codec/coercion.go);
    // "GpsLocked" is a documented passthrough value (coercion_test.go:346).
    // Before the fix this returned 'unknown', hiding a real GPS lock.
    expect(normalizeGpsState('GpsLocked')).toBe('locked')
    expect(normalizeGpsState('gpslocked')).toBe('locked')
  })

  it('recognises a bare "fix" (has a GPS fix) as locked', () => {
    expect(normalizeGpsState('fix')).toBe('locked')
    expect(normalizeGpsState('FIX')).toBe('locked')
  })

  it('is trim- and case-insensitive', () => {
    expect(normalizeGpsState('  TRUE  ')).toBe('locked')
    expect(normalizeGpsState(' Fix3D ')).toBe('locked')
    expect(normalizeGpsState('  gpsinvalid ')).toBe('unlocked')
  })

  it('falls back to unknown for ambiguous / unrecognised states', () => {
    expect(normalizeGpsState('GpsUnknown')).toBe('unknown')
    expect(normalizeGpsState('DR_GPS_NAV_LIMITED')).toBe('unknown')
    expect(normalizeGpsState('totally-made-up')).toBe('unknown')
  })

  it('always returns a member of the GpsFixState union', () => {
    for (const raw of ['true', 'false', 'GpsLocked', 'weird', '', null, undefined]) {
      expect(VALID_FIX_STATES).toContain(normalizeGpsState(raw))
    }
  })

  it('normalises every documented GpsState enum value to a valid state', () => {
    const gps = getSignalMeta('GpsState')
    expect(gps?.enumValues?.length ?? 0).toBeGreaterThan(0)
    for (const v of gps?.enumValues ?? []) {
      expect(VALID_FIX_STATES, v).toContain(normalizeGpsState(v))
    }
  })
})
