import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSettings } from '@/api/settings'
import type { AppSettings } from '@/api/types'
import { setGlobalPrecision, setGlobalLocale } from '../lib/numberFormat'
import { resolveLocale } from '../lib/locale'
import { subscribe } from '../lib/broadcast'
import { TOPICS } from '../lib/broadcastTopics'

// Re-export per-channel notification sound preferences so callers can
// import everything settings-related from `@/hooks/useSettings`. The
// underlying storage (localStorage, not the backend `AppSettings` blob)
// lives in `@/lib/notificationSound` to keep audio playback colocated
// with the prefs that gate it.
export {
  DEFAULT_NOTIFICATION_SOUND_PREFS,
  NOTIFICATION_SOUND_CATEGORIES,
  getNotificationSoundPrefs,
  setNotificationSoundPrefs,
  useNotificationSoundPrefs,
  type NotificationSoundCategory,
  type NotificationSoundPrefs,
} from '@/lib/notificationSound'

const defaults: AppSettings = {
  unit_of_length: 'km',
  unit_of_temp: 'C',
  unit_of_pressure: 'bar',
  preferred_range: 'rated',
  language: 'en',
  base_cost_per_kwh: 0.12,
  api_suspended: false,
  theme: 'neon-cyan',
  mode: 'dark',
  custom_primary: '#00b4d8',
  custom_accent: '#e63946',
  gas_price_per_unit: 0,
  gas_unit: 'gallon',
  gas_efficiency_mpg: 25,
  decimal_precision: 2,
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  alert_digest_mode: 'instant',
  currency_symbol: '$',
  locale: 'en-US',
  tz_display_default: 'vehicle',
  timezone_user: '',
  tab_badge_enabled: true,
  critical_flash_enabled: true,
  ui_density: 'comfortable',
  time_format_default: 'relative',
  chart_palette: 'cb_safe',
}

/**
 * React hook providing application settings.
 *
 * Fetches settings from the API (cached for 5 min) and returns settings state
 * plus non-conversion settings-derived flags/labels. Measurement display
 * conversion lives in `useUnits`; currency/cost formatting lives in
 * `useFormatting`.
 */
export function useSettings() {
  const { data: settings, refetch } = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })

  const raw = settings ?? defaults
  // Backend may return `locale: ''` when the column has never been
  // written. `??` does NOT catch empty strings, so any consumer that
  // does `settings.locale ?? 'en-US'` (or passes it directly to
  // `Intl.NumberFormat`) would break. Normalise once, here, so every
  // downstream consumer sees a valid BCP-47 tag.
  const s: AppSettings = raw.locale && raw.locale.trim().length > 0
    ? raw
    : { ...raw, locale: defaults.locale }
  const decimals = s.decimal_precision ?? 2
  const locale = resolveLocale(s.locale)
  const density: 'compact' | 'comfortable' | 'spacious' =
    s.ui_density === 'compact' || s.ui_density === 'spacious' ? s.ui_density : 'comfortable'

  // Sync global precision/locale so fmtNumber/fmtPercent/etc. use them
  // automatically. Phase-45/06: moved into useEffect so the side effect
  // runs in commit phase (not during render) — this avoids
  // double-application under React.StrictMode and makes the contract
  // consistent with <FormatterPrefsBridge /> at the app root.
  useEffect(() => {
    setGlobalPrecision(decimals)
    setGlobalLocale(locale)
  }, [decimals, locale])

  // Phase-45/06: listen for cross-tab `settings.changed` broadcasts so
  // even if this tab's `['settings']` query was never fetched (e.g. the
  // bridge tore down for some reason), we still refetch on a peer's
  // mutation. Coexists harmlessly with <FormatterPrefsBridge /> which
  // does the same — TanStack Query dedupes concurrent invalidations.
  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type !== TOPICS.SETTINGS_CHANGED) return
      void refetch()
    })
  }, [refetch])

  const isMiles = s.unit_of_length === 'mi'
  const isFahrenheit = s.unit_of_temp === 'F'
  const isPSI = (s.unit_of_pressure ?? 'bar') === 'psi'

  const rangeType = s.preferred_range as 'rated' | 'ideal'

  return {
    settings: s,
    isMiles,
    isFahrenheit,
    isPSI,
    decimals,
    locale,
    density,
    rangeType,
  }
}
