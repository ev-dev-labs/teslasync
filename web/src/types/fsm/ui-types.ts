/** API-layer interfaces for FSM debugger/system pages — NOT FSM definitions */

export interface FSMTransition {
  id: number
  vehicle_id: number
  ts: string
  fsm_name: string
  from_state: string
  to_state: string
  trigger: string
  details?: Record<string, unknown> | null
}

export interface ActiveSubFSM {
  type: 'drive' | 'charge'
  state: string
  start_time: string
  drive_id?: number
  session_id?: number
}

export interface FSMStats {
  enabled: boolean
  stats: Record<string, number>
  active_subs?: ActiveSubFSM[]
}

export interface FSMTransitionResponse {
  data: FSMTransition[]
  total: number
  page: number
  per_page: number
}

export type FSMType =
  | 'all'
  | 'vehicle'
  | 'telemetry_connection'

/**
 * A `<Select>` option for the debugger's filter controls.
 *
 * `label` is the English fallback rendered when `i18nKey` is absent from the
 * active translation bundle. This module runs outside React, so consumers MUST
 * localise at the render boundary via `t(option.i18nKey, option.label)` rather
 * than reading `label` directly.
 */
export interface FSMSelectOption<V extends string = string> {
  value: V
  label: string
  i18nKey: string
}

export const FSM_TYPE_OPTIONS: FSMSelectOption<FSMType>[] = [
  { value: 'all', label: 'All FSMs', i18nKey: 'fsm.typeOption.all' },
  { value: 'vehicle', label: 'Vehicle', i18nKey: 'fsm.typeOption.vehicle' },
  { value: 'telemetry_connection', label: 'Telemetry Connection', i18nKey: 'fsm.typeOption.telemetryConnection' },
]

export const HOURS_OPTIONS: FSMSelectOption[] = [
  { value: '1', label: 'Last 1 hour', i18nKey: 'fsm.rangeOption.h1' },
  { value: '6', label: 'Last 6 hours', i18nKey: 'fsm.rangeOption.h6' },
  { value: '24', label: 'Last 24 hours', i18nKey: 'fsm.rangeOption.h24' },
  { value: '168', label: 'Last 7 days', i18nKey: 'fsm.rangeOption.d7' },
  { value: '720', label: 'Last 30 days', i18nKey: 'fsm.rangeOption.d30' },
  { value: '2160', label: 'Last 90 days', i18nKey: 'fsm.rangeOption.d90' },
  { value: '0', label: 'All time', i18nKey: 'fsm.rangeOption.all' },
]

