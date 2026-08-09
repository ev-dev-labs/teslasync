import { describe, expect, it } from 'vitest'
import {
  isSensitiveManagementKey,
  parseNonEmptyJSONObject,
  summarizeManagementData,
} from './managementJson'

describe('parseNonEmptyJSONObject', () => {
  it.each([
    ['malformed', '{', 'invalid'],
    ['trailing JSON', '{"x":1} {}', 'invalid'],
    ['null', 'null', 'object_required'],
    ['array', '[]', 'object_required'],
    ['scalar', '"x"', 'object_required'],
    ['empty object', '{}', 'empty'],
  ] as const)('rejects %s', (_name, source, reason) => {
    expect(parseNonEmptyJSONObject(source)).toEqual({ ok: false, reason })
  })

  it('returns the exact parsed object shape', () => {
    expect(parseNonEmptyJSONObject('{"opaque":{"nested":[1,true]}}')).toEqual({
      ok: true,
      value: { opaque: { nested: [1, true] } },
    })
  })
})

describe('management JSON safety helpers', () => {
  it.each([
    'token',
    'accessToken',
    'client_secret',
    'PASSWORD',
    'payer_credential',
    'authorization',
  ])('redacts sensitive key %s', (key) => {
    expect(isSensitiveManagementKey(key)).toBe(true)
  })

  it('normalizes known specs fields without stringifying objects', () => {
    expect(
      summarizeManagementData(
        { model: 'Model 3', trim_badging: 'Performance', nested: { x: 1 } },
        'specs',
      ),
    ).toEqual([
      { label: 'model', value: 'Model 3' },
      { label: 'trim', value: 'Performance' },
    ])
  })
})
