import { useEffect, useMemo } from 'react'
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
  ai_mode: 'off',
  ai_features: {},
  ai_provider_config: {},
  ai_cost_cap_cents: 0,
}

/**
 * Clamp the backend `decimal_precision` to a value that is always safe to
 * hand to `Number.prototype.toFixed` / `Intl.NumberFormat` — both throw a
 * `RangeError` outside 0..20 or on a non-finite input. Mirrors the clamp
 * inside `setGlobalPrecision` so the value returned to consumers never
 * diverges from the one pushed into the module-level formatter globals.
 */
function sanitizePrecision(v: number | null | undefined): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 2
  return Math.max(0, Math.min(20, Math.trunc(v)))
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

  // Backend may return `locale: ''` when the column has never been
  // written. `??` does NOT catch empty strings, so any consumer that
  // does `settings.locale ?? 'en-US'` (or passes it directly to
  // `Intl.NumberFormat`) would break. Normalise once, here, so every
  // downstream consumer sees a valid BCP-47 tag. Memoised on the raw
  // query object so `s` (and everything derived from it) keeps a stable
  // reference across renders that don't change settings.
  const s: AppSettings = useMemo(() => {
    const raw = settings ?? defaults
    return raw.locale && raw.locale.trim().length > 0
      ? raw
      : { ...raw, locale: defaults.locale }
  }, [settings])

  const decimals = sanitizePrecision(s.decimal_precision)
  const locale = resolveLocale(s.locale)

  // Sync global precision/locale after render so formatters stay aligned with settings.
  useEffect(() => {
    setGlobalPrecision(decimals)
    setGlobalLocale(locale)
  }, [decimals, locale])

  // Refetch when another tab saves settings; TanStack Query dedupes overlaps.
  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type !== TOPICS.SETTINGS_CHANGED) return
      void refetch()
    })
  }, [refetch])

  return useMemo(() => {
    const density: 'compact' | 'comfortable' | 'spacious' =
      s.ui_density === 'compact' || s.ui_density === 'spacious' ? s.ui_density : 'comfortable'
    // `preferred_range` is a free-form string on the wire; validate it at
    // the boundary instead of blind-casting so an empty/unknown value
    // degrades to the 'rated' default rather than leaking an invalid union
    // member to consumers (mirrors the `density` guard above).
    const rangeType: 'rated' | 'ideal' = s.preferred_range === 'ideal' ? 'ideal' : 'rated'
    return {
      settings: s,
      isMiles: s.unit_of_length === 'mi',
      isFahrenheit: s.unit_of_temp === 'F',
      isPSI: (s.unit_of_pressure ?? 'bar') === 'psi',
      decimals,
      locale,
      density,
      rangeType,
    }
  }, [s, decimals, locale])
}
