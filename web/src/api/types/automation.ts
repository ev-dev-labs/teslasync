// AUTO-SPLIT from web/src/api/types.ts (P2 #3).
// See @/api/types barrel for the public re-export surface.

import type {
  Automation as AutomationModel,
  AutomationActionInput,
  AutomationConditionInput,
  AutomationTriggerInput,
} from '@/types/automations'


// === Automation Types ===

export interface AutomationConflict {
  automation_id: number
  automation_name: string
  reason: string
  severity: 'warning' | 'info'
}

type RemovedAutomationTriggerTypeKey = `trigger_${'type'}`
type RemovedAutomationTriggerConfigKey = `trigger_${'config'}`
type RemovedAutomationRootCompatibilityKey =
  | RemovedAutomationTriggerTypeKey
  | RemovedAutomationTriggerConfigKey
  | 'conditions'
  | 'actions'

type RemovedAutomationRootCompatibility = {
  [K in RemovedAutomationRootCompatibilityKey]: never
}

export type Automation = AutomationModel & {
  stop_on_failure: boolean
  notify_on_run: boolean
  notify_on_failure: boolean
  seasonal_start: number | null
  seasonal_end: number | null
  last_triggered_at: string | null
  last_success_at: string | null
  last_failure_at: string | null
  execution_count: number
  failure_count: number
  consecutive_failures: number
  auto_disabled: boolean
  auto_disabled_reason: string | null
  preset_id: string | null
  next_fire_time?: string | null
  conflicts?: AutomationConflict[]
} & RemovedAutomationRootCompatibility

// === Automation Preset Types ===

export interface AutomationPresetCategory {
  id: string
  name: string
  description: string
  icon: string
}

export interface AutomationPreset {
  id: string
  name: string
  description: string
  category: string
  icon: string
  triggers: AutomationTriggerInput[]
  conditions?: AutomationConditionInput[]
  actions: AutomationActionInput[]
  stop_on_failure: boolean
  notify_on_run: boolean
  notify_on_failure: boolean
}

export interface AutomationPresetsResponse {
  categories: AutomationPresetCategory[]
  presets: AutomationPreset[]
}

export type AutomationHistoryStatus = 'running' | 'success' | 'partial' | 'failed' | 'skipped' | 'cancelled' | 'test' | 'undo'

export interface AutomationHistory {
  id: number
  automation_id: number
  automation_name: string
  vehicle_id: number | null
  triggered_at: string
  completed_at: string | null
  duration_ms: number | null
  trigger_type: string
  trigger_snapshot: Record<string, unknown> | null
  conditions_met: boolean
  conditions_snapshot: Record<string, unknown>[] | null
  actions_executed: Record<string, unknown>[] | null
  actions_total: number
  actions_succeeded: number
  actions_failed: number
  status: AutomationHistoryStatus
  error: string | null
  fsm_state: string | null
  created_at: string
}

export interface AutomationHistoryStats {
  total_executions: number
  succeeded: number
  failed: number
  partial: number
  success_rate: number
  avg_duration_ms: number
}

/** Per-signal history response from /signals/{vehicleID}/{signalName}/history */
// SignalHistoryResp matches the typed `/api/v1/signals/{vid}/{name}/history`
// response added by Phase-42 (signal_handler.go). Each row carries the
// row's source-of-truth `value_kind` discriminator and the typed value
// in a single `value` field — UI code should call
// `adaptSignalHistoryRow` to project it into the legacy
// `SignalLogEntry` shape consumed by SignalHistoryTable, the chart,
// and stats panels.
export interface SignalHistoryResp {
  vehicle_id: number
  signal: string
  /** Expected ValueKind for the signal (per protomodel registry). */
  expected_kind?: string
  from?: string
  to?: string
  count: number
  data: SignalHistoryPoint[]
}

export interface SignalHistoryPoint {
  ts: string
  /** Row's source-of-truth ValueKind (e.g. "ValueKindDouble"). */
  kind: string
  value: number | string | boolean | null
}

export interface AutomationHistoryListResponse {
  items: AutomationHistory[]
  total: number
  limit: number
  offset: number
  summary: AutomationHistoryStats
}

// === Automation SSE Events ===

export type AutomationSSEEventType =
  | 'automation.triggered'
  | 'automation.succeeded'
  | 'automation.failed'
  | 'automation.skipped'
  | 'automation.state_changed'

export interface AutomationTriggeredEvent {
  automation_id: number
  name: string
  vehicle: string
  trigger: string
  at: string
  mode: 'live' | 'test'
}

export interface AutomationSucceededEvent {
  automation_id: number
  name: string
  duration_ms: number
  actions: number
  mode: 'live' | 'test'
}

export interface AutomationFailedEvent {
  automation_id: number
  name: string
  error: string
  action_index: number
  mode: 'live' | 'test'
}

export interface AutomationSkippedEvent {
  automation_id: number
  name: string
  reason: string
  mode: 'live' | 'test'
}

export interface AutomationStateChangedEvent {
  automation_id: number
  name: string
  from: string
  to: string
  trigger: string
  at: string
  retry_count: number
  consecutive_failures: number
  mode: 'live' | 'test'
}

export type AutomationSSEEvent =
  | { type: 'automation.triggered'; data: AutomationTriggeredEvent }
  | { type: 'automation.succeeded'; data: AutomationSucceededEvent }
  | { type: 'automation.failed'; data: AutomationFailedEvent }
  | { type: 'automation.skipped'; data: AutomationSkippedEvent }
  | { type: 'automation.state_changed'; data: AutomationStateChangedEvent }
