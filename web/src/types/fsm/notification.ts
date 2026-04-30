import type { StateEntry, Edge, FSMDefinition, TransitionRow, DisallowedTransition, CoverageMatrix, Scenario } from './types'
import { deriveEdges } from './types'

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
