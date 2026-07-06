import { deriveEdges, type TransitionRow, type StateEntry, type Edge, type FSMDefinition, type DisallowedTransition, type CoverageMatrix, type Scenario, type ToastMap } from './types'

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

// The six 'disallowed' cells mirror COMMAND_DISALLOWED exactly: they are
// explicitly forbidden (with a documented reason), which is semantically
// distinct from a plain `null` "no transition here". Keeping the two in sync
// lets isValidTransition() report 'disallowed' vs null correctly — matching
// the vehicle FSM convention (VEHICLE_COVERAGE.driving.asleep === 'disallowed').
export const COMMAND_COVERAGE: CoverageMatrix<CommandState> = {
  queued:         { queued: 'self', waking: 'valid', wake_confirmed: null,   wake_timeout: null, sending: 'valid', succeeded: 'disallowed', failed: null, timed_out: null, retrying: null,   gave_up: 'valid' },
  waking:         { queued: null,   waking: 'self',  wake_confirmed: 'valid', wake_timeout: 'valid', sending: null, succeeded: null, failed: null, timed_out: null, retrying: null, gave_up: null },
  wake_confirmed: { queued: null,   waking: null,    wake_confirmed: 'self', wake_timeout: null, sending: 'valid', succeeded: null, failed: null, timed_out: null, retrying: null,   gave_up: null },
  wake_timeout:   { queued: null,   waking: 'valid', wake_confirmed: null,   wake_timeout: 'self', sending: null, succeeded: null, failed: null, timed_out: null, retrying: null,   gave_up: 'valid' },
  sending:        { queued: null,   waking: 'disallowed', wake_confirmed: null,   wake_timeout: null, sending: 'self', succeeded: 'valid', failed: 'valid', timed_out: 'valid', retrying: null, gave_up: null },
  succeeded:      { queued: null,   waking: 'disallowed', wake_confirmed: null,   wake_timeout: null, sending: null,   succeeded: 'self', failed: null, timed_out: null, retrying: 'disallowed', gave_up: null },
  failed:         { queued: null,   waking: null,    wake_confirmed: null,   wake_timeout: null, sending: null,   succeeded: null,   failed: 'self', timed_out: null, retrying: 'valid', gave_up: 'valid' },
  timed_out:      { queued: null,   waking: null,    wake_confirmed: null,   wake_timeout: null, sending: null,   succeeded: null,   failed: null, timed_out: 'self', retrying: 'valid', gave_up: 'valid' },
  retrying:       { queued: null,   waking: null,    wake_confirmed: null,   wake_timeout: null, sending: 'valid', succeeded: null, failed: null, timed_out: null, retrying: 'self',   gave_up: null },
  gave_up:        { queued: null,   waking: 'disallowed', wake_confirmed: null,   wake_timeout: null, sending: null,   succeeded: null,   failed: null, timed_out: null, retrying: 'disallowed', gave_up: 'self' },
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
