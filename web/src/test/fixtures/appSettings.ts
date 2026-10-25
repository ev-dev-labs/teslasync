import type { AppSettings } from '@/api/types'

export type AiMode = 'off' | 'local' | 'cloud'

export const DEFAULT_APP_SETTINGS: AppSettings = {
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

export const defaultAppSettings = DEFAULT_APP_SETTINGS

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function mergeFixturePayload<T extends Record<string, unknown>>(
  base: T,
  overrides?: Partial<T> | null,
): T {
  if (!overrides) return { ...base }

  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(overrides)) {
    const existing = merged[key]
    if (isPlainObject(existing) && isPlainObject(value)) {
      merged[key] = mergeFixturePayload(existing, value)
    } else {
      merged[key] = value
    }
  }
  return merged as T
}

export function normalizeAiMode(value: unknown): AiMode {
  return value === 'local' || value === 'cloud' || value === 'off'
    ? value
    : 'off'
}

export function normalizeAiFeatures(value: unknown): Record<string, boolean> {
  if (!isPlainObject(value)) return {}
  const normalized: Record<string, boolean> = {}
  for (const [featureId, enabled] of Object.entries(value)) {
    if (typeof enabled === 'boolean') normalized[featureId] = enabled
  }
  return normalized
}

export function normalizeAppSettings(value: unknown): AppSettings {
  if (!isPlainObject(value)) return createAppSettings()

  const input = value as Partial<AppSettings>
  const decimalPrecision = typeof input.decimal_precision === 'number'
    && Number.isFinite(input.decimal_precision)
    ? Math.max(0, Math.min(20, Math.trunc(input.decimal_precision)))
    : DEFAULT_APP_SETTINGS.decimal_precision
  const locale = typeof input.locale === 'string' && input.locale.trim().length > 0
    ? input.locale
    : DEFAULT_APP_SETTINGS.locale
  const timezoneUser = typeof input.timezone_user === 'string'
    ? input.timezone_user
    : DEFAULT_APP_SETTINGS.timezone_user
  const uiDensity = input.ui_density === 'compact'
    || input.ui_density === 'spacious'
    ? input.ui_density
    : 'comfortable'
  const tzDisplayDefault = input.tz_display_default === 'user'
    || input.tz_display_default === 'utc'
    ? input.tz_display_default
    : 'vehicle'

  return createAppSettings({
    ...input,
    decimal_precision: decimalPrecision,
    locale,
    timezone_user: timezoneUser,
    ui_density: uiDensity,
    tz_display_default: tzDisplayDefault,
    ai_mode: normalizeAiMode(input.ai_mode),
    ai_features: normalizeAiFeatures(input.ai_features),
  })
}

export function createAppSettings(overrides?: Partial<AppSettings> | null): AppSettings {
  const merged = mergeFixturePayload(
    DEFAULT_APP_SETTINGS as unknown as Record<string, unknown>,
    overrides as Partial<Record<string, unknown>> | null,
  ) as unknown as AppSettings

  return {
    ...merged,
    ai_features: normalizeAiFeatures(merged.ai_features),
    ai_mode: normalizeAiMode(merged.ai_mode),
  }
}

export function appSettingsPayload(
  overrides?: Partial<AppSettings> | null,
): { settings: AppSettings } {
  return { settings: createAppSettings(overrides) }
}

export const settingsPayload = appSettingsPayload
