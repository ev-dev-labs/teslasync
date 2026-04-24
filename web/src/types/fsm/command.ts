import { deriveEdges, type TransitionRow, type StateEntry, type Edge, type FSMDefinition } from './types'

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

export const COMMAND_FSM: FSMDefinition<CommandState, CommandTrigger> = {
  states: COMMAND_STATE_ENTRIES,
  edges: COMMAND_EDGES,
  transitions: COMMAND_TRANSITIONS,
}
