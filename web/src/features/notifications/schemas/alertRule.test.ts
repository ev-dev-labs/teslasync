/**
 * Behavioural coverage for the Alert Studio rule schema.
 *
 * `alertRuleSchema` is the last line of defence before an alert rule is
 * POSTed to the server, so every branch of its `superRefine` is exercised
 * here: the signal/computed-metric split, range operators, the value-shape
 * contract, and the two-tier escalation invariants. Each operator/severity
 * constant is pinned too — the schema's `z.enum(...)` calls depend on them
 * matching the `@/api/types` unions exactly.
 */

import { describe, it, expect } from 'vitest'
import type { ZodIssue } from 'zod'

import {
  ALERT_RULE_OPS,
  ALERT_RULE_SEVERITIES,
  ALERT_RULE_TRIGGER_MODES,
  ALERT_RULE_KINDS,
  COMPUTED_METRIC_OPS,
  alertRuleSchema,
  type AlertRuleFormData,
} from './alertRule'

/** Minimal-but-valid signal rule; overrides tweak the field(s) under test. */
function validSignal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Battery low',
    signal_name: 'BatteryLevel',
    op: '<',
    value_num: 20,
    severity: 'warn',
    cooldown_min: 30,
    trigger_mode: 'repeat',
    ...overrides,
  }
}

/** Minimal-but-valid computed-metric rule. */
function validMetric(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Efficiency drop',
    kind: 'computed_metric',
    metric_id: 'efficiency',
    metric_window: '7d',
    metric_op: '%_change_<',
    metric_threshold: -10,
    severity: 'warn',
    cooldown_min: 60,
    trigger_mode: 'repeat',
    ...overrides,
  }
}

function parseIssues(data: unknown): ZodIssue[] {
  const result = alertRuleSchema.safeParse(data)
  if (result.success) {
    throw new Error(`expected validation to fail but it passed: ${JSON.stringify(data)}`)
  }
  return result.error.issues
}

/** Assert the schema rejects `data` with an issue at `path` carrying `message`. */
function expectIssue(data: unknown, path: string, message: string): void {
  const issues = parseIssues(data)
  const match = issues.find(i => i.path.join('.') === path && i.message === message)
  expect(
    match,
    `missing issue {path:"${path}", message:"${message}"}; got ${JSON.stringify(
      issues.map(i => ({ path: i.path.join('.'), message: i.message })),
    )}`,
  ).toBeDefined()
}

/** Assert the schema accepts `data`. */
function expectValid(data: unknown): AlertRuleFormData {
  const result = alertRuleSchema.safeParse(data)
  expect(
    result.success,
    result.success ? '' : JSON.stringify(result.error.issues),
  ).toBe(true)
  if (!result.success) {
    throw new Error('unreachable')
  }
  return result.data
}

describe('alertRule constants', () => {
  it('pins ALERT_RULE_OPS to the nine backend operators in order', () => {
    expect([...ALERT_RULE_OPS]).toEqual([
      '=', '!=', '<', '<=', '>', '>=', 'changed', 'between', 'outside',
    ])
    expect(ALERT_RULE_OPS).toHaveLength(9)
    expect(ALERT_RULE_OPS).toContain('changed')
  })

  it('pins the severity ladder low-to-high', () => {
    expect([...ALERT_RULE_SEVERITIES]).toEqual(['info', 'warn', 'critical'])
  })

  it('pins trigger modes and rule kinds', () => {
    expect([...ALERT_RULE_TRIGGER_MODES]).toEqual(['once', 'repeat'])
    expect([...ALERT_RULE_KINDS]).toEqual(['signal', 'computed_metric'])
  })

  it('pins COMPUTED_METRIC_OPS including the percent-change operators', () => {
    expect([...COMPUTED_METRIC_OPS]).toEqual([
      '>', '>=', '<', '<=', '=', '!=', '%_change_>', '%_change_<',
    ])
    expect(COMPUTED_METRIC_OPS).toHaveLength(8)
    expect(COMPUTED_METRIC_OPS).toContain('%_change_>')
    expect(COMPUTED_METRIC_OPS).toContain('%_change_<')
  })
})

describe('alertRuleSchema — valid signal rules', () => {
  it('accepts a minimal numeric-threshold rule and echoes the payload', () => {
    const data = expectValid(validSignal())
    expect(data.name).toBe('Battery low')
    expect(data.op).toBe('<')
    expect(data.value_num).toBe(20)
  })

  it("accepts the value-less 'changed' operator", () => {
    const data = expectValid(validSignal({ op: 'changed', value_num: null }))
    expect(data.op).toBe('changed')
  })

  it("accepts a text value for equality operators", () => {
    const data = expectValid(validSignal({ op: '=', value_num: null, value_text: 'Complete' }))
    expect(data.value_text).toBe('Complete')
  })

  it('accepts value_bool === false as a real value (not treated as absent)', () => {
    const data = expectValid(validSignal({ op: '=', value_num: null, value_bool: false }))
    expect(data.value_bool).toBe(false)
  })

  it("accepts a well-ordered 'between' range", () => {
    const data = expectValid(validSignal({ op: 'between', value_num: null, value_min: 3, value_max: 10 }))
    expect(data.value_min).toBe(3)
    expect(data.value_max).toBe(10)
  })
})

describe('alertRuleSchema — field constraints', () => {
  it('requires a non-empty name', () => {
    expectIssue(validSignal({ name: '' }), 'name', 'Name is required')
  })

  it('caps the name at 120 characters', () => {
    expectIssue(
      validSignal({ name: 'a'.repeat(121) }),
      'name',
      'Name must be 120 characters or fewer',
    )
  })

  it('rejects a sub-minute cooldown', () => {
    expectIssue(validSignal({ cooldown_min: 0 }), 'cooldown_min', 'Cooldown must be at least 1 minute')
  })

  it('rejects a cooldown above 24 hours', () => {
    expectIssue(
      validSignal({ cooldown_min: 1441 }),
      'cooldown_min',
      'Cooldown cannot exceed 1440 minutes (24 hours)',
    )
  })

  it('rejects a fractional cooldown', () => {
    expectIssue(
      validSignal({ cooldown_min: 1.5 }),
      'cooldown_min',
      'Cooldown must be a whole number of minutes',
    )
  })

  it('rejects a non-positive max_fires_per_resolution', () => {
    expectIssue(
      validSignal({ max_fires_per_resolution: 0 }),
      'max_fires_per_resolution',
      'Max fires must be greater than 0',
    )
  })
})

describe('alertRuleSchema — signal-kind refinements', () => {
  it('requires a signal name', () => {
    expectIssue(validSignal({ signal_name: undefined }), 'signal_name', 'Signal is required')
  })

  it('requires an operator once a signal is chosen', () => {
    expectIssue(validSignal({ op: undefined }), 'op', 'Operator is required')
  })

  it('requires a value for value-bearing operators', () => {
    expectIssue(
      validSignal({ op: '>', value_num: undefined }),
      'value_num',
      'A value is required for this operator',
    )
  })

  it('rejects more than one typed value (exactly-one contract)', () => {
    // Regression guard: the schema comment promises "exactly one" typed
    // value, but the code originally only rejected zero. Two values now fail.
    expectIssue(
      validSignal({ op: '=', value_num: 5, value_text: 'Complete' }),
      'value_num',
      'Provide exactly one value (number, text, or boolean) for this operator',
    )
  })

  it('requires both bounds for range operators', () => {
    expectIssue(
      validSignal({ op: 'between', value_num: null, value_min: 5, value_max: undefined }),
      'value_min',
      'Min and max are required for range operators',
    )
  })

  it('requires max >= min for range operators', () => {
    expectIssue(
      validSignal({ op: 'outside', value_num: null, value_min: 10, value_max: 3 }),
      'value_max',
      'Max must be greater than or equal to min',
    )
  })
})

describe('alertRuleSchema — computed-metric refinements', () => {
  it('accepts a fully-specified computed-metric rule', () => {
    const data = expectValid(validMetric())
    expect(data.kind).toBe('computed_metric')
    expect(data.metric_op).toBe('%_change_<')
  })

  it('requires a metric id', () => {
    expectIssue(validMetric({ metric_id: undefined }), 'metric_id', 'Metric is required')
  })

  it('requires a metric window', () => {
    expectIssue(validMetric({ metric_window: undefined }), 'metric_window', 'Window is required')
  })

  it('requires a metric operator', () => {
    expectIssue(validMetric({ metric_op: undefined }), 'metric_op', 'Operator is required')
  })

  it('requires a finite metric threshold', () => {
    expectIssue(validMetric({ metric_threshold: undefined }), 'metric_threshold', 'Threshold is required')
  })

  it('does not run signal validation for computed-metric rules', () => {
    // signal_name / op are intentionally omitted; the server zeroes them.
    const data = expectValid(validMetric({ signal_name: undefined, op: undefined }))
    expect(data.signal_name).toBeUndefined()
  })
})

describe('alertRuleSchema — escalation invariants', () => {
  it('accepts a strictly-higher escalation on a repeat-mode rule', () => {
    const data = expectValid(
      validSignal({
        trigger_mode: 'repeat',
        severity: 'warn',
        escalation_after_min: 30,
        escalation_severity: 'critical',
      }),
    )
    expect(data.escalation_after_min).toBe(30)
    expect(data.escalation_severity).toBe('critical')
  })

  it('rejects an escalate-after duration without a severity', () => {
    expectIssue(
      validSignal({ escalation_after_min: 30 }),
      'escalation_severity',
      'Escalation requires both an escalate-after duration and a severity',
    )
  })

  it('rejects an escalation severity without a duration', () => {
    expectIssue(
      validSignal({ escalation_severity: 'critical' }),
      'escalation_after_min',
      'Escalation requires both an escalate-after duration and a severity',
    )
  })

  it('rejects escalation on once-mode rules', () => {
    expectIssue(
      validSignal({
        trigger_mode: 'once',
        escalation_after_min: 30,
        escalation_severity: 'critical',
      }),
      'escalation_after_min',
      'Escalation only applies to repeat-mode rules',
    )
  })

  it('rejects an escalation that is not strictly higher than the base severity', () => {
    expectIssue(
      validSignal({
        trigger_mode: 'repeat',
        severity: 'critical',
        escalation_after_min: 30,
        escalation_severity: 'warn',
      }),
      'escalation_severity',
      'Escalated severity must be higher than the base severity',
    )
  })

  it('enforces the 24-hour cap on the escalate-after duration', () => {
    expectIssue(
      validSignal({
        trigger_mode: 'repeat',
        severity: 'warn',
        escalation_after_min: 2000,
        escalation_severity: 'critical',
      }),
      'escalation_after_min',
      'Escalate after cannot exceed 1440 minutes (24 hours)',
    )
  })
})

describe('AlertRuleFormData', () => {
  it('is the inferred output type of the schema', () => {
    const parsed: AlertRuleFormData = alertRuleSchema.parse(validSignal())
    expect(parsed.name).toBe('Battery low')
    expect(parsed.trigger_mode).toBe('repeat')
    expect(parsed.kind).toBeUndefined()
  })
})
