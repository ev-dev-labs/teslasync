import type { AlertRuleInput, AlertRuleTriggerMode, AlertTestTarget } from '@/api/types'
import { buildVehiclePayload } from '@/components/forms'
import { normalizeMsgTemplateForSave, parseOptionalMaxFires, parseOptionalNumber } from './inputValues'
import { valueKindForState } from './signalCatalog'
import type { EditorState, Severity } from './types'

// Both escalation fields travel together; once-mode and incomplete tiers send NULL.
export function buildEscalationPayload(
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

export function buildSavePayload(state: EditorState): AlertRuleInput {
  const vehiclePayload = buildVehiclePayload(state.vehicle_selection)
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

export function buildTestTarget(selectedIds: number[] | null, allIds: number[]): AlertTestTarget | null {
  if (allIds.length === 0) return null
  if (selectedIds === null) return { all_channels: true }
  return { channel_ids: selectedIds }
}
