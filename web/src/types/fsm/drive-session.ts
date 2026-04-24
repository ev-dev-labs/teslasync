import type { StateEntry, Edge, FSMDefinition } from './types'

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

export const DRIVE_SESSION_EDGES: Edge<DriveSessionState>[] = [
  ['pending', 'active'],    ['active', 'ending'],     ['ending', 'completed'],
  ['pending', 'recovered'], ['active', 'recovered'],  ['recovered', 'active'],
]

export const DRIVE_SESSION_FSM: FSMDefinition<DriveSessionState> = {
  states: DRIVE_SESSION_STATE_ENTRIES,
  edges: DRIVE_SESSION_EDGES,
}
