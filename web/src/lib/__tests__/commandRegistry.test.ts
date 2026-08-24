import { describe, it, expect } from 'vitest'
import { commandRegistry, scoreCommand } from '../commandRegistry'

describe('scoreCommand', () => {
  it('matches empty/whitespace queries with a positive score (so all items pass)', () => {
    expect(scoreCommand('', 'Battery Health')).toBeGreaterThan(0)
    expect(scoreCommand('   ', 'Battery Health')).toBeGreaterThan(0)
  })

  it('ranks exact match higher than starts-with', () => {
    const exact = scoreCommand('battery', 'Battery')
    const starts = scoreCommand('battery', 'Battery Health')
    expect(exact).toBeGreaterThan(starts)
  })

  it('ranks starts-with higher than substring', () => {
    const starts = scoreCommand('bat', 'Battery Health')
    const sub = scoreCommand('bat', 'Combat Battery')
    expect(starts).toBeGreaterThan(sub)
  })

  it('matches subsequence ("btr" → "Battery Health")', () => {
    const s = scoreCommand('btr', 'Battery Health')
    expect(s).toBeGreaterThan(0)
  })

  it('matches a keyword when the label does not contain the query', () => {
    const s = scoreCommand('honk', 'Sound Horn', ['honk', 'beep', 'horn'])
    expect(s).toBeGreaterThan(0)
  })

  it('returns 0 when there is no plausible match', () => {
    expect(scoreCommand('zxqv', 'Battery Health', [])).toBe(0)
  })

  it('is case-insensitive', () => {
    expect(scoreCommand('BATTERY', 'battery health')).toBeGreaterThan(0)
    expect(scoreCommand('battery', 'BATTERY HEALTH')).toBeGreaterThan(0)
  })

  // Regression: prior to the fix, CommandPalette iterated over [label, ...keywords]
  // and re-called scoreCommand on each keyword as if it were a label. That
  // gave a keyword like "debugger" matching query "d" the full label-startsWith
  // score (501), tying with the actual "Drives" label and pushing unrelated
  // items (State Machine, Theme: Dark) above true label matches. The function
  // itself is correct — keyword matches get capped at 100. This test pins the
  // contract so the caller-side regression cannot recur.
  it('ranks label startsWith higher than keyword startsWith for the same query', () => {
    const labelMatch = scoreCommand('d', 'Drives', ['drive history', 'sessions'])
    const keywordMatch = scoreCommand('d', 'State Machine', ['state machine', 'debugger', 'fsm'])
    expect(labelMatch).toBeGreaterThan(keywordMatch)
  })

  it('caps keyword startsWith at 100 (well below label startsWith tier)', () => {
    const keywordOnly = scoreCommand('fsm', 'State Machine', ['state machine', 'debugger', 'fsm'])
    expect(keywordOnly).toBe(100)
  })
})

describe('commandRegistry', () => {
  it('exposes preference and action commands', () => {
    const sections = new Set(commandRegistry.map(c => c.section))
    expect(sections.has('preferences')).toBe(true)
    expect(sections.has('actions')).toBe(true)
  })

  it('has unique ids', () => {
    const ids = commandRegistry.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every command has a stable id, label key, fallback, icon, and perform()', () => {
    for (const c of commandRegistry) {
      expect(c.id).toBeTruthy()
      expect(c.labelKey).toMatch(/^palette\.cmd\./)
      expect(c.labelFallback.length).toBeGreaterThan(0)
      expect(c.icon).toBeDefined()
      expect(typeof c.perform).toBe('function')
    }
  })

  it('includes the canonical theme/refresh/shortcuts commands', () => {
    const ids = new Set(commandRegistry.map(c => c.id))
    expect(ids.has('pref.theme.dark')).toBe(true)
    expect(ids.has('pref.theme.light')).toBe(true)
    expect(ids.has('action.refresh')).toBe(true)
    expect(ids.has('action.shortcuts')).toBe(true)
  })

  it('includes every workspace range and density command', () => {
    const ids = new Set(commandRegistry.map(c => c.id))
    const workspaceIds = [
      'workspace.range.today',
      'workspace.range.7d',
      'workspace.range.30d',
      'workspace.range.90d',
      'workspace.range.1y',
      'workspace.range.all',
      'workspace.density.compact',
      'workspace.density.comfortable',
      'workspace.density.spacious',
    ]
    for (const id of workspaceIds) {
      expect(ids.has(id)).toBe(true)
    }
  })

  it('includes the primary operational workflow commands', () => {
    const ids = new Set(commandRegistry.map(c => c.id))
    expect(ids.has('action.center')).toBe(true)
    expect(ids.has('action.compare.fleet')).toBe(true)
    expect(ids.has('action.compare.period')).toBe(true)
    expect(
      commandRegistry
        .find(c => c.id === 'action.system.status')
        ?.keywords,
    ).toContain('diagnostics')
  })

  it('the shortcuts command has a "?" shortcut hint', () => {
    const c = commandRegistry.find(c => c.id === 'action.shortcuts')
    expect(c?.shortcut).toBe('?')
  })
})
