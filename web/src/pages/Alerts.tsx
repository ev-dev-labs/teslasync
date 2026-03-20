import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getAlerts, markAlertRead, getAlertRules, updateAlertRule, Alert, AlertRule } from '../api'
import { PageHeader, GlassPanel, FadeIn, StaggerContainer, StaggerItem, TabNav, Skeleton, EmptyState } from '../components/ui'
import { RadialGauge, AnimatedNumber } from '../components/Widgets'
import {
  Bell, BellOff, AlertTriangle, Info, AlertCircle, AlertOctagon, MapPin, Battery,
  Zap, Shield, Gauge, Thermometer, Eye, Filter, Settings, CheckCircle, Clock, Pencil,
  Search, VolumeX, Lock
} from 'lucide-react'
import { useState, useMemo, useCallback } from 'react'
import { useToast } from '../components/Toast'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import clsx from 'clsx'

const severityConfig = {
  info: { icon: Info, color: 'text-neon-cyan', bg: 'bg-neon-cyan/10', border: 'border-neon-cyan/20', dot: 'bg-neon-cyan', hex: '#00f0ff' },
  warning: { icon: AlertTriangle, color: 'text-neon-amber', bg: 'bg-neon-amber/10', border: 'border-neon-amber/20', dot: 'bg-neon-amber', hex: '#f59e0b' },
  critical: { icon: AlertOctagon, color: 'text-neon-red', bg: 'bg-neon-red/10', border: 'border-neon-red/20', dot: 'bg-neon-red', hex: '#ef4444' },
}

const typeIcons: Record<string, React.ElementType> = {
  geofence_exit: MapPin,
  geofence_enter: MapPin,
  low_battery: Battery,
  charging_complete: Zap,
  sentry_event: Shield,
  speed_limit: Gauge,
  temperature: Thermometer,
  software_update: Settings,
  vehicle_unlocked: Lock,
  tire_pressure_low: AlertCircle,
}

const allAlertTypes = [
  'low_battery', 'charging_complete', 'geofence_enter', 'geofence_exit',
  'sentry_event', 'speed_limit', 'temperature', 'software_update',
  'vehicle_unlocked', 'tire_pressure_low',
] as const

// --- Muted alerts helpers ---
const MUTED_STORAGE_KEY = 'teslasync-muted-alerts'

interface MutedAlerts {
  [vehicleId_alertType: string]: number // expiresAt timestamp
}

function getMutedAlerts(): MutedAlerts {
  try {
    const raw = localStorage.getItem(MUTED_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as MutedAlerts
    const now = Date.now()
    const cleaned: MutedAlerts = {}
    for (const [key, expiresAt] of Object.entries(parsed)) {
      if (expiresAt > now) cleaned[key] = expiresAt
    }
    return cleaned
  } catch {
    return {}
  }
}

function setMutedAlerts(muted: MutedAlerts): void {
  localStorage.setItem(MUTED_STORAGE_KEY, JSON.stringify(muted))
}

function muteAlertKey(vehicleId: number, alertType: string): string {
  return `${vehicleId}_${alertType}`
}

function isAlertMuted(alert: Alert, muted: MutedAlerts): boolean {
  const key = muteAlertKey(alert.vehicle_id, alert.type)
  const expiresAt = muted[key]
  return expiresAt !== undefined && expiresAt > Date.now()
}

interface TooltipPayload { name: string; value: number; color?: string; fill?: string }
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayload[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-panel p-3 text-xs" style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)' }}>
      <p style={{ color: 'var(--text-secondary)' }} className="mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: 'var(--text-primary)' }}>
          <span style={{ color: p.color || p.fill }}>●</span> {p.name}: {p.value}
        </p>
      ))}
    </div>
  )
}

function AlertCard({ alert, onMarkRead, onMute, isMuted }: { alert: Alert; onMarkRead: () => void; onMute: () => void; isMuted: boolean }) {
  const sev = severityConfig[alert.severity]
  const TypeIcon = typeIcons[alert.type] || Bell
  const SevIcon = sev.icon

  return (
    <div className={clsx(
      'glass-panel p-4 flex items-start gap-4 transition-all duration-200 group',
      isMuted && 'opacity-50',
      !alert.read && !isMuted && `${sev.border} ${sev.bg.replace('/10', '/5')}`
    )}>
      {/* Timeline connector dot */}
      <div className="flex flex-col items-center gap-1 shrink-0">
        <div className={clsx('rounded-xl p-2.5 ring-1', sev.bg, sev.border)}>
          <TypeIcon className={clsx('h-4 w-4', sev.color)} />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className={clsx('text-sm font-medium flex items-center gap-1.5', alert.read ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]')}>
              <SevIcon className={clsx('h-3.5 w-3.5 shrink-0', sev.color)} />
              {alert.title}
              {isMuted && <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/10 text-[var(--text-muted)] font-semibold ml-1">muted</span>}
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5 line-clamp-2">{alert.message}</p>
          </div>
          {!alert.read && (
            <span className={clsx('h-2 w-2 rounded-full shrink-0 mt-1.5 animate-pulse', sev.dot)} />
          )}
        </div>
        <div className="flex items-center gap-3 mt-2">
          <span className="text-[10px] text-gray-600 flex items-center gap-1" title={new Date(alert.created_at).toLocaleString()}>
            <Clock className="h-2.5 w-2.5" />{getTimeAgo(alert.created_at)}
          </span>
          <span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full font-medium', sev.bg, sev.color)}>
            {alert.severity}
          </span>
          <span className="text-[10px] text-gray-600">{alert.type.replace(/_/g, ' ')}</span>
          <button onClick={onMute} className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-neon-amber transition-colors opacity-0 group-hover:opacity-100" title={isMuted ? 'Unmute this alert type' : 'Mute this alert type for 24h'}>
            <VolumeX className="h-3 w-3" /> {isMuted ? 'Unmute' : 'Mute 24h'}
          </button>
          {!alert.read && (
            <button onClick={onMarkRead} className="ml-auto flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-neon-cyan transition-colors opacity-0 group-hover:opacity-100">
              <Eye className="h-3 w-3" /> Mark read
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const ruleDescriptions: Record<string, { label: string; description: string; thresholdLabel: string; thresholdUnit: string; thresholdHint: string }> = {
  low_battery: {
    label: 'Low Battery',
    description: 'Alert when battery level drops below a set threshold',
    thresholdLabel: 'Alert when battery drops below',
    thresholdUnit: '%',
    thresholdHint: 'e.g. 20',
  },
  charging_complete: {
    label: 'Charging Complete',
    description: 'Alert when a charging session finishes',
    thresholdLabel: 'Alert when charge reaches',
    thresholdUnit: '%',
    thresholdHint: 'e.g. 90 (0 = any)',
  },
  geofence_exit: {
    label: 'Geofence Exit',
    description: 'Alert when the vehicle leaves a geofence zone',
    thresholdLabel: '',
    thresholdUnit: '',
    thresholdHint: '',
  },
  geofence_enter: {
    label: 'Geofence Enter',
    description: 'Alert when the vehicle enters a geofence zone',
    thresholdLabel: '',
    thresholdUnit: '',
    thresholdHint: '',
  },
  sentry_event: {
    label: 'Sentry Mode Event',
    description: 'Alert when sentry mode detects an event',
    thresholdLabel: '',
    thresholdUnit: '',
    thresholdHint: '',
  },
  speed_limit: {
    label: 'Speed Limit',
    description: 'Alert when vehicle exceeds the speed threshold',
    thresholdLabel: 'Alert when speed exceeds',
    thresholdUnit: 'km/h',
    thresholdHint: 'e.g. 130',
  },
  temperature: {
    label: 'Temperature Alert',
    description: 'Alert when cabin temperature exceeds the threshold',
    thresholdLabel: 'Alert when temperature exceeds',
    thresholdUnit: '°C',
    thresholdHint: 'e.g. 40',
  },
  software_update: {
    label: 'Software Update',
    description: 'Alert when a new software update is available',
    thresholdLabel: '',
    thresholdUnit: '',
    thresholdHint: '',
  },
}

function getRuleDescription(type: string) {
  return ruleDescriptions[type] ?? {
    label: type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    description: 'Custom alert rule',
    thresholdLabel: 'Threshold',
    thresholdUnit: '',
    thresholdHint: '',
  }
}

function RuleCard({ rule, lastTriggered, onUpdate }: {
  rule: AlertRule
  lastTriggered?: string
  onUpdate: (changes: { enabled?: boolean; threshold?: number }) => void
}) {
  const Icon = typeIcons[rule.type] || Bell
  const desc = getRuleDescription(rule.type)
  const hasThreshold = !!desc.thresholdLabel
  const [editingThreshold, setEditingThreshold] = useState(false)
  const [thresholdValue, setThresholdValue] = useState(String(rule.threshold))

  const handleThresholdSave = () => {
    const val = parseFloat(thresholdValue)
    if (!isNaN(val) && val !== rule.threshold) {
      onUpdate({ threshold: val })
    }
    setEditingThreshold(false)
  }

  return (
    <GlassPanel
      className={clsx(
        'p-5 transition-all duration-300',
        rule.enabled ? 'ring-1 ring-neon-cyan/15' : 'opacity-60'
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className={clsx(
            'rounded-xl p-2.5 ring-1 transition-colors',
            rule.enabled
              ? 'bg-neon-cyan/10 text-neon-cyan ring-neon-cyan/20'
              : 'bg-white/5 text-[var(--text-muted)] ring-white/10'
          )}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className={clsx('text-sm font-semibold', rule.enabled ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]')}>
              {rule.name || desc.label}
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">{desc.description}</p>
          </div>
        </div>
        <button
          onClick={() => onUpdate({ enabled: !rule.enabled })}
          className={clsx(
            'relative h-7 w-12 rounded-full transition-colors duration-200 shrink-0',
            rule.enabled ? 'bg-neon-cyan/30' : 'bg-white/10'
          )}
          aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'}
        >
          <span className={clsx(
            'absolute top-0.5 h-6 w-6 rounded-full transition-all duration-200',
            rule.enabled
              ? 'left-[22px] bg-neon-cyan shadow-[0_0_10px_rgba(0,240,255,0.5)]'
              : 'left-0.5 bg-gray-500'
          )} />
        </button>
      </div>

      {/* Threshold editor */}
      {hasThreshold && (
        <div className="mt-3 pt-3 border-t border-white/[0.06]">
          <label className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-medium">
            {desc.thresholdLabel}
          </label>
          <div className="flex items-center gap-2 mt-1.5">
            {editingThreshold ? (
              <>
                <input
                  type="number"
                  value={thresholdValue}
                  onChange={e => setThresholdValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleThresholdSave(); if (e.key === 'Escape') setEditingThreshold(false) }}
                  autoFocus
                  placeholder={desc.thresholdHint}
                  className="w-20 rounded-lg border px-3 py-1.5 text-sm outline-none transition-colors focus:border-neon-cyan/50"
                  style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)', color: 'var(--text-primary)' }}
                />
                <span className="text-xs text-[var(--text-secondary)]">{desc.thresholdUnit}</span>
                <button
                  onClick={handleThresholdSave}
                  className="rounded-lg px-2 py-1 text-xs font-medium bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/20 transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={() => { setEditingThreshold(false); setThresholdValue(String(rule.threshold)) }}
                  className="rounded-lg px-2 py-1 text-xs text-[var(--text-muted)] hover:text-gray-300 transition-colors"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => { setThresholdValue(String(rule.threshold)); setEditingThreshold(true) }}
                className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-3 py-1.5 text-sm font-mono hover:bg-white/[0.08] transition-colors group"
              >
                <span className={clsx(rule.threshold > 0 ? 'text-neon-cyan' : 'text-[var(--text-muted)]')}>
                  {rule.threshold > 0 ? rule.threshold : '—'}
                </span>
                <span className="text-xs text-[var(--text-muted)]">{desc.thresholdUnit}</span>
                <Pencil className="h-3 w-3 text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Status footer */}
      <div className="flex items-center gap-3 mt-3 pt-3 border-t border-white/[0.06]">
        <span className={clsx(
          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
          rule.enabled
            ? 'bg-neon-green/10 text-neon-green'
            : 'bg-white/5 text-[var(--text-muted)]'
        )}>
          <span className={clsx('h-1.5 w-1.5 rounded-full', rule.enabled ? 'bg-neon-green animate-pulse' : 'bg-gray-600')} />
          {rule.enabled ? 'Active' : 'Inactive'}
        </span>
        {lastTriggered && (
          <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
            <Clock className="h-2.5 w-2.5" />
            Last triggered {getTimeAgo(lastTriggered)}
          </span>
        )}
        {rule.updated_at && (
          <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] ml-auto">
            Updated {getTimeAgo(rule.updated_at)}
          </span>
        )}
      </div>
    </GlassPanel>
  )
}

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function Alerts() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [tab, setTab] = useState<'alerts' | 'rules'>('alerts')
  const [filter, setFilter] = useState<'all' | 'unread' | 'critical'>('all')
  const [searchText, setSearchText] = useState('')
  const [severityFilter, setSeverityFilter] = useState<'all' | 'info' | 'warning' | 'critical'>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [mutedAlerts, setMutedAlertsState] = useState<MutedAlerts>(() => getMutedAlerts())

  const { data: alerts, isLoading: alertsLoading } = useQuery({
    queryKey: ['alerts'],
    queryFn: () => getAlerts(100),
    refetchInterval: 30_000,
  })

  const { data: rules, isLoading: rulesLoading } = useQuery({
    queryKey: ['alert-rules'],
    queryFn: getAlertRules,
  })

  const markReadMut = useMutation({
    mutationFn: markAlertRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      toast.info('Alert marked as read')
    },
  })

  const updateRuleMut = useMutation({
    mutationFn: ({ id, ...changes }: { id: number; enabled?: boolean; threshold?: number }) => updateAlertRule(id, changes),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] })
      if (variables.enabled !== undefined) {
        toast.success(`Alert rule ${variables.enabled ? 'enabled' : 'disabled'}`)
      } else if (variables.threshold !== undefined) {
        toast.success(`Threshold updated to ${variables.threshold}`)
      }
    },
  })

  const handleMuteToggle = useCallback((alert: Alert) => {
    const key = muteAlertKey(alert.vehicle_id, alert.type)
    const updated = { ...mutedAlerts }
    if (isAlertMuted(alert, updated)) {
      delete updated[key]
      toast.info(`Unmuted ${alert.type.replace(/_/g, ' ')} alerts`)
    } else {
      updated[key] = Date.now() + 24 * 60 * 60 * 1000
      toast.info(`Muted ${alert.type.replace(/_/g, ' ')} alerts for 24h`)
    }
    setMutedAlerts(updated)
    setMutedAlertsState(updated)
  }, [mutedAlerts, toast])

  const activeMuteCount = useMemo(() => {
    const now = Date.now()
    return Object.values(mutedAlerts).filter(exp => exp > now).length
  }, [mutedAlerts])

  const filteredAlerts = useMemo(() => {
    let list = alerts ?? []
    // Quick filter tabs
    if (filter === 'unread') list = list.filter(a => !a.read)
    if (filter === 'critical') list = list.filter(a => a.severity === 'critical')
    // Severity dropdown
    if (severityFilter !== 'all') list = list.filter(a => a.severity === severityFilter)
    // Type dropdown
    if (typeFilter !== 'all') list = list.filter(a => a.type === typeFilter)
    // Text search
    if (searchText.trim()) {
      const q = searchText.toLowerCase()
      list = list.filter(a => a.title.toLowerCase().includes(q) || a.message.toLowerCase().includes(q))
    }
    // Filter out muted alerts
    list = list.filter(a => !isAlertMuted(a, mutedAlerts))
    return list
  }, [alerts, filter, severityFilter, typeFilter, searchText, mutedAlerts])

  const unreadCount = alerts?.filter(a => !a.read).length ?? 0
  const criticalCount = alerts?.filter(a => a.severity === 'critical' && !a.read).length ?? 0
  const infoCount = alerts?.filter(a => a.severity === 'info').length ?? 0
  const warningCount = alerts?.filter(a => a.severity === 'warning').length ?? 0
  const readCount = alerts?.filter(a => a.read).length ?? 0
  const totalCount = alerts?.length ?? 0

  // Alerts by type for pie chart
  const alertsByType = useMemo(() => {
    if (!alerts?.length) return []
    const counts: Record<string, number> = {}
    alerts.forEach(a => { counts[a.type] = (counts[a.type] || 0) + 1 })
    const colors = ['#00f0ff', '#10b981', '#a855f7', '#f59e0b', '#ef4444', '#4f46e5']
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count], i) => ({
        name: type.replace(/_/g, ' '),
        value: count,
        fill: colors[i % colors.length],
      }))
  }, [alerts])

  // Alerts by day for bar chart (last 7 days)
  const alertsByDay = useMemo(() => {
    if (!alerts?.length) return []
    const days: Record<string, { info: number; warning: number; critical: number }> = {}
    const now = Date.now()
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 86400000)
      const key = d.toLocaleDateString(undefined, { weekday: 'short' })
      days[key] = { info: 0, warning: 0, critical: 0 }
    }
    alerts.forEach(a => {
      const d = new Date(a.created_at)
      if (now - d.getTime() > 7 * 86400000) return
      const key = d.toLocaleDateString(undefined, { weekday: 'short' })
      if (days[key]) days[key][a.severity]++
    })
    return Object.entries(days).map(([day, v]) => ({ day, ...v }))
  }, [alerts])

  // Compute last triggered time per rule type from alert history
  const lastTriggeredByType = useMemo(() => {
    const map: Record<string, string> = {}
    if (!alerts?.length) return map
    alerts.forEach(a => {
      if (!map[a.type] || new Date(a.created_at) > new Date(map[a.type])) {
        map[a.type] = a.created_at
      }
    })
    return map
  }, [alerts])

  const enabledRules = rules?.filter(r => r.enabled).length ?? 0

  return (
    <div className="space-y-8">
      <PageHeader
        title="Alerts & Notifications"
        subtitle="Monitor events, configure alert rules, and stay informed"
        actions={
          <div className="flex items-center gap-3">
            {activeMuteCount > 0 && (
              <span className="flex items-center gap-1.5 rounded-full bg-neon-amber/10 px-3 py-1 text-xs font-medium text-neon-amber">
                <VolumeX className="h-3 w-3" />
                {activeMuteCount} muted
              </span>
            )}
            {unreadCount > 0 && (
              <span className="flex items-center gap-1.5 rounded-full bg-neon-cyan/10 px-3 py-1 text-xs font-medium text-neon-cyan">
                <span className="h-1.5 w-1.5 rounded-full bg-neon-cyan animate-pulse" />
                {unreadCount} unread
              </span>
            )}
            {criticalCount > 0 && (
              <span className="flex items-center gap-1.5 rounded-full bg-neon-red/10 px-3 py-1 text-xs font-medium text-neon-red">
                <AlertOctagon className="h-3 w-3" />
                {criticalCount} critical
              </span>
            )}
          </div>
        }
      />

      {/* Summary gauges */}
      <FadeIn>
        <GlassPanel className="p-4 sm:p-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 items-center">
            <RadialGauge value={totalCount} max={Math.max(totalCount, 20)} label="Total" unit="" color="#00f0ff" />
            <RadialGauge value={unreadCount} max={Math.max(totalCount, 1)} label="Unread" unit="" color="#f59e0b" />
            <RadialGauge value={criticalCount} max={Math.max(totalCount, 1)} label="Critical" unit="" color="#ef4444" />
            <div className="flex flex-col items-center text-center">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-neon-cyan" />
                <span className="text-lg font-bold text-neon-cyan"><AnimatedNumber value={infoCount} /></span>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-1">Info</p>
            </div>
            <div className="flex flex-col items-center text-center">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-neon-amber" />
                <span className="text-lg font-bold text-neon-amber"><AnimatedNumber value={warningCount} /></span>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-1">Warnings</p>
            </div>
            <div className="flex flex-col items-center text-center">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-neon-green" />
                <span className="text-lg font-bold text-neon-green"><AnimatedNumber value={readCount} /></span>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-1">Resolved</p>
            </div>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Quick metrics */}
      <FadeIn delay={0.05}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Active Rules', value: `${enabledRules}/${rules?.length ?? 0}`, color: 'text-neon-cyan' },
            { label: 'Read Rate', value: totalCount > 0 ? `${Math.round((readCount / totalCount) * 100)}%` : '—', color: 'text-neon-green' },
            { label: 'Most Common', value: alertsByType[0]?.name ?? '—', color: 'text-neon-purple' },
            { label: 'Last 7 Days', value: `${alertsByDay.reduce((s, d) => s + d.info + d.warning + d.critical, 0)}`, color: 'text-neon-amber' },
          ].map(m => (
            <div key={m.label} className="glass-panel p-3 text-center">
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">{m.label}</p>
              <p className={`text-sm font-bold ${m.color}`}>{m.value}</p>
            </div>
          ))}
        </div>
      </FadeIn>

      {/* Charts: severity trend + type breakdown */}
      {totalCount > 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <FadeIn delay={0.1}>
            <GlassPanel className="p-4 sm:p-6">
              <h3 className="section-title mb-4 flex items-center gap-2">
                <Bell className="h-4 w-4 text-neon-cyan" /> Alert Trend (7 Days)
              </h3>
              <div className="h-40 sm:h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={alertsByDay}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="day" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="critical" name="Critical" stackId="a" fill="#ef4444" fillOpacity={0.7} radius={[0, 0, 0, 0]} />
                    <Bar dataKey="warning" name="Warning" stackId="a" fill="#f59e0b" fillOpacity={0.6} />
                    <Bar dataKey="info" name="Info" stackId="a" fill="#00f0ff" fillOpacity={0.5} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </GlassPanel>
          </FadeIn>

          <FadeIn delay={0.15}>
            <GlassPanel className="p-4 sm:p-6">
              <h3 className="section-title mb-4 flex items-center gap-2">
                <Filter className="h-4 w-4 text-neon-purple" /> Alerts by Type
              </h3>
              <div className="h-40 sm:h-48 flex flex-col sm:flex-row items-center">
                <ResponsiveContainer width="60%" height="100%">
                  <PieChart>
                    <Pie data={alertsByType} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={2} dataKey="value">
                      {alertsByType.map((entry, i) => <Cell key={i} fill={entry.fill} stroke="transparent" />)}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-1.5">
                  {alertsByType.map((d, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: d.fill }} />
                      <span className="text-[var(--text-secondary)] truncate">{d.name}</span>
                      <span className="ml-auto text-[var(--text-primary)] font-mono">{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </GlassPanel>
          </FadeIn>
        </div>
      )}

      <FadeIn delay={0.2}>
        <TabNav
          tabs={[
            { key: 'alerts', label: 'Alerts', icon: <Bell className="h-4 w-4" /> },
            { key: 'rules', label: 'Alert Rules', icon: <Settings className="h-4 w-4" /> },
          ]}
          active={tab}
          onChange={k => setTab(k as 'alerts' | 'rules')}
        />
      </FadeIn>

      {tab === 'alerts' && (
        <>
          <FadeIn delay={0.05}>
            <div className="space-y-3">
              {/* Search and filter bar */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
                  <input
                    type="text"
                    value={searchText}
                    onChange={e => setSearchText(e.target.value)}
                    placeholder="Search alerts..."
                    className="w-full rounded-lg border pl-9 pr-3 py-2 text-sm outline-none transition-colors focus:border-neon-cyan/50"
                    style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)', color: 'var(--text-primary)' }}
                  />
                </div>
                <select
                  value={severityFilter}
                  onChange={e => setSeverityFilter(e.target.value as 'all' | 'info' | 'warning' | 'critical')}
                  className="rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-neon-cyan/50"
                  style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)', color: 'var(--text-primary)' }}
                >
                  <option value="all">All Severities</option>
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="critical">Critical</option>
                </select>
                <select
                  value={typeFilter}
                  onChange={e => setTypeFilter(e.target.value)}
                  className="rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-neon-cyan/50"
                  style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)', color: 'var(--text-primary)' }}
                >
                  <option value="all">All Types</option>
                  {allAlertTypes.map(t => (
                    <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              {/* Quick filter tabs */}
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-[var(--text-muted)]" />
                <TabNav
                  tabs={[
                    { key: 'all', label: `All (${totalCount})` },
                    { key: 'unread', label: `Unread (${unreadCount})` },
                    { key: 'critical', label: `Critical (${criticalCount})` },
                  ]}
                  active={filter}
                  onChange={k => setFilter(k as 'all' | 'unread' | 'critical')}
                />
              </div>
            </div>
          </FadeIn>

          {alertsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-20" />)}
            </div>
          ) : filteredAlerts.length > 0 ? (
            <StaggerContainer className="space-y-2">
              {filteredAlerts.map(a => (
                <StaggerItem key={a.id}>
                  <AlertCard
                    alert={a}
                    onMarkRead={() => markReadMut.mutate(a.id)}
                    onMute={() => handleMuteToggle(a)}
                    isMuted={isAlertMuted(a, mutedAlerts)}
                  />
                </StaggerItem>
              ))}
            </StaggerContainer>
          ) : (
            <EmptyState
              icon={<BellOff className="h-8 w-8" />}
              title="No alerts"
              description={filter === 'all' ? 'Your fleet is running smoothly. Alerts will appear here.' : `No ${filter} alerts right now.`}
            />
          )}
        </>
      )}

      {tab === 'rules' && (
        <>
          {rulesLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-48" />)}
            </div>
          ) : rules && rules.length > 0 ? (
            <StaggerContainer className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {rules.map(r => (
                <StaggerItem key={r.id}>
                  <RuleCard
                    rule={r}
                    lastTriggered={lastTriggeredByType[r.type]}
                    onUpdate={changes => updateRuleMut.mutate({ id: r.id, ...changes })}
                  />
                </StaggerItem>
              ))}
            </StaggerContainer>
          ) : (
            <EmptyState
              icon={<Settings className="h-8 w-8" />}
              title="No alert rules configured"
              description="Alert rules will be available once your fleet is set up."
            />
          )}
        </>
      )}
    </div>
  )
}
