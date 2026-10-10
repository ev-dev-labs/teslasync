import { beforeAll, describe, expect, it } from 'vitest'
import { createInstance } from 'i18next'
import catalog from './en.json'
import shell from './en/shell.json'
import runtimeManifest from './en/runtime-manifest.json'
import knownMissing from './known-missing-keys.json'

const additions = [
  ['pwa.update.requiredTitle', 'Update required'],
  ['pwa.update.availableTitle', 'New version available'],
  ['pwa.update.requiredBody', 'This tab is running an older app version than the server. Reload to stay in sync.'],
  ['pwa.update.availableBody', 'A newer build has been downloaded and is ready to apply.'],
  ['pwa.update.runningLabel', 'Running'],
  ['pwa.update.serverLabel', 'Server'],
  ['pwa.update.unsavedBlocked', 'Reload cancelled — finish or discard your unsaved changes first.'],
  ['pwa.update.applying', 'Reloading…'],
  ['pwa.cache.cachedAt', 'Showing data cached {{relative}} ({{absolute}}).'],
  ['pwa.cache.cachedRange', 'Showing cached data captured between {{oldestRelative}} ({{oldestAbsolute}}) and {{newestRelative}}.'],
  ['pwa.cache.cachedUnknown', 'Showing cached data. The capture time is unknown — treat it as stale.'],
  ['pwa.cache.offlineNoData', "You're offline and nothing is cached for this view."],
  ['pwa.cache.regionLabel', 'Cached data disclosure'],
] as const

function nested(resource: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((value, segment) => (
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)[segment]
      : undefined
  ), resource)
}

const english = createInstance()

beforeAll(async () => {
  await english.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: shell } },
    interpolation: { escapeValue: false },
  })
})

describe('canonical PWA update and cached-data disclosure closure', () => {
  it.each(additions)('defines %s exactly in the canonical catalog and cold shell', (key, fallback) => {
    expect(nested(catalog, key)).toBe(fallback)
    expect(nested(shell, key)).toBe(fallback)
    expect(english.exists(key)).toBe(true)
    expect(runtimeManifest.missing).not.toContain(key)
  })

  it('renders captured timestamps from shell resources without a caller fallback', () => {
    expect(english.t('pwa.cache.cachedAt', { relative: 'two hours ago', absolute: '10:00' }))
      .toBe('Showing data cached two hours ago (10:00).')
    expect(english.t('pwa.cache.cachedRange', {
      oldestRelative: 'five hours ago',
      oldestAbsolute: '07:00',
      newestRelative: 'one hour ago',
    })).toBe('Showing cached data captured between five hours ago (07:00) and one hour ago.')
  })

  it('preserves existing PWA labels rather than replacing them with caller defaults', () => {
    expect(catalog.pwa.reloadNow).toBe('Reload now')
    expect(catalog.pwa.later).toBe('Later')
    expect(catalog.pwa.newVersion).toBe('New version available')
    expect(catalog.pwa.reloadingIn).toBe('Reloading in {{seconds}}s...')
    expect(catalog.pwa.offline.title).toBe("You're offline")
    expect(catalog.pwa.offline.banner)
      .toBe('Showing cached data. Operational changes stay disabled until you reconnect.')
  })

  it('keeps the existing known-missing baseline unchanged', () => {
    expect(knownMissing).toHaveLength(21)
    expect(runtimeManifest.missing).toEqual(knownMissing)
  })
})
