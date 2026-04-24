import type { StateEntry, Edge, FSMDefinition, DisallowedTransition, CoverageMatrix, TruthTable } from './types'
import { deriveEdges, type TransitionRow } from './types'

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
  offline:  { variant: 'danger',  overrides: { bg: 'bg-gray-600/10', text: 'text-gray-500', dot: 'bg-gray-500' } },
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

/** Valid transitions for the vehicle FSM — derived from transition table */
export const VEHICLE_EDGES: Edge<VehicleState>[] = deriveEdges(VEHICLE_TRANSITIONS)

/** Complete vehicle FSM definition */
export const VEHICLE_FSM: FSMDefinition<VehicleState> = {
  states: VEHICLE_STATE_ENTRIES,
  edges: VEHICLE_EDGES,
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
