/**
 * AlertStudio - typed alert-rule editor page.
 *
 * Lists existing rules, provides typed templates, and persists through the
 * /api/v1/alerts/rules endpoint using the current alert-rule contract.
 */

import { useState, useEffect, useMemo, useCallback, useRef, type ElementType, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type AlertRule,
  type AlertRuleInput,
  type AlertRuleTriggerMode,
  type AlertTestTarget,
  type ComputedMetricSummary,
  useAlertMetrics,
  useAlertRules,
  useBulkDisableRules,
  useBulkEnableRules,
  useDeleteAlertRule,
  useNotificationChannels,
  useSaveAlertRule,
  useSnoozeAlertRule,
  useTestAlertRule,
  useToggleAlertRule,
} from '@/api/hooks/useNotifications'
import { useAvailableSignals } from '@/api/hooks/useSignals'
import type { AlertRuleKind, ComputedMetricOp, SignalUnitKind } from '@/api/types'
import type { SignalValueType } from '@/types/signals'
import { GlassPanel, Badge, Button as UiButton, Checkbox, ConfirmDialog, Input as UiInput, Select as UiSelect, Modal, HelpIcon, Tabs, Toggle, Text, PanelTitle, Caption, HelperText, ErrorText } from '@/components/ui'
import { BulkActionsToolbar, type BulkAction, MetricCard, SeverityBadge, SeverityIcon } from '@/components/data-display'
import { PageContainer } from '@/components/layout'
import { FadeIn } from '@/components/motion'
import { AlertBanner, DraftRecoveryBanner, EmptyState, ErrorDisplay, Skeleton } from '@/components/feedback'
import { PillFilterBar, type PillItem, SearchInput, VehicleMultiSelect, hydrateVehicleSelection, buildVehiclePayload, type VehicleSelection } from '@/components/forms'
import { useVehicles } from '@/api/hooks/useVehicles'
import { cn } from '@/lib/cn'
import { severityTokens, typography } from '@/lib/tokens'
import { fmtInt } from '@/lib/numberFormat'
import { formatDateTime } from '@/lib/dateFormat'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useConfirm } from '@/hooks/useConfirm'
import { useDirtyForm } from '@/hooks/useDirtyForm'
import { useFormDraft } from '@/hooks/useFormDraft'
import { useNavigationGuard } from '@/hooks/useNavigationGuard'
import { useUrlString } from '@/hooks/useUrlState'
import { alertRuleSchema } from '../schemas/alertRule'
import { ComputedMetricEditor } from '../components/ComputedMetricEditor'
import { AlertMessageEditor } from '../components/AlertMessageEditor'
import { recommendedTriggerMode } from '../lib/recommendedTriggerMode'
import { Icons } from '@/lib/icons';
import { AINLAlertBuilder } from '@/components/ai/AINLAlertBuilder'
import {
  AIAlertTuningSuggestions,
  type AlertRuleDraftPatch,
} from '@/components/ai/AIAlertTuningSuggestions'
import { AICrossRuleConflictDetection } from '@/components/ai/AICrossRuleConflictDetection'
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle'

// Editor-only tri-state. Backend column stays
// strict ('once' | 'repeat'); 'unset' exists purely so a brand-new
// rule can be in the "user hasn't decided yet" state and the Save
// button can block until they do (Decision D3 "force-choose").
type TriggerModeOrUnset = AlertRuleTriggerMode | 'unset'

type Severity = NonNullable<AlertRuleInput['severity']>
type RuleOp = NonNullable<AlertRuleInput['op']>
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
  { name: 'Battery Low (< 20%)', icon: Icons.battery, category: 'Battery', severity: 'warn', message: 'Battery at {{BatteryLevel}}%', cooldown_min: 30, signal_name: 'BatteryLevel', op: '<', value_num: 20 },
  { name: 'Battery Critical (< 10%)', icon: Icons.battery, category: 'Battery', severity: 'critical', message: 'Battery critically low at {{BatteryLevel}}%!', cooldown_min: 15, signal_name: 'BatteryLevel', op: '<', value_num: 10 },
  { name: 'Battery Full (>= 90%)', icon: Icons.battery, category: 'Battery', severity: 'info', message: 'Battery reached {{BatteryLevel}}%', cooldown_min: 60, signal_name: 'BatteryLevel', op: '>=', value_num: 90 },
  { name: 'Charge Limit Reached', icon: Icons.battery, category: 'Battery', severity: 'info', message: 'Battery at charge limit {{ChargeLimitSoc}}%', cooldown_min: 60, signal_name: 'BatteryLevel', op: '>=', value_num: 80 },
  { name: 'Range Below 50 km', icon: Icons.battery, category: 'Battery', severity: 'warn', message: 'Range low: {{RatedRange}} km remaining', cooldown_min: 30, signal_name: 'RatedRange', op: '<', value_num: 50 },

  { name: 'Charge Complete', icon: Icons.charging, category: 'Charging', severity: 'info', message: 'Charging complete at {{BatteryLevel}}%', cooldown_min: 60, signal_name: 'ChargeState', op: '=', value_text: 'Complete' },
  { name: 'Charging Started', icon: Icons.charging, category: 'Charging', severity: 'info', message: 'Charging started - {{DetailedChargeState}}', cooldown_min: 15, signal_name: 'DetailedChargeState', op: '=', value_text: 'Charging' },
  { name: 'Charging Stopped Unexpectedly', icon: Icons.charging, category: 'Charging', severity: 'warn', message: 'Charging stopped - {{DetailedChargeState}}', cooldown_min: 30, signal_name: 'DetailedChargeState', op: '=', value_text: 'Stopped' },
  { name: 'Supercharging (DC Fast)', icon: Icons.charging, category: 'Charging', severity: 'info', message: 'Supercharging at {{DCChargingPower}} kW', cooldown_min: 30, signal_name: 'DCChargingPower', op: '>', value_num: 50 },
  { name: 'Slow Charge Rate', icon: Icons.charging, category: 'Charging', severity: 'warn', message: 'Charging slow: {{ChargeAmps}}A', cooldown_min: 60, signal_name: 'ChargeAmps', op: 'between', value_min: 0.01, value_max: 5 },

  { name: 'Drive Started', icon: Icons.vehicle, category: 'Driving', severity: 'info', message: 'Drive started - gear is {{Gear}}', cooldown_min: 5, signal_name: 'Gear', op: '=', value_text: 'D' },
  { name: 'Drive Ended', icon: Icons.vehicle, category: 'Driving', severity: 'info', message: 'Drive ended - gear is {{Gear}}', cooldown_min: 5, signal_name: 'Gear', op: '=', value_text: 'P' },
  { name: 'Speed Limit Exceeded', icon: Icons.speed, category: 'Driving', severity: 'warn', message: 'Speed {{VehicleSpeed}} km/h exceeded limit', cooldown_min: 15, signal_name: 'VehicleSpeed', op: '>', value_num: 120 },
  { name: 'High Speed Alert (> 160 km/h)', icon: Icons.speed, category: 'Driving', severity: 'critical', message: 'Very high speed: {{VehicleSpeed}} km/h!', cooldown_min: 5, signal_name: 'VehicleSpeed', op: '>', value_num: 160 },
  { name: 'Reverse Gear Engaged', icon: Icons.vehicle, category: 'Driving', severity: 'info', message: 'Vehicle in reverse', cooldown_min: 5, signal_name: 'Gear', op: '=', value_text: 'R' },
  { name: 'Odometer Milestone (100k km)', icon: Icons.vehicle, category: 'Driving', severity: 'info', message: 'Odometer: {{Odometer}} km', cooldown_min: 1440, signal_name: 'Odometer', op: '>', value_num: 100000 },

  { name: 'Car Unlocked While Parked', icon: Icons.locked, category: 'Security', severity: 'critical', message: 'Vehicle is unlocked and parked!', cooldown_min: 30, signal_name: 'Locked', op: '=', value_bool: false },
  { name: 'Vehicle Locked', icon: Icons.locked, category: 'Security', severity: 'info', message: 'Vehicle locked', cooldown_min: 5, signal_name: 'Locked', op: '=', value_bool: true },
  { name: 'Vehicle Unlocked', icon: Icons.locked, category: 'Security', severity: 'info', message: 'Vehicle unlocked', cooldown_min: 5, signal_name: 'Locked', op: '=', value_bool: false },
  { name: 'Sentry Mode Activated', icon: Icons.security, category: 'Security', severity: 'info', message: 'Sentry mode activated', cooldown_min: 30, signal_name: 'SentryMode', op: '=', value_bool: true },
  { name: 'Door Opened While Parked', icon: Icons.locked, category: 'Security', severity: 'warn', message: 'Door opened - {{DoorState}}', cooldown_min: 15, signal_name: 'DoorState', op: '!=', value_text: 'Closed' },
  { name: 'Window Left Open', icon: Icons.vehicle, category: 'Security', severity: 'warn', message: 'Front driver window is {{FdWindow}}', cooldown_min: 60, signal_name: 'FdWindow', op: '!=', value_text: 'Closed' },
  { name: 'Valet Mode Enabled', icon: Icons.security, category: 'Security', severity: 'info', message: 'Valet mode enabled', cooldown_min: 60, signal_name: 'ValetModeEnabled', op: '=', value_bool: true },
  { name: 'Guest Mode Enabled', icon: Icons.security, category: 'Security', severity: 'warn', message: 'Guest mode enabled', cooldown_min: 60, signal_name: 'GuestModeEnabled', op: '=', value_bool: true },

  { name: 'Cabin Overheat (> 40C)', icon: Icons.climate, category: 'Climate', severity: 'warn', message: 'Cabin temp: {{InsideTemp}}C', cooldown_min: 30, signal_name: 'InsideTemp', op: '>', value_num: 40 },
  { name: 'Cabin Freezing (< 0C)', icon: Icons.climate, category: 'Climate', severity: 'warn', message: 'Cabin temp: {{InsideTemp}}C - freezing!', cooldown_min: 60, signal_name: 'InsideTemp', op: '<', value_num: 0 },
  { name: 'HVAC Left On While Parked', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'HVAC running while parked', cooldown_min: 30, signal_name: 'HvacPower', op: '=', value_bool: true },
  { name: 'Climate Keeper Active', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'Climate keeper: {{ClimateKeeperMode}}', cooldown_min: 60, signal_name: 'ClimateKeeperMode', op: '!=', value_text: 'Off' },
  { name: 'Steering Wheel Heater On', icon: Icons.climate, category: 'Climate', severity: 'info', message: 'Steering wheel heater level {{HvacSteeringWheelHeatLevel}}', cooldown_min: 30, signal_name: 'HvacSteeringWheelHeatLevel', op: '>', value_num: 0 },

  { name: 'Tire Pressure Low', icon: Icons.droplets, category: 'Tire Pressure', severity: 'warn', message: 'Low tire pressure detected', cooldown_min: 60, signal_name: 'TpmsHardWarnings', op: '=', value_bool: true },
  { name: 'Tire Pressure Soft Warning', icon: Icons.droplets, category: 'Tire Pressure', severity: 'info', message: 'Tire pressure slightly low', cooldown_min: 120, signal_name: 'TpmsSoftWarnings', op: '=', value_bool: true },
  { name: 'Front Left Tire Low (< 2.2 bar)', icon: Icons.droplets, category: 'Tire Pressure', severity: 'warn', message: 'FL tire: {{TpmsPressureFl}} bar', cooldown_min: 60, signal_name: 'TpmsPressureFl', op: '<', value_num: 2.2 },

  { name: 'Arrived at Home', icon: Icons.vehicle, category: 'Location', severity: 'info', message: 'Vehicle arrived at home', cooldown_min: 15, signal_name: 'LocatedAtHome', op: '=', value_bool: true },
  { name: 'Left Home', icon: Icons.vehicle, category: 'Location', severity: 'info', message: 'Vehicle left home', cooldown_min: 15, signal_name: 'LocatedAtHome', op: '=', value_bool: false },
  { name: 'Arrived at Work', icon: Icons.vehicle, category: 'Location', severity: 'info', message: 'Vehicle arrived at work', cooldown_min: 15, signal_name: 'LocatedAtWork', op: '=', value_bool: true },
  { name: 'Navigation Started', icon: Icons.vehicle, category: 'Location', severity: 'info', message: 'Navigating to {{DestinationName}}', cooldown_min: 10, signal_name: 'DestinationName', op: 'changed' },

  { name: 'Driver Seatbelt Unbuckled', icon: Icons.security, category: 'Safety', severity: 'warn', message: 'Driver seatbelt unbuckled while driving!', cooldown_min: 5, signal_name: 'DriverSeatBelt', op: '=', value_bool: false },
  { name: 'Speed Limit Mode Active', icon: Icons.security, category: 'Safety', severity: 'info', message: 'Speed limit mode active', cooldown_min: 60, signal_name: 'SpeedLimitMode', op: '=', value_bool: true },
  { name: 'PIN to Drive Disabled', icon: Icons.security, category: 'Safety', severity: 'warn', message: 'PIN to Drive has been disabled', cooldown_min: 1440, signal_name: 'PinToDriveEnabled', op: '=', value_bool: false },

  { name: 'High Motor Temperature (> 80C)', icon: Icons.climate, category: 'Motor', severity: 'warn', message: 'Motor stator temp: {{DiStatorTempF}}C', cooldown_min: 15, signal_name: 'DiStatorTempF', op: '>', value_num: 80 },
  { name: 'HVIL Fault', icon: Icons.security, category: 'Motor', severity: 'critical', message: 'HV interlock fault detected!', cooldown_min: 5, signal_name: 'Hvil', op: '=', value_text: 'Fault' },
  { name: 'High Regenerative Braking', icon: Icons.charging, category: 'Motor', severity: 'info', message: 'Regen power: {{Power}} kW', cooldown_min: 15, signal_name: 'Power', op: '<', value_num: -50 },

  { name: 'Software Update Available', icon: Icons.charging, category: 'Software', severity: 'info', message: 'Update available: {{SoftwareUpdateVersion}}', cooldown_min: 1440, signal_name: 'SoftwareUpdateVersion', op: 'changed' },
  { name: 'Software Update Installing', icon: Icons.charging, category: 'Software', severity: 'info', message: 'Installing update: {{SoftwareUpdateInstallationPercentComplete}}%', cooldown_min: 30, signal_name: 'SoftwareUpdateInstallationPercentComplete', op: '>', value_num: 0 },

  { name: 'Music Playing', icon: Icons.vehicle, category: 'Media', severity: 'info', message: 'Now playing: {{MediaNowPlayingTitle}} by {{MediaNowPlayingArtist}}', cooldown_min: 60, signal_name: 'MediaPlaybackStatus', op: '=', value_text: 'Playing' },
  { name: 'Volume Too High', icon: Icons.vehicle, category: 'Media', severity: 'info', message: 'Volume at {{MediaAudioVolume}}', cooldown_min: 30, signal_name: 'MediaAudioVolume', op: '>', value_num: 8 },

  { name: 'Powershare Active', icon: Icons.charging, category: 'Powershare', severity: 'info', message: 'Powershare active: {{PowershareInstantaneousPowerKW}} kW', cooldown_min: 60, signal_name: 'PowershareStatus', op: 'changed' },
]

const templateCategories = [...new Set(ruleTemplates.map(t => t.category))].sort()

const numericOperatorOptions: RuleOp[] = ['=', '!=', '<', '<=', '>', '>=', 'changed', 'between', 'outside']
const scalarOperatorOptions: RuleOp[] = ['=', '!=', 'changed']
const customSignalCategory = '__custom__'

// Shared field-label classes built from the typography `label` role token so
// every editor field uses the same theme-aware, non-ad-hoc styling.
const fieldLabelCls = cn('mb-1 block', typography.role.label)
const fieldLabelRowCls = cn('mb-1 flex items-center gap-1', typography.role.label)

interface EditorState {
  id?: number
  name: string
  enabled: boolean
  /**
   * Discriminated-union vehicle selection.
   * Replaces the legacy free-text `vehicle_id: string` field. Sticky-
   * all means "current + future fleet"; specific means an explicit
   * subset that does NOT auto-grow when new vehicles are added.
   */
  vehicle_selection: VehicleSelection
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
  // See `TriggerModeOrUnset`. Existing rules
  // hydrated from the server are always 'once' | 'repeat'; only the
  // initial freshEditor() / templateToEditor() result starts as 'unset'.
  trigger_mode: TriggerModeOrUnset
  /**
   * Empty string means "no cap" (NULL on the wire). Stored as a string
   * because <UiInput type="number"> emits a string and the form lets the
   * user type 3-digit caps; conversion to number happens in
   * buildSavePayload.
   */
  max_fires_per_resolution: string
  /**
   * Escalation tier. `escalation_enabled`
   * gates whether the editor sends the pair. `escalation_after_min`
   * is a string for the same reason as max_fires_per_resolution
   * (UiInput emits strings + the user may type 3-digit values).
   * `escalation_severity` is one of info/warn/critical or '' when
   * the user hasn't picked yet (Save will block via canSave).
   * Repeat-mode only — buildSavePayload nulls both fields when
   * trigger_mode !== 'repeat' OR escalation_enabled is false.
   */
  escalation_enabled: boolean
  escalation_after_min: string
  escalation_severity: Severity | ''
  message: string
  /**
   * Per-rule notification body template. Empty
   * string means "use the op-aware default rendered by
   * internal/alertmsg". Whitespace-only is normalised to '' here AND
   * by the backend's normalizeMsgTemplate.
   */
  msg_template: string
  /**
   * Transport title toggle. When FALSE,
   * Discord/Slack/Telegram/ntfy/webhook deliver body-only
   * notifications. Defaults to TRUE.
   */
  include_title: boolean
  // kind: 'signal' (default — uses signal_name/op/value_*) or
  // 'computed_metric' (uses metric_id/metric_window/metric_op/metric_threshold).
  // The two modes are mutually exclusive at submit-time; the editor renders a
  // different operand panel for each.
  kind: AlertRuleKind
  metric_id: string
  metric_window: string
  metric_op: ComputedMetricOp
  metric_threshold: string
}

function freshEditor(): EditorState {
  return {
    name: '',
    enabled: true,
    vehicle_selection: { kind: 'all_sticky' },
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
    // The default was 'repeat'. The
    // user-reported "locked vehicle alert spam" was caused by every
    // new rule silently inheriting 'repeat'. Now the editor opens
    // in tri-state and the Save button blocks until the user picks.
    trigger_mode: 'unset',
    max_fires_per_resolution: '',
    escalation_enabled: false,
    escalation_after_min: '',
    escalation_severity: '',
    message: '',
    msg_template: '',
    include_title: true,
    kind: 'signal',
    metric_id: '',
    metric_window: '',
    metric_op: '>',
    metric_threshold: '',
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

// parseOptionalMaxFires turns the editor input string into the wire shape
// for max_fires_per_resolution: empty/blank → null (unlimited), otherwise
// a positive integer. Fractional or non-positive inputs collapse to null
// so we never POST an invalid value the backend would reject with 400.
function parseOptionalMaxFires(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

// Collapse a whitespace-only template to NULL so
// the wire payload tells the backend "use the op-aware default". The
// backend's `normalizeMsgTemplate` performs the same transformation
// defensively; doing it client-side too keeps the save mutation diff
// quiet when the user types and then deletes characters.
function normalizeMsgTemplateForSave(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

// buildEscalationPayload converts the editor's tri-input escalation
// state (enabled flag + after_min string + severity string) into the
// `{ escalation_after_min, escalation_severity }` pair the wire
// expects. Returns BOTH NULLS when:
//   the rule isn't repeat-mode (backend rejects escalation on once-mode)
//   the user toggled the checkbox off
//   either field is incomplete (Save would have been blocked by canSave)
// Returns the populated pair otherwise. The two fields move together
// because the backend's mutual-presence CHECK rejects half-set values.

// Canonical info < warn < critical ordering
// used by the escalation higher-severity check. Must match the
// alertSeverityRank Go helper in internal/api/alert_handler_rules.go.
const SEVERITY_RANK: Record<Severity, number> = { info: 1, warn: 2, critical: 3 }

function buildEscalationPayload(
  state: EditorState,
  triggerMode: AlertRuleTriggerMode,
): { escalation_after_min: number | null; escalation_severity: Severity | null } {
  if (triggerMode !== 'repeat' || !state.escalation_enabled) {
    return { escalation_after_min: null, escalation_severity: null }
  }
  const after = parseOptionalMaxFires(state.escalation_after_min)
  if (after == null || state.escalation_severity === '') {
    return { escalation_after_min: null, escalation_severity: null }
  }
  return { escalation_after_min: after, escalation_severity: state.escalation_severity }
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
  const kind: AlertRuleKind = rule.kind ?? 'signal'
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    vehicle_selection: hydrateVehicleSelection(rule),
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
    max_fires_per_resolution:
      rule.max_fires_per_resolution == null ? '' : String(rule.max_fires_per_resolution),
    escalation_enabled: rule.escalation_after_min != null && rule.escalation_severity != null,
    escalation_after_min:
      rule.escalation_after_min == null ? '' : String(rule.escalation_after_min),
    escalation_severity: rule.escalation_severity ?? '',
    message: rule.signal_name ? `${rule.name}: {{${rule.signal_name}}}` : '',
    msg_template: rule.msg_template ?? '',
    include_title: rule.include_title ?? true,
    kind,
    metric_id: rule.metric_id ?? '',
    metric_window: rule.metric_window ?? '',
    metric_op: (rule.metric_op ?? '>') as ComputedMetricOp,
    metric_threshold: valueToInput(rule.metric_threshold),
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
    // Seed the template from the curated
    // RuleTemplate.message so users who "clone from template" get a
    // working starter body. The legacy `message` field is kept in
    // parallel until the page-wide cleanup ships.
    msg_template: message,
    include_title: true,
  }
}

function buildSavePayload(state: EditorState): AlertRuleInput {
  const vehiclePayload = buildVehiclePayload(state.vehicle_selection)
  // Defence-in-depth narrowing. `canSave`
  // already blocks the Save button when trigger_mode is 'unset', so
  // this branch is unreachable from the UI; we throw to keep the
  // backend contract honest in case a future caller bypasses canSave.
  if (state.trigger_mode === 'unset') {
    throw new Error('buildSavePayload: trigger_mode must be chosen before save')
  }
  const triggerMode: AlertRuleTriggerMode = state.trigger_mode

  if (state.kind === 'computed_metric') {
    const threshold = parseOptionalNumber(state.metric_threshold)
    const escalation = buildEscalationPayload(state, triggerMode)
    return {
      name: state.name.trim(),
      enabled: state.enabled,
      ...vehiclePayload,
      severity: state.severity,
      cooldown_min: state.cooldown_min,
      trigger_mode: triggerMode,
      max_fires_per_resolution: parseOptionalMaxFires(state.max_fires_per_resolution),
      ...escalation,
      kind: 'computed_metric',
      metric_id: state.metric_id || null,
      metric_window: state.metric_window || null,
      metric_op: state.metric_op,
      metric_threshold: threshold,
      // Propagate the per-rule template + title
      // toggle. Empty/whitespace template collapses to null so the
      // backend renders the op-aware default body.
      msg_template: normalizeMsgTemplateForSave(state.msg_template),
      include_title: state.include_title,
    }
  }

  const valueKind = valueKindForState(state)
  const escalation = buildEscalationPayload(state, triggerMode)
  const payload: AlertRuleInput = {
    name: state.name.trim(),
    enabled: state.enabled,
    ...vehiclePayload,
    signal_name: state.signal_name.trim(),
    op: state.op,
    value_num: null,
    value_text: null,
    value_bool: null,
    value_min: null,
    value_max: null,
    severity: state.severity,
    cooldown_min: state.cooldown_min,
    trigger_mode: triggerMode,
    max_fires_per_resolution: parseOptionalMaxFires(state.max_fires_per_resolution),
    ...escalation,
    kind: 'signal',
    // See computed_metric branch above.
    msg_template: normalizeMsgTemplateForSave(state.msg_template),
    include_title: state.include_title,
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

function hasComputedMetricInputs(state: EditorState, metrics: ComputedMetricSummary[]): boolean {
  if (!state.metric_id || !state.metric_window || !state.metric_op) return false
  if (parseOptionalNumber(state.metric_threshold) == null) return false
  const def = metrics.find(m => m.id === state.metric_id)
  if (!def) return false
  if (!def.windows.includes(state.metric_window)) return false
  if (!def.ops.includes(state.metric_op)) return false
  return true
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
  // Drives the multi-vehicle picker.
  const { data: vehiclesData } = useVehicles()
  const vehicles = useMemo(() => vehiclesData ?? [], [vehiclesData])
  const saveRuleMut = useSaveAlertRule()
  const deleteRuleMut = useDeleteAlertRule()
  const toggleRuleMut = useToggleAlertRule()
  const testRuleMut = useTestAlertRule()
  const snoozeRuleMut = useSnoozeAlertRule()
  const [snoozeTargetId, setSnoozeTargetId] = useState<number | null>(null)
  const { confirm: confirmDelete, dialogProps: deleteDialogProps } = useConfirm()
  const { confirm: confirmDiscard, dialogProps: discardDialogProps } = useConfirm()
  const { vehicleId: aiVehicleId } = useSelectedVehicle()
  const availableSignalsQuery = useAvailableSignals(aiVehicleId ?? 0)

  const [selectedId, setSelectedId] = useState<number | null>(null)
  // Multi-row selection for bulk enable/disable.
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set())
  const clearBulk = useCallback(() => setBulkSelected(new Set()), [])
  const toggleBulkSelected = useCallback((id: number, on: boolean) => {
    setBulkSelected(prev => {
      const next = new Set(prev)
      if (on) next.add(id); else next.delete(id)
      return next
    })
  }, [])
  const bulkEnableMut = useBulkEnableRules()
  const bulkDisableMut = useBulkDisableRules()
  const [showTemplates, setShowTemplates] = useState(false)
  const [templateSearch, setTemplateSearch] = useState('')
  const [templateCategory, setTemplateCategory] = useState<string | null>(null)
  // Rule list search lives in the URL.
  const [ruleSearch, setRuleSearch] = useUrlString('q', '')
  const [testChannelIds, setTestChannelIds] = useState<number[] | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const initialEditorRef = useRef<string>(JSON.stringify(freshEditor()))

  // `useFormDraft` resets its internal state during
  // render whenever `draftKey` changes (documented React 18 pattern).
  // `setSelectedId(id)` triggers that reset, which races with any in-event
  // `setEditor(hydrated)` call and silently discards the hydration. We stash
  // the desired post-switch editor state in this ref and re-apply it inside a
  // `useEffect` keyed on `selectedId`, so the override happens AFTER the
  // render-time reset has committed.
  const pendingHydrationRef = useRef<EditorState | null>(null)

  // `useFormDraft` persists in-progress new-rule
  // editing to localStorage so a tab close, SW reload, or auth redirect
  // doesn't destroy the user's work. Only the `alert-rule-new` key is
  // persisted (skipPersist returns true for edit-an-existing-rule sessions);
  // existing rules can be re-fetched from the server, but a brand-new rule
  // exists nowhere else.
  const draftKey = `alertstudio:rule:${selectedId ?? 'new'}`
  const isNewRule = selectedId === null
  const freshEditorJsonRef = useRef<string>(JSON.stringify(freshEditor()))
  const {
    value: editor,
    setValue: setEditor,
    hasDraft,
    draftSavedAt,
    discardDraft,
  } = useFormDraft<EditorState>(draftKey, freshEditor(), {
    // Bumped from 3 to 4. Earlier
    // drafts lack `escalation_*` fields entirely; restoring them
    // would leave the editor in an undefined-state shape and the
    // checkbox would render as `undefined` (controlled→uncontrolled
    // warning + crash on toggle). Bumping the version forces those
    // drafts to be discarded so the user lands on a fresh editor.

    // Bumped from 4 to 5. Earlier drafts
    // lack `msg_template` + `include_title`; without the bump the
    // editor would hydrate an old draft and crash when the
    // AlertMessageEditor reads `editor.include_title` (undefined →
    // controlled-checkbox warning).
    version: 5,
    debounceMs: 800,
    skipPersist: v =>
      saveRuleMut.isPending
      || deleteRuleMut.isPending
      || !isNewRule
      || JSON.stringify(v) === freshEditorJsonRef.current,
  })

  const isDirty = useMemo(
    () => JSON.stringify(editor) !== initialEditorRef.current,
    [editor],
  )

  // Derive the vehicle name surfaced in the
  // message-template preview. Mirrors the backend's
  // `dispatchComputedMetricNotification` vehicle-name resolution:
  // pick the first explicit selection, else the first fleet vehicle.
  // The preview is a hint, not a guarantee — the user can target
  // many vehicles and we show one representative name here.
  const previewVehicleName = useMemo<string | undefined>(() => {
    if (editor.vehicle_selection.kind === 'specific') {
      const firstId = editor.vehicle_selection.vehicle_ids[0]
      if (firstId != null) {
        const match = vehicles.find(v => v.id === firstId)
        if (match?.display_name) return match.display_name
      }
    }
    return vehicles[0]?.display_name
  }, [editor.vehicle_selection, vehicles])

  // Apply pending hydration AFTER the `useFormDraft`
  // render-time reset has committed (see `pendingHydrationRef` declaration
  // for the race-condition rationale).
  useEffect(() => {
    if (pendingHydrationRef.current == null) return
    const next = pendingHydrationRef.current
    pendingHydrationRef.current = null
    setEditor(next)
    initialEditorRef.current = JSON.stringify(next)
  }, [selectedId, setEditor])

  useDirtyForm(isDirty)
  // In-app navigation guard. Pairs with `useDirtyForm`
  // above (which only handles tab close / reload) so sidebar clicks, browser
  // back, and breadcrumb links also surface a "discard or keep editing"
  // dialog while a new rule is being authored.
  useNavigationGuard(isDirty, t('forms.unsavedRule', 'You have an unsaved alert rule.'))

  const dirtyStrings = useMemo(() => ({
    title: t('forms.unsavedTitle', 'Unsaved changes'),
    message: t('forms.unsavedWarning', 'You have unsaved changes. Discard them?'),
    discardLabel: t('forms.discard', 'Discard'),
    keepEditingLabel: t('forms.keepEditing', 'Keep editing'),
  }), [t])

  const guardSwitch = useCallback(
    async (action: () => void) => {
      if (!isDirty) {
        action()
        return
      }
      const ok = await confirmDiscard({
        title: dirtyStrings.title,
        message: dirtyStrings.message,
        confirmLabel: dirtyStrings.discardLabel,
        cancelLabel: dirtyStrings.keepEditingLabel,
        variant: 'warning',
        silenceKey: 'discard-draft',
      })
      if (ok) action()
    },
    [confirmDiscard, dirtyStrings, isDirty],
  )

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

  // Drop bulk selection whenever the visible result set changes — we never
  // want a "ghost" id remaining selected from a previous filter.
  useEffect(() => {
    setBulkSelected(prev => {
      if (prev.size === 0) return prev
      const visible = new Set(filteredRules.map(r => r.id))
      const next = new Set<number>()
      prev.forEach(id => { if (visible.has(id)) next.add(id) })
      return next.size === prev.size ? prev : next
    })
  }, [filteredRules])

  const bulkRulesActions = useMemo<BulkAction[]>(() => [
    {
      id: 'enable',
      label: t('bulk.actions.enable', 'Enable'),
      icon: <Icons.notifications className="h-3.5 w-3.5" />,
      onClick: async (ids) => {
        await bulkEnableMut.mutateAsync(ids.map(Number))
        clearBulk()
      },
    },
    {
      id: 'disable',
      label: t('bulk.actions.disable', 'Disable'),
      icon: <Icons.notificationsMuted className="h-3.5 w-3.5" />,
      onClick: async (ids) => {
        await bulkDisableMut.mutateAsync(ids.map(Number))
        clearBulk()
      },
    },
  ], [t, bulkEnableMut, bulkDisableMut, clearBulk])

  const rulesCountLabel = rulesList.length === 1
    ? t('notifications.alertStudio.rules.countOne', '1 rule')
    : t('notifications.alertStudio.rules.countMany', '{{count}} rules', { count: rulesList.length })

  // Real, derived fleet-alert overview surfaced as the KPI band. Every value
  // comes straight from the loaded rules/channels — no fabricated metrics.
  const kpi = useMemo(() => {
    let enabled = 0
    let critical = 0
    let snoozed = 0
    for (const r of rulesList) {
      if (r.enabled) enabled += 1
      if (normalizeSeverity(r.severity) === 'critical') critical += 1
      if (isSnoozeActive(r.snoozed_until)) snoozed += 1
    }
    return {
      total: rulesList.length,
      enabled,
      disabled: rulesList.length - enabled,
      critical,
      snoozed,
      channels: channelsList.length,
    }
  }, [rulesList, channelsList])

  // Category pills for the template browser. "all" clears the filter; each
  // category pill carries its live template count.
  const categoryPills = useMemo<PillItem[]>(() => [
    { key: 'all', label: t('notifications.alertStudio.templates.allCategory', 'All'), count: ruleTemplates.length },
    ...templateCategories.map(cat => ({
      key: cat,
      label: getTemplateCategory(cat),
      count: ruleTemplates.filter(x => x.category === cat).length,
    })),
  ], [getTemplateCategory, t])

  const severityOptions = useMemo(() => [
    { value: 'info', label: t('notifications.alertStudio.severity.info', 'Info') },
    { value: 'warn', label: t('notifications.alertStudio.severity.warn', 'Warning') },
    { value: 'critical', label: t('notifications.alertStudio.severity.critical', 'Critical') },
  ], [t])

  const enabledOptions = useMemo(() => [
    { value: 'true', label: t('notifications.alertStudio.editor.enabled', 'Enabled') },
    { value: 'false', label: t('notifications.alertStudio.editor.disabled', 'Disabled') },
  ], [t])

  const alertBehaviorOptions = useMemo(() => [
    // Disabled placeholder option pinned at the
    // top so brand-new rules render in the explicit "user hasn't decided
    // yet" state. Disabled prevents the user from re-selecting unset
    // after they've committed to once/repeat.
    {
      value: '',
      label: t('notifications.alertStudio.editor.alertBehaviorPlaceholder', '— Choose one —'),
      disabled: true,
    },
    { value: 'repeat', label: t('notifications.alertStudio.editor.alertBehavior.repeatLabel', 'Re-alert until resolved') },
    { value: 'once', label: t('notifications.alertStudio.editor.alertBehavior.onceLabel', 'Notify on event') },
  ], [t])

  // Derived recommendation. Pure derivation, no
  // setState side effect: changing op recomputes the banner copy on the
  // next render without ever mutating editor.trigger_mode (the user
  // remains in control of the actual choice).
  const recommendedMode = useMemo(
    () => recommendedTriggerMode(editor.op),
    [editor.op],
  )
  const recommendedLabel = useMemo(
    () => (
      recommendedMode === 'once'
        ? t('notifications.alertStudio.editor.alertBehavior.onceLabel', 'Notify on event')
        : t('notifications.alertStudio.editor.alertBehavior.repeatLabel', 'Re-alert until resolved')
    ),
    [recommendedMode, t],
  )
  const alternativeLabel = useMemo(
    () => (
      recommendedMode === 'once'
        ? t('notifications.alertStudio.editor.alertBehavior.repeatLabel', 'Re-alert until resolved')
        : t('notifications.alertStudio.editor.alertBehavior.onceLabel', 'Notify on event')
    ),
    [recommendedMode, t],
  )
  // Banner is signal-rule only — computed_metric uses metric_op which
  // has its own semantics not yet covered by `recommendedTriggerMode`.
  // Force-choose still applies to computed_metric (canSave blocks),
  // but the recommendation hint is suppressed to avoid showing a
  // signal-operator suggestion next to a metric editor.
  const showRecommendBanner = (
    isNewRule
    && editor.trigger_mode === 'unset'
    && editor.kind === 'signal'
    && editor.signal_name.trim().length > 0
  )
  const triggerModeBlocked = isNewRule && editor.trigger_mode === 'unset'

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
  const selectedSignalDescriptor = useMemo(
    () => availableSignalsQuery.data?.signals.find(
      signal => signal.name === editor.signal_name,
    ) ?? null,
    [availableSignalsQuery.data?.signals, editor.signal_name],
  )
  const canonicalUnitHint = useMemo(() => {
    if (!aiVehicleId) {
      return t(
        'notifications.alertStudio.editor.canonicalUnitNoVehicle',
        'Enter the canonical SI value emitted by Fleet Telemetry. Select a vehicle in the status line to load exact unit metadata.',
      )
    }
    if (availableSignalsQuery.isLoading) {
      return t(
        'notifications.alertStudio.editor.canonicalUnitLoading',
        'Loading the canonical unit for this signal…',
      )
    }
    const hints: Record<SignalUnitKind, string> = {
      distance: t(
        'notifications.alertStudio.editor.canonicalUnitDistance',
        'Canonical SI input: meters (m).',
      ),
      temperature: t(
        'notifications.alertStudio.editor.canonicalUnitTemperature',
        'Canonical input: degrees Celsius (°C).',
      ),
      pressure: t(
        'notifications.alertStudio.editor.canonicalUnitPressure',
        'Canonical SI input: pascals (Pa).',
      ),
      charge: t(
        'notifications.alertStudio.editor.canonicalUnitCharge',
        'Canonical input: percent from 0 to 100.',
      ),
      speed: t(
        'notifications.alertStudio.editor.canonicalUnitSpeed',
        'Canonical SI input: meters per second (m/s).',
      ),
      none: t(
        'notifications.alertStudio.editor.canonicalUnitFallback',
        'Enter the canonical numeric value emitted by Fleet Telemetry; this signal has no registered unit dimension.',
      ),
    }
    if (availableSignalsQuery.isError || !selectedSignalDescriptor) {
      return t(
        'notifications.alertStudio.editor.canonicalUnitUnavailable',
        'Unit metadata is unavailable for this signal. Enter the canonical numeric value emitted by Fleet Telemetry.',
      )
    }
    return hints[selectedSignalDescriptor.unit_kind]
  }, [
    aiVehicleId,
    availableSignalsQuery.isError,
    availableSignalsQuery.isLoading,
    selectedSignalDescriptor,
    t,
  ])

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

  const computedMetricsQuery = useAlertMetrics()
  const computedMetrics = useMemo<ComputedMetricSummary[]>(
    () => computedMetricsQuery.data ?? [],
    [computedMetricsQuery.data],
  )

  const canSave = useMemo(() => {
    if (editor.name.trim().length === 0) return false
    if (editor.cooldown_min <= 0) return false
    // Force-choose at create
    // time. Editing an existing rule preserves whichever value the
    // server already stored (R7: existing rules are never tri-state).
    if (isNewRule && editor.trigger_mode === 'unset') return false
    // Sticky-all is always valid; specific
    // requires at least one selected vehicle. The new picker prevents
    // any other invalid intermediate state by construction.
    if (
      editor.vehicle_selection.kind === 'specific'
      && editor.vehicle_selection.vehicle_ids.length === 0
    ) {
      return false
    }
    // Escalation pair validity. When the
    // checkbox is on, BOTH fields must be filled AND the escalated
    // severity must rank strictly higher than the base severity.
    // Also rejects the impossible-but-possible state of escalation
    // enabled on a non-repeat trigger mode (defence-in-depth — the
    // UI hides the section for non-repeat, but if a stale draft
    // restored it, Save must still block).
    if (editor.escalation_enabled) {
      if (editor.trigger_mode !== 'repeat') return false
      const after = parseOptionalMaxFires(editor.escalation_after_min)
      if (after == null) return false
      if (editor.escalation_severity === '') return false
      if (SEVERITY_RANK[editor.escalation_severity] <= SEVERITY_RANK[editor.severity]) {
        return false
      }
    }
    if (editor.kind === 'computed_metric') {
      // Only enforce metric-shape requirements; if registry is loading we
      // optimistically allow the save and the server-side validator catches
      // any mismatch.
      if (!editor.metric_id || !editor.metric_window || !editor.metric_op) return false
      if (parseOptionalNumber(editor.metric_threshold) == null) return false
      if (computedMetrics.length > 0 && !hasComputedMetricInputs(editor, computedMetrics)) return false
      return true
    }
    return (
      editor.signal_name.trim().length > 0
      && isOperatorAllowedForState(editor)
      && hasRequiredTypedValue(editor)
    )
  }, [computedMetrics, editor, isNewRule])

  const handleSelectRule = useCallback((rule: AlertRule) => {
    guardSwitch(() => {
      const nextEditor = ruleToEditor(rule)
      const signalType = signalTypeForName(nextEditor.signal_name, nextEditor.value_kind)
      const nextOp = coerceOperatorForSignalType(nextEditor.op, signalType)
      const finalEditor: EditorState = {
        ...nextEditor,
        op: nextOp,
        value_kind: valueKindForSignalOp(signalType, nextOp),
      }
      // `useFormDraft` reset on key change races
      // with the inline `setEditor`. Apply both: the inline call covers the
      // same-key path; the ref + `useEffect` covers the cross-key path.
      pendingHydrationRef.current = finalEditor
      setSelectedId(rule.id)
      setEditor(finalEditor)
      initialEditorRef.current = JSON.stringify(finalEditor)
      setFormError(null)
    })
  }, [guardSwitch, setEditor])

  const handleNewRule = useCallback(() => {
    guardSwitch(() => {
      const blank = freshEditor()
      pendingHydrationRef.current = blank
      setSelectedId(null)
      setEditor(blank)
      initialEditorRef.current = JSON.stringify(blank)
      setFormError(null)
    })
  }, [guardSwitch, setEditor])

  const handleCloneTemplate = useCallback((tpl: RuleTemplate) => {
    guardSwitch(() => {
      const next = templateToEditor(tpl, getTemplateName(tpl), getTemplateMessage(tpl))
      pendingHydrationRef.current = next
      setSelectedId(null)
      setEditor(next)
      initialEditorRef.current = JSON.stringify(next)
      setShowTemplates(false)
      setFormError(null)
    })
  }, [getTemplateMessage, getTemplateName, guardSwitch, setEditor])

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
    const parsed = alertRuleSchema.safeParse(payload)
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]
      setFormError(firstIssue?.message ?? t('forms.validationFailed', 'Please fix the highlighted fields and try again.'))
      return
    }
    setFormError(null)
    saveRuleMut.mutate(
      editor.id ? { id: editor.id, ...payload } : payload,
      {
        onSuccess: () => {
          // Successful save promotes the draft into
          // a real rule, so drop both the per-rule and the `new` drafts.
          discardDraft()
          const blank = freshEditor()
          pendingHydrationRef.current = blank
          setSelectedId(null)
          setEditor(blank)
          initialEditorRef.current = JSON.stringify(blank)
        },
      },
    )
  }, [canSave, discardDraft, editor, saveRuleMut, setEditor, t])

  const handleDelete = useCallback((id: number) => {
    deleteRuleMut.mutate(id, {
      onSuccess: () => {
        // Drop any in-progress draft for the deleted
        // rule so a future visit doesn't restore stale work.
        discardDraft()
        const blank = freshEditor()
        pendingHydrationRef.current = blank
        setSelectedId(null)
        setEditor(blank)
        initialEditorRef.current = JSON.stringify(blank)
        setFormError(null)
      },
    })
  }, [deleteRuleMut, discardDraft, setEditor])

  const handleApplyAITuningPatch = useCallback(
    (patch: AlertRuleDraftPatch) => {
      // Copy a typed AI-proposed alert
      // patch onto the editor's local state. The AI panel never
      // persists state directly; the user reviews the merged
      // editor and clicks the canonical Save button next, which
      // flows through saveRuleMut + the unguarded
      // PUT /api/v1/alerts/rules/{id} handler (ADR-015 §I3 +
      // §I8 propose-only contract).

      // EditorState stores value_num / value_min / value_max as
      // strings because <UiInput type="number"> emits strings;
      // we convert proposed numerics to strings here so the
      // single canonical buildSavePayload number-parsing code
      // path runs unchanged.
      setEditor(s => {
        const next = { ...s }
        if (patch.value_num != null) {
          next.value_num = String(patch.value_num)
        }
        if (patch.value_min != null) {
          next.value_min = String(patch.value_min)
        }
        if (patch.value_max != null) {
          next.value_max = String(patch.value_max)
        }
        if (typeof patch.cooldown_min === 'number') {
          next.cooldown_min = patch.cooldown_min
        }
        if (patch.severity) {
          next.severity = patch.severity as Severity
        }
        if (patch.trigger_mode) {
          next.trigger_mode = patch.trigger_mode as TriggerModeOrUnset
        }
        if (patch.op) {
          next.op = patch.op as RuleOp
        }
        return next
      })
    },
    [setEditor],
  )

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
    // Thread the per-rule template + title
    // toggle through the Test endpoint so the user previews exactly
    // what production would deliver. The legacy `message` field is
    // kept as a fallback for transports that ignored msg_template
    // None in current backend, but ConditionalMessage
    // wrapper still expects a string).
    const msgTemplate = normalizeMsgTemplateForSave(editor.msg_template)
    const baseBody = {
      message,
      msg_template: msgTemplate,
      include_title: editor.include_title,
    }
    testRuleMut.mutate(target ? { ...baseBody, target } : baseBody)
  }, [
    allChannelIds,
    editor.include_title,
    editor.message,
    editor.msg_template,
    t,
    testChannelIds,
    testRuleMut,
  ])

  const renderValueEditor = () => {
    if (!editor.signal_name.trim()) {
      return (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Icons.info className="h-8 w-8 text-[var(--text-muted)]" />}
          title={t('notifications.alertStudio.editor.noSignalTitle', 'Choose a signal')}
          message={t('notifications.alertStudio.editor.noSignalDescription', 'Select a telemetry signal before entering a comparison value.')}
        />
      )
    }

    const valueKind = valueKindForState(editor)

    if (valueKind === 'range') {
      return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UiInput
            id="alert-value-min"
            label={t('notifications.alertStudio.editor.minValueLabel', 'Minimum Value')}
            type="number"
            step="any"
            className="w-full"
            value={editor.value_min}
            onChange={e => setEditor(s => ({ ...s, value_min: e.target.value }))}
            hint={canonicalUnitHint}
            required
          />
          <UiInput
            id="alert-value-max"
            label={t('notifications.alertStudio.editor.maxValueLabel', 'Maximum Value')}
            type="number"
            step="any"
            className="w-full"
            value={editor.value_max}
            onChange={e => setEditor(s => ({ ...s, value_max: e.target.value }))}
            hint={canonicalUnitHint}
            required
          />
        </div>
      )
    }

    if (valueKind === 'text') {
      return (
        <UiInput
          id="alert-value-text"
          label={t('notifications.alertStudio.editor.textValueLabel', 'Text Value')}
          className="w-full"
          placeholder={t('notifications.alertStudio.editor.textValuePlaceholder', 'Value to compare')}
          value={editor.value_text}
          onChange={e => setEditor(s => ({ ...s, value_text: e.target.value }))}
          required
        />
      )
    }

    if (valueKind === 'bool') {
      return (
        <UiSelect
          id="alert-value-bool"
          label={t('notifications.alertStudio.editor.booleanValueLabel', 'Boolean Value')}
          className="w-full"
          value={String(editor.value_bool)}
          onChange={e => setEditor(s => ({ ...s, value_bool: e.target.value === 'true' }))}
          options={boolOptions}
          required
        />
      )
    }

    if (valueKind === 'none') {
      return (
        <GlassPanel className="p-3">
          <HelperText>
            {t('notifications.alertStudio.editor.anyChangeDescription', 'This rule fires whenever the selected signal changes.')}
          </HelperText>
        </GlassPanel>
      )
    }

    return (
      <UiInput
        id="alert-value-num"
        label={t('notifications.alertStudio.editor.numericValueLabel', 'Numeric Value')}
        type="number"
        step="any"
        className="w-full"
        value={editor.value_num}
        onChange={e => setEditor(s => ({ ...s, value_num: e.target.value }))}
        hint={canonicalUnitHint}
        required
      />
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
          <UiButton variant="ghost" size="sm" icon={<Icons.sparkles className="h-3.5 w-3.5 text-amber-300" />} onClick={() => setShowTemplates(!showTemplates)}>
            {t('notifications.alertStudio.actions.templates', 'Templates')}
          </UiButton>
          <UiButton variant="primary" size="sm" icon={<Icons.add className="h-3.5 w-3.5" />} onClick={handleNewRule}>
            {t('notifications.alertStudio.actions.newRule', 'New Rule')}
          </UiButton>
        </>
      }
    >
      {/* Opt-in AI natural-language alert builder. Renders only when
          ai_mode != 'off' AND the nl-alert-builder toggle is on (withAiFeature
          HOC gate). PROPOSES drafts only — saving still flows through the typed
          handler below (ADR-015 §I3 baseline-intact + PROPOSE-only contract). */}
      <FadeIn delay={0.04}>
        <AINLAlertBuilder vehicleId={aiVehicleId ?? undefined} />
      </FadeIn>

      {/* KPI band — live fleet-alert overview derived from the loaded rules and
          channels. Full-width responsive metric grid (2 → 3 → 6 columns). */}
      <FadeIn delay={0.06}>
        <section
          aria-label={t('notifications.alertStudio.kpis.title', 'Alert rule overview')}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-6"
        >
          <MetricCard
            label={t('notifications.alertStudio.kpis.total', 'Total rules')}
            value={fmtInt(kpi.total)}
            icon={<Icons.notifications className="h-5 w-5" />}
            color="cyan"
          />
          <MetricCard
            label={t('notifications.alertStudio.kpis.enabled', 'Enabled')}
            value={fmtInt(kpi.enabled)}
            icon={<Icons.notificationsActive className="h-5 w-5" />}
            color="green"
          />
          <MetricCard
            label={t('notifications.alertStudio.kpis.disabled', 'Disabled')}
            value={fmtInt(kpi.disabled)}
            icon={<Icons.notificationsMuted className="h-5 w-5" />}
            color="blue"
          />
          <MetricCard
            label={t('notifications.alertStudio.kpis.critical', 'Critical')}
            value={fmtInt(kpi.critical)}
            icon={<Icons.severityCritical className="h-5 w-5" />}
            color="red"
          />
          <MetricCard
            label={t('notifications.alertStudio.kpis.snoozed', 'Snoozed')}
            value={fmtInt(kpi.snoozed)}
            icon={<Icons.moonStar className="h-5 w-5" />}
            color="amber"
          />
          <MetricCard
            label={t('notifications.alertStudio.kpis.channels', 'Channels')}
            value={fmtInt(kpi.channels)}
            icon={<Icons.send className="h-5 w-5" />}
            color="purple"
          />
        </section>
      </FadeIn>

      {showTemplates && (
        <FadeIn>
          <GlassPanel className="p-4 sm:p-5">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <PanelTitle>
                {t('notifications.alertStudio.templates.header', 'Rule Templates - {{count}} pre-built rules', { count: ruleTemplates.length })}
              </PanelTitle>
              <SearchInput
                value={templateSearch}
                onChange={setTemplateSearch}
                placeholder={t('notifications.alertStudio.templates.searchPlaceholder', 'Search templates...')}
                className="w-full sm:w-64"
              />
            </div>

            <PillFilterBar
              className="mb-4"
              ariaLabel={t('notifications.alertStudio.templates.categoryFilter', 'Filter templates by category')}
              items={categoryPills}
              activeKey={templateCategory ?? 'all'}
              onChange={key => setTemplateCategory(key === 'all' ? null : key)}
            />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 3xl:grid-cols-6">
              {filteredTemplates.map(tpl => {
                const Icon = tpl.icon
                const tokens = severityTokens[tpl.severity]
                return (
                  <GlassPanel
                    key={tpl.name}
                    role="button"
                    tabIndex={0}
                    className="group cursor-pointer p-3 text-left transition-all hover:border-cyan-400/30"
                    onClick={() => handleCloneTemplate(tpl)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleCloneTemplate(tpl)
                      }
                    }}
                    aria-label={t('notifications.alertStudio.templates.useTemplate', 'Use template {{name}}', { name: getTemplateName(tpl) })}
                  >
                    <div className="mb-1.5 flex items-center gap-2">
                      <div className={cn('rounded-lg p-1.5', tokens.bg)}>
                        <Icon className={cn('h-3.5 w-3.5', tokens.fg)} aria-hidden="true" />
                      </div>
                      <Text weight="medium" size="xs" color="primary" className="truncate transition-colors group-hover:text-cyan-300">
                        {getTemplateName(tpl)}
                      </Text>
                    </div>
                    <Text as="p" size="2xs" color="muted" mono className="truncate">
                      {getTemplateMessage(tpl)}
                    </Text>
                    <div className="mt-1.5 flex items-center justify-between">
                      <SeverityBadge severity={tpl.severity} size="sm" showIcon={false}>
                        {t(`notifications.alertStudio.severity.${tpl.severity}`, tpl.severity === 'warn' ? 'Warning' : tpl.severity)}
                      </SeverityBadge>
                      <span className="flex items-center gap-1 text-[var(--text-muted)]">
                        <Icons.copy className="h-3 w-3" aria-hidden="true" />
                        <Caption>{t('notifications.alertStudio.templates.use', 'Use')}</Caption>
                      </span>
                    </div>
                  </GlassPanel>
                )
              })}
              {filteredTemplates.length === 0 && (
                <div className="col-span-full">
                  <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                    icon={<Icons.sparkles className="h-8 w-8 text-[var(--text-muted)]" />}
                    title={t('notifications.alertStudio.templates.noMatchesTitle', 'No templates found')}
                    message={t('notifications.alertStudio.templates.noMatches', 'No templates match your search')}
                  />
                </div>
              )}
            </div>
          </GlassPanel>
        </FadeIn>
      )}

      <div className="grid grid-cols-1 gap-4 sm:gap-5 xl:grid-cols-12">
        <section
          aria-label={t('notifications.alertStudio.rules.title', 'Rules')}
          className="space-y-3 xl:col-span-5 2xl:col-span-4 3xl:col-span-3"
        >
          <GlassPanel className="p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <PanelTitle>{t('notifications.alertStudio.rules.title', 'Rules')}</PanelTitle>
              <Caption>{rulesCountLabel}</Caption>
            </div>

            {rulesList.length > 3 && (
              <div className="mb-3">
                <SearchInput
                  value={ruleSearch}
                  onChange={setRuleSearch}
                  placeholder={t('notifications.alertStudio.rules.searchPlaceholder', 'Search rules...')}
                  className="w-full"
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
                icon={<Icons.notifications className="h-8 w-8 text-[var(--text-muted)]" />}
                title={t('notifications.alertStudio.rules.emptyTitle', 'No alert rules yet')}
                message={t('notifications.alertStudio.rules.emptyDescription', 'Create your first rule or pick a template above.')}
              />
            )}

            {!isLoading && rulesList.length > 0 && filteredRules.length === 0 && (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                icon={<Icons.search className="h-8 w-8 text-[var(--text-muted)]" />}
                title={t('notifications.alertStudio.rules.noMatchesTitle', 'No matching rules')}
                message={t('notifications.alertStudio.rules.noMatches', 'No rules match "{{search}}"', { search: ruleSearch })}
              />
            )}

            <BulkActionsToolbar
              selectedIds={Array.from(bulkSelected)}
              total={filteredRules.length}
              onClear={clearBulk}
              actions={bulkRulesActions}
              itemNoun={{
                one: t('bulk.noun.rule_one', 'alert rule'),
                other: t('bulk.noun.rule_other', 'alert rules'),
              }}
            />

            <ul className="max-h-[36rem] space-y-2 overflow-y-auto pr-1">
              {filteredRules.map(rule => {
                const sev = normalizeSeverity(rule.severity)
                const active = selectedId === rule.id
                const snoozed = isSnoozeActive(rule.snoozed_until)
                const triggerMode = normalizeTriggerMode(rule.trigger_mode)
                const checked = bulkSelected.has(rule.id)
                return (
                  <li key={rule.id}>
                    <GlassPanel
                      className={cn(
                        'group p-3 transition-all',
                        active ? 'border-cyan-400/30 bg-cyan-500/5' : 'hover:border-[var(--border-strong)]',
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <Checkbox
                          className="mt-0.5 shrink-0"
                          checked={checked}
                          onChange={next => toggleBulkSelected(rule.id, next)}
                          aria-label={t('notifications.alertStudio.rules.selectRow', 'Select rule {{name}}', { name: rule.name || untitledRuleLabel })}
                        />
                        <div
                          role="button"
                          tabIndex={0}
                          className="min-w-0 flex-1 cursor-pointer"
                          onClick={() => handleSelectRule(rule)}
                          onKeyDown={event => handleRuleRowKeyDown(event, rule)}
                        >
                          <div className="flex items-center gap-2">
                            <SeverityIcon severity={sev} className="h-3.5 w-3.5 shrink-0" />
                            <Text weight="medium" size="xs" color="primary" className="flex-1 truncate">{rule.name || untitledRuleLabel}</Text>
                            {triggerMode === 'once' && (
                              <Badge variant="info" size="sm" title={t('notifications.alertStudio.rules.onceModeHint', 'Fires once until condition resets')}>
                                {t('notifications.alertStudio.rules.onceMode', 'Once')}
                              </Badge>
                            )}
                            {snoozed && rule.snoozed_until && (
                              <Badge variant="warning" size="sm">
                                <Icons.moonStar className="h-3 w-3" aria-hidden="true" />
                                {t('notifications.alertStudio.snooze.badge', 'Snoozed until {{time}}', { time: formatDateTime(rule.snoozed_until) })}
                              </Badge>
                            )}
                          </div>
                          <div className={cn('mt-1.5 flex items-center gap-3', typography.color.muted)}>
                            <Text as="span" size="2xs" mono color="muted">{rule.signal_name} {rule.op}</Text>
                            {rule.updated_at && (
                              <span className="flex items-center gap-1">
                                <Icons.clock className="h-3 w-3" aria-hidden="true" /> <Caption>{formatDateTime(rule.updated_at)}</Caption>
                              </span>
                            )}
                          </div>
                        </div>
                        <UiButton
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 shrink-0 p-0"
                          onClick={e => { e.stopPropagation(); setSnoozeTargetId(rule.id) }}
                          title={snoozed
                            ? t('notifications.alertStudio.snooze.manage', 'Manage snooze')
                            : t('notifications.alertStudio.snooze.button', 'Snooze')}
                          aria-label={snoozed
                            ? t('notifications.alertStudio.snooze.manage', 'Manage snooze')
                            : t('notifications.alertStudio.snooze.button', 'Snooze')}
                        >
                          <Icons.moonStar className={cn('h-3.5 w-3.5', snoozed ? 'text-amber-300' : 'text-[var(--text-muted)]')} aria-hidden="true" />
                        </UiButton>
                        <UiButton
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 shrink-0 p-0"
                          onClick={e => { e.stopPropagation(); toggleRuleMut.mutate({ id: rule.id, enabled: !rule.enabled }) }}
                          title={rule.enabled
                            ? t('notifications.alertStudio.rules.disable', 'Disable')
                            : t('notifications.alertStudio.rules.enable', 'Enable')}
                          aria-label={rule.enabled
                            ? t('notifications.alertStudio.rules.disableRule', 'Disable rule')
                            : t('notifications.alertStudio.rules.enableRule', 'Enable rule')}
                        >
                          {rule.enabled
                            ? <Icons.notificationsActive className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
                            : <Icons.notificationsMuted className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />}
                        </UiButton>
                        <UiButton
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 shrink-0 p-0 opacity-100 transition-opacity hover:text-rose-300 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
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
                          <Icons.delete className="h-3.5 w-3.5 text-[var(--text-muted)] hover:text-rose-300" aria-hidden="true" />
                        </UiButton>
                      </div>
                    </GlassPanel>
                  </li>
                )
              })}
            </ul>
          </GlassPanel>
        </section>

        <div className="space-y-4 xl:col-span-7 2xl:col-span-8 3xl:col-span-9">
          {(rules?.length ?? 0) >= 2 && (
            // Opt-in AI cross-rule conflict
            // detection. Renders only when ai_mode != 'off' AND the
            // cross-rule-conflict-detection toggle is on AND the
            // current rule set has at least two rules to compare.
            // The withAiFeature HOC inside AICrossRuleConflictDetection
            // enforces the gate; the manual editor below remains the
            // canonical baseline in off mode (ADR-015 §I3). The
            // component DETECTS structural conflicts only and surfaces
            // a "Review rule {id}" hand-off into the existing
            // selection state — saving still flows through the typed
            // handler below (ADR-015 §I3 baseline-intact + §I8
            // propose-only contract).
            <FadeIn delay={0.02}>
              <AICrossRuleConflictDetection
                ruleIds={(rules ?? []).map((r) => r.id)}
                vehicleId={aiVehicleId ?? undefined}
                onSelectRule={setSelectedId}
              />
            </FadeIn>
          )}
          {selectedId != null && (
            // Opt-in AI alert-rule tuning
            // suggestions. Renders only when ai_mode != 'off' AND the
            // alert-tuning-suggestions toggle is on AND a rule is
            // selected. The withAiFeature HOC inside
            // AIAlertTuningSuggestions enforces the gate; the manual
            // editor below remains the canonical baseline in off
            // mode (ADR-015 §I3). The component PROPOSES typed
            // patches only — saving still flows through the typed
            // handler below (ADR-015 §I3 baseline-intact + §I8
            // propose-only contract).
            <FadeIn delay={0.04}>
              <AIAlertTuningSuggestions
                ruleId={selectedId}
                vehicleId={aiVehicleId ?? undefined}
                onApplyDraft={handleApplyAITuningPatch}
              />
            </FadeIn>
          )}
          <GlassPanel className="p-4 sm:p-5" data-tour="alert-studio-builder">
            <div className="mb-4 flex items-center gap-2">
              <Icons.pencil className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              <PanelTitle>
                {isEditing
                  ? t('notifications.alertStudio.editor.editTitle', 'Edit Rule')
                  : t('notifications.alertStudio.editor.newTitle', 'New Rule')}
              </PanelTitle>
            </div>

            {hasDraft && (
              <div className="mb-4">
                <DraftRecoveryBanner
                  hasDraft={hasDraft}
                  draftSavedAt={draftSavedAt}
                  onDiscard={discardDraft}
                  itemNoun={t('draft.noun.rule', 'Alert rule')}
                />
              </div>
            )}

            {formError && (
              <div className="mb-4">
                <AlertBanner
                  variant="danger"
                  title={t('forms.validationFailed', 'Please fix the highlighted fields and try again.')}
                >
                  {formError}
                </AlertBanner>
              </div>
            )}

            <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={fieldLabelCls} htmlFor="alert-name">
                  {t('notifications.alertStudio.editor.nameLabel', 'Name')}
                </label>
                <UiInput
                  id="alert-name"
                  className="w-full"
                  placeholder={t('notifications.alertStudio.editor.namePlaceholder', 'My alert rule')}
                  value={editor.name}
                  onChange={e => setEditor(s => ({ ...s, name: e.target.value }))}
                />
              </div>
              <div>
                <label className={fieldLabelCls} htmlFor="alert-enabled">
                  {t('notifications.alertStudio.editor.enabledLabel', 'Status')}
                </label>
                <UiSelect
                  id="alert-enabled"
                  className="w-full"
                  value={String(editor.enabled)}
                  onChange={e => setEditor(s => ({ ...s, enabled: e.target.value === 'true' }))}
                  options={enabledOptions}
                />
              </div>
            </div>

            <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className={fieldLabelRowCls} htmlFor="alert-vehicle-picker">
                  {t('notifications.alertStudio.editor.vehiclesLabel', 'Vehicles')}
                  <HelpIcon i18nKey="help.fields.alertStudio.vehicles" content="Choose 'All vehicles' to apply this rule to your entire fleet, including any cars you add later. Otherwise pick a specific subset." for="alert-vehicle-picker" />
                </label>
                <VehicleMultiSelect
                  id="alert-vehicle-picker"
                  value={editor.vehicle_selection}
                  onChange={next => setEditor(s => ({ ...s, vehicle_selection: next }))}
                  vehicles={vehicles}
                  errorKey={
                    editor.vehicle_selection.kind === 'specific'
                      && editor.vehicle_selection.vehicle_ids.length === 0
                      ? 'notifications.alertStudio.editor.vehiclesEmptyError'
                      : null
                  }
                />
              </div>
              <div className="sm:col-span-2">
                <div className={fieldLabelRowCls}>
                  <span id="alert-kind-label">{t('notifications.alertStudio.editor.kindLabel', 'Rule type')}</span>
                  <HelpIcon i18nKey="help.fields.alertStudio.kind" content="Choose 'Signal threshold' to trigger when a raw telemetry signal crosses a value. Choose 'Computed metric' to trigger on a derived analytic such as efficiency or charging cost." for="alert-kind-label" />
                </div>
                <Tabs
                  ariaLabel={t('notifications.alertStudio.editor.kindLabel', 'Rule type')}
                  activeTab={editor.kind}
                  onChange={key => setEditor(s => ({ ...s, kind: key as AlertRuleKind }))}
                  tabs={[
                    { key: 'signal', label: t('notifications.alertStudio.kind.signal', 'Signal threshold') },
                    { key: 'computed_metric', label: t('notifications.alertStudio.kind.computedMetric', 'Computed metric') },
                  ]}
                />
                <HelperText className="mt-1">
                  {editor.kind === 'computed_metric'
                    ? t(
                        'notifications.alertStudio.kind.computedMetricHint',
                        'Aggregate metric (cost, kWh, distance) over a time window.',
                      )
                    : t(
                        'notifications.alertStudio.kind.signalHint',
                        'Fires when a raw telemetry signal crosses a threshold.',
                      )}
                </HelperText>
              </div>
            </div>

            {editor.kind === 'computed_metric' ? (
              <ComputedMetricEditor
                value={{
                  metric_id: editor.metric_id,
                  metric_window: editor.metric_window,
                  metric_op: editor.metric_op,
                  metric_threshold: editor.metric_threshold,
                  vehicle_id:
                    editor.vehicle_selection.kind === 'specific'
                      && editor.vehicle_selection.vehicle_ids.length > 0
                      ? editor.vehicle_selection.vehicle_ids[0]
                      : null,
                }}
                onChange={next =>
                  setEditor(s => ({
                    ...s,
                    metric_id: next.metric_id,
                    metric_window: next.metric_window,
                    metric_op: next.metric_op,
                    metric_threshold: next.metric_threshold,
                  }))
                }
                metrics={computedMetrics}
                loading={computedMetricsQuery.isLoading}
              />
            ) : (
              <>
                <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={fieldLabelCls} htmlFor="alert-signal">
                      {t('notifications.alertStudio.editor.signalNameLabel', 'Signal')}
                    </label>
                    <UiSelect
                      id="alert-signal"
                      className="w-full"
                      value={editor.signal_name}
                      onChange={e => handleSignalChange(e.target.value)}
                      placeholder={t('notifications.alertStudio.editor.signalNamePlaceholder', 'Select a telemetry signal')}
                      options={signalSelectOptions}
                    />
                    {selectedSignal && (
                      <HelperText className="mt-1">
                        {t('notifications.alertStudio.editor.signalTypeHint', '{{type}} signal from {{category}}', {
                          type: signalTypeLabels[selectedSignal.value_type],
                          category: getSignalCategoryLabel(selectedSignal.category),
                        })}
                      </HelperText>
                    )}
                  </div>
                  <div>
                    <label className={fieldLabelRowCls} htmlFor="alert-operator">
                      {t('notifications.alertStudio.editor.operatorLabel', 'Operator')}
                      <HelpIcon i18nKey="help.fields.alertStudio.operator" content="The comparison applied between the live signal value and your typed value. Available operators depend on the signal's value type." for="alert-operator" />
                    </label>
                    <UiSelect
                      id="alert-operator"
                      className="w-full"
                      value={editor.op}
                      onChange={e => handleOperatorChange(e.target.value as RuleOp)}
                      options={operatorSelectOptions}
                      disabled={!editor.signal_name.trim()}
                    />
                  </div>
                </div>
              </>
            )}

            <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={fieldLabelRowCls} htmlFor="alert-severity">
                  {t('notifications.alertStudio.editor.severityLabel', 'Severity')}
                  <HelpIcon i18nKey="help.fields.alertStudio.severity" content="Determines how the alert is presented and prioritised: Info is informational, Warning is actionable, Critical is urgent." for="alert-severity" />
                </label>
                <UiSelect
                  id="alert-severity"
                  className="w-full"
                  value={editor.severity}
                  onChange={e => {
                    const next = e.target.value as Severity
                    setEditor(s => {
                      // Reset escalation_severity
                      // if the new base severity makes it no longer
                      // strictly higher (e.g. user bumps base from warn
                      // to critical, the previously-set warn escalation
                      // is now a downgrade).
                      const escSev = s.escalation_severity
                      const stillValid =
                        escSev === '' || SEVERITY_RANK[escSev] > SEVERITY_RANK[next]
                      return {
                        ...s,
                        severity: next,
                        escalation_severity: stillValid ? escSev : '',
                      }
                    })
                  }}
                  options={severityOptions}
                />
              </div>
              {editor.kind !== 'computed_metric' && (
                <GlassPanel className="p-3">
                  <Text as="p" variant="label" className="mb-1">
                    {t('notifications.alertStudio.editor.allowedOperatorsLabel', 'Allowed Operators')}
                  </Text>
                  <Text size="xs" color="primary">
                    {editor.signal_name.trim()
                      ? operatorSelectOptions.map(option => option.label).join('  ')
                      : t('notifications.alertStudio.editor.allowedOperatorsPlaceholder', 'Select a signal to see its operators')}
                  </Text>
                </GlassPanel>
              )}
            </div>

            {editor.kind !== 'computed_metric' && (
              <div className="mb-4">
                <Text as="p" variant="label" className="mb-2">
                  {t('notifications.alertStudio.editor.typedValueLabel', 'Typed Value')}
                </Text>
                {renderValueEditor()}
              </div>
            )}

            <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={fieldLabelRowCls} htmlFor="alert-cooldown">
                  {t('notifications.alertStudio.editor.cooldownLabel', 'Cooldown (minutes)')}
                  <HelpIcon i18nKey="help.fields.alertStudio.cooldown" content="Minimum minutes to wait between repeat firings of this rule. Helps prevent notification spam during prolonged threshold breaches." for="alert-cooldown" />
                </label>
                <UiInput
                  id="alert-cooldown"
                  type="number"
                  min={1}
                  className="w-full"
                  value={editor.cooldown_min}
                  onChange={e => setEditor(s => ({ ...s, cooldown_min: Number(e.target.value) }))}
                />
              </div>
              <div data-testid="alert-behavior-block">
                <label className={fieldLabelRowCls} htmlFor="alert-trigger-mode">
                  {t('notifications.alertStudio.editor.alertBehaviorLabel', 'Alert Behavior')}
                  <HelpIcon i18nKey="help.fields.alertStudio.alertBehavior" content="Pick 'Notify on event' for one-time confirmations like 'vehicle locked' or 'charging done'. Pick 'Re-alert until resolved' for ongoing safety concerns like 'vehicle unlocked' or 'door open'." for="alert-trigger-mode" />
                </label>
                {showRecommendBanner && (
                  <AlertBanner
                    variant="info"
                    className="mb-2"
                    role="status"
                    data-testid="alert-behavior-recommend-banner"
                  >
                    <span>
                      {t(
                        'notifications.alertStudio.editor.alertBehavior.recommendBanner',
                        'Recommended for "{{op}}" comparisons: {{recommended}}.',
                        { op: editor.op, recommended: recommendedLabel },
                      )}
                    </span>
                    <span className="ml-1">
                      {t(
                        'notifications.alertStudio.editor.alertBehavior.recommendBannerAlt',
                        '{{alternative}} is also valid — pick whatever fits.',
                        { alternative: alternativeLabel },
                      )}
                    </span>
                  </AlertBanner>
                )}
                <UiSelect
                  id="alert-trigger-mode"
                  className="w-full"
                  value={editor.trigger_mode === 'unset' ? '' : editor.trigger_mode}
                  // Placeholder option is
                  // disabled, so this branch only ever sees 'once' or
                  // 'repeat' from real user interaction. Defensive
                  // guard kept for type-narrowing.
                  onChange={e => {
                    const v = e.target.value
                    if (v !== 'once' && v !== 'repeat') return
                    setEditor(s => ({
                      ...s,
                      trigger_mode: v,
                      // Flipping to once-mode
                      // disables the escalation section AND nulls the
                      // pair so a stale value from an earlier 'repeat'
                      // selection can't sneak through buildSavePayload.
                      escalation_enabled: v === 'repeat' ? s.escalation_enabled : false,
                      escalation_after_min: v === 'repeat' ? s.escalation_after_min : '',
                      escalation_severity: v === 'repeat' ? s.escalation_severity : '',
                    }))
                  }}
                  options={alertBehaviorOptions}
                  aria-invalid={triggerModeBlocked ? 'true' : undefined}
                  aria-describedby={triggerModeBlocked ? 'alert-trigger-mode-error' : undefined}
                />
                {triggerModeBlocked && (
                  <ErrorText
                    id="alert-trigger-mode-error"
                    className="mt-1"
                    data-testid="alert-behavior-force-choose"
                  >
                    {t(
                      'notifications.alertStudio.editor.alertBehavior.forceChoose',
                      'Pick how this alert should behave.',
                    )}
                  </ErrorText>
                )}
                {!triggerModeBlocked && editor.trigger_mode !== 'unset' && (
                  <HelperText className="mt-1">
                    {editor.trigger_mode === 'once'
                      ? t(
                          'notifications.alertStudio.editor.alertBehavior.onceDesc',
                          'Fires when the condition is first met. Stays quiet until it resets.',
                        )
                      : t(
                          'notifications.alertStudio.editor.alertBehavior.repeatDesc',
                          'Keeps firing every {{cooldown}} minutes while the condition stays true.',
                          { cooldown: editor.cooldown_min },
                        )}
                  </HelperText>
                )}
              </div>
              {editor.trigger_mode === 'repeat' && (
                <div className="sm:col-span-2">
                  <label className={fieldLabelRowCls} htmlFor="alert-max-fires">
                    {t(
                      'notifications.alertStudio.editor.maxFiresLabel',
                      'Max alerts before condition resolves',
                    )}
                    <HelpIcon
                      i18nKey="help.fields.alertStudio.maxFires"
                      content="Cap the number of times this rule can re-fire while the condition keeps holding. The counter resets to zero as soon as the condition becomes false. Leave blank for unlimited."
                      for="alert-max-fires"
                    />
                  </label>
                  <UiInput
                    id="alert-max-fires"
                    type="number"
                    min={1}
                    step={1}
                    className="w-full"
                    value={editor.max_fires_per_resolution}
                    placeholder={t(
                      'notifications.alertStudio.editor.maxFiresPlaceholder',
                      'Leave blank for unlimited',
                    )}
                    onChange={e =>
                      setEditor(s => ({ ...s, max_fires_per_resolution: e.target.value }))
                    }
                  />
                  <HelperText className="mt-1">
                    {t(
                      'notifications.alertStudio.editor.maxFiresHint',
                      'Only applies to repeat-mode rules. Once-mode already caps at 1 per resolution.',
                    )}
                  </HelperText>
                </div>
              )}
              {editor.trigger_mode === 'repeat' && (
                <div className="sm:col-span-2">
                  <div className="mb-2 flex items-center gap-2">
                    <Toggle
                      id="alert-escalation-enabled"
                      checked={editor.escalation_enabled}
                      onChange={next =>
                        setEditor(s => ({
                          ...s,
                          escalation_enabled: next,
                          // Clear the pair when toggling off so a stale
                          // value can't sneak through buildSavePayload.
                          escalation_after_min: next ? s.escalation_after_min : '',
                          escalation_severity: next ? s.escalation_severity : '',
                        }))
                      }
                      size="sm"
                    />
                    <Text size="xs" weight="medium" color="primary">
                      {t(
                        'notifications.alertStudio.editor.escalationCheckboxLabel',
                        'Escalate to a higher severity if the condition stays unresolved',
                      )}
                    </Text>
                    <HelpIcon
                      i18nKey="help.fields.alertStudio.escalation"
                      content="When the underlying condition stays true for at least the minutes you specify, subsequent fires use the escalated severity instead of the base one. Useful for a soft warn → critical promotion when a problem is being ignored."
                      for="alert-escalation-enabled"
                    />
                  </div>
                  {editor.escalation_enabled && (
                    <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className={fieldLabelCls} htmlFor="alert-escalation-after">
                          {t(
                            'notifications.alertStudio.editor.escalationAfterLabel',
                            'Escalate after (minutes)',
                          )}
                        </label>
                        <UiInput
                          id="alert-escalation-after"
                          type="number"
                          min={1}
                          step={1}
                          className="w-full"
                          value={editor.escalation_after_min}
                          placeholder={t(
                            'notifications.alertStudio.editor.escalationAfterPlaceholder',
                            'e.g. 30',
                          )}
                          onChange={e =>
                            setEditor(s => ({ ...s, escalation_after_min: e.target.value }))
                          }
                        />
                      </div>
                      <div>
                        <label className={fieldLabelCls} htmlFor="alert-escalation-severity">
                          {t(
                            'notifications.alertStudio.editor.escalationSeverityLabel',
                            'Escalated severity',
                          )}
                        </label>
                        <UiSelect
                          id="alert-escalation-severity"
                          className="w-full"
                          value={editor.escalation_severity}
                          onChange={e =>
                            setEditor(s => ({
                              ...s,
                              escalation_severity: e.target.value as Severity | '',
                            }))
                          }
                          options={[
                            {
                              value: '',
                              label: t(
                                'notifications.alertStudio.editor.escalationSeverityPlaceholder',
                                'Select severity…',
                              ),
                            },
                            ...severityOptions.filter(
                              opt => SEVERITY_RANK[opt.value as Severity] > SEVERITY_RANK[editor.severity],
                            ),
                          ]}
                        />
                      </div>
                      <HelperText className="sm:col-span-2">
                        {t(
                          'notifications.alertStudio.editor.escalationHint',
                          'Only repeat-mode rules can escalate. The escalated severity must be higher than the base severity.',
                        )}
                      </HelperText>
                    </div>
                  )}
                </div>
              )}
              <div className="sm:col-span-2">
                {/* Replaces the legacy single-line
                    "Test Message" UiInput with the new per-rule
                    AlertMessageEditor. The editor manages msg_template +
                    include_title; the legacy `editor.message` field is
                    still threaded into the Test endpoint as a fallback
                    so the test-delivery preview behaviour is preserved
                    when msg_template is blank. */}
                <AlertMessageEditor
                  msgTemplate={editor.msg_template}
                  includeTitle={editor.include_title}
                  draft={{
                    name: editor.name,
                    kind: editor.kind,
                    signal_name: editor.signal_name,
                    op: editor.op,
                    severity: editor.severity,
                    vehicle_name: previewVehicleName,
                    value_num: parseOptionalNumber(editor.value_num),
                    value_text: editor.value_text || null,
                    value_bool: editor.value_bool,
                    value_min: parseOptionalNumber(editor.value_min),
                    value_max: parseOptionalNumber(editor.value_max),
                    metric_id: editor.metric_id || null,
                    metric_window: editor.metric_window || null,
                    metric_op: editor.metric_op,
                    metric_threshold: parseOptionalNumber(editor.metric_threshold),
                  }}
                  onTemplateChange={next => setEditor(s => ({ ...s, msg_template: next }))}
                  onIncludeTitleChange={next => setEditor(s => ({ ...s, include_title: next }))}
                />
              </div>
            </div>

            <div className="mb-4">
              <Text as="p" variant="label" className="mb-2">
                {t('notifications.alertStudio.channels.testTargetLabel', 'Test Delivery Target')}
              </Text>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
                  <Text size="xs" color="primary">
                    {t('notifications.alertStudio.channels.browserToast', 'Browser toast notification (real-time via SSE)')}
                  </Text>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
                  <Text size="xs" color="primary">
                    {t('notifications.alertStudio.channels.alertHistory', 'Alert history (saved to database)')}
                  </Text>
                </div>

                <GlassPanel className="p-3" data-tour="alert-studio-channels">
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
                      <HelperText className="mb-1.5">
                        {t('notifications.alertStudio.channels.externalChannels', 'External channels for test notifications:')}
                      </HelperText>
                      <div className="flex flex-wrap gap-2">
                        {channelsList.map(ch => {
                          const isSelected = testChannelIds === null || testChannelIds.includes(ch.id)
                          return (
                            <UiButton
                              key={ch.id}
                              variant="ghost"
                              size="sm"
                              aria-pressed={isSelected}
                              className={cn(
                                'h-auto rounded-lg border px-3 py-1.5 text-xs transition-colors',
                                isSelected
                                  ? 'border-neon-cyan/30 bg-neon-cyan/10 text-cyan-300'
                                  : 'border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-muted)] hover:border-[var(--border-strong)]',
                              )}
                              onClick={() => handleToggleTestChannel(ch.id)}
                            >
                              <Icons.notifications className="h-3 w-3" aria-hidden="true" />
                              {ch.name} ({t(`notifications.alertStudio.channels.kind.${ch.kind}`, ch.kind)})
                            </UiButton>
                          )
                        })}
                      </div>
                    </div>
                  ) : (
                    <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                      icon={<Icons.notificationsMuted className="h-8 w-8 text-[var(--text-muted)]" />}
                      title={t('notifications.alertStudio.channels.emptyTitle', 'No external channels configured')}
                      message={t('notifications.alertStudio.channels.emptyDescription', 'Browser toasts and alert history are always enabled. Configure channels from Notifications to fan out alerts.')}
                    />
                  )}
                </GlassPanel>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
              <UiButton
                variant="primary"
                size="sm"
                icon={<Icons.save className="h-3.5 w-3.5" />}
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
                  icon={<Icons.delete className="h-3.5 w-3.5" />}
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
                icon={<Icons.notifications className="h-3.5 w-3.5" />}
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
          <div className="space-y-3">
            <Text as="p" size="sm" color="secondary">
              {t(
                'notifications.alertStudio.snooze.description',
                'Suppress this rule temporarily. Snooze auto-expires; the rule will fire again afterwards if its condition is true.',
              )}
            </Text>
            {snoozeTargetActive && snoozeTargetRule.snoozed_until && (
              <div className="flex items-center gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                <Icons.moonStar className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
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
      {discardDialogProps && <ConfirmDialog {...discardDialogProps} />}
    </PageContainer>
  )
}
