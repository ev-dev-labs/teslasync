import { describe, it, expect } from 'vitest'
import { FSM_REGISTRY } from '../registry'

describe('FSM transition table integrity', () => {
  const entries = Object.entries(FSM_REGISTRY)

  it.each(entries)('%s — from/to are valid states', (name, fsm) => {
    if (!fsm.transitions) return
    const valid = new Set(Object.keys(fsm.states))
    for (const r of fsm.transitions) {
      expect(valid.has(r.from), `${name}: bad from "${r.from}"`).toBe(true)
      expect(valid.has(r.to), `${name}: bad to "${r.to}"`).toBe(true)
    }
  })

  it.each(entries)('%s — no unintended self-loops', (name, fsm) => {
    if (!fsm.transitions) return
    const allowed = new Set(['alert_cooldown'])
    if (allowed.has(name)) return
    for (const r of fsm.transitions) {
      expect(r.from !== r.to, `${name}: self-loop ${r.from}`).toBe(true)
    }
  })

  it.each(entries)('%s — triggers non-empty, timing valid', (name, fsm) => {
    if (!fsm.transitions) return
    for (const r of fsm.transitions) {
      expect(r.trigger.length > 0).toBe(true)
      expect(['immediate', 'debounced']).toContain(r.timing)
    }
  })
})
