import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppSettings } from '@/api/types'
import {
  useSettings, useSaveSettings, useVehicles, useCarPreferences,
} from '@/api/hooks/useSettings'
import { GlassPanel, Button, IconBox, Input, Select } from '@/components/ui'
import { Skeleton, DraftRecoveryBanner } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import { useToast } from '@/components/feedback/Toast'
import { useFormDraft } from '@/hooks/useFormDraft'
import { parseSettingEnum, isSettingMiles, isSettingFahrenheit, isSettingPSI, isSettingBar } from '@/lib/parseSettingEnum'
import { SettingField } from './SettingField'
import {
  Settings as SettingsIcon, Save, Download, Car, CheckCircle, Clock,
} from 'lucide-react'

const DEFAULT_FORM: AppSettings = {
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
  gas_price_per_unit: 3.50,
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
}

export function GeneralSettings() {
  const { t } = useTranslation('settings')
  const toast = useToast()
  const { data: settings, isLoading } = useSettings()
  const settingsMut = useSaveSettings()

  // Persist form drafts to localStorage so a long edit session survives a tab
  // close, an SW reload, or an auth redirect. The optional google_maps_api_key
  // field is a client-side public-tier integration key (comparable to the theme
  // setting) — not a server credential. If a true secret is ever added to this
  // form, switch that field to a separate non-persisted useState.
  const {
    value: form,
    setValue: setForm,
    hasDraft,
    draftSavedAt,
    discardDraft,
  } = useFormDraft<AppSettings>('settings:general', DEFAULT_FORM, {
    version: 1,
    debounceMs: 800,
    maxAgeMs: 24 * 60 * 60 * 1000,
    skipPersist: (value) => {
      if (settingsMut.isPending) return true
      if (!settings) return true
      // Never persist the unmodified server snapshot as a "draft".
      try {
        return JSON.stringify(value) === JSON.stringify(settings)
      } catch {
        return false
      }
    },
  })
  const [saved, setSaved] = useState(false)

  const [formInited, setFormInited] = useState(false)
  if (settings && !formInited) {
    // Only hydrate from the server snapshot if no draft was restored — otherwise
    // we'd clobber the user's in-progress edits.
    if (!hasDraft) {
      setForm(settings)
    }
    setFormInited(true)
  }

  // Sync from Car
  const { data: vehicles } = useVehicles()
  const firstVehicleId = vehicles?.[0]?.id ?? null
  const { data: carPrefs } = useCarPreferences(firstVehicleId)

  function syncUnitsFromCar() {
    if (!carPrefs) return
    const updates: Partial<AppSettings> = {}

    if (isSettingMiles(carPrefs.setting_distance_unit)) updates.unit_of_length = 'mi'
    else if (carPrefs.setting_distance_unit) updates.unit_of_length = 'km'

    if (isSettingFahrenheit(carPrefs.setting_temperature_unit)) updates.unit_of_temp = 'F'
    else if (carPrefs.setting_temperature_unit) updates.unit_of_temp = 'C'

    if (isSettingPSI(carPrefs.setting_tire_pressure_unit)) updates.unit_of_pressure = 'psi'
    else if (isSettingBar(carPrefs.setting_tire_pressure_unit)) updates.unit_of_pressure = 'bar'

    if (Object.keys(updates).length > 0) {
      const newForm = { ...form, ...updates }
      setForm(newForm)
      settingsMut.mutate(newForm)
      toast.success(
        t('toast.unitsSynced', 'Units synced from car'),
        `${t('distance', 'Distance')}: ${updates.unit_of_length === 'mi' ? t('miles', 'Miles') : t('kilometers', 'Kilometers')}, ${t('temperature', 'Temperature')}: ${updates.unit_of_temp === 'F' ? t('fahrenheit', 'Fahrenheit') : t('celsius', 'Celsius')}, ${t('pressure', 'Pressure')}: ${updates.unit_of_pressure === 'psi' ? 'PSI' : 'Bar'}`,
      )
    } else {
      toast.info(t('toast.noChanges', 'No changes'), t('toast.noChangesDesc', 'Could not detect car unit preferences'))
    }
  }

  return (
    <FadeIn delay={0.1}>
      <GlassPanel className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <IconBox color="cyan">
            <SettingsIcon className="h-5 w-5" />
          </IconBox>
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('app.title', 'Application')}</h2>
            <p className="text-xs text-[var(--text-muted)]">{t('app.subtitle', 'Units, language, and cost preferences')}</p>
          </div>
        </div>

        <DraftRecoveryBanner
          hasDraft={hasDraft}
          draftSavedAt={draftSavedAt}
          onDiscard={() => {
            discardDraft()
            if (settings) setForm(settings)
          }}
          itemNoun={t('draft.noun.settings', 'Settings')}
        />

        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : (
          <>
            {carPrefs && (carPrefs.setting_distance_unit || carPrefs.setting_temperature_unit) && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-neon-cyan/20 bg-neon-cyan/5 p-4 mb-5">
                <div className="flex items-center gap-3">
                  <Car className="h-5 w-5 text-neon-cyan shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                      {t('app.carUses', 'Car uses')} {parseSettingEnum(carPrefs.setting_distance_unit, 'distance')} / {parseSettingEnum(carPrefs.setting_temperature_unit, 'temperature')} / {parseSettingEnum(carPrefs.setting_tire_pressure_unit, 'pressure')}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {t('app.syncHint', "Sync your app's units to match your vehicle's display settings")}
                    </p>
                  </div>
                </div>
                <Button variant="primary" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={syncUnitsFromCar} className="shrink-0">
                  {t('app.syncFromCar', 'Sync from Car')}
                </Button>
              </div>
            )}

            {carPrefs && carPrefs.setting_24hr_time != null && (
              <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 mb-5">
                <Clock className="h-4 w-4 text-neon-amber shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[var(--text-primary)]">
                    {t('app.carClockFormat', 'Car clock format')}:{' '}
                    <span className="font-medium">
                      {carPrefs.setting_24hr_time
                        ? t('app.clock24h', '24-hour')
                        : t('app.clock12h', '12-hour')}
                    </span>
                  </p>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {t('app.clockFormatHint', "Your vehicle's time display preference (read-only)")}
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Select
                label={t('app.distanceUnit', 'Distance Unit')}
                value={form.unit_of_length}
                onChange={e => setForm({ ...form, unit_of_length: e.target.value })}
                options={[{ value: 'km', label: t('app.kilometers', 'Kilometers') }, { value: 'mi', label: t('app.miles', 'Miles') }]}
              />
              <Select
                label={t('app.temperatureUnit', 'Temperature Unit')}
                value={form.unit_of_temp}
                onChange={e => setForm({ ...form, unit_of_temp: e.target.value })}
                options={[{ value: 'C', label: t('app.celsius', 'Celsius') }, { value: 'F', label: t('app.fahrenheit', 'Fahrenheit') }]}
              />
              <Select
                label={t('app.pressureUnit', 'Pressure Unit')}
                value={form.unit_of_pressure ?? 'bar'}
                onChange={e => setForm({ ...form, unit_of_pressure: e.target.value })}
                options={[{ value: 'bar', label: t('app.bar', 'Bar') }, { value: 'psi', label: t('app.psi', 'PSI') }]}
              />
              <Select
                label={t('app.preferredRange', 'Preferred Range')}
                value={form.preferred_range}
                onChange={e => setForm({ ...form, preferred_range: e.target.value })}
                options={[{ value: 'rated', label: t('app.rated', 'Rated') }, { value: 'ideal', label: t('app.ideal', 'Ideal') }]}
              />

              <div>
                <Input
                  label={t('app.decimalPrecision', 'Decimal Precision')}
                  type="number"
                  min={0}
                  max={20}
                  value={String(form.decimal_precision)}
                  onChange={e => setForm({ ...form, decimal_precision: Math.max(0, Math.min(20, Number(e.target.value) || 0)) })}
                  placeholder="e.g. 2"
                />
                <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                  {t('app.preview', 'Preview')}: {(14.248539).toFixed(form.decimal_precision)}
                </p>
              </div>

              <Select
                label={t('app.language', 'Language')}
                value={form.language}
                onChange={e => setForm({ ...form, language: e.target.value })}
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'de', label: 'Deutsch' },
                  { value: 'fr', label: 'Français' },
                  { value: 'es', label: 'Español' },
                  { value: 'zh', label: '中文' },
                ]}
              />

              <Select
                label={t('app.currency', 'Currency')}
                value={form.currency_symbol ?? '$'}
                onChange={e => setForm({ ...form, currency_symbol: e.target.value })}
                options={[
                  { value: '$', label: 'USD ($)' },
                  { value: '€', label: 'EUR (€)' },
                  { value: '£', label: 'GBP (£)' },
                  { value: 'C$', label: 'CAD (C$)' },
                  { value: 'A$', label: 'AUD (A$)' },
                  { value: '¥', label: 'JPY (¥)' },
                  { value: '元', label: 'CNY (元)' },
                  { value: 'CHF', label: 'CHF (CHF)' },
                  { value: 'kr', label: 'SEK / NOK / DKK (kr)' },
                  { value: '₹', label: 'INR (₹)' },
                ]}
              />

              <Select
                label={t('app.locale', 'Number & Date Locale')}
                value={form.locale ?? 'en-US'}
                onChange={e => setForm({ ...form, locale: e.target.value })}
                options={[
                  { value: 'en-US', label: 'English (US) — 1,234.56' },
                  { value: 'en-GB', label: 'English (UK) — 1,234.56' },
                  { value: 'de-DE', label: 'Deutsch (DE) — 1.234,56' },
                  { value: 'fr-FR', label: 'Français (FR) — 1 234,56' },
                  { value: 'es-ES', label: 'Español (ES) — 1.234,56' },
                  { value: 'ja-JP', label: '日本語 (JP) — 1,234.56' },
                  { value: 'zh-CN', label: '简体中文 (CN) — 1,234.56' },
                ]}
              />

              <Select
                label={t('app.tzDisplayDefault', 'Time Zone Display')}
                value={form.tz_display_default ?? 'vehicle'}
                onChange={e => setForm({ ...form, tz_display_default: e.target.value as 'vehicle' | 'user' | 'utc' })}
                options={[
                  { value: 'vehicle', label: t('app.tzVehicle', "Vehicle's local time (recommended)") },
                  { value: 'user', label: t('app.tzUser', 'My local time') },
                  { value: 'utc', label: t('app.tzUtc', 'UTC') },
                ]}
              />

              <SettingField label={t('app.timezoneUser', 'My Time Zone Override')}>
                <Input
                  type="text"
                  value={form.timezone_user ?? ''}
                  onChange={e => setForm({ ...form, timezone_user: e.target.value })}
                  placeholder={t('app.timezoneUserPlaceholder', 'e.g. America/Los_Angeles (leave blank for browser default)')}
                  className="w-full px-3 py-2.5 text-sm"
                />
                <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                  {t('app.timezoneUserHint', "IANA tz name. Useful when travelling but you'd rather see times in your home zone.")}
                </p>
              </SettingField>

              <SettingField label={t('app.electricityCost', 'Electricity Cost (per kWh)')}>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] text-sm">
                    {form.currency_symbol ?? '$'}
                  </span>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.base_cost_per_kwh}
                    onChange={e => setForm({ ...form, base_cost_per_kwh: parseFloat(e.target.value) || 0 })}
                    className="w-full pl-7 pr-3 py-2.5 text-sm"
                  />
                </div>
              </SettingField>

              <SettingField label={t('app.gasPrice', 'Gas Price (for EV vs ICE comparison)')}>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] text-sm">
                      {form.currency_symbol ?? '$'}
                    </span>
                    <Input
                      type="number"
                      step="0.01"
                      value={form.gas_price_per_unit}
                      onChange={e => setForm({ ...form, gas_price_per_unit: parseFloat(e.target.value) || 0 })}
                      className="w-full pl-7 pr-3 py-2.5 text-sm"
                    />
                  </div>
                  <Select
                    value={form.gas_unit}
                    onChange={e => setForm({ ...form, gas_unit: e.target.value })}
                    options={[{ value: 'gallon', label: t('app.perGallon', '/ gallon') }, { value: 'liter', label: t('app.perLiter', '/ liter') }]}
                    className="w-28"
                  />
                </div>
              </SettingField>

              <SettingField label={t('app.comparisonMPG', 'Comparison Vehicle MPG')}>
                <Input
                  type="number"
                  step="0.5"
                  value={form.gas_efficiency_mpg}
                  onChange={e => setForm({ ...form, gas_efficiency_mpg: parseFloat(e.target.value) || 0 })}
                  className="w-full px-3 py-2.5 text-sm"
                  placeholder={t('app.mpgPlaceholder', 'Average MPG of equivalent gas car')}
                />
              </SettingField>

              <SettingField label={t('app.googleMapsApiKey', 'Google Maps API Key')}>
                <Input
                  type="password"
                  value={form.google_maps_api_key || ''}
                  onChange={e => setForm({ ...form, google_maps_api_key: e.target.value })}
                  className="w-full px-3 py-2.5 text-sm"
                  placeholder={t('app.googleMapsPlaceholder', 'Enter your Google Maps API key')}
                />
                <p className="text-[10px] text-[var(--text-muted)] mt-1">
                  {t('app.googleMapsHint', 'Optional — enables satellite views, Places autocomplete, and enhanced geocoding.')}{' '}
                  {t('app.getKeyAt', 'Get a key at')}{' '}
                  <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" className="text-cyan-300 hover:underline">console.cloud.google.com</a>
                </p>
              </SettingField>
            </div>
          </>
        )}

        <div className="flex items-center gap-4">
          <Button variant="primary" icon={<Save className="h-4 w-4" />} onClick={() => settingsMut.mutate(form, {
            onSuccess: () => { toast.success(t('toast.saved', 'Settings saved'), t('toast.savedDesc', 'Your preferences have been updated')); setSaved(true); setTimeout(() => setSaved(false), 3000) },
            onError: () => toast.error(t('toast.saveFailed', 'Failed to save'), t('toast.saveFailedDesc', 'Could not update settings')),
          })} loading={settingsMut.isPending}>
            {t('app.save', 'Save Settings')}
          </Button>
          {saved && (
            <span className="text-sm text-emerald-300 flex items-center gap-1 animate-in fade-in">
              <CheckCircle className="h-4 w-4" /> {t('app.settingsSaved', 'Settings saved')}
            </span>
          )}
        </div>
      </GlassPanel>
    </FadeIn>
  )
}
