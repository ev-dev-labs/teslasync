import { describe, it, expect } from 'vitest'
import { FSM_REGISTRY } from '../registry'

describe('Disallowed enforcement', () => {
  const entries = Object.entries(FSM_REGISTRY).filter(([,f]) => f.disallowed?.length)

  it.each(entries)('%s — no transition rows for disallowed pairs', (name, fsm) => {
    for (const d of fsm.disallowed!)
      expect(fsm.transitions!.some(r => r.from === d.from && r.to === d.to),
        `${name}: ${d.from}→${d.to} disallowed but row exists`).toBe(false)
  })

  it.each(entries)('%s — no edges for disallowed pairs', (name, fsm) => {
    for (const d of fsm.disallowed!)
      expect(fsm.edges.some(([f,t]) => f === d.from && t === d.to),
        `${name}: ${d.from}→${d.to} disallowed but edge exists`).toBe(false)
  })

  it.each(entries)('%s — disallowed refs valid states', (name, fsm) => {
    const valid = new Set(Object.keys(fsm.states))
    for (const d of fsm.disallowed!) {
      expect(valid.has(d.from), `${d.from}`).toBe(true)
      expect(valid.has(d.to), `${d.to}`).toBe(true)
    }
  })

  it.each(entries)('%s — reasons non-empty', (name, fsm) => {
    for (const d of fsm.disallowed!)
      expect(d.reason.length > 0).toBe(true)
  })

  it('6 reference-doc FSMs have disallowed lists', () => {
    for (const n of ['vehicle','drive_session','charge_session','command','notification','alert_cooldown'])
      expect(FSM_REGISTRY[n as keyof typeof FSM_REGISTRY]?.disallowed?.length).toBeGreaterThan(0)
  })
})
