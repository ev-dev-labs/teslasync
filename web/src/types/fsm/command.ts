import type { StateEntry, Edge, FSMDefinition } from './types'

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

export const COMMAND_EDGES: Edge<CommandState>[] = [
  ['queued', 'waking'],           ['waking', 'wake_confirmed'],  ['waking', 'wake_timeout'],
  ['wake_confirmed', 'sending'],  ['wake_timeout', 'retrying'],
  ['sending', 'succeeded'],       ['sending', 'failed'],         ['sending', 'timed_out'],
  ['failed', 'retrying'],         ['timed_out', 'retrying'],
  ['retrying', 'waking'],         ['retrying', 'gave_up'],
]

export const COMMAND_FSM: FSMDefinition<CommandState> = {
  states: COMMAND_STATE_ENTRIES,
  edges: COMMAND_EDGES,
}
