import type { StateEntry, Edge, FSMDefinition } from './types'

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

export const CHARGE_SESSION_EDGES: Edge<ChargeSessionState>[] = [
  ['pending', 'active'],    ['active', 'completing'], ['completing', 'done'],
  ['pending', 'recovered'], ['active', 'recovered'],  ['recovered', 'active'],
  ['active', 'done'],
]

export const CHARGE_SESSION_FSM: FSMDefinition<ChargeSessionState> = {
  states: CHARGE_SESSION_STATE_ENTRIES,
  edges: CHARGE_SESSION_EDGES,
}
