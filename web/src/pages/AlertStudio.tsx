/**
 * AlertStudio — full-featured CEP rule editor page.
 *
 * Lists existing rules, provides a visual builder, template library,
 * and manages persistence via the /api/v1/alerts/rules endpoint.
 */

import { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getAlertRules,
  createAlertRule,
  updateAlertRule,
  deleteAlertRule,
  getNotificationChannels,
  AlertRule,
  RuleConditionTree,
} from '../api'
import { PageHeader, GlassPanel, FadeIn, EmptyState, Skeleton } from '../components/ui'
import RuleBuilder from '../components/RuleBuilder'
import { useToast } from '../components/Toast'
import {
  Zap, Plus, Save, Trash2, Copy, Bell, BellOff,
  AlertTriangle, AlertCircle, Info, Battery, Gauge, Lock,
  Car, Droplets, Clock, Pencil, Sparkles, Thermometer, Shield, Search,
} from 'lucide-react'
import clsx from 'clsx'
import { formatDateTime } from '../lib/dateFormat'

// ─── Severity config ─────────────────────────────────────────────────────────

const severityConfig = {
  info: { icon: Info, color: 'text-neon-cyan', bg: 'bg-neon-cyan/10', border: 'border-neon-cyan/20', hex: '#00f0ff' },
  warning: { icon: AlertTriangle, color: 'text-neon-amber', bg: 'bg-neon-amber/10', border: 'border-neon-amber/20', hex: '#f59e0b' },
  critical: { icon: AlertCircle, color: 'text-neon-red', bg: 'bg-neon-red/10', border: 'border-neon-red/20', hex: '#ef4444' },
} as const

type Severity = keyof typeof severityConfig

// ─── Templates ───────────────────────────────────────────────────────────────

interface RuleTemplate {
  name: string
  icon: React.ElementType
  category: string
  severity: Severity
  msg_template: string
  cooldown_min: number
  conditions: RuleConditionTree
}

const ruleTemplates: RuleTemplate[] = [
  // ── Battery ────────────────────────────────────────
  { name: 'Battery Low (< 20%)', icon: Battery, category: 'Battery', severity: 'warning', msg_template: 'Battery at {{BatteryLevel}}%', cooldown_min: 30, conditions: { op: 'AND', rules: [{ signal: 'BatteryLevel', compare: '<', value: 20 }] } },
  { name: 'Battery Critical (< 10%)', icon: Battery, category: 'Battery', severity: 'critical', msg_template: 'Battery critically low at {{BatteryLevel}}%!', cooldown_min: 15, conditions: { op: 'AND', rules: [{ signal: 'BatteryLevel', compare: '<', value: 10 }] } },
  { name: 'Battery Full (≥ 90%)', icon: Battery, category: 'Battery', severity: 'info', msg_template: 'Battery reached {{BatteryLevel}}%', cooldown_min: 60, conditions: { op: 'AND', rules: [{ signal: 'BatteryLevel', compare: '>=', value: 90 }] } },
  { name: 'Charge Limit Reached', icon: Battery, category: 'Battery', severity: 'info', msg_template: 'Battery at charge limit {{ChargeLimitSoc}}%', cooldown_min: 60, conditions: { op: 'AND', rules: [{ signal: 'BatteryLevel', compare: '>=', value: 80 }] } },
  { name: 'Range Below 50 km', icon: Battery, category: 'Battery', severity: 'warning', msg_template: 'Range low: {{RatedRange}} km remaining', cooldown_min: 30, conditions: { op: 'AND', rules: [{ signal: 'RatedRange', compare: '<', value: 50 }] } },

  // ── Charging ───────────────────────────────────────
  { name: 'Charge Complete', icon: Zap, category: 'Charging', severity: 'info', msg_template: 'Charging complete at {{BatteryLevel}}%', cooldown_min: 60, conditions: { op: 'AND', rules: [{ signal: 'ChargeState', compare: 'changed_to', value: 'Complete' }] } },
  { name: 'Charging Started', icon: Zap, category: 'Charging', severity: 'info', msg_template: 'Charging started — {{DetailedChargeState}}', cooldown_min: 15, conditions: { op: 'AND', rules: [{ signal: 'DetailedChargeState', compare: 'changed_to', value: 'Charging' }] } },
  { name: 'Charging Stopped Unexpectedly', icon: Zap, category: 'Charging', severity: 'warning', msg_template: 'Charging stopped — {{DetailedChargeState}}', cooldown_min: 30, conditions: { op: 'AND', rules: [{ signal: 'DetailedChargeState', compare: 'changed_to', value: 'Stopped' }] } },
  { name: 'Supercharging (DC Fast)', icon: Zap, category: 'Charging', severity: 'info', msg_template: 'Supercharging at {{DCChargingPower}} kW', cooldown_min: 30, conditions: { op: 'AND', rules: [{ signal: 'DCChargingPower', compare: '>', value: 50 }] } },
  { name: 'Slow Charge Rate', icon: Zap, category: 'Charging', severity: 'warning', msg_template: 'Charging slow: {{ChargeAmps}}A at {{ChargerVoltage}}V', cooldown_min: 60, conditions: { op: 'AND', rules: [{ signal: 'ChargeAmps', compare: '<', value: 5 }, { signal: 'ChargeAmps', compare: '>', value: 0 }] } },

  // ── Driving ────────────────────────────────────────
  { name: 'Drive Started', icon: Car, category: 'Driving', severity: 'info', msg_template: 'Drive started — gear is {{Gear}}', cooldown_min: 5, conditions: { op: 'AND', rules: [{ signal: 'Gear', compare: 'changed_to', value: 'D' }] } },
  { name: 'Drive Ended', icon: Car, category: 'Driving', severity: 'info', msg_template: 'Drive ended — gear is {{Gear}}', cooldown_min: 5, conditions: { op: 'AND', rules: [{ signal: 'Gear', compare: 'changed_to', value: 'P' }] } },
  { name: 'Speed Limit Exceeded', icon: Gauge, category: 'Driving', severity: 'warning', msg_template: 'Speed {{VehicleSpeed}} km/h exceeded limit', cooldown_min: 15, conditions: { op: 'AND', rules: [{ signal: 'VehicleSpeed', compare: '>', value: 120 }] } },
  { name: 'High Speed Alert (> 160 km/h)', icon: Gauge, category: 'Driving', severity: 'critical', msg_template: 'Very high speed: {{VehicleSpeed}} km/h!', cooldown_min: 5, conditions: { op: 'AND', rules: [{ signal: 'VehicleSpeed', compare: '>', value: 160 }] } },
  { name: 'Reverse Gear Engaged', icon: Car, category: 'Driving', severity: 'info', msg_template: 'Vehicle in reverse', cooldown_min: 5, conditions: { op: 'AND', rules: [{ signal: 'Gear', compare: 'changed_to', value: 'R' }] } },
  { name: 'Drive Started Away from Home', icon: Car, category: 'Driving', severity: 'warning', msg_template: 'Driving from non-home location', cooldown_min: 15, conditions: { op: 'AND', rules: [{ signal: 'Gear', compare: 'changed_to', value: 'D' }, { signal: 'LocatedAtHome', compare: 'is_false' }] } },
  { name: 'Odometer Milestone (100k km)', icon: Car, category: 'Driving', severity: 'info', msg_template: 'Odometer: {{Odometer}} km', cooldown_min: 1440, conditions: { op: 'AND', rules: [{ signal: 'Odometer', compare: '>', value: 100000 }] } },

  // ── Security ───────────────────────────────────────
  { name: 'Car Unlocked While Parked', icon: Lock, category: 'Security', severity: 'critical', msg_template: 'Vehicle is unlocked and parked!', cooldown_min: 30, conditions: { op: 'AND', rules: [{ signal: 'Locked', compare: 'is_false' }, { signal: 'Gear', compare: '==', value: 'P' }] } },
  { name: 'Vehicle Locked', icon: Lock, category: 'Security', severity: 'info', msg_template: 'Vehicle locked', cooldown_min: 5, conditions: { op: 'AND', rules: [{ signal: 'Locked', compare: 'changed_to', value: true }] } },
  { name: 'Vehicle Unlocked', icon: Lock, category: 'Security', severity: 'info', msg_template: 'Vehicle unlocked', cooldown_min: 5, conditions: { op: 'AND', rules: [{ signal: 'Locked', compare: 'changed_to', value: false }] } },
  { name: 'Sentry Mode Activated', icon: Shield, category: 'Security', severity: 'info', msg_template: 'Sentry mode activated', cooldown_min: 30, conditions: { op: 'AND', rules: [{ signal: 'SentryMode', compare: 'is_true' }] } },
  { name: 'Door Opened While Parked', icon: Lock, category: 'Security', severity: 'warning', msg_template: 'Door opened — {{DoorState}}', cooldown_min: 15, conditions: { op: 'AND', rules: [{ signal: 'DoorState', compare: '!=', value: 'Closed' }, { signal: 'Gear', compare: '==', value: 'P' }] } },
  { name: 'Window Left Open', icon: Car, category: 'Security', severity: 'warning', msg_template: 'Window open — FD: {{FdWindow}}', cooldown_min: 60, conditions: { op: 'OR', rules: [{ signal: 'FdWindow', compare: '!=', value: 'Closed' }, { signal: 'FpWindow', compare: '!=', value: 'Closed' }, { signal: 'RdWindow', compare: '!=', value: 'Closed' }, { signal: 'RpWindow', compare: '!=', value: 'Closed' }] } },
  { name: 'Valet Mode Enabled', icon: Shield, category: 'Security', severity: 'info', msg_template: 'Valet mode enabled', cooldown_min: 60, conditions: { op: 'AND', rules: [{ signal: 'ValetModeEnabled', compare: 'is_true' }] } },
  { name: 'Guest Mode Enabled', icon: Shield, category: 'Security', severity: 'warning', msg_template: 'Guest mode enabled', cooldown_min: 60, conditions: { op: 'AND', rules: [{ signal: 'GuestModeEnabled', compare: 'is_true' }] } },

  // ── Climate ────────────────────────────────────────
  { name: 'Cabin Overheat (> 40°C)', icon: Thermometer, category: 'Climate', severity: 'warning', msg_template: 'Cabin temp: {{InsideTemp}}°C', cooldown_min: 30, conditions: { op: 'AND', rules: [{ signal: 'InsideTemp', compare: '>', value: 40 }] } },
  { name: 'Cabin Freezing (< 0°C)', icon: Thermometer, category: 'Climate', severity: 'warning', msg_template: 'Cabin temp: {{InsideTemp}}°C — freezing!', cooldown_min: 60, conditions: { op: 'AND', rules: [{ signal: 'InsideTemp', compare: '<', value: 0 }] } },
  { name: 'HVAC Left On While Parked', icon: Thermometer, category: 'Climate', severity: 'info', msg_template: 'HVAC running while parked', cooldown_min: 30, conditions: { op: 'AND', rules: [{ signal: 'HvacPower', compare: 'is_true' }, { signal: 'Gear', compare: '==', value: 'P' }] } },
  { name: 'Climate Keeper Active', icon: Thermometer, category: 'Climate', severity: 'info', msg_template: 'Climate keeper: {{ClimateKeeperMode}}', cooldown_min: 60, conditions: { op: 'AND', rules: [{ signal: 'ClimateKeeperMode', compare: '!=', value: 'Off' }] } },
  { name: 'Steering Wheel Heater On', icon: Thermometer, category: 'Climate', severity: 'info', msg_template: 'Steering wheel heater level {{HvacSteeringWheelHeatLevel}}', cooldown_min: 30, conditions: { op: 'AND', rules: [{ signal: 'HvacSteeringWheelHeatLevel', compare: '>', value: 0 }] } },

  // ── Tire Pressure ──────────────────────────────────
  { name: 'Tire Pressure Low', icon: Droplets, category: 'Tire Pressure', severity: 'warning', msg_template: 'Low tire pressure detected', cooldown_min: 60, conditions: { op: 'AND', rules: [{ signal: 'TpmsHardWarnings', compare: 'is_true' }] } },
  { name: 'Tire Pressure Soft Warning', icon: Droplets, category: 'Tire Pressure', severity: 'info', msg_template: 'Tire pressure slightly low', cooldown_min: 120, conditions: { op: 'AND', rules: [{ signal: 'TpmsSoftWarnings', compare: 'is_true' }] } },
  { name: 'Front Left Tire Low (< 2.2 bar)', icon: Droplets, category: 'Tire Pressure', severity: 'warning', msg_template: 'FL tire: {{TpmsPressureFl}} bar', cooldown_min: 60, conditions: { op: 'AND', rules: [{ signal: 'TpmsPressureFl', compare: '<', value: 2.2 }] } },

  // ── Location ───────────────────────────────────────
  { name: 'Arrived at Home', icon: Car, category: 'Location', severity: 'info', msg_template: 'Vehicle arrived at home', cooldown_min: 15, conditions: { op: 'AND', rules: [{ signal: 'LocatedAtHome', compare: 'changed_to', value: true }] } },
  { name: 'Left Home', icon: Car, category: 'Location', severity: 'info', msg_template: 'Vehicle left home', cooldown_min: 15, conditions: { op: 'AND', rules: [{ signal: 'LocatedAtHome', compare: 'changed_from', value: true }] } },
  { name: 'Arrived at Work', icon: Car, category: 'Location', severity: 'info', msg_template: 'Vehicle arrived at work', cooldown_min: 15, conditions: { op: 'AND', rules: [{ signal: 'LocatedAtWork', compare: 'changed_to', value: true }] } },
  { name: 'Navigation Started', icon: Car, category: 'Location', severity: 'info', msg_template: 'Navigating to {{DestinationName}}', cooldown_min: 10, conditions: { op: 'AND', rules: [{ signal: 'DestinationName', compare: '!=', value: '' }] } },

  // ── Safety ─────────────────────────────────────────
  { name: 'Driver Seatbelt Unbuckled', icon: Shield, category: 'Safety', severity: 'warning', msg_template: 'Driver seatbelt unbuckled while driving!', cooldown_min: 5, conditions: { op: 'AND', rules: [{ signal: 'DriverSeatBelt', compare: 'is_false' }, { signal: 'Gear', compare: '==', value: 'D' }] } },
  { name: 'Speed Limit Mode Active', icon: Shield, category: 'Safety', severity: 'info', msg_template: 'Speed limit mode active', cooldown_min: 60, conditions: { op: 'AND', rules: [{ signal: 'SpeedLimitMode', compare: 'is_true' }] } },
  { name: 'PIN to Drive Disabled', icon: Shield, category: 'Safety', severity: 'warning', msg_template: 'PIN to Drive has been disabled', cooldown_min: 1440, conditions: { op: 'AND', rules: [{ signal: 'PinToDriveEnabled', compare: 'is_false' }] } },

  // ── Motor / Powertrain ─────────────────────────────
  { name: 'High Motor Temperature (> 80°C)', icon: Thermometer, category: 'Motor', severity: 'warning', msg_template: 'Motor stator temp: {{DiStatorTempF}}°C', cooldown_min: 15, conditions: { op: 'AND', rules: [{ signal: 'DiStatorTempF', compare: '>', value: 80 }] } },
  { name: 'HVIL Fault', icon: Shield, category: 'Motor', severity: 'critical', msg_template: 'HV interlock fault detected!', cooldown_min: 5, conditions: { op: 'AND', rules: [{ signal: 'Hvil', compare: '==', value: 'Fault' }] } },
  { name: 'High Regenerative Braking', icon: Zap, category: 'Motor', severity: 'info', msg_template: 'Regen power: {{Power}} kW', cooldown_min: 15, conditions: { op: 'AND', rules: [{ signal: 'Power', compare: '<', value: -50 }] } },

  // ── Software ───────────────────────────────────────
  { name: 'Software Update Available', icon: Zap, category: 'Software', severity: 'info', msg_template: 'Update available: {{SoftwareUpdateVersion}}', cooldown_min: 1440, conditions: { op: 'AND', rules: [{ signal: 'SoftwareUpdateVersion', compare: '!=', value: '' }] } },
  { name: 'Software Update Installing', icon: Zap, category: 'Software', severity: 'info', msg_template: 'Installing update: {{SoftwareUpdateInstallationPercentComplete}}%', cooldown_min: 30, conditions: { op: 'AND', rules: [{ signal: 'SoftwareUpdateInstallationPercentComplete', compare: '>', value: 0 }] } },

  // ── Media ──────────────────────────────────────────
  { name: 'Music Playing', icon: Car, category: 'Media', severity: 'info', msg_template: 'Now playing: {{MediaNowPlayingTitle}} by {{MediaNowPlayingArtist}}', cooldown_min: 60, conditions: { op: 'AND', rules: [{ signal: 'MediaPlaybackStatus', compare: '==', value: 'Playing' }] } },
  { name: 'Volume Too High', icon: Car, category: 'Media', severity: 'info', msg_template: 'Volume at {{MediaAudioVolume}}', cooldown_min: 30, conditions: { op: 'AND', rules: [{ signal: 'MediaAudioVolume', compare: '>', value: 8 }] } },

  // ── Powershare ─────────────────────────────────────
  { name: 'Powershare Active', icon: Zap, category: 'Powershare', severity: 'info', msg_template: 'Powershare active: {{PowershareInstantaneousPowerKW}} kW', cooldown_min: 60, conditions: { op: 'AND', rules: [{ signal: 'PowershareStatus', compare: '!=', value: '' }] } },
]

const templateCategories = [...new Set(ruleTemplates.map(t => t.category))].sort()

// ─── Empty editor state ──────────────────────────────────────────────────────

interface EditorState {
  id?: number
  name: string
  type: string
  severity: Severity
  cooldown_min: number
  msg_template: string
  conditions: RuleConditionTree
  notify_channels: number[]
  enabled: boolean
}

function freshEditor(): EditorState {
  return {
    name: '',
    type: 'custom',
    severity: 'info',
    cooldown_min: 15,
    msg_template: '',
    conditions: { op: 'AND', rules: [{ signal: '', compare: '==', value: '' }] },
    notify_channels: [],
    enabled: true,
  }
}

function ruleToEditor(rule: AlertRule): EditorState {
  return {
    id: rule.id,
    name: rule.name,
    type: rule.type,
    severity: (rule.severity as Severity) ?? 'info',
    cooldown_min: rule.cooldown_min ?? 15,
    msg_template: rule.msg_template ?? '',
    conditions: (rule.conditions as RuleConditionTree | null) ?? { op: 'AND', rules: [{ signal: '', compare: '==', value: '' }] },
    notify_channels: rule.notify_channels ?? [],
    enabled: rule.enabled,
  }
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AlertStudio() {
  const queryClient = useQueryClient()
  const toast = useToast()

  // Queries
  const { data: rules, isLoading } = useQuery({ queryKey: ['alert-rules'], queryFn: getAlertRules })
  const { data: channels } = useQuery({ queryKey: ['notification-channels'], queryFn: getNotificationChannels })

  // Editor state
  const [editor, setEditor] = useState<EditorState>(freshEditor)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [showTemplates, setShowTemplates] = useState(false)
  const [templateSearch, setTemplateSearch] = useState('')
  const [templateCategory, setTemplateCategory] = useState<string | null>(null)

  const filteredTemplates = useMemo(() => {
    let list = ruleTemplates
    if (templateCategory) list = list.filter(t => t.category === templateCategory)
    if (templateSearch) {
      const q = templateSearch.toLowerCase()
      list = list.filter(t => t.name.toLowerCase().includes(q) || t.msg_template.toLowerCase().includes(q) || t.category.toLowerCase().includes(q))
    }
    return list
  }, [templateSearch, templateCategory])

  const isEditing = selectedId !== null

  // Mutations
  const saveMut = useMutation({
    mutationFn: async (state: EditorState) => {
      const payload = {
        name: state.name,
        type: state.type || 'custom',
        enabled: state.enabled,
        threshold: 0,
        vehicle_id: null as number | null,
        conditions: state.conditions,
        severity: state.severity,
        cooldown_min: state.cooldown_min,
        msg_template: state.msg_template,
        notify_channels: state.notify_channels,
      }
      if (state.id) {
        return updateAlertRule(state.id, payload)
      }
      return createAlertRule(payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] })
      toast.success(isEditing ? 'Rule updated' : 'Rule created')
      setEditor(freshEditor())
      setSelectedId(null)
    },
    onError: () => toast.error('Failed to save rule'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteAlertRule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] })
      toast.success('Rule deleted')
      setEditor(freshEditor())
      setSelectedId(null)
    },
    onError: () => toast.error('Failed to delete rule'),
  })

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => updateAlertRule(id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alert-rules'] }),
  })

  // Handlers
  const handleSelectRule = useCallback((rule: AlertRule) => {
    setSelectedId(rule.id)
    setEditor(ruleToEditor(rule))
  }, [])

  const handleNewRule = useCallback(() => {
    setSelectedId(null)
    setEditor(freshEditor())
  }, [])

  const handleCloneTemplate = useCallback((tpl: RuleTemplate) => {
    setSelectedId(null)
    setEditor({
      name: tpl.name,
      type: 'custom',
      severity: tpl.severity,
      cooldown_min: tpl.cooldown_min,
      msg_template: tpl.msg_template,
      conditions: JSON.parse(JSON.stringify(tpl.conditions)),
      notify_channels: [],
      enabled: true,
    })
    setShowTemplates(false)
  }, [])

  // Filter CEP rules (have conditions)
  const cepRules = useMemo(() => (rules ?? []).filter(r => r.conditions), [rules])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alert Studio"
        subtitle="Create custom rules from any Fleet Telemetry signal"
        icon={<Zap className="h-6 w-6 text-neon-cyan" />}
        actions={
          <div className="flex items-center gap-2">
            <button
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[var(--text-primary)] bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
              onClick={() => setShowTemplates(!showTemplates)}
            >
              <Sparkles className="h-3.5 w-3.5 text-neon-amber" /> Templates
            </button>
            <button
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-neon-cyan/20 text-neon-cyan hover:bg-neon-cyan/30 rounded-lg transition-colors"
              onClick={handleNewRule}
            >
              <Plus className="h-3.5 w-3.5" /> New Rule
            </button>
          </div>
        }
      />

      {/* Template library */}
      {showTemplates && (
        <FadeIn>
          <GlassPanel className="p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold text-[var(--text-primary)]">Rule Templates — {ruleTemplates.length} pre-built rules</p>
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
                <input
                  className="glass-input w-full pl-8 text-xs py-1.5"
                  placeholder="Search templates…"
                  value={templateSearch}
                  onChange={e => setTemplateSearch(e.target.value)}
                />
              </div>
            </div>

            {/* Category tabs */}
            <div className="flex flex-wrap gap-1.5 mb-4">
              <button
                onClick={() => setTemplateCategory(null)}
                className={clsx('px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors',
                  templateCategory === null ? 'bg-neon-cyan/10 border-neon-cyan/30 text-neon-cyan' : 'border-white/[0.08] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                )}
              >All ({ruleTemplates.length})</button>
              {templateCategories.map(cat => {
                const count = ruleTemplates.filter(t => t.category === cat).length
                return (
                  <button
                    key={cat}
                    onClick={() => setTemplateCategory(cat === templateCategory ? null : cat)}
                    className={clsx('px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors',
                      templateCategory === cat ? 'bg-neon-cyan/10 border-neon-cyan/30 text-neon-cyan' : 'border-white/[0.08] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    )}
                  >{cat} ({count})</button>
                )
              })}
            </div>

            {/* Template grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {filteredTemplates.map(tpl => {
                const Icon = tpl.icon
                const sev = severityConfig[tpl.severity]
                return (
                  <button
                    key={tpl.name}
                    className="glass-card p-3 text-left hover:border-neon-cyan/30 transition-all group"
                    onClick={() => handleCloneTemplate(tpl)}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className={clsx('rounded-lg p-1.5', sev.bg)}>
                        <Icon className={clsx('h-3.5 w-3.5', sev.color)} />
                      </div>
                      <span className="text-xs font-medium text-[var(--text-primary)] group-hover:text-neon-cyan transition-colors">{tpl.name}</span>
                    </div>
                    <p className="text-[10px] text-[var(--text-muted)] font-mono truncate">{tpl.msg_template}</p>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className={clsx('text-[9px] px-1.5 py-0.5 rounded font-medium', sev.bg, sev.color)}>{tpl.severity}</span>
                      <div className="flex items-center gap-1">
                        <Copy className="h-3 w-3 text-[var(--text-muted)]" />
                        <span className="text-[10px] text-[var(--text-muted)]">Use</span>
                      </div>
                    </div>
                  </button>
                )
              })}
              {filteredTemplates.length === 0 && (
                <p className="col-span-full text-sm text-[var(--text-muted)] py-8 text-center">No templates match your search</p>
              )}
            </div>
          </GlassPanel>
        </FadeIn>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ── Rule list (sidebar) ────────────────────────────────────────── */}
        <div className="lg:col-span-4 space-y-3">
          <GlassPanel className="p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-[var(--text-primary)]">Rules</p>
              <span className="text-[10px] text-[var(--text-muted)]">{cepRules.length} rule{cepRules.length !== 1 ? 's' : ''}</span>
            </div>

            {isLoading && (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-lg" />)}
              </div>
            )}

            {!isLoading && cepRules.length === 0 && (
              <EmptyState
                icon={<Bell className="h-8 w-8 text-[var(--text-muted)]" />}
                title="No CEP rules yet"
                description="Create your first rule or pick a template above."
              />
            )}

            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {cepRules.map(rule => {
                const sev = severityConfig[(rule.severity as Severity) ?? 'info'] ?? severityConfig.info
                const SevIcon = sev.icon
                const active = selectedId === rule.id
                return (
                  <button
                    key={rule.id}
                    className={clsx(
                      'w-full text-left glass-panel p-3 transition-all',
                      active ? 'border-neon-cyan/30 bg-neon-cyan/5' : 'hover:border-white/10',
                    )}
                    onClick={() => handleSelectRule(rule)}
                  >
                    <div className="flex items-center gap-2">
                      <SevIcon className={clsx('h-3.5 w-3.5 shrink-0', sev.color)} />
                      <span className="text-xs font-medium text-[var(--text-primary)] truncate flex-1">{rule.name || 'Untitled'}</span>
                      <button
                        className="shrink-0"
                        onClick={e => { e.stopPropagation(); toggleMut.mutate({ id: rule.id, enabled: !rule.enabled }) }}
                        title={rule.enabled ? 'Disable' : 'Enable'}
                      >
                        {rule.enabled
                          ? <Bell className="h-3.5 w-3.5 text-neon-green" />
                          : <BellOff className="h-3.5 w-3.5 text-[var(--text-muted)]" />}
                      </button>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-[var(--text-muted)]">
                      {rule.last_fired_at && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {formatDateTime(rule.last_fired_at)}
                        </span>
                      )}
                      {(rule.fire_count ?? 0) > 0 && (
                        <span className="flex items-center gap-1">
                          <Zap className="h-3 w-3" /> {rule.fire_count}×
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </GlassPanel>
        </div>

        {/* ── Rule editor (main) ─────────────────────────────────────────── */}
        <div className="lg:col-span-8 space-y-4">
          <GlassPanel className="p-4">
            <div className="flex items-center gap-2 mb-4">
              <Pencil className="h-4 w-4 text-neon-cyan" />
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {isEditing ? 'Edit Rule' : 'New Rule'}
              </p>
            </div>

            {/* Name */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-medium">Name</label>
                <input
                  className="glass-input w-full"
                  placeholder="My alert rule"
                  value={editor.name}
                  onChange={e => setEditor(s => ({ ...s, name: e.target.value }))}
                />
              </div>

              {/* Severity */}
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-medium">Severity</label>
                <select
                  className="glass-input w-full"
                  value={editor.severity}
                  onChange={e => setEditor(s => ({ ...s, severity: e.target.value as Severity }))}
                >
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            </div>

            {/* Cooldown + Message template */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-medium">Cooldown (minutes)</label>
                <input
                  type="number"
                  min={0}
                  className="glass-input w-full"
                  value={editor.cooldown_min}
                  onChange={e => setEditor(s => ({ ...s, cooldown_min: Number(e.target.value) || 0 }))}
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-medium">
                  Message Template
                  <span className="text-[var(--text-muted)] ml-1 normal-case tracking-normal">{'Use {{SignalName}}'}</span>
                </label>
                <input
                  className="glass-input w-full"
                  placeholder="Battery at {{BatteryLevel}}%"
                  value={editor.msg_template}
                  onChange={e => setEditor(s => ({ ...s, msg_template: e.target.value }))}
                />
              </div>
            </div>

            {/* Notification delivery */}
            <div className="mb-4">
              <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2 font-medium">How You'll Be Notified</label>
              <div className="space-y-2">
                {/* Always-on: SSE + DB */}
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-full bg-neon-green" />
                  <span style={{ color: 'var(--text-primary)' }}>Browser toast notification (real-time via SSE)</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-full bg-neon-green" />
                  <span style={{ color: 'var(--text-primary)' }}>Alert history (saved to database)</span>
                </div>

                {/* Channels */}
                {channels && channels.length > 0 ? (
                  <div>
                    <p className="text-xs text-[var(--text-muted)] mb-1.5 mt-1">External channels (click to toggle):</p>
                    <div className="flex flex-wrap gap-2">
                      {channels.map(ch => {
                        const isSelected = editor.notify_channels.includes(ch.id)
                        return (
                          <button
                            key={ch.id}
                            type="button"
                            className={clsx(
                              'px-3 py-1.5 text-xs rounded-lg transition-colors border',
                              isSelected
                                ? 'bg-neon-cyan/10 border-neon-cyan/30 text-neon-cyan'
                                : 'bg-white/5 border-white/10 text-[var(--text-muted)] hover:border-white/20',
                            )}
                            onClick={() => {
                              setEditor(s => ({
                                ...s,
                                notify_channels: isSelected
                                  ? s.notify_channels.filter(id => id !== ch.id)
                                  : [...s.notify_channels, ch.id],
                              }))
                            }}
                          >
                            <Bell className="h-3 w-3 inline mr-1" />
                            {ch.name} ({ch.type})
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs mt-1">
                    <span className="w-2 h-2 rounded-full bg-white/20" />
                    <span className="text-[var(--text-muted)]">
                      No external channels configured — <a href="/notifications" className="text-neon-cyan hover:underline">set up Discord, Slack, ntfy, or webhooks</a>
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Condition builder */}
            <div className="mb-4">
              <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2 font-medium">Conditions</label>
              <RuleBuilder
                value={editor.conditions}
                onChange={conditions => setEditor(s => ({ ...s, conditions }))}
              />
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 pt-2 border-t border-white/5">
              <button
                className={clsx(
                  'flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg transition-colors',
                  'bg-neon-cyan/20 text-neon-cyan hover:bg-neon-cyan/30',
                  saveMut.isPending && 'opacity-60 pointer-events-none',
                )}
                onClick={() => saveMut.mutate(editor)}
                disabled={!editor.name.trim()}
              >
                <Save className="h-3.5 w-3.5" />
                {saveMut.isPending ? 'Saving…' : isEditing ? 'Update Rule' : 'Create Rule'}
              </button>

              {isEditing && (
                <button
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-neon-red/10 text-neon-red hover:bg-neon-red/20 transition-colors"
                  onClick={() => { if (editor.id) deleteMut.mutate(editor.id) }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              )}

              <button
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-neon-purple/10 text-neon-purple hover:bg-neon-purple/20 transition-colors"
                onClick={async () => {
                  try {
                    const res = await fetch('/api/v1/alerts/test', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ name: editor.name || 'Test Rule', severity: editor.severity, msg_template: editor.msg_template || 'Test notification from Alert Studio' }),
                    })
                    if (res.ok) toast.success('Test sent', 'Check your browser toast notification')
                    else toast.error('Test failed', 'Could not send test notification')
                  } catch { toast.error('Test failed', 'Network error') }
                }}
                disabled={!editor.name.trim()}
              >
                <Bell className="h-3.5 w-3.5" />
                Test
              </button>

              <button
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-white/5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-colors ml-auto"
                onClick={handleNewRule}
              >
                Reset
              </button>
            </div>
          </GlassPanel>
        </div>
      </div>
    </div>
  )
}
