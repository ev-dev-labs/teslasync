import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { applyDocumentDirection } from '@/lib/i18nDir'
import ar from './ar.json'
import en from './en.json'
import he from './he.json'

i18n.use(initReactI18next).init({
  resources: {
    ar: { translation: ar },
    en: { translation: en },
    he: { translation: he },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

// Phase-46 / Prompt 48 — keep <html dir> + <html lang> in sync with the
// active language. Apply once on boot so the very first paint after i18n
// init matches the resolved language, then again on every subsequent
// `i18n.changeLanguage(...)` call.
applyDocumentDirection(i18n.language)
i18n.on('languageChanged', (lang) => {
  applyDocumentDirection(lang)
})

export default i18n
