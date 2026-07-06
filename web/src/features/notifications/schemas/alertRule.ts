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

export const ALERT_RULE_KINDS = ['signal', 'computed_metric'] as const

export const COMPUTED_METRIC_OPS = [
  '>',
  '>=',
  '<',
  '<=',
  '=',
  '!=',
  '%_change_>',
  '%_change_<',
] as const

/** Operators that don't require a value (`changed` is the only one). */
const NO_VALUE_OPS: ReadonlyArray<(typeof ALERT_RULE_OPS)[number]> = ['changed']

/** Operators that take a numeric range (`value_min` + `value_max`). */
const RANGE_OPS: ReadonlyArray<(typeof ALERT_RULE_OPS)[number]> = ['between', 'outside']

/**
 * Schema applied at submit-time. Only catches form-shape errors that ANY
 * caller (template, editor, programmatic insert) must satisfy. Cross-field
 * value-type coercion is handled by the editor before submit.
 *
 * Branches on `kind`: signal-mode rules require signal_name + op + a value
 * shaped to op; computed_metric rules require metric_id + window + op +
 * threshold and may leave signal_name/op blank (the server zeroes them out).
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
    /**
     * Sticky-all flag. When `true`, rule
     * applies to every fleet vehicle including ones added later.
     * Mutually exclusive with a non-empty `vehicle_ids` array
     * (server-side returns 422 on conflict).
     */
    all_vehicles: z.boolean().optional(),
    /**
     * Explicit subset of vehicle IDs.
     * Sorted and deduped before submit.
     */
    vehicle_ids: z.array(z.number().int().positive()).optional(),
    signal_name: z
      .string()
      .trim()
      .max(120, 'Signal name must be 120 characters or fewer')
      .optional(),
    op: z.enum(ALERT_RULE_OPS).optional(),
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
    /**
     * Per-rule cap on how many notifications a `repeat`-mode rule may
     * emit between falling-edge resets. NULL = unlimited (legacy).
     * Once-mode rules accept the field but the backend latch caps them
     * at 1 per resolution regardless of the value.
     */
    max_fires_per_resolution: z
      .number()
      .int('Max fires must be a whole number')
      .positive('Max fires must be greater than 0')
      .nullable()
      .optional(),
    /**
     * Escalation pair; both fields must be present together or both null.
     * Repeat-mode rules whose underlying condition stays unresolved
     * for at least `escalation_after_min` minutes will start firing
     * at `escalation_severity` instead of the base `severity`. The
     * escalated severity MUST rank strictly higher than the base severity under
     * info < warn < critical. Once-mode rules ignore these fields
     * (the latch caps them at 1 fire per resolution).
     */
    escalation_after_min: z
      .number()
      .int('Escalate after must be a whole number of minutes')
      .positive('Escalate after must be greater than 0')
      .max(1440, 'Escalate after cannot exceed 1440 minutes (24 hours)')
      .nullable()
      .optional(),
    escalation_severity: z.enum(ALERT_RULE_SEVERITIES).nullable().optional(),
    kind: z.enum(ALERT_RULE_KINDS).optional(),
    metric_id: z.string().trim().max(120).optional().nullable(),
    metric_window: z.string().trim().max(60).optional().nullable(),
    metric_threshold: z.number().finite().optional().nullable(),
    metric_op: z.enum(COMPUTED_METRIC_OPS).optional().nullable(),
    /**
     * Per-rule notification body template.
     * `null` (or omission) means "use the op-aware default rendered
     * by internal/alertmsg". A whitespace-only string is normalised
     * to null by the backend. Max 1024 chars; transports cap it
     * lower in practice.
     */
    msg_template: z
      .string()
      .max(1024, 'Message template must be 1024 characters or fewer')
      .optional()
      .nullable(),
    /**
     * When FALSE, transports that render a
     * separate title field (Discord/Slack/Telegram/ntfy/webhook)
     * deliver body-only notifications. Defaults to TRUE.
     */
    include_title: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    // Run escalation pair invariants first
    // so the user gets the clearest error before kind-specific checks.
    const afterPresent = data.escalation_after_min != null
    const sevPresent = data.escalation_severity != null
    if (afterPresent !== sevPresent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [afterPresent ? 'escalation_severity' : 'escalation_after_min'],
        message: 'Escalation requires both an escalate-after duration and a severity',
      })
    }
    if (afterPresent && sevPresent) {
      const triggerMode = data.trigger_mode ?? 'repeat'
      if (triggerMode !== 'repeat') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['escalation_after_min'],
          message: 'Escalation only applies to repeat-mode rules',
        })
      }
      const rank: Record<(typeof ALERT_RULE_SEVERITIES)[number], number> = {
        info: 1,
        warn: 2,
        critical: 3,
      }
      const baseSev = data.severity ?? 'warn'
      const escSev = data.escalation_severity!
      if (rank[escSev] <= rank[baseSev]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['escalation_severity'],
          message: 'Escalated severity must be higher than the base severity',
        })
      }
    }

    const kind = data.kind ?? 'signal'

    if (kind === 'computed_metric') {
      if (!data.metric_id || data.metric_id.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['metric_id'],
          message: 'Metric is required',
        })
      }
      if (!data.metric_window || data.metric_window.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['metric_window'],
          message: 'Window is required',
        })
      }
      if (!data.metric_op) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['metric_op'],
          message: 'Operator is required',
        })
      }
      if (data.metric_threshold == null || !Number.isFinite(data.metric_threshold)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['metric_threshold'],
          message: 'Threshold is required',
        })
      }
      return
    }

    // signal-kind validation (default):
    if (!data.signal_name || data.signal_name.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['signal_name'],
        message: 'Signal is required',
      })
      return
    }
    if (!data.op) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['op'],
        message: 'Operator is required',
      })
      return
    }
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
    } else if (present > 1) {
      // More than one typed value is ambiguous: the backend compares
      // against a single value and cannot infer which type to use when
      // e.g. both value_num and value_text are set. Reject it here so
      // the "exactly one" contract above is actually enforced.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value_num'],
        message: 'Provide exactly one value (number, text, or boolean) for this operator',
      })
    }
  })

export type AlertRuleFormData = z.infer<typeof alertRuleSchema>
