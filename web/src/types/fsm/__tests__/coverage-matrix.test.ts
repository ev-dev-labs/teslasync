import { describe, it, expect } from 'vitest'
import { FSM_REGISTRY } from '../registry'

describe('Coverage matrix consistency', () => {
  const entries = Object.entries(FSM_REGISTRY).filter(([,f]) => f.coverage)

  it.each(entries)('%s — diagonal is "self"', (name, fsm) => {
    for (const s of Object.keys(fsm.states))
      expect(fsm.coverage![s]?.[s], `${name}[${s}][${s}]`).toBe('self')
  })

  it.each(entries)('%s — "valid" cells have transition rows', (name, fsm) => {
    for (const from of Object.keys(fsm.states))
      for (const to of Object.keys(fsm.states)) {
        if (from === to) continue
        if (fsm.coverage![from]?.[to] === 'valid')
          expect(fsm.transitions!.some(r => r.from === from && r.to === to),
            `${name}: ${from}→${to} valid but no row`).toBe(true)
      }
  })

  it.each(entries)('%s — "disallowed" cells have NO rows', (name, fsm) => {
    for (const from of Object.keys(fsm.states))
      for (const to of Object.keys(fsm.states)) {
        if (fsm.coverage![from]?.[to] === 'disallowed')
          expect(fsm.transitions!.some(r => r.from === from && r.to === to),
            `${name}: ${from}→${to} disallowed but row exists`).toBe(false)
      }
  })

  it.each(entries)('%s — all state pairs covered', (name, fsm) => {
    for (const from of Object.keys(fsm.states))
      for (const to of Object.keys(fsm.states))
        expect(fsm.coverage![from]?.[to] !== undefined, `${name}[${from}][${to}] undefined`).toBe(true)
  })

  it.each(entries)('%s — every transition row maps to "valid" (or "self" on diagonal)', (name, fsm) => {
    for (const r of fsm.transitions!) {
      const expected = r.from === r.to ? 'self' : 'valid'
      expect(fsm.coverage![r.from]?.[r.to], `${name}: ${r.from}→${r.to}`).toBe(expected)
    }
  })
})
