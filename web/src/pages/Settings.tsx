import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSettings, updateSettings, toggleAPISuspend, getAuthURL, getAuthStatus, refreshAuth, syncVehicles, getVehicles, getVersionInfo, AppSettings, Vehicle } from '../api'
import { useState, useEffect } from 'react'
import { Settings as SettingsIcon, Save, ExternalLink, RefreshCw, Car, Shield, CheckCircle, XCircle, Globe, Palette, Download, Sun, Moon, Monitor, Sparkles, Pause, Play, Link } from 'lucide-react'
import { PageHeader, GlassPanel, FadeIn, Skeleton } from '../components/ui'
import { motion, AnimatePresence } from 'framer-motion'
import { useTheme, type ThemeId, type ModeId } from '../components/ThemeProvider'
import { useToast } from '../components/Toast'
import clsx from 'clsx'

const modeIcons: Record<string, React.ReactNode> = {
  dark: <Moon className="h-4 w-4" />,
  light: <Sun className="h-4 w-4" />,
  oled: <Monitor className="h-4 w-4" />,
  midnight: <Sparkles className="h-4 w-4" />,
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
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const { data: version } = useQuery({ queryKey: ['version'], queryFn: getVersionInfo, staleTime: 60_000 })
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
  const syncMut = useMutation({
    mutationFn: syncVehicles,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
    },
    onError: (err: Error) => {
      toast.error('Vehicle sync failed', err.message || 'Could not sync vehicles from Tesla')
    },
  })

  const suspendMut = useMutation({
    mutationFn: (suspended: boolean) => toggleAPISuspend(suspended),
    onSuccess: (_data, suspended) => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      if (suspended) {
        toast.info('API suspended', 'All Tesla API calls have been paused')
      } else {
        toast.success('API resumed', 'Tesla API polling has been re-enabled')
      }
    },
    onError: () => {
      toast.error('Failed', 'Could not toggle API suspension')
    },
  })

  function handleLogin() {
    authUrlMut.mutate(undefined, {
      onSuccess: (data) => {
        window.location.href = data.auth_url
      },
    })
  }

  const [exportStart, setExportStart] = useState('')
  const [exportEnd, setExportEnd] = useState('')
  const [exportVehicle, setExportVehicle] = useState('')

  function buildExportUrl(type: string, format: string) {
    const params = new URLSearchParams({ format })
    if (exportStart) params.set('start', exportStart)
    if (exportEnd) params.set('end', exportEnd)
    if (exportVehicle) params.set('vehicle_id', exportVehicle)
    return `/api/v1/export/${type}?${params.toString()}`
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
                      Token expires {new Date(auth.expires_at).toLocaleString()}
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

      {/* Tesla API Suspension */}
      <FadeIn delay={0.05}>
        <GlassPanel className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={clsx(
                'flex h-10 w-10 items-center justify-center rounded-xl ring-1',
                settings?.api_suspended
                  ? 'bg-neon-red/10 text-neon-red ring-neon-red/20'
                  : 'bg-neon-green/10 text-neon-green ring-neon-green/20'
              )}>
                {settings?.api_suspended ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
              </div>
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">Tesla API Polling</h2>
                <p className="text-xs text-[var(--text-muted)]">
                  {settings?.api_suspended
                    ? 'All Tesla Fleet API calls are suspended'
                    : 'Vehicle data is being polled from Tesla'}
                </p>
              </div>
            </div>

            <button
              onClick={() => suspendMut.mutate(!settings?.api_suspended)}
              disabled={suspendMut.isPending}
              className={clsx(
                'relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-40',
                settings?.api_suspended ? 'bg-neon-red/60' : 'bg-neon-green/60'
              )}
            >
              <span className={clsx(
                'pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200',
                settings?.api_suspended ? 'translate-x-0' : 'translate-x-5'
              )} />
            </button>
          </div>

          {settings?.api_suspended && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-neon-red/5 border border-neon-red/20">
              <Pause className="h-4 w-4 text-neon-red shrink-0" />
              <p className="text-xs text-neon-red/80">
                Polling and commands are paused. Token refresh continues so you won't need to re-authenticate. Useful when your vehicle is in service.
              </p>
            </div>
          )}
        </GlassPanel>
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
            </div>
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

      {/* Data Export */}
      <FadeIn delay={0.18}>
        <GlassPanel className="p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neon-green/10 text-neon-green ring-1 ring-neon-green/20">
              <Download className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">Data Export</h2>
              <p className="text-xs text-[var(--text-muted)]">Export your vehicle data as CSV or JSON with optional filters</p>
            </div>
          </div>

          {/* Filters */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SettingField label="Start Date">
              <input
                type="date"
                value={exportStart}
                onChange={e => setExportStart(e.target.value)}
                className="glass-input w-full px-3 py-2.5 text-sm"
              />
            </SettingField>
            <SettingField label="End Date">
              <input
                type="date"
                value={exportEnd}
                onChange={e => setExportEnd(e.target.value)}
                className="glass-input w-full px-3 py-2.5 text-sm"
              />
            </SettingField>
            <SettingField label="Vehicle">
              <select
                value={exportVehicle}
                onChange={e => setExportVehicle(e.target.value)}
                className="glass-input w-full px-3 py-2.5 text-sm"
              >
                <option value="">All vehicles</option>
                {vehicles?.map((v: Vehicle) => (
                  <option key={v.id} value={v.id}>{v.display_name || v.vin}</option>
                ))}
              </select>
            </SettingField>
          </div>

          {/* Export options */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/5">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)]">Drives</p>
                <p className="text-xs text-[var(--text-muted)]">Trip history with distance, duration, speed, and battery usage</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <a href={buildExportUrl('drives', 'csv')} download="teslasync-drives.csv" className="glass-button text-xs flex items-center gap-1.5">
                  <Download className="h-3.5 w-3.5" /> CSV
                </a>
                <a href={buildExportUrl('drives', 'json')} download="teslasync-drives.json" className="glass-button text-xs flex items-center gap-1.5">
                  <Download className="h-3.5 w-3.5" /> JSON
                </a>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/5">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)]">Charging</p>
                <p className="text-xs text-[var(--text-muted)]">Charging sessions with energy added, cost, power, and battery levels</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <a href={buildExportUrl('charging', 'csv')} download="teslasync-charging.csv" className="glass-button text-xs flex items-center gap-1.5">
                  <Download className="h-3.5 w-3.5" /> CSV
                </a>
                <a href={buildExportUrl('charging', 'json')} download="teslasync-charging.json" className="glass-button text-xs flex items-center gap-1.5">
                  <Download className="h-3.5 w-3.5" /> JSON
                </a>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/5">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)]">Positions</p>
                <p className="text-xs text-[var(--text-muted)]">GPS position data with timestamps and vehicle state</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <a href={buildExportUrl('positions', 'json')} download="teslasync-positions.json" className="glass-button text-xs flex items-center gap-1.5">
                  <Download className="h-3.5 w-3.5" /> JSON
                </a>
              </div>
            </div>
          </div>

          {(exportStart || exportEnd || exportVehicle) && (
            <button onClick={() => { setExportStart(''); setExportEnd(''); setExportVehicle('') }} className="text-xs text-[var(--text-muted)] hover:text-gray-300 transition-colors">
              Clear filters
            </button>
          )}
        </GlassPanel>
      </FadeIn>

      {/* System Info & Endpoints */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium mb-1">TeslaSync</p>
              <p className="text-sm text-[var(--text-secondary)]">
                {version ? `v${version.chart_version} · ${version.go_version} · ${version.os}/${version.arch}` : ''}
              </p>
            </div>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neon-cyan/5 text-neon-cyan/40">
              <Globe className="h-4 w-4" />
            </div>
          </div>

          {version?.endpoints && Object.keys(version.endpoints).length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Link className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium">Configured Endpoints</p>
              </div>
              <div className="grid gap-2">
                {version.endpoints.api && (
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02] border border-white/5">
                    <span className="text-xs text-[var(--text-muted)] font-medium">API (Internal)</span>
                    <span className="text-xs text-[var(--text-secondary)] font-mono">{version.endpoints.api}</span>
                  </div>
                )}
                {version.endpoints.web && (
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02] border border-white/5">
                    <span className="text-xs text-[var(--text-muted)] font-medium">Web Frontend</span>
                    <span className="text-xs text-[var(--text-secondary)] font-mono">{version.endpoints.web}</span>
                  </div>
                )}
                {version.endpoints.oauth_callback && (
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02] border border-white/5">
                    <span className="text-xs text-[var(--text-muted)] font-medium">OAuth Callback</span>
                    <span className="text-xs text-[var(--text-secondary)] font-mono">{version.endpoints.oauth_callback}</span>
                  </div>
                )}
                {version.endpoints.tesla_api && (
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02] border border-white/5">
                    <span className="text-xs text-[var(--text-muted)] font-medium">Tesla Fleet API</span>
                    <span className="text-xs text-[var(--text-secondary)] font-mono">{version.endpoints.tesla_api}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </GlassPanel>
      </FadeIn>
    </div>
  )
}
