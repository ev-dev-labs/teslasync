import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { applyDocumentDirection } from '@/lib/i18nDir'
import ar from './ar.json'
import he from './he.json'

i18n.use(initReactI18next).init({
  resources: {
    ar: { translation: ar },
    en: { translation: {} },
    he: { translation: he },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

// Keep <html dir> + <html lang> in sync with the active language.
// Apply once on boot so the very first paint after i18n
// init matches the resolved language, then again on every subsequent
// `i18n.changeLanguage(...)` call.
applyDocumentDirection(i18n.language)
i18n.on('languageChanged', (lang) => {
  applyDocumentDirection(lang)
})

let englishResourcesPromise: Promise<void> | null = null

/**
 * Load the full English catalog after the application shell starts.
 *
 * English strings passed as `t()` defaults keep the first render readable;
 * the 1 MB catalog then hydrates translated values without blocking entry
 * parsing or first paint. The cached promise also prevents duplicate chunks
 * when several startup consumers request the catalog concurrently.
 */
export function loadEnglishResources(): Promise<void> {
  if (englishResourcesPromise) return englishResourcesPromise

  englishResourcesPromise = import('./en.json')
    .then(async ({ default: englishResources }) => {
      i18n.addResourceBundle('en', 'translation', englishResources, true, true)
      await i18n.changeLanguage(i18n.language)
    })
    .catch((error: unknown) => {
      englishResourcesPromise = null
      throw error
    })

  return englishResourcesPromise
}

export default i18n
