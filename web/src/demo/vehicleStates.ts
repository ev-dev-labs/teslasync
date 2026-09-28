import { charging, drives } from './fixtures'

export interface DemoStateTransition {
  ts: string
  from_state: string
  to_state: string
  trigger_field: string
  trigger_value: string
}

type StateEvent = { vehicle_id: number; at: string; state: string; field: string }

const events: StateEvent[] = [
  ...drives.flatMap(row => [
    { vehicle_id: row.vehicle_id, at: row.start_ts, state: 'driving', field: 'DriveState' },
    { vehicle_id: row.vehicle_id, at: row.end_ts, state: 'parked', field: 'DriveState' },
  ]),
  ...charging.flatMap(row => [
    { vehicle_id: row.vehicle_id, at: row.started_at, state: 'charging', field: 'ChargingState' },
    { vehicle_id: row.vehicle_id, at: row.ended_at, state: 'parked', field: 'ChargingState' },
  ]),
]

export function vehicleStates(vehicleId: number, start: number, end: number, days: number) {
  const vehicleEvents = events
    .filter(event => event.vehicle_id === vehicleId)
    .sort((a, b) => a.at.localeCompare(b.at))
  const transitions: DemoStateTransition[] = vehicleEvents
    .filter(event => Date.parse(event.at) >= start && Date.parse(event.at) < end)
    .map(event => {
      const index = vehicleEvents.indexOf(event)
      const from = index === 0 ? 'parked' : vehicleEvents[index - 1].state
      return {
        ts: event.at, from_state: from, to_state: event.state,
        trigger_field: event.field, trigger_value: event.state,
      }
    })
  const duration = new Map<string, number>()
  const counts = new Map<string, number>()
  if (transitions.length) {
    let state = transitions[0].from_state
    let since = start
    for (const transition of transitions) {
      const at = Date.parse(transition.ts)
      duration.set(state, (duration.get(state) ?? 0) + (at - since) / 1000)
      counts.set(transition.to_state, (counts.get(transition.to_state) ?? 0) + 1)
      since = at
      state = transition.to_state
    }
    duration.set(state, (duration.get(state) ?? 0) + (end - since) / 1000)
  }
  const totalSeconds = [...duration.values()].reduce((sum, value) => sum + value, 0)
  return {
    timeline: {
      vehicle_id: vehicleId, days, start: new Date(start).toISOString(),
      end: new Date(end).toISOString(), transitions,
    },
    summary: {
      vehicle_id: vehicleId, days, start: new Date(start).toISOString(),
      end: new Date(end).toISOString(), total_seconds: totalSeconds,
      by_state: [...duration].filter(([, seconds]) => seconds > 0)
        .sort(([a, sa], [b, sb]) => sb - sa || a.localeCompare(b))
        .map(([state, seconds]) => ({
          state, total_seconds: seconds,
          percentage: totalSeconds ? seconds / totalSeconds * 100 : 0,
          transition_count: counts.get(state) ?? 0,
        })),
    },
  }
}
