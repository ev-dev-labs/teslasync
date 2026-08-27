import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n, {
  flushPendingEnglishResourcesForTest,
  loadEnglishNamespace,
  loadEnglishResources,
} from './index'
import englishShell from './en/shell.json'
import usageManifest from './en/usage-manifest.json'

afterEach(() => {
  flushPendingEnglishResourcesForTest()
  vi.restoreAllMocks()
})

describe('deferred English resources', () => {
  it('keeps the shell readable and hydrates a requested namespace once', async () => {
    expect(i18n.t('statusBar.connection.ok', 'Online fallback')).toBe('Online')
    expect(i18n.t('dashboard.title', 'Dashboard fallback')).toBe('Dashboard fallback')

    const firstLoad = loadEnglishNamespace('dashboard')
    const concurrentLoad = loadEnglishNamespace('dashboard')

    expect(concurrentLoad).toBe(firstLoad)
    await firstLoad
    expect(i18n.t('dashboard.title', 'Dashboard fallback')).not.toBe('Dashboard fallback')
  })

  it('caches unknown namespace failures without poisoning known loads', async () => {
    const first = loadEnglishNamespace('not-a-real-namespace')
    const second = loadEnglishNamespace('not-a-real-namespace')
    expect(second).toBe(first)
    await expect(first).rejects.toThrow(
      'Unknown English translation namespace',
    )

    await expect(loadEnglishNamespace('dashboard')).resolves.toBeUndefined()
  })

  it('keeps dotless source-local labels out of deferred namespace loading', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(i18n.t('SourceLocalLabel', 'Source-local fallback')).toBe('Source-local fallback')
    await new Promise((resolve) => globalThis.setTimeout(resolve, 60))

    expect(consoleError).not.toHaveBeenCalled()
  })

  it('assigns dashboard strings to one usage-local bundle', () => {
    expect(usageManifest.namespaceToBundle.dashboard).toBe('dashboard')
    expect(usageManifest.bundles.dashboard).toContain('dashboard')
  })

  it('loads missing shell detail keys through the real t() handler once', async () => {
    const resourcesAdded = vi.fn()
    i18n.store.on('added', resourcesAdded)

    expect(i18n.t('help.fields.settings.timeFormat', { defaultValue: '__fallback__', saveMissing: true })).toBe('__fallback__')
    expect(i18n.t('help.fields.settings.chartPalette', { defaultValue: '__fallback__', saveMissing: true })).toBe('__fallback__')
    await loadEnglishNamespace('help')

    expect(i18n.t('help.fields.settings.timeFormat', '__fallback__')).not.toBe('__fallback__')
    expect(i18n.t('help.fields.settings.chartPalette', '__fallback__')).not.toBe('__fallback__')
    expect(resourcesAdded).toHaveBeenCalledTimes(1)
    i18n.store.off('added', resourcesAdded)
  })

  it('resolves the production shared-component namespace contract', async () => {
    const contracts = [
      ['density', 'density.compact'],
      ['route', 'route.noLocationData'],
      ['emptyState', 'emptyState.threshold.defaultItem'],
      ['sortControl', 'sortControl.ascending'],
      ['vehicleSelect', 'vehicleSelect.aria'],
      ['productPreferences', 'productPreferences.title'],
      ['statCard', 'statCard.loading'],
      ['workspaceContext', 'workspaceContext.ranges.today'],
    ] as const

    for (const [namespace, key] of contracts) {
      await loadEnglishNamespace(namespace)
      expect(i18n.t(key, '__missing__')).not.toBe('__missing__')
    }
  })

  it('covers every shell-source namespace without loading a deferred bundle', async () => {
    for (const namespace of usageManifest.shellRequiredNamespaces) {
      expect(englishShell).toHaveProperty(namespace)
      expect(usageManifest.namespaceToBundle[namespace]).toBe('shell')
      await expect(loadEnglishNamespace(namespace)).resolves.toBeUndefined()
    }
  })

  it('keeps plural siblings and interpolation in the critical shell', () => {
    expect(i18n.t('date.range.summaryDays', { count: 1 })).toBe('1 day')
    expect(i18n.t('date.range.summaryDays', { count: 2 })).toBe('2 days')
    expect(i18n.t('statusBar.recent.count', { count: 1 })).toBe('1 page')
    expect(i18n.t('statusBar.recent.count', { count: 2 })).toBe('2 pages')
    expect(i18n.t('export.jobDrawer.activeCount', { count: 2 })).toBe('2 exports running')
    expect(i18n.t('palette.recent.minutesAgo', { count: 1 })).toBe('1m ago')
    expect(i18n.t('palette.recent.minutesAgo', { count: 2 })).toBe('2m ago')
  })

  it('batches concurrent resource notifications without changing the language', async () => {
    const languageChanged = vi.fn()
    const resourcesAdded = vi.fn()
    i18n.on('languageChanged', languageChanged)
    i18n.store.on('added', resourcesAdded)

    await Promise.all([
      loadEnglishNamespace('ownership'),
      loadEnglishNamespace('ai'),
      loadEnglishNamespace('batteryPassport'),
    ])

    expect(languageChanged).not.toHaveBeenCalled()
    expect(resourcesAdded).toHaveBeenCalledTimes(1)
    i18n.off('languageChanged', languageChanged)
    i18n.store.off('added', resourcesAdded)
  })

  it('supports explicit complete-catalog loading for language switches', async () => {
    await loadEnglishResources()
    await i18n.changeLanguage('he')
    expect(i18n.t('dashboard.title', 'Dashboard fallback')).not.toBe('Dashboard fallback')
    await i18n.changeLanguage('en')
  })
})
