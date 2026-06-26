/**
 * @module i18n
 *
 * Native parity for web/src/i18n/index.ts — the i18next boot + writing-direction
 * wiring.
 *
 * The web entry initializes i18next through react-i18next and keeps `<html dir>`
 * and `<html lang>` in sync with the active language. React Native ships neither
 * i18next/react-i18next nor a DOM `document`, so this module provides a
 * native-safe i18n singleton that mirrors the slice of the i18next surface the
 * app relies on (`language`, `languages`, `t`, `on`/`off`, `changeLanguage`, and
 * the chainable `use(...).init(...)` boot calls) and applies direction through
 * React Native's `I18nManager` instead of the document element.
 *
 * Parity intent preserved from the source:
 *   - registered languages: en (default), ar, he   (source L4-6, L10-12)
 *   - active language `lng`: 'en'                   (source L14)
 *   - `fallbackLng`: 'en'                           (source L15)
 *   - `interpolation.escapeValue`: false            (source L16)
 *   - direction is applied once on boot AND again on every `languageChanged`
 *     (source L19-26)
 *
 * The 397 KB web `en.json` translation table is intentionally NOT bundled into
 * the RN app; consistent with the rest of the native parity tree, `t(key,
 * defaultValue)` resolves the English default string directly. The `ar`/`he`
 * placeholder resources mirror the `_meta` stubs in web/src/i18n.
 */

import {I18nManager} from 'react-native';

// --- Direction primitives (native parity for @/lib/i18nDir, source L3) --------

/** ISO-639-1 codes that render right-to-left. Mirrors `RTL_LANGS` in i18nDir. */
const RTL_LANGS: ReadonlySet<string> = new Set(['ar', 'he', 'fa', 'ur']);

/** Writing direction primitive — mirrors the web `<html dir>` value. */
export type Direction = 'ltr' | 'rtl';

/**
 * Resolve the writing direction for an i18next-style language tag. Region
 * subtags (`ar-SA`, `he-IL`) resolve like their bare primary subtag; nullish
 * input falls back to `'ltr'`.
 */
export function getLangDir(lang: string | null | undefined): Direction {
  if (!lang) {
    return 'ltr';
  }
  const primary = String(lang).toLowerCase().split('-')[0];
  return RTL_LANGS.has(primary) ? 'rtl' : 'ltr';
}

/**
 * Native-safe replacement for the web `applyDocumentDirection`. There is no
 * `document` element on React Native, so the resolved direction is applied
 * through `I18nManager` (the platform RTL switch) instead of `<html dir>`. The
 * resolved direction is always returned so non-RN hosts (e.g. unit tests) can
 * rely on the value even when the side effect is unavailable.
 */
export function applyDocumentDirection(
  lang: string | null | undefined,
): Direction {
  const dir = getLangDir(lang);
  const isRTL = dir === 'rtl';
  try {
    if (I18nManager && typeof I18nManager.allowRTL === 'function') {
      I18nManager.allowRTL(true);
      if (
        typeof I18nManager.forceRTL === 'function' &&
        I18nManager.isRTL !== isRTL
      ) {
        I18nManager.forceRTL(isRTL);
      }
    }
  } catch {
    // I18nManager is unavailable in this environment (e.g. a bare test host);
    // the direction is still resolved and returned without the side effect.
  }
  return dir;
}

// --- Minimal i18next-compatible surface --------------------------------------

const DEFAULT_LANGUAGE = 'en';
const FALLBACK_LANGUAGE = 'en';

type TranslationResource = Record<string, unknown>;

interface ResourceLanguage {
  translation: TranslationResource;
}

interface InitOptions {
  resources?: Record<string, ResourceLanguage>;
  lng?: string;
  fallbackLng?: string;
  interpolation?: {escapeValue?: boolean};
}

interface I18nPlugin {
  type: string;
  init?(): void;
}

type TFunctionOptions = Record<string, unknown>;

type TFunction = (
  key: string,
  defaultValueOrOptions?: string | TFunctionOptions,
  maybeOptions?: TFunctionOptions,
) => string;

type LanguageChangedListener = (lang: string) => void;

export interface NativeI18n {
  language: string;
  languages: string[];
  options: {
    lng: string;
    fallbackLng: string;
    interpolation: {escapeValue: boolean};
  };
  t: TFunction;
  use(plugin: I18nPlugin): NativeI18n;
  init(options?: InitOptions): Promise<TFunction>;
  changeLanguage(lng: string): Promise<TFunction>;
  hasResourceBundle(lng: string): boolean;
  on(event: 'languageChanged', listener: LanguageChangedListener): void;
  off(event: 'languageChanged', listener: LanguageChangedListener): void;
  dir(lng?: string): Direction;
}

/**
 * Native-safe stand-in for react-i18next's `initReactI18next` plugin. The web
 * boot threads it through `i18n.use(...)`; on native there is no React renderer
 * binding to register, so the plugin is an inert descriptor that keeps the
 * chainable `.use(...).init(...)` call shape intact (source L8).
 */
const initReactI18next: I18nPlugin = {
  type: '3rdParty',
  init() {},
};

// Registered translation resources (source L4-6 imports → native constants).
// `en` is intentionally empty: the native parity tree resolves English defaults
// via `t(key, defaultValue)` rather than bundling the large web en.json table.
const en: TranslationResource = {};
const ar: TranslationResource = {
  _meta: {language: 'ar', name: 'العربية', direction: 'rtl', status: 'placeholder'},
};
const he: TranslationResource = {
  _meta: {language: 'he', name: 'עברית', direction: 'rtl', status: 'placeholder'},
};

const registeredResources: Record<string, ResourceLanguage> = {};
const languageChangedListeners = new Set<LanguageChangedListener>();

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

/**
 * `{{ name }}` interpolation with no HTML escaping — the native expression of
 * the web `interpolation.escapeValue: false` intent (source L16). Unknown
 * placeholders are left untouched so the default string degrades gracefully.
 */
function interpolate(template: string, options?: TFunctionOptions): string {
  if (!options) {
    return template;
  }
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, name: string) => {
    const value = options[name];
    return value === undefined || value === null ? match : String(value);
  });
}

const t: TFunction = (key, defaultValueOrOptions, maybeOptions) => {
  let defaultValue = key;
  let options: TFunctionOptions | undefined;
  if (typeof defaultValueOrOptions === 'string') {
    defaultValue = defaultValueOrOptions;
    options = maybeOptions;
  } else if (defaultValueOrOptions) {
    options = defaultValueOrOptions;
    const provided = options.defaultValue;
    if (typeof provided === 'string') {
      defaultValue = provided;
    }
  }
  return interpolate(defaultValue, options);
};

function emitLanguageChanged(lang: string): void {
  languageChangedListeners.forEach(listener => listener(lang));
}

const i18n: NativeI18n = {
  language: DEFAULT_LANGUAGE,
  languages: [DEFAULT_LANGUAGE, FALLBACK_LANGUAGE],
  options: {
    lng: DEFAULT_LANGUAGE,
    fallbackLng: FALLBACK_LANGUAGE,
    interpolation: {escapeValue: false},
  },
  t,
  use() {
    return i18n;
  },
  init(options) {
    if (options?.resources) {
      Object.entries(options.resources).forEach(([lng, bundle]) => {
        registeredResources[lng] = bundle;
      });
    }
    if (options?.lng) {
      i18n.language = options.lng;
    }
    const fallback = options?.fallbackLng ?? FALLBACK_LANGUAGE;
    i18n.languages = dedupe([i18n.language, fallback]);
    i18n.options.lng = i18n.language;
    i18n.options.fallbackLng = fallback;
    if (options?.interpolation?.escapeValue !== undefined) {
      i18n.options.interpolation.escapeValue = options.interpolation.escapeValue;
    }
    return Promise.resolve(t);
  },
  changeLanguage(lng) {
    i18n.language = lng;
    i18n.languages = dedupe([lng, i18n.options.fallbackLng]);
    emitLanguageChanged(lng);
    return Promise.resolve(t);
  },
  hasResourceBundle(lng) {
    return Object.prototype.hasOwnProperty.call(registeredResources, lng);
  },
  on(_event, listener) {
    languageChangedListeners.add(listener);
  },
  off(_event, listener) {
    languageChangedListeners.delete(listener);
  },
  dir(lng) {
    return getLangDir(lng ?? i18n.language);
  },
};

// Boot: register resources + default/fallback language + no-escape interpolation
// (source L8-17), mirroring the chainable `i18n.use(...).init(...)` call.
i18n.use(initReactI18next).init({
  resources: {
    ar: {translation: ar},
    en: {translation: en},
    he: {translation: he},
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: {escapeValue: false},
});

// Keep the platform writing direction in sync with the active language. Apply
// once on boot so the first paint after init matches the resolved language,
// then again on every subsequent `i18n.changeLanguage(...)` call (source L19-26).
applyDocumentDirection(i18n.language);
i18n.on('languageChanged', lang => {
  applyDocumentDirection(lang);
});

export default i18n;
