import { deriveEdges, type StateEntry, type TransitionRow, type FSMDefinition } from './types'

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
