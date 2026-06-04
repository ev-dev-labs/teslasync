/**
 * Exhaustive operator-to-trigger-mode tests.
 *
 * Every member of `ALERT_RULE_OPS` is covered. Adding a new operator to
 * the union without extending `recommendedTriggerMode` will fail to
 * compile (the switch's `never` fallback enforces exhaustiveness), but
 * this file is a behavioural backstop documenting the mapping so a
 * reviewer can reason about UI copy without re-reading TypeScript.
 */

import { describe, expect, it } from 'vitest'

import { ALERT_RULE_OPS } from '../schemas/alertRule'
import { recommendedTriggerMode } from '../lib/recommendedTriggerMode'

describe('recommendedTriggerMode', () => {
  it("recommends 'once' for equality '='", () => {
    expect(recommendedTriggerMode('=')).toBe('once')
  })

  it("recommends 'once' for inequality '!='", () => {
    expect(recommendedTriggerMode('!=')).toBe('once')
  })

  it("recommends 'once' for the 'changed' transition operator", () => {
    expect(recommendedTriggerMode('changed')).toBe('once')
  })

  it("recommends 'repeat' for threshold '>'", () => {
    expect(recommendedTriggerMode('>')).toBe('repeat')
  })

  it("recommends 'repeat' for threshold '<'", () => {
    expect(recommendedTriggerMode('<')).toBe('repeat')
  })

  it("recommends 'repeat' for threshold '>='", () => {
    expect(recommendedTriggerMode('>=')).toBe('repeat')
  })

  it("recommends 'repeat' for threshold '<='", () => {
    expect(recommendedTriggerMode('<=')).toBe('repeat')
  })

  it("recommends 'repeat' for range 'between'", () => {
    expect(recommendedTriggerMode('between')).toBe('repeat')
  })

  it("recommends 'repeat' for range 'outside'", () => {
    expect(recommendedTriggerMode('outside')).toBe('repeat')
  })

  it('covers every operator in ALERT_RULE_OPS (prevents drift)', () => {
    for (const op of ALERT_RULE_OPS) {
      const mode = recommendedTriggerMode(op)
      expect(mode === 'once' || mode === 'repeat').toBe(true)
    }
    expect(ALERT_RULE_OPS.length).toBe(9)
  })
})
