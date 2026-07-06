// Behavioural coverage for the FSM registry barrel (`../registry`).
//
// This module is pure data + two lookup helpers — no React, no network — so
// the suite exercises it directly with Vitest (mirroring the sibling
// __tests__/*.test.ts files). It pins every export's contract:
//   - FSM_REGISTRY   — the assembled map (identity + shape),
//   - FSM_STATES     — per-FSM state-name arrays mirror each FSM's states,
//   - FSM_EDGES      — per-FSM edges are re-exported by reference,
//   - STATE_COLORS   — theme + per-state overrides projected to StateStyle,
//   - getStateColor  — case-insensitive, override-aware, null-safe lookup,
//   - getStateDefinition — same, but keeps the `variant` discriminant.
//
// The colour values are asserted against the theme (VARIANT_THEME /
// DEFAULT_STATE) rather than hard-coded strings wherever possible, so a
// deliberate theme change updates in one place instead of breaking here.

import { describe, it, expect } from 'vitest'

import {
  FSM_REGISTRY,
  FSM_STATES,
  FSM_EDGES,
  STATE_COLORS,
  getStateColor,
  getStateDefinition,
} from '../registry'
import { DEFAULT_STATE, VARIANT_THEME } from '../theme'
import { VEHICLE_FSM, VEHICLE_STATES } from '../vehicle'
import { CHARGE_SESSION_FSM } from '../charge-session'
import type { StateStyle } from '../types'

/** The eight FSM types the registry is expected to assemble, in order. */
const FSM_KEYS = [
  'vehicle',
  'drive_session',
  'charge_session',
  'command',
  'notification',
  'alert_cooldown',
  'automation',
  'telemetry_connection',
] as const

const STYLE_KEYS: (keyof StateStyle)[] = ['badgeDot', 'bg', 'text', 'dot']

/** Drop the `variant` discriminant — the shape getStateColor/STATE_COLORS use. */
const pickStyle = (s: StateStyle & { variant?: unknown }): StateStyle => ({
  badgeDot: s.badgeDot,
  bg: s.bg,
  text: s.text,
  dot: s.dot,
})

const sorted = (xs: readonly string[]) => [...xs].sort()

describe('FSM_REGISTRY', () => {
  it('assembles exactly the eight expected FSM types', () => {
    expect(sorted(Object.keys(FSM_REGISTRY))).toEqual(sorted(FSM_KEYS))
  })

  it('wires each key to its source FSM definition by reference', () => {
    // Proves the barrel re-exports the real objects (not clones), so the
    // registry and the individual FSM files can never silently diverge.
    expect(FSM_REGISTRY.vehicle).toBe(VEHICLE_FSM)
    expect(FSM_REGISTRY.charge_session).toBe(CHARGE_SESSION_FSM)
  })

  it.each(FSM_KEYS)('%s — exposes a non-empty states map and an edges array', (key) => {
    const def = FSM_REGISTRY[key]
    expect(Object.keys(def.states).length).toBeGreaterThan(0)
    expect(Array.isArray(def.edges)).toBe(true)
  })
})

describe('FSM_STATES', () => {
  it('has one state-name array per registry key', () => {
    expect(sorted(Object.keys(FSM_STATES))).toEqual(sorted(FSM_KEYS))
  })

  it('re-exports the vehicle state tuple by reference', () => {
    expect(FSM_STATES.vehicle).toBe(VEHICLE_STATES)
  })

  it.each(FSM_KEYS)('%s — state names mirror the FSM states map', (key) => {
    const names = FSM_STATES[key]
    expect(names.length).toBeGreaterThan(0)
    // Same set of names as the authoritative states map (order aside).
    expect(sorted(names)).toEqual(sorted(Object.keys(FSM_REGISTRY[key].states)))
  })
})

describe('FSM_EDGES', () => {
  it('has one edge list per registry key', () => {
    expect(sorted(Object.keys(FSM_EDGES))).toEqual(sorted(FSM_KEYS))
  })

  it.each(FSM_KEYS)('%s — re-exports the FSM edges by reference', (key) => {
    expect(FSM_EDGES[key]).toBe(FSM_REGISTRY[key].edges)
  })

  it('every edge is a [from, to] pair of strings', () => {
    for (const [from, to] of FSM_EDGES.vehicle) {
      expect(typeof from).toBe('string')
      expect(typeof to).toBe('string')
    }
    expect(FSM_EDGES.vehicle.length).toBe(VEHICLE_FSM.edges.length)
  })
})

describe('STATE_COLORS', () => {
  it.each(FSM_KEYS)('%s — one colour entry per state, projected to StateStyle', (key) => {
    const colors = STATE_COLORS[key]
    expect(sorted(Object.keys(colors))).toEqual(sorted(Object.keys(FSM_REGISTRY[key].states)))
    for (const style of Object.values(colors)) {
      // Only the four StateStyle keys — the `variant` discriminant is dropped.
      expect(sorted(Object.keys(style))).toEqual(sorted(STYLE_KEYS))
    }
  })

  it('resolves a plain (no-override) state straight from the variant theme', () => {
    // command.succeeded = success variant with no override.
    expect(STATE_COLORS.command.succeeded).toEqual(VARIANT_THEME.success)
  })

  it('applies per-state overrides on top of the variant theme', () => {
    // vehicle.parked = info variant but overridden to a purple tint.
    expect(STATE_COLORS.vehicle.parked.bg).toBe('bg-purple-500/10')
    expect(STATE_COLORS.vehicle.parked.text).toBe('text-purple-400')
    // vehicle.asleep = neutral variant, overriding ONLY the badge dot.
    expect(STATE_COLORS.vehicle.asleep.badgeDot).toBe('bg-purple-500')
    expect(STATE_COLORS.vehicle.asleep.text).toBe(VARIANT_THEME.neutral.text)
  })
})

describe('getStateColor', () => {
  it('resolves a known state to its themed StateStyle (no variant key)', () => {
    const online = getStateColor('vehicle', 'online')
    expect(online).toEqual(VARIANT_THEME.success)
    expect('variant' in online).toBe(false)
  })

  it('agrees with the precomputed STATE_COLORS map for known states', () => {
    expect(getStateColor('vehicle', 'driving')).toEqual(STATE_COLORS.vehicle.driving)
    expect(getStateColor('charge_session', 'active')).toEqual(STATE_COLORS.charge_session.active)
  })

  it('honours per-state overrides (charge_session.active → cyan)', () => {
    const active = getStateColor('charge_session', 'active')
    expect(active.bg).toBe('bg-cyan-500/10')
    expect(active.text).toBe('text-cyan-400')
    expect(active.dot).toBe('bg-cyan-400')
  })

  it('matches the state name case-insensitively', () => {
    expect(getStateColor('vehicle', 'DRIVING')).toEqual(getStateColor('vehicle', 'driving'))
    expect(getStateColor('vehicle', 'Driving').text).toBe('text-green-400')
  })

  it('falls back to the neutral default for an unknown state', () => {
    expect(getStateColor('vehicle', 'teleporting')).toEqual(pickStyle(DEFAULT_STATE))
  })

  it('falls back to the vehicle FSM when the fsmType is unknown', () => {
    // Unknown type → vehicle registry, so a vehicle state still resolves…
    expect(getStateColor('not-a-real-fsm', 'driving')).toEqual(getStateColor('vehicle', 'driving'))
    // …but a name absent from the vehicle FSM still degrades to the default.
    expect(getStateColor('not-a-real-fsm', 'succeeded')).toEqual(pickStyle(DEFAULT_STATE))
  })

  it('is null-safe: nullish or non-string state returns the default, never throws', () => {
    expect(() => getStateColor('vehicle', undefined)).not.toThrow()
    expect(getStateColor('vehicle', undefined)).toEqual(pickStyle(DEFAULT_STATE))
    expect(getStateColor('vehicle', null)).toEqual(pickStyle(DEFAULT_STATE))
    // A non-string sneaking past the types must not crash on .toLowerCase().
    expect(getStateColor('vehicle', 123 as unknown as string)).toEqual(pickStyle(DEFAULT_STATE))
  })
})

describe('getStateDefinition', () => {
  it('returns the full resolved style including the variant discriminant', () => {
    const online = getStateDefinition('vehicle', 'online')
    expect(online.variant).toBe('success')
    expect(online).toEqual({ variant: 'success', ...VARIANT_THEME.success })
  })

  it('keeps the variant even when a per-state override changes the colours', () => {
    // vehicle.driving stays the success variant but overrides the badge dot.
    const driving = getStateDefinition('vehicle', 'driving')
    expect(driving.variant).toBe('success')
    expect(driving.badgeDot).toBe('bg-blue-500')
    expect(driving.bg).toBe('bg-green-500/10')
  })

  it('resolves distinct variants across FSMs (command.failed → danger)', () => {
    expect(getStateDefinition('command', 'failed').variant).toBe('danger')
    expect(getStateDefinition('telemetry_connection', 'streaming').variant).toBe('success')
  })

  it('returns the neutral DEFAULT_STATE for unknown states and is null-safe', () => {
    expect(getStateDefinition('vehicle', 'teleporting')).toEqual(DEFAULT_STATE)
    expect(() => getStateDefinition('vehicle', undefined)).not.toThrow()
    expect(getStateDefinition('vehicle', undefined)).toEqual(DEFAULT_STATE)
    expect(getStateDefinition('vehicle', null).variant).toBe('neutral')
  })
})

describe('getStateColor ⇔ getStateDefinition consistency', () => {
  it.each([
    ['vehicle', 'online'],
    ['vehicle', 'parked'],
    ['vehicle', 'unknown-state'],
    ['charge_session', 'active'],
    ['command', 'succeeded'],
    ['automation', 'idle'],
  ] as const)('%s/%s — getStateColor is the variant-stripped definition', (fsmType, state) => {
    expect(getStateColor(fsmType, state)).toEqual(pickStyle(getStateDefinition(fsmType, state)))
  })
})
