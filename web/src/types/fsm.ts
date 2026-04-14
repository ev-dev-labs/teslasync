export interface FSMTransition {
  id: number;
  vehicle_id: number;
  fsm_type: string;
  fsm_instance_id?: number | null;
  from_state: string;
  to_state: string;
  trigger: string;
  guard: string;
  mode: string;
  context_snapshot?: Record<string, unknown> | null;
  duration_in_state_ms: number;
  created_at: string;
}

export interface FSMStats {
  enabled: boolean;
  stats: Record<string, number>;
}

export interface FSMTransitionResponse {
  data: FSMTransition[];
  total: number;
  page: number;
  per_page: number;
}

export type FSMType =
  | 'all'
  | 'vehicle_state'
  | 'vehicle'
  | 'drive_session'
  | 'charge_session'
  | 'command'
  | 'notification'
  | 'alert_cooldown';

export const FSM_TYPE_OPTIONS: { value: FSMType; label: string }[] = [
  { value: 'all', label: 'All FSMs' },
  { value: 'vehicle_state', label: 'Vehicle State' },
  { value: 'drive_session', label: 'Drive Sessions' },
  { value: 'charge_session', label: 'Charge Sessions' },
  { value: 'command', label: 'Commands' },
  { value: 'notification', label: 'Notifications' },
];

export const HOURS_OPTIONS = [
  { value: '1', label: 'Last 1 hour' },
  { value: '6', label: 'Last 6 hours' },
  { value: '24', label: 'Last 24 hours' },
  { value: '168', label: 'Last 7 days' },
];

/** Known states per FSM type, in typical lifecycle order */
export const FSM_STATES: Record<string, string[]> = {
  vehicle_state: ['online', 'driving', 'charging', 'parked', 'asleep', 'offline'],
  vehicle: ['online', 'driving', 'charging', 'parked', 'asleep', 'offline'],
  drive_session: ['pending', 'active', 'ending', 'completed', 'recovered'],
  charge_session: ['pending', 'active', 'completing', 'done', 'recovered'],
  command: ['queued', 'waking', 'wake_confirmed', 'wake_timeout', 'sending', 'succeeded', 'failed', 'timed_out', 'retrying', 'gave_up'],
  notification: ['created', 'sending', 'delivered', 'partial', 'failed', 'retrying', 'dead'],
  alert_cooldown: ['armed', 'fired', 'suppressed'],
};

/** Typical transition edges per FSM type: [from, to][] */
export const FSM_EDGES: Record<string, [string, string][]> = {
  vehicle_state: [
    ['online', 'driving'], ['online', 'charging'], ['online', 'parked'],
    ['driving', 'parked'], ['driving', 'charging'], ['driving', 'online'],
    ['charging', 'parked'], ['charging', 'online'], ['charging', 'driving'],
    ['parked', 'driving'], ['parked', 'charging'], ['parked', 'asleep'], ['parked', 'online'],
    ['asleep', 'online'], ['asleep', 'offline'],
    ['offline', 'online'],
  ],
  vehicle: [
    ['online', 'driving'], ['online', 'charging'], ['online', 'parked'],
    ['driving', 'parked'], ['driving', 'charging'], ['driving', 'online'],
    ['charging', 'parked'], ['charging', 'online'], ['charging', 'driving'],
    ['parked', 'driving'], ['parked', 'charging'], ['parked', 'asleep'], ['parked', 'online'],
    ['asleep', 'online'], ['asleep', 'offline'],
    ['offline', 'online'],
  ],
  drive_session: [
    ['pending', 'active'], ['active', 'ending'], ['ending', 'completed'],
    ['pending', 'recovered'], ['active', 'recovered'], ['recovered', 'active'],
  ],
  charge_session: [
    ['pending', 'active'], ['active', 'completing'], ['completing', 'done'],
    ['pending', 'recovered'], ['active', 'recovered'], ['recovered', 'active'],
    ['active', 'done'],
  ],
  command: [
    ['queued', 'waking'], ['waking', 'wake_confirmed'], ['waking', 'wake_timeout'],
    ['wake_confirmed', 'sending'], ['wake_timeout', 'retrying'],
    ['sending', 'succeeded'], ['sending', 'failed'], ['sending', 'timed_out'],
    ['failed', 'retrying'], ['timed_out', 'retrying'],
    ['retrying', 'waking'], ['retrying', 'gave_up'],
  ],
  notification: [
    ['created', 'sending'], ['sending', 'delivered'], ['sending', 'partial'],
    ['sending', 'failed'], ['failed', 'retrying'], ['retrying', 'sending'],
    ['retrying', 'dead'],
  ],
  alert_cooldown: [
    ['armed', 'fired'], ['armed', 'suppressed'], ['fired', 'armed'], ['suppressed', 'armed'],
  ],
};

/** Per-FSM-type state color maps (Tailwind classes) */
export const STATE_COLORS: Record<string, Record<string, { bg: string; text: string; dot: string }>> = {
  vehicle_state: {
    online:   { bg: 'bg-blue-500/10', text: 'text-blue-400', dot: 'bg-blue-400' },
    driving:  { bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-400' },
    charging: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', dot: 'bg-cyan-400' },
    parked:   { bg: 'bg-purple-500/10', text: 'text-purple-400', dot: 'bg-purple-400' },
    asleep:   { bg: 'bg-gray-500/10', text: 'text-gray-400', dot: 'bg-gray-400' },
    offline:  { bg: 'bg-gray-600/10', text: 'text-gray-500', dot: 'bg-gray-500' },
  },
  drive_session: {
    pending:   { bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-400' },
    active:    { bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-400' },
    ending:    { bg: 'bg-orange-500/10', text: 'text-orange-400', dot: 'bg-orange-400' },
    completed: { bg: 'bg-indigo-500/10', text: 'text-indigo-400', dot: 'bg-indigo-400' },
    recovered: { bg: 'bg-purple-500/10', text: 'text-purple-400', dot: 'bg-purple-400' },
  },
  charge_session: {
    pending:    { bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-400' },
    active:     { bg: 'bg-cyan-500/10', text: 'text-cyan-400', dot: 'bg-cyan-400' },
    completing: { bg: 'bg-blue-500/10', text: 'text-blue-400', dot: 'bg-blue-400' },
    done:       { bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-400' },
    recovered:  { bg: 'bg-purple-500/10', text: 'text-purple-400', dot: 'bg-purple-400' },
  },
  command: {
    queued:         { bg: 'bg-gray-500/10', text: 'text-gray-400', dot: 'bg-gray-400' },
    waking:         { bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-400' },
    wake_confirmed: { bg: 'bg-blue-500/10', text: 'text-blue-400', dot: 'bg-blue-400' },
    wake_timeout:   { bg: 'bg-orange-500/10', text: 'text-orange-400', dot: 'bg-orange-400' },
    sending:        { bg: 'bg-blue-500/10', text: 'text-blue-400', dot: 'bg-blue-400' },
    succeeded:      { bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-400' },
    failed:         { bg: 'bg-red-500/10', text: 'text-red-400', dot: 'bg-red-400' },
    timed_out:      { bg: 'bg-orange-500/10', text: 'text-orange-400', dot: 'bg-orange-400' },
    retrying:       { bg: 'bg-purple-500/10', text: 'text-purple-400', dot: 'bg-purple-400' },
    gave_up:        { bg: 'bg-red-600/10', text: 'text-red-500', dot: 'bg-red-500' },
  },
  notification: {
    created:   { bg: 'bg-gray-500/10', text: 'text-gray-400', dot: 'bg-gray-400' },
    sending:   { bg: 'bg-blue-500/10', text: 'text-blue-400', dot: 'bg-blue-400' },
    delivered: { bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-400' },
    partial:   { bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-400' },
    failed:    { bg: 'bg-red-500/10', text: 'text-red-400', dot: 'bg-red-400' },
    retrying:  { bg: 'bg-purple-500/10', text: 'text-purple-400', dot: 'bg-purple-400' },
    dead:      { bg: 'bg-red-600/10', text: 'text-red-500', dot: 'bg-red-500' },
  },
  alert_cooldown: {
    armed:      { bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-400' },
    fired:      { bg: 'bg-red-500/10', text: 'text-red-400', dot: 'bg-red-400' },
    suppressed: { bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-400' },
  },
};

/** Resolve state colors — vehicle FSM is also used for 'vehicle' type */
export function getStateColor(fsmType: string, state: string) {
  const colors = STATE_COLORS[fsmType] ?? STATE_COLORS.vehicle_state;
  return colors?.[state.toLowerCase()] ?? { bg: 'bg-gray-500/10', text: 'text-gray-400', dot: 'bg-gray-400' };
}
