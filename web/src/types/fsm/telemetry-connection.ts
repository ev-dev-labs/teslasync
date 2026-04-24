import type { StateEntry, Edge, FSMDefinition } from './types'

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

export const TELEMETRY_CONNECTION_EDGES: Edge<TelemetryConnectionState>[] = [
  ['unknown', 'connecting'],      ['unknown', 'polling_only'],
  ['connecting', 'streaming'],    ['connecting', 'stale'],        ['connecting', 'disconnected'],
  ['streaming', 'stale'],         ['streaming', 'disconnected'],
  ['stale', 'streaming'],         ['stale', 'disconnected'],
  ['disconnected', 'streaming'],
  ['polling_only', 'streaming'],
]

export const TELEMETRY_CONNECTION_FSM: FSMDefinition<TelemetryConnectionState> = {
  states: TELEMETRY_CONNECTION_STATE_ENTRIES,
  edges: TELEMETRY_CONNECTION_EDGES,
}
