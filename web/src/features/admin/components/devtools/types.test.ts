import { describe, it, expect, vi } from 'vitest'

// helpers.ts pulls the resilient HTTP client in at module-load time via its
// `request` import. The TelemetryError contract exercised here
// (extractTelemetryErrors + the pickString mechanism that fills its string
// fields) is pure, so we stub the network module to keep the suite hermetic
// and offline — mirroring InfrastructureSection.test.tsx in this directory.
vi.mock('@/api/client', () => ({ request: vi.fn() }))

import { extractTelemetryErrors, pickString } from './helpers'
import type { TelemetryError } from './types'

// ---------------------------------------------------------------------------
// devtools/types — TelemetryError contract tests
//
// types.ts exports a single interface, TelemetryError: the UI-normalised row
// shape rendered by TelemetryErrorsPanel's <DataTable> and its Column<> cell
// renderers. An interface has no runtime footprint, so the only honest way to
// lock it is to pin the contract at its two boundaries:
//
//   producer → extractTelemetryErrors (the Tesla fleet-telemetry-errors
//              normaliser) is the SOLE factory for TelemetryError values. Its
//              output must structurally satisfy the interface for every
//              observed Tesla wire variant.
//   consumer → every field a Column render / keyExtractor reads must be a
//              *defined string* — never undefined — so `r.timestamp ? … : '—'`
//              and `keyExtractor={(r) => r.rowKey}` can never throw, and
//              rowKey must stay collision-free (its documented headline
//              promise) so DataTable keys never clash.
//
// This mirrors constants.test.ts: lock the invariants the consumers silently
// rely on so a wire-shape drift or a field rename can't regress the UI unseen.
// ---------------------------------------------------------------------------

/**
 * Runtime guard that also pins the interface at compile time: `row` is typed
 * TelemetryError, so a field rename/removal in types.ts breaks this file, and
 * at runtime it asserts the four consumer invariants — exactly four keys, all
 * of them defined strings.
 */
function assertTelemetryErrorShape(row: TelemetryError): void {
  expect(Object.keys(row).sort()).toEqual(['code', 'message', 'rowKey', 'timestamp'])
  expect(typeof row.rowKey).toBe('string')
  expect(typeof row.timestamp).toBe('string')
  expect(typeof row.code).toBe('string')
  expect(typeof row.message).toBe('string')
}

describe('TelemetryError shape produced by extractTelemetryErrors', () => {
  it('conforms to the interface for the canonical Tesla per-vehicle envelope', () => {
    const { errors, ok } = extractTelemetryErrors({
      response: {
        errors: [
          {
            vin: '5YJ3E1EA1NF000001',
            error_code: 'TELEMETRY_CONNECTION_LOST',
            error_message: 'mtls handshake failed',
            reported_at: '2024-05-01T12:00:00Z',
          },
        ],
      },
    })

    expect(ok).toBe(true)
    expect(errors).toHaveLength(1)
    assertTelemetryErrorShape(errors[0]!)
    expect(errors[0]).toEqual({
      rowKey: '2024-05-01T12:00:00Z|TELEMETRY_CONNECTION_LOST|5YJ3E1EA1NF000001|0',
      timestamp: '2024-05-01T12:00:00Z',
      code: 'TELEMETRY_CONNECTION_LOST',
      message: 'mtls handshake failed',
    })
  })

  it('never leaks keys beyond the four interface fields (vin is folded into rowKey, not exposed)', () => {
    const { errors } = extractTelemetryErrors({
      errors: [{ vin: 'V1', error_code: 'E', error_message: 'm', reported_at: 't', extra: 'ignored' }],
    })

    expect(Object.keys(errors[0]!).sort()).toEqual(['code', 'message', 'rowKey', 'timestamp'])
    // vin must NOT surface as its own field — consumers type against the 4-key
    // interface and would break if the extractor started leaking wire fields.
    expect(Object.prototype.hasOwnProperty.call(errors[0]!, 'vin')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(errors[0]!, 'extra')).toBe(false)
  })

  it('yields defined string fields even for a totally empty row (no undefined leaks into the table)', () => {
    const { errors, ok } = extractTelemetryErrors({ errors: [{}] })

    expect(ok).toBe(true)
    assertTelemetryErrorShape(errors[0]!)
    // Missing wire fields collapse to '' (never undefined) so the column
    // fallbacks (`value || '—'`) render a dash rather than crashing on read.
    expect(errors[0]).toEqual({ rowKey: '|||0', timestamp: '', code: '', message: '' })
  })
})

describe('TelemetryError field normalisation across wire aliases', () => {
  it('maps the snake_case Tesla envelope fields onto the interface fields', () => {
    const { errors } = extractTelemetryErrors({
      errors: [{ reported_at: 'a', error_code: 'b', error_message: 'c', vin: 'd' }],
    })

    expect(errors[0]!.timestamp).toBe('a')
    expect(errors[0]!.code).toBe('b')
    expect(errors[0]!.message).toBe('c')
  })

  it('accepts the alternate proxy field names (ts / topic / body)', () => {
    const { errors } = extractTelemetryErrors({
      errors: [{ ts: 'a', topic: 'b', body: 'c' }],
    })

    assertTelemetryErrorShape(errors[0]!)
    expect(errors[0]!.timestamp).toBe('a')
    expect(errors[0]!.code).toBe('b')
    expect(errors[0]!.message).toBe('c')
  })

  it('coerces numeric wire values into the interface string fields', () => {
    const { errors } = extractTelemetryErrors({
      errors: [{ reported_at: 1700000000, error_code: 429, error_message: 500 }],
    })

    assertTelemetryErrorShape(errors[0]!)
    expect(errors[0]!.timestamp).toBe('1700000000')
    expect(errors[0]!.code).toBe('429')
    expect(errors[0]!.message).toBe('500')
  })

  it('treats null / undefined array rows as empty rows rather than throwing', () => {
    const { errors, ok } = extractTelemetryErrors({ errors: [null, undefined, { reported_at: 't' }] })

    expect(ok).toBe(true)
    expect(errors).toHaveLength(3)
    errors.forEach(assertTelemetryErrorShape)
    expect(errors.map((e) => e.timestamp)).toEqual(['', '', 't'])
  })
})

describe('rowKey uniqueness contract (the interface headline promise)', () => {
  it('composes rowKey as timestamp|code|vin|index', () => {
    const { errors } = extractTelemetryErrors({
      errors: [{ reported_at: 'T', error_code: 'C', vin: 'V', error_message: 'ignored-in-key' }],
    })

    expect(errors[0]!.rowKey).toBe('T|C|V|0')
  })

  it('keeps identical errors reported at the same instant collision-free via the row index', () => {
    const dup = { reported_at: 'same', error_code: 'same', vin: 'same', error_message: 'same' }
    const { errors } = extractTelemetryErrors({ errors: [dup, dup, dup] })

    const keys = errors.map((e) => e.rowKey)
    expect(keys).toEqual(['same|same|same|0', 'same|same|same|1', 'same|same|same|2'])
    // The whole point of embedding the index: no two rows can ever share a key,
    // which is what DataTable.keyExtractor relies on.
    expect(new Set(keys).size).toBe(errors.length)
  })

  it('stays collision-free even when identifiers themselves contain the "|" delimiter', () => {
    const { errors } = extractTelemetryErrors({
      errors: [
        { error_code: 'a|b', reported_at: 'c', vin: 'd' },
        { error_code: 'a', reported_at: 'b|c', vin: 'd' },
      ],
    })

    const keys = errors.map((e) => e.rowKey)
    expect(new Set(keys).size).toBe(2)
  })
})

describe('extractTelemetryErrors wire-variant unwrapping', () => {
  it('unwraps the {response:{errors:[…]}} envelope', () => {
    const { errors, ok } = extractTelemetryErrors({ response: { errors: [{ error_code: 'x' }] } })
    expect(ok).toBe(true)
    expect(errors).toHaveLength(1)
    expect(errors[0]!.code).toBe('x')
  })

  it('reads a top-level {errors:[…]} object', () => {
    const { errors, ok } = extractTelemetryErrors({ errors: [{ error_code: 'x' }] })
    expect(ok).toBe(true)
    expect(errors[0]!.code).toBe('x')
  })

  it('reads a bare top-level array', () => {
    const { errors, ok } = extractTelemetryErrors([{ error_code: 'x' }])
    expect(ok).toBe(true)
    expect(errors[0]!.code).toBe('x')
  })

  it('reads {response:[…]} where the response IS the array', () => {
    const { errors, ok } = extractTelemetryErrors({ response: [{ error_code: 'x' }] })
    expect(ok).toBe(true)
    expect(errors[0]!.code).toBe('x')
  })

  it('prefers the top-level errors array over a nested response.errors', () => {
    const { errors } = extractTelemetryErrors({
      errors: [{ error_code: 'top' }],
      response: { errors: [{ error_code: 'nested' }] },
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]!.code).toBe('top')
  })
})

describe('extractTelemetryErrors ok flag (healthy-zero vs unknown-shape)', () => {
  it('returns { errors: [], ok: true } for a successful response with zero errors', () => {
    // ok:true lets the panel say "vehicle is healthy" instead of surfacing the
    // raw-response debug disclosure.
    expect(extractTelemetryErrors({ errors: [] })).toEqual({ errors: [], ok: true })
    expect(extractTelemetryErrors({ response: { errors: [] } })).toEqual({ errors: [], ok: true })
    expect(extractTelemetryErrors([])).toEqual({ errors: [], ok: true })
  })

  it('returns { errors: [], ok: false } for every unrecognised shape', () => {
    // ok:false is what drives the "unrecognised Tesla shape" raw disclosure —
    // the alternative (throwing) is the silent-empty-table bug this guards.
    const unknownShapes: unknown[] = [
      null,
      undefined,
      'oops',
      42,
      true,
      {},
      { errors: 'not-an-array' },
      { response: { errors: 'nope' } },
    ]
    for (const shape of unknownShapes) {
      expect(extractTelemetryErrors(shape)).toEqual({ errors: [], ok: false })
    }
  })
})

describe('the produced rows are render-safe for the FleetApiSection columns', () => {
  it('mirrors the Column render + keyExtractor access pattern without null guards failing', () => {
    const { errors } = extractTelemetryErrors({
      errors: [
        { reported_at: '2024-01-01T00:00:00Z', error_code: 'E1', error_message: 'boom', vin: 'V1' },
        {},
      ],
    })

    // Replicate errorColumns' render accessors + keyExtractor from
    // FleetApiSection so the type is validated in the shape it is consumed.
    const rendered = errors.map((r) => ({
      key: r.rowKey,
      timestamp: r.timestamp ? r.timestamp : '—',
      code: r.code || '—',
      message: r.message || '—',
    }))

    expect(rendered[0]).toEqual({
      key: '2024-01-01T00:00:00Z|E1|V1|0',
      timestamp: '2024-01-01T00:00:00Z',
      code: 'E1',
      message: 'boom',
    })
    expect(rendered[1]).toEqual({ key: '|||1', timestamp: '—', code: '—', message: '—' })
    expect(new Set(rendered.map((r) => r.key)).size).toBe(2)
  })
})

describe('pickString — the mechanism guaranteeing TelemetryError string fields', () => {
  it('returns the first matching key in precedence order', () => {
    expect(pickString({ timestamp: 'b', reported_at: 'a' }, ['reported_at', 'timestamp'])).toBe('a')
  })

  it('skips empty strings and falls through to the next candidate key', () => {
    // An empty string must NOT win — otherwise a blank reported_at would mask a
    // usable fallback field and the row would render a spurious dash.
    expect(pickString({ reported_at: '', timestamp: 'b' }, ['reported_at', 'timestamp'])).toBe('b')
  })

  it('coerces the first numeric candidate to a string', () => {
    expect(pickString({ reported_at: 0 }, ['reported_at'])).toBe('0')
    expect(pickString({ code: 404 }, ['code'])).toBe('404')
  })

  it('returns an empty string (never undefined) when no key matches', () => {
    expect(pickString({}, ['reported_at', 'timestamp'])).toBe('')
    expect(pickString({ other: 'x' }, ['reported_at'])).toBe('')
  })
})
