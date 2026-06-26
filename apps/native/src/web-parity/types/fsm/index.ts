// Native parity port of web/src/types/fsm/index.ts.
//
// The web source is a barrel that re-exports the FSM type-system and state
// machine definitions from 13 sibling modules (./types, ./theme, ./registry,
// ./ui-types, ./vehicle, ./drive-session, ./charge-session, ./command,
// ./notification, ./alert-cooldown, ./automation, ./telemetry-connection,
// ./cross-fsm). Those siblings are NOT part of the native conversion manifest
// (only this index.ts is), so to preserve the barrel's exact public API without
// importing modules that do not exist in the native tree, every re-exported
// symbol is inlined here in dependency order. The content is pure TypeScript
// types + plain data (FSM transition tables, coverage matrices, theme class
// maps) with zero DOM / React / Recharts / Leaflet / browser dependencies, so
// it ports 1:1 (contract rules 3, 4, 6). Tailwind class strings and English
// option labels are preserved verbatim as data — the same values the web app
// ships — since display / i18n happens in the consuming components, not here.

// ─────────────────────────────────────────────────────────────────────────────
// Foundation — from web/src/types/fsm/types.ts
// ─────────────────────────────────────────────────────────────────────────────

/** Semantic badge variants used across the entire app */
export type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

/** Visual style derived from a BadgeVariant — no per-state customization needed */
export interface StateStyle {
  badgeDot: string   // Tailwind class for the badge dot color
  bg: string         // Tailwind class for background (panel/card tint)
  text: string       // Tailwind class for text color
  dot: string        // Tailwind class for status dot in diagrams
}

/** A single state in an FSM: just a variant. Theme resolves the rest. */
export interface StateEntry {
  variant: BadgeVariant
  /** Optional override: only use when a state MUST differ from theme defaults.
   *  Example: vehicle.driving is 'success' but uses blue tint, not green. */
  overrides?: Partial<StateStyle>
}

/** Typed edge tuple — generic so each FSM constrains its own state names */
export type Edge<S extends string> = [from: S, to: S]

/** Full FSM definition — generic over its state union */
export interface FSMDefinition<S extends string = string, T extends string = string> {
  states: Record<S, StateEntry>
  edges: Edge<S>[]
  transitions?: TransitionRow<S, T>[]
  disallowed?: DisallowedTransition<S>[]
  coverage?: CoverageMatrix<S>
  scenarios?: Scenario<S>[]
  toasts?: ToastMap<S>
  truthTable?: TruthTable<S, T>
  labels?: Record<S, string>
}

/** Resolved state style = theme defaults merged with optional overrides */
export type ResolvedStateStyle = StateStyle & { variant: BadgeVariant }

export type TransitionTiming = 'immediate' | 'debounced'

export interface TransitionRow<S extends string = string, T extends string = string> {
  from: S
  to: S
  trigger: T
  guard: string | null
  timing: TransitionTiming
}

export type CoverageCell = 'valid' | 'disallowed' | 'self' | null
export type CoverageMatrix<S extends string> = Record<S, Record<S, CoverageCell>>

export interface DisallowedTransition<S extends string> {
  from: S
  to: S
  reason: string
}

export interface Scenario<S extends string> {
  id: string
  description: string
  transitions: S[]
}

export type ToastMap<S extends string> = Partial<Record<S, string | null>>

export type TruthTableCell<S extends string> =
  | { action: 'transition'; to: S; guard?: string }
  | { action: 'no_op' }
  | { action: 'not_applicable' }
  | { action: 'disallowed'; reason: string }

export type TruthTable<S extends string, T extends string> = Record<S, Record<T, TruthTableCell<S>>>

export function deriveEdges<S extends string, T extends string>(
  transitions: TransitionRow<S, T>[],
): Edge<S>[] {
  const seen = new Set<string>()
  const edges: Edge<S>[] = []
  for (const { from, to } of transitions) {
    const key = `${from}→${to}`
    if (!seen.has(key)) {
      seen.add(key)
      edges.push([from, to])
    }
  }
  return edges
}

export function isValidTransition<S extends string>(
  coverage: CoverageMatrix<S>,
  from: S,
  to: S,
): CoverageCell {
  return coverage[from]?.[to] ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// Theme — from web/src/types/fsm/theme.ts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Single source of truth: BadgeVariant → Tailwind classes.
 * Change a color here → every FSM state with that variant updates.
 */
export const VARIANT_THEME: Record<BadgeVariant, StateStyle> = {
  success: {
    badgeDot: 'bg-green-400',
    bg:       'bg-green-500/10',
    text:     'text-green-400',
    dot:      'bg-green-400',
  },
  warning: {
    badgeDot: 'bg-amber-400',
    bg:       'bg-amber-500/10',
    text:     'text-amber-400',
    dot:      'bg-amber-400',
  },
  danger: {
    badgeDot: 'bg-red-400',
    bg:       'bg-red-500/10',
    text:     'text-red-400',
    dot:      'bg-red-400',
  },
  info: {
    badgeDot: 'bg-blue-400',
    bg:       'bg-blue-500/10',
    text:     'text-blue-400',
    dot:      'bg-blue-400',
  },
  neutral: {
    badgeDot: 'bg-gray-400',
    bg:       'bg-gray-500/10',
    text:     'text-[var(--text-muted)]',
    dot:      'bg-gray-400',
  },
}

/** Resolve a StateEntry to its full visual style (theme + overrides) */
export function resolveStyle(entry: StateEntry): ResolvedStateStyle {
  const base = VARIANT_THEME[entry.variant]
  return {
    variant: entry.variant,
    ...base,
    ...entry.overrides,
  }
}

/** Default style for unknown states */
export const DEFAULT_STATE: ResolvedStateStyle = {
  variant: 'neutral',
  ...VARIANT_THEME.neutral,
}

// ─────────────────────────────────────────────────────────────────────────────
// UI / API types — from web/src/types/fsm/ui-types.ts
// (debugger page, hooks — NOT FSM definitions)
// ─────────────────────────────────────────────────────────────────────────────

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

export const FSM_TYPE_OPTIONS: { value: FSMType; label: string }[] = [
  { value: 'all', label: 'All FSMs' },
  { value: 'vehicle', label: 'Vehicle' },
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

// ─────────────────────────────────────────────────────────────────────────────
// Vehicle FSM — from web/src/types/fsm/vehicle.ts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Vehicle operational states — MUST match Go `internal/enums/constants.go`
 * plus frontend-only 'updating' (from Tesla API, not our FSM).
 */
export const VEHICLE_STATES = [
  'online', 'driving', 'charging', 'parked',
  'updating', 'asleep', 'offline',
] as const

export type VehicleState = (typeof VEHICLE_STATES)[number]

/**
 * Each state maps to a BadgeVariant. Theme resolves all Tailwind classes.
 * Use `overrides` ONLY when a state needs a non-standard color
 * (e.g., driving = success variant but with blue tint for visual distinction).
 */
export const VEHICLE_STATE_ENTRIES: Record<VehicleState, StateEntry> = {
  online:   { variant: 'success' },
  driving:  { variant: 'success', overrides: { badgeDot: 'bg-blue-500', bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-400' } },
  charging: { variant: 'warning', overrides: { badgeDot: 'bg-yellow-400', bg: 'bg-cyan-500/10', text: 'text-cyan-400', dot: 'bg-cyan-400' } },
  parked:   { variant: 'info',    overrides: { badgeDot: 'bg-cyan-500', bg: 'bg-purple-500/10', text: 'text-purple-400', dot: 'bg-purple-400' } },
  updating: { variant: 'info',    overrides: { badgeDot: 'bg-indigo-500', bg: 'bg-indigo-500/10', text: 'text-indigo-400', dot: 'bg-indigo-400' } },
  asleep:   { variant: 'neutral', overrides: { badgeDot: 'bg-purple-500' } },
  offline:  { variant: 'danger',  overrides: { bg: 'bg-gray-600/10', text: 'text-[var(--text-muted)]', dot: 'bg-gray-500' } },
}

/**
 * Display labels for vehicle states.
 * Use with i18n: t(`vehicle.state.${state}`, VEHICLE_STATE_LABELS[state])
 */
export const VEHICLE_STATE_LABELS: Record<VehicleState, string> = {
  online:   'Online',
  driving:  'Driving',
  charging: 'Charging',
  parked:   'Parked',
  updating: 'Updating',
  asleep:   'Asleep',
  offline:  'Offline',
}

/** Vehicle triggers — mirrors Go iota. Reference: §2.3 */
export const VEHICLE_TRIGGERS = [
  'gear_driving', 'gear_parked', 'gear_neutral',
  'speed_detected', 'speed_zero',
  'charge_started', 'charge_ended', 'charge_interrupted',
  'signal_received', 'activity_detected',
  'sleep_timeout', 'heartbeat_lost', 'timeout',
] as const
export type VehicleTrigger = (typeof VEHICLE_TRIGGERS)[number]

/** Vehicle guards — logic in Go, labels for frontend. Reference: §2.4 */
export const VEHICLE_GUARDS = [
  'no_charge', 'is_charging', 'still_plugged_in', 'speed_zero',
  'no_gear', 'gear_parked_seen', 'no_activity',
  'unexpected_loss', 'expected_loss',
] as const
export type VehicleGuard = (typeof VEHICLE_GUARDS)[number]

/** 50-row vehicle transition table — single source of truth. Reference: §2.5 */
export const VEHICLE_TRANSITIONS: TransitionRow<VehicleState, VehicleTrigger>[] = [
  // ═══ ONLINE (9 rows) ═══
  { from: 'online', to: 'driving',  trigger: 'gear_driving',      guard: null,              timing: 'immediate' },
  { from: 'online', to: 'driving',  trigger: 'gear_neutral',      guard: null,              timing: 'immediate' },
  { from: 'online', to: 'driving',  trigger: 'speed_detected',    guard: 'no_gear',         timing: 'immediate' },
  { from: 'online', to: 'charging', trigger: 'charge_started',    guard: null,              timing: 'immediate' },
  { from: 'online', to: 'parked',   trigger: 'gear_parked',       guard: 'no_charge',       timing: 'debounced' },
  { from: 'online', to: 'asleep',   trigger: 'sleep_timeout',     guard: 'no_activity',     timing: 'immediate' },
  { from: 'online', to: 'offline',  trigger: 'heartbeat_lost',    guard: null,              timing: 'immediate' },
  { from: 'online', to: 'asleep',   trigger: 'timeout',           guard: 'expected_loss',   timing: 'immediate' },
  { from: 'online', to: 'offline',  trigger: 'timeout',           guard: 'unexpected_loss', timing: 'immediate' },
  // ═══ DRIVING (6 rows) ═══
  { from: 'driving', to: 'parked',   trigger: 'gear_parked',      guard: 'no_charge',       timing: 'immediate' },
  { from: 'driving', to: 'charging', trigger: 'charge_started',   guard: 'speed_zero',      timing: 'immediate' },
  { from: 'driving', to: 'online',   trigger: 'speed_zero',       guard: 'no_gear',         timing: 'debounced' },
  { from: 'driving', to: 'parked',   trigger: 'speed_zero',       guard: 'gear_parked_seen', timing: 'debounced' },
  { from: 'driving', to: 'offline',  trigger: 'heartbeat_lost',   guard: null,              timing: 'immediate' },
  { from: 'driving', to: 'offline',  trigger: 'timeout',          guard: null,              timing: 'immediate' },
  // ═══ CHARGING (8 rows) ═══
  { from: 'charging', to: 'driving', trigger: 'gear_driving',     guard: null,              timing: 'immediate' },
  { from: 'charging', to: 'driving', trigger: 'gear_neutral',     guard: null,              timing: 'immediate' },
  { from: 'charging', to: 'parked',  trigger: 'charge_ended',     guard: null,              timing: 'immediate' },
  { from: 'charging', to: 'driving', trigger: 'speed_detected',   guard: 'no_gear',         timing: 'immediate' },
  { from: 'charging', to: 'online',  trigger: 'charge_interrupted', guard: null,            timing: 'immediate' },
  { from: 'charging', to: 'asleep',  trigger: 'sleep_timeout',    guard: 'still_plugged_in', timing: 'debounced' },
  { from: 'charging', to: 'offline', trigger: 'heartbeat_lost',   guard: null,              timing: 'immediate' },
  { from: 'charging', to: 'offline', trigger: 'timeout',          guard: null,              timing: 'immediate' },
  // ═══ PARKED (9 rows) ═══
  { from: 'parked', to: 'driving',  trigger: 'gear_driving',      guard: null,              timing: 'immediate' },
  { from: 'parked', to: 'driving',  trigger: 'gear_neutral',      guard: null,              timing: 'immediate' },
  { from: 'parked', to: 'driving',  trigger: 'speed_detected',    guard: 'no_gear',         timing: 'immediate' },
  { from: 'parked', to: 'charging', trigger: 'charge_started',    guard: null,              timing: 'immediate' },
  { from: 'parked', to: 'online',   trigger: 'activity_detected', guard: null,              timing: 'immediate' },
  { from: 'parked', to: 'asleep',   trigger: 'sleep_timeout',     guard: 'no_activity',     timing: 'immediate' },
  { from: 'parked', to: 'offline',  trigger: 'heartbeat_lost',    guard: null,              timing: 'immediate' },
  { from: 'parked', to: 'asleep',   trigger: 'timeout',           guard: 'expected_loss',   timing: 'immediate' },
  { from: 'parked', to: 'offline',  trigger: 'timeout',           guard: 'unexpected_loss', timing: 'immediate' },
  // ═══ ASLEEP (9 rows) ═══
  { from: 'asleep', to: 'online',   trigger: 'signal_received',   guard: null,              timing: 'immediate' },
  { from: 'asleep', to: 'online',   trigger: 'activity_detected', guard: null,              timing: 'immediate' },
  { from: 'asleep', to: 'charging', trigger: 'charge_started',    guard: null,              timing: 'immediate' },
  { from: 'asleep', to: 'driving',  trigger: 'gear_driving',      guard: null,              timing: 'immediate' },
  { from: 'asleep', to: 'driving',  trigger: 'gear_neutral',      guard: null,              timing: 'immediate' },
  { from: 'asleep', to: 'driving',  trigger: 'speed_detected',    guard: 'no_gear',         timing: 'immediate' },
  { from: 'asleep', to: 'parked',   trigger: 'gear_parked',       guard: null,              timing: 'immediate' },
  { from: 'asleep', to: 'offline',  trigger: 'heartbeat_lost',    guard: null,              timing: 'immediate' },
  { from: 'asleep', to: 'offline',  trigger: 'timeout',           guard: null,              timing: 'immediate' },
  // ═══ OFFLINE (9 rows) ═══
  { from: 'offline', to: 'online',   trigger: 'signal_received',  guard: null,              timing: 'immediate' },
  { from: 'offline', to: 'online',   trigger: 'activity_detected', guard: null,             timing: 'immediate' },
  { from: 'offline', to: 'charging', trigger: 'charge_started',   guard: null,              timing: 'immediate' },
  { from: 'offline', to: 'driving',  trigger: 'gear_driving',     guard: null,              timing: 'immediate' },
  { from: 'offline', to: 'driving',  trigger: 'gear_neutral',     guard: null,              timing: 'immediate' },
  { from: 'offline', to: 'driving',  trigger: 'speed_detected',   guard: 'no_gear',         timing: 'immediate' },
  { from: 'offline', to: 'parked',   trigger: 'gear_parked',      guard: null,              timing: 'immediate' },
  { from: 'offline', to: 'asleep',   trigger: 'sleep_timeout',    guard: null,              timing: 'immediate' },
  { from: 'offline', to: 'asleep',   trigger: 'timeout',          guard: null,              timing: 'immediate' },
]

export const VEHICLE_DISALLOWED: DisallowedTransition<VehicleState>[] = [
  { from: 'driving', to: 'asleep', reason: 'Moving vehicle cannot sleep — must Park or go Offline first' },
  { from: 'driving', to: 'updating', reason: 'Cannot start OTA while driving' },
]

export const VEHICLE_DISALLOWED_PATTERNS = [
  'Online → Charging without TriggerChargeStarted — charging must be backed by a real charge signal',
  'X → X self-loops — no-op, suppress at dispatcher to keep transition log clean',
  'Driving → Online via SpeedZero on gear-capable vehicle — would mis-handle red lights (use GuardNoGear)',
] as const

export const VEHICLE_COVERAGE: CoverageMatrix<VehicleState> = {
  online:   { online: 'self', driving: 'valid', charging: 'valid', parked: 'valid', updating: null,   asleep: 'valid', offline: 'valid' },
  driving:  { online: 'valid', driving: 'self', charging: 'valid', parked: 'valid', updating: null,   asleep: 'disallowed', offline: 'valid' },
  charging: { online: 'valid', driving: 'valid', charging: 'self', parked: 'valid', updating: null,   asleep: 'valid', offline: 'valid' },
  parked:   { online: 'valid', driving: 'valid', charging: 'valid', parked: 'self', updating: null,   asleep: 'valid', offline: 'valid' },
  updating: { online: null,    driving: null,    charging: null,    parked: null,    updating: 'self', asleep: null,    offline: null },
  asleep:   { online: 'valid', driving: 'valid', charging: 'valid', parked: 'valid', updating: null,   asleep: 'self', offline: 'valid' },
  offline:  { online: 'valid', driving: 'valid', charging: 'valid', parked: 'valid', updating: null,   asleep: 'valid', offline: 'self' },
}

const T = (to: VehicleState, guard?: string) => ({ action: 'transition' as const, to, guard })
const NOOP = { action: 'no_op' as const }
const NA = { action: 'not_applicable' as const }
const DIS = (reason: string) => ({ action: 'disallowed' as const, reason })

export const VEHICLE_TRUTH_TABLE: TruthTable<VehicleState, VehicleTrigger> = {
  online: {
    gear_driving: T('driving'), gear_parked: T('parked', 'no_charge'), gear_neutral: T('driving'),
    speed_detected: T('driving', 'no_gear'), speed_zero: NOOP,
    charge_started: T('charging'), charge_ended: NA, charge_interrupted: NA,
    signal_received: NOOP, activity_detected: NOOP,
    sleep_timeout: T('asleep', 'no_activity'), heartbeat_lost: T('offline'),
    timeout: T('asleep', 'expected_loss'),
  },
  driving: {
    gear_driving: NOOP, gear_parked: T('parked', 'no_charge'), gear_neutral: NOOP,
    speed_detected: NOOP, speed_zero: T('online', 'no_gear'),
    charge_started: T('charging', 'speed_zero'), charge_ended: NA, charge_interrupted: NA,
    signal_received: NOOP, activity_detected: NOOP,
    sleep_timeout: DIS('Moving vehicle cannot sleep'),
    heartbeat_lost: T('offline'), timeout: T('offline'),
  },
  charging: {
    gear_driving: T('driving'), gear_parked: NOOP, gear_neutral: T('driving'),
    speed_detected: T('driving', 'no_gear'), speed_zero: NOOP,
    charge_started: NOOP, charge_ended: T('parked'), charge_interrupted: T('online'),
    signal_received: NOOP, activity_detected: NOOP,
    sleep_timeout: T('asleep', 'still_plugged_in'),
    heartbeat_lost: T('offline'), timeout: T('offline'),
  },
  parked: {
    gear_driving: T('driving'), gear_parked: NOOP, gear_neutral: T('driving'),
    speed_detected: T('driving', 'no_gear'), speed_zero: NOOP,
    charge_started: T('charging'), charge_ended: NA, charge_interrupted: NA,
    signal_received: NOOP, activity_detected: T('online'),
    sleep_timeout: T('asleep', 'no_activity'),
    heartbeat_lost: T('offline'), timeout: T('asleep', 'expected_loss'),
  },
  asleep: {
    gear_driving: T('driving'), gear_parked: T('parked'), gear_neutral: T('driving'),
    speed_detected: T('driving', 'no_gear'), speed_zero: NOOP,
    charge_started: T('charging'), charge_ended: NA, charge_interrupted: NA,
    signal_received: T('online'), activity_detected: T('online'),
    sleep_timeout: NOOP, heartbeat_lost: T('offline'), timeout: T('offline'),
  },
  offline: {
    gear_driving: T('driving'), gear_parked: T('parked'), gear_neutral: T('driving'),
    speed_detected: T('driving', 'no_gear'), speed_zero: NOOP,
    charge_started: T('charging'), charge_ended: NA, charge_interrupted: NA,
    signal_received: T('online'), activity_detected: T('online'),
    sleep_timeout: T('asleep'), heartbeat_lost: NOOP, timeout: T('asleep'),
  },
  updating: {
    gear_driving: NA, gear_parked: NA, gear_neutral: NA,
    speed_detected: NA, speed_zero: NA,
    charge_started: NA, charge_ended: NA, charge_interrupted: NA,
    signal_received: NA, activity_detected: NA,
    sleep_timeout: NA, heartbeat_lost: NA, timeout: NA,
  },
}

export const VEHICLE_SCENARIOS: Scenario<VehicleState>[] = [
  { id: 'V1',  description: 'Morning: asleep → unlock → drive',                     transitions: ['asleep', 'online', 'driving'] },
  { id: 'V2',  description: 'Arrive at work, park',                                  transitions: ['driving', 'parked'] },
  { id: 'V3',  description: 'Plug into workplace L2',                                transitions: ['parked', 'charging'] },
  { id: 'V4',  description: 'Charge completes mid-day',                              transitions: ['charging', 'parked'] },
  { id: 'V5',  description: 'Drive home',                                             transitions: ['parked', 'driving'] },
  { id: 'V6',  description: 'Park, plug in, walk away',                              transitions: ['driving', 'parked', 'charging'] },
  { id: 'V7',  description: 'Cell-balance dwell overnight',                          transitions: ['charging', 'asleep'] },
  { id: 'V8',  description: 'Charge resumes from dwell',                             transitions: ['asleep', 'charging'] },
  { id: 'V9',  description: 'Quiet park → graceful sleep',                           transitions: ['parked', 'asleep'] },
  { id: 'V10', description: 'Drive into tunnel, signal lost',                        transitions: ['driving', 'offline'] },
  { id: 'V11', description: 'Exit tunnel, still driving',                            transitions: ['offline', 'driving'] },
  { id: 'V12', description: 'Underground garage blackout',                           transitions: ['parked', 'offline'] },
  { id: 'V13', description: 'Garage opens, still parked',                            transitions: ['offline', 'parked'] },
  { id: 'V14', description: 'DC charger network drop',                               transitions: ['charging', 'offline'] },
  { id: 'V15', description: 'Reconnect mid-charge',                                  transitions: ['offline', 'charging'] },
  { id: 'V16', description: 'Long offline → deep sleep',                             transitions: ['offline', 'asleep'] },
  { id: 'V17', description: 'Brief signal blip',                                     transitions: ['online', 'offline', 'online'] },
  { id: 'V18', description: 'Charge fault → awake',                                  transitions: ['charging', 'online'] },
  { id: 'V19', description: 'Unplug and drive off',                                  transitions: ['charging', 'driving'] },
  { id: 'V20', description: 'Supercharger pull-in still in D',                       transitions: ['driving', 'charging'] },
  { id: 'V21', description: 'Scheduled charge starts at 11pm',                       transitions: ['asleep', 'charging'] },
  { id: 'V23', description: 'Remote precondition while parked',                      transitions: ['parked', 'online'] },
  { id: 'V25', description: 'Cabin overheat wakes asleep car',                       transitions: ['asleep', 'online'] },
  { id: 'V26', description: 'Precondition ends → sleep',                             transitions: ['online', 'parked', 'asleep'] },
  { id: 'V28', description: 'REST-poll speed > 1, no gear',                          transitions: ['online', 'driving'] },
  { id: 'V29', description: 'Speed = 0, no gear → Online',                           transitions: ['driving', 'online'] },
  { id: 'V30', description: 'Gear=P seen → future stops = Parked',                   transitions: ['driving', 'parked'] },
  { id: 'V31', description: 'Cold-start: already charging',                          transitions: ['offline', 'charging'] },
  { id: 'V32', description: 'Cold-start: mid-drive',                                 transitions: ['offline', 'driving'] },
  { id: 'V33', description: 'Cold-start: parked + plugged + asleep',                 transitions: ['offline', 'asleep'] },
  { id: 'V34', description: 'Driving → lost → home → parked',                        transitions: ['driving', 'offline', 'parked'] },
  { id: 'V35', description: 'Sleep deepens past staleTimeout',                       transitions: ['asleep', 'offline'] },
  { id: 'V36', description: 'Asleep car loaded onto flatbed',                        transitions: ['asleep', 'driving'] },
  { id: 'V37', description: 'Offline car towed, signal returns',                     transitions: ['offline', 'driving'] },
  { id: 'V38', description: 'REST-poll: unplugs and rolls away',                     transitions: ['charging', 'driving'] },
]

/** Valid transitions for the vehicle FSM — derived from transition table */
export const VEHICLE_EDGES: Edge<VehicleState>[] = deriveEdges(VEHICLE_TRANSITIONS)

/** Complete vehicle FSM definition */
export const VEHICLE_FSM: FSMDefinition<VehicleState, VehicleTrigger> = {
  states: VEHICLE_STATE_ENTRIES,
  edges: VEHICLE_EDGES,
  transitions: VEHICLE_TRANSITIONS,
  disallowed: VEHICLE_DISALLOWED,
  coverage: VEHICLE_COVERAGE,
  truthTable: VEHICLE_TRUTH_TABLE,
  scenarios: VEHICLE_SCENARIOS,
  labels: VEHICLE_STATE_LABELS,
}

/** Signal context — mirrors Go SignalContext (§2.4) */
export interface VehicleSignalContext {
  currentState: VehicleState
  isCharging: boolean
  isPluggedIn: boolean
  isGearCapable: boolean
  hasSeenGearP: boolean
  speed: number
  hvacOn: boolean
  preconditionOn: boolean
  sentryOn: boolean
  wasActive: boolean
}

/**
 * Derive vehicle status from live state data.
 * Priority: charging > driving > API state string > offline fallback.
 */
export function deriveVehicleStatus(state?: { is_charging?: boolean; speed?: number | null; state?: string | null } | null): VehicleState {
  if (!state) return 'offline'
  if (state.is_charging) return 'charging'
  if (state.speed && state.speed > 0) return 'driving'
  const s = (state.state ?? '').toLowerCase()
  if (VEHICLE_STATES.includes(s as VehicleState)) return s as VehicleState
  return 'online'
}

// ─────────────────────────────────────────────────────────────────────────────
// Drive Session FSM — from web/src/types/fsm/drive-session.ts
// ─────────────────────────────────────────────────────────────────────────────

export const DRIVE_SESSION_STATES = [
  'pending', 'active', 'ending', 'completed', 'recovered',
] as const

export type DriveSessionState = (typeof DRIVE_SESSION_STATES)[number]

export const DRIVE_SESSION_STATE_ENTRIES: Record<DriveSessionState, StateEntry> = {
  pending:   { variant: 'warning' },
  active:    { variant: 'success' },
  ending:    { variant: 'warning', overrides: { badgeDot: 'bg-orange-400', bg: 'bg-orange-500/10', text: 'text-orange-400', dot: 'bg-orange-400' } },
  completed: { variant: 'info',    overrides: { badgeDot: 'bg-indigo-400', bg: 'bg-indigo-500/10', text: 'text-indigo-400', dot: 'bg-indigo-400' } },
  recovered: { variant: 'neutral', overrides: { badgeDot: 'bg-purple-400', bg: 'bg-purple-500/10', text: 'text-purple-400', dot: 'bg-purple-400' } },
}

export const DRIVE_SESSION_TRIGGERS = [
  'start_snapshot_ready', 'pod_restart', 'drive_ending',
  'end_snapshot_ready', 'end_snapshot_timeout', 'signals_flowing',
] as const
export type DriveSessionTrigger = (typeof DRIVE_SESSION_TRIGGERS)[number]

export const DRIVE_SESSION_GUARDS = [
  'has_required_start_fields', 'has_required_end_fields',
] as const
export type DriveSessionGuard = (typeof DRIVE_SESSION_GUARDS)[number]

export interface DriveSignalContext {
  startOdometer: number
  startBattery: number
  startLatitude: number
  startLongitude: number
  endOdometer: number
  endBattery: number
  endLatitude: number
  endLongitude: number
}

export const DRIVE_SESSION_TRANSITIONS: TransitionRow<DriveSessionState, DriveSessionTrigger>[] = [
  { from: 'pending',   to: 'active',    trigger: 'start_snapshot_ready',  guard: 'has_required_start_fields', timing: 'immediate' },
  { from: 'pending',   to: 'recovered', trigger: 'pod_restart',           guard: null,                        timing: 'immediate' },
  { from: 'active',    to: 'ending',    trigger: 'drive_ending',          guard: null,                        timing: 'immediate' },
  { from: 'active',    to: 'recovered', trigger: 'pod_restart',           guard: null,                        timing: 'immediate' },
  { from: 'ending',    to: 'completed', trigger: 'end_snapshot_ready',    guard: 'has_required_end_fields',   timing: 'immediate' },
  { from: 'ending',    to: 'completed', trigger: 'end_snapshot_timeout',  guard: null,                        timing: 'immediate' },
  { from: 'recovered', to: 'active',    trigger: 'signals_flowing',       guard: null,                        timing: 'immediate' },
  { from: 'recovered', to: 'ending',    trigger: 'drive_ending',          guard: null,                        timing: 'immediate' },
]

export const DRIVE_SESSION_EDGES: Edge<DriveSessionState>[] = deriveEdges(DRIVE_SESSION_TRANSITIONS)

export const DRIVE_SESSION_DISALLOWED: DisallowedTransition<DriveSessionState>[] = [
  { from: 'active',    to: 'pending',   reason: 'Snapshots only flow forward' },
  { from: 'completed', to: 'pending',   reason: 'Terminal — new drive starts fresh sub-FSM' },
  { from: 'completed', to: 'active',    reason: 'Terminal' },
  { from: 'completed', to: 'ending',    reason: 'Terminal' },
  { from: 'completed', to: 'recovered', reason: 'Terminal' },
  { from: 'pending',   to: 'completed', reason: 'Must accumulate via Active first' },
]

export const DRIVE_VALIDATION_RULES = {
  distanceMin: 0, distanceMaxMi: 500, durationMinSec: 30,
  netEnergyMin: 0, efficiencyRangeWhPerMi: [100, 600] as const,
  endBatteryMaxDelta: 2,
} as const

export const DRIVE_SESSION_COVERAGE: CoverageMatrix<DriveSessionState> = {
  pending:   { pending: 'self', active: 'valid',  ending: null,    completed: null,    recovered: 'valid' },
  active:    { pending: null,   active: 'self',   ending: 'valid', completed: null,    recovered: 'valid' },
  ending:    { pending: null,   active: null,     ending: 'self',  completed: 'valid', recovered: null },
  completed: { pending: null,   active: null,     ending: null,    completed: 'self',  recovered: null },
  recovered: { pending: null,   active: 'valid',  ending: 'valid', completed: null,    recovered: 'self' },
}

export const DRIVE_SESSION_SCENARIOS: Scenario<DriveSessionState>[] = [
  { id: 'D1',  description: 'Normal drive with all signals',                     transitions: ['pending', 'active', 'ending', 'completed'] },
  { id: 'D2',  description: 'Pod restart mid-drive, signals still flowing',       transitions: ['active', 'recovered', 'active'] },
  { id: 'D3',  description: 'Pod restart while car already parked',              transitions: ['active', 'recovered', 'ending', 'completed'] },
  { id: 'D4',  description: 'End odometer never arrives within 60s',              transitions: ['ending', 'completed'] },
  { id: 'D5',  description: 'Signal lost before snapshot ready',                  transitions: ['pending', 'recovered'] },
  { id: 'D6',  description: 'Charge starts mid-drive (Supercharger)',             transitions: ['active', 'ending', 'completed'] },
  { id: 'D7',  description: 'Micro-drive (< 30s)',                                transitions: ['pending', 'active', 'ending', 'completed'] },
  { id: 'D8',  description: 'End battery > start (heavy regen)',                  transitions: ['pending', 'active', 'ending', 'completed'] },
  { id: 'D9',  description: 'Two back-to-back drives',                            transitions: ['pending', 'active', 'ending', 'completed'] },
  { id: 'D10', description: 'No start GPS (parking garage)',                      transitions: ['pending'] },
]

export const DRIVE_SESSION_FSM: FSMDefinition<DriveSessionState, DriveSessionTrigger> = {
  states: DRIVE_SESSION_STATE_ENTRIES,
  edges: DRIVE_SESSION_EDGES,
  transitions: DRIVE_SESSION_TRANSITIONS,
  disallowed: DRIVE_SESSION_DISALLOWED,
  coverage: DRIVE_SESSION_COVERAGE,
  scenarios: DRIVE_SESSION_SCENARIOS,
}

// ─────────────────────────────────────────────────────────────────────────────
// Charge Session FSM — from web/src/types/fsm/charge-session.ts
// ─────────────────────────────────────────────────────────────────────────────

export const CHARGE_SESSION_STATES = [
  'pending', 'active', 'completing', 'done', 'recovered',
] as const

export type ChargeSessionState = (typeof CHARGE_SESSION_STATES)[number]

export const CHARGE_SESSION_STATE_ENTRIES: Record<ChargeSessionState, StateEntry> = {
  pending:    { variant: 'warning' },
  active:     { variant: 'success', overrides: { badgeDot: 'bg-cyan-400', bg: 'bg-cyan-500/10', text: 'text-cyan-400', dot: 'bg-cyan-400' } },
  completing: { variant: 'info' },
  done:       { variant: 'success' },
  recovered:  { variant: 'neutral', overrides: { badgeDot: 'bg-purple-400', bg: 'bg-purple-500/10', text: 'text-purple-400', dot: 'bg-purple-400' } },
}

export const CHARGE_SESSION_TRIGGERS = [
  'start_snapshot_ready', 'pod_restart', 'charge_ending',
  'gear_driving', 'end_snapshot_ready', 'end_snapshot_timeout',
  'charge_still_active',
] as const
export type ChargeSessionTrigger = (typeof CHARGE_SESSION_TRIGGERS)[number]

export const CHARGE_SESSION_GUARDS = [
  'has_charge_start_fields', 'has_charge_end_fields',
] as const
export type ChargeSessionGuard = (typeof CHARGE_SESSION_GUARDS)[number]

export interface ChargeSignalContext {
  startBattery: number
  startRange: number
  startLatitude: number
  startLongitude: number
  endBattery: number
  endRange: number
  energyAdded: number
  chargerType: 'AC' | 'DC'
  maxVoltage: number
  maxCurrent: number
  maxPower: number
}

export const CHARGE_SESSION_TRANSITIONS: TransitionRow<ChargeSessionState, ChargeSessionTrigger>[] = [
  { from: 'pending',    to: 'active',     trigger: 'start_snapshot_ready', guard: 'has_charge_start_fields', timing: 'immediate' },
  { from: 'pending',    to: 'recovered',  trigger: 'pod_restart',          guard: null,                      timing: 'immediate' },
  { from: 'active',     to: 'completing', trigger: 'charge_ending',        guard: null,                      timing: 'immediate' },
  { from: 'active',     to: 'completing', trigger: 'gear_driving',         guard: null,                      timing: 'immediate' },
  { from: 'active',     to: 'recovered',  trigger: 'pod_restart',          guard: null,                      timing: 'immediate' },
  { from: 'completing', to: 'done',       trigger: 'end_snapshot_ready',   guard: 'has_charge_end_fields',   timing: 'immediate' },
  { from: 'completing', to: 'done',       trigger: 'end_snapshot_timeout', guard: null,                      timing: 'immediate' },
  { from: 'recovered',  to: 'active',     trigger: 'charge_still_active',  guard: null,                      timing: 'immediate' },
  { from: 'recovered',  to: 'completing', trigger: 'charge_ending',        guard: null,                      timing: 'immediate' },
]

export const CHARGE_SESSION_EDGES: Edge<ChargeSessionState>[] = deriveEdges(CHARGE_SESSION_TRANSITIONS)

export const CHARGE_SESSION_DISALLOWED: DisallowedTransition<ChargeSessionState>[] = [
  { from: 'active', to: 'pending', reason: 'Snapshots only flow forward' },
  { from: 'done',   to: 'pending', reason: 'Terminal' },
  { from: 'done',   to: 'active',  reason: 'Terminal' },
  { from: 'pending', to: 'done',   reason: 'Must accumulate via Active first' },
]

export const CHARGE_SESSION_COVERAGE: CoverageMatrix<ChargeSessionState> = {
  pending:    { pending: 'self', active: 'valid',  completing: null,    done: null,    recovered: 'valid' },
  active:     { pending: null,   active: 'self',   completing: 'valid', done: null,    recovered: 'valid' },
  completing: { pending: null,   active: null,     completing: 'self',  done: 'valid', recovered: null },
  done:       { pending: null,   active: null,     completing: null,    done: 'self',  recovered: null },
  recovered:  { pending: null,   active: 'valid',  completing: 'valid', done: null,    recovered: 'self' },
}

export const CHARGE_SESSION_SCENARIOS: Scenario<ChargeSessionState>[] = [
  { id: 'C1',  description: 'Normal AC home charge to 80%',                    transitions: ['pending', 'active', 'completing', 'done'] },
  { id: 'C2',  description: 'DC Supercharger, ramp & taper',                   transitions: ['pending', 'active', 'completing', 'done'] },
  { id: 'C3',  description: 'Pod restart mid-charge, still active',            transitions: ['active', 'recovered', 'active'] },
  { id: 'C4',  description: 'Pod restart, charge already completed',           transitions: ['active', 'recovered', 'completing', 'done'] },
  { id: 'C5',  description: 'Unplug & immediately drive off',                  transitions: ['active', 'completing', 'done'] },
  { id: 'C6',  description: 'Charge interrupted by fault',                     transitions: ['active', 'completing', 'done'] },
  { id: 'C7',  description: 'End battery never arrives within 30s',            transitions: ['completing', 'done'] },
  { id: 'C8',  description: 'Cell-balance dwell (Vehicle Asleep)',             transitions: ['active'] },
  { id: 'C9',  description: 'Plug-in but never starts (handshake fail)',       transitions: ['pending'] },
  { id: 'C10', description: 'Two back-to-back plug-ins',                       transitions: ['pending', 'active', 'completing', 'done'] },
]

export const CHARGE_SESSION_FSM: FSMDefinition<ChargeSessionState, ChargeSessionTrigger> = {
  states: CHARGE_SESSION_STATE_ENTRIES,
  edges: CHARGE_SESSION_EDGES,
  transitions: CHARGE_SESSION_TRANSITIONS,
  disallowed: CHARGE_SESSION_DISALLOWED,
  coverage: CHARGE_SESSION_COVERAGE,
  scenarios: CHARGE_SESSION_SCENARIOS,
}

// ─────────────────────────────────────────────────────────────────────────────
// Command FSM — from web/src/types/fsm/command.ts
// ─────────────────────────────────────────────────────────────────────────────

export const COMMAND_STATES = [
  'queued', 'waking', 'wake_confirmed', 'wake_timeout',
  'sending', 'succeeded', 'failed', 'timed_out', 'retrying', 'gave_up',
] as const

export type CommandState = (typeof COMMAND_STATES)[number]

export const COMMAND_STATE_ENTRIES: Record<CommandState, StateEntry> = {
  queued:         { variant: 'neutral' },
  waking:         { variant: 'warning' },
  wake_confirmed: { variant: 'info' },
  wake_timeout:   { variant: 'warning', overrides: { badgeDot: 'bg-orange-400', bg: 'bg-orange-500/10', text: 'text-orange-400', dot: 'bg-orange-400' } },
  sending:        { variant: 'info' },
  succeeded:      { variant: 'success' },
  failed:         { variant: 'danger' },
  timed_out:      { variant: 'warning', overrides: { badgeDot: 'bg-orange-400', bg: 'bg-orange-500/10', text: 'text-orange-400', dot: 'bg-orange-400' } },
  retrying:       { variant: 'neutral', overrides: { badgeDot: 'bg-purple-400', bg: 'bg-purple-500/10', text: 'text-purple-400', dot: 'bg-purple-400' } },
  gave_up:        { variant: 'danger',  overrides: { badgeDot: 'bg-red-500', bg: 'bg-red-600/10', text: 'text-red-500', dot: 'bg-red-500' } },
}

export const COMMAND_TRIGGERS = [
  'vehicle_awake', 'vehicle_asleep', 'duplicate_command',
  'wake_response', 'timeout_30s', 'init_delay',
  'command_ok', 'command_error', 'timeout_15s',
  'retry_scheduled', 'backoff_expired',
] as const
export type CommandTrigger = (typeof COMMAND_TRIGGERS)[number]

export const COMMAND_GUARDS = [
  'retryable', 'non_retryable',
  'wake_retries_left', 'wake_retries_exhausted',
  'retries_left', 'retries_exhausted',
] as const
export type CommandGuard = (typeof COMMAND_GUARDS)[number]

export const COMMAND_TRANSITIONS: TransitionRow<CommandState, CommandTrigger>[] = [
  { from: 'queued',          to: 'sending',        trigger: 'vehicle_awake',     guard: null,                    timing: 'immediate' },
  { from: 'queued',          to: 'waking',          trigger: 'vehicle_asleep',    guard: null,                    timing: 'immediate' },
  { from: 'queued',          to: 'gave_up',         trigger: 'duplicate_command', guard: null,                    timing: 'immediate' },
  { from: 'waking',          to: 'wake_confirmed',  trigger: 'wake_response',     guard: null,                    timing: 'immediate' },
  { from: 'waking',          to: 'wake_timeout',    trigger: 'timeout_30s',       guard: null,                    timing: 'immediate' },
  { from: 'wake_confirmed',  to: 'sending',         trigger: 'init_delay',        guard: null,                    timing: 'immediate' },
  { from: 'wake_timeout',    to: 'waking',           trigger: 'retry_scheduled',   guard: 'wake_retries_left',     timing: 'immediate' },
  { from: 'wake_timeout',    to: 'gave_up',          trigger: 'retry_scheduled',   guard: 'wake_retries_exhausted', timing: 'immediate' },
  { from: 'sending',         to: 'succeeded',        trigger: 'command_ok',        guard: null,                    timing: 'immediate' },
  { from: 'sending',         to: 'failed',            trigger: 'command_error',     guard: null,                    timing: 'immediate' },
  { from: 'sending',         to: 'timed_out',         trigger: 'timeout_15s',       guard: null,                    timing: 'immediate' },
  { from: 'failed',          to: 'retrying',          trigger: 'retry_scheduled',   guard: 'retryable',             timing: 'immediate' },
  { from: 'failed',          to: 'gave_up',           trigger: 'retry_scheduled',   guard: 'non_retryable',         timing: 'immediate' },
  { from: 'timed_out',       to: 'retrying',          trigger: 'retry_scheduled',   guard: 'retries_left',          timing: 'immediate' },
  { from: 'timed_out',       to: 'gave_up',           trigger: 'retry_scheduled',   guard: 'retries_exhausted',     timing: 'immediate' },
  { from: 'retrying',        to: 'sending',           trigger: 'backoff_expired',   guard: null,                    timing: 'immediate' },
]

export const COMMAND_EDGES: Edge<CommandState>[] = deriveEdges(COMMAND_TRANSITIONS)

export const COMMAND_DISALLOWED: DisallowedTransition<CommandState>[] = [
  { from: 'succeeded', to: 'retrying', reason: 'Terminal' },
  { from: 'succeeded', to: 'waking',   reason: 'Terminal' },
  { from: 'gave_up',   to: 'retrying', reason: 'Terminal — create new command' },
  { from: 'gave_up',   to: 'waking',   reason: 'Terminal' },
  { from: 'sending',   to: 'waking',   reason: 'Retry returns through Sending, never re-wakes' },
  { from: 'queued',    to: 'succeeded', reason: 'Must transit Sending to record API call' },
]

export const COMMAND_COVERAGE: CoverageMatrix<CommandState> = {
  queued:         { queued: 'self', waking: 'valid', wake_confirmed: null,   wake_timeout: null, sending: 'valid', succeeded: null, failed: null, timed_out: null, retrying: null,   gave_up: 'valid' },
  waking:         { queued: null,   waking: 'self',  wake_confirmed: 'valid', wake_timeout: 'valid', sending: null, succeeded: null, failed: null, timed_out: null, retrying: null, gave_up: null },
  wake_confirmed: { queued: null,   waking: null,    wake_confirmed: 'self', wake_timeout: null, sending: 'valid', succeeded: null, failed: null, timed_out: null, retrying: null,   gave_up: null },
  wake_timeout:   { queued: null,   waking: 'valid', wake_confirmed: null,   wake_timeout: 'self', sending: null, succeeded: null, failed: null, timed_out: null, retrying: null,   gave_up: 'valid' },
  sending:        { queued: null,   waking: null,    wake_confirmed: null,   wake_timeout: null, sending: 'self', succeeded: 'valid', failed: 'valid', timed_out: 'valid', retrying: null, gave_up: null },
  succeeded:      { queued: null,   waking: null,    wake_confirmed: null,   wake_timeout: null, sending: null,   succeeded: 'self', failed: null, timed_out: null, retrying: null,   gave_up: null },
  failed:         { queued: null,   waking: null,    wake_confirmed: null,   wake_timeout: null, sending: null,   succeeded: null,   failed: 'self', timed_out: null, retrying: 'valid', gave_up: 'valid' },
  timed_out:      { queued: null,   waking: null,    wake_confirmed: null,   wake_timeout: null, sending: null,   succeeded: null,   failed: null, timed_out: 'self', retrying: 'valid', gave_up: 'valid' },
  retrying:       { queued: null,   waking: null,    wake_confirmed: null,   wake_timeout: null, sending: 'valid', succeeded: null, failed: null, timed_out: null, retrying: 'self',   gave_up: null },
  gave_up:        { queued: null,   waking: null,    wake_confirmed: null,   wake_timeout: null, sending: null,   succeeded: null,   failed: null, timed_out: null, retrying: null,   gave_up: 'self' },
}

export const COMMAND_TOASTS: ToastMap<CommandState> = {
  waking: 'Waking vehicle…', wake_confirmed: null, sending: 'Sending command…',
  succeeded: '✅ Command succeeded', failed: '⚠️ Command failed, retrying…',
  retrying: 'Retrying…', gave_up: '❌ Command failed',
}

export const COMMAND_SCENARIOS: Scenario<CommandState>[] = [
  { id: 'K1', description: 'Lock car (already awake)',       transitions: ['queued','sending','succeeded'] },
  { id: 'K2', description: 'Lock car (asleep)',              transitions: ['queued','waking','wake_confirmed','sending','succeeded'] },
  { id: 'K3', description: 'Wake never responds, retry',     transitions: ['waking','wake_timeout','waking'] },
  { id: 'K4', description: 'Wake retries exhausted',         transitions: ['wake_timeout','gave_up'] },
  { id: 'K5', description: 'Tesla 429 rate limit',           transitions: ['sending','failed','retrying','sending'] },
  { id: 'K6', description: 'Tesla 401 auth error',           transitions: ['sending','failed','gave_up'] },
  { id: 'K7', description: 'No response in 15s',             transitions: ['sending','timed_out','retrying','sending'] },
  { id: 'K8', description: 'Duplicate click within 5s',      transitions: ['queued','gave_up'] },
]

export const COMMAND_FSM: FSMDefinition<CommandState, CommandTrigger> = {
  states: COMMAND_STATE_ENTRIES, edges: COMMAND_EDGES,
  transitions: COMMAND_TRANSITIONS, disallowed: COMMAND_DISALLOWED,
  coverage: COMMAND_COVERAGE, scenarios: COMMAND_SCENARIOS, toasts: COMMAND_TOASTS,
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification FSM — from web/src/types/fsm/notification.ts
// ─────────────────────────────────────────────────────────────────────────────

export const NOTIFICATION_STATES = ['created','sending','delivered','partial','failed','retrying','dead'] as const
export type NotificationState = (typeof NOTIFICATION_STATES)[number]

export const NOTIFICATION_STATE_ENTRIES: Record<NotificationState, StateEntry> = {
  created:   { variant: 'neutral' },
  sending:   { variant: 'info' },
  delivered: { variant: 'success' },
  partial:   { variant: 'warning' },
  failed:    { variant: 'danger' },
  retrying:  { variant: 'neutral', overrides: { badgeDot: 'bg-purple-400', bg: 'bg-purple-500/10', text: 'text-purple-400', dot: 'bg-purple-400' } },
  dead:      { variant: 'danger',  overrides: { badgeDot: 'bg-red-500', bg: 'bg-red-600/10', text: 'text-red-500', dot: 'bg-red-500' } },
}

export const NOTIFICATION_TRIGGERS = [
  'delivery_start','all_channels_ok','some_channels_failed',
  'all_channels_failed','retry','retry_scheduled','backoff_expired',
] as const
export type NotificationTrigger = (typeof NOTIFICATION_TRIGGERS)[number]
export const NOTIFICATION_GUARDS = ['under_max_retries','max_retries_reached'] as const
export type NotificationGuard = (typeof NOTIFICATION_GUARDS)[number]

export const NOTIFICATION_TRANSITIONS: TransitionRow<NotificationState, NotificationTrigger>[] = [
  { from: 'created',  to: 'sending',   trigger: 'delivery_start',       guard: null,                  timing: 'immediate' },
  { from: 'sending',  to: 'delivered', trigger: 'all_channels_ok',      guard: null,                  timing: 'immediate' },
  { from: 'sending',  to: 'partial',   trigger: 'some_channels_failed', guard: null,                  timing: 'immediate' },
  { from: 'sending',  to: 'failed',    trigger: 'all_channels_failed',  guard: null,                  timing: 'immediate' },
  { from: 'partial',  to: 'sending',   trigger: 'retry',                guard: 'under_max_retries',   timing: 'immediate' },
  { from: 'partial',  to: 'dead',      trigger: 'retry',                guard: 'max_retries_reached', timing: 'immediate' },
  { from: 'failed',   to: 'retrying',  trigger: 'retry_scheduled',      guard: 'under_max_retries',   timing: 'immediate' },
  { from: 'failed',   to: 'dead',      trigger: 'retry_scheduled',      guard: 'max_retries_reached', timing: 'immediate' },
  { from: 'retrying', to: 'sending',   trigger: 'backoff_expired',      guard: null,                  timing: 'immediate' },
]

export const NOTIFICATION_EDGES: Edge<NotificationState>[] = deriveEdges(NOTIFICATION_TRANSITIONS)

export const NOTIFICATION_DISALLOWED: DisallowedTransition<NotificationState>[] = [
  { from: 'delivered', to: 'sending', reason: 'Terminal' },
  { from: 'dead', to: 'sending', reason: 'Terminal — operator creates new row' },
  { from: 'dead', to: 'retrying', reason: 'Terminal' },
  { from: 'created', to: 'failed', reason: 'Failures come from Sending' },
  { from: 'created', to: 'partial', reason: 'Failures come from Sending' },
]

export const NOTIFICATION_COVERAGE: CoverageMatrix<NotificationState> = {
  created:   { created: 'self', sending: 'valid', delivered: null,   partial: null,   failed: null,   retrying: null,   dead: null },
  sending:   { created: null,   sending: 'self',  delivered: 'valid', partial: 'valid', failed: 'valid', retrying: null,  dead: null },
  delivered: { created: null,   sending: null,    delivered: 'self', partial: null,   failed: null,   retrying: null,   dead: null },
  partial:   { created: null,   sending: 'valid', delivered: null,   partial: 'self', failed: null,   retrying: null,   dead: 'valid' },
  failed:    { created: null,   sending: null,    delivered: null,   partial: null,   failed: 'self', retrying: 'valid', dead: 'valid' },
  retrying:  { created: null,   sending: 'valid', delivered: null,   partial: null,   failed: null,   retrying: 'self', dead: null },
  dead:      { created: null,   sending: null,    delivered: null,   partial: null,   failed: null,   retrying: null,   dead: 'self' },
}

export const NOTIFICATION_SCENARIOS: Scenario<NotificationState>[] = [
  { id: 'N1', description: 'Push + Email both succeed',           transitions: ['created','sending','delivered'] },
  { id: 'N2', description: 'Push OK, Email fails → retry',       transitions: ['created','sending','partial','sending','delivered'] },
  { id: 'N3', description: 'All channels fail',                   transitions: ['created','sending','failed','retrying','sending'] },
  { id: 'N4', description: 'All retries exhausted from failed',   transitions: ['failed','dead'] },
  { id: 'N5', description: 'Partial retries exhausted',           transitions: ['partial','dead'] },
]

export const NOTIFICATION_FSM: FSMDefinition<NotificationState, NotificationTrigger> = {
  states: NOTIFICATION_STATE_ENTRIES, edges: NOTIFICATION_EDGES,
  transitions: NOTIFICATION_TRANSITIONS, disallowed: NOTIFICATION_DISALLOWED,
  coverage: NOTIFICATION_COVERAGE, scenarios: NOTIFICATION_SCENARIOS,
}

// ─────────────────────────────────────────────────────────────────────────────
// Alert Cooldown FSM — from web/src/types/fsm/alert-cooldown.ts
// ─────────────────────────────────────────────────────────────────────────────

export const ALERT_COOLDOWN_STATES = ['armed', 'fired', 'suppressed'] as const
export type AlertCooldownState = (typeof ALERT_COOLDOWN_STATES)[number]

export const ALERT_COOLDOWN_STATE_ENTRIES: Record<AlertCooldownState, StateEntry> = {
  armed:      { variant: 'success' },
  fired:      { variant: 'danger' },
  suppressed: { variant: 'warning' },
}

export const ALERT_COOLDOWN_TRIGGERS = ['condition_met', 'cooldown_expired'] as const
export type AlertCooldownTrigger = (typeof ALERT_COOLDOWN_TRIGGERS)[number]

export const ALERT_COOLDOWN_GUARDS = ['within_cooldown', 'max_fires_per_hour'] as const
export type AlertCooldownGuard = (typeof ALERT_COOLDOWN_GUARDS)[number]

export interface AlertCooldownConfig {
  cooldownDuration: number
  maxFiresPerHour: number
  suppressInStates: string[]
}

export const ALERT_COOLDOWN_TRANSITIONS: TransitionRow<AlertCooldownState, AlertCooldownTrigger>[] = [
  { from: 'armed',      to: 'fired',      trigger: 'condition_met',    guard: null,              timing: 'immediate' },
  { from: 'fired',      to: 'suppressed', trigger: 'condition_met',    guard: 'within_cooldown', timing: 'immediate' },
  { from: 'fired',      to: 'armed',      trigger: 'cooldown_expired', guard: null,              timing: 'immediate' },
  { from: 'suppressed', to: 'suppressed', trigger: 'condition_met',    guard: 'within_cooldown', timing: 'immediate' },
  { from: 'suppressed', to: 'armed',      trigger: 'cooldown_expired', guard: null,              timing: 'immediate' },
]

export const ALERT_COOLDOWN_EDGES: Edge<AlertCooldownState>[] = deriveEdges(ALERT_COOLDOWN_TRANSITIONS)

export const ALERT_COOLDOWN_DISALLOWED: DisallowedTransition<AlertCooldownState>[] = [
  { from: 'armed',      to: 'suppressed', reason: 'Must fire first' },
  { from: 'suppressed', to: 'fired',      reason: 'Must go through Armed (cooldown expired)' },
]

export const ALERT_COOLDOWN_COVERAGE: CoverageMatrix<AlertCooldownState> = {
  armed:      { armed: 'self', fired: 'valid',      suppressed: 'disallowed' },
  fired:      { armed: 'valid', fired: 'self',      suppressed: 'valid' },
  suppressed: { armed: 'valid', fired: 'disallowed', suppressed: 'self' },
}

export const ALERT_COOLDOWN_SCENARIOS: Scenario<AlertCooldownState>[] = [
  { id: 'A1', description: 'First fire',                      transitions: ['armed', 'fired'] },
  { id: 'A2', description: 'Same condition within cooldown',   transitions: ['fired', 'suppressed'] },
  { id: 'A3', description: 'Repeated suppressions',            transitions: ['suppressed', 'suppressed'] },
  { id: 'A4', description: 'Cooldown expires while suppressed', transitions: ['suppressed', 'armed'] },
  { id: 'A5', description: 'Cooldown expires cleanly',         transitions: ['fired', 'armed'] },
]

export const ALERT_COOLDOWN_FSM: FSMDefinition<AlertCooldownState, AlertCooldownTrigger> = {
  states: ALERT_COOLDOWN_STATE_ENTRIES, edges: ALERT_COOLDOWN_EDGES,
  transitions: ALERT_COOLDOWN_TRANSITIONS, disallowed: ALERT_COOLDOWN_DISALLOWED,
  coverage: ALERT_COOLDOWN_COVERAGE, scenarios: ALERT_COOLDOWN_SCENARIOS,
}

// ─────────────────────────────────────────────────────────────────────────────
// Automation FSM — from web/src/types/fsm/automation.ts
// ─────────────────────────────────────────────────────────────────────────────

export const AUTOMATION_STATES = [
  'idle', 'evaluating', 'executing', 'succeeded', 'partial',
  'failed', 'retrying', 'gave_up', 'skipped', 'cooldown', 'disabled',
] as const

export type AutomationState = (typeof AUTOMATION_STATES)[number]

export const AUTOMATION_STATE_ENTRIES: Record<AutomationState, StateEntry> = {
  idle:       { variant: 'neutral', overrides: { text: 'text-[var(--text-secondary)]' } },
  evaluating: { variant: 'info',    overrides: { badgeDot: 'bg-cyan-400', bg: 'bg-cyan-500/10', text: 'text-cyan-400', dot: 'bg-cyan-400' } },
  executing:  { variant: 'warning' },
  succeeded:  { variant: 'success' },
  partial:    { variant: 'warning' },
  failed:     { variant: 'danger' },
  retrying:   { variant: 'warning' },
  gave_up:    { variant: 'danger',  overrides: { badgeDot: 'bg-red-500', bg: 'bg-red-600/10', text: 'text-red-500', dot: 'bg-red-500' } },
  skipped:    { variant: 'neutral', overrides: { badgeDot: 'bg-gray-500', bg: 'bg-gray-600/10', text: 'text-[var(--text-muted)]', dot: 'bg-gray-500' } },
  cooldown:   { variant: 'neutral', overrides: { badgeDot: 'bg-purple-400', bg: 'bg-purple-500/10', text: 'text-purple-400', dot: 'bg-purple-400' } },
  disabled:   { variant: 'danger',  overrides: { badgeDot: 'bg-red-400/50', bg: 'bg-red-500/5', text: 'text-red-400/50', dot: 'bg-red-400/50' } },
}

export const AUTOMATION_TRIGGERS = ['manual'] as const
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number]

export const AUTOMATION_TRANSITIONS: TransitionRow<AutomationState, AutomationTrigger>[] = [
  { from: 'idle',       to: 'evaluating', trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'evaluating', to: 'executing',  trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'evaluating', to: 'skipped',    trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'executing',  to: 'succeeded',  trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'executing',  to: 'partial',    trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'executing',  to: 'failed',     trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'failed',     to: 'retrying',   trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'retrying',   to: 'executing',  trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'retrying',   to: 'gave_up',    trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'succeeded',  to: 'cooldown',   trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'succeeded',  to: 'idle',       trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'partial',    to: 'cooldown',   trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'partial',    to: 'idle',       trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'gave_up',    to: 'idle',       trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'gave_up',    to: 'disabled',   trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'skipped',    to: 'idle',       trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'cooldown',   to: 'idle',       trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'disabled',   to: 'idle',       trigger: 'manual', guard: null, timing: 'immediate' },
]

export const AUTOMATION_EDGES = deriveEdges(AUTOMATION_TRANSITIONS)

export const AUTOMATION_FSM: FSMDefinition<AutomationState, AutomationTrigger> = {
  states: AUTOMATION_STATE_ENTRIES,
  edges: AUTOMATION_EDGES,
  transitions: AUTOMATION_TRANSITIONS,
}

// ─────────────────────────────────────────────────────────────────────────────
// Telemetry Connection FSM — from web/src/types/fsm/telemetry-connection.ts
// ─────────────────────────────────────────────────────────────────────────────

export const TELEMETRY_CONNECTION_STATES = [
  'unknown', 'connecting', 'streaming', 'stale', 'disconnected', 'polling_only',
] as const

export type TelemetryConnectionState = (typeof TELEMETRY_CONNECTION_STATES)[number]

export const TELEMETRY_CONNECTION_STATE_ENTRIES: Record<TelemetryConnectionState, StateEntry> = {
  unknown:      { variant: 'neutral' },
  connecting:   { variant: 'warning' },
  streaming:    { variant: 'success' },
  stale:        { variant: 'warning' },
  disconnected: { variant: 'danger' },
  polling_only: { variant: 'info' },
}

export const TELEMETRY_CONNECTION_TRIGGERS = ['manual'] as const
export type TelemetryConnectionTrigger = (typeof TELEMETRY_CONNECTION_TRIGGERS)[number]

export const TELEMETRY_CONNECTION_TRANSITIONS: TransitionRow<TelemetryConnectionState, TelemetryConnectionTrigger>[] = [
  { from: 'unknown',      to: 'connecting',   trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'unknown',      to: 'polling_only', trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'connecting',   to: 'streaming',    trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'connecting',   to: 'stale',        trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'connecting',   to: 'disconnected', trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'streaming',    to: 'stale',        trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'streaming',    to: 'disconnected', trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'stale',        to: 'streaming',    trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'stale',        to: 'disconnected', trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'disconnected', to: 'streaming',    trigger: 'manual', guard: null, timing: 'immediate' },
  { from: 'polling_only', to: 'streaming',    trigger: 'manual', guard: null, timing: 'immediate' },
]

export const TELEMETRY_CONNECTION_EDGES = deriveEdges(TELEMETRY_CONNECTION_TRANSITIONS)

export const TELEMETRY_CONNECTION_FSM: FSMDefinition<TelemetryConnectionState, TelemetryConnectionTrigger> = {
  states: TELEMETRY_CONNECTION_STATE_ENTRIES,
  edges: TELEMETRY_CONNECTION_EDGES,
  transitions: TELEMETRY_CONNECTION_TRANSITIONS,
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry — from web/src/types/fsm/registry.ts
// (assembled from all FSMs above)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FSM_REGISTRY — assembled from individual typed FSM files.
 * Add a new FSM: create its file, import here, add one entry.
 *
 * Uses `satisfies` to preserve literal key types while conforming
 * to Record<string, FSMDefinition>.
 */
export const FSM_REGISTRY = {
  vehicle:              VEHICLE_FSM,
  drive_session:        DRIVE_SESSION_FSM,
  charge_session:       CHARGE_SESSION_FSM,
  command:              COMMAND_FSM,
  notification:         NOTIFICATION_FSM,
  alert_cooldown:       ALERT_COOLDOWN_FSM,
  automation:           AUTOMATION_FSM,
  telemetry_connection: TELEMETRY_CONNECTION_FSM,
} satisfies Record<string, FSMDefinition>

/** State name arrays per FSM type — uses explicit typed arrays for stable ordering */
export const FSM_STATES: Record<string, readonly string[]> = {
  vehicle:              VEHICLE_STATES,
  drive_session:        DRIVE_SESSION_STATES,
  charge_session:       CHARGE_SESSION_STATES,
  command:              COMMAND_STATES,
  notification:         NOTIFICATION_STATES,
  alert_cooldown:       ALERT_COOLDOWN_STATES,
  automation:           AUTOMATION_STATES,
  telemetry_connection: TELEMETRY_CONNECTION_STATES,
}

/** Transition edges per FSM type (backward-compat) */
export const FSM_EDGES: Record<string, [string, string][]> = Object.fromEntries(
  Object.entries(FSM_REGISTRY).map(([k, v]) => [k, v.edges]),
)

/** Color map per FSM type — resolves theme + overrides (backward-compat) */
export const STATE_COLORS: Record<string, Record<string, StateStyle>> = Object.fromEntries(
  Object.entries(FSM_REGISTRY).map(([fsmType, def]) => [
    fsmType,
    Object.fromEntries(
      Object.entries(def.states).map(([state, entry]) => {
        const resolved = resolveStyle(entry)
        return [state, { badgeDot: resolved.badgeDot, bg: resolved.bg, text: resolved.text, dot: resolved.dot }]
      }),
    ),
  ]),
)

/** Resolve state style for a given FSM type + state name */
export function getStateColor(fsmType: string, state: string): StateStyle {
  const def = FSM_REGISTRY[fsmType as keyof typeof FSM_REGISTRY] ?? FSM_REGISTRY.vehicle
  const states = def.states as Record<string, StateEntry>
  const entry = states[state.toLowerCase()]
  if (!entry) return DEFAULT_STATE
  const resolved = resolveStyle(entry)
  return { badgeDot: resolved.badgeDot, bg: resolved.bg, text: resolved.text, dot: resolved.dot }
}

/** Get the full resolved style (includes badge variant + badgeDot) */
export function getStateDefinition(fsmType: string, state: string): ResolvedStateStyle {
  const def = FSM_REGISTRY[fsmType as keyof typeof FSM_REGISTRY] ?? FSM_REGISTRY.vehicle
  const states = def.states as Record<string, StateEntry>
  const entry = states[state.toLowerCase()]
  return entry ? resolveStyle(entry) : DEFAULT_STATE
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-FSM — from web/src/types/fsm/cross-fsm.ts
// ─────────────────────────────────────────────────────────────────────────────

export type FSMAction =
  | 'CreateDriveSubFSM' | 'FinalizeDriveSubFSM' | 'ReconcileDriveSubFSM'
  | 'CreateChargeSubFSM' | 'FinalizeChargeSubFSM' | 'ReconcileChargeSubFSM'
  | 'ResumeOrCreateChargeSubFSM' | 'PauseChargeSubFSM' | 'MarkChargeInterrupted'
  | 'PersistState' | 'LogTransition'

export const VEHICLE_TRANSITION_ACTIONS: Partial<Record<`${VehicleState}→${VehicleState}`, FSMAction[]>> = {
  'online→driving':   ['CreateDriveSubFSM', 'PersistState', 'LogTransition'],
  'parked→driving':   ['CreateDriveSubFSM', 'PersistState', 'LogTransition'],
  'asleep→driving':   ['CreateDriveSubFSM', 'PersistState', 'LogTransition'],
  'offline→driving':  ['ReconcileDriveSubFSM', 'PersistState', 'LogTransition'],
  'driving→parked':   ['FinalizeDriveSubFSM', 'PersistState', 'LogTransition'],
  'driving→charging': ['FinalizeDriveSubFSM', 'CreateChargeSubFSM', 'PersistState', 'LogTransition'],
  'driving→offline':  ['FinalizeDriveSubFSM', 'PersistState', 'LogTransition'],
  'online→charging':  ['CreateChargeSubFSM', 'PersistState', 'LogTransition'],
  'parked→charging':  ['CreateChargeSubFSM', 'PersistState', 'LogTransition'],
  'asleep→charging':  ['ResumeOrCreateChargeSubFSM', 'PersistState', 'LogTransition'],
  'offline→charging': ['ReconcileChargeSubFSM', 'PersistState', 'LogTransition'],
  'charging→parked':  ['FinalizeChargeSubFSM', 'PersistState', 'LogTransition'],
  'charging→driving': ['FinalizeChargeSubFSM', 'CreateDriveSubFSM', 'PersistState', 'LogTransition'],
  'charging→online':  ['FinalizeChargeSubFSM', 'MarkChargeInterrupted', 'PersistState', 'LogTransition'],
  'charging→asleep':  ['PauseChargeSubFSM', 'PersistState', 'LogTransition'],
  'charging→offline': ['FinalizeChargeSubFSM', 'PersistState', 'LogTransition'],
}

export const FAILURE_ISOLATION_RULES = [
  'Sub-FSM panic must NOT propagate to Vehicle FSM — wrapped in recover()',
  'Notification failure must NOT block Vehicle FSM — separate worker pool',
  'Command failure has no effect on telemetry — different goroutine',
] as const

export const OUT_OF_SCOPE_STATES = [
  { state: 'Fault',              reason: 'Critical BMS/HV/thermal — needs new top-level state' },
  { state: 'Updating',           reason: 'OTA lock-out — needs new top-level state' },
  { state: 'Valet / Service',    reason: 'Restricted telemetry — needs new top-level state' },
  { state: 'Summon / Smart Park', reason: 'Autonomous low-speed — needs new top-level state' },
] as const
