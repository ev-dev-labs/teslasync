import type { AlertRule } from '@/api/types'
import { hydrateVehicleSelection } from '@/components/forms'
import type { RuleTemplate } from '../../lib/alertRuleTemplates'
import { DEFAULT_ALERT_COOLDOWN_S } from '../../lib/alertDelivery'
import { inferTemplateValueKind, isRangeOp } from './signalCatalog'
import { valueToInput } from './inputValues'
import type { EditorState, ValueKind } from './types'

export function freshEditor(): EditorState {
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

export function isEditorDraft(value: unknown): value is EditorState {
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

export function ruleToEditor(rule: AlertRule): EditorState {
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

export function templateToEditor(template: RuleTemplate, name: string, message: string): EditorState {
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
    // Retain the legacy test fallback alongside the body template.
    msg_template: message,
    include_title: false,
  }
}
