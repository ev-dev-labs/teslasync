import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getAlerts, markAlertRead, getAlertRules, updateAlertRule, createAlertRule, deleteAlertRule,
  getNotificationChannels, getNotificationLogs, getNotificationStats, getVehicles,
  Alert, AlertRule, NotificationChannel, Vehicle,
} from '../api'
import { PageHeader, GlassPanel, FadeIn, StaggerContainer, StaggerItem, TabNav, Skeleton, EmptyState, Pagination } from '../components/ui'
import { RadialGauge, AnimatedNumber } from '../components/Widgets'
import {
  Bell, BellOff, AlertTriangle, Info, AlertCircle, MapPin, Battery,
  Zap, Shield, Gauge, Thermometer, Eye, Filter, Settings, CheckCircle, Clock, Pencil,
  Plus, Settings2, BarChart3, PieChart as PieChartIcon, X, Trash2, Moon, Send, TrendingDown,
  Car, Lock, Droplets,
} from 'lucide-react'
import { useState, useMemo, useCallback } from 'react'
import { useToast } from '../components/Toast'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import clsx from 'clsx'

// ─── Severity config ─────────────────────────────────────────────────────────

const severityConfig = {
  info: { icon: Info, color: 'text-neon-cyan', bg: 'bg-neon-cyan/10', border: 'border-neon-cyan/20', dot: 'bg-neon-cyan', hex: '#00f0ff' },
  warning: { icon: AlertTriangle, color: 'text-neon-amber', bg: 'bg-neon-amber/10', border: 'border-neon-amber/20', dot: 'bg-neon-amber', hex: '#f59e0b' },
  critical: { icon: AlertCircle, color: 'text-neon-red', bg: 'bg-neon-red/10', border: 'border-neon-red/20', dot: 'bg-neon-red', hex: '#ef4444' },
}

// ─── Alert type → icon mapping (expanded) ────────────────────────────────────

const typeIcons: Record<string, React.ElementType> = {
  geofence_exit: MapPin,
  geofence_enter: MapPin,
  low_battery: Battery,
  battery_low: Battery,
  battery_high: Battery,
  charging_complete: Zap,
  charging_cost: Zap,
  sentry_event: Shield,
  speed_limit: Gauge,
  temperature: Thermometer,
  software_update: Settings,
  vampire_drain: TrendingDown,
  tire_pressure_low: Droplets,
  idle_unlocked: Lock,
  efficiency_drop: BarChart3,
}

// ─── Rule type definitions (expanded) ────────────────────────────────────────

const allRuleTypes = [
  'battery_low', 'battery_high', 'geofence_enter', 'geofence_exit',
  'charging_complete', 'charging_cost', 'speed_limit', 'vampire_drain',
  'tire_pressure_low', 'idle_unlocked', 'software_update', 'efficiency_drop',
] as const
type RuleType = typeof allRuleTypes[number]

const ruleDescriptions: Record<string, { label: string; description: string; thresholdLabel: string; thresholdUnit: string; thresholdHint: string }> = {
  battery_low: {
    label: 'Battery Low',
    description: 'Battery drops below threshold',
    thresholdLabel: 'Battery %',
    thresholdUnit: '%',
    thresholdHint: 'e.g. 20',
  },
  battery_high: {
    label: 'Battery High',
    description: 'Battery exceeds threshold (overcharge protection)',
    thresholdLabel: 'Battery %',
    thresholdUnit: '%',
    thresholdHint: 'e.g. 90',
  },
  low_battery: {
    label: 'Low Battery',
    description: 'Alert when battery level drops below a set threshold',
    thresholdLabel: 'Alert when battery drops below',
    thresholdUnit: '%',
    thresholdHint: 'e.g. 20',
  },
  charging_complete: {
    label: 'Charging Complete',
    description: 'Charging session finishes',
    thresholdLabel: 'Alert when charge reaches',
    thresholdUnit: '%',
    thresholdHint: 'e.g. 90 (0 = any)',
  },
  charging_cost: {
    label: 'Charging Cost',
    description: 'Single charge cost exceeds amount',
    thresholdLabel: 'Cost $',
    thresholdUnit: '$',
    thresholdHint: 'e.g. 25',
  },
  geofence_exit: {
    label: 'Geofence Exit',
    description: 'Vehicle exits a geofence zone',
    thresholdLabel: '',
    thresholdUnit: '',
    thresholdHint: '',
  },
  geofence_enter: {
    label: 'Geofence Enter',
    description: 'Vehicle enters a geofence zone',
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
    description: 'Speed exceeds threshold',
    thresholdLabel: 'Speed km/h',
    thresholdUnit: 'km/h',
    thresholdHint: 'e.g. 130',
  },
  vampire_drain: {
    label: 'Vampire Drain',
    description: 'Drain rate exceeds threshold',
    thresholdLabel: 'Wh/km',
    thresholdUnit: 'Wh/km',
    thresholdHint: 'e.g. 5',
  },
  tire_pressure_low: {
    label: 'Tire Pressure Low',
    description: 'Any tire drops below PSI threshold',
    thresholdLabel: 'PSI',
    thresholdUnit: 'PSI',
    thresholdHint: 'e.g. 38',
  },
  idle_unlocked: {
    label: 'Idle Unlocked',
    description: 'Vehicle parked and unlocked for X minutes',
    thresholdLabel: 'Minutes',
    thresholdUnit: 'min',
    thresholdHint: 'e.g. 10',
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
    description: 'New software update available',
    thresholdLabel: '',
    thresholdUnit: '',
    thresholdHint: '',
  },
  efficiency_drop: {
    label: 'Efficiency Drop',
    description: 'Efficiency worse than threshold',
    thresholdLabel: 'Wh/km',
    thresholdUnit: 'Wh/km',
    thresholdHint: 'e.g. 180',
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

// ─── Tooltip for recharts ────────────────────────────────────────────────────

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

// ─── Time helper ─────────────────────────────────────────────────────────────

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// ─── Quiet Hours helpers ─────────────────────────────────────────────────────

interface QuietHours { start: string; end: string; enabled: boolean }

function loadQuietHours(): QuietHours {
  try {
    const raw = localStorage.getItem('teslasync-quiet-hours')
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { start: '22:00', end: '07:00', enabled: false }
}

function isQuietHoursActive(qh: QuietHours): boolean {
  if (!qh.enabled) return false
  const now = new Date()
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  if (qh.start <= qh.end) return hhmm >= qh.start && hhmm < qh.end
  return hhmm >= qh.start || hhmm < qh.end
}

// ─── Digest mode ─────────────────────────────────────────────────────────────

type DigestMode = 'instant' | 'hourly' | 'daily'

function loadDigestMode(): DigestMode {
  const v = localStorage.getItem('teslasync-alert-digest')
  if (v === 'hourly' || v === 'daily') return v
  return 'instant'
}

// ─── Per-type toggles ────────────────────────────────────────────────────────

function loadTypeToggles(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem('teslasync-alert-types-enabled')
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return {}
}

// ─── AlertCard ───────────────────────────────────────────────────────────────

function AlertCard({ alert, onMarkRead }: { alert: Alert; onMarkRead: () => void }) {
  const sev = severityConfig[alert.severity]
  const Icon = typeIcons[alert.type] || Bell
  const timeAgo = getTimeAgo(alert.created_at)

  return (
    <div className={clsx(
      'glass-panel p-4 flex items-start gap-4 transition-all duration-200 group',
      !alert.read && `${sev.border} ${sev.bg.replace('/10', '/5')}`
    )}>
      <div className="flex flex-col items-center gap-1 shrink-0">
        <div className={clsx('rounded-xl p-2.5 ring-1', sev.bg, sev.border)}>
          <Icon className={clsx('h-4 w-4', sev.color)} />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className={clsx('text-sm font-medium', alert.read ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]')}>
              {alert.title}
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5 line-clamp-2">{alert.message}</p>
          </div>
          {!alert.read && (
            <span className={clsx('h-2 w-2 rounded-full shrink-0 mt-1.5 animate-pulse', sev.dot)} />
          )}
        </div>
        <div className="flex items-center gap-3 mt-2">
          <span className="text-[10px] text-gray-600 flex items-center gap-1"><Clock className="h-2.5 w-2.5" />{timeAgo}</span>
          <span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full font-medium', sev.bg, sev.color)}>
            {alert.severity}
          </span>
          <span className="text-[10px] text-gray-600">{alert.type.replace(/_/g, ' ')}</span>
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

// ─── RuleCard (existing rules) ───────────────────────────────────────────────

function RuleCard({ rule, lastTriggered, onUpdate, onDelete }: {
  rule: AlertRule
  lastTriggered?: string
  onUpdate: (changes: { enabled?: boolean; threshold?: number }) => void
  onDelete: () => void
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
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onDelete}
            className="rounded-lg p-1.5 text-[var(--text-muted)] hover:text-neon-red hover:bg-neon-red/10 transition-colors"
            aria-label="Delete rule"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onUpdate({ enabled: !rule.enabled })}
            className={clsx(
              'relative h-7 w-12 rounded-full transition-colors duration-200',
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
      </div>

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
        {rule.vehicle_id != null && (
          <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
            <Car className="h-2.5 w-2.5" />
            Vehicle #{rule.vehicle_id}
          </span>
        )}
        {rule.updated_at && (
          <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
            Updated {getTimeAgo(rule.updated_at)}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <button
            onClick={() => onUpdate({ enabled: !rule.enabled })}
            className={clsx('px-2 py-1 rounded text-[10px] font-medium transition-all',
              rule.enabled ? 'bg-neon-amber/10 text-neon-amber hover:bg-neon-amber/20' : 'bg-neon-green/10 text-neon-green hover:bg-neon-green/20'
            )}
          >
            {rule.enabled ? 'Disable' : 'Enable'}
          </button>
          <button
            onClick={() => { setThresholdValue(String(rule.threshold)); setEditingThreshold(true) }}
            className="px-2 py-1 rounded text-[10px] font-medium bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/20 transition-all flex items-center gap-1"
          >
            <Pencil className="h-2.5 w-2.5" /> Edit
          </button>
          <button
            onClick={onDelete}
            className="px-2 py-1 rounded text-[10px] font-medium bg-neon-red/10 text-neon-red hover:bg-neon-red/20 transition-all"
          >
            Delete
          </button>
        </span>
      </div>
    </GlassPanel>
  )
}

// ─── Create Alert Rule Modal ─────────────────────────────────────────────────

interface CreateRuleForm {
  name: string
  type: RuleType
  threshold: string
  vehicle_id: string
  severity: 'info' | 'warning' | 'critical'
  enabled: boolean
  notify_push: boolean
  notify_mqtt: boolean
  channelIds: number[]
}

const emptyForm: CreateRuleForm = {
  name: '', type: 'battery_low', threshold: '', vehicle_id: 'all',
  severity: 'warning', enabled: true, notify_push: true, notify_mqtt: false, channelIds: [],
}

function CreateRuleModal({ open, onClose, vehicles, channels }: {
  open: boolean
  onClose: () => void
  vehicles: Vehicle[]
  channels: NotificationChannel[]
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [form, setForm] = useState<CreateRuleForm>({ ...emptyForm })

  const createMut = useMutation({
    mutationFn: (f: CreateRuleForm) => {
      const desc = getRuleDescription(f.type)
      return createAlertRule({
        name: f.name || desc.label,
        type: f.type,
        threshold: parseFloat(f.threshold) || 0,
        vehicle_id: f.vehicle_id === 'all' ? null : parseInt(f.vehicle_id),
        enabled: f.enabled,
        notify_push: f.notify_push,
        notify_mqtt: f.notify_mqtt,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] })
      toast.success('Alert rule created')
      setForm({ ...emptyForm })
      onClose()
    },
    onError: () => toast.error('Failed to create alert rule'),
  })

  const desc = getRuleDescription(form.type)
  const hasThreshold = !!desc.thresholdLabel

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass-panel p-6 max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Plus className="h-5 w-5 text-neon-cyan" /> Create Alert Rule
          </h3>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-white/5 transition-colors">
            <X className="h-4 w-4 text-[var(--text-muted)]" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Rule Name */}
          <div>
            <label className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-medium">Rule Name</label>
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder={desc.label}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-neon-cyan/50"
              style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)', color: 'var(--text-primary)' }}
            />
          </div>

          {/* Type */}
          <div>
            <label className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-medium">Alert Type</label>
            <select
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value as RuleType }))}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-neon-cyan/50"
              style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)', color: 'var(--text-primary)' }}
            >
              {allRuleTypes.map(t => (
                <option key={t} value={t} style={{ background: 'var(--bg)' }}>
                  {getRuleDescription(t).label} — {getRuleDescription(t).description}
                </option>
              ))}
            </select>
          </div>

          {/* Threshold */}
          {hasThreshold && (
            <div>
              <label className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-medium">
                {desc.thresholdLabel}
              </label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="number"
                  value={form.threshold}
                  onChange={e => setForm(f => ({ ...f, threshold: e.target.value }))}
                  placeholder={desc.thresholdHint}
                  className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-neon-cyan/50"
                  style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)', color: 'var(--text-primary)' }}
                />
                <span className="text-xs text-[var(--text-secondary)] shrink-0">{desc.thresholdUnit}</span>
              </div>
            </div>
          )}

          {/* Vehicle */}
          <div>
            <label className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-medium">Vehicle</label>
            <select
              value={form.vehicle_id}
              onChange={e => setForm(f => ({ ...f, vehicle_id: e.target.value }))}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-neon-cyan/50"
              style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)', color: 'var(--text-primary)' }}
            >
              <option value="all" style={{ background: 'var(--bg)' }}>All vehicles</option>
              {vehicles.map(v => (
                <option key={v.id} value={v.id} style={{ background: 'var(--bg)' }}>
                  {v.display_name} ({v.vin})
                </option>
              ))}
            </select>
          </div>

          {/* Severity */}
          <div>
            <label className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-medium">Severity</label>
            <div className="flex items-center gap-2 mt-1">
              {(['info', 'warning', 'critical'] as const).map(s => {
                const sc = severityConfig[s]
                return (
                  <button
                    key={s}
                    onClick={() => setForm(f => ({ ...f, severity: s }))}
                    className={clsx(
                      'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                      form.severity === s
                        ? `${sc.bg} ${sc.color} ring-1 ${sc.border}`
                        : 'bg-white/[0.03] text-[var(--text-muted)] hover:bg-white/[0.06]'
                    )}
                  >
                    <sc.icon className="h-3 w-3" /> {s}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Enabled */}
          <div className="flex items-center justify-between">
            <label className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-medium">Enabled</label>
            <button
              onClick={() => setForm(f => ({ ...f, enabled: !f.enabled }))}
              className={clsx(
                'relative h-7 w-12 rounded-full transition-colors duration-200',
                form.enabled ? 'bg-neon-cyan/30' : 'bg-white/10'
              )}
            >
              <span className={clsx(
                'absolute top-0.5 h-6 w-6 rounded-full transition-all duration-200',
                form.enabled ? 'left-[22px] bg-neon-cyan shadow-[0_0_10px_rgba(0,240,255,0.5)]' : 'left-0.5 bg-gray-500'
              )} />
            </button>
          </div>

          {/* Notification Channels */}
          <div>
            <label className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-medium">Notify Via</label>
            {channels.length > 0 ? (
              <div className="space-y-2 mt-1.5">
                {channels.map(ch => (
                  <label key={ch.id} className="flex items-center gap-2 text-xs cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={form.channelIds.includes(ch.id)}
                      onChange={e => {
                        setForm(f => ({
                          ...f,
                          channelIds: e.target.checked
                            ? [...f.channelIds, ch.id]
                            : f.channelIds.filter(id => id !== ch.id),
                        }))
                      }}
                      className="rounded border-gray-600 bg-white/5 text-neon-cyan focus:ring-neon-cyan/50"
                    />
                    <span className="text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">
                      {ch.name} <span className="text-[var(--text-muted)]">({ch.type})</span>
                    </span>
                    {!ch.enabled && <span className="text-[10px] text-neon-amber">(disabled)</span>}
                  </label>
                ))}
              </div>
            ) : (
              <div className="mt-1.5 rounded-lg border border-dashed border-white/10 p-3 text-center">
                <p className="text-xs text-[var(--text-muted)]">No notification channels configured.</p>
                <a href="/notifications" className="text-xs text-neon-cyan hover:underline mt-1 inline-block">+ Add a channel (Discord, Slack, Email...)</a>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 justify-end mt-6 pt-4 border-t border-white/[0.06]">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg hover:bg-white/5 transition-all">
            Cancel
          </button>
          <button
            onClick={() => createMut.mutate(form)}
            disabled={createMut.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-neon-cyan/20 text-neon-cyan ring-1 ring-neon-cyan/30 hover:bg-neon-cyan/30 transition-all disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            {createMut.isPending ? 'Creating…' : 'Create Rule'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Notification History Section ────────────────────────────────────────────

function NotificationHistory() {
  const [logPage, setLogPage] = useState(1)
  const logPageSize = 25

  const { data: logs, isLoading: logsLoading } = useQuery({
    queryKey: ['notification-logs', logPage],
    queryFn: () => getNotificationLogs(logPageSize, (logPage - 1) * logPageSize),
  })

  const { data: stats } = useQuery({
    queryKey: ['notification-stats'],
    queryFn: getNotificationStats,
  })

  const { data: channels } = useQuery({
    queryKey: ['notification-channels'],
    queryFn: getNotificationChannels,
  })

  const channelMap = useMemo(() => {
    const m: Record<number, string> = {}
    channels?.forEach(c => { m[c.id] = `${c.name} (${c.type})` })
    return m
  }, [channels])

  const totalSent = stats?.sent ?? 0
  const totalFailed = stats?.failed ?? 0
  const total = stats?.total_sent ?? (totalSent + totalFailed + (stats?.pending ?? 0))
  const successRate = total > 0 ? Math.round((totalSent / total) * 100) : 0

  const logTypeCounts = useMemo(() => {
    if (!logs?.length) return []
    const counts: Record<string, number> = {}
    logs.forEach(l => {
      const key = l.status
      counts[key] = (counts[key] || 0) + 1
    })
    const colors: Record<string, string> = { sent: '#10b981', failed: '#ef4444', pending: '#f59e0b' }
    return Object.entries(counts).map(([status, value]) => ({
      name: status, value, fill: colors[status] || '#00f0ff',
    }))
  }, [logs])

  return (
    <div className="space-y-6">
      {/* Analytics cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="glass-panel p-3 text-center">
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Total Sent</p>
          <p className="text-sm font-bold text-neon-cyan"><AnimatedNumber value={totalSent} /></p>
        </div>
        <div className="glass-panel p-3 text-center">
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Failed</p>
          <p className="text-sm font-bold text-neon-red"><AnimatedNumber value={totalFailed} /></p>
        </div>
        <div className="glass-panel p-3 text-center">
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Success Rate</p>
          <p className="text-sm font-bold text-neon-green">{successRate}%</p>
        </div>
        <div className="glass-panel p-3 text-center">
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Channels</p>
          <p className="text-sm font-bold text-neon-purple"><AnimatedNumber value={stats?.enabled_channels ?? 0} /> / <AnimatedNumber value={stats?.total_channels ?? 0} /></p>
        </div>
      </div>

      {/* Delivery status pie */}
      {logTypeCounts.length > 0 && (
        <GlassPanel className="p-4 sm:p-6">
          <h3 className="section-title mb-4 flex items-center gap-2">
            <PieChartIcon className="h-4 w-4 text-neon-purple" /> Delivery Status
          </h3>
          <div className="h-40 flex flex-col sm:flex-row items-center">
            <ResponsiveContainer width="50%" height="100%">
              <PieChart>
                <Pie data={logTypeCounts} cx="50%" cy="50%" innerRadius={35} outerRadius={60} paddingAngle={3} dataKey="value">
                  {logTypeCounts.map((entry, i) => <Cell key={i} fill={entry.fill} stroke="transparent" />)}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-2">
              {logTypeCounts.map(d => (
                <div key={d.name} className="flex items-center gap-2 text-xs">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: d.fill }} />
                  <span className="text-[var(--text-secondary)] capitalize">{d.name}</span>
                  <span className="ml-auto text-[var(--text-primary)] font-mono">{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </GlassPanel>
      )}

      {/* Log table */}
      <GlassPanel className="p-4 sm:p-6">
        <h3 className="section-title mb-4 flex items-center gap-2">
          <Send className="h-4 w-4 text-neon-cyan" /> Notification Log
        </h3>
        {logsLoading ? (
          <div className="space-y-2">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10" />)}</div>
        ) : logs && logs.length > 0 ? (
          <>
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    <th className="text-left py-2 px-3 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium">Time</th>
                    <th className="text-left py-2 px-3 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium">Title</th>
                    <th className="text-left py-2 px-3 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium">Channel</th>
                    <th className="text-left py-2 px-3 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => (
                    <tr key={log.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                      <td className="py-2 px-3 text-[var(--text-muted)] whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-[var(--text-primary)] max-w-[200px] truncate">{log.title}</td>
                      <td className="py-2 px-3 text-[var(--text-secondary)]">{channelMap[log.channel_id] || `#${log.channel_id}`}</td>
                      <td className="py-2 px-3">
                        <span className={clsx(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                          log.status === 'sent' && 'bg-neon-green/10 text-neon-green',
                          log.status === 'failed' && 'bg-neon-red/10 text-neon-red',
                          log.status === 'pending' && 'bg-neon-amber/10 text-neon-amber',
                        )}>
                          {log.status === 'sent' && <CheckCircle className="h-2.5 w-2.5" />}
                          {log.status === 'failed' && <AlertCircle className="h-2.5 w-2.5" />}
                          {log.status === 'pending' && <Clock className="h-2.5 w-2.5" />}
                          {log.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={logPage}
              pageSize={logPageSize}
              total={total}
              onPageChange={setLogPage}
            />
          </>
        ) : (
          <EmptyState
            icon={<Send className="h-8 w-8" />}
            title="No notification logs"
            description="Notification logs will appear here once alerts are sent."
          />
        )}
      </GlassPanel>
    </div>
  )
}

// ─── Preferences Section ─────────────────────────────────────────────────────

function PreferencesSection() {
  const [quietHours, setQuietHours] = useState<QuietHours>(loadQuietHours)
  const [digestMode, setDigestMode] = useState<DigestMode>(loadDigestMode)
  const [typeToggles, setTypeToggles] = useState<Record<string, boolean>>(loadTypeToggles)
  const toast = useToast()

  const saveQuietHours = useCallback((qh: QuietHours) => {
    setQuietHours(qh)
    localStorage.setItem('teslasync-quiet-hours', JSON.stringify(qh))
  }, [])

  const saveDigest = useCallback((mode: DigestMode) => {
    setDigestMode(mode)
    localStorage.setItem('teslasync-alert-digest', mode)
  }, [])

  const toggleType = useCallback((type: string) => {
    setTypeToggles(prev => {
      const next = { ...prev, [type]: !(prev[type] ?? true) }
      localStorage.setItem('teslasync-alert-types-enabled', JSON.stringify(next))
      return next
    })
  }, [])

  const quietActive = isQuietHoursActive(quietHours)

  return (
    <div className="space-y-6">
      {/* Quiet hours badge */}
      {quietActive && (
        <div className="flex items-center gap-2 rounded-xl bg-neon-purple/10 px-4 py-2 ring-1 ring-neon-purple/20">
          <Moon className="h-4 w-4 text-neon-purple" />
          <span className="text-xs font-medium text-neon-purple">
            🌙 Quiet hours active ({quietHours.start} – {quietHours.end})
          </span>
          <span className="text-[10px] text-[var(--text-muted)] ml-2">Only critical alerts send notifications</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Quiet Hours */}
        <GlassPanel className="p-5">
          <h4 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
            <Moon className="h-4 w-4 text-neon-purple" /> Quiet Hours
          </h4>
          <p className="text-xs text-[var(--text-muted)] mb-3">During quiet hours, only critical alerts send notifications.</p>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-[var(--text-secondary)]">Enable quiet hours</span>
            <button
              onClick={() => {
                saveQuietHours({ ...quietHours, enabled: !quietHours.enabled })
                toast.info(quietHours.enabled ? 'Quiet hours disabled' : 'Quiet hours enabled')
              }}
              className={clsx(
                'relative h-7 w-12 rounded-full transition-colors duration-200',
                quietHours.enabled ? 'bg-neon-purple/30' : 'bg-white/10'
              )}
            >
              <span className={clsx(
                'absolute top-0.5 h-6 w-6 rounded-full transition-all duration-200',
                quietHours.enabled ? 'left-[22px] bg-neon-purple shadow-[0_0_10px_rgba(168,85,247,0.5)]' : 'left-0.5 bg-gray-500'
              )} />
            </button>
          </div>
          {quietHours.enabled && (
            <div className="flex items-center gap-3">
              <div>
                <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Start</label>
                <input
                  type="time"
                  value={quietHours.start}
                  onChange={e => saveQuietHours({ ...quietHours, start: e.target.value })}
                  className="mt-1 block w-full rounded-lg border px-3 py-1.5 text-sm outline-none focus:border-neon-purple/50"
                  style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)', color: 'var(--text-primary)' }}
                />
              </div>
              <span className="text-[var(--text-muted)] mt-4">—</span>
              <div>
                <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">End</label>
                <input
                  type="time"
                  value={quietHours.end}
                  onChange={e => saveQuietHours({ ...quietHours, end: e.target.value })}
                  className="mt-1 block w-full rounded-lg border px-3 py-1.5 text-sm outline-none focus:border-neon-purple/50"
                  style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>
          )}
        </GlassPanel>

        {/* Alert Digest */}
        <GlassPanel className="p-5">
          <h4 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
            <Settings2 className="h-4 w-4 text-neon-amber" /> Alert Digest
          </h4>
          <p className="text-xs text-[var(--text-muted)] mb-3">Choose how non-critical alerts are delivered.</p>
          <div className="space-y-2">
            {([
              { value: 'instant' as const, label: 'Instant', desc: 'Every alert notifies immediately' },
              { value: 'hourly' as const, label: 'Hourly Digest', desc: 'Batch non-critical alerts every hour' },
              { value: 'daily' as const, label: 'Daily Digest', desc: 'Batch non-critical alerts into daily summary' },
            ]).map(opt => (
              <label
                key={opt.value}
                className={clsx(
                  'flex items-center gap-3 rounded-lg px-3 py-2 cursor-pointer transition-all',
                  digestMode === opt.value ? 'bg-neon-amber/10 ring-1 ring-neon-amber/20' : 'hover:bg-white/[0.03]'
                )}
              >
                <input
                  type="radio"
                  name="digest"
                  checked={digestMode === opt.value}
                  onChange={() => {
                    saveDigest(opt.value)
                    toast.info(`Alert digest set to ${opt.label}`)
                  }}
                  className="accent-[#f59e0b]"
                />
                <div>
                  <span className={clsx('text-xs font-medium', digestMode === opt.value ? 'text-neon-amber' : 'text-[var(--text-secondary)]')}>
                    {opt.label}
                  </span>
                  <p className="text-[10px] text-[var(--text-muted)]">{opt.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </GlassPanel>
      </div>

      {/* Per-type toggles */}
      <GlassPanel className="p-5">
        <h4 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
          <BarChart3 className="h-4 w-4 text-neon-green" /> Per-Type Toggles
        </h4>
        <p className="text-xs text-[var(--text-muted)] mb-4">Enable or disable each alert type globally.</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {allRuleTypes.map(type => {
            const d = getRuleDescription(type)
            const Icon = typeIcons[type] || Bell
            const enabled = typeToggles[type] ?? true
            return (
              <div key={type} className="flex items-center justify-between rounded-lg px-3 py-2 bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  <Icon className={clsx('h-3.5 w-3.5 shrink-0', enabled ? 'text-neon-cyan' : 'text-[var(--text-muted)]')} />
                  <span className={clsx('text-xs truncate', enabled ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]')}>
                    {d.label}
                  </span>
                </div>
                <button
                  onClick={() => toggleType(type)}
                  className={clsx(
                    'relative h-5 w-9 rounded-full transition-colors duration-200 shrink-0 ml-2',
                    enabled ? 'bg-neon-cyan/30' : 'bg-white/10'
                  )}
                >
                  <span className={clsx(
                    'absolute top-0.5 h-4 w-4 rounded-full transition-all duration-200',
                    enabled ? 'left-[18px] bg-neon-cyan' : 'left-0.5 bg-gray-500'
                  )} />
                </button>
              </div>
            )
          })}
        </div>
      </GlassPanel>
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function Alerts() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [tab, setTab] = useState<'alerts' | 'rules' | 'history' | 'preferences'>('alerts')
  const [filter, setFilter] = useState<'all' | 'unread' | 'critical'>('all')
  const [createModalOpen, setCreateModalOpen] = useState(false)

  // ─ Data queries ─
  const { data: alerts, isLoading: alertsLoading } = useQuery({
    queryKey: ['alerts'],
    queryFn: () => getAlerts(100),
    refetchInterval: 30_000,
  })

  const { data: rules, isLoading: rulesLoading } = useQuery({
    queryKey: ['alert-rules'],
    queryFn: getAlertRules,
  })

  const { data: vehicles } = useQuery({
    queryKey: ['vehicles'],
    queryFn: getVehicles,
  })

  const { data: channels } = useQuery({
    queryKey: ['notification-channels'],
    queryFn: getNotificationChannels,
  })

  // ─ Mutations ─
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

  const deleteRuleMut = useMutation({
    mutationFn: deleteAlertRule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] })
      toast.success('Alert rule deleted')
    },
    onError: () => toast.error('Failed to delete alert rule'),
  })

  // ─ Computed ─
  const filteredAlerts = useMemo(() => alerts?.filter(a => {
    if (filter === 'unread') return !a.read
    if (filter === 'critical') return a.severity === 'critical'
    return true
  }) ?? [], [alerts, filter])

  const unreadCount = useMemo(() => alerts?.filter(a => !a.read).length ?? 0, [alerts])
  const criticalCount = useMemo(() => alerts?.filter(a => a.severity === 'critical' && !a.read).length ?? 0, [alerts])
  const infoCount = useMemo(() => alerts?.filter(a => a.severity === 'info').length ?? 0, [alerts])
  const warningCount = useMemo(() => alerts?.filter(a => a.severity === 'warning').length ?? 0, [alerts])
  const readCount = useMemo(() => alerts?.filter(a => a.read).length ?? 0, [alerts])
  const totalCount = alerts?.length ?? 0

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

  const weekAlertCount = useMemo(() =>
    alertsByDay.reduce((s, d) => s + d.info + d.warning + d.critical, 0)
  , [alertsByDay])

  const allSeverityCounts = useMemo(() => ({
    info: alerts?.filter(a => a.severity === 'info').length ?? 0,
    warning: alerts?.filter(a => a.severity === 'warning').length ?? 0,
    critical: alerts?.filter(a => a.severity === 'critical').length ?? 0,
  }), [alerts])

  // ─ Quiet hours status ─
  const [quietHours] = useState<QuietHours>(loadQuietHours)
  const quietActive = isQuietHoursActive(quietHours)

  return (
    <div className="space-y-8">
      <PageHeader
        title="Alerts & Notifications"
        subtitle="Monitor events, configure alert rules, and stay informed"
        actions={
          <div className="flex items-center gap-3">
            {quietActive && (
              <span className="flex items-center gap-1.5 rounded-full bg-neon-purple/10 px-3 py-1 text-xs font-medium text-neon-purple">
                <Moon className="h-3 w-3" />
                🌙 Quiet hours
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
                <AlertCircle className="h-3 w-3" />
                {criticalCount} critical
              </span>
            )}
          </div>
        }
      />

      {/* Alert Stats Row */}
      <FadeIn>
        <GlassPanel className="p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-8 text-center">
            <div>
              <p className="text-lg font-bold text-neon-cyan"><AnimatedNumber value={totalCount} /></p>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Total</p>
            </div>
            <div className="h-8 w-px bg-white/[0.06] hidden sm:block" />
            <div>
              <p className="text-lg font-bold text-neon-amber"><AnimatedNumber value={weekAlertCount} /></p>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">This Week</p>
            </div>
            <div className="h-8 w-px bg-white/[0.06] hidden sm:block" />
            <div>
              <p className="text-lg font-bold text-neon-purple"><AnimatedNumber value={unreadCount} /></p>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Unread</p>
            </div>
            <div className="h-8 w-px bg-white/[0.06] hidden sm:block" />
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 text-xs"><Info className="h-3 w-3 text-neon-cyan" /><span className="font-mono text-neon-cyan">{allSeverityCounts.info}</span></span>
              <span className="flex items-center gap-1 text-xs"><AlertTriangle className="h-3 w-3 text-neon-amber" /><span className="font-mono text-neon-amber">{allSeverityCounts.warning}</span></span>
              <span className="flex items-center gap-1 text-xs"><AlertCircle className="h-3 w-3 text-neon-red" /><span className="font-mono text-neon-red">{allSeverityCounts.critical}</span></span>
            </div>
          </div>
        </GlassPanel>
      </FadeIn>

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
            { label: 'Last 7 Days', value: `${weekAlertCount}`, color: 'text-neon-amber' },
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

      {/* Tab navigation */}
      <FadeIn delay={0.2}>
        <TabNav
          tabs={[
            { key: 'alerts', label: 'Alerts', icon: <Bell className="h-4 w-4" /> },
            { key: 'rules', label: 'Alert Rules', icon: <Settings className="h-4 w-4" /> },
            { key: 'history', label: 'History', icon: <Send className="h-4 w-4" /> },
            { key: 'preferences', label: 'Preferences', icon: <Settings2 className="h-4 w-4" /> },
          ]}
          active={tab}
          onChange={k => setTab(k as typeof tab)}
        />
      </FadeIn>

      {/* ── Alerts Tab ── */}
      {tab === 'alerts' && (
        <>
          <FadeIn delay={0.05}>
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
          </FadeIn>

          {alertsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-20" />)}
            </div>
          ) : filteredAlerts.length > 0 ? (
            <StaggerContainer className="space-y-2">
              {filteredAlerts.map(a => (
                <StaggerItem key={a.id}>
                  <AlertCard alert={a} onMarkRead={() => markReadMut.mutate(a.id)} />
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

      {/* ── Rules Tab ── */}
      {tab === 'rules' && (
        <>
          <FadeIn delay={0.05}>
            <div className="flex items-center justify-between">
              <p className="text-xs text-[var(--text-muted)]">
                {enabledRules} of {rules?.length ?? 0} rules active
              </p>
              <button
                onClick={() => setCreateModalOpen(true)}
                className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium bg-neon-cyan/15 text-neon-cyan ring-1 ring-neon-cyan/25 hover:bg-neon-cyan/25 transition-all"
              >
                <Plus className="h-4 w-4" /> Create Alert Rule
              </button>
            </div>
          </FadeIn>

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
                    onDelete={() => deleteRuleMut.mutate(r.id)}
                  />
                </StaggerItem>
              ))}
            </StaggerContainer>
          ) : (
            <EmptyState
              icon={<Settings className="h-8 w-8" />}
              title="No alert rules configured"
              description="Create your first alert rule to get started."
            />
          )}

          <CreateRuleModal
            open={createModalOpen}
            onClose={() => setCreateModalOpen(false)}
            vehicles={vehicles ?? []}
            channels={channels ?? []}
          />
        </>
      )}

      {/* ── History Tab ── */}
      {tab === 'history' && <NotificationHistory />}

      {/* ── Preferences Tab ── */}
      {tab === 'preferences' && <PreferencesSection />}
    </div>
  )
}
