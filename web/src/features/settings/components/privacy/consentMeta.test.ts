/**
 * describeConsent — cookie-consent display-metadata resolver.
 *
 * describeConsent() is the single source of truth that keeps the Privacy page's
 * KPI card, status pill, and consent control panel in lock-step for a given
 * ConsentState. These tests pin down every facet of that contract:
 *   1. the exact presentation (detail / short / color / dot) for each of the
 *      three real states;
 *   2. that the caller-supplied translator is invoked with the right key +
 *      English default and that its return value is passed through verbatim;
 *   3. the defensive `default` branch — an unrecognised state collapses onto the
 *      neutral "unknown" presentation instead of throwing;
 *   4. the blank-safety guard — a translator that returns '' / null / undefined
 *      still yields the English default so the status is never rendered blank;
 *   5. the structural contract every result must satisfy (valid NeonColor,
 *      non-empty `bg-*` dot, colour is never the only signal) and purity.
 *
 * describeConsent takes its translator as a parameter, so no react-i18next /
 * network mocking is needed — a spyable fake `t` exercises every branch.
 */
import { describe, it, expect, vi } from 'vitest'

import { describeConsent, type ConsentPresentation } from './consentMeta'
import type { ConsentState } from '@/lib/cookieConsent'
import type { NeonColor } from '@/lib/tokens'

/** Production happy path: a translator that echoes the English default. */
const passthrough = (_key: string, defaultValue: string) => defaultValue

/** The full NeonColor union mirrored at runtime for membership assertions. */
const NEON_COLORS: NeonColor[] = ['cyan', 'green', 'red', 'purple', 'amber', 'blue']

/** The three real ConsentState values (the `unknown` schema is materialised by absence). */
const REAL_STATES: ConsentState[] = ['accepted', 'declined', 'unknown']

describe('describeConsent — per-state presentation', () => {
  it('maps "accepted" to the green, reporting-on presentation', () => {
    const cp = describeConsent('accepted', passthrough)
    expect(cp.detail).toBe('Accepted — performance & error reporting on')
    expect(cp.short).toBe('Accepted')
    expect(cp.color).toBe('green')
    expect(cp.dot).toBe('bg-emerald-400')
  })

  it('maps "declined" to the amber, essential-only presentation', () => {
    const cp = describeConsent('declined', passthrough)
    expect(cp.detail).toBe('Declined — only essential storage in use')
    expect(cp.short).toBe('Declined')
    expect(cp.color).toBe('amber')
    expect(cp.dot).toBe('bg-amber-400')
  })

  it('maps "unknown" to the neutral, not-decided presentation', () => {
    const cp = describeConsent('unknown', passthrough)
    expect(cp.detail).toBe('Not decided — banner will appear on next visit')
    expect(cp.short).toBe('Not decided')
    expect(cp.color).toBe('blue')
    // A neutral slate dot, NOT bg-blue-*: "not decided" must read as neutral,
    // not as an informational/positive state.
    expect(cp.dot).toBe('bg-slate-400')
  })

  it('gives every state a distinct short label, detail and dot', () => {
    const results = REAL_STATES.map((s) => describeConsent(s, passthrough))
    expect(new Set(results.map((r) => r.short)).size).toBe(REAL_STATES.length)
    expect(new Set(results.map((r) => r.detail)).size).toBe(REAL_STATES.length)
    expect(new Set(results.map((r) => r.dot)).size).toBe(REAL_STATES.length)
  })
})

describe('describeConsent — translator contract', () => {
  it('requests the exact i18n key + English default for each field', () => {
    const t = vi.fn((_k: string, d: string) => d)

    describeConsent('accepted', t)
    expect(t).toHaveBeenCalledWith(
      'consent.state.accepted',
      'Accepted — performance & error reporting on',
    )
    expect(t).toHaveBeenCalledWith('consent.short.accepted', 'Accepted')

    t.mockClear()
    describeConsent('declined', t)
    expect(t).toHaveBeenCalledWith(
      'consent.state.declined',
      'Declined — only essential storage in use',
    )
    expect(t).toHaveBeenCalledWith('consent.short.declined', 'Declined')

    t.mockClear()
    describeConsent('unknown', t)
    expect(t).toHaveBeenCalledWith(
      'consent.state.unknown',
      'Not decided — banner will appear on next visit',
    )
    expect(t).toHaveBeenCalledWith('consent.short.unknown', 'Not decided')
  })

  it('passes the translated string through verbatim (localization actually happens)', () => {
    // A translator that returns locale-specific copy rather than the default.
    const fr: Record<string, string> = {
      'consent.short.accepted': 'Accepté',
      'consent.state.accepted': 'Accepté — rapports activés',
    }
    const t = (key: string) => fr[key] ?? key

    const cp = describeConsent('accepted', t)
    expect(cp.short).toBe('Accepté')
    expect(cp.detail).toBe('Accepté — rapports activés')
    // Non-localized structural fields are unaffected by the translator.
    expect(cp.color).toBe('green')
    expect(cp.dot).toBe('bg-emerald-400')
  })

  it('calls the translator exactly twice per invocation (detail + short only)', () => {
    const t = vi.fn((_k: string, d: string) => d)
    describeConsent('declined', t)
    expect(t).toHaveBeenCalledTimes(2)
  })
})

describe('describeConsent — defensive default branch', () => {
  it('collapses an unrecognised state onto the neutral "unknown" presentation', () => {
    // Simulate a value from an older schema / corrupt localStorage / JS caller.
    const rogue = 'expired' as ConsentState
    const cp = describeConsent(rogue, passthrough)
    expect(cp).toEqual(describeConsent('unknown', passthrough))
    expect(cp.color).toBe('blue')
    expect(cp.dot).toBe('bg-slate-400')
  })

  it('never throws for nullish / non-string states', () => {
    expect(() =>
      describeConsent(undefined as unknown as ConsentState, passthrough),
    ).not.toThrow()
    expect(() => describeConsent(null as unknown as ConsentState, passthrough)).not.toThrow()

    const cp = describeConsent(undefined as unknown as ConsentState, passthrough)
    expect(cp.short).toBe('Not decided')
  })
})

describe('describeConsent — blank-safety guard', () => {
  it.each(REAL_STATES)(
    'falls back to the English default when the translator returns "" for "%s"',
    (state) => {
      const empty = () => ''
      const cp = describeConsent(state, empty)
      expect(cp.detail.length).toBeGreaterThan(0)
      expect(cp.short.length).toBeGreaterThan(0)
      // The fallback is exactly the English default baked into describeConsent.
      expect(cp).toEqual(describeConsent(state, passthrough))
    },
  )

  it('falls back when the translator returns null / undefined (misconfigured i18next)', () => {
    const nullish = () => null as unknown as string
    const cp = describeConsent('accepted', nullish)
    expect(cp.short).toBe('Accepted')
    expect(cp.detail).toBe('Accepted — performance & error reporting on')

    const undef = () => undefined as unknown as string
    expect(describeConsent('declined', undef).short).toBe('Declined')
  })
})

describe('describeConsent — structural contract & purity', () => {
  it('every state yields a well-formed ConsentPresentation', () => {
    for (const state of REAL_STATES) {
      const cp: ConsentPresentation = describeConsent(state, passthrough)
      expect(Object.keys(cp).sort()).toEqual(['color', 'detail', 'dot', 'short'])
      expect(NEON_COLORS).toContain(cp.color)
      expect(cp.dot).toMatch(/^bg-[a-z]+-\d{2,3}$/)
      expect(cp.detail.length).toBeGreaterThan(0)
      expect(cp.short.length).toBeGreaterThan(0)
    }
  })

  it('always pairs colour with a non-empty dot so colour is never the only signal', () => {
    for (const state of REAL_STATES) {
      const cp = describeConsent(state, passthrough)
      expect(cp.color).toBeTruthy()
      expect(cp.dot.trim().length).toBeGreaterThan(0)
    }
  })

  it('is pure — identical input yields deep-equal but independent objects', () => {
    const a = describeConsent('accepted', passthrough)
    const b = describeConsent('accepted', passthrough)
    expect(a).toEqual(b)
    // A fresh object each call — consumers can safely spread/mutate downstream.
    expect(a).not.toBe(b)
  })
})
