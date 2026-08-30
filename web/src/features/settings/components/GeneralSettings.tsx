import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppSettings } from '@/api/types'
import {
  useSettings, useSaveSettings, useVehicles, useCarPreferences,
} from '@/api/hooks/useSettings'
import { GlassPanel, Button, IconBox, Input, Select, Heading, Text, HelperText } from '@/components/ui'
import { CurrencyInput } from '@/components/forms'
import { Skeleton, DraftRecoveryBanner } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import { useToast } from '@/components/feedback/Toast'
import { useFormDraft } from '@/hooks/useFormDraft'
import { useNavigationGuard } from '@/hooks/useNavigationGuard'
import { parseSettingEnum, isSettingMiles, isSettingFahrenheit, isSettingPSI, isSettingBar } from '@/lib/parseSettingEnum'
import { microToValue, valueToMicro } from '@/lib/currencyFormat'
import { SettingField } from './SettingField'
import {
  Settings as SettingsIcon, Save, Download, Car, CheckCircle, Clock,
} from 'lucide-react'

// Map the user's stored currency_symbol glyph to an ISO 4217 code so
// CurrencyInput can use Intl.NumberFormat with style:'currency'. The
// glyphs come from the dropdown above (line ~260) — keep the two in sync.
const CURRENCY_SYMBOL_TO_ISO: Record<string, string> = {
  '$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
  'C$': 'CAD',
  'A$': 'AUD',
  '¥': 'JPY',
  '元': 'CNY',
  'CHF': 'CHF',
  'kr': 'SEK',
  '₹': 'INR',
}

function symbolToIsoCode(symbol: string | undefined): string {
  return CURRENCY_SYMBOL_TO_ISO[(symbol ?? '$').trim()] ?? 'USD'
}

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

// Clamp a user- or server-supplied decimal precision into the [0, 20] range
// the UI actually offers. `Number.prototype.toFixed` throws a RangeError for
// any argument outside [0, 100], so an out-of-range value persisted in a
// restored draft or returned by the API would otherwise crash the entire
// panel the moment the live preview rendered. Non-finite input falls back to
// the default precision rather than NaN.
function clampDecimals(precision: number | null | undefined): number {
  const n = Number(precision)
  if (!Number.isFinite(n)) return DEFAULT_FORM.decimal_precision
  return Math.max(0, Math.min(20, Math.trunc(n)))
}

export function GeneralSettings() {
  const { t } = useTranslation('settings')
  const toast = useToast()
  const { data: settings, isLoading } = useSettings()
  const settingsMut = useSaveSettings()

  // Persist form drafts to localStorage so a long edit session survives a tab
  // close, an SW reload, or an auth redirect. None of the persisted fields are
  // server credentials — keep it that way; if a true secret is ever added to
  // this form, switch that field to a separate non-persisted useState.
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

  // In-app navigation guard. The settings form has no explicit isDirty flag,
  // so diff the in-progress draft against the persisted server snapshot. This
  // surfaces a discard dialog for sidebar clicks or browser back while the user
  // has unapplied changes. Falls back to "no diff possible" until settings load.
  const isDirty = useMemo(() => {
    if (!settings) return false
    if (settingsMut.isPending) return false
    try {
      return JSON.stringify(form) !== JSON.stringify(settings)
    } catch {
      return false
    }
  }, [form, settings, settingsMut.isPending])
  useNavigationGuard(isDirty, t('forms.unsavedSettings', 'You have unsaved settings.'))

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
      <GlassPanel className="p-6 space-y-6" data-tour="settings-units">
        <div className="flex items-center gap-3">
          <IconBox color="cyan">
            <SettingsIcon className="h-5 w-5" />
          </IconBox>
          <div>
            <Heading level="panel">{t('app.title', 'Application')}</Heading>
            <HelperText>{t('app.subtitle', 'Units, language, and cost preferences')}</HelperText>
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
                    <Text as="p" variant="body" className="font-medium">
                      {t('app.carUses', 'Car uses')} {parseSettingEnum(carPrefs.setting_distance_unit, 'distance')} / {parseSettingEnum(carPrefs.setting_temperature_unit, 'temperature')} / {parseSettingEnum(carPrefs.setting_tire_pressure_unit, 'pressure')}
                    </Text>
                    <HelperText>
                      {t('app.syncHint', "Sync your app's units to match your vehicle's display settings")}
                    </HelperText>
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
                  <Text as="p" variant="body">
                    {t('app.carClockFormat', 'Car clock format')}:{' '}
                    <Text weight="medium">
                      {carPrefs.setting_24hr_time
                        ? t('app.clock24h', '24-hour')
                        : t('app.clock12h', '12-hour')}
                    </Text>
                  </Text>
                  <HelperText>
                    {t('app.clockFormatHint', "Your vehicle's time display preference (read-only)")}
                  </HelperText>
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
                  value={String(form.decimal_precision ?? DEFAULT_FORM.decimal_precision)}
                  onChange={e => setForm({ ...form, decimal_precision: Math.max(0, Math.min(20, Number(e.target.value) || 0)) })}
                  placeholder={t('app.decimalPrecisionPlaceholder', 'e.g. 2')}
                />
                <HelperText className="mt-1">
                  {t('app.preview', 'Preview')}: {(14.248539).toFixed(clampDecimals(form.decimal_precision))}
                </HelperText>
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
                <HelperText className="mt-1">
                  {t('app.timezoneUserHint', "IANA tz name. Useful when travelling but you'd rather see times in your home zone.")}
                </HelperText>
              </SettingField>

              <SettingField
                label={t('app.electricityCost', 'Electricity Cost (per kWh)')}
                help={{
                  i18nKey: 'help.fields.settings.electricityCost',
                  content: 'Cost per kWh used to compute charging spend across drives, charging sessions, and TCO analytics. Currency follows the Currency setting above.',
                  for: 'electricity-cost',
                }}
              >
                <CurrencyInput
                  ariaLabel={t('app.electricityCost', 'Electricity Cost (per kWh)')}
                  currency={symbolToIsoCode(form.currency_symbol)}
                  locale={form.locale ?? 'en-US'}
                  precision={clampDecimals(form.decimal_precision)}
                  valueMicro={valueToMicro(form.base_cost_per_kwh)}
                  onChange={({ valueMicro }) =>
                    setForm({ ...form, base_cost_per_kwh: microToValue(valueMicro) ?? 0 })
                  }
                />
              </SettingField>

              <SettingField label={t('app.gasPrice', 'Gas Price (for EV vs ICE comparison)')}>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <CurrencyInput
                      ariaLabel={t('app.gasPrice', 'Gas Price (for EV vs ICE comparison)')}
                      currency={symbolToIsoCode(form.currency_symbol)}
                      locale={form.locale ?? 'en-US'}
                      precision={clampDecimals(form.decimal_precision)}
                      valueMicro={valueToMicro(form.gas_price_per_unit)}
                      onChange={({ valueMicro }) =>
                        setForm({ ...form, gas_price_per_unit: microToValue(valueMicro) ?? 0 })
                      }
                    />
                  </div>
                  <Select
                    aria-label={t('app.gasVolumeUnit', 'Fuel volume unit')}
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
                  value={form.gas_efficiency_mpg ?? ''}
                  onChange={e => setForm({ ...form, gas_efficiency_mpg: parseFloat(e.target.value) || 0 })}
                  className="w-full px-3 py-2.5 text-sm"
                  placeholder={t('app.mpgPlaceholder', 'Average MPG of equivalent gas car')}
                />
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
            <Text size="sm" className="flex items-center gap-1 text-emerald-300 animate-in fade-in">
              <CheckCircle className="h-4 w-4" /> {t('app.settingsSaved', 'Settings saved')}
            </Text>
          )}
        </div>
      </GlassPanel>
    </FadeIn>
  )
}
