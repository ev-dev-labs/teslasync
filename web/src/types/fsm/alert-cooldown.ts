import type { StateEntry, Edge, FSMDefinition } from './types'

export const ALERT_COOLDOWN_STATES = ['armed', 'fired', 'suppressed'] as const

export type AlertCooldownState = (typeof ALERT_COOLDOWN_STATES)[number]

export const ALERT_COOLDOWN_STATE_ENTRIES: Record<AlertCooldownState, StateEntry> = {
  armed:      { variant: 'success' },
  fired:      { variant: 'danger' },
  suppressed: { variant: 'warning' },
}

export const ALERT_COOLDOWN_EDGES: Edge<AlertCooldownState>[] = [
  ['armed', 'fired'], ['armed', 'suppressed'], ['fired', 'armed'], ['suppressed', 'armed'],
]

export const ALERT_COOLDOWN_FSM: FSMDefinition<AlertCooldownState> = {
  states: ALERT_COOLDOWN_STATE_ENTRIES,
  edges: ALERT_COOLDOWN_EDGES,
}
