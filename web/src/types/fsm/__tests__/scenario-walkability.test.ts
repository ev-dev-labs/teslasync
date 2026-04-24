import { describe, it, expect } from 'vitest'
import { FSM_REGISTRY } from '../registry'

describe('Scenario walkability', () => {
  const entries = Object.entries(FSM_REGISTRY).filter(([,f]) => f.scenarios?.length)

  it.each(entries)('%s — scenarios follow valid edges', (name, fsm) => {
    const edges = new Set(fsm.edges.map(([f,t]) => `${f}→${t}`))
    for (const s of fsm.scenarios!) {
      if (s.transitions.length < 2) continue
      for (let i = 0; i < s.transitions.length - 1; i++) {
        const k = `${s.transitions[i]}→${s.transitions[i+1]}`
        expect(edges.has(k), `${name} ${s.id}: ${k} not valid`).toBe(true)
      }
    }
  })

  it.each(entries)('%s — scenario states are valid', (name, fsm) => {
    const valid = new Set(Object.keys(fsm.states))
    for (const s of fsm.scenarios!)
      for (const st of s.transitions)
        expect(valid.has(st), `${name} ${s.id}: "${st}" invalid`).toBe(true)
  })

  it.each(entries)('%s — unique scenario IDs', (name, fsm) => {
    const ids = fsm.scenarios!.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(entries)('%s — minimum scenario count', (name, fsm) => {
    const min: Record<string, number> = {
      vehicle: 35, drive_session: 10, charge_session: 10,
      alert_cooldown: 5, notification: 5, command: 8,
    }
    if (min[name]) expect(fsm.scenarios!.length).toBeGreaterThanOrEqual(min[name])
  })
})
