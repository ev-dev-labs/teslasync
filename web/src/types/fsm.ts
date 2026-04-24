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

export interface ActiveSubFSM {
  type: 'drive' | 'charge';
  state: string;
  start_time: string;
  drive_id?: number;
  session_id?: number;
}

export interface FSMStats {
  enabled: boolean;
  stats: Record<string, number>;
  active_subs?: ActiveSubFSM[];
}

export interface FSMTransitionResponse {
  data: FSMTransition[];
  total: number;
  page: number;
  per_page: number;
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
  | 'telemetry_connection';

export const FSM_TYPE_OPTIONS: { value: FSMType; label: string }[] = [
  { value: 'all', label: 'All FSMs' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'drive_session', label: 'Drive Sessions' },
  { value: 'charge_session', label: 'Charge Sessions' },
  { value: 'command', label: 'Commands' },
  { value: 'notification', label: 'Notifications' },
  { value: 'automation', label: 'Automations' },
  { value: 'telemetry_connection', label: 'Telemetry Connection' },
];

export const HOURS_OPTIONS = [
  { value: '1', label: 'Last 1 hour' },
  { value: '6', label: 'Last 6 hours' },
  { value: '24', label: 'Last 24 hours' },
  { value: '168', label: 'Last 7 days' },
  { value: '720', label: 'Last 30 days' },
  { value: '2160', label: 'Last 90 days' },
  { value: '0', label: 'All time' },
];

/* ════════════════════════════════════════════════════════════
 *  SINGLE SOURCE OF TRUTH — FSM state definitions
 *
 *  Every FSM type defines its states, colors, and edges HERE.
 *  Add a new state → type, badge, colors, diagram edges all
 *  follow automatically.  No other file needs to change.
 * ════════════════════════════════════════════════════════════ */

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

export interface StateStyle {
  bg: string;
  text: string;
  dot: string;
}

export interface StateDefinition extends StateStyle {
  variant: BadgeVariant;
  badgeDot: string;
}

export interface FSMDefinition {
  states: Record<string, StateDefinition>;
  edges: [string, string][];
}

const DEFAULT_STATE: StateDefinition = {
  variant: 'neutral', badgeDot: 'bg-gray-400',
  bg: 'bg-gray-500/10', text: 'text-gray-400', dot: 'bg-gray-400',
};

export const FSM_REGISTRY: Record<string, FSMDefinition> = {
  vehicle: {
    states: {
      online:   { variant: 'success', badgeDot: 'bg-green-500',   bg: 'bg-blue-500/10',   text: 'text-blue-400',   dot: 'bg-blue-400' },
      driving:  { variant: 'success', badgeDot: 'bg-blue-500',    bg: 'bg-green-500/10',  text: 'text-green-400',  dot: 'bg-green-400' },
      charging: { variant: 'warning', badgeDot: 'bg-yellow-400',  bg: 'bg-cyan-500/10',   text: 'text-cyan-400',   dot: 'bg-cyan-400' },
      parked:   { variant: 'info',    badgeDot: 'bg-cyan-500',    bg: 'bg-purple-500/10', text: 'text-purple-400', dot: 'bg-purple-400' },
      updating: { variant: 'info',    badgeDot: 'bg-indigo-500',  bg: 'bg-indigo-500/10', text: 'text-indigo-400', dot: 'bg-indigo-400' },
      asleep:   { variant: 'neutral', badgeDot: 'bg-purple-500',  bg: 'bg-gray-500/10',   text: 'text-gray-400',   dot: 'bg-gray-400' },
      offline:  { variant: 'danger',  badgeDot: 'bg-red-500',     bg: 'bg-gray-600/10',   text: 'text-gray-500',   dot: 'bg-gray-500' },
    },
    edges: [
      ['online', 'driving'], ['online', 'charging'], ['online', 'parked'],
      ['driving', 'parked'], ['driving', 'charging'], ['driving', 'online'],
      ['charging', 'parked'], ['charging', 'online'], ['charging', 'driving'],
      ['parked', 'driving'], ['parked', 'charging'], ['parked', 'asleep'], ['parked', 'online'],
      ['asleep', 'online'], ['asleep', 'offline'],
      ['offline', 'online'],
    ],
  },
  drive_session: {
    states: {
      pending:   { variant: 'warning', badgeDot: 'bg-amber-400',  bg: 'bg-amber-500/10',  text: 'text-amber-400',  dot: 'bg-amber-400' },
      active:    { variant: 'success', badgeDot: 'bg-green-400',  bg: 'bg-green-500/10',  text: 'text-green-400',  dot: 'bg-green-400' },
      ending:    { variant: 'warning', badgeDot: 'bg-orange-400', bg: 'bg-orange-500/10', text: 'text-orange-400', dot: 'bg-orange-400' },
      completed: { variant: 'info',    badgeDot: 'bg-indigo-400', bg: 'bg-indigo-500/10', text: 'text-indigo-400', dot: 'bg-indigo-400' },
      recovered: { variant: 'neutral', badgeDot: 'bg-purple-400', bg: 'bg-purple-500/10', text: 'text-purple-400', dot: 'bg-purple-400' },
    },
    edges: [
      ['pending', 'active'], ['active', 'ending'], ['ending', 'completed'],
      ['pending', 'recovered'], ['active', 'recovered'], ['recovered', 'active'],
    ],
  },
  charge_session: {
    states: {
      pending:    { variant: 'warning', badgeDot: 'bg-amber-400', bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-400' },
      active:     { variant: 'success', badgeDot: 'bg-cyan-400',  bg: 'bg-cyan-500/10',  text: 'text-cyan-400',  dot: 'bg-cyan-400' },
      completing: { variant: 'info',    badgeDot: 'bg-blue-400',  bg: 'bg-blue-500/10',  text: 'text-blue-400',  dot: 'bg-blue-400' },
      done:       { variant: 'success', badgeDot: 'bg-green-400', bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-400' },
      recovered:  { variant: 'neutral', badgeDot: 'bg-purple-400',bg: 'bg-purple-500/10',text: 'text-purple-400',dot: 'bg-purple-400' },
    },
    edges: [
      ['pending', 'active'], ['active', 'completing'], ['completing', 'done'],
      ['pending', 'recovered'], ['active', 'recovered'], ['recovered', 'active'],
      ['active', 'done'],
    ],
  },
  command: {
    states: {
      queued:         { variant: 'neutral', badgeDot: 'bg-gray-400',   bg: 'bg-gray-500/10',   text: 'text-gray-400',   dot: 'bg-gray-400' },
      waking:         { variant: 'warning', badgeDot: 'bg-amber-400',  bg: 'bg-amber-500/10',  text: 'text-amber-400',  dot: 'bg-amber-400' },
      wake_confirmed: { variant: 'info',    badgeDot: 'bg-blue-400',   bg: 'bg-blue-500/10',   text: 'text-blue-400',   dot: 'bg-blue-400' },
      wake_timeout:   { variant: 'warning', badgeDot: 'bg-orange-400', bg: 'bg-orange-500/10', text: 'text-orange-400', dot: 'bg-orange-400' },
      sending:        { variant: 'info',    badgeDot: 'bg-blue-400',   bg: 'bg-blue-500/10',   text: 'text-blue-400',   dot: 'bg-blue-400' },
      succeeded:      { variant: 'success', badgeDot: 'bg-green-400',  bg: 'bg-green-500/10',  text: 'text-green-400',  dot: 'bg-green-400' },
      failed:         { variant: 'danger',  badgeDot: 'bg-red-400',    bg: 'bg-red-500/10',    text: 'text-red-400',    dot: 'bg-red-400' },
      timed_out:      { variant: 'warning', badgeDot: 'bg-orange-400', bg: 'bg-orange-500/10', text: 'text-orange-400', dot: 'bg-orange-400' },
      retrying:       { variant: 'neutral', badgeDot: 'bg-purple-400', bg: 'bg-purple-500/10', text: 'text-purple-400', dot: 'bg-purple-400' },
      gave_up:        { variant: 'danger',  badgeDot: 'bg-red-500',    bg: 'bg-red-600/10',    text: 'text-red-500',    dot: 'bg-red-500' },
    },
    edges: [
      ['queued', 'waking'], ['waking', 'wake_confirmed'], ['waking', 'wake_timeout'],
      ['wake_confirmed', 'sending'], ['wake_timeout', 'retrying'],
      ['sending', 'succeeded'], ['sending', 'failed'], ['sending', 'timed_out'],
      ['failed', 'retrying'], ['timed_out', 'retrying'],
      ['retrying', 'waking'], ['retrying', 'gave_up'],
    ],
  },
  notification: {
    states: {
      created:   { variant: 'neutral', badgeDot: 'bg-gray-400',   bg: 'bg-gray-500/10',  text: 'text-gray-400',  dot: 'bg-gray-400' },
      sending:   { variant: 'info',    badgeDot: 'bg-blue-400',   bg: 'bg-blue-500/10',  text: 'text-blue-400',  dot: 'bg-blue-400' },
      delivered: { variant: 'success', badgeDot: 'bg-green-400',  bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-400' },
      partial:   { variant: 'warning', badgeDot: 'bg-amber-400',  bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-400' },
      failed:    { variant: 'danger',  badgeDot: 'bg-red-400',    bg: 'bg-red-500/10',   text: 'text-red-400',   dot: 'bg-red-400' },
      retrying:  { variant: 'neutral', badgeDot: 'bg-purple-400', bg: 'bg-purple-500/10',text: 'text-purple-400',dot: 'bg-purple-400' },
      dead:      { variant: 'danger',  badgeDot: 'bg-red-500',    bg: 'bg-red-600/10',   text: 'text-red-500',   dot: 'bg-red-500' },
    },
    edges: [
      ['created', 'sending'], ['sending', 'delivered'], ['sending', 'partial'],
      ['sending', 'failed'], ['failed', 'retrying'], ['retrying', 'sending'],
      ['retrying', 'dead'],
    ],
  },
  alert_cooldown: {
    states: {
      armed:      { variant: 'success', badgeDot: 'bg-green-400', bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-400' },
      fired:      { variant: 'danger',  badgeDot: 'bg-red-400',   bg: 'bg-red-500/10',   text: 'text-red-400',   dot: 'bg-red-400' },
      suppressed: { variant: 'warning', badgeDot: 'bg-amber-400', bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-400' },
    },
    edges: [
      ['armed', 'fired'], ['armed', 'suppressed'], ['fired', 'armed'], ['suppressed', 'armed'],
    ],
  },
  automation: {
    states: {
      idle:       { variant: 'neutral', badgeDot: 'bg-gray-400',   bg: 'bg-gray-500/10',   text: 'text-white/50',   dot: 'bg-gray-400' },
      evaluating: { variant: 'info',    badgeDot: 'bg-cyan-400',   bg: 'bg-cyan-500/10',   text: 'text-cyan-400',   dot: 'bg-cyan-400' },
      executing:  { variant: 'warning', badgeDot: 'bg-amber-400',  bg: 'bg-amber-500/10',  text: 'text-amber-400',  dot: 'bg-amber-400' },
      succeeded:  { variant: 'success', badgeDot: 'bg-green-400',  bg: 'bg-green-500/10',  text: 'text-green-400',  dot: 'bg-green-400' },
      partial:    { variant: 'warning', badgeDot: 'bg-amber-400',  bg: 'bg-amber-500/10',  text: 'text-amber-400',  dot: 'bg-amber-400' },
      failed:     { variant: 'danger',  badgeDot: 'bg-red-400',    bg: 'bg-red-500/10',    text: 'text-red-400',    dot: 'bg-red-400' },
      retrying:   { variant: 'warning', badgeDot: 'bg-amber-400',  bg: 'bg-amber-500/10',  text: 'text-amber-400',  dot: 'bg-amber-400' },
      gave_up:    { variant: 'danger',  badgeDot: 'bg-red-500',    bg: 'bg-red-600/10',    text: 'text-red-500',    dot: 'bg-red-500' },
      skipped:    { variant: 'neutral', badgeDot: 'bg-gray-500',   bg: 'bg-gray-600/10',   text: 'text-white/30',   dot: 'bg-gray-500' },
      cooldown:   { variant: 'neutral', badgeDot: 'bg-purple-400', bg: 'bg-purple-500/10', text: 'text-purple-400', dot: 'bg-purple-400' },
      disabled:   { variant: 'danger',  badgeDot: 'bg-red-400/50', bg: 'bg-red-500/5',     text: 'text-red-400/50', dot: 'bg-red-400/50' },
    },
    edges: [
      ['idle', 'evaluating'],
      ['evaluating', 'executing'], ['evaluating', 'skipped'],
      ['executing', 'succeeded'], ['executing', 'partial'], ['executing', 'failed'],
      ['failed', 'retrying'],
      ['retrying', 'executing'], ['retrying', 'gave_up'],
      ['succeeded', 'cooldown'], ['succeeded', 'idle'],
      ['partial', 'cooldown'], ['partial', 'idle'],
      ['gave_up', 'idle'], ['gave_up', 'disabled'],
      ['skipped', 'idle'],
      ['cooldown', 'idle'],
      ['disabled', 'idle'],
    ],
  },
  telemetry_connection: {
    states: {
      unknown:      { variant: 'neutral', badgeDot: 'bg-gray-400',  bg: 'bg-gray-500/10',  text: 'text-gray-400',  dot: 'bg-gray-400' },
      connecting:   { variant: 'warning', badgeDot: 'bg-amber-400', bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-400' },
      streaming:    { variant: 'success', badgeDot: 'bg-green-400', bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-400' },
      stale:        { variant: 'warning', badgeDot: 'bg-amber-400', bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-400' },
      disconnected: { variant: 'danger',  badgeDot: 'bg-red-400',   bg: 'bg-red-500/10',   text: 'text-red-400',   dot: 'bg-red-400' },
      polling_only: { variant: 'info',    badgeDot: 'bg-blue-400',  bg: 'bg-blue-500/10',  text: 'text-blue-400',  dot: 'bg-blue-400' },
    },
    edges: [
      ['unknown', 'connecting'], ['unknown', 'polling_only'],
      ['connecting', 'streaming'], ['connecting', 'stale'], ['connecting', 'disconnected'],
      ['streaming', 'stale'], ['streaming', 'disconnected'],
      ['stale', 'streaming'], ['stale', 'disconnected'],
      ['disconnected', 'streaming'],
      ['polling_only', 'streaming'],
    ],
  },
};

/* ── Derived accessors (all read from FSM_REGISTRY) ────── */

/** State name arrays per FSM type */
export const FSM_STATES: Record<string, string[]> = Object.fromEntries(
  Object.entries(FSM_REGISTRY).map(([k, v]) => [k, Object.keys(v.states)]),
);

/** Transition edges per FSM type */
export const FSM_EDGES: Record<string, [string, string][]> = Object.fromEntries(
  Object.entries(FSM_REGISTRY).map(([k, v]) => [k, v.edges]),
);

/** Color map per FSM type (bg/text/dot only — for FSM diagram panels) */
export const STATE_COLORS: Record<string, Record<string, StateStyle>> = Object.fromEntries(
  Object.entries(FSM_REGISTRY).map(([fsmType, def]) => [
    fsmType,
    Object.fromEntries(
      Object.entries(def.states).map(([state, s]) => [state, { bg: s.bg, text: s.text, dot: s.dot }]),
    ),
  ]),
);

/** Resolve state style for a given FSM type + state name */
export function getStateColor(fsmType: string, state: string): StateStyle {
  const def = FSM_REGISTRY[fsmType] ?? FSM_REGISTRY.vehicle;
  return def?.states[state.toLowerCase()] ?? DEFAULT_STATE;
}

/** Get the full StateDefinition (includes badge variant + dot) */
export function getStateDefinition(fsmType: string, state: string): StateDefinition {
  const def = FSM_REGISTRY[fsmType] ?? FSM_REGISTRY.vehicle;
  return def?.states[state.toLowerCase()] ?? DEFAULT_STATE;
}
