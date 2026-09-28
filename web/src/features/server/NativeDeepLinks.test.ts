import { describe, expect, it } from 'vitest'
import { nativeLinkToRoute } from './NativeDeepLinks'

describe('nativeLinkToRoute', () => {
  it.each([
    ['teslasync://', '/'],
    ['teslasync://glance', '/glance'],
    ['teslasync://vehicles', '/vehicles'],
    ['teslasync://notifications/inbox', '/notifications/inbox'],
    ['web+teslasync://vehicles', '/vehicles'],
    ['  teslasync://battery  ', '/battery'],
  ])('maps %q', (input, want) => {
    expect(nativeLinkToRoute(input)).toBe(want)
  })

  it.each([
    ['https://teslasync.example.com/vehicles', 'foreign scheme'],
    ['teslasync://vehicles/7', 'parameterised route'],
    ['teslasync://settings/admin', 'non-allowlisted page'],
    ['web+teslasync://vehicles/7', 'non-allowlisted protocol target'],
    ['not a url', 'unparseable'],
    ['', 'empty'],
    [null, 'non-string'],
  ])('rejects %q (%s)', (input) => {
    expect(nativeLinkToRoute(input)).toBeNull()
  })

  it('drops query strings and fragments', () => {
    expect(nativeLinkToRoute('teslasync://drives?x=1#top')).toBe('/drives')
  })
})
