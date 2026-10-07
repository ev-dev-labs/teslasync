import type { AlertRule, AlertRuleInput, AlertRuleTriggerMode, AlertRuleKind, AlertRuleTransition, ComputedMetricOp } from '@/api/types'
import type { VehicleSelection } from '@/components/forms'
import type { SignalValueType } from '@/types/signals'

// 'unset' guards persisted drafts; fresh rules start with notify on event.
export type TriggerModeOrUnset = AlertRuleTriggerMode | 'unset'
export type Severity = NonNullable<AlertRuleInput['severity']>
export type RuleOp = NonNullable<AlertRuleInput['op']>
export type ValueKind = 'none' | 'number' | 'text' | 'bool' | 'range'

export interface SignalDefinition {
  name: string
  category: string
  value_type: SignalValueType
}

export interface AlertRuleEditorProps {
  /** null creates a rule; an existing rule opens the same form for full editing. */
  rule: AlertRule | null
  onSaved?: (rule: AlertRule) => void
  onCancel?: () => void
}

export interface EditorState {
  id?: number
  channel_ids: number[] | null
  name: string
  enabled: boolean
  /** Sticky-all includes future fleet members; specific IDs never auto-grow. */
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
  trigger_mode: TriggerModeOrUnset
  /** Blank means unlimited (NULL on the wire); inputs retain their draft strings. */
  max_fires_per_resolution: string
  /** Repeat-only pair: both fields must be populated with a higher severity. */
  escalation_enabled: boolean
  escalation_after_min: string
  escalation_severity: Severity | ''
  message: string
  /** Blank uses the backend's op-aware default body. */
  msg_template: string
  include_title: boolean
  kind: AlertRuleKind
  component_name: string
  place_id: string
  transition: AlertRuleTransition
  metric_id: string
  metric_window: string
  metric_op: ComputedMetricOp
  metric_threshold: string
}
