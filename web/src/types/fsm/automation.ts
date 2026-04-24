import type { StateEntry, Edge, FSMDefinition } from './types'

export const AUTOMATION_STATES = [
  'idle', 'evaluating', 'executing', 'succeeded', 'partial',
  'failed', 'retrying', 'gave_up', 'skipped', 'cooldown', 'disabled',
] as const

export type AutomationState = (typeof AUTOMATION_STATES)[number]

export const AUTOMATION_STATE_ENTRIES: Record<AutomationState, StateEntry> = {
  idle:       { variant: 'neutral', overrides: { text: 'text-white/50' } },
  evaluating: { variant: 'info',    overrides: { badgeDot: 'bg-cyan-400', bg: 'bg-cyan-500/10', text: 'text-cyan-400', dot: 'bg-cyan-400' } },
  executing:  { variant: 'warning' },
  succeeded:  { variant: 'success' },
  partial:    { variant: 'warning' },
  failed:     { variant: 'danger' },
  retrying:   { variant: 'warning' },
  gave_up:    { variant: 'danger',  overrides: { badgeDot: 'bg-red-500', bg: 'bg-red-600/10', text: 'text-red-500', dot: 'bg-red-500' } },
  skipped:    { variant: 'neutral', overrides: { badgeDot: 'bg-gray-500', bg: 'bg-gray-600/10', text: 'text-white/30', dot: 'bg-gray-500' } },
  cooldown:   { variant: 'neutral', overrides: { badgeDot: 'bg-purple-400', bg: 'bg-purple-500/10', text: 'text-purple-400', dot: 'bg-purple-400' } },
  disabled:   { variant: 'danger',  overrides: { badgeDot: 'bg-red-400/50', bg: 'bg-red-500/5', text: 'text-red-400/50', dot: 'bg-red-400/50' } },
}

export const AUTOMATION_EDGES: Edge<AutomationState>[] = [
  ['idle', 'evaluating'],
  ['evaluating', 'executing'],  ['evaluating', 'skipped'],
  ['executing', 'succeeded'],   ['executing', 'partial'],    ['executing', 'failed'],
  ['failed', 'retrying'],
  ['retrying', 'executing'],    ['retrying', 'gave_up'],
  ['succeeded', 'cooldown'],    ['succeeded', 'idle'],
  ['partial', 'cooldown'],      ['partial', 'idle'],
  ['gave_up', 'idle'],          ['gave_up', 'disabled'],
  ['skipped', 'idle'],
  ['cooldown', 'idle'],
  ['disabled', 'idle'],
]

export const AUTOMATION_FSM: FSMDefinition<AutomationState> = {
  states: AUTOMATION_STATE_ENTRIES,
  edges: AUTOMATION_EDGES,
}
