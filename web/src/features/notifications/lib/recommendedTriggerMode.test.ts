/**
 * Behavioural coverage for the smart-defaults engine `recommendedTriggerMode`.
 *
 * The mapping is a UI contract: Alert Studio surfaces the returned mode as a
 * per-operator suggestion when a new signal rule is created (see
 * `AlertStudioPage` `recommendedMode`/`recommendedLabel`). These tests lock in
 * four facets so the copy the page renders can never silently drift:
 *
 *   1. the exact operator -> mode mapping for every member of ALERT_RULE_OPS,
 *   2. the semantic partition (state-confirmation -> 'once',
 *      threshold/range -> 'repeat') the banner copy depends on,
 *   3. the output invariant (always a valid AlertRuleTriggerMode) + purity,
 *   4. runtime robustness — the defensive `default` fallback that guards
 *      against out-of-contract data reaching the function from untyped sources.
 *
 * Co-located with the source (per the elevation gate) and a strict superset of
 * the former feature-root test.
 */

import { describe, expect, it } from 'vitest'

import type { AlertRuleOp } from '@/api/types'

import { ALERT_RULE_OPS, ALERT_RULE_TRIGGER_MODES } from '../schemas/alertRule'
import { recommendedTriggerMode } from './recommendedTriggerMode'

// The two semantic buckets the UI copy in AlertStudioPage relies on. Kept
// hand-maintained (NOT derived from the function under test) so a regression in
// the mapping is caught here instead of being silently mirrored.
const ONCE_OPS: AlertRuleOp[] = ['=', '!=', 'changed']
const REPEAT_OPS: AlertRuleOp[] = ['>', '<', '>=', '<=', 'between', 'outside']

describe('recommendedTriggerMode', () => {
  describe("state-confirmation operators recommend 'once'", () => {
    it("maps equality '=' to once", () => {
      expect(recommendedTriggerMode('=')).toBe('once')
    })

    it("maps inequality '!=' to once", () => {
      expect(recommendedTriggerMode('!=')).toBe('once')
    })

    it("maps the 'changed' transition operator to once", () => {
      expect(recommendedTriggerMode('changed')).toBe('once')
    })
  })

  describe("threshold and range operators recommend 'repeat'", () => {
    it("maps greater-than '>' to repeat", () => {
      expect(recommendedTriggerMode('>')).toBe('repeat')
    })

    it("maps less-than '<' to repeat", () => {
      expect(recommendedTriggerMode('<')).toBe('repeat')
    })

    it("maps greater-or-equal '>=' to repeat", () => {
      expect(recommendedTriggerMode('>=')).toBe('repeat')
    })

    it("maps less-or-equal '<=' to repeat", () => {
      expect(recommendedTriggerMode('<=')).toBe('repeat')
    })

    it("maps range 'between' to repeat", () => {
      expect(recommendedTriggerMode('between')).toBe('repeat')
    })

    it("maps range 'outside' to repeat", () => {
      expect(recommendedTriggerMode('outside')).toBe('repeat')
    })
  })

  it('partitions every ALERT_RULE_OPS member into exactly one bucket', () => {
    // The union of the two hand-maintained buckets must equal the schema's
    // operator catalog with no overlap and no gaps — that is what makes the
    // per-operator assertions above an exhaustive cover of the mapping.
    expect(ALERT_RULE_OPS).toHaveLength(9)
    expect([...ONCE_OPS, ...REPEAT_OPS].sort()).toEqual([...ALERT_RULE_OPS].sort())
    expect(ONCE_OPS.filter((op) => REPEAT_OPS.includes(op))).toEqual([])

    for (const op of ONCE_OPS) {
      expect(recommendedTriggerMode(op)).toBe('once')
    }
    for (const op of REPEAT_OPS) {
      expect(recommendedTriggerMode(op)).toBe('repeat')
    }
  })

  it('always returns a member of ALERT_RULE_TRIGGER_MODES (no drift)', () => {
    for (const op of ALERT_RULE_OPS) {
      expect(ALERT_RULE_TRIGGER_MODES).toContain(recommendedTriggerMode(op))
    }
  })

  it('is pure — repeated calls agree and never throw for valid operators', () => {
    for (const op of ALERT_RULE_OPS) {
      const call = () => recommendedTriggerMode(op)
      expect(call).not.toThrow()
      expect(call()).toBe(call())
    }
  })

  it("falls back to 'repeat' for out-of-contract runtime values (default branch)", () => {
    // `op` is typed to the nine-operator union, but untyped data (API drift, a
    // stale `as` cast, a corrupt persisted draft) can still reach this at
    // runtime. The documented fallback is the safer 'repeat' (re-alert until
    // resolved) and it must never throw. The casts deliberately exercise the
    // `switch` default arm for full branch coverage.
    const rogue = '~=' as unknown as AlertRuleOp
    expect(() => recommendedTriggerMode(rogue)).not.toThrow()
    expect(recommendedTriggerMode(rogue)).toBe('repeat')
    expect(recommendedTriggerMode('' as unknown as AlertRuleOp)).toBe('repeat')
  })
})
