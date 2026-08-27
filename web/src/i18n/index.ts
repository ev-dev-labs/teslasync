import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { applyDocumentDirection } from '@/lib/i18nDir'
import ar from './ar.json'
import englishShell from './en/shell.json'
import usageManifest from './en/usage-manifest.json'
import he from './he.json'

const englishNamespaceModules = import.meta.glob<{ default: Record<string, unknown> }>(
  './en/locale-*.json',
)
interface LocaleUsageManifest {
  namespaceToBundle: Record<string, string>
  bundles: Record<string, string[]>
  shellRequiredNamespaces: string[]
  namespaceFallbackBundles: Record<string, string>
  shellCriticalKeys: string[]
  keyFallbackBundles: Record<string, string>
}

const englishUsageManifest = usageManifest as LocaleUsageManifest
const knownEnglishNamespaces = new Set(Object.keys(englishUsageManifest.namespaceToBundle))

function recordProbeMissingKey(key: string) {
  const target = globalThis as typeof globalThis & { __TESLASYNC_I18N_PROBE_KEYS__?: string[] }
  if (target.__TESLASYNC_I18N_PROBE_KEYS__) target.__TESLASYNC_I18N_PROBE_KEYS__.push(key)
}

i18n.use(initReactI18next).init({
  resources: {
    ar: { translation: ar },
    en: { translation: englishShell },
    he: { translation: he },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  react: {
    bindI18n: 'languageChanged',
    bindI18nStore: 'added',
  },
  saveMissing: true,
  missingKeyHandler: (_languages, namespace, key) => {
    if (namespace !== 'translation') return
    const keyPath = String(key)
    if (!keyPath.includes('.')) return
    const topLevelNamespace = keyPath.split('.')[0]
    if (!knownEnglishNamespaces.has(topLevelNamespace)) return
    if (englishUsageManifest.shellCriticalKeys.includes(keyPath)) return
    recordProbeMissingKey(keyPath)
    const fallbackBundle = englishUsageManifest.keyFallbackBundles[keyPath]
      ?? englishUsageManifest.namespaceFallbackBundles[topLevelNamespace]
    if (fallbackBundle) {
      void loadEnglishBundle(fallbackBundle).catch((error: unknown) => {
        if (!reportedUnknownNamespaces.has(topLevelNamespace)) {
          reportedUnknownNamespaces.add(topLevelNamespace)
          console.error(`[i18n] Failed to load English namespace "${topLevelNamespace}":`, error)
        }
      })
      return
    }
    void requestEnglishNamespace(topLevelNamespace)
  },
})

// Keep <html dir> + <html lang> in sync with the active language.
// Apply once on boot so the very first paint after i18n
// init matches the resolved language, then again on every subsequent
// `i18n.changeLanguage(...)` call.
applyDocumentDirection(i18n.language)
i18n.on('languageChanged', (lang) => {
  applyDocumentDirection(lang)
})

interface ResourceStoreInternals {
  addResourceBundle(
    language: string,
    namespace: string,
    resources: Record<string, unknown>,
    deep: boolean,
    overwrite: boolean,
    options: { silent: boolean; skipCopy: boolean },
  ): void
  emit(event: 'added', language: string, namespace: string): void
}

const englishBundlePromises = new Map<string, Promise<void>>()
const englishNamespacePromises = new Map<string, Promise<void>>()
const negativeNamespacePromises = new Map<string, Promise<void>>()
const reportedUnknownNamespaces = new Set<string>()
const pendingResources: Record<string, unknown>[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let flushResolvers: Array<() => void> = []

function flushResources() {
  flushTimer = null
  const resources = pendingResources.splice(0)
  const resolvers = flushResolvers
  flushResolvers = []
  const store = i18n.store as unknown as ResourceStoreInternals

  for (const resource of resources) {
    store.addResourceBundle('en', 'translation', resource, true, true, {
      silent: true,
      skipCopy: true,
    })
  }
  // react-i18next listens to the resource-store event. A single debounced
  // emission refreshes every concurrent namespace without a global language
  // change or one rerender per downloaded locale bundle.
  store.emit('added', 'en', 'translation')
  resolvers.forEach((resolve) => resolve())
}

function queueResources(resources: Record<string, unknown>) {
  return new Promise<void>((resolve) => {
    pendingResources.push(resources)
    flushResolvers.push(resolve)
    if (flushTimer !== null) globalThis.clearTimeout(flushTimer)
    flushTimer = globalThis.setTimeout(flushResources, 50)
  })
}

/** Test-only scheduler drain that prevents a delayed store event leaking into a later test. */
export function flushPendingEnglishResourcesForTest() {
  if (flushTimer === null) return
  globalThis.clearTimeout(flushTimer)
  flushResources()
}

function unknownNamespace(namespace: string) {
  const existing = negativeNamespacePromises.get(namespace)
  if (existing) return existing
  const promise = Promise.reject(new Error(`Unknown English translation namespace: ${namespace}`))
  // The missing-key caller consumes this rejection. Keeping it cached means
  // repeated t() calls neither retry work nor flood console output.
  promise.catch(() => undefined)
  negativeNamespacePromises.set(namespace, promise)
  return promise
}

function hasEnglishNamespace(namespace: string) {
  const resources = i18n.getResourceBundle('en', 'translation') as Record<string, unknown> | undefined
  return resources !== undefined && Object.prototype.hasOwnProperty.call(resources, namespace)
}

function loadEnglishBundle(bundle: string): Promise<void> {
  const existing = englishBundlePromises.get(bundle)
  if (existing) return existing
  const loadModule = englishNamespaceModules[`./en/locale-${bundle}.json`]
  if (!loadModule) return Promise.reject(new Error(`Unknown English locale bundle: ${bundle}`))

  const promise = loadModule()
    .then(({ default: resources }) => queueResources(resources))
    .catch((error: unknown) => {
      englishBundlePromises.delete(bundle)
      throw error
    })
  englishBundlePromises.set(bundle, promise)
  return promise
}

function requestEnglishNamespace(namespace: string) {
  return loadEnglishNamespace(namespace).catch((error: unknown) => {
    if (!reportedUnknownNamespaces.has(namespace)) {
      reportedUnknownNamespaces.add(namespace)
      console.error(`[i18n] Failed to load English namespace "${namespace}":`, error)
    }
  })
}

/**
 * Loads the English namespace for a feature after it first requests a key.
 *
 * The promise is cached only while it succeeds. A failed network/chunk load
 * can be retried on a later render without losing the caller's inline fallback.
 */
export function loadEnglishNamespace(namespace: string): Promise<void> {
  const existing = englishNamespacePromises.get(namespace)
  if (existing) return existing

  const bundle = englishUsageManifest.namespaceFallbackBundles[namespace]
    ?? englishUsageManifest.namespaceToBundle[namespace]
  if (!bundle) return unknownNamespace(namespace)

  const promise = loadEnglishBundle(bundle)
    .then(() => {
      if (hasEnglishNamespace(namespace)) return
      return unknownNamespace(namespace)
    })
    .catch((error: unknown) => {
      if (!negativeNamespacePromises.has(namespace)) {
        englishNamespacePromises.delete(namespace)
      }
      throw error
    })
  englishNamespacePromises.set(namespace, promise)
  return promise
}

/**
 * Load all deferred English namespaces.
 *
 * This compatibility helper is deliberately not called during startup. Tests
 * and explicit preloading flows can use it when they require a complete
 * catalog, while normal route rendering loads only requested namespaces.
 */
export function loadEnglishResources(): Promise<void> {
  return Promise.all(
    [...new Set([
      ...Object.keys(englishUsageManifest.bundles).filter((bundle) => bundle !== 'shell'),
      ...Object.values(englishUsageManifest.namespaceFallbackBundles),
    ])]
      .map(loadEnglishBundle),
  ).then(() => undefined)
}

export default i18n
