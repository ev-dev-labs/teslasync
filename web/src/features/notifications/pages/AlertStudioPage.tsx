/**
 * AlertStudio — full-featured CEP rule editor page.
 *
 * Lists existing rules, provides a visual builder, template library,
 * and manages persistence via the /api/v1/alerts/rules endpoint.
 */

import { useState, useMemo, useCallback, type ElementType, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { AlertRule, NotificationChannel, RuleConditionTree } from '@/api/hooks/useNotifications'
import { request } from '@/api/client'
import { GlassPanel, Badge, Button as UiButton, Input as UiInput, Select as UiSelect } from '@/components/ui'
import { PageContainer } from '@/components/layout'
import { FadeIn } from '@/components/motion'
import { EmptyState, Skeleton } from '@/components/feedback'
import { RuleBuilder } from '@/components/forms'
import { useToast } from '@/components/feedback/Toast'
import {
  Zap, Plus, Save, Trash2, Copy, Bell, BellOff,
  AlertTriangle, AlertCircle, Info, Battery, Gauge, Lock,
  Car, Droplets, Clock, Pencil, Sparkles, Thermometer, Shield, Search,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/dateFormat'
import { usePageTitle } from '@/hooks/usePageTitle'

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
  icon: ElementType
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

function isSeverity(value: string | undefined): value is Severity {
  return value === 'info' || value === 'warning' || value === 'critical'
}

function normalizeSeverity(value: AlertRule['severity']): Severity {
  return isSeverity(value) ? value : 'info'
}

function cloneConditionTree(tree: RuleConditionTree): RuleConditionTree {
  return {
    ...tree,
    rules: tree.rules?.map(cloneConditionTree),
  }
}

function templateKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
}

function ruleToEditor(rule: AlertRule): EditorState {
  return {
    id: rule.id,
    name: rule.name,
    type: rule.type,
    severity: normalizeSeverity(rule.severity),
    cooldown_min: rule.cooldown_min ?? 15,
    msg_template: rule.msg_template ?? '',
    conditions: (rule.conditions as RuleConditionTree | null) ?? { op: 'AND', rules: [{ signal: '', compare: '==', value: '' }] },
    notify_channels: rule.notify_channels ?? [],
    enabled: rule.enabled,
  }
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AlertStudio() {
  const { t } = useTranslation()
  const pageTitle = t('notifications.alertStudio.title', 'Alert Studio')
  const pageSubtitle = t('notifications.alertStudio.subtitle', 'Create custom rules from any Fleet Telemetry signal')
  const untitledRuleLabel = t('notifications.alertStudio.rules.untitled', 'Untitled')
  usePageTitle(pageTitle)
  const queryClient = useQueryClient()
  const toast = useToast()

  // Queries
  const { data: rules, isLoading } = useQuery({ queryKey: ['alert-rules'], queryFn: () => request<AlertRule[]>('/alerts/rules') })
  const { data: channels } = useQuery({ queryKey: ['notification-channels'], queryFn: () => request<NotificationChannel[]>('/notifications') })

  // Editor state
  const [editor, setEditor] = useState<EditorState>(freshEditor)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [showTemplates, setShowTemplates] = useState(false)
  const [templateSearch, setTemplateSearch] = useState('')
  const [templateCategory, setTemplateCategory] = useState<string | null>(null)
  const [ruleSearch, setRuleSearch] = useState('')

  const getTemplateName = useCallback((tpl: RuleTemplate) => (
    t(`notifications.alertStudio.templates.${templateKey(tpl.name)}.name`, tpl.name)
  ), [t])

  const getTemplateMessage = useCallback((tpl: RuleTemplate) => (
    t(`notifications.alertStudio.templates.${templateKey(tpl.name)}.message`, tpl.msg_template)
  ), [t])

  const getTemplateCategory = useCallback((category: string) => (
    t(`notifications.alertStudio.templateCategories.${templateKey(category)}`, category)
  ), [t])

  const filteredTemplates = useMemo(() => {
    let list = ruleTemplates
    if (templateCategory) list = list.filter(t => t.category === templateCategory)
    if (templateSearch) {
      const q = templateSearch.toLowerCase()
      list = list.filter(tpl => (
        getTemplateName(tpl).toLowerCase().includes(q)
        || getTemplateMessage(tpl).toLowerCase().includes(q)
        || getTemplateCategory(tpl.category).toLowerCase().includes(q)
      ))
    }
    return list
  }, [getTemplateCategory, getTemplateMessage, getTemplateName, templateSearch, templateCategory])

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
        return request<AlertRule>(`/alerts/rules/${state.id}`, { method: 'PUT', body: JSON.stringify(payload) })
      }
      return request<AlertRule>('/alerts/rules', { method: 'POST', body: JSON.stringify(payload) })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] })
      toast.success(isEditing
        ? t('notifications.alertStudio.toasts.ruleUpdated', 'Rule updated')
        : t('notifications.alertStudio.toasts.ruleCreated', 'Rule created'))
      setEditor(freshEditor())
      setSelectedId(null)
    },
    onError: () => toast.error(t('notifications.alertStudio.toasts.saveFailed', 'Failed to save rule')),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => request<void>(`/alerts/rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] })
      toast.success(t('notifications.alertStudio.toasts.ruleDeleted', 'Rule deleted'))
      setEditor(freshEditor())
      setSelectedId(null)
    },
    onError: () => toast.error(t('notifications.alertStudio.toasts.deleteFailed', 'Failed to delete rule')),
  })

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => request<AlertRule>(`/alerts/rules/${id}`, { method: 'PUT', body: JSON.stringify({ enabled }) }),
    onSuccess: (_data, { enabled }) => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] })
      toast.success(enabled
        ? t('notifications.alertStudio.toasts.ruleEnabled', 'Rule enabled')
        : t('notifications.alertStudio.toasts.ruleDisabled', 'Rule disabled'))
    },
    onError: (err: Error) => toast.error(err.message || t('notifications.alertStudio.toasts.toggleFailed', 'Failed to toggle rule')),
  })

  // Handlers
  const handleSelectRule = useCallback((rule: AlertRule) => {
    setSelectedId(rule.id)
    setEditor(ruleToEditor(rule))
  }, [])

  const allChannelIds = useMemo(() => (channels ?? []).map(ch => ch.id), [channels])

  const handleNewRule = useCallback(() => {
    setSelectedId(null)
    setEditor({ ...freshEditor(), notify_channels: allChannelIds })
  }, [allChannelIds])

  const handleCloneTemplate = useCallback((tpl: RuleTemplate) => {
    setSelectedId(null)
    setEditor({
      name: getTemplateName(tpl),
      type: 'custom',
      severity: tpl.severity,
      cooldown_min: tpl.cooldown_min,
      msg_template: getTemplateMessage(tpl),
      conditions: cloneConditionTree(tpl.conditions),
      notify_channels: allChannelIds,
      enabled: true,
    })
    setShowTemplates(false)
  }, [allChannelIds, getTemplateMessage, getTemplateName])

  // Filter CEP rules (have conditions)
  const cepRules = useMemo(() => (rules ?? []).filter(r => r.conditions), [rules])
  const filteredRules = useMemo(() => {
    if (!ruleSearch) return cepRules
    const q = ruleSearch.toLowerCase()
    return cepRules.filter(r => (r.name || '').toLowerCase().includes(q))
  }, [cepRules, ruleSearch])

  const rulesCountLabel = cepRules.length === 1
    ? t('notifications.alertStudio.rules.countOne', '1 rule')
    : t('notifications.alertStudio.rules.countMany', '{{count}} rules', { count: cepRules.length })

  const handleRuleRowKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>, rule: AlertRule) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleSelectRule(rule)
    }
  }, [handleSelectRule])

  const severityOptions = useMemo(() => [
    { value: 'info', label: t('notifications.alertStudio.severity.info', 'Info') },
    { value: 'warning', label: t('notifications.alertStudio.severity.warning', 'Warning') },
    { value: 'critical', label: t('notifications.alertStudio.severity.critical', 'Critical') },
  ], [t])

  return (
    <PageContainer
      title={pageTitle}
      subtitle={pageSubtitle}
      actions={
        <>
          <UiButton variant="ghost" size="sm" icon={<Sparkles className="h-3.5 w-3.5 text-neon-amber" />} onClick={() => setShowTemplates(!showTemplates)}>
            {t('notifications.alertStudio.actions.templates', 'Templates')}
          </UiButton>
          <UiButton variant="primary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={handleNewRule}>
            {t('notifications.alertStudio.actions.newRule', 'New Rule')}
          </UiButton>
        </>
      }
    >

      {/* Template library */}
      {showTemplates && (
        <FadeIn>
          <GlassPanel className="p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                {t('notifications.alertStudio.templates.header', 'Rule Templates - {{count}} pre-built rules', { count: ruleTemplates.length })}
              </p>
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
                <UiInput
                  className="w-full pl-8 text-xs py-1.5"
                  placeholder={t('notifications.alertStudio.templates.searchPlaceholder', 'Search templates...')}
                  value={templateSearch}
                  onChange={e => setTemplateSearch(e.target.value)}
                />
              </div>
            </div>

            {/* Category tabs */}
            <div className="flex flex-wrap gap-1.5 mb-4">
              <UiButton
                variant="ghost"
                size="sm"
                onClick={() => setTemplateCategory(null)}
                  className={cn('!text-[11px] border',
                    templateCategory === null ? 'bg-neon-cyan/10 border-neon-cyan/30 text-neon-cyan' : 'border-white/[0.08] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  )}
                >{t('notifications.alertStudio.templates.allCategory', 'All')} ({ruleTemplates.length})</UiButton>
              {templateCategories.map(cat => {
                const count = ruleTemplates.filter(t => t.category === cat).length
                return (
                  <UiButton
                    key={cat}
                    variant="ghost"
                    size="sm"
                    onClick={() => setTemplateCategory(cat === templateCategory ? null : cat)}
                    className={cn('!text-[11px] border',
                      templateCategory === cat ? 'bg-neon-cyan/10 border-neon-cyan/30 text-neon-cyan' : 'border-white/[0.08] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    )}
                  >{getTemplateCategory(cat)} ({count})</UiButton>
                )
              })}
            </div>

            {/* Template grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {filteredTemplates.map(tpl => {
                const Icon = tpl.icon
                const sev = severityConfig[tpl.severity]
                return (
                  <GlassPanel
                    key={tpl.name}
                    className="p-3 text-left hover:border-neon-cyan/30 transition-all group cursor-pointer"
                    onClick={() => handleCloneTemplate(tpl)}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className={cn('rounded-lg p-1.5', sev.bg)}>
                        <Icon className={cn('h-3.5 w-3.5', sev.color)} />
                      </div>
                      <span className="text-xs font-medium text-[var(--text-primary)] group-hover:text-neon-cyan transition-colors">{getTemplateName(tpl)}</span>
                    </div>
                    <p className="text-[10px] text-[var(--text-muted)] font-mono truncate">{getTemplateMessage(tpl)}</p>
                    <div className="flex items-center justify-between mt-1.5">
                      <Badge color={tpl.severity === 'critical' ? 'red' : tpl.severity === 'warning' ? 'amber' : 'cyan'} size="sm">
                        {t(`notifications.alertStudio.severity.${tpl.severity}`, tpl.severity)}
                      </Badge>
                      <div className="flex items-center gap-1">
                        <Copy className="h-3 w-3 text-[var(--text-muted)]" />
                        <span className="text-[10px] text-[var(--text-muted)]">{t('notifications.alertStudio.templates.use', 'Use')}</span>
                      </div>
                    </div>
                  </GlassPanel>
                )
              })}
              {filteredTemplates.length === 0 && (
                <p className="col-span-full text-sm text-[var(--text-muted)] py-8 text-center">
                  {t('notifications.alertStudio.templates.noMatches', 'No templates match your search')}
                </p>
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
              <p className="text-sm font-medium text-[var(--text-primary)]">{t('notifications.alertStudio.rules.title', 'Rules')}</p>
              <span className="text-[10px] text-[var(--text-muted)]">{rulesCountLabel}</span>
            </div>

            {cepRules.length > 3 && (
              <div className="relative mb-3">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
                <UiInput
                  type="text"
                  placeholder={t('notifications.alertStudio.rules.searchPlaceholder', 'Search rules...')}
                  value={ruleSearch}
                  onChange={e => setRuleSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-white/[0.04] border border-white/[0.06] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-neon-cyan/30"
                />
              </div>
            )}

            {isLoading && (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-lg" />)}
              </div>
            )}

            {!isLoading && cepRules.length === 0 && (
              <EmptyState
                icon={<Bell className="h-8 w-8 text-[var(--text-muted)]" />}
                title={t('notifications.alertStudio.rules.emptyTitle', 'No CEP rules yet')}
                message={t('notifications.alertStudio.rules.emptyDescription', 'Create your first rule or pick a template above.')}
              />
            )}

            {!isLoading && cepRules.length > 0 && filteredRules.length === 0 && (
              <p className="text-xs text-center text-[var(--text-muted)] py-4">
                {t('notifications.alertStudio.rules.noMatches', 'No rules match "{{search}}"', { search: ruleSearch })}
              </p>
            )}

            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {filteredRules.map(rule => {
                const sev = severityConfig[normalizeSeverity(rule.severity)]
                const SevIcon = sev.icon
                const active = selectedId === rule.id
                return (
                  <GlassPanel
                    key={rule.id}
                    className={cn(
                      'group p-3 transition-all',
                      active ? 'border-neon-cyan/30 bg-neon-cyan/5' : 'hover:border-white/10',
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <div
                        role="button"
                        tabIndex={0}
                        className="min-w-0 flex-1 cursor-pointer"
                        onClick={() => handleSelectRule(rule)}
                        onKeyDown={event => handleRuleRowKeyDown(event, rule)}
                      >
                        <div className="flex items-center gap-2">
                          <SevIcon className={cn('h-3.5 w-3.5 shrink-0', sev.color)} />
                          <span className="text-xs font-medium text-[var(--text-primary)] truncate flex-1">{rule.name || untitledRuleLabel}</span>
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
                      </div>
                      <UiButton
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 shrink-0 p-0"
                        onClick={e => { e.stopPropagation(); toggleMut.mutate({ id: rule.id, enabled: !rule.enabled }) }}
                        title={rule.enabled
                          ? t('notifications.alertStudio.rules.disable', 'Disable')
                          : t('notifications.alertStudio.rules.enable', 'Enable')}
                        aria-label={rule.enabled
                          ? t('notifications.alertStudio.rules.disableRule', 'Disable rule')
                          : t('notifications.alertStudio.rules.enableRule', 'Enable rule')}
                      >
                        {rule.enabled
                          ? <Bell className="h-3.5 w-3.5 text-neon-green" />
                          : <BellOff className="h-3.5 w-3.5 text-[var(--text-muted)]" />}
                      </UiButton>
                      <UiButton
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 shrink-0 p-0 opacity-0 transition-opacity group-hover:opacity-100 hover:text-neon-red"
                        onClick={e => {
                          e.stopPropagation()
                          if (confirm(t('notifications.alertStudio.rules.confirmDelete', 'Delete "{{name}}"?', { name: rule.name || untitledRuleLabel }))) {
                            deleteMut.mutate(rule.id)
                          }
                        }}
                        title={t('notifications.alertStudio.rules.deleteRule', 'Delete rule')}
                        aria-label={t('notifications.alertStudio.rules.deleteRule', 'Delete rule')}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-[var(--text-muted)] hover:text-neon-red" />
                      </UiButton>
                    </div>
                  </GlassPanel>
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
                {isEditing
                  ? t('notifications.alertStudio.editor.editTitle', 'Edit Rule')
                  : t('notifications.alertStudio.editor.newTitle', 'New Rule')}
              </p>
            </div>

            {/* Name */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-medium">
                  {t('notifications.alertStudio.editor.nameLabel', 'Name')}
                </label>
                <UiInput
                  className="w-full"
                  placeholder={t('notifications.alertStudio.editor.namePlaceholder', 'My alert rule')}
                  value={editor.name}
                  onChange={e => setEditor(s => ({ ...s, name: e.target.value }))}
                />
              </div>

              {/* Severity */}
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-medium">
                  {t('notifications.alertStudio.editor.severityLabel', 'Severity')}
                </label>
                <UiSelect
                  className="w-full"
                  value={editor.severity}
                  onChange={e => setEditor(s => ({ ...s, severity: e.target.value as Severity }))}
                  options={severityOptions}
                />
              </div>
            </div>

            {/* Cooldown + Message template */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-medium">
                  {t('notifications.alertStudio.editor.cooldownLabel', 'Cooldown (minutes)')}
                </label>
                <UiInput
                  type="number"
                  min={0}
                  className="w-full"
                  value={editor.cooldown_min}
                  onChange={e => setEditor(s => ({ ...s, cooldown_min: Number(e.target.value) || 0 }))}
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-medium">
                  {t('notifications.alertStudio.editor.messageTemplateLabel', 'Message Template')}
                  <span className="text-[var(--text-muted)] ml-1 normal-case tracking-normal">
                    {t('notifications.alertStudio.editor.signalHint', 'Use {{SignalName}}')}
                  </span>
                </label>
                <UiInput
                  className="w-full"
                  placeholder={t('notifications.alertStudio.editor.messageTemplatePlaceholder', 'Battery at {{BatteryLevel}}%')}
                  value={editor.msg_template}
                  onChange={e => setEditor(s => ({ ...s, msg_template: e.target.value }))}
                />
              </div>
            </div>

            {/* Notification delivery */}
            <div className="mb-4">
              <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2 font-medium">
                {t('notifications.alertStudio.channels.deliveryLabel', "How You'll Be Notified")}
              </label>
              <div className="space-y-2">
                {/* Always-on: SSE + DB */}
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-full bg-neon-green" />
                  <span className="text-white/90">
                    {t('notifications.alertStudio.channels.browserToast', 'Browser toast notification (real-time via SSE)')}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-full bg-neon-green" />
                  <span className="text-white/90">
                    {t('notifications.alertStudio.channels.alertHistory', 'Alert history (saved to database)')}
                  </span>
                </div>

                {/* Channels */}
                <GlassPanel className="p-3">
                  {channels && channels.length > 0 ? (
                    <div>
                      <p className="text-xs text-[var(--text-muted)] mb-1.5">
                        {t('notifications.alertStudio.channels.externalChannels', 'External channels (click to toggle):')}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {channels.map(ch => {
                          const isSelected = editor.notify_channels.includes(ch.id)
                          return (
                            <UiButton
                              key={ch.id}
                              type="button"
                              variant="ghost"
                              size="sm"
                              className={cn(
                                'h-auto rounded-lg border px-3 py-1.5 text-xs transition-colors',
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
                              <Bell className="h-3 w-3" />
                              {ch.name} ({t(`notifications.alertStudio.channels.kind.${ch.kind}`, ch.kind)})
                            </UiButton>
                          )
                        })}
                      </div>
                    </div>
                  ) : (
                    <EmptyState
                      icon={<BellOff className="h-8 w-8 text-[var(--text-muted)]" />}
                      title={t('notifications.alertStudio.channels.emptyTitle', 'No external channels configured')}
                      message={t('notifications.alertStudio.channels.emptyDescription', 'Browser toasts and alert history are always enabled. Configure Discord, Slack, ntfy, or webhooks from Notifications to fan out alerts.')}
                    />
                  )}
                </GlassPanel>
              </div>
            </div>

            {/* Condition builder */}
            <div className="mb-4">
              <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2 font-medium">
                {t('notifications.alertStudio.editor.conditionsLabel', 'Conditions')}
              </label>
              <RuleBuilder
                value={editor.conditions}
                onChange={conditions => setEditor(s => ({ ...s, conditions }))}
              />
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 pt-2 border-t border-white/5">
              <UiButton
                variant="primary"
                size="sm"
                icon={<Save className="h-3.5 w-3.5" />}
                loading={saveMut.isPending}
                onClick={() => saveMut.mutate(editor)}
                disabled={!editor.name.trim()}
              >
                {saveMut.isPending
                  ? t('notifications.alertStudio.actions.saving', 'Saving...')
                  : isEditing
                    ? t('notifications.alertStudio.actions.updateRule', 'Update Rule')
                    : t('notifications.alertStudio.actions.createRule', 'Create Rule')}
              </UiButton>

              {isEditing && (
                <UiButton
                  variant="danger"
                  size="sm"
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  onClick={() => { if (editor.id) deleteMut.mutate(editor.id) }}
                >
                  {t('notifications.alertStudio.actions.delete', 'Delete')}
                </UiButton>
              )}

              <UiButton
                variant="secondary"
                size="sm"
                icon={<Bell className="h-3.5 w-3.5" />}
                onClick={async () => {
                  try {
                    await request('/alerts/test', {
                      method: 'POST',
                      body: JSON.stringify({
                        name: editor.name || t('notifications.alertStudio.test.defaultRuleName', 'Test Rule'),
                        severity: editor.severity,
                        msg_template: editor.msg_template || t('notifications.alertStudio.test.defaultMessage', 'Test notification from Alert Studio'),
                        notify_channels: editor.notify_channels,
                      }),
                    })
                    toast.success(
                      t('notifications.alertStudio.toasts.testSent', 'Test sent!'),
                      t('notifications.alertStudio.toasts.testSentDescription', 'Check your browser toast and Discord/Slack'),
                    )
                  } catch (error) {
                    toast.error(
                      t('notifications.alertStudio.toasts.testFailed', 'Test failed'),
                      error instanceof Error
                        ? error.message
                        : t('notifications.alertStudio.toasts.testFailedDescription', 'Could not send test notification'),
                    )
                  }
                }}
                disabled={!editor.name.trim()}
              >
                {t('notifications.alertStudio.actions.test', 'Test')}
              </UiButton>

              <UiButton variant="ghost" size="sm" onClick={handleNewRule} className="ml-auto">
                {t('notifications.alertStudio.actions.reset', 'Reset')}
              </UiButton>
            </div>
          </GlassPanel>
        </div>
      </div>
    </PageContainer>
  )
}


