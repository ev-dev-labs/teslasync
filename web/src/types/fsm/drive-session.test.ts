import { describe, it, expect } from 'vitest'
import {
  DRIVE_SESSION_STATES,
  DRIVE_SESSION_STATE_ENTRIES,
  DRIVE_SESSION_TRIGGERS,
  DRIVE_SESSION_GUARDS,
  DRIVE_SESSION_TRANSITIONS,
  DRIVE_SESSION_EDGES,
  DRIVE_SESSION_DISALLOWED,
  DRIVE_VALIDATION_RULES,
  DRIVE_SESSION_COVERAGE,
  DRIVE_SESSION_SCENARIOS,
  DRIVE_SESSION_FSM,
  type DriveSessionState,
  type DriveSessionTrigger,
  type DriveSessionGuard,
  type DriveSignalContext,
} from './drive-session'
import { deriveEdges, isValidTransition, type BadgeVariant } from './types'
import { FSM_REGISTRY } from './registry'

// The frontend Drive-Session FSM is a faithful mirror of the Go backend
// (`internal/fsm/drive/state.go` + `machine.go`). These tests assert that
// invariant plus every internal consistency rule the FSM_REGISTRY relies on.

const STATE_SET = new Set<string>(DRIVE_SESSION_STATES)
const TRIGGER_SET = new Set<string>(DRIVE_SESSION_TRIGGERS)
const GUARD_SET = new Set<string>(DRIVE_SESSION_GUARDS)
const VALID_VARIANTS: BadgeVariant[] = ['success', 'warning', 'danger', 'info', 'neutral']
const STYLE_KEYS = ['badgeDot', 'bg', 'text', 'dot']
const edgeKey = (f: string, t: string) => `${f}\u2192${t}`
const EDGE_SET = new Set(DRIVE_SESSION_EDGES.map(([f, t]) => edgeKey(f, t)))

describe('DRIVE_SESSION_STATES', () => {
  it('is the canonical 5-state lifecycle in order', () => {
    expect(DRIVE_SESSION_STATES).toEqual(['pending', 'active', 'ending', 'completed', 'recovered'])
  })

  it('has unique lowercase state names', () => {
    expect(new Set(DRIVE_SESSION_STATES).size).toBe(DRIVE_SESSION_STATES.length)
    for (const s of DRIVE_SESSION_STATES) expect(s).toBe(s.toLowerCase())
  })
})

describe('DRIVE_SESSION_STATE_ENTRIES', () => {
  it('has exactly one entry per declared state', () => {
    expect(Object.keys(DRIVE_SESSION_STATE_ENTRIES).sort()).toEqual([...DRIVE_SESSION_STATES].sort())
  })

  it('every entry uses a known badge variant', () => {
    for (const [state, entry] of Object.entries(DRIVE_SESSION_STATE_ENTRIES))
      expect(VALID_VARIANTS, state).toContain(entry.variant)
  })

  it('themed states (pending/active) rely on variant defaults — no overrides', () => {
    expect(DRIVE_SESSION_STATE_ENTRIES.pending.variant).toBe('warning')
    expect(DRIVE_SESSION_STATE_ENTRIES.pending.overrides).toBeUndefined()
    expect(DRIVE_SESSION_STATE_ENTRIES.active.variant).toBe('success')
    expect(DRIVE_SESSION_STATE_ENTRIES.active.overrides).toBeUndefined()
  })

  it('custom-tinted states declare overrides limited to known style keys', () => {
    for (const key of ['ending', 'completed', 'recovered'] as const) {
      const ov = DRIVE_SESSION_STATE_ENTRIES[key].overrides
      expect(ov, key).toBeDefined()
      for (const k of Object.keys(ov ?? {})) expect(STYLE_KEYS, `${key}.${k}`).toContain(k)
    }
    expect(DRIVE_SESSION_STATE_ENTRIES.ending.overrides?.dot).toBe('bg-orange-400')
    expect(DRIVE_SESSION_STATE_ENTRIES.completed.overrides?.text).toBe('text-indigo-400')
    expect(DRIVE_SESSION_STATE_ENTRIES.recovered.overrides?.bg).toBe('bg-purple-500/10')
  })
})

describe('DRIVE_SESSION_TRIGGERS', () => {
  it('mirrors the 7 backend drive.Trigger events', () => {
    expect([...DRIVE_SESSION_TRIGGERS].sort()).toEqual([
      'drive_ending',
      'end_snapshot_ready',
      'end_snapshot_timeout',
      'pod_restart',
      'signals_flowing',
      'start_snapshot_ready',
      'start_snapshot_timeout',
    ])
  })

  it('has unique, non-empty names', () => {
    expect(new Set(DRIVE_SESSION_TRIGGERS).size).toBe(DRIVE_SESSION_TRIGGERS.length)
    for (const t of DRIVE_SESSION_TRIGGERS) expect(t.length).toBeGreaterThan(0)
  })

  it('models BOTH snapshot timeouts — start and end (regression: start side was missing)', () => {
    expect(DRIVE_SESSION_TRIGGERS).toContain('start_snapshot_timeout')
    expect(DRIVE_SESSION_TRIGGERS).toContain('end_snapshot_timeout')
  })
})

describe('DRIVE_SESSION_GUARDS', () => {
  it('declares the start + end required-field guards', () => {
    expect([...DRIVE_SESSION_GUARDS]).toEqual(['has_required_start_fields', 'has_required_end_fields'])
    expect(new Set(DRIVE_SESSION_GUARDS).size).toBe(DRIVE_SESSION_GUARDS.length)
  })
})

describe('DriveSignalContext', () => {
  it('describes a fully-numeric start/end snapshot with 8 fields', () => {
    const ctx: DriveSignalContext = {
      startOdometer: 1000,
      startBattery: 80,
      startLatitude: 37.7749,
      startLongitude: -122.4194,
      endOdometer: 1042,
      endBattery: 71,
      endLatitude: 37.8044,
      endLongitude: -122.2712,
    }
    expect(Object.keys(ctx)).toHaveLength(8)
    expect(ctx.endOdometer).toBeGreaterThan(ctx.startOdometer)
    expect(Object.values(ctx).every((v) => typeof v === 'number')).toBe(true)
  })
})

describe('exported unions', () => {
  it('cover the canonical trigger / guard / state members', () => {
    const trigger: DriveSessionTrigger = 'start_snapshot_timeout'
    const guard: DriveSessionGuard = 'has_required_end_fields'
    const state: DriveSessionState = 'recovered'
    expect(DRIVE_SESSION_TRIGGERS).toContain(trigger)
    expect(DRIVE_SESSION_GUARDS).toContain(guard)
    expect(DRIVE_SESSION_STATES).toContain(state)
  })
})

describe('DRIVE_SESSION_TRANSITIONS', () => {
  it('reference only declared states, triggers and guards, all immediate', () => {
    for (const r of DRIVE_SESSION_TRANSITIONS) {
      expect(STATE_SET.has(r.from), `from ${r.from}`).toBe(true)
      expect(STATE_SET.has(r.to), `to ${r.to}`).toBe(true)
      expect(TRIGGER_SET.has(r.trigger), `trigger ${r.trigger}`).toBe(true)
      expect(r.guard === null || GUARD_SET.has(r.guard), `guard ${r.guard}`).toBe(true)
      expect(r.timing).toBe('immediate')
    }
  })

  it('contains no self-loops', () => {
    for (const r of DRIVE_SESSION_TRANSITIONS) expect(r.from).not.toBe(r.to)
  })

  it('models the start-side timeout fallback as an unguarded pending→active row', () => {
    const row = DRIVE_SESSION_TRANSITIONS.find((r) => r.trigger === 'start_snapshot_timeout')
    expect(row).toBeDefined()
    expect(row?.from).toBe('pending')
    expect(row?.to).toBe('active')
    expect(row?.guard).toBeNull()
  })

  it('keeps ready-vs-timeout symmetry on both snapshot boundaries', () => {
    const startPaths = DRIVE_SESSION_TRANSITIONS
      .filter((r) => r.from === 'pending' && r.to === 'active')
      .map((r) => r.trigger)
    expect(startPaths).toEqual(expect.arrayContaining(['start_snapshot_ready', 'start_snapshot_timeout']))

    const endPaths = DRIVE_SESSION_TRANSITIONS
      .filter((r) => r.from === 'ending' && r.to === 'completed')
      .map((r) => r.trigger)
    expect(endPaths).toEqual(expect.arrayContaining(['end_snapshot_ready', 'end_snapshot_timeout']))
  })

  it('guards each "ready" snapshot row with its matching field guard', () => {
    const startReady = DRIVE_SESSION_TRANSITIONS.find((r) => r.trigger === 'start_snapshot_ready')
    const endReady = DRIVE_SESSION_TRANSITIONS.find((r) => r.trigger === 'end_snapshot_ready')
    expect(startReady?.guard).toBe('has_required_start_fields')
    expect(endReady?.guard).toBe('has_required_end_fields')
  })
})

describe('DRIVE_SESSION_EDGES', () => {
  it('equals deriveEdges(transitions) and dedups duplicate paths to 7 edges', () => {
    expect(DRIVE_SESSION_EDGES).toEqual(deriveEdges(DRIVE_SESSION_TRANSITIONS))
    expect(DRIVE_SESSION_EDGES).toHaveLength(7)
    expect(DRIVE_SESSION_EDGES.filter(([f, t]) => f === 'pending' && t === 'active')).toHaveLength(1)
    expect(DRIVE_SESSION_EDGES.filter(([f, t]) => f === 'ending' && t === 'completed')).toHaveLength(1)
  })

  it('contains no duplicate edges and only valid endpoints', () => {
    const seen = new Set<string>()
    for (const [f, t] of DRIVE_SESSION_EDGES) {
      const k = edgeKey(f, t)
      expect(seen.has(k), `dup ${k}`).toBe(false)
      seen.add(k)
      expect(STATE_SET.has(f) && STATE_SET.has(t), k).toBe(true)
    }
  })
})

describe('DRIVE_SESSION_DISALLOWED', () => {
  it('lists 6 forward-only / terminal guards, each with a reason', () => {
    expect(DRIVE_SESSION_DISALLOWED).toHaveLength(6)
    for (const d of DRIVE_SESSION_DISALLOWED) {
      expect(STATE_SET.has(d.from) && STATE_SET.has(d.to), edgeKey(d.from, d.to)).toBe(true)
      expect(d.reason.length).toBeGreaterThan(0)
    }
  })

  it('has no transition row and no edge for any disallowed pair', () => {
    for (const d of DRIVE_SESSION_DISALLOWED) {
      expect(
        DRIVE_SESSION_TRANSITIONS.some((r) => r.from === d.from && r.to === d.to),
        edgeKey(d.from, d.to),
      ).toBe(false)
      expect(EDGE_SET.has(edgeKey(d.from, d.to)), edgeKey(d.from, d.to)).toBe(false)
    }
  })

  it('marks every disallowed pair null in the coverage matrix (project convention)', () => {
    for (const d of DRIVE_SESSION_DISALLOWED)
      expect(isValidTransition(DRIVE_SESSION_COVERAGE, d.from, d.to), edgeKey(d.from, d.to)).toBeNull()
  })

  it('treats completed as terminal — every outgoing pair is disallowed', () => {
    const fromCompleted = DRIVE_SESSION_DISALLOWED.filter((d) => d.from === 'completed').map((d) => d.to).sort()
    expect(fromCompleted).toEqual(['active', 'ending', 'pending', 'recovered'])
  })
})

describe('DRIVE_VALIDATION_RULES (mirror of backend drive.Validate)', () => {
  it('matches the backend sanity thresholds', () => {
    expect(DRIVE_VALIDATION_RULES.distanceMin).toBe(0)
    expect(DRIVE_VALIDATION_RULES.distanceMaxMi).toBe(500)
    expect(DRIVE_VALIDATION_RULES.durationMinSec).toBe(30)
    expect(DRIVE_VALIDATION_RULES.netEnergyMin).toBe(0)
    expect(DRIVE_VALIDATION_RULES.endBatteryMaxDelta).toBe(2)
    expect(DRIVE_VALIDATION_RULES.efficiencyRangeWhPerMi).toEqual([100, 600])
  })

  it('exposes efficiency as a positive ascending window', () => {
    const [lo, hi] = DRIVE_VALIDATION_RULES.efficiencyRangeWhPerMi
    expect(lo).toBeGreaterThan(0)
    expect(hi).toBeGreaterThan(lo)
  })
})

describe('DRIVE_SESSION_COVERAGE', () => {
  it('has "self" on the diagonal', () => {
    for (const s of DRIVE_SESSION_STATES) expect(DRIVE_SESSION_COVERAGE[s][s], s).toBe('self')
  })

  it('defines every state pair (no undefined cells)', () => {
    for (const from of DRIVE_SESSION_STATES)
      for (const to of DRIVE_SESSION_STATES)
        expect(DRIVE_SESSION_COVERAGE[from][to], edgeKey(from, to)).not.toBeUndefined()
  })

  it('backs every "valid" cell with a transition row', () => {
    for (const from of DRIVE_SESSION_STATES)
      for (const to of DRIVE_SESSION_STATES) {
        if (from === to) continue
        if (DRIVE_SESSION_COVERAGE[from][to] === 'valid')
          expect(
            DRIVE_SESSION_TRANSITIONS.some((r) => r.from === from && r.to === to),
            edgeKey(from, to),
          ).toBe(true)
      }
  })

  it('maps every transition row to a "valid" cell', () => {
    for (const r of DRIVE_SESSION_TRANSITIONS)
      expect(DRIVE_SESSION_COVERAGE[r.from][r.to], edgeKey(r.from, r.to)).toBe('valid')
  })

  it('isValidTransition resolves valid / self / null correctly', () => {
    expect(isValidTransition(DRIVE_SESSION_COVERAGE, 'pending', 'active')).toBe('valid')
    expect(isValidTransition(DRIVE_SESSION_COVERAGE, 'pending', 'pending')).toBe('self')
    expect(isValidTransition(DRIVE_SESSION_COVERAGE, 'completed', 'active')).toBeNull()
    expect(isValidTransition(DRIVE_SESSION_COVERAGE, 'pending', 'ending')).toBeNull()
  })
})

describe('DRIVE_SESSION_SCENARIOS', () => {
  it('has at least 10 uniquely-identified scenarios with descriptions', () => {
    expect(DRIVE_SESSION_SCENARIOS.length).toBeGreaterThanOrEqual(10)
    const ids = DRIVE_SESSION_SCENARIOS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of DRIVE_SESSION_SCENARIOS) expect(s.description.length).toBeGreaterThan(0)
  })

  it('only references valid states', () => {
    for (const s of DRIVE_SESSION_SCENARIOS)
      for (const st of s.transitions) expect(STATE_SET.has(st), `${s.id}: ${st}`).toBe(true)
  })

  it('is walkable — every consecutive step is a real edge', () => {
    for (const s of DRIVE_SESSION_SCENARIOS)
      for (let i = 0; i < s.transitions.length - 1; i++)
        expect(EDGE_SET.has(edgeKey(s.transitions[i], s.transitions[i + 1])), s.id).toBe(true)
  })

  it('D1 is the canonical happy-path drive', () => {
    const d1 = DRIVE_SESSION_SCENARIOS.find((s) => s.id === 'D1')
    expect(d1?.transitions).toEqual(['pending', 'active', 'ending', 'completed'])
  })
})

describe('DRIVE_SESSION_FSM assembly', () => {
  it('bundles the exact exported tables by reference', () => {
    expect(DRIVE_SESSION_FSM.states).toBe(DRIVE_SESSION_STATE_ENTRIES)
    expect(DRIVE_SESSION_FSM.edges).toBe(DRIVE_SESSION_EDGES)
    expect(DRIVE_SESSION_FSM.transitions).toBe(DRIVE_SESSION_TRANSITIONS)
    expect(DRIVE_SESSION_FSM.disallowed).toBe(DRIVE_SESSION_DISALLOWED)
    expect(DRIVE_SESSION_FSM.coverage).toBe(DRIVE_SESSION_COVERAGE)
    expect(DRIVE_SESSION_FSM.scenarios).toBe(DRIVE_SESSION_SCENARIOS)
  })

  it('is registered under drive_session in FSM_REGISTRY', () => {
    expect(FSM_REGISTRY.drive_session).toBe(DRIVE_SESSION_FSM)
  })
})
