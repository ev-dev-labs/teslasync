import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import catalog from './en.json'
import baseline from './known-missing-keys.json'
import shell from './en/shell.json'
import runtimeManifest from './en/runtime-manifest.json'
import usageManifest from './en/usage-manifest.json'
import i18n, { flushPendingEnglishResourcesForTest, loadEnglishNamespace } from './index'

type Json = Record<string, unknown>

const additions = [
  ['browserNotifications.toast.alertTitle', 'TeslaSync Alert'],
  ['browserNotifications.toast.exportFailedBody', 'Data export failed. Check the exports page for details.'],
  ['browserNotifications.toast.exportFailedTitle', 'Export Failed'],
  ['browserNotifications.toast.exportReadyBody', '{{filename}} is ready for download'],
  ['browserNotifications.toast.exportReadyBodyGeneric', 'Your data export is ready for download'],
  ['browserNotifications.toast.exportReadyTitle', 'Export Ready'],
  ['error.forbidden.message', 'Your account does not have permission to view or change this resource.'],
  ['error.forbidden.title', 'Permission denied'],
  ['error.request.message', 'Review the request and try again. No changes were applied.'],
  ['error.timeout.message', 'The service did not respond in time. Existing data has not been changed.'],
  ['error.timeout.title', 'Request timed out'],
  ['error.unavailable.message', 'A required service is temporarily unavailable. Try again after it recovers.'],
  ['error.unsupported.message', 'This feature is not available with the current server or deployment configuration.'],
  ['replay.shortcuts.seekBack', '⏪ −{{n}}s'],
  ['replay.shortcuts.seekForward', '⏩ +{{n}}s'],
  ['table.genericName', 'Data table'],
  ['table.selection.deselectRowNamed', 'Deselect {{row}}'],
  ['table.selection.selectRowNamed', 'Select {{row}}'],
] as const

const remaining = [
  'error.request.title',
  'error.unavailable.title',
  'error.unsupported.title',
]

const generated = import.meta.glob<{ default: Json }>('./en/locale-detail-*.json', { eager: true })

function nested(object: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((value, segment) =>
    value && typeof value === 'object' ? (value as Json)[segment] : undefined, object)
}

function leaves(object: Json, prefix = ''): [string, unknown][] {
  return Object.entries(object).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return value && typeof value === 'object' && !Array.isArray(value)
      ? leaves(value as Json, path)
      : [[path, value] as [string, unknown]]
  })
}

afterEach(() => {
  flushPendingEnglishResourcesForTest()
})

describe('resolved known-missing canonical producers', () => {
  it.each(additions)('ships the source-proven value for %s in canonical and generated resources', (key, value) => {
    expect(nested(catalog, key)).toBe(value)
    expect(nested(shell, key)).toBe(value)
    const namespace = key.split('.')[0]
    expect(nested(generated[`./en/locale-detail-${namespace}.json`].default, key)).toBe(value)
  })

  it('preserves every old English leaf, including Settings and critical PWA copy', () => {
    const addedKeys = new Set<string>(additions.map(([key]) => key))
    const oldEntries = leaves(catalog)
      .filter(([key]) => !addedKeys.has(key))
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    expect(oldEntries).toHaveLength(28158)
    // Frozen before-producer leaf/value fingerprint, not a regenerated baseline.
    expect(createHash('sha256').update(JSON.stringify(oldEntries)).digest('hex'))
      .toBe('d919112ce76ecf5875dc1641f99561a22871a3ca3c9ce9a58c70d308ce34a6ad')
    expect(leaves(catalog)).toHaveLength(28176)
    expect(catalog.settings.title).toBe('Settings')
    expect(catalog.pwa.offline.banner).toBe(
      'Showing cached data. Operational changes stay disabled until you reconnect.',
    )
    expect(shell.pwa.offline).toEqual(catalog.pwa.offline)
    expect(shell.pwa.update).toEqual(catalog.pwa.update)
    expect(shell.pwa.cache).toEqual(catalog.pwa.cache)
    expect(catalog.pwa).toMatchObject(shell.pwa)
  })

  it('prunes exactly the eighteen resolved suppressions and retains only three genuine misses', () => {
    expect(additions).toHaveLength(18)
    expect(baseline).toEqual(remaining)
    expect(runtimeManifest.missing).toEqual(remaining)
    expect(usageManifest.knownMissingKeys).toEqual(remaining)
    for (const key of remaining) {
      expect(nested(catalog, key)).toBeUndefined()
      expect(nested(shell, key)).toBeUndefined()
      expect(nested(generated['./en/locale-detail-error.json'].default, key)).toBeUndefined()
    }
    expect(usageManifest.shellCriticalKeys).toEqual(expect.arrayContaining([
      ...remaining,
      ...additions.map(([key]) => key),
    ]))
  })

  it('resolves actual generated English through the existing i18next loader and interpolator', async () => {
    await Promise.all(['browserNotifications', 'error', 'replay', 'table', 'settings', 'pwa']
      .map(namespace => loadEnglishNamespace(namespace)))
    for (const [key, value] of additions) {
      expect(i18n.exists(key, { lng: 'en' })).toBe(true)
      expect(i18n.t(key, { lng: 'en', defaultValue: '__unresolved__', skipInterpolation: true }))
        .toBe(value)
    }
    expect(i18n.t('browserNotifications.toast.exportReadyBody', { lng: 'en', filename: 'fleet.csv' }))
      .toBe('fleet.csv is ready for download')
    expect(i18n.t('replay.shortcuts.seekBack', { lng: 'en', n: 30 })).toBe('⏪ −30s')
    expect(i18n.t('replay.shortcuts.seekForward', { lng: 'en', n: 5 })).toBe('⏩ +5s')
    expect(i18n.t('table.selection.selectRowNamed', { lng: 'en', row: 'Drive 42' })).toBe('Select Drive 42')
    expect(i18n.t('table.selection.deselectRowNamed', { lng: 'en', row: 'Drive 42' })).toBe('Deselect Drive 42')
    expect(i18n.t('settings.title', { lng: 'en' })).toBe('Settings')
    for (const [key, value] of leaves(catalog.pwa, 'pwa')) {
      expect(i18n.t(key, { lng: 'en', skipInterpolation: true })).toBe(value)
    }
    for (const key of remaining) expect(i18n.exists(key, { lng: 'en' })).toBe(false)
  })
})
