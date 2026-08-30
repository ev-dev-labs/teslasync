import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n, {
  flushPendingEnglishResourcesForTest,
  loadEnglishNamespace,
  loadEnglishResources,
} from './index'
import englishShell from './en/shell.json'
import runtimeManifest from './en/runtime-manifest.json'
import usageManifest from './en/usage-manifest.json'

const generatedCatalogs = import.meta.glob<{ default: Record<string, unknown> }>(
  './en/locale-*.json',
  { eager: true },
)

/** Every leaf key the generated locale chunks can serve, in a stable order. */
function deferredCatalogKeys(): string[] {
  const keys: string[] = []
  const collect = (value: unknown, prefix: string) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      keys.push(prefix)
      return
    }
    for (const [segment, child] of Object.entries(value as Record<string, unknown>)) {
      collect(child, prefix ? `${prefix}.${segment}` : segment)
    }
  }
  for (const path of Object.keys(generatedCatalogs).sort()) {
    collect(generatedCatalogs[path].default, '')
  }
  return keys
}

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

  it('does not let a steady trickle of loads postpone the batched flush', async () => {
    const resourcesAdded = vi.fn()
    i18n.store.on('added', resourcesAdded)

    const first = loadEnglishNamespace('resaleVault')
    await new Promise((resolve) => globalThis.setTimeout(resolve, 30))
    const second = loadEnglishNamespace('sharing')
    await Promise.all([first, second])

    // A debounce that reset on every arrival would still be pending here.
    expect(resourcesAdded).toHaveBeenCalled()
    i18n.store.off('added', resourcesAdded)
  })

  it('loads only the requested namespace when a per-namespace fallback backs it', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(i18n.t('battery.passport.title', '__missing__')).toBe('__missing__')
    await loadEnglishNamespace('toast')
    flushPendingEnglishResourcesForTest()

    expect(i18n.t('toast.common.error', '__missing__')).not.toBe('__missing__')
    // `battery` lives in its own fallback chunk, so resolving a toast string
    // must not have pulled it in.
    expect(i18n.t('battery.passport.title', '__missing__')).toBe('__missing__')
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('reports an unknown namespace exactly once no matter how often it is asked for', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(i18n.t('notARealNamespace.someKey', '__fallback__')).toBe('__fallback__')
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 60))

    // The namespace is not in the manifest at all, so nothing is requested and
    // nothing is logged — a typo can never become a request loop.
    expect(consoleError).not.toHaveBeenCalled()
    await expect(loadEnglishNamespace('notARealNamespace')).rejects.toThrow(
      'Unknown English translation namespace',
    )
  })

  it('does not request a deferred bundle for a plural key the shell already answers', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const probe: string[] = []
    const target = globalThis as typeof globalThis & { __TESLASYNC_I18N_PROBE_KEYS__?: string[] }
    target.__TESLASYNC_I18N_PROBE_KEYS__ = probe

    expect(i18n.t('statusBar.recent.count', { count: 3, saveMissing: true })).toBe('3 pages')
    expect(i18n.t('date.range.summaryDays', { count: 1, saveMissing: true })).toBe('1 day')

    expect(probe).toEqual([])
    expect(consoleError).not.toHaveBeenCalled()
    delete target.__TESLASYNC_I18N_PROBE_KEYS__
  })

  it('routes a deferred shell namespace through its own per-namespace bundle', () => {
    expect(runtimeManifest.detail).toContain('toast')
    expect(runtimeManifest.detail).toContain('battery')
    expect(Object.values(runtimeManifest.grouped).flat()).not.toContain('toast')
    expect(usageManifest.namespaceFallbackBundles.toast).toBe('detail-toast')
    expect(usageManifest.namespaceFallbackBundles.battery).toBe('detail-battery')
  })

  it('never requests a chunk for a namespace the shell already carries in full', async () => {
    const probe: string[] = []
    const target = globalThis as typeof globalThis & { __TESLASYNC_I18N_PROBE_KEYS__?: string[] }
    target.__TESLASYNC_I18N_PROBE_KEYS__ = probe
    expect(runtimeManifest.complete).toContain('nav')

    // `nav` ships complete, so an aria key that never made it into the catalog
    // must fall back inline instead of triggering a cold-start chunk request.
    expect(i18n.t('nav.sidebar', { defaultValue: 'Sidebar', saveMissing: true })).toBe('Sidebar')
    expect(probe).toEqual([])
    await expect(loadEnglishNamespace('nav')).resolves.toBeUndefined()

    delete target.__TESLASYNC_I18N_PROBE_KEYS__
  })

  it('never requests a chunk for a key the build proved is absent from the catalog', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const probe: string[] = []
    const target = globalThis as typeof globalThis & { __TESLASYNC_I18N_PROBE_KEYS__?: string[] }
    target.__TESLASYNC_I18N_PROBE_KEYS__ = probe

    const suppressed = runtimeManifest.missing
    expect(suppressed.length).toBeGreaterThan(0)
    for (const key of suppressed) {
      expect(i18n.t(key, { defaultValue: '__inline__', saveMissing: true })).toBe('__inline__')
    }

    // Every one of these would otherwise have pulled a locale-detail chunk
    // that provably cannot contain the key.
    expect(probe).toEqual([])
    await new Promise((resolve) => globalThis.setTimeout(resolve, 60))
    expect(consoleError).not.toHaveBeenCalled()
    delete target.__TESLASYNC_I18N_PROBE_KEYS__
  })

  it('suppresses the plural forms of a known-missing key too', () => {
    const probe: string[] = []
    const target = globalThis as typeof globalThis & { __TESLASYNC_I18N_PROBE_KEYS__?: string[] }
    target.__TESLASYNC_I18N_PROBE_KEYS__ = probe

    const [suppressed] = runtimeManifest.missing
    expect(i18n.t(`${suppressed}_other`, { defaultValue: '__inline__', saveMissing: true })).toBe('__inline__')
    expect(i18n.t(suppressed, { count: 2, defaultValue: '__inline__', saveMissing: true })).toBe('__inline__')

    expect(probe).toEqual([])
    delete target.__TESLASYNC_I18N_PROBE_KEYS__
  })

  it('still fetches a key that is absent from the shell but present in the catalog', async () => {
    const probe: string[] = []
    const target = globalThis as typeof globalThis & { __TESLASYNC_I18N_PROBE_KEYS__?: string[] }
    target.__TESLASYNC_I18N_PROBE_KEYS__ = probe

    // Pick a real catalog key that this shared i18n instance has not loaded
    // yet, so the assertion observes an actual fetch rather than a cache hit.
    const fetchable = deferredCatalogKeys().find(
      (key) => !runtimeManifest.missing.includes(key) && !i18n.exists(key),
    )
    expect(fetchable).toBeDefined()
    expect(i18n.t(fetchable as string, { defaultValue: '__inline__', saveMissing: true })).toBe('__inline__')

    // Suppression must not leak into keys the catalog can answer: this one is
    // requested, downloaded and then resolves for real.
    expect(probe).toEqual([fetchable])
    await loadEnglishNamespace((fetchable as string).split('.')[0])
    flushPendingEnglishResourcesForTest()
    expect(i18n.t(fetchable as string, '__inline__')).not.toBe('__inline__')

    delete target.__TESLASYNC_I18N_PROBE_KEYS__
  })

  it('supports explicit complete-catalog loading for language switches', async () => {
    await loadEnglishResources()
    await i18n.changeLanguage('he')
    expect(i18n.t('dashboard.title', 'Dashboard fallback')).not.toBe('Dashboard fallback')
    await i18n.changeLanguage('en')
  })
})
