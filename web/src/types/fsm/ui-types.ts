/** API-layer interfaces for FSM debugger/system pages — NOT FSM definitions */

export interface FSMTransition {
  id: number
  vehicle_id: number
  fsm_type: string
  fsm_instance_id?: number | null
  from_state: string
  to_state: string
  trigger: string
  guard: string
  mode: string
  context_snapshot?: Record<string, unknown> | null
  duration_in_state_ms: number
  created_at: string
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
  | 'drive_session'
  | 'charge_session'
  | 'command'
  | 'notification'
  | 'alert_cooldown'
  | 'automation'
  | 'telemetry_connection'

export const FSM_TYPE_OPTIONS: { value: FSMType; label: string }[] = [
  { value: 'all', label: 'All FSMs' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'drive_session', label: 'Drive Sessions' },
  { value: 'charge_session', label: 'Charge Sessions' },
  { value: 'command', label: 'Commands' },
  { value: 'notification', label: 'Notifications' },
  { value: 'alert_cooldown', label: 'Alert Cooldown' },
  { value: 'automation', label: 'Automations' },
  { value: 'telemetry_connection', label: 'Telemetry Connection' },
]

export const HOURS_OPTIONS = [
  { value: '1', label: 'Last 1 hour' },
  { value: '6', label: 'Last 6 hours' },
  { value: '24', label: 'Last 24 hours' },
  { value: '168', label: 'Last 7 days' },
  { value: '720', label: 'Last 30 days' },
  { value: '2160', label: 'Last 90 days' },
  { value: '0', label: 'All time' },
]
