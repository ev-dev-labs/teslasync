/**
 * Shared notification rule editor: create in Studio, edit on the Rules page.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type AlertRule,
  type AlertRuleInput,
  type AlertRuleTriggerMode,
  type AlertTestTarget,
  type ComputedMetricSummary,
  useAlertMetrics,
  useNotificationChannels,
  useSaveAlertRule,
  useTestAlertRule,
} from '@/api/hooks/useNotifications'
import { useAvailableSignals } from '@/api/hooks/useSignals'
import type { AlertRuleKind, AlertRuleTransition, ComputedMetricOp, SignalUnitKind } from '@/api/types'
import type { SignalValueType } from '@/types/signals'
import { GlassPanel, Button as UiButton, ConfirmDialog, Input as UiInput, Select as UiSelect, HelpIcon, Tabs, Toggle, Text, PanelTitle, Caption, HelperText, ErrorText } from '@/components/ui'
import { SeverityBadge } from '@/components/data-display'
import { PageContainer } from '@/components/layout'
import { FadeIn } from '@/components/motion'
import { AlertBanner, DraftRecoveryBanner, EmptyState, ErrorDisplay, Skeleton } from '@/components/feedback'
import { SearchInput, VehicleMultiSelect, hydrateVehicleSelection, buildVehiclePayload, type VehicleSelection } from '@/components/forms'
import { fmtInt } from '@/lib/numberFormat'
import { useVehicles } from '@/api/hooks/useVehicles'
import { cn } from '@/lib/cn'
import { severityTokens, typography } from '@/lib/tokens'
import { useConfirm } from '@/hooks/useConfirm'
import { useDirtyForm } from '@/hooks/useDirtyForm'
import { useFormDraft } from '@/hooks/useFormDraft'
import { useNavigationGuard } from '@/hooks/useNavigationGuard'
import { alertRuleSchema } from '../schemas/alertRule'
import { ruleTemplates, type RuleTemplate } from '../lib/alertRuleTemplates'
import { ComputedMetricEditor } from './ComputedMetricEditor'
import { PlaceRuleFields } from './PlaceRuleFields'
import { SystemComponentRuleFields } from './SystemComponentRuleFields'
import { AlertMessageEditor } from './AlertMessageEditor'
import { recommendedTriggerMode } from '../lib/recommendedTriggerMode'
import { DEFAULT_ALERT_COOLDOWN_S, getAlertBehaviorOptions } from '../lib/alertDelivery'
import { Icons } from '@/lib/icons';
import { AINLAlertBuilder } from '@/components/ai/AINLAlertBuilder'
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle'

// 'unset' is retained only to guard a draft saved before the new default.
// Newly created rules always start in 'once' (notify on event).
type TriggerModeOrUnset = AlertRuleTriggerMode | 'unset'

type Severity = NonNullable<AlertRuleInput['severity']>
type RuleOp = NonNullable<AlertRuleInput['op']>
type ValueKind = 'none' | 'number' | 'text' | 'bool' | 'range'

interface SignalDefinition {
  name: string
  category: string
  value_type: SignalValueType
}

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
  channel_ids: number[] | null
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
  component_name: string
  place_id: string
  transition: AlertRuleTransition
  metric_id: string
  metric_window: string
  metric_op: ComputedMetricOp
  metric_threshold: string
}

function freshEditor(): EditorState {
  return {
    channel_ids: null,
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
    cooldown_min: DEFAULT_ALERT_COOLDOWN_S / 60,
    trigger_mode: 'once',
    max_fires_per_resolution: '',
    escalation_enabled: false,
    escalation_after_min: '',
    escalation_severity: '',
    message: '',
    msg_template: '',
    include_title: false,
    kind: 'signal',
    component_name: '',
    place_id: '',
    transition: 'outage',
    metric_id: '',
    metric_window: '',
    metric_op: '>',
    metric_threshold: '',
  }
}

function isEditorDraft(value: unknown): value is EditorState {
  if (!value || typeof value !== 'object') return false
  const draft = value as Partial<EditorState>
  const selection = draft.vehicle_selection
  if (!selection || (selection.kind !== 'all_sticky' &&
    (selection.kind !== 'specific' || !Array.isArray(selection.vehicle_ids)))) return false
  if (draft.channel_ids !== null && !Array.isArray(draft.channel_ids)) return false
  if (!['signal', 'computed_metric', 'system_component', 'place'].includes(draft.kind ?? '')) return false
  if (!['outage', 'recovery', 'enter', 'exit'].includes(draft.transition ?? '')) return false
  const defaults = freshEditor()
  return (Object.keys(defaults) as Array<keyof EditorState>).every(key =>
    key === 'vehicle_selection' || key === 'channel_ids' ||
    typeof draft[key] === typeof defaults[key],
  )
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

function inferTemplateValueKind(template: RuleTemplate): ValueKind {
  return valueKindForSignalOp(inferTemplateSignalType(template), template.op)
}

function ruleToEditor(rule: AlertRule): EditorState {
  const triggerMode = rule.trigger_mode === 'once' ? 'once' : 'repeat'
  const valueKind: ValueKind = isRangeOp(rule.op) || rule.value_min != null || rule.value_max != null
    ? 'range' : rule.value_bool != null ? 'bool' : rule.value_text != null
      ? 'text' : rule.op === 'changed' ? 'none' : 'number'
  return {
    ...freshEditor(),
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    channel_ids: rule.channel_ids ?? null,
    vehicle_selection: hydrateVehicleSelection(rule),
    signal_name: rule.signal_name ?? '',
    op: rule.op ?? '=',
    value_kind: valueKind,
    value_num: valueToInput(rule.value_num),
    value_text: rule.value_text ?? '',
    value_bool: rule.value_bool ?? true,
    value_min: valueToInput(rule.value_min),
    value_max: valueToInput(rule.value_max),
    severity: rule.severity === 'critical' || rule.severity === 'warn' ? rule.severity : 'info',
    cooldown_min: rule.cooldown_min,
    trigger_mode: triggerMode,
    max_fires_per_resolution: rule.max_fires_per_resolution == null ? '' : String(rule.max_fires_per_resolution),
    escalation_enabled: rule.escalation_after_min != null && rule.escalation_severity != null,
    escalation_after_min: rule.escalation_after_min == null ? '' : String(rule.escalation_after_min),
    escalation_severity: rule.escalation_severity ?? '',
    msg_template: rule.msg_template ?? '',
    include_title: rule.include_title ?? true,
    kind: rule.kind ?? 'signal',
    component_name: rule.component_name ?? '',
    place_id: valueToInput(rule.place_id),
    transition: rule.transition ?? (rule.kind === 'place' ? 'enter' : 'outage'),
    metric_id: rule.metric_id ?? '',
    metric_window: rule.metric_window ?? '',
    metric_op: rule.metric_op ?? '>',
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
    include_title: false,
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

  if (state.kind === 'system_component' || state.kind === 'place') {
    const common = {
      name: state.name.trim(),
      channel_ids: Array.isArray(state.channel_ids) ? state.channel_ids : null,
      enabled: state.enabled,
      severity: state.severity,
      cooldown_min: state.cooldown_min,
      trigger_mode: triggerMode,
      max_fires_per_resolution: parseOptionalMaxFires(state.max_fires_per_resolution),
      ...buildEscalationPayload(state, triggerMode),
      msg_template: normalizeMsgTemplateForSave(state.msg_template),
      include_title: state.include_title,
    }
    if (state.kind === 'system_component') {
      return {
        ...common,
        kind: 'system_component',
        all_vehicles: true,
        vehicle_ids: [],
        component_name: state.component_name,
        transition: state.transition,
      }
    }
    return {
      ...common,
      ...vehiclePayload,
      kind: 'place',
      place_id: Number(state.place_id),
      transition: state.transition,
    }
  }

  if (state.kind === 'computed_metric') {
    const threshold = parseOptionalNumber(state.metric_threshold)
    const escalation = buildEscalationPayload(state, triggerMode)
    return {
      name: state.name.trim(),
      channel_ids: Array.isArray(state.channel_ids) ? state.channel_ids : null,
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
    channel_ids: Array.isArray(state.channel_ids) ? state.channel_ids : null,
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

export interface AlertRuleEditorProps {
  /** null creates a rule; an existing rule opens the same form for full editing. */
  rule: AlertRule | null
  onSaved?: (rule: AlertRule) => void
  onCancel?: () => void
}

export function AlertRuleEditor({ rule, onSaved, onCancel }: AlertRuleEditorProps) {
  const { t } = useTranslation()
  // Fail closed if the server introduces a new rule kind before this editor
  // gains its corresponding typed condition fields and validator.
  const unsupportedKind = rule?.kind != null
    && rule.kind !== 'signal' && rule.kind !== 'computed_metric'
    && rule.kind !== 'system_component' && rule.kind !== 'place'
  const pageTitle = t('notifications.alertStudio.title', 'Alert Studio')
  const pageSubtitle = t('notifications.alertStudio.subtitle', 'Create rules for vehicle signals, computed metrics, system health, and places')

  const { data: channels, isLoading: channelsLoading, error: channelsError } = useNotificationChannels()
  // Drives the multi-vehicle picker.
  const { data: vehiclesData } = useVehicles()
  const vehicles = useMemo(() => vehiclesData ?? [], [vehiclesData])
  const saveRuleMut = useSaveAlertRule()
  const testRuleMut = useTestAlertRule()
  const { confirm: confirmDiscard, dialogProps: discardDialogProps } = useConfirm()
  const { vehicleId: aiVehicleId } = useSelectedVehicle()
  const availableSignalsQuery = useAvailableSignals(aiVehicleId ?? 0)

  const [showTemplates, setShowTemplates] = useState(false)
  const [templateSearch, setTemplateSearch] = useState('')
  const [templateCategory, setTemplateCategory] = useState<string | null>(null)
  const [testChannelIds, setTestChannelIds] = useState<number[] | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  // Template selection can race with draft restoration. Reapply the chosen
  // template after useFormDraft has completed its render-time reset.
  const pendingHydrationRef = useRef<EditorState | null>(null)

  // `useFormDraft` persists in-progress new-rule
  // editing to localStorage so a tab close, SW reload, or auth redirect
  // doesn't destroy the user's work.
  const draftKey = `alertstudio:rule:${rule?.id ?? 'new'}`
  const freshEditorJsonRef = useRef<string>(JSON.stringify(freshEditor()))
  const {
    value: editor,
    setValue: setEditor,
    hasDraft,
    draftSavedAt,
    discardDraft,
  } = useFormDraft<EditorState>(draftKey, rule ? ruleToEditor(rule) : freshEditor(), {
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
    // Event-rule fields have typed defaults; an older draft would leave
    // them undefined and could silently submit the wrong condition.
    version: 6,
    validateDraft: isEditorDraft,
    debounceMs: 800,
    skipPersist: v =>
      saveRuleMut.isPending
      || rule != null
      || JSON.stringify(v) === freshEditorJsonRef.current,
  })

  // A recovered draft is already persisted locally. Merely opening it is
  // not a new edit; compare against what the user actually saw on entry.
  const initialEditorRef = useRef<string>(JSON.stringify(editor))
  const isDirty = JSON.stringify(editor) !== initialEditorRef.current

  const handleDiscardDraft = useCallback(() => {
    initialEditorRef.current = JSON.stringify(freshEditor())
    discardDraft()
  }, [discardDraft])

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
  }, [setEditor])

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

  const channelsList = channels ?? []
  // Older persisted Studio drafts predate per-rule channel routing. They
  // should inherit enabled channels, never crash the form on `.length`.
  const ruleChannelIds = Array.isArray(editor.channel_ids) ? editor.channel_ids : null
  const allChannelIds = useMemo(() => channelsList.map(ch => ch.id), [channelsList])
  // Category pills for the template browser. "all" clears the filter; each
  // category pill carries its live template count.
  const categoryPills = useMemo(() => [
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
    ...getAlertBehaviorOptions(t),
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
  const showRecommendBanner = editor.kind === 'signal' && editor.signal_name.trim().length > 0
  const triggerModeBlocked = editor.trigger_mode === 'unset'

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
    if (unsupportedKind) return false
    if (editor.name.trim().length === 0) return false
    if (editor.cooldown_min <= 0) return false
    if (editor.trigger_mode === 'unset') return false
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
    if (editor.kind === 'system_component') {
      return !!editor.component_name
        && (editor.transition === 'outage' || editor.transition === 'recovery')
        && editor.vehicle_selection.kind === 'all_sticky'
    }
    if (editor.kind === 'place') {
      return Number.isSafeInteger(Number(editor.place_id)) && Number(editor.place_id) > 0
        && (editor.transition === 'enter' || editor.transition === 'exit')
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
  }, [computedMetrics, editor, unsupportedKind])

  const handleNewRule = useCallback(() => {
    guardSwitch(() => {
      const blank = freshEditor()
      pendingHydrationRef.current = blank
      setEditor(blank)
      initialEditorRef.current = JSON.stringify(blank)
      setFormError(null)
    })
  }, [guardSwitch, setEditor])

  const handleCloneTemplate = useCallback((tpl: RuleTemplate) => {
    guardSwitch(() => {
      const next = templateToEditor(tpl, getTemplateName(tpl), getTemplateMessage(tpl))
      pendingHydrationRef.current = next
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
      rule ? { ...payload, id: rule.id } : payload,
      {
        onSuccess: saved => {
          if (rule) {
            initialEditorRef.current = JSON.stringify(editor)
            setEditor(current => ({ ...current }))
            onSaved?.(saved)
            return
          }
          onSaved?.(saved)
          discardDraft()
          const blank = freshEditor()
          pendingHydrationRef.current = blank
          setEditor(blank)
          initialEditorRef.current = JSON.stringify(blank)
        },
      },
    )
  }, [canSave, discardDraft, editor, onSaved, rule, saveRuleMut, setEditor, t])

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

  const content = (
    <>
      {/* Opt-in AI natural-language alert builder. Renders only when
          ai_mode != 'off' AND the nl-alert-builder toggle is on (withAiFeature
          HOC gate). PROPOSES drafts only — saving still flows through the typed
          handler below (ADR-015 §I3 baseline-intact + PROPOSE-only contract). */}
      {!rule && <FadeIn delay={0.04}>
        <AINLAlertBuilder vehicleId={aiVehicleId ?? undefined} />
      </FadeIn>}


      {!rule && showTemplates && (
        <FadeIn>
          <GlassPanel className="p-4 sm:p-5">
            <div className="mb-4">
              <PanelTitle>
                {t('notifications.alertStudio.templates.header', 'Rule Templates - {{count}} pre-built rules', { count: ruleTemplates.length })}
              </PanelTitle>
            </div>
            <div className="mb-4">
              <Caption className="mb-2 block">
                {t('notifications.alertStudio.templates.searchLabel', 'Search templates')}
              </Caption>
              <SearchInput
                value={templateSearch}
                onChange={setTemplateSearch}
                placeholder={t('notifications.alertStudio.templates.searchPlaceholder', 'Search templates...')}
                ariaLabel={t('notifications.alertStudio.templates.searchLabel', 'Search templates')}
                className="w-full"
              />
            </div>

            <div
              role="group"
              aria-label={t('notifications.alertStudio.templates.categoryFilter', 'Filter templates by category')}
              className="mb-3 flex flex-wrap gap-2"
            >
              {categoryPills.map(item => {
                const selected = (templateCategory ?? 'all') === item.key
                return (
                  <UiButton
                    key={item.key}
                    type="button"
                    size="sm"
                    variant={selected ? 'primary' : 'ghost'}
                    aria-pressed={selected}
                    onClick={() => setTemplateCategory(item.key === 'all' ? null : item.key)}
                    className="min-h-9 rounded-shape-lg border border-[var(--border-default)] px-3"
                  >
                    {item.label} ({fmtInt(item.count)})
                  </UiButton>
                )
              })}
            </div>
            <Caption role="status" className="mb-4 block">
              {t('notifications.alertStudio.templates.showing', '{{count}} of {{total}} templates', {
                count: filteredTemplates.length,
                total: ruleTemplates.length,
              })}
            </Caption>

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

      <div className="space-y-4">
          <GlassPanel className="p-4 sm:p-5" data-tour="alert-studio-builder">
            <div className="mb-4 flex items-center gap-2">
              <Icons.pencil className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              <PanelTitle>{rule
                ? t('notifications.alertStudio.editor.editTitle', 'Edit Rule')
                : t('notifications.alertStudio.editor.newTitle', 'New Rule')}</PanelTitle>
            </div>

            {hasDraft && (
              <div className="mb-4">
                <DraftRecoveryBanner
                  hasDraft={hasDraft}
                  draftSavedAt={draftSavedAt}
                  onDiscard={handleDiscardDraft}
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
            {unsupportedKind && (
              <AlertBanner variant="danger" title={t('forms.validationFailed', 'Please fix the highlighted fields and try again.')}>
                {t('notifications.alertStudio.editor.unsupportedKind', 'This rule type cannot be edited by this version of the editor. No changes have been saved.')}
              </AlertBanner>
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
              {editor.kind !== 'system_component' && <div>
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
              </div>}
              <div className="sm:col-span-2">
                <div className={fieldLabelRowCls}>
                  <span id="alert-kind-label">{t('notifications.alertStudio.editor.kindLabel', 'Rule type')}</span>
                  <HelpIcon i18nKey="help.fields.alertStudio.kind" content="Choose a live signal, computed metric, system health transition, or place arrival/departure to monitor." for="alert-kind-label" />
                </div>
                <Tabs
                  ariaLabel={t('notifications.alertStudio.editor.kindLabel', 'Rule type')}
                  activeTab={editor.kind}
                  onChange={key => setEditor(s => ({
                    ...s,
                    kind: key as AlertRuleKind,
                    transition: key === 'place' ? 'enter' : key === 'system_component' ? 'outage' : s.transition,
                    vehicle_selection: key === 'system_component' ? { kind: 'all_sticky' } : s.vehicle_selection,
                  }))}
                  tabs={[
                    { key: 'signal', label: t('notifications.alertStudio.kind.signal', 'Signal threshold') },
                    { key: 'computed_metric', label: t('notifications.alertStudio.kind.computedMetric', 'Computed metric') },
                    { key: 'system_component', label: t('notifications.alertStudio.kind.system', 'System service') },
                    { key: 'place', label: t('notifications.alertStudio.kind.place', 'Place event') },
                  ]}
                />
                <HelperText className="mt-1">
                  {editor.kind === 'computed_metric'
                    ? t(
                        'notifications.alertStudio.kind.computedMetricHint',
                        'Aggregate metric (cost, kWh, distance) over a time window.',
                      )
                    : editor.kind === 'system_component'
                      ? t('notifications.alertStudio.kind.systemHint', 'Notify when a monitored system service fails or recovers.')
                      : editor.kind === 'place'
                        ? t('notifications.alertStudio.kind.placeHint', 'Notify when a vehicle arrives at or departs from a saved place.')
                        : t(
                        'notifications.alertStudio.kind.signalHint',
                        'Fires when a raw telemetry signal crosses a threshold.',
                      )}
                </HelperText>
              </div>
            </div>

            {editor.kind === 'system_component' ? (
              <SystemComponentRuleFields
                component={editor.component_name}
                transition={editor.transition}
                onChange={(component_name, transition) => setEditor(s => ({ ...s, component_name, transition }))}
              />
            ) : editor.kind === 'place' ? (
              <PlaceRuleFields
                placeId={editor.place_id}
                transition={editor.transition}
                onChange={(place_id, transition) => setEditor(s => ({ ...s, place_id, transition }))}
              />
            ) : editor.kind === 'computed_metric' ? (
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
              {editor.kind === 'signal' && (
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

            {editor.kind === 'signal' && (
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
                </label>
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
                  aria-describedby={triggerModeBlocked
                    ? 'alert-trigger-mode-help alert-trigger-mode-error'
                    : 'alert-trigger-mode-help'}
                />
                <HelperText id="alert-trigger-mode-help" className="mt-2">
                  {t(
                    'help.fields.alertStudio.alertBehavior',
                    "Pick 'Notify on event' for one-time confirmations like 'vehicle locked' or 'charging done'. Pick 'Re-alert until resolved' for ongoing safety concerns like 'vehicle unlocked' or 'door open'.",
                  )}
                </HelperText>
                {showRecommendBanner && (
                  <AlertBanner
                    variant="info"
                    className="mt-2"
                    role="status"
                    data-testid="alert-behavior-recommend-banner"
                  >
                    <span>
                      {t(
                        'notifications.alertStudio.editor.alertBehavior.recommendBanner',
                        'Recommended for "{{op}}" comparisons: {{recommended}}.',
                        { op: editor.op, recommended: recommendedLabel },
                      )}
                    </span>{' '}
                    <span>
                      {t(
                        'notifications.alertStudio.editor.alertBehavior.recommendBannerAlt',
                        '{{alternative}} is also valid — pick whatever fits.',
                        { alternative: alternativeLabel },
                      )}
                    </span>
                  </AlertBanner>
                )}
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
                    component_name: editor.kind === 'system_component' ? editor.component_name : null,
                    place_id: editor.kind === 'place' ? parseOptionalNumber(editor.place_id) : null,
                    transition: editor.kind === 'system_component' || editor.kind === 'place' ? editor.transition : null,
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
              <UiSelect
                id="alert-rule-channel-routing"
                label={t('alertPacks.ruleChannels', 'Rule delivery channels')}
                value={ruleChannelIds === null ? 'inherit' : ruleChannelIds.length === 0 ? 'none' : 'custom'}
                onChange={event => setEditor(current => ({
                  ...current,
                  channel_ids: event.target.value === 'inherit' ? null
                    : event.target.value === 'none' ? [] : allChannelIds,
                }))}
                options={[
                  { value: 'inherit', label: t('alertPacks.inheritChannels', 'All enabled channels') },
                  { value: 'none', label: t('alertPacks.noExternal', 'No external channels') },
                  { value: 'custom', label: t('notifications.alertStudio.channels.selectChannels', 'Selected channels') },
                ]}
              />
              {ruleChannelIds !== null && ruleChannelIds.length > 0 && channelsList.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {channelsList.map(channel => (
                    <UiButton
                      key={channel.id}
                      variant="ghost"
                      size="sm"
                      aria-pressed={ruleChannelIds.includes(channel.id)}
                      onClick={() => setEditor(current => {
                        const selected = Array.isArray(current.channel_ids) ? current.channel_ids : []
                        return {
                          ...current,
                          channel_ids: selected.includes(channel.id)
                            ? selected.filter(id => id !== channel.id)
                            : [...selected, channel.id],
                        }
                      })}
                    >
                      {channel.name}
                    </UiButton>
                  ))}
                </div>
              )}
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
                  : rule
                    ? t('notifications.alertStudio.actions.updateRule', 'Update Rule')
                    : t('notifications.alertStudio.actions.createRule', 'Create Rule')}
              </UiButton>

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

              {rule
                ? <UiButton variant="ghost" size="sm" onClick={() => guardSwitch(() => onCancel?.())} className="ml-auto">
                    {t('common.cancel', 'Cancel')}
                  </UiButton>
                : <UiButton variant="ghost" size="sm" onClick={handleNewRule} className="ml-auto">
                    {t('notifications.alertStudio.actions.reset', 'Reset')}
                  </UiButton>}
            </div>
          </GlassPanel>
      </div>

      {discardDialogProps && <ConfirmDialog {...discardDialogProps} />}
    </>
  )

  if (rule) return content
  return (
    <PageContainer
      title={pageTitle}
      subtitle={pageSubtitle}
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
    >{content}</PageContainer>
  )
}
