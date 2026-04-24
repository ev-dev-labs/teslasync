import type { StateEntry, Edge, FSMDefinition } from './types'

export const NOTIFICATION_STATES = [
  'created', 'sending', 'delivered', 'partial', 'failed', 'retrying', 'dead',
] as const

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

export const NOTIFICATION_EDGES: Edge<NotificationState>[] = [
  ['created', 'sending'],  ['sending', 'delivered'], ['sending', 'partial'],
  ['sending', 'failed'],   ['failed', 'retrying'],   ['retrying', 'sending'],
  ['retrying', 'dead'],
]

export const NOTIFICATION_FSM: FSMDefinition<NotificationState> = {
  states: NOTIFICATION_STATE_ENTRIES,
  edges: NOTIFICATION_EDGES,
}
