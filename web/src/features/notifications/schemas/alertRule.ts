/**
 * Zod schemas for the Alert Studio rule editor.
 *
 * The schema mirrors the server contract in `internal/api/alerts_handler.go`
 * and `internal/models/alert_rule.go`. Update both sides together when adding
 * fields. The shape lines up 1:1 with `AlertRuleInput` from `@/api/types`.
 */

import { z } from 'zod'

// Backend-supported operators; mirrors `AlertRuleOp` in @/api/types.
export const ALERT_RULE_OPS = [
  '=',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  'changed',
  'between',
  'outside',
] as const

export const ALERT_RULE_SEVERITIES = ['info', 'warn', 'critical'] as const

export const ALERT_RULE_TRIGGER_MODES = ['once', 'repeat'] as const

/** Operators that don't require a value (`changed` is the only one). */
const NO_VALUE_OPS: ReadonlyArray<(typeof ALERT_RULE_OPS)[number]> = ['changed']

/** Operators that take a numeric range (`value_min` + `value_max`). */
const RANGE_OPS: ReadonlyArray<(typeof ALERT_RULE_OPS)[number]> = ['between', 'outside']

/**
 * Schema applied at submit-time. Only catches form-shape errors that ANY
 * caller (template, editor, programmatic insert) must satisfy. Cross-field
 * value-type coercion is handled by the editor before submit.
 */
export const alertRuleSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Name is required')
      .max(120, 'Name must be 120 characters or fewer'),
    description: z.string().max(500).optional().nullable(),
    enabled: z.boolean().optional(),
    vehicle_id: z.number().int().positive().optional().nullable(),
    signal_name: z
      .string()
      .trim()
      .min(1, 'Signal is required')
      .max(120, 'Signal name must be 120 characters or fewer'),
    op: z.enum(ALERT_RULE_OPS),
    value_num: z.number().finite().optional().nullable(),
    value_text: z.string().max(500).optional().nullable(),
    value_bool: z.boolean().optional().nullable(),
    value_min: z.number().finite().optional().nullable(),
    value_max: z.number().finite().optional().nullable(),
    severity: z.enum(ALERT_RULE_SEVERITIES).optional(),
    cooldown_min: z
      .number()
      .int('Cooldown must be a whole number of minutes')
      .min(1, 'Cooldown must be at least 1 minute')
      .max(1440, 'Cooldown cannot exceed 1440 minutes (24 hours)')
      .optional(),
    trigger_mode: z.enum(ALERT_RULE_TRIGGER_MODES).optional(),
    snoozed_until: z.string().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    // `between` / `outside` need a valid min<=max range.
    if (RANGE_OPS.includes(data.op)) {
      if (data.value_min == null || data.value_max == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['value_min'],
          message: 'Min and max are required for range operators',
        })
        return
      }
      if (data.value_min > data.value_max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['value_max'],
          message: 'Max must be greater than or equal to min',
        })
      }
      return
    }
    // `changed` doesn't require a value — skip the rest of the checks.
    if (NO_VALUE_OPS.includes(data.op)) return

    // For all other operators exactly one of value_num / value_text /
    // value_bool must be present so the backend knows what type to compare.
    const present = [
      data.value_num != null,
      data.value_text != null && data.value_text !== '',
      data.value_bool != null,
    ].filter(Boolean).length
    if (present === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value_num'],
        message: 'A value is required for this operator',
      })
    }
  })

export type AlertRuleFormData = z.infer<typeof alertRuleSchema>
