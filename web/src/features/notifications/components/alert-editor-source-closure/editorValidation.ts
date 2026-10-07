import type { ComputedMetricSummary } from '@/api/types'
import type { EditorState } from './types'
import { parseOptionalMaxFires, parseOptionalNumber, SEVERITY_RANK } from './inputValues'
import { isOperatorAllowedForState, valueKindForState } from './signalCatalog'

export function hasComputedMetricInputs(state: EditorState, metrics: ComputedMetricSummary[]): boolean {
  if (!state.metric_id || !state.metric_window || !state.metric_op) return false
  if (parseOptionalNumber(state.metric_threshold) == null) return false
  const def = metrics.find(m => m.id === state.metric_id)
  if (!def) return false
  if (!def.windows.includes(state.metric_window)) return false
  if (!def.ops.includes(state.metric_op)) return false
  return true
}

export function hasRequiredTypedValue(state: EditorState): boolean {
  const valueKind = valueKindForState(state)
  if (valueKind === 'none') return state.op === 'changed'
  if (valueKind === 'bool') return true
  if (valueKind === 'text') return state.value_text.trim().length > 0
  if (valueKind === 'number') return parseOptionalNumber(state.value_num) !== null
  const valueMin = parseOptionalNumber(state.value_min)
  const valueMax = parseOptionalNumber(state.value_max)
  return valueMin !== null && valueMax !== null && valueMin <= valueMax
}

export function canSaveEditor(editor: EditorState, computedMetrics: ComputedMetricSummary[], unsupportedKind: boolean): boolean {
  if (unsupportedKind) return false
  if (editor.name.trim().length === 0) return false
  if (editor.cooldown_min <= 0) return false
  if (editor.trigger_mode === 'unset') return false
  if (
    editor.vehicle_selection.kind === 'specific'
    && editor.vehicle_selection.vehicle_ids.length === 0
  ) {
    return false
  }
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
    // Preserve optimistic save while the registry loads; the server validates.
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
}
