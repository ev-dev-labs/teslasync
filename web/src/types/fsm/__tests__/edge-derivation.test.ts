import { describe, it, expect } from 'vitest'
import { deriveEdges } from '../types'
import { FSM_REGISTRY } from '../registry'

const expected: Record<string, number> = {
  vehicle: 29, drive_session: 7, charge_session: 7,
  command: 14, notification: 9, alert_cooldown: 4,
  automation: 18, telemetry_connection: 11,
}

describe('Edge derivation', () => {
  const entries = Object.entries(FSM_REGISTRY).filter(([,f]) => f.transitions)

  it.each(entries)('%s — edge count >= minimum', (name, fsm) => {
    expect(fsm.edges.length).toBeGreaterThanOrEqual(expected[name] ?? 1)
  })

  it.each(entries)('%s — deriveEdges matches exported edges', (name, fsm) => {
    const derived = deriveEdges(fsm.transitions!)
    expect(derived.length).toBe(fsm.edges.length)
  })

  it.each(entries)('%s — no duplicate edges', (name, fsm) => {
    const seen = new Set<string>()
    for (const [f, t] of fsm.edges) {
      const k = `${f}→${t}`
      expect(seen.has(k), `Dup: ${k}`).toBe(false)
      seen.add(k)
    }
  })

  it('deriveEdges deduplicates same from→to', () => {
    const rows = [
      { from: 'a', to: 'b', trigger: 'x', guard: null, timing: 'immediate' as const },
      { from: 'a', to: 'b', trigger: 'y', guard: null, timing: 'immediate' as const },
    ]
    expect(deriveEdges(rows)).toHaveLength(1)
  })
})
