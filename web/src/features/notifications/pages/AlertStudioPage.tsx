/**
 * AlertStudio - typed alert-rule editor page.
 *
 * Lists existing rules, provides typed templates, and persists through the
 * /api/v1/alerts/rules endpoint using the current alert-rule contract.
 */

import { useState, useMemo, useCallback, type ElementType, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type AlertRule,
  type AlertRuleInput,
  type AlertRuleTriggerMode,
  type AlertTestTarget,
  useAlertRules,
  useDeleteAlertRule,
  useNotificationChannels,
  useSaveAlertRule,
  useSnoozeAlertRule,
  useTestAlertRule,
  useToggleAlertRule,
} from '@/api/hooks/useNotifications'
import type { SignalValueType } from '@/types/signals'
import { GlassPanel, Badge, Button as UiButton, ConfirmDialog, Input as UiInput, Select as UiSelect, Modal } from '@/components/ui'
import { SeverityBadge, SeverityIcon } from '@/components/data-display'
import { PageContainer } from '@/components/layout'
import { FadeIn } from '@/components/motion'
import { EmptyState, ErrorDisplay, Skeleton } from '@/components/feedback'
import {
  Zap, Plus, Save, Trash2, Copy, Bell, BellOff,
  Info, Battery, Gauge, Lock,
  Car, Droplets, Clock, Pencil, Sparkles, Thermometer, Shield, Search,
  MoonStar,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { severityTokens } from '@/lib/tokens'
import { formatDateTime } from '@/lib/dateFormat'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useConfirm } from '@/hooks/useConfirm'

type Severity = NonNullable<AlertRuleInput['severity']>
type RuleOp = AlertRuleInput['op']
type ValueKind = 'none' | 'number' | 'text' | 'bool' | 'range'

interface RuleTemplate {
  name: string
  icon: ElementType
  category: string
  severity: Severity
  message: string
  cooldown_min: number
  signal_name: string
  op: RuleOp
  value_num?: number
  value_text?: string
  value_bool?: boolean
  value_min?: number
  value_max?: number
}

interface SignalDefinition {
  name: string
  category: string
  value_type: SignalValueType
}

const ruleTemplates: RuleTemplate[] = [
  { name: 'Battery Low (< 20%)', icon: Battery, category: 'Battery', severity: 'warn', message: 'Battery at {{BatteryLevel}}%', cooldown_min: 30, signal_name: 'BatteryLevel', op: '<', value_num: 20 },
  { name: 'Battery Critical (< 10%)', icon: Battery, category: 'Battery', severity: 'critical', message: 'Battery critically low at {{BatteryLevel}}%!', cooldown_min: 15, signal_name: 'BatteryLevel', op: '<', value_num: 10 },
  { name: 'Battery Full (>= 90%)', icon: Battery, category: 'Battery', severity: 'info', message: 'Battery reached {{BatteryLevel}}%', cooldown_min: 60, signal_name: 'BatteryLevel', op: '>=', value_num: 90 },
  { name: 'Charge Limit Reached', icon: Battery, category: 'Battery', severity: 'info', message: 'Battery at charge limit {{ChargeLimitSoc}}%', cooldown_min: 60, signal_name: 'BatteryLevel', op: '>=', value_num: 80 },
  { name: 'Range Below 50 km', icon: Battery, category: 'Battery', severity: 'warn', message: 'Range low: {{RatedRange}} km remaining', cooldown_min: 30, signal_name: 'RatedRange', op: '<', value_num: 50 },

  { name: 'Charge Complete', icon: Zap, category: 'Charging', severity: 'info', message: 'Charging complete at {{BatteryLevel}}%', cooldown_min: 60, signal_name: 'ChargeState', op: '=', value_text: 'Complete' },
  { name: 'Charging Started', icon: Zap, category: 'Charging', severity: 'info', message: 'Charging started - {{DetailedChargeState}}', cooldown_min: 15, signal_name: 'DetailedChargeState', op: '=', value_text: 'Charging' },
  { name: 'Charging Stopped Unexpectedly', icon: Zap, category: 'Charging', severity: 'warn', message: 'Charging stopped - {{DetailedChargeState}}', cooldown_min: 30, signal_name: 'DetailedChargeState', op: '=', value_text: 'Stopped' },
  { name: 'Supercharging (DC Fast)', icon: Zap, category: 'Charging', severity: 'info', message: 'Supercharging at {{DCChargingPower}} kW', cooldown_min: 30, signal_name: 'DCChargingPower', op: '>', value_num: 50 },
  { name: 'Slow Charge Rate', icon: Zap, category: 'Charging', severity: 'warn', message: 'Charging slow: {{ChargeAmps}}A', cooldown_min: 60, signal_name: 'ChargeAmps', op: 'between', value_min: 0.01, value_max: 5 },

  { name: 'Drive Started', icon: Car, category: 'Driving', severity: 'info', message: 'Drive started - gear is {{Gear}}', cooldown_min: 5, signal_name: 'Gear', op: '=', value_text: 'D' },
  { name: 'Drive Ended', icon: Car, category: 'Driving', severity: 'info', message: 'Drive ended - gear is {{Gear}}', cooldown_min: 5, signal_name: 'Gear', op: '=', value_text: 'P' },
  { name: 'Speed Limit Exceeded', icon: Gauge, category: 'Driving', severity: 'warn', message: 'Speed {{VehicleSpeed}} km/h exceeded limit', cooldown_min: 15, signal_name: 'VehicleSpeed', op: '>', value_num: 120 },
  { name: 'High Speed Alert (> 160 km/h)', icon: Gauge, category: 'Driving', severity: 'critical', message: 'Very high speed: {{VehicleSpeed}} km/h!', cooldown_min: 5, signal_name: 'VehicleSpeed', op: '>', value_num: 160 },
  { name: 'Reverse Gear Engaged', icon: Car, category: 'Driving', severity: 'info', message: 'Vehicle in reverse', cooldown_min: 5, signal_name: 'Gear', op: '=', value_text: 'R' },
  { name: 'Odometer Milestone (100k km)', icon: Car, category: 'Driving', severity: 'info', message: 'Odometer: {{Odometer}} km', cooldown_min: 1440, signal_name: 'Odometer', op: '>', value_num: 100000 },

  { name: 'Car Unlocked While Parked', icon: Lock, category: 'Security', severity: 'critical', message: 'Vehicle is unlocked and parked!', cooldown_min: 30, signal_name: 'Locked', op: '=', value_bool: false },
  { name: 'Vehicle Locked', icon: Lock, category: 'Security', severity: 'info', message: 'Vehicle locked', cooldown_min: 5, signal_name: 'Locked', op: '=', value_bool: true },
  { name: 'Vehicle Unlocked', icon: Lock, category: 'Security', severity: 'info', message: 'Vehicle unlocked', cooldown_min: 5, signal_name: 'Locked', op: '=', value_bool: false },
  { name: 'Sentry Mode Activated', icon: Shield, category: 'Security', severity: 'info', message: 'Sentry mode activated', cooldown_min: 30, signal_name: 'SentryMode', op: '=', value_bool: true },
  { name: 'Door Opened While Parked', icon: Lock, category: 'Security', severity: 'warn', message: 'Door opened - {{DoorState}}', cooldown_min: 15, signal_name: 'DoorState', op: '!=', value_text: 'Closed' },
  { name: 'Window Left Open', icon: Car, category: 'Security', severity: 'warn', message: 'Front driver window is {{FdWindow}}', cooldown_min: 60, signal_name: 'FdWindow', op: '!=', value_text: 'Closed' },
  { name: 'Valet Mode Enabled', icon: Shield, category: 'Security', severity: 'info', message: 'Valet mode enabled', cooldown_min: 60, signal_name: 'ValetModeEnabled', op: '=', value_bool: true },
  { name: 'Guest Mode Enabled', icon: Shield, category: 'Security', severity: 'warn', message: 'Guest mode enabled', cooldown_min: 60, signal_name: 'GuestModeEnabled', op: '=', value_bool: true },

  { name: 'Cabin Overheat (> 40C)', icon: Thermometer, category: 'Climate', severity: 'warn', message: 'Cabin temp: {{InsideTemp}}C', cooldown_min: 30, signal_name: 'InsideTemp', op: '>', value_num: 40 },
  { name: 'Cabin Freezing (< 0C)', icon: Thermometer, category: 'Climate', severity: 'warn', message: 'Cabin temp: {{InsideTemp}}C - freezing!', cooldown_min: 60, signal_name: 'InsideTemp', op: '<', value_num: 0 },
  { name: 'HVAC Left On While Parked', icon: Thermometer, category: 'Climate', severity: 'info', message: 'HVAC running while parked', cooldown_min: 30, signal_name: 'HvacPower', op: '=', value_bool: true },
  { name: 'Climate Keeper Active', icon: Thermometer, category: 'Climate', severity: 'info', message: 'Climate keeper: {{ClimateKeeperMode}}', cooldown_min: 60, signal_name: 'ClimateKeeperMode', op: '!=', value_text: 'Off' },
  { name: 'Steering Wheel Heater On', icon: Thermometer, category: 'Climate', severity: 'info', message: 'Steering wheel heater level {{HvacSteeringWheelHeatLevel}}', cooldown_min: 30, signal_name: 'HvacSteeringWheelHeatLevel', op: '>', value_num: 0 },

  { name: 'Tire Pressure Low', icon: Droplets, category: 'Tire Pressure', severity: 'warn', message: 'Low tire pressure detected', cooldown_min: 60, signal_name: 'TpmsHardWarnings', op: '=', value_bool: true },
  { name: 'Tire Pressure Soft Warning', icon: Droplets, category: 'Tire Pressure', severity: 'info', message: 'Tire pressure slightly low', cooldown_min: 120, signal_name: 'TpmsSoftWarnings', op: '=', value_bool: true },
  { name: 'Front Left Tire Low (< 2.2 bar)', icon: Droplets, category: 'Tire Pressure', severity: 'warn', message: 'FL tire: {{TpmsPressureFl}} bar', cooldown_min: 60, signal_name: 'TpmsPressureFl', op: '<', value_num: 2.2 },

  { name: 'Arrived at Home', icon: Car, category: 'Location', severity: 'info', message: 'Vehicle arrived at home', cooldown_min: 15, signal_name: 'LocatedAtHome', op: '=', value_bool: true },
  { name: 'Left Home', icon: Car, category: 'Location', severity: 'info', message: 'Vehicle left home', cooldown_min: 15, signal_name: 'LocatedAtHome', op: '=', value_bool: false },
  { name: 'Arrived at Work', icon: Car, category: 'Location', severity: 'info', message: 'Vehicle arrived at work', cooldown_min: 15, signal_name: 'LocatedAtWork', op: '=', value_bool: true },
  { name: 'Navigation Started', icon: Car, category: 'Location', severity: 'info', message: 'Navigating to {{DestinationName}}', cooldown_min: 10, signal_name: 'DestinationName', op: 'changed' },

  { name: 'Driver Seatbelt Unbuckled', icon: Shield, category: 'Safety', severity: 'warn', message: 'Driver seatbelt unbuckled while driving!', cooldown_min: 5, signal_name: 'DriverSeatBelt', op: '=', value_bool: false },
  { name: 'Speed Limit Mode Active', icon: Shield, category: 'Safety', severity: 'info', message: 'Speed limit mode active', cooldown_min: 60, signal_name: 'SpeedLimitMode', op: '=', value_bool: true },
  { name: 'PIN to Drive Disabled', icon: Shield, category: 'Safety', severity: 'warn', message: 'PIN to Drive has been disabled', cooldown_min: 1440, signal_name: 'PinToDriveEnabled', op: '=', value_bool: false },

  { name: 'High Motor Temperature (> 80C)', icon: Thermometer, category: 'Motor', severity: 'warn', message: 'Motor stator temp: {{DiStatorTempF}}C', cooldown_min: 15, signal_name: 'DiStatorTempF', op: '>', value_num: 80 },
  { name: 'HVIL Fault', icon: Shield, category: 'Motor', severity: 'critical', message: 'HV interlock fault detected!', cooldown_min: 5, signal_name: 'Hvil', op: '=', value_text: 'Fault' },
  { name: 'High Regenerative Braking', icon: Zap, category: 'Motor', severity: 'info', message: 'Regen power: {{Power}} kW', cooldown_min: 15, signal_name: 'Power', op: '<', value_num: -50 },

  { name: 'Software Update Available', icon: Zap, category: 'Software', severity: 'info', message: 'Update available: {{SoftwareUpdateVersion}}', cooldown_min: 1440, signal_name: 'SoftwareUpdateVersion', op: 'changed' },
  { name: 'Software Update Installing', icon: Zap, category: 'Software', severity: 'info', message: 'Installing update: {{SoftwareUpdateInstallationPercentComplete}}%', cooldown_min: 30, signal_name: 'SoftwareUpdateInstallationPercentComplete', op: '>', value_num: 0 },

  { name: 'Music Playing', icon: Car, category: 'Media', severity: 'info', message: 'Now playing: {{MediaNowPlayingTitle}} by {{MediaNowPlayingArtist}}', cooldown_min: 60, signal_name: 'MediaPlaybackStatus', op: '=', value_text: 'Playing' },
  { name: 'Volume Too High', icon: Car, category: 'Media', severity: 'info', message: 'Volume at {{MediaAudioVolume}}', cooldown_min: 30, signal_name: 'MediaAudioVolume', op: '>', value_num: 8 },

  { name: 'Powershare Active', icon: Zap, category: 'Powershare', severity: 'info', message: 'Powershare active: {{PowershareInstantaneousPowerKW}} kW', cooldown_min: 60, signal_name: 'PowershareStatus', op: 'changed' },
]

const templateCategories = [...new Set(ruleTemplates.map(t => t.category))].sort()

const numericOperatorOptions: RuleOp[] = ['=', '!=', '<', '<=', '>', '>=', 'changed', 'between', 'outside']
const scalarOperatorOptions: RuleOp[] = ['=', '!=', 'changed']
const customSignalCategory = '__custom__'

interface EditorState {
  id?: number
  name: string
  enabled: boolean
  vehicle_id: string
  signal_name: string
  op: RuleOp
  value_kind: ValueKind
  value_num: string
  value_text: string
  value_bool: boolean
  value_min: string
  value_max: string
  severity: Severity
  cooldown_min: number
  trigger_mode: AlertRuleTriggerMode
  message: string
}

function freshEditor(): EditorState {
  return {
    name: '',
    enabled: true,
    vehicle_id: '',
    signal_name: '',
    op: '=',
    value_kind: 'number',
    value_num: '',
    value_text: '',
    value_bool: true,
    value_min: '',
    value_max: '',
    severity: 'warn',
    cooldown_min: 15,
    trigger_mode: 'repeat',
    message: '',
  }
}

function isTriggerMode(value: string | null | undefined): value is AlertRuleTriggerMode {
  return value === 'once' || value === 'repeat'
}

function normalizeTriggerMode(value: string | null | undefined): AlertRuleTriggerMode {
  return isTriggerMode(value) ? value : 'repeat'
}

function isSnoozeActive(snoozedUntil: string | null | undefined): boolean {
  if (!snoozedUntil) return false
  const ms = Date.parse(snoozedUntil)
  return Number.isFinite(ms) && ms > Date.now()
}

function isSeverity(value: string | null | undefined): value is Severity {
  return value === 'info' || value === 'warn' || value === 'critical'
}

function normalizeSeverity(value: string | null | undefined): Severity {
  if (isSeverity(value)) return value
  return value === 'warning' ? 'warn' : 'info'
}

function templateKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
}

function valueToInput(value: number | null | undefined): string {
  return value == null ? '' : String(value)
}

function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function parseOptionalVehicleID(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function hasValidVehicleID(value: string): boolean {
  return value.trim() === '' || parseOptionalVehicleID(value) !== null
}

function isNumericOnlyOp(op: RuleOp): boolean {
  return op === '<' || op === '<=' || op === '>' || op === '>='
}

function isRangeOp(op: RuleOp): boolean {
  return op === 'between' || op === 'outside'
}

function inferTemplateSignalType(template: RuleTemplate): SignalValueType {
  if (
    template.value_num != null
    || template.value_min != null
    || template.value_max != null
    || isNumericOnlyOp(template.op)
    || isRangeOp(template.op)
  ) {
    return 'numeric'
  }
  if (template.value_bool != null) return 'bool'
  return 'text'
}

function mergeSignalType(current: SignalValueType, next: SignalValueType): SignalValueType {
  if (current === next) return current
  if (current === 'numeric' || next === 'numeric') return 'numeric'
  if (current === 'bool' || next === 'bool') return 'bool'
  return 'text'
}

function buildSignalCatalog(templates: RuleTemplate[]): SignalDefinition[] {
  const byName = new Map<string, SignalDefinition>()
  templates.forEach(template => {
    const valueType = inferTemplateSignalType(template)
    const existing = byName.get(template.signal_name)
    if (existing) {
      existing.value_type = mergeSignalType(existing.value_type, valueType)
      return
    }
    byName.set(template.signal_name, {
      name: template.signal_name,
      category: template.category,
      value_type: valueType,
    })
  })
  return [...byName.values()].sort((a, b) => (
    a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
  ))
}

const signalCatalog = buildSignalCatalog(ruleTemplates)
const signalCatalogByName = new Map(signalCatalog.map(signal => [signal.name, signal]))

function signalTypeForValueKind(valueKind: ValueKind): SignalValueType {
  if (valueKind === 'bool') return 'bool'
  if (valueKind === 'text' || valueKind === 'none') return 'text'
  return 'numeric'
}

function signalTypeForName(signalName: string, fallbackKind: ValueKind): SignalValueType {
  return signalCatalogByName.get(signalName)?.value_type ?? signalTypeForValueKind(fallbackKind)
}

function allowedOpsForSignalType(valueType: SignalValueType): RuleOp[] {
  return valueType === 'numeric' ? numericOperatorOptions : scalarOperatorOptions
}

function coerceOperatorForSignalType(op: RuleOp, valueType: SignalValueType): RuleOp {
  return allowedOpsForSignalType(valueType).includes(op) ? op : '='
}

function valueKindForSignalOp(valueType: SignalValueType, op: RuleOp): ValueKind {
  if (op === 'changed') return 'none'
  if (valueType === 'numeric') return isRangeOp(op) ? 'range' : 'number'
  if (valueType === 'bool') return 'bool'
  return 'text'
}

function valueKindForState(state: Pick<EditorState, 'signal_name' | 'op' | 'value_kind'>): ValueKind {
  return valueKindForSignalOp(signalTypeForName(state.signal_name, state.value_kind), state.op)
}

function isOperatorAllowedForState(state: Pick<EditorState, 'signal_name' | 'op' | 'value_kind'>): boolean {
  return allowedOpsForSignalType(signalTypeForName(state.signal_name, state.value_kind)).includes(state.op)
}

function inferValueKind(rule: Pick<AlertRule, 'op' | 'value_num' | 'value_text' | 'value_bool' | 'value_min' | 'value_max'>): ValueKind {
  if (isRangeOp(rule.op) || rule.value_min != null || rule.value_max != null) return 'range'
  if (rule.value_bool != null) return 'bool'
  if (rule.value_text != null) return 'text'
  if (rule.value_num != null) return 'number'
  return rule.op === 'changed' ? 'none' : 'number'
}

function inferTemplateValueKind(template: RuleTemplate): ValueKind {
  return valueKindForSignalOp(inferTemplateSignalType(template), template.op)
}

function ruleToEditor(rule: AlertRule): EditorState {
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    vehicle_id: rule.vehicle_id == null ? '' : String(rule.vehicle_id),
    signal_name: rule.signal_name,
    op: rule.op,
    value_kind: inferValueKind(rule),
    value_num: valueToInput(rule.value_num),
    value_text: rule.value_text ?? '',
    value_bool: rule.value_bool ?? true,
    value_min: valueToInput(rule.value_min),
    value_max: valueToInput(rule.value_max),
    severity: normalizeSeverity(rule.severity),
    cooldown_min: rule.cooldown_min,
    trigger_mode: normalizeTriggerMode(rule.trigger_mode),
    message: rule.signal_name ? `${rule.name}: {{${rule.signal_name}}}` : '',
  }
}

function templateToEditor(template: RuleTemplate, name: string, message: string): EditorState {
  return {
    ...freshEditor(),
    name,
    signal_name: template.signal_name,
    op: template.op,
    value_kind: inferTemplateValueKind(template),
    value_num: valueToInput(template.value_num),
    value_text: template.value_text ?? '',
    value_bool: template.value_bool ?? true,
    value_min: valueToInput(template.value_min),
    value_max: valueToInput(template.value_max),
    severity: template.severity,
    cooldown_min: template.cooldown_min,
    message,
  }
}

function buildSavePayload(state: EditorState): AlertRuleInput {
  const valueKind = valueKindForState(state)
  const payload: AlertRuleInput = {
    name: state.name.trim(),
    enabled: state.enabled,
    vehicle_id: parseOptionalVehicleID(state.vehicle_id),
    signal_name: state.signal_name.trim(),
    op: state.op,
    value_num: null,
    value_text: null,
    value_bool: null,
    value_min: null,
    value_max: null,
    severity: state.severity,
    cooldown_min: state.cooldown_min,
    trigger_mode: state.trigger_mode,
  }

  if (valueKind === 'number') {
    payload.value_num = parseOptionalNumber(state.value_num)
  } else if (valueKind === 'text') {
    payload.value_text = state.value_text.trim()
  } else if (valueKind === 'bool') {
    payload.value_bool = state.value_bool
  } else if (valueKind === 'range') {
    payload.value_min = parseOptionalNumber(state.value_min)
    payload.value_max = parseOptionalNumber(state.value_max)
  }

  return payload
}

function hasRequiredTypedValue(state: EditorState): boolean {
  const valueKind = valueKindForState(state)
  if (valueKind === 'none') return state.op === 'changed'
  if (valueKind === 'bool') return true
  if (valueKind === 'text') return state.value_text.trim().length > 0
  if (valueKind === 'number') return parseOptionalNumber(state.value_num) !== null
  const valueMin = parseOptionalNumber(state.value_min)
  const valueMax = parseOptionalNumber(state.value_max)
  return valueMin !== null && valueMax !== null && valueMin <= valueMax
}

function buildTestTarget(selectedIds: number[] | null, allIds: number[]): AlertTestTarget | null {
  if (allIds.length === 0) return null
  if (selectedIds === null) return { all_channels: true }
  return { channel_ids: selectedIds }
}

export default function AlertStudio() {
  const { t } = useTranslation()
  const pageTitle = t('notifications.alertStudio.title', 'Alert Studio')
  const pageSubtitle = t('notifications.alertStudio.subtitle', 'Create custom rules from Fleet Telemetry signals')
  const untitledRuleLabel = t('notifications.alertStudio.rules.untitled', 'Untitled')
  usePageTitle(pageTitle)

  const { data: rules, isLoading, error } = useAlertRules()
  const { data: channels, isLoading: channelsLoading, error: channelsError } = useNotificationChannels()
  const saveRuleMut = useSaveAlertRule()
  const deleteRuleMut = useDeleteAlertRule()
  const toggleRuleMut = useToggleAlertRule()
  const testRuleMut = useTestAlertRule()
  const snoozeRuleMut = useSnoozeAlertRule()
  const [snoozeTargetId, setSnoozeTargetId] = useState<number | null>(null)
  const { confirm: confirmDelete, dialogProps: deleteDialogProps } = useConfirm()

  const [editor, setEditor] = useState<EditorState>(freshEditor)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [showTemplates, setShowTemplates] = useState(false)
  const [templateSearch, setTemplateSearch] = useState('')
  const [templateCategory, setTemplateCategory] = useState<string | null>(null)
  const [ruleSearch, setRuleSearch] = useState('')
  const [testChannelIds, setTestChannelIds] = useState<number[] | null>(null)

  const getTemplateName = useCallback((tpl: RuleTemplate) => (
    t(`notifications.alertStudio.templates.${templateKey(tpl.name)}.name`, tpl.name)
  ), [t])

  const getTemplateMessage = useCallback((tpl: RuleTemplate) => (
    t(`notifications.alertStudio.templates.${templateKey(tpl.name)}.message`, tpl.message)
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
  const rulesList = rules ?? []
  const channelsList = channels ?? []
  const allChannelIds = useMemo(() => channelsList.map(ch => ch.id), [channelsList])
  const snoozeTargetRule = useMemo(
    () => (snoozeTargetId == null ? null : rulesList.find(r => r.id === snoozeTargetId) ?? null),
    [snoozeTargetId, rulesList],
  )
  const snoozeTargetActive = isSnoozeActive(snoozeTargetRule?.snoozed_until)

  const handleSnooze = useCallback(
    (id: number, minutes: number) => {
      snoozeRuleMut.mutate(
        { id, minutes },
        { onSuccess: () => setSnoozeTargetId(null) },
      )
    },
    [snoozeRuleMut],
  )

  const filteredRules = useMemo(() => {
    if (!ruleSearch) return rulesList
    const q = ruleSearch.toLowerCase()
    return rulesList.filter(r => (r.name || '').toLowerCase().includes(q))
  }, [rulesList, ruleSearch])

  const rulesCountLabel = rulesList.length === 1
    ? t('notifications.alertStudio.rules.countOne', '1 rule')
    : t('notifications.alertStudio.rules.countMany', '{{count}} rules', { count: rulesList.length })

  const severityOptions = useMemo(() => [
    { value: 'info', label: t('notifications.alertStudio.severity.info', 'Info') },
    { value: 'warn', label: t('notifications.alertStudio.severity.warn', 'Warning') },
    { value: 'critical', label: t('notifications.alertStudio.severity.critical', 'Critical') },
  ], [t])

  const enabledOptions = useMemo(() => [
    { value: 'true', label: t('notifications.alertStudio.editor.enabled', 'Enabled') },
    { value: 'false', label: t('notifications.alertStudio.editor.disabled', 'Disabled') },
  ], [t])

  const triggerModeOptions = useMemo(() => [
    { value: 'repeat', label: t('notifications.alertStudio.editor.triggerMode.repeat', 'Every cooldown while true (default)') },
    { value: 'once', label: t('notifications.alertStudio.editor.triggerMode.once', 'Once, until condition resets') },
  ], [t])

  const signalTypeLabels = useMemo<Record<SignalValueType, string>>(() => ({
    numeric: t('notifications.alertStudio.signalTypes.numeric', 'Numeric'),
    text: t('notifications.alertStudio.signalTypes.text', 'Text'),
    bool: t('notifications.alertStudio.signalTypes.bool', 'Boolean'),
  }), [t])

  const getSignalCategoryLabel = useCallback((category: string) => (
    category === customSignalCategory
      ? t('notifications.alertStudio.signalCategories.custom', 'Custom')
      : getTemplateCategory(category)
  ), [getTemplateCategory, t])

  const selectedSignal = useMemo<SignalDefinition | null>(() => {
    const knownSignal = signalCatalogByName.get(editor.signal_name)
    if (knownSignal) return knownSignal
    const signalName = editor.signal_name.trim()
    if (!signalName) return null
    return {
      name: signalName,
      category: customSignalCategory,
      value_type: signalTypeForValueKind(editor.value_kind),
    }
  }, [editor.signal_name, editor.value_kind])

  const selectedSignalType = selectedSignal?.value_type ?? 'numeric'

  const signalSelectOptions = useMemo(() => {
    const options = signalCatalog.map(signal => ({
      value: signal.name,
      label: t('notifications.alertStudio.signals.optionLabel', '{{name}} - {{type}} - {{category}}', {
        name: signal.name,
        type: signalTypeLabels[signal.value_type],
        category: getSignalCategoryLabel(signal.category),
      }),
    }))
    if (!selectedSignal || signalCatalogByName.has(selectedSignal.name)) return options
    return [
      {
        value: selectedSignal.name,
        label: t('notifications.alertStudio.signals.customOptionLabel', '{{name}} - {{type}} - Custom', {
          name: selectedSignal.name,
          type: signalTypeLabels[selectedSignal.value_type],
        }),
      },
      ...options,
    ]
  }, [getSignalCategoryLabel, selectedSignal, signalTypeLabels, t])

  const operatorSelectOptions = useMemo(() => allowedOpsForSignalType(selectedSignalType).map(op => ({
    value: op,
    label: t(`notifications.alertStudio.operators.${op}`, op),
  })), [selectedSignalType, t])

  const boolOptions = useMemo(() => [
    { value: 'true', label: t('notifications.alertStudio.boolean.true', 'True') },
    { value: 'false', label: t('notifications.alertStudio.boolean.false', 'False') },
  ], [t])

  const canSave = useMemo(() => (
    editor.name.trim().length > 0
    && editor.signal_name.trim().length > 0
    && editor.cooldown_min > 0
    && hasValidVehicleID(editor.vehicle_id)
    && isOperatorAllowedForState(editor)
    && hasRequiredTypedValue(editor)
  ), [editor])

  const handleSelectRule = useCallback((rule: AlertRule) => {
    const nextEditor = ruleToEditor(rule)
    const signalType = signalTypeForName(nextEditor.signal_name, nextEditor.value_kind)
    const nextOp = coerceOperatorForSignalType(nextEditor.op, signalType)
    setSelectedId(rule.id)
    setEditor({
      ...nextEditor,
      op: nextOp,
      value_kind: valueKindForSignalOp(signalType, nextOp),
    })
  }, [])

  const handleNewRule = useCallback(() => {
    setSelectedId(null)
    setEditor(freshEditor())
  }, [])

  const handleCloneTemplate = useCallback((tpl: RuleTemplate) => {
    setSelectedId(null)
    setEditor(templateToEditor(tpl, getTemplateName(tpl), getTemplateMessage(tpl)))
    setShowTemplates(false)
  }, [getTemplateMessage, getTemplateName])

  const handleSignalChange = useCallback((signalName: string) => {
    setEditor(current => {
      const signalType = signalName
        ? signalTypeForName(signalName, current.value_kind)
        : 'numeric'
      const nextOp = coerceOperatorForSignalType(current.op, signalType)
      return {
        ...current,
        signal_name: signalName,
        op: nextOp,
        value_kind: valueKindForSignalOp(signalType, nextOp),
      }
    })
  }, [])

  const handleOperatorChange = useCallback((nextOp: RuleOp) => {
    setEditor(current => {
      const signalType = signalTypeForName(current.signal_name, current.value_kind)
      const coercedOp = coerceOperatorForSignalType(nextOp, signalType)
      return {
        ...current,
        op: coercedOp,
        value_kind: valueKindForSignalOp(signalType, coercedOp),
      }
    })
  }, [])

  const handleRuleRowKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>, rule: AlertRule) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleSelectRule(rule)
    }
  }, [handleSelectRule])

  const handleSave = useCallback(() => {
    if (!canSave) return
    const payload = buildSavePayload(editor)
    saveRuleMut.mutate(
      editor.id ? { id: editor.id, ...payload } : payload,
      {
        onSuccess: () => {
          setEditor(freshEditor())
          setSelectedId(null)
        },
      },
    )
  }, [canSave, editor, saveRuleMut])

  const handleDelete = useCallback((id: number) => {
    deleteRuleMut.mutate(id, {
      onSuccess: () => {
        setEditor(freshEditor())
        setSelectedId(null)
      },
    })
  }, [deleteRuleMut])

  const handleToggleTestChannel = useCallback((channelId: number) => {
    setTestChannelIds(current => {
      const selected = current ?? allChannelIds
      const next = selected.includes(channelId)
        ? selected.filter(id => id !== channelId)
        : [...selected, channelId]
      if (next.length === 0) return current
      return next.length === allChannelIds.length ? null : next
    })
  }, [allChannelIds])

  const handleTest = useCallback(() => {
    const message = editor.message.trim() || t('notifications.alertStudio.test.defaultMessage', 'Test notification from Alert Studio')
    const target = buildTestTarget(testChannelIds, allChannelIds)
    testRuleMut.mutate(target ? { message, target } : { message })
  }, [allChannelIds, editor.message, t, testChannelIds, testRuleMut])

  const renderValueEditor = () => {
    if (!editor.signal_name.trim()) {
      return (
        <EmptyState
          icon={<Info className="h-8 w-8 text-[var(--text-muted)]" />}
          title={t('notifications.alertStudio.editor.noSignalTitle', 'Choose a signal')}
          message={t('notifications.alertStudio.editor.noSignalDescription', 'Select a telemetry signal before entering a comparison value.')}
        />
      )
    }

    const valueKind = valueKindForState(editor)

    if (valueKind === 'range') {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-medium">
              {t('notifications.alertStudio.editor.minValueLabel', 'Minimum Value')}
            </label>
            <UiInput
              type="number"
              className="w-full"
              value={editor.value_min}
              onChange={e => setEditor(s => ({ ...s, value_min: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-medium">
              {t('notifications.alertStudio.editor.maxValueLabel', 'Maximum Value')}
            </label>
            <UiInput
              type="number"
              className="w-full"
              value={editor.value_max}
              onChange={e => setEditor(s => ({ ...s, value_max: e.target.value }))}
            />
          </div>
        </div>
      )
    }

    if (valueKind === 'text') {
      return (
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-medium">
            {t('notifications.alertStudio.editor.textValueLabel', 'Text Value')}
          </label>
          <UiInput
            className="w-full"
            placeholder={t('notifications.alertStudio.editor.textValuePlaceholder', 'Value to compare')}
            value={editor.value_text}
            onChange={e => setEditor(s => ({ ...s, value_text: e.target.value }))}
          />
        </div>
      )
    }

    if (valueKind === 'bool') {
      return (
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-medium">
            {t('notifications.alertStudio.editor.booleanValueLabel', 'Boolean Value')}
          </label>
          <UiSelect
            className="w-full"
            value={String(editor.value_bool)}
            onChange={e => setEditor(s => ({ ...s, value_bool: e.target.value === 'true' }))}
            options={boolOptions}
          />
        </div>
      )
    }

    if (valueKind === 'none') {
      return (
        <GlassPanel className="p-3">
          <p className="text-xs text-[var(--text-muted)]">
            {t('notifications.alertStudio.editor.anyChangeDescription', 'This rule fires whenever the selected signal changes.')}
          </p>
        </GlassPanel>
      )
    }

    return (
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-medium">
          {t('notifications.alertStudio.editor.numericValueLabel', 'Numeric Value')}
        </label>
        <UiInput
          type="number"
          className="w-full"
          value={editor.value_num}
          onChange={e => setEditor(s => ({ ...s, value_num: e.target.value }))}
        />
      </div>
    )
  }

  return (
    <PageContainer
      title={pageTitle}
      subtitle={pageSubtitle}
      loading={isLoading}
      error={error ?? null}
      actions={
        <>
          <UiButton variant="ghost" size="sm" icon={<Sparkles className="h-3.5 w-3.5 text-amber-300" />} onClick={() => setShowTemplates(!showTemplates)}>
            {t('notifications.alertStudio.actions.templates', 'Templates')}
          </UiButton>
          <UiButton variant="primary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={handleNewRule}>
            {t('notifications.alertStudio.actions.newRule', 'New Rule')}
          </UiButton>
        </>
      }
    >
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

            <div className="flex flex-wrap gap-1.5 mb-4">
              <UiButton
                variant="ghost"
                size="sm"
                onClick={() => setTemplateCategory(null)}
                className={cn(
                  '!text-[11px] border',
                  templateCategory === null
                    ? 'bg-neon-cyan/10 border-neon-cyan/30 text-neon-cyan'
                    : 'border-white/[0.08] text-[var(--text-muted)] hover:text-[var(--text-primary)]',
                )}
              >
                {t('notifications.alertStudio.templates.allCategory', 'All')} ({ruleTemplates.length})
              </UiButton>
              {templateCategories.map(cat => {
                const count = ruleTemplates.filter(t => t.category === cat).length
                return (
                  <UiButton
                    key={cat}
                    variant="ghost"
                    size="sm"
                    onClick={() => setTemplateCategory(cat === templateCategory ? null : cat)}
                    className={cn(
                      '!text-[11px] border',
                      templateCategory === cat
                        ? 'bg-neon-cyan/10 border-neon-cyan/30 text-neon-cyan'
                        : 'border-white/[0.08] text-[var(--text-muted)] hover:text-[var(--text-primary)]',
                    )}
                  >
                    {getTemplateCategory(cat)} ({count})
                  </UiButton>
                )
              })}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {filteredTemplates.map(tpl => {
                const Icon = tpl.icon
                const tokens = severityTokens[tpl.severity]
                return (
                  <GlassPanel
                    key={tpl.name}
                    className="p-3 text-left hover:border-neon-cyan/30 transition-all group cursor-pointer"
                    onClick={() => handleCloneTemplate(tpl)}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className={cn('rounded-lg p-1.5', tokens.bg)}>
                        <Icon className={cn('h-3.5 w-3.5', tokens.fg)} />
                      </div>
                      <span className="text-xs font-medium text-[var(--text-primary)] group-hover:text-cyan-300 transition-colors">{getTemplateName(tpl)}</span>
                    </div>
                    <p className="text-[10px] text-[var(--text-muted)] font-mono truncate">{getTemplateMessage(tpl)}</p>
                    <div className="flex items-center justify-between mt-1.5">
                      <SeverityBadge severity={tpl.severity} size="sm" showIcon={false}>
                        {t(`notifications.alertStudio.severity.${tpl.severity}`, tpl.severity === 'warn' ? 'Warning' : tpl.severity)}
                      </SeverityBadge>
                      <div className="flex items-center gap-1">
                        <Copy className="h-3 w-3 text-[var(--text-muted)]" />
                        <span className="text-[10px] text-[var(--text-muted)]">{t('notifications.alertStudio.templates.use', 'Use')}</span>
                      </div>
                    </div>
                  </GlassPanel>
                )
              })}
              {filteredTemplates.length === 0 && (
                <div className="col-span-full">
                  <EmptyState
                    icon={<Sparkles className="h-8 w-8 text-[var(--text-muted)]" />}
                    title={t('notifications.alertStudio.templates.noMatchesTitle', 'No templates found')}
                    message={t('notifications.alertStudio.templates.noMatches', 'No templates match your search')}
                  />
                </div>
              )}
            </div>
          </GlassPanel>
        </FadeIn>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 space-y-3">
          <GlassPanel className="p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-[var(--text-primary)]">{t('notifications.alertStudio.rules.title', 'Rules')}</p>
              <span className="text-[10px] text-[var(--text-muted)]">{rulesCountLabel}</span>
            </div>

            {rulesList.length > 3 && (
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

            {!isLoading && rulesList.length === 0 && (
              <EmptyState
                icon={<Bell className="h-8 w-8 text-[var(--text-muted)]" />}
                title={t('notifications.alertStudio.rules.emptyTitle', 'No alert rules yet')}
                message={t('notifications.alertStudio.rules.emptyDescription', 'Create your first rule or pick a template above.')}
              />
            )}

            {!isLoading && rulesList.length > 0 && filteredRules.length === 0 && (
              <EmptyState
                icon={<Search className="h-8 w-8 text-[var(--text-muted)]" />}
                title={t('notifications.alertStudio.rules.noMatchesTitle', 'No matching rules')}
                message={t('notifications.alertStudio.rules.noMatches', 'No rules match "{{search}}"', { search: ruleSearch })}
              />
            )}

            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {filteredRules.map(rule => {
                const sev = normalizeSeverity(rule.severity)
                const active = selectedId === rule.id
                const snoozed = isSnoozeActive(rule.snoozed_until)
                const triggerMode = normalizeTriggerMode(rule.trigger_mode)
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
                          <SeverityIcon severity={sev} className="h-3.5 w-3.5 shrink-0" />
                          <span className="text-xs font-medium text-[var(--text-primary)] truncate flex-1">{rule.name || untitledRuleLabel}</span>
                          {triggerMode === 'once' && (
                            <Badge variant="info" size="sm" title={t('notifications.alertStudio.rules.onceModeHint', 'Fires once until condition resets')}>
                              {t('notifications.alertStudio.rules.onceMode', 'Once')}
                            </Badge>
                          )}
                          {snoozed && rule.snoozed_until && (
                            <Badge variant="warning" size="sm">
                              <MoonStar className="h-3 w-3" />
                              {t('notifications.alertStudio.snooze.badge', 'Snoozed until {{time}}', { time: formatDateTime(rule.snoozed_until) })}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 text-[10px] text-[var(--text-muted)]">
                          <span className="font-mono">{rule.signal_name} {rule.op}</span>
                          {rule.updated_at && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" /> {formatDateTime(rule.updated_at)}
                            </span>
                          )}
                        </div>
                      </div>
                      <UiButton
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 shrink-0 p-0"
                        onClick={e => { e.stopPropagation(); setSnoozeTargetId(rule.id) }}
                        title={snoozed
                          ? t('notifications.alertStudio.snooze.manage', 'Manage snooze')
                          : t('notifications.alertStudio.snooze.button', 'Snooze')}
                        aria-label={snoozed
                          ? t('notifications.alertStudio.snooze.manage', 'Manage snooze')
                          : t('notifications.alertStudio.snooze.button', 'Snooze')}
                      >
                        <MoonStar className={cn('h-3.5 w-3.5', snoozed ? 'text-amber-300' : 'text-[var(--text-muted)]')} />
                      </UiButton>
                      <UiButton
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 shrink-0 p-0"
                        onClick={e => { e.stopPropagation(); toggleRuleMut.mutate({ id: rule.id, enabled: !rule.enabled }) }}
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
                        className="h-6 w-6 shrink-0 p-0 opacity-0 transition-opacity group-hover:opacity-100 hover:text-rose-300"
                        onClick={async e => {
                          e.stopPropagation()
                          const ruleName = rule.name || untitledRuleLabel
                          const ok = await confirmDelete({
                            title: t('notifications.alertStudio.rules.confirmDeleteTitle', 'Delete rule?'),
                            message: t('notifications.alertStudio.rules.confirmDelete', 'Delete "{{name}}"?', { name: ruleName }),
                            variant: 'danger',
                            confirmLabel: t('common.delete', 'Delete'),
                            cancelLabel: t('common.cancel', 'Cancel'),
                          })
                          if (ok) handleDelete(rule.id)
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
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-medium">
                  {t('notifications.alertStudio.editor.enabledLabel', 'Status')}
                </label>
                <UiSelect
                  className="w-full"
                  value={String(editor.enabled)}
                  onChange={e => setEditor(s => ({ ...s, enabled: e.target.value === 'true' }))}
                  options={enabledOptions}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-medium">
                  {t('notifications.alertStudio.editor.vehicleIdLabel', 'Vehicle ID')}
                  <span className="text-[var(--text-muted)] ml-1 normal-case tracking-normal">
                    {t('notifications.alertStudio.editor.optionalLabel', 'Optional')}
                  </span>
                </label>
                <UiInput
                  type="number"
                  min={1}
                  className="w-full"
                  placeholder={t('notifications.alertStudio.editor.vehicleIdPlaceholder', 'All vehicles')}
                  value={editor.vehicle_id}
                  onChange={e => setEditor(s => ({ ...s, vehicle_id: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-medium">
                  {t('notifications.alertStudio.editor.signalNameLabel', 'Signal')}
                </label>
                <UiSelect
                  className="w-full"
                  value={editor.signal_name}
                  onChange={e => handleSignalChange(e.target.value)}
                  placeholder={t('notifications.alertStudio.editor.signalNamePlaceholder', 'Select a telemetry signal')}
                  options={signalSelectOptions}
                />
                {selectedSignal && (
                  <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                    {t('notifications.alertStudio.editor.signalTypeHint', '{{type}} signal from {{category}}', {
                      type: signalTypeLabels[selectedSignal.value_type],
                      category: getSignalCategoryLabel(selectedSignal.category),
                    })}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-medium">
                  {t('notifications.alertStudio.editor.operatorLabel', 'Operator')}
                </label>
                <UiSelect
                  className="w-full"
                  value={editor.op}
                  onChange={e => handleOperatorChange(e.target.value as RuleOp)}
                  options={operatorSelectOptions}
                  disabled={!editor.signal_name.trim()}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
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
              <GlassPanel className="p-3">
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-medium">
                  {t('notifications.alertStudio.editor.allowedOperatorsLabel', 'Allowed Operators')}
                </p>
                <p className="text-xs text-[var(--text-primary)]">
                  {editor.signal_name.trim()
                    ? operatorSelectOptions.map(option => option.label).join('  ')
                    : t('notifications.alertStudio.editor.allowedOperatorsPlaceholder', 'Select a signal to see its operators')}
                </p>
              </GlassPanel>
            </div>

            <div className="mb-4">
              <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2 font-medium">
                {t('notifications.alertStudio.editor.typedValueLabel', 'Typed Value')}
              </label>
              {renderValueEditor()}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-medium">
                  {t('notifications.alertStudio.editor.cooldownLabel', 'Cooldown (minutes)')}
                </label>
                <UiInput
                  type="number"
                  min={1}
                  className="w-full"
                  value={editor.cooldown_min}
                  onChange={e => setEditor(s => ({ ...s, cooldown_min: Number(e.target.value) }))}
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-medium">
                  {t('notifications.alertStudio.editor.triggerModeLabel', 'Trigger Mode')}
                </label>
                <UiSelect
                  className="w-full"
                  value={editor.trigger_mode}
                  onChange={e => setEditor(s => ({ ...s, trigger_mode: normalizeTriggerMode(e.target.value) }))}
                  options={triggerModeOptions}
                />
                <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                  {editor.trigger_mode === 'once'
                    ? t(
                        'notifications.alertStudio.editor.triggerMode.onceHint',
                        'Fires once on the rising edge, then waits until the condition becomes false again before re-arming.',
                      )
                    : t(
                        'notifications.alertStudio.editor.triggerMode.repeatHint',
                        'Fires every {{cooldown}} minutes while the condition holds.',
                        { cooldown: editor.cooldown_min },
                      )}
                </p>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 font-medium">
                  {t('notifications.alertStudio.editor.testMessageLabel', 'Test Message')}
                  <span className="text-[var(--text-muted)] ml-1 normal-case tracking-normal">
                    {t('notifications.alertStudio.editor.signalHint', 'Use {{SignalName}}')}
                  </span>
                </label>
                <UiInput
                  className="w-full"
                  placeholder={t('notifications.alertStudio.editor.testMessagePlaceholder', 'Battery at {{BatteryLevel}}%')}
                  value={editor.message}
                  onChange={e => setEditor(s => ({ ...s, message: e.target.value }))}
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2 font-medium">
                {t('notifications.alertStudio.channels.testTargetLabel', 'Test Delivery Target')}
              </label>
              <div className="space-y-2">
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

                <GlassPanel className="p-3">
                  {channelsLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-5 w-48 rounded-lg" />
                      <div className="flex flex-wrap gap-2">
                        {[1, 2, 3].map(i => <Skeleton key={i} className="h-8 w-28 rounded-lg" />)}
                      </div>
                    </div>
                  ) : channelsError ? (
                    <ErrorDisplay error={channelsError} compact />
                  ) : channelsList.length > 0 ? (
                    <div>
                      <p className="text-xs text-[var(--text-muted)] mb-1.5">
                        {t('notifications.alertStudio.channels.externalChannels', 'External channels for test notifications:')}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {channelsList.map(ch => {
                          const isSelected = testChannelIds === null || testChannelIds.includes(ch.id)
                          return (
                            <UiButton
                              key={ch.id}
                              variant="ghost"
                              size="sm"
                              className={cn(
                                'h-auto rounded-lg border px-3 py-1.5 text-xs transition-colors',
                                isSelected
                                  ? 'bg-neon-cyan/10 border-neon-cyan/30 text-neon-cyan'
                                  : 'bg-white/5 border-white/10 text-[var(--text-muted)] hover:border-white/20',
                              )}
                              onClick={() => handleToggleTestChannel(ch.id)}
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
                      message={t('notifications.alertStudio.channels.emptyDescription', 'Browser toasts and alert history are always enabled. Configure channels from Notifications to fan out alerts.')}
                    />
                  )}
                </GlassPanel>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-white/5">
              <UiButton
                variant="primary"
                size="sm"
                icon={<Save className="h-3.5 w-3.5" />}
                loading={saveRuleMut.isPending}
                onClick={handleSave}
                disabled={!canSave}
              >
                {saveRuleMut.isPending
                  ? t('notifications.alertStudio.actions.saving', 'Saving...')
                  : isEditing
                    ? t('notifications.alertStudio.actions.updateRule', 'Update Rule')
                    : t('notifications.alertStudio.actions.createRule', 'Create Rule')}
              </UiButton>

              {isEditing && editor.id && (
                <UiButton
                  variant="danger"
                  size="sm"
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  onClick={() => {
                    if (editor.id != null) handleDelete(editor.id)
                  }}
                >
                  {t('notifications.alertStudio.actions.delete', 'Delete')}
                </UiButton>
              )}

              <UiButton
                variant="secondary"
                size="sm"
                icon={<Bell className="h-3.5 w-3.5" />}
                loading={testRuleMut.isPending}
                onClick={handleTest}
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

      <Modal
        open={snoozeTargetRule != null}
        onClose={() => setSnoozeTargetId(null)}
        title={snoozeTargetRule
          ? t('notifications.alertStudio.snooze.title', 'Snooze "{{name}}"', { name: snoozeTargetRule.name || untitledRuleLabel })
          : t('notifications.alertStudio.snooze.button', 'Snooze')}
        size="sm"
      >
        {snoozeTargetRule && (
          <div className="space-y-3 text-sm text-[var(--text-primary)]">
            <p className="text-[var(--text-secondary)]">
              {t(
                'notifications.alertStudio.snooze.description',
                'Suppress this rule temporarily. Snooze auto-expires; the rule will fire again afterwards if its condition is true.',
              )}
            </p>
            {snoozeTargetActive && snoozeTargetRule.snoozed_until && (
              <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                {t('notifications.alertStudio.snooze.currentlySnoozed', 'Currently snoozed until {{time}}', {
                  time: formatDateTime(snoozeTargetRule.snoozed_until),
                })}
              </div>
            )}
            <div className="grid grid-cols-1 gap-2">
              <UiButton
                variant="secondary"
                onClick={() => handleSnooze(snoozeTargetRule.id, 60)}
                disabled={snoozeRuleMut.isPending}
              >
                {t('notifications.alertStudio.snooze.1h', 'Snooze 1 hour')}
              </UiButton>
              <UiButton
                variant="secondary"
                onClick={() => handleSnooze(snoozeTargetRule.id, 240)}
                disabled={snoozeRuleMut.isPending}
              >
                {t('notifications.alertStudio.snooze.4h', 'Snooze 4 hours')}
              </UiButton>
              <UiButton
                variant="secondary"
                onClick={() => handleSnooze(snoozeTargetRule.id, 1440)}
                disabled={snoozeRuleMut.isPending}
              >
                {t('notifications.alertStudio.snooze.24h', 'Snooze 24 hours')}
              </UiButton>
              {snoozeTargetActive && (
                <UiButton
                  variant="ghost"
                  onClick={() => handleSnooze(snoozeTargetRule.id, 0)}
                  disabled={snoozeRuleMut.isPending}
                >
                  {t('notifications.alertStudio.snooze.cancel', 'Cancel snooze')}
                </UiButton>
              )}
            </div>
          </div>
        )}
      </Modal>
      {deleteDialogProps && <ConfirmDialog {...deleteDialogProps} loading={deleteRuleMut.isPending} />}
    </PageContainer>
  )
}
