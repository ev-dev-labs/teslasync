import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSettings, updateSettings, getAuthURL, getAuthStatus, refreshAuth, syncVehicles, getVehicles, getAPIUsage, getBackupStats, AppSettings, Vehicle } from '../api'
import { useState, useEffect, useMemo } from 'react'
import { Settings as SettingsIcon, Save, ExternalLink, RefreshCw, Car, Shield, CheckCircle, XCircle, Globe, Palette, Download, Sun, Moon, Monitor, Sparkles, DollarSign, Webhook, Copy, Check, Zap, Users, Lock, Trash2, AlertTriangle, Database } from 'lucide-react'
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
      className="glass-button p-1.5 shrink-0"
      title="Copy to clipboard"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

function FleetTelemetrySection() {
  const [enabled, setEnabled] = useState(() => localStorage.getItem('teslasync-fleet-telemetry') === 'true')
  const [serverUrl, setServerUrl] = useState(() => localStorage.getItem('teslasync-telemetry-url') || '')

  return (
    <GlassPanel className="p-6">
      <h3 className="flex items-center gap-2 text-sm font-semibold mb-4" style={{color:'var(--text-primary)'}}>
        <Zap className="h-4 w-4 text-neon-purple" /> Fleet Telemetry (Beta)
      </h3>
      <p className="text-xs text-[var(--text-muted)] mb-4">
        Tesla Fleet Telemetry pushes vehicle data via streaming instead of polling.
        This can reduce API costs by up to 97% but requires a separate telemetry server.
      </p>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm" style={{color:'var(--text-secondary)'}}>Enable Fleet Telemetry</span>
          <button onClick={() => { const v = !enabled; setEnabled(v); localStorage.setItem('teslasync-fleet-telemetry', String(v)) }}
            className={clsx('relative w-11 h-6 rounded-full transition-colors', enabled ? 'bg-neon-purple' : 'bg-gray-600')}>
            <span className={clsx('absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform', enabled && 'translate-x-5')} />
          </button>
        </div>

        {enabled && (
          <>
            <div>
              <label className="text-[11px] text-[var(--text-muted)] uppercase">Telemetry Server URL</label>
              <input type="url" value={serverUrl} onChange={e => { setServerUrl(e.target.value); localStorage.setItem('teslasync-telemetry-url', e.target.value) }}
                placeholder="wss://telemetry.example.com"
                className="mt-1 w-full rounded-lg px-3 py-2 text-sm" style={{background:'var(--surface-2)',color:'var(--text-primary)',border:'1px solid var(--glass-border)'}} />
            </div>

            <div className="rounded-lg border border-neon-purple/20 bg-neon-purple/5 p-4">
              <h4 className="text-xs font-semibold text-neon-purple mb-2">Setup Guide</h4>
              <ol className="text-xs text-[var(--text-secondary)] space-y-1 list-decimal list-inside">
                <li>Deploy Tesla Fleet Telemetry server (github.com/teslamotors/fleet-telemetry)</li>
                <li>Configure your Tesla Developer account with the telemetry endpoint</li>
                <li>Pair your vehicle(s) with the telemetry server</li>
                <li>Enter the server URL above</li>
                <li>Data will stream automatically when vehicles are online</li>
              </ol>
            </div>

            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="glass-card p-3 rounded-lg">
                <p className="text-lg font-bold text-neon-green">97%</p>
                <p className="text-[10px] text-[var(--text-muted)]">Cost Reduction</p>
              </div>
              <div className="glass-card p-3 rounded-lg">
                <p className="text-lg font-bold text-neon-cyan">1s</p>
                <p className="text-[10px] text-[var(--text-muted)]">Data Resolution</p>
              </div>
            </div>
          </>
        )}
      </div>
    </GlassPanel>
  )
}

function UserManagementSection() {
  const [token] = useState(() => localStorage.getItem('teslasync-auth-token'))
  const hasToken = Boolean(token)

  return (
    <GlassPanel className="p-6">
      <h3 className="flex items-center gap-2 text-sm font-semibold mb-4" style={{color:'var(--text-primary)'}}>
        <Users className="h-4 w-4 text-neon-cyan" /> User Management
      </h3>

      <div className="space-y-4">
        <div className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neon-blue/10">
            <Shield className="h-4 w-4 text-neon-blue" />
          </div>
          <div>
            <p className="text-sm font-medium" style={{color:'var(--text-primary)'}}>admin</p>
            <p className="text-[11px] text-[var(--text-muted)]">Role: admin</p>
          </div>
          {hasToken && (
            <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-neon-green/10 text-neon-green border border-neon-green/20">
              Authenticated
            </span>
          )}
        </div>

        <div className="rounded-lg border border-neon-cyan/20 bg-neon-cyan/5 p-4">
          <p className="text-xs text-[var(--text-secondary)]">
            <strong className="text-neon-cyan">Auth is optional for self-hosted deployments.</strong>{' '}
            Set <code className="px-1 py-0.5 rounded bg-white/5 text-[var(--text-primary)]">AUTH_ENABLED=true</code> to
            require login. When disabled, all API endpoints are accessible without a token.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 text-center">
          <div className="glass-card p-3 rounded-lg">
            <p className="text-lg font-bold text-neon-blue">1</p>
            <p className="text-[10px] text-[var(--text-muted)]">Total Users</p>
          </div>
          <div className="glass-card p-3 rounded-lg">
            <p className="text-lg font-bold text-neon-purple">24h</p>
            <p className="text-[10px] text-[var(--text-muted)]">Token Expiry</p>
          </div>
        </div>
      </div>
    </GlassPanel>
  )
}

function BackupSection() {
  const { data: stats, isLoading } = useQuery({ queryKey: ['backup-stats'], queryFn: getBackupStats })
  const [downloading, setDownloading] = useState(false)
  const [lastBackup, setLastBackup] = useState<string | null>(() => localStorage.getItem('teslasync-last-backup'))
  const toast = useToast()

  const totalRows = stats?.row_counts ? Object.values(stats.row_counts).reduce((a, b) => a + b, 0) : 0
  const estimatedSize = totalRows > 0 ? `~${Math.max(1, Math.round(totalRows * 0.5 / 1024))} MB` : '—'

  async function handleDownload() {
    setDownloading(true)
    try {
      const res = await fetch('/api/v1/system/backup')
      if (!res.ok) throw new Error('Backup failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `teslasync-backup-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      const now = new Date().toISOString()
      localStorage.setItem('teslasync-last-backup', now)
      setLastBackup(now)
      toast.success('Backup downloaded', 'Your database backup has been saved')
    } catch {
      toast.error('Backup failed', 'Could not download the backup file')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <GlassPanel className="p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neon-cyan/10 text-neon-cyan ring-1 ring-neon-cyan/20">
          <Database className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Backup</h2>
          <p className="text-xs text-[var(--text-muted)]">Export your TeslaSync database for safekeeping</p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2"><Skeleton className="h-4 w-48" /><Skeleton className="h-4 w-36" /></div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Database Size</p>
            <p className="text-sm font-mono text-neon-cyan">{stats?.database_size ?? '—'}</p>
          </div>
          <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Tables</p>
            <p className="text-sm font-mono text-[var(--text-primary)]">{stats?.table_count ?? '—'}</p>
          </div>
          <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Est. Backup Size</p>
            <p className="text-sm font-mono text-[var(--text-primary)]">{estimatedSize}</p>
          </div>
          <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Last Backup</p>
            <p className="text-sm font-mono text-[var(--text-primary)]">{lastBackup ? new Date(lastBackup).toLocaleDateString() : 'Never'}</p>
          </div>
        </div>
      )}

      {stats?.row_counts && (
        <div className="text-xs text-[var(--text-muted)] flex flex-wrap gap-x-4 gap-y-1">
          {Object.entries(stats.row_counts).map(([table, count]) => (
            <span key={table}><span className="text-[var(--text-secondary)]">{table}:</span> {count.toLocaleString()}</span>
          ))}
        </div>
      )}

      <button
        onClick={handleDownload}
        disabled={downloading}
        className="glass-button flex items-center gap-2 text-sm px-4 py-2"
      >
        {downloading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {downloading ? 'Downloading…' : 'Download Backup'}
      </button>
    </GlassPanel>
  )
}

function PrivacySection() {
  const [anonymizeLocations, setAnonymizeLocations] = useState(
    () => localStorage.getItem('teslasync-anonymize-locations') === 'true'
  )
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [exporting, setExporting] = useState(false)
  const toast = useToast()

  const retentionDays = 90
  const dataRetentionDays = 365

  function handleExportAll() {
    setExporting(true)
    fetch('/api/v1/export/all?format=json')
      .then(res => {
        if (!res.ok) throw new Error('Export failed')
        return res.blob()
      })
      .then(blob => {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `teslasync-data-export-${new Date().toISOString().slice(0, 10)}.json`
        a.click()
        URL.revokeObjectURL(url)
        toast.success('Export complete', 'Your data has been downloaded')
      })
      .catch(() => {
        toast.error('Export failed', 'Could not export data. Please try again.')
      })
      .finally(() => setExporting(false))
  }

  return (
    <GlassPanel className="p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neon-purple/10 text-neon-purple ring-1 ring-neon-purple/20">
          <Lock className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Privacy Controls</h2>
          <p className="text-xs text-[var(--text-muted)]">Manage data privacy, exports, and retention</p>
        </div>
      </div>

      {/* Anonymize Location Data */}
      <div className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/5">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)]">Anonymize Location Names</p>
          <p className="text-xs text-[var(--text-muted)]">Replace actual addresses with generic labels in exports</p>
        </div>
        <button
          onClick={() => {
            const v = !anonymizeLocations
            setAnonymizeLocations(v)
            localStorage.setItem('teslasync-anonymize-locations', String(v))
          }}
          className={clsx('relative w-11 h-6 rounded-full transition-colors shrink-0 ml-4', anonymizeLocations ? 'bg-neon-purple' : 'bg-gray-600')}
        >
          <span className={clsx('absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform', anonymizeLocations && 'translate-x-5')} />
        </button>
      </div>

      {/* Export All Data (GDPR) */}
      <div className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/5">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)]">Export All My Data</p>
          <p className="text-xs text-[var(--text-muted)]">Downloads a JSON file with all vehicles, drives, charges, and positions</p>
        </div>
        <button
          onClick={handleExportAll}
          disabled={exporting}
          className="flex items-center gap-2 rounded-lg border border-[var(--glass-border)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-white/5 transition-colors disabled:opacity-40 shrink-0 ml-4"
        >
          <Download className={clsx('h-4 w-4', exporting && 'animate-spin')} />
          {exporting ? 'Exporting...' : 'Export'}
        </button>
      </div>

      {/* Delete All Data */}
      <div className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-red-500/10">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-red-400">Delete All Data</p>
          <p className="text-xs text-[var(--text-muted)]">Permanently delete all stored data. This action cannot be undone.</p>
        </div>
        <button
          onClick={() => setShowDeleteConfirm(true)}
          disabled
          className="flex items-center gap-2 rounded-lg border border-red-500/30 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0 ml-4"
          title="API endpoint not yet available"
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </button>
      </div>
      <p className="text-[10px] text-[var(--text-muted)] italic">
        Data purge requires DELETE /api/v1/data/purge endpoint (not yet implemented).
      </p>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setShowDeleteConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="glass-card p-6 max-w-sm w-full mx-4 space-y-4"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10">
                  <AlertTriangle className="h-5 w-5 text-red-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Delete All Data?</h3>
                  <p className="text-xs text-[var(--text-muted)]">This action is irreversible</p>
                </div>
              </div>
              <p className="text-sm text-[var(--text-secondary)]">
                All vehicles, drives, charges, positions, and settings will be permanently deleted.
              </p>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setShowDeleteConfirm(false)} className="glass-button px-4 py-2 text-sm">Cancel</button>
                <button disabled className="flex items-center gap-2 rounded-lg bg-red-500/20 border border-red-500/30 px-4 py-2 text-sm text-red-400 disabled:opacity-40 disabled:cursor-not-allowed" title="API endpoint not yet available">
                  <Trash2 className="h-4 w-4" /> Delete Everything
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Data Retention Display */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
          <p className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Position Data Retention</p>
          <p className="text-lg font-semibold text-[var(--text-primary)]">{retentionDays} days</p>
        </div>
        <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
          <p className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider mb-1">General Data Retention</p>
          <p className="text-lg font-semibold text-[var(--text-primary)]">{dataRetentionDays} days</p>
        </div>
      </div>
    </GlassPanel>
  )
}

export default function Settings() {
  const queryClient = useQueryClient()
  const { data: settings, isLoading } = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const { data: auth } = useQuery({ queryKey: ['auth-status'], queryFn: getAuthStatus })
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const { data: apiUsage } = useQuery({ queryKey: ['api-usage'], queryFn: getAPIUsage, refetchInterval: 60000 })
  const { themeId, modeId, setTheme, setMode, themes: allThemes, modes: allModes } = useTheme()
  const toast = useToast()

  const [form, setForm] = useState<AppSettings>({
    unit_of_length: 'km',
    unit_of_temp: 'C',
    preferred_range: 'rated',
    language: 'en',
    base_cost_per_kwh: 0.12,
  })
  const [saved, setSaved] = useState(false)

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
  const [drivingHours, setDrivingHours] = useState(1)
  const [chargingHours, setChargingHours] = useState(2)

  const billingEstimate = useMemo(() => {
    // Status checks via ListVehicles: 1 call per 15min = 96/day × 30 = 2,880/month
    const statusChecks = Math.round(24 * 3600 / 900 * 30)
    const drivingRequests = drivingHours * 3600 / 120 * 30
    const chargingRequests = chargingHours * 3600 / 600 * 30
    const idleRequests = 0 // covered by status checks, no extra vehicle_data calls for idle
    const sleepRequests = 0 // never polled
    const totalRequests = statusChecks + drivingRequests + chargingRequests + idleRequests + sleepRequests
    const costPerRequest = 0.002
    const monthlyCost = totalRequests * costPerRequest
    return { totalRequests: Math.round(totalRequests), monthlyCost, statusChecks: Math.round(statusChecks), drivingRequests: Math.round(drivingRequests), chargingRequests: Math.round(chargingRequests), idleRequests: Math.round(idleRequests), sleepRequests: Math.round(sleepRequests) }
  }, [drivingHours, chargingHours])

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
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {Object.values(allThemes).map(t => (
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
            </div>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* API Usage Estimate */}
      <FadeIn delay={0.16}>
        <GlassPanel className="p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neon-yellow/10 text-neon-yellow ring-1 ring-neon-yellow/20">
              <DollarSign className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">API Usage Estimate</h2>
              <p className="text-xs text-[var(--text-muted)]">Tesla Fleet API billing — $10/month free credit (~4,500 requests)</p>
            </div>
          </div>

          {apiUsage && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
                <p className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Requests Made</p>
                <p className="text-lg font-semibold text-[var(--text-primary)]">{apiUsage.total_requests.toLocaleString()}</p>
              </div>
              <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
                <p className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Polls Skipped</p>
                <p className="text-lg font-semibold text-neon-green">{apiUsage.skipped_polls.toLocaleString()}</p>
              </div>
              <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
                <p className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Est. Cost</p>
                <p className="text-lg font-semibold text-[var(--text-primary)]">${apiUsage.estimated_cost.toFixed(2)}</p>
              </div>
              <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
                <p className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Credit Left</p>
                <p className={clsx('text-lg font-semibold', apiUsage.estimated_remaining > 3 ? 'text-neon-green' : apiUsage.estimated_remaining > 0 ? 'text-neon-yellow' : 'text-neon-red')}>
                  ${Math.max(0, apiUsage.estimated_remaining).toFixed(2)}
                </p>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <p className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-wider">Monthly Estimate Calculator</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SettingField label="Driving Hours / Day">
                <input type="number" min={0} max={12} step={0.5} value={drivingHours} onChange={e => setDrivingHours(Number(e.target.value))} className="glass-input w-full px-3 py-2.5 text-sm" />
              </SettingField>
              <SettingField label="Charging Hours / Day">
                <input type="number" min={0} max={12} step={0.5} value={chargingHours} onChange={e => setChargingHours(Number(e.target.value))} className="glass-input w-full px-3 py-2.5 text-sm" />
              </SettingField>
            </div>
            <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Status checks (15min, ListVehicles)</span><span className="text-[var(--text-primary)]">{billingEstimate.statusChecks.toLocaleString()} req</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Driving (120s interval)</span><span className="text-[var(--text-primary)]">{billingEstimate.drivingRequests.toLocaleString()} req</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Charging (600s interval)</span><span className="text-[var(--text-primary)]">{billingEstimate.chargingRequests.toLocaleString()} req</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Idle (no extra polls)</span><span className="text-[var(--text-primary)]">{billingEstimate.idleRequests.toLocaleString()} req</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Sleep (never polled)</span><span className="text-[var(--text-primary)]">{billingEstimate.sleepRequests.toLocaleString()} req</span></div>
              <div className="flex justify-between border-t border-white/5 pt-1 mt-1">
                <span className="text-[var(--text-primary)] font-medium">Total / vehicle / month</span>
                <span className="text-[var(--text-primary)] font-medium">{billingEstimate.totalRequests.toLocaleString()} req</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-primary)] font-medium">Est. cost / vehicle</span>
                <span className={clsx('font-medium', billingEstimate.monthlyCost <= 10 ? 'text-neon-green' : 'text-neon-red')}>
                  ${billingEstimate.monthlyCost.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          <p className="text-xs text-[var(--text-muted)]">
            Cost-optimized polling uses ListVehicles (1 call for all cars) every 15 min, then vehicle_data only for driving (120s) and charging (600s). Sleeping/offline vehicles are never polled. Designed to stay under $10/month free credit for 1 vehicle.
          </p>
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

      {/* Webhooks */}
      <FadeIn delay={0.15}>
        <GlassPanel className="p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-neon-cyan/10">
              <Webhook className="h-5 w-5 text-neon-cyan" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">Webhooks</h2>
              <p className="text-xs text-[var(--text-muted)]">Receive events from external systems like Home Assistant, IFTTT, or Node-RED</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium mb-2">Inbound Webhook URL</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/10 text-sm text-neon-cyan font-mono truncate">
                  POST {window.location.origin}/api/v1/webhook
                </code>
                <CopyButton text={`${window.location.origin}/api/v1/webhook`} />
              </div>
            </div>

            <div>
              <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium mb-2">Example: Create an Alert</p>
              <div className="relative">
                <pre className="px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/10 text-xs text-[var(--text-secondary)] font-mono overflow-x-auto whitespace-pre">{`curl -X POST ${window.location.origin}/api/v1/webhook \\
  -H "Content-Type: application/json" \\
  -d '{
    "event": "alert",
    "title": "Garage Door Open",
    "message": "Car arrived home but garage door is still open",
    "severity": "warning"
  }'`}</pre>
                <div className="absolute top-2 right-2">
                  <CopyButton text={`curl -X POST ${window.location.origin}/api/v1/webhook -H "Content-Type: application/json" -d '{"event":"alert","title":"Garage Door Open","message":"Car arrived home but garage door is still open","severity":"warning"}'`} />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
                <p className="text-xs font-medium text-[var(--text-primary)] mb-1">alert</p>
                <p className="text-xs text-[var(--text-muted)]">Creates a persistent alert visible in the Alerts page</p>
              </div>
              <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
                <p className="text-xs font-medium text-[var(--text-primary)] mb-1">note</p>
                <p className="text-xs text-[var(--text-muted)]">Logs an informational note to the server log</p>
              </div>
              <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
                <p className="text-xs font-medium text-[var(--text-primary)] mb-1">custom</p>
                <p className="text-xs text-[var(--text-muted)]">Any other event type — acknowledged and logged</p>
              </div>
            </div>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Fleet Telemetry */}
      <FadeIn delay={0.19}>
        <FleetTelemetrySection />
      </FadeIn>

      {/* User Management */}
      <FadeIn delay={0.2}>
        <UserManagementSection />
      </FadeIn>

      {/* Privacy Controls */}
      <FadeIn delay={0.21}>
        <PrivacySection />
      </FadeIn>

      {/* Backup */}
      <FadeIn delay={0.215}>
        <BackupSection />
      </FadeIn>

      {/* System Info */}
      <FadeIn delay={0.22}>
        <GlassPanel className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium mb-1">TeslaSync</p>
              <p className="text-sm text-[var(--text-secondary)]">v2.0.0 &middot; Next-Gen Tesla Intelligence Platform</p>
            </div>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neon-cyan/5 text-neon-cyan/40">
              <Globe className="h-4 w-4" />
            </div>
          </div>
        </GlassPanel>
      </FadeIn>
    </div>
  )
}
