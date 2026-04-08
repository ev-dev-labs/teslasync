import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSettings, updateSettings, getAuthURL, getAuthStatus, refreshAuth, disconnectAuth, syncVehicles, getGasPriceStatus, pollGasPrice, toggleGasPrice, updateGasPriceConfig, getVehicles, getUserPreferenceLatest, AppSettings } from '../api'
import { useState, useEffect } from 'react'
import { Settings as SettingsIcon, Save, ExternalLink, RefreshCw, Car, Shield, CheckCircle, XCircle, Palette, Download, Sun, Moon, Monitor, Sparkles, Pause, Play, Fuel, Zap } from 'lucide-react'
import { PageHeader, GlassPanel, FadeIn, Skeleton } from '../components/ui'
import { motion, AnimatePresence } from 'framer-motion'
import { useTheme, type ThemeId, type ModeId } from '../components/ThemeProvider'
import { useToast } from '../components/Toast'
import clsx from 'clsx'
import { formatDateTime } from '../lib/dateFormat'

const modeIcons: Record<string, React.ReactNode> = {
  dark: <Moon className="h-4 w-4" />,
  light: <Sun className="h-4 w-4" />,
  oled: <Monitor className="h-4 w-4" />,
  midnight: <Sparkles className="h-4 w-4" />,
  auto: <Monitor className="h-4 w-4" />,
  sunset: <Sun className="h-4 w-4" />,
  nord: <Sparkles className="h-4 w-4" />,
}

function SettingField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-[var(--text-muted)] mb-1.5 font-medium uppercase tracking-wider">{label}</label>
      {children}
    </div>
  )
}

export default function Settings() {
  const queryClient = useQueryClient()
  const { data: settings, isLoading } = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const { data: auth } = useQuery({ queryKey: ['auth-status'], queryFn: getAuthStatus })
  const { data: gasPriceStatus, refetch: refetchGasPrice } = useQuery({ queryKey: ['gas-price-status'], queryFn: getGasPriceStatus, retry: false, refetchInterval: 30_000 })
  const { themeId, modeId, setTheme, setMode, setCustomColors, themes: allThemes, modes: allModes } = useTheme()
  const toast = useToast()

  const [form, setForm] = useState<AppSettings>({
    unit_of_length: 'km',
    unit_of_temp: 'C',
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
  })
  const [saved, setSaved] = useState(false)
  const [customPrimary, setCustomPrimary] = useState(() => localStorage.getItem('teslasync-custom-primary') || '#00b4d8')
  const [customAccent, setCustomAccent] = useState(() => localStorage.getItem('teslasync-custom-accent') || '#e63946')

  useEffect(() => {
    if (settings) setForm(settings)
  }, [settings])

  const settingsMut = useMutation({
    mutationFn: (data: AppSettings) => updateSettings(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      toast.success('Settings saved', 'Your preferences have been updated')
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
    onError: () => {
      toast.error('Failed to save', 'Could not update settings')
    },
  })

  const authUrlMut = useMutation({
    mutationFn: getAuthURL,
    onError: (err: Error) => {
      toast.error('Authentication failed', err.message || 'Could not generate login URL')
    },
  })
  const refreshMut = useMutation({
    mutationFn: refreshAuth,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth-status'] })
      toast.success('Token refreshed')
    },
    onError: (err: Error) => {
      toast.error('Token refresh failed', err.message || 'Could not refresh authentication token')
    },
  })
  const disconnectMut = useMutation({
    mutationFn: disconnectAuth,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth-status'] })
      toast.success('Tesla account disconnected')
    },
    onError: (err: Error) => {
      toast.error('Disconnect failed', err.message || 'Could not disconnect')
    },
  })
  const syncMut = useMutation({
    mutationFn: syncVehicles,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
    },
    onError: (err: Error) => {
      toast.error('Vehicle sync failed', err.message || 'Could not sync vehicles from Tesla')
    },
  })

  // Vehicle user preferences for "Sync from Car" feature
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const firstVehicleId = vehicles?.[0]?.id ?? null
  const { data: carPrefs } = useQuery({
    queryKey: ['car-prefs', firstVehicleId],
    queryFn: () => getUserPreferenceLatest(firstVehicleId!),
    enabled: firstVehicleId !== null,
  })

  function syncUnitsFromCar() {
    if (!carPrefs) return
    const updates: Partial<AppSettings> = {}

    // Map car's SettingDistanceUnit to app's unit_of_length
    const dist = carPrefs.setting_distance_unit?.toLowerCase() ?? ''
    if (dist.includes('mile')) updates.unit_of_length = 'mi'
    else if (dist.includes('km') || dist.includes('kilo')) updates.unit_of_length = 'km'

    // Map car's SettingTemperatureUnit to app's unit_of_temp
    const temp = carPrefs.setting_temperature_unit?.toLowerCase() ?? ''
    if (temp.includes('fahr') || temp === 'f') updates.unit_of_temp = 'F'
    else if (temp.includes('cel') || temp === 'c') updates.unit_of_temp = 'C'

    if (Object.keys(updates).length > 0) {
      const newForm = { ...form, ...updates }
      setForm(newForm)
      settingsMut.mutate(newForm)
      toast.success('Units synced from car', `Distance: ${updates.unit_of_length === 'mi' ? 'Miles' : 'Kilometers'}, Temperature: ${updates.unit_of_temp === 'F' ? 'Fahrenheit' : 'Celsius'}`)
    } else {
      toast.info('No changes', 'Could not detect car unit preferences')
    }
  }

  function handleLogin() {
    authUrlMut.mutate(undefined, {
      onSuccess: (data) => {
        window.location.href = data.auth_url
      },
    })
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <PageHeader title="Settings" subtitle="Configure TeslaSync preferences and Tesla account connection" />

      {/* Tesla Account */}
      <FadeIn>
        <GlassPanel className="p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neon-blue/10 text-neon-blue ring-1 ring-neon-blue/20">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">Tesla Account</h2>
              <p className="text-xs text-[var(--text-muted)]">Connect your Tesla account to sync vehicles and data</p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/5">
            {auth?.authenticated ? (
              <>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neon-green/10">
                  <CheckCircle className="h-4 w-4 text-neon-green" />
                </div>
                <div>
                  <p className="text-sm font-medium text-neon-green">Connected</p>
                  {auth.expires_at && (
                    <p className="text-[11px] text-[var(--text-muted)]">
                      Token expires {formatDateTime(auth.expires_at)}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neon-red/10">
                  <XCircle className="h-4 w-4 text-neon-red" />
                </div>
                <p className="text-sm text-neon-red font-medium">Not connected</p>
              </>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            {!auth?.authenticated ? (
              <button
                onClick={handleLogin}
                disabled={authUrlMut.isPending}
                className="neon-button flex items-center gap-2 px-5 py-2.5 text-sm font-medium disabled:opacity-40"
              >
                <ExternalLink className="h-4 w-4" />
                {authUrlMut.isPending ? 'Loading...' : 'Connect Tesla Account'}
              </button>
            ) : (
              <>
                <button
                  onClick={() => refreshMut.mutate()}
                  disabled={refreshMut.isPending}
                  className="flex items-center gap-2 rounded-lg border border-[var(--glass-border)] px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5 transition-colors disabled:opacity-40"
                >
                  <RefreshCw className={clsx('h-4 w-4', refreshMut.isPending && 'animate-spin')} />
                  Refresh Token
                </button>
                <button
                  onClick={() => syncMut.mutate()}
                  disabled={syncMut.isPending}
                  className="flex items-center gap-2 rounded-lg border border-[var(--glass-border)] px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5 transition-colors disabled:opacity-40"
                >
                  <Car className={clsx('h-4 w-4', syncMut.isPending && 'animate-spin')} />
                  Sync Vehicles
                </button>
                <button
                  onClick={handleLogin}
                  disabled={authUrlMut.isPending}
                  className="flex items-center gap-2 rounded-lg border border-neon-cyan/30 px-4 py-2.5 text-sm text-neon-cyan hover:bg-neon-cyan/5 transition-colors disabled:opacity-40"
                >
                  <ExternalLink className="h-4 w-4" />
                  Re-authorize
                </button>
                <button
                  onClick={() => { if (confirm('Disconnect your Tesla account? You will need to re-authorize to use TeslaSync.')) disconnectMut.mutate() }}
                  disabled={disconnectMut.isPending}
                  className="flex items-center gap-2 rounded-lg border border-neon-red/30 px-4 py-2.5 text-sm text-neon-red hover:bg-neon-red/5 transition-colors disabled:opacity-40"
                >
                  <XCircle className="h-4 w-4" />
                  Disconnect
                </button>
              </>
            )}
          </div>

          <AnimatePresence>
            {syncMut.isSuccess && (
              <motion.p
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-sm text-neon-green"
              >
                Synced {syncMut.data.synced} vehicle(s).
              </motion.p>
            )}
          </AnimatePresence>
        </GlassPanel>
      </FadeIn>

      {/* Fleet API Settings — link to dedicated page */}
      <FadeIn delay={0.05}>
        <a href="/fleet-api" className="block">
          <GlassPanel className="p-5 flex items-center gap-4 hover:border-white/10 transition-colors cursor-pointer group">
            <div className={clsx(
              'flex h-10 w-10 items-center justify-center rounded-xl ring-1',
              settings?.api_suspended
                ? 'bg-neon-red/10 text-neon-red ring-neon-red/20'
                : 'bg-neon-green/10 text-neon-green ring-neon-green/20'
            )}>
              <Zap className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">Fleet API Settings</h2>
              <p className="text-xs text-[var(--text-muted)]">
                {settings?.api_suspended ? 'API polling is suspended' : 'Manage polling, endpoint toggles, and telemetry capture'}
              </p>
            </div>
            <ExternalLink className="h-4 w-4 text-[var(--text-muted)] group-hover:text-neon-cyan transition-colors shrink-0" />
          </GlassPanel>
        </a>
      </FadeIn>

      {/* Application Settings */}
      <FadeIn delay={0.1}>
        <GlassPanel className="p-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neon-cyan/10 text-neon-cyan ring-1 ring-neon-cyan/20">
              <SettingsIcon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">Application</h2>
              <p className="text-xs text-[var(--text-muted)]">Units, language, and cost preferences</p>
            </div>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : (
            <>
            {/* Sync from Car banner */}
            {carPrefs && (carPrefs.setting_distance_unit || carPrefs.setting_temperature_unit) && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-neon-cyan/20 bg-neon-cyan/5 p-4 mb-5">
                <div className="flex items-center gap-3">
                  <Car className="h-5 w-5 text-neon-cyan shrink-0" />
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      Car uses {carPrefs.setting_distance_unit ?? '—'} / {carPrefs.setting_temperature_unit ?? '—'} / {carPrefs.setting_tire_pressure_unit ?? '—'}
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      Sync your app's units to match your vehicle's display settings
                    </p>
                  </div>
                </div>
                <button
                  onClick={syncUnitsFromCar}
                  className="neon-button flex items-center gap-1.5 text-xs shrink-0 px-3 py-2"
                >
                  <Download className="h-3.5 w-3.5" />
                  Sync from Car
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <SettingField label="Distance Unit">
                <select
                  value={form.unit_of_length}
                  onChange={e => setForm({ ...form, unit_of_length: e.target.value })}
                  className="glass-input w-full px-3 py-2.5 text-sm"
                >
                  <option value="km">Kilometers</option>
                  <option value="mi">Miles</option>
                </select>
              </SettingField>

              <SettingField label="Temperature Unit">
                <select
                  value={form.unit_of_temp}
                  onChange={e => setForm({ ...form, unit_of_temp: e.target.value })}
                  className="glass-input w-full px-3 py-2.5 text-sm"
                >
                  <option value="C">Celsius</option>
                  <option value="F">Fahrenheit</option>
                </select>
              </SettingField>

              <SettingField label="Preferred Range">
                <select
                  value={form.preferred_range}
                  onChange={e => setForm({ ...form, preferred_range: e.target.value })}
                  className="glass-input w-full px-3 py-2.5 text-sm"
                >
                  <option value="rated">Rated</option>
                  <option value="ideal">Ideal</option>
                </select>
              </SettingField>

              <SettingField label="Language">
                <select
                  value={form.language}
                  onChange={e => setForm({ ...form, language: e.target.value })}
                  className="glass-input w-full px-3 py-2.5 text-sm"
                >
                  <option value="en">English</option>
                  <option value="de">Deutsch</option>
                  <option value="fr">Fran&#231;ais</option>
                  <option value="es">Espa&#241;ol</option>
                  <option value="zh">&#20013;&#25991;</option>
                </select>
              </SettingField>

              <SettingField label="Electricity Cost (per kWh)">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] text-sm">$</span>
                  <input
                    type="number"
                    step="0.01"
                    value={form.base_cost_per_kwh}
                    onChange={e => setForm({ ...form, base_cost_per_kwh: parseFloat(e.target.value) || 0 })}
                    className="glass-input w-full pl-7 pr-3 py-2.5 text-sm"
                  />
                </div>
              </SettingField>

              <SettingField label="Gas Price (for EV vs ICE comparison)">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] text-sm">$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={form.gas_price_per_unit}
                      onChange={e => setForm({ ...form, gas_price_per_unit: parseFloat(e.target.value) || 0 })}
                      className="glass-input w-full pl-7 pr-3 py-2.5 text-sm"
                    />
                  </div>
                  <select
                    value={form.gas_unit}
                    onChange={e => setForm({ ...form, gas_unit: e.target.value })}
                    className="glass-input px-3 py-2.5 text-sm w-28"
                  >
                    <option value="gallon">/ gallon</option>
                    <option value="liter">/ liter</option>
                  </select>
                </div>
              </SettingField>

              <SettingField label="Comparison Vehicle MPG">
                <input
                  type="number"
                  step="0.5"
                  value={form.gas_efficiency_mpg}
                  onChange={e => setForm({ ...form, gas_efficiency_mpg: parseFloat(e.target.value) || 0 })}
                  className="glass-input w-full px-3 py-2.5 text-sm"
                  placeholder="Average MPG of equivalent gas car"
                />
              </SettingField>

              <SettingField label="Google Maps API Key">
                <input
                  type="password"
                  value={form.google_maps_api_key || ''}
                  onChange={e => setForm({ ...form, google_maps_api_key: e.target.value })}
                  className="glass-input w-full px-3 py-2.5 text-sm"
                  placeholder="Enter your Google Maps API key"
                />
                <p className="text-[10px] text-[var(--text-muted)] mt-1">
                  Optional — enables satellite views, Places autocomplete, and enhanced geocoding.
                  Get a key at <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" className="text-neon-cyan hover:underline">console.cloud.google.com</a>
                </p>
              </SettingField>
            </div>
            </>
          )}

          <div className="flex items-center gap-4">
            <button
              onClick={() => settingsMut.mutate(form)}
              disabled={settingsMut.isPending}
              className="neon-button flex items-center gap-2 px-5 py-2.5 text-sm font-medium disabled:opacity-40"
            >
              <Save className="h-4 w-4" />
              {settingsMut.isPending ? 'Saving...' : 'Save Settings'}
            </button>

            <AnimatePresence>
              {saved && (
                <motion.span
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  className="text-sm text-neon-green flex items-center gap-1"
                >
                  <CheckCircle className="h-4 w-4" /> Settings saved
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Gas Price Auto-Poll */}
      <FadeIn delay={0.12}>
        <GlassPanel className="p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10 text-orange-400 ring-1 ring-orange-500/20">
              <Fuel className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Gas Price Auto-Poll</h2>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Automatically fetch US average gas prices from EIA</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Toggle auto-polling */}
            <SettingField label="Auto-Poll">
              <button
                onClick={() => {
                  const next = !gasPriceStatus?.enabled
                  toggleGasPrice(next).then(() => { refetchGasPrice(); toast.info(next ? 'Auto-poll enabled' : 'Auto-poll disabled') })
                }}
                className={clsx(
                  'flex items-center gap-3 w-full rounded-xl border p-3.5 transition-all duration-200',
                  gasPriceStatus?.enabled
                    ? 'border-neon-green/40 bg-neon-green/5 text-neon-green'
                    : 'border-[var(--glass-border)] bg-[var(--surface-2)] text-[var(--text-muted)]'
                )}
              >
                {gasPriceStatus?.enabled ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                <span className="text-sm font-medium">{gasPriceStatus?.enabled ? 'Running' : 'Stopped'}</span>
              </button>
            </SettingField>

            {/* Poll interval dropdown */}
            <SettingField label="Poll Interval">
              <select
                value={gasPriceStatus?.poll_interval || '7d'}
                onChange={e => {
                  updateGasPriceConfig(e.target.value).then(() => { refetchGasPrice(); toast.info('Poll interval updated') })
                }}
                className="glass-input w-full px-3 py-2.5 text-sm"
              >
                <option value="daily">Daily</option>
                <option value="7d">Weekly</option>
                <option value="15d">Bi-weekly</option>
                <option value="30d">Monthly</option>
              </select>
            </SettingField>
          </div>

          {/* Current price & last polled */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--surface-2)] p-3.5">
              <p className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Current Price</p>
              <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                {gasPriceStatus?.current_price ? `$${gasPriceStatus.current_price.toFixed(3)}/gal` : '—'}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--surface-2)] p-3.5">
              <p className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Last Polled</p>
              <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                {gasPriceStatus?.last_poll_time && gasPriceStatus.last_poll_time !== '0001-01-01T00:00:00Z'
                  ? formatDateTime(gasPriceStatus.last_poll_time)
                  : 'Never'}
              </p>
            </div>
          </div>

          {/* Poll Now button */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                pollGasPrice().then(() => {
                  toast.info('Gas price poll triggered')
                  setTimeout(() => refetchGasPrice(), 3000)
                })
              }}
              className="neon-button flex items-center gap-2 px-5 py-2.5 text-sm font-medium"
            >
              <Zap className="h-4 w-4" />
              Poll Now
            </button>
            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              Source: U.S. Energy Information Administration
            </p>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Theme & Appearance */}
      <FadeIn delay={0.15}>
        <GlassPanel className="p-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neon-purple/10 text-neon-purple ring-1 ring-neon-purple/20">
              <Palette className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Appearance</h2>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Customize colors and display mode</p>
            </div>
          </div>

          {/* Mode Selector */}
          <div>
            <p className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Display Mode</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.values(allModes).map(m => (
                <button
                  key={m.id}
                  onClick={() => { setMode(m.id as ModeId); toast.info(`Mode: ${m.name}`) }}
                  className={clsx(
                    'flex items-center gap-3 rounded-xl border p-3.5 transition-all duration-200',
                    modeId === m.id
                      ? 'border-[var(--theme-primary)] bg-[var(--surface-3)]'
                      : 'border-[var(--glass-border)] bg-[var(--surface-2)] hover:border-[var(--theme-primary)]/30'
                  )}
                  style={modeId === m.id ? { boxShadow: `0 0 12px rgba(var(--theme-primary-rgb), 0.15)` } : {}}
                >
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-lg"
                    style={{
                      background: m.surface3,
                      border: `1px solid ${m.glassBorder}`,
                    }}
                  >
                    <span style={{ color: m.textPrimary }}>{modeIcons[m.id]}</span>
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{m.name}</p>
                    <div className="flex gap-1 mt-1">
                      {[m.bg, m.surface1, m.surface2, m.surface3].map((c, i) => (
                        <div key={i} className="h-2 w-4 rounded-sm border border-[var(--glass-border)]" style={{ background: c }} />
                      ))}
                    </div>
                  </div>
                  {modeId === m.id && (
                    <CheckCircle className="h-4 w-4 ml-auto" style={{ color: 'var(--theme-primary)' }} />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Accent Color */}
          <div>
            <p className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Accent Color</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {Object.values(allThemes).filter(t => t.id !== 'custom').map(t => (
                <button
                  key={t.id}
                  onClick={() => { setTheme(t.id as ThemeId); toast.info(`Theme: ${t.name}`) }}
                  className={clsx(
                    'group relative rounded-xl border p-4 text-left transition-all duration-200',
                    themeId === t.id
                      ? 'bg-[var(--surface-3)]'
                      : 'bg-[var(--surface-2)] hover:bg-[var(--surface-3)]'
                  )}
                  style={{ borderColor: themeId === t.id ? t.primary : 'var(--glass-border)' }}
                >
                  <div
                    className="h-6 w-6 rounded-full mb-3"
                    style={{
                      background: `linear-gradient(135deg, ${t.primary}, ${t.accent})`,
                      boxShadow: themeId === t.id ? `0 0 12px ${t.primary}` : 'none',
                    }}
                  />
                  <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{t.name}</p>
                  {themeId === t.id && (
                    <motion.div
                      layoutId="theme-check"
                      className="absolute top-2.5 right-2.5"
                      transition={{ type: 'spring', bounce: 0.2, duration: 0.3 }}
                    >
                      <CheckCircle className="h-4 w-4" style={{ color: t.primary }} />
                    </motion.div>
                  )}
                </button>
              ))}

              {/* Custom color picker card */}
              <button
                onClick={() => { setCustomColors(customPrimary, customAccent); toast.info('Theme: Custom') }}
                className={clsx(
                  'group relative rounded-xl border p-4 text-left transition-all duration-200',
                  themeId === 'custom'
                    ? 'bg-[var(--surface-3)]'
                    : 'bg-[var(--surface-2)] hover:bg-[var(--surface-3)]'
                )}
                style={{ borderColor: themeId === 'custom' ? customPrimary : 'var(--glass-border)' }}
              >
                <div
                  className="h-6 w-6 rounded-full mb-3"
                  style={{
                    background: `linear-gradient(135deg, ${customPrimary}, ${customAccent})`,
                    boxShadow: themeId === 'custom' ? `0 0 12px ${customPrimary}` : 'none',
                  }}
                />
                <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>Custom</p>
                {themeId === 'custom' && (
                  <motion.div
                    layoutId="theme-check"
                    className="absolute top-2.5 right-2.5"
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.3 }}
                  >
                    <CheckCircle className="h-4 w-4" style={{ color: customPrimary }} />
                  </motion.div>
                )}
              </button>
            </div>

            {/* Custom color pickers — shown when custom theme is active */}
            <AnimatePresence>
              {themeId === 'custom' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="flex flex-wrap gap-6 mt-4 p-4 rounded-xl bg-[var(--surface-2)] border border-[var(--glass-border)]">
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Primary</label>
                      <input
                        type="color"
                        value={customPrimary}
                        onChange={e => { setCustomPrimary(e.target.value); setCustomColors(e.target.value, customAccent) }}
                        className="h-8 w-10 rounded-lg border border-[var(--glass-border)] bg-transparent cursor-pointer"
                      />
                      <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{customPrimary}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Accent</label>
                      <input
                        type="color"
                        value={customAccent}
                        onChange={e => { setCustomAccent(e.target.value); setCustomColors(customPrimary, e.target.value) }}
                        className="h-8 w-10 rounded-lg border border-[var(--glass-border)] bg-transparent cursor-pointer"
                      />
                      <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{customAccent}</span>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Data Export — link to dedicated page */}
      <FadeIn delay={0.18}>
        <a href="/data-export" className="block">
          <GlassPanel className="p-5 flex items-center gap-4 hover:border-white/10 transition-colors cursor-pointer group">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neon-green/10 text-neon-green ring-1 ring-neon-green/20 shrink-0">
              <Download className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">Data Export</h2>
              <p className="text-xs text-[var(--text-muted)]">Export drives, charging, analytics, or full backup as CSV/JSON</p>
            </div>
            <ExternalLink className="h-4 w-4 text-[var(--text-muted)] group-hover:text-neon-cyan transition-colors shrink-0" />
          </GlassPanel>
        </a>
      </FadeIn>

    </div>
  )
}
