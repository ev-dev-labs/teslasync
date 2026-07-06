/**
 * ui-types — API-layer contract for the FSM debugger / system pages.
 *
 * This module owns no data source; the invariants worth pinning are the
 * structural integrity a silent regression would leak straight into the
 * StateMachineDebugger filter `<Select>`s and the FSM query hooks:
 *
 *   - FSM_TYPE_OPTIONS / HOURS_OPTIONS expose defined, unique value/label/
 *     i18nKey triples in canonical order, every value assignable to its union,
 *     and every i18nKey resolves to the *matching* English label in en.json
 *     (fallback-parity guard — a missing key would render a raw dotted slug).
 *   - The transport interfaces (FSMTransition, ActiveSubFSM, FSMStats,
 *     FSMTransitionResponse) stay assignable from the shapes the Go API emits,
 *     including the optional / nullable branches.
 */
import { describe, it, expect } from 'vitest'
import en from '@/i18n/en.json'
import { FSM_TYPE_OPTIONS, HOURS_OPTIONS } from './ui-types'
import type {
  ActiveSubFSM,
  FSMSelectOption,
  FSMStats,
  FSMTransition,
  FSMTransitionResponse,
  FSMType,
} from './ui-types'

const TS = '2025-01-15T12:00:00Z'

/** Walk a dotted i18n key against the English catalog, mirroring how i18next
 *  resolves nested namespaces. Returns the leaf value or `undefined`. */
function resolveI18nKey(key: string): unknown {
  const catalog = en as unknown as Record<string, unknown>
  return key.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
      return (node as Record<string, unknown>)[part]
    }
    return undefined
  }, catalog)
}

/** Base row shared by the FSMTransition construction tests. */
function makeTransition(overrides: Partial<FSMTransition> = {}): FSMTransition {
  return {
    id: 1,
    vehicle_id: 3,
    ts: TS,
    fsm_name: 'vehicle',
    from_state: 'parked',
    to_state: 'driving',
    trigger: 'speed_changed',
    ...overrides,
  }
}

describe('FSM_TYPE_OPTIONS', () => {
  it('exposes the three FSM filter types in canonical order', () => {
    expect(FSM_TYPE_OPTIONS.map((o) => o.value)).toEqual([
      'all',
      'vehicle',
      'telemetry_connection',
    ])
    expect(FSM_TYPE_OPTIONS).toHaveLength(3)
  })

  it('gives every option a non-empty value, label and i18nKey', () => {
    for (const opt of FSM_TYPE_OPTIONS) {
      expect(opt.value.length).toBeGreaterThan(0)
      expect(opt.label.length).toBeGreaterThan(0)
      expect(opt.i18nKey).toMatch(/^fsm\.typeOption\./)
    }
  })

  it('has unique values and unique i18nKeys (values double as <option> keys)', () => {
    const values = FSM_TYPE_OPTIONS.map((o) => o.value)
    const keys = FSM_TYPE_OPTIONS.map((o) => o.i18nKey)
    expect(new Set(values).size).toBe(values.length)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('resolves every i18nKey to its exact English label in en.json (fallback parity)', () => {
    // Regression guard: the labels used to render raw (no t()). If a key drifts
    // from its label, the consumer silently paints a dotted slug.
    for (const opt of FSM_TYPE_OPTIONS) {
      expect(resolveI18nKey(opt.i18nKey), `missing i18n key ${opt.i18nKey}`).toBe(opt.label)
    }
  })

  it('carries only values assignable to the closed FSMType union', () => {
    const known: Record<FSMType, true> = {
      all: true,
      vehicle: true,
      telemetry_connection: true,
    }
    for (const opt of FSM_TYPE_OPTIONS) {
      expect(known[opt.value]).toBe(true)
    }

    // @ts-expect-error 'drive' is a sub-FSM type, NOT a member of FSMType — the
    // union must stay closed to the three top-level debugger filters.
    const invalid: FSMType = 'drive'
    expect(FSM_TYPE_OPTIONS.some((o) => o.value === invalid)).toBe(false)
  })
})

describe('HOURS_OPTIONS', () => {
  it('exposes the seven presets in canonical order with 0 as the all-time sentinel', () => {
    expect(HOURS_OPTIONS.map((o) => o.value)).toEqual([
      '1',
      '6',
      '24',
      '168',
      '720',
      '2160',
      '0',
    ])
    expect(HOURS_OPTIONS).toHaveLength(7)
    expect(HOURS_OPTIONS[HOURS_OPTIONS.length - 1].value).toBe('0')
  })

  it('gives every preset a numeric-string value and non-empty label/i18nKey', () => {
    for (const opt of HOURS_OPTIONS) {
      expect(Number.isNaN(Number(opt.value))).toBe(false)
      expect(opt.label.length).toBeGreaterThan(0)
      expect(opt.i18nKey).toMatch(/^fsm\.rangeOption\./)
    }
  })

  it('orders the finite windows strictly ascending before the all-time sentinel', () => {
    const finite = HOURS_OPTIONS.slice(0, -1).map((o) => Number(o.value))
    for (let i = 1; i < finite.length; i++) {
      expect(finite[i]).toBeGreaterThan(finite[i - 1])
    }
  })

  it('resolves every i18nKey to its exact English label in en.json', () => {
    for (const opt of HOURS_OPTIONS) {
      expect(resolveI18nKey(opt.i18nKey), `missing i18n key ${opt.i18nKey}`).toBe(opt.label)
    }
  })

  it('has unique values and unique labels', () => {
    const values = HOURS_OPTIONS.map((o) => o.value)
    const labels = HOURS_OPTIONS.map((o) => o.label)
    expect(new Set(values).size).toBe(HOURS_OPTIONS.length)
    expect(new Set(labels).size).toBe(HOURS_OPTIONS.length)
  })
})

describe('FSMSelectOption', () => {
  it('narrows the value type while keeping label + i18nKey required', () => {
    const typed: FSMSelectOption<FSMType> = {
      value: 'vehicle',
      label: 'Vehicle',
      i18nKey: 'fsm.typeOption.vehicle',
    }
    expect(typed.value).toBe('vehicle')
    expect(typed.label).toBe('Vehicle')
    expect(typed.i18nKey).toContain('fsm.')
  })

  it('defaults its value type to a plain string for non-union tables', () => {
    const generic: FSMSelectOption = { value: 'anything', label: 'Anything', i18nKey: 'k' }
    expect(generic.value).toBe('anything')
    expect(FSM_TYPE_OPTIONS[0]).toMatchObject({
      value: expect.any(String),
      label: expect.any(String),
      i18nKey: expect.any(String),
    })
  })
})

describe('FSMTransition', () => {
  it('models a transition row and leaves details undefined by default', () => {
    const tx = makeTransition()
    expect(tx.from_state).toBe('parked')
    expect(tx.to_state).toBe('driving')
    expect(tx.details).toBeUndefined()
  })

  it('accepts a structured details payload and an explicit null', () => {
    const withDetails = makeTransition({ id: 2, details: { reason: 'ignition_on' } })
    expect(withDetails.details).toEqual({ reason: 'ignition_on' })

    const nulled = makeTransition({ id: 3, details: null })
    expect(nulled.details).toBeNull()
  })
})

describe('ActiveSubFSM', () => {
  it('supports the drive variant carrying a drive_id', () => {
    const sub: ActiveSubFSM = { type: 'drive', state: 'active', start_time: TS, drive_id: 42 }
    expect(sub.type).toBe('drive')
    expect(sub.drive_id).toBe(42)
    expect(sub.session_id).toBeUndefined()
  })

  it('supports the charge variant carrying a session_id within a closed type union', () => {
    const sub: ActiveSubFSM = { type: 'charge', state: 'charging', start_time: TS, session_id: 7 }
    const allowed: ActiveSubFSM['type'][] = ['drive', 'charge']
    expect(sub.session_id).toBe(7)
    expect(allowed).toContain(sub.type)
  })
})

describe('FSMStats', () => {
  it('carries an enabled flag and a numeric stats map with no active_subs by default', () => {
    const stats: FSMStats = { enabled: true, stats: { parked: 5, driving: 2 } }
    expect(stats.enabled).toBe(true)
    expect(stats.stats.parked).toBe(5)
    expect(stats.active_subs).toBeUndefined()
  })

  it('optionally embeds active sub-FSMs', () => {
    const stats: FSMStats = {
      enabled: false,
      stats: {},
      active_subs: [{ type: 'drive', state: 'active', start_time: TS }],
    }
    expect(stats.active_subs).toHaveLength(1)
    expect(stats.active_subs?.[0].type).toBe('drive')
  })
})

describe('FSMTransitionResponse', () => {
  it('wraps a page of transitions with pagination metadata', () => {
    const resp: FSMTransitionResponse = {
      data: [makeTransition()],
      total: 1,
      page: 1,
      per_page: 25,
    }
    expect(resp.data).toHaveLength(1)
    expect(resp.data[0].id).toBe(1)
    expect(resp.total).toBe(1)
    expect(resp.per_page).toBe(25)
  })
})
