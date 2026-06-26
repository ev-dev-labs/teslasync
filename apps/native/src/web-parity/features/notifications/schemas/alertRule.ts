/**
 * Validation schema for the Alert Studio rule editor (native parity port).
 *
 * The web source (web/src/features/notifications/schemas/alertRule.ts) builds
 * this schema with zod. zod is not a dependency of the native app — the same
 * decision the AlertStudioPage native port already made — so the schema is
 * hand-ported here to a dependency-free validator that returns a
 * zod-compatible result: `{ success: true, data }` or
 * `{ success: false, error: { issues } }`. Validation outcomes, custom
 * messages, issue paths, and the `superRefine` cross-field rules match the web
 * schema 1:1.
 *
 * The schema mirrors the server contract in `internal/api/alerts_handler.go`
 * and `internal/models/alert_rule.go`. Update both sides together when adding
 * fields. The shape lines up 1:1 with `AlertRuleInput` from `../../../api/types`.
 */

// Backend-supported operators; mirrors `AlertRuleOp` in ../../../api/types.
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
] as const;

export const ALERT_RULE_SEVERITIES = ['info', 'warn', 'critical'] as const;

export const ALERT_RULE_TRIGGER_MODES = ['once', 'repeat'] as const;

export const ALERT_RULE_KINDS = ['signal', 'computed_metric'] as const;

export const COMPUTED_METRIC_OPS = [
  '>',
  '>=',
  '<',
  '<=',
  '=',
  '!=',
  '%_change_>',
  '%_change_<',
] as const;

type AlertRuleOp = (typeof ALERT_RULE_OPS)[number];
type AlertRuleSeverity = (typeof ALERT_RULE_SEVERITIES)[number];
type AlertRuleTriggerMode = (typeof ALERT_RULE_TRIGGER_MODES)[number];
type AlertRuleKind = (typeof ALERT_RULE_KINDS)[number];
type ComputedMetricOp = (typeof COMPUTED_METRIC_OPS)[number];

/** Operators that don't require a value (`changed` is the only one). */
const NO_VALUE_OPS: ReadonlyArray<AlertRuleOp> = ['changed'];

/** Operators that take a numeric range (`value_min` + `value_max`). */
const RANGE_OPS: ReadonlyArray<AlertRuleOp> = ['between', 'outside'];

/**
 * Inferred form shape (replaces the web `z.infer<typeof alertRuleSchema>`).
 *
 * Branches on `kind`: signal-mode rules require signal_name + op + a value
 * shaped to op; computed_metric rules require metric_id + window + op +
 * threshold and may leave signal_name/op blank (the server zeroes them out).
 */
export interface AlertRuleFormData {
  name: string;
  description?: string | null;
  enabled?: boolean;
  vehicle_id?: number | null;
  /**
   * Sticky-all flag. When `true`, rule applies to every fleet vehicle
   * including ones added later. Mutually exclusive with a non-empty
   * `vehicle_ids` array (server-side returns 422 on conflict).
   */
  all_vehicles?: boolean;
  /** Explicit subset of vehicle IDs. Sorted and deduped before submit. */
  vehicle_ids?: number[];
  signal_name?: string;
  op?: AlertRuleOp;
  value_num?: number | null;
  value_text?: string | null;
  value_bool?: boolean | null;
  value_min?: number | null;
  value_max?: number | null;
  severity?: AlertRuleSeverity;
  cooldown_min?: number;
  trigger_mode?: AlertRuleTriggerMode;
  snoozed_until?: string | null;
  /**
   * Per-rule cap on how many notifications a `repeat`-mode rule may emit
   * between falling-edge resets. NULL = unlimited (legacy). Once-mode rules
   * accept the field but the backend latch caps them at 1 per resolution
   * regardless of the value.
   */
  max_fires_per_resolution?: number | null;
  /**
   * Escalation pair; both fields must be present together or both null.
   * Repeat-mode rules whose underlying condition stays unresolved for at least
   * `escalation_after_min` minutes will start firing at `escalation_severity`
   * instead of the base `severity`. The escalated severity MUST rank strictly
   * higher than the base severity under info < warn < critical. Once-mode rules
   * ignore these fields (the latch caps them at 1 fire per resolution).
   */
  escalation_after_min?: number | null;
  escalation_severity?: AlertRuleSeverity | null;
  kind?: AlertRuleKind;
  metric_id?: string | null;
  metric_window?: string | null;
  metric_threshold?: number | null;
  metric_op?: ComputedMetricOp | null;
  /**
   * Per-rule notification body template. `null` (or omission) means "use the
   * op-aware default rendered by internal/alertmsg". A whitespace-only string
   * is normalised to null by the backend. Max 1024 chars; transports cap it
   * lower in practice.
   */
  msg_template?: string | null;
  /**
   * When FALSE, transports that render a separate title field
   * (Discord/Slack/Telegram/ntfy/webhook) deliver body-only notifications.
   * Defaults to TRUE.
   */
  include_title?: boolean;
}

/** A single validation problem, shaped like a zod issue. */
export interface AlertRuleSchemaIssue {
  code: string;
  path: Array<string | number>;
  message: string;
}

/** Result of {@link alertRuleSchema}.safeParse, mirroring zod's SafeParseReturn. */
export type AlertRuleSafeParseResult =
  | {success: true; data: AlertRuleFormData}
  | {success: false; error: {issues: AlertRuleSchemaIssue[]}};

/** Thrown by {@link alertRuleSchema}.parse on failure (mirrors zod's ZodError). */
export class AlertRuleSchemaError extends Error {
  readonly issues: AlertRuleSchemaIssue[];

  constructor(issues: AlertRuleSchemaIssue[]) {
    super(issues.map(issue => issue.message).join('; ') || 'Invalid alert rule');
    this.name = 'AlertRuleSchemaError';
    this.issues = issues;
  }
}

type Rec = Record<string, unknown>;
type Issues = AlertRuleSchemaIssue[];

function parsedType(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  const t = typeof value;
  if (t === 'number' && Number.isNaN(value as number)) {
    return 'nan';
  }
  return t;
}

interface StringRule {
  required?: boolean;
  trim?: boolean;
  min?: number;
  minMessage?: string;
  max?: number;
  maxMessage?: string;
}

function validateString(
  rec: Rec,
  key: string,
  rule: StringRule & {nullable: true},
  issues: Issues,
): string | null | undefined;
function validateString(
  rec: Rec,
  key: string,
  rule: StringRule & {nullable?: false},
  issues: Issues,
): string | undefined;
function validateString(
  rec: Rec,
  key: string,
  rule: StringRule & {nullable?: boolean},
  issues: Issues,
): string | null | undefined {
  const raw = rec[key];
  if (raw === undefined) {
    if (rule.required) {
      issues.push({code: 'invalid_type', path: [key], message: 'Required'});
    }
    return undefined;
  }
  if (raw === null) {
    if (rule.nullable) {
      return null;
    }
    issues.push({
      code: 'invalid_type',
      path: [key],
      message: 'Expected string, received null',
    });
    return undefined;
  }
  if (typeof raw !== 'string') {
    issues.push({
      code: 'invalid_type',
      path: [key],
      message: `Expected string, received ${parsedType(raw)}`,
    });
    return undefined;
  }
  const value = rule.trim ? raw.trim() : raw;
  if (rule.min !== undefined && value.length < rule.min) {
    issues.push({
      code: 'too_small',
      path: [key],
      message:
        rule.minMessage ?? `String must contain at least ${rule.min} character(s)`,
    });
  }
  if (rule.max !== undefined && value.length > rule.max) {
    issues.push({
      code: 'too_big',
      path: [key],
      message:
        rule.maxMessage ?? `String must contain at most ${rule.max} character(s)`,
    });
  }
  return value;
}

interface NumberRule {
  finite?: boolean;
  int?: boolean;
  intMessage?: string;
  positive?: boolean;
  positiveMessage?: string;
  min?: number;
  minMessage?: string;
  max?: number;
  maxMessage?: string;
}

function validateNumber(
  rec: Rec,
  key: string,
  rule: NumberRule & {nullable: true},
  issues: Issues,
): number | null | undefined;
function validateNumber(
  rec: Rec,
  key: string,
  rule: NumberRule & {nullable?: false},
  issues: Issues,
): number | undefined;
function validateNumber(
  rec: Rec,
  key: string,
  rule: NumberRule & {nullable?: boolean},
  issues: Issues,
): number | null | undefined {
  const raw = rec[key];
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null) {
    if (rule.nullable) {
      return null;
    }
    issues.push({
      code: 'invalid_type',
      path: [key],
      message: 'Expected number, received null',
    });
    return undefined;
  }
  if (typeof raw !== 'number' || Number.isNaN(raw)) {
    issues.push({
      code: 'invalid_type',
      path: [key],
      message: `Expected number, received ${parsedType(raw)}`,
    });
    return undefined;
  }
  if (rule.int && !Number.isInteger(raw)) {
    issues.push({
      code: 'invalid_type',
      path: [key],
      message: rule.intMessage ?? 'Expected integer, received float',
    });
  }
  if (rule.finite && !Number.isFinite(raw)) {
    issues.push({code: 'not_finite', path: [key], message: 'Number must be finite'});
  }
  if (rule.positive && !(raw > 0)) {
    issues.push({
      code: 'too_small',
      path: [key],
      message: rule.positiveMessage ?? 'Number must be greater than 0',
    });
  }
  if (rule.min !== undefined && raw < rule.min) {
    issues.push({
      code: 'too_small',
      path: [key],
      message:
        rule.minMessage ?? `Number must be greater than or equal to ${rule.min}`,
    });
  }
  if (rule.max !== undefined && raw > rule.max) {
    issues.push({
      code: 'too_big',
      path: [key],
      message: rule.maxMessage ?? `Number must be less than or equal to ${rule.max}`,
    });
  }
  return raw;
}

function validateBoolean(
  rec: Rec,
  key: string,
  issues: Issues,
  nullable: true,
): boolean | null | undefined;
function validateBoolean(
  rec: Rec,
  key: string,
  issues: Issues,
  nullable?: false,
): boolean | undefined;
function validateBoolean(
  rec: Rec,
  key: string,
  issues: Issues,
  nullable = false,
): boolean | null | undefined {
  const raw = rec[key];
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null) {
    if (nullable) {
      return null;
    }
    issues.push({
      code: 'invalid_type',
      path: [key],
      message: 'Expected boolean, received null',
    });
    return undefined;
  }
  if (typeof raw !== 'boolean') {
    issues.push({
      code: 'invalid_type',
      path: [key],
      message: `Expected boolean, received ${parsedType(raw)}`,
    });
    return undefined;
  }
  return raw;
}

function validateEnum<T extends string>(
  rec: Rec,
  key: string,
  values: readonly T[],
  issues: Issues,
  nullable: true,
): T | null | undefined;
function validateEnum<T extends string>(
  rec: Rec,
  key: string,
  values: readonly T[],
  issues: Issues,
  nullable?: false,
): T | undefined;
function validateEnum<T extends string>(
  rec: Rec,
  key: string,
  values: readonly T[],
  issues: Issues,
  nullable = false,
): T | null | undefined {
  const raw = rec[key];
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null) {
    if (nullable) {
      return null;
    }
  }
  if (typeof raw !== 'string' || !values.includes(raw as T)) {
    const expected = values.map(option => `'${option}'`).join(' | ');
    issues.push({
      code: 'invalid_enum_value',
      path: [key],
      message: `Invalid enum value. Expected ${expected}, received '${String(raw)}'`,
    });
    return undefined;
  }
  return raw as T;
}

function validateVehicleIds(rec: Rec, issues: Issues): number[] | undefined {
  const raw = rec.vehicle_ids;
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    issues.push({
      code: 'invalid_type',
      path: ['vehicle_ids'],
      message: `Expected array, received ${parsedType(raw)}`,
    });
    return undefined;
  }
  const out: number[] = [];
  raw.forEach((element, index) => {
    if (typeof element !== 'number' || Number.isNaN(element)) {
      issues.push({
        code: 'invalid_type',
        path: ['vehicle_ids', index],
        message: `Expected number, received ${parsedType(element)}`,
      });
      return;
    }
    if (!Number.isInteger(element)) {
      issues.push({
        code: 'invalid_type',
        path: ['vehicle_ids', index],
        message: 'Expected integer, received float',
      });
    }
    if (!(element > 0)) {
      issues.push({
        code: 'too_small',
        path: ['vehicle_ids', index],
        message: 'Number must be greater than 0',
      });
    }
    out.push(element);
  });
  return out;
}

/**
 * Cross-field invariants ported verbatim from the web schema's `superRefine`.
 * Runs escalation pair invariants first so the user gets the clearest error
 * before kind-specific checks.
 */
function runSuperRefine(data: AlertRuleFormData, issues: Issues): void {
  const afterPresent = data.escalation_after_min != null;
  const sevPresent = data.escalation_severity != null;
  if (afterPresent !== sevPresent) {
    issues.push({
      code: 'custom',
      path: [afterPresent ? 'escalation_severity' : 'escalation_after_min'],
      message: 'Escalation requires both an escalate-after duration and a severity',
    });
  }
  if (afterPresent && sevPresent) {
    const triggerMode = data.trigger_mode ?? 'repeat';
    if (triggerMode !== 'repeat') {
      issues.push({
        code: 'custom',
        path: ['escalation_after_min'],
        message: 'Escalation only applies to repeat-mode rules',
      });
    }
    const rank: Record<AlertRuleSeverity, number> = {
      info: 1,
      warn: 2,
      critical: 3,
    };
    const baseSev = data.severity ?? 'warn';
    const escSev = data.escalation_severity as AlertRuleSeverity;
    if (rank[escSev] <= rank[baseSev]) {
      issues.push({
        code: 'custom',
        path: ['escalation_severity'],
        message: 'Escalated severity must be higher than the base severity',
      });
    }
  }

  const kind = data.kind ?? 'signal';

  if (kind === 'computed_metric') {
    if (!data.metric_id || data.metric_id.trim() === '') {
      issues.push({code: 'custom', path: ['metric_id'], message: 'Metric is required'});
    }
    if (!data.metric_window || data.metric_window.trim() === '') {
      issues.push({
        code: 'custom',
        path: ['metric_window'],
        message: 'Window is required',
      });
    }
    if (!data.metric_op) {
      issues.push({
        code: 'custom',
        path: ['metric_op'],
        message: 'Operator is required',
      });
    }
    if (data.metric_threshold == null || !Number.isFinite(data.metric_threshold)) {
      issues.push({
        code: 'custom',
        path: ['metric_threshold'],
        message: 'Threshold is required',
      });
    }
    return;
  }

  // signal-kind validation (default):
  if (!data.signal_name || data.signal_name.trim() === '') {
    issues.push({
      code: 'custom',
      path: ['signal_name'],
      message: 'Signal is required',
    });
    return;
  }
  if (!data.op) {
    issues.push({code: 'custom', path: ['op'], message: 'Operator is required'});
    return;
  }
  // `between` / `outside` need a valid min<=max range.
  if (RANGE_OPS.includes(data.op)) {
    if (data.value_min == null || data.value_max == null) {
      issues.push({
        code: 'custom',
        path: ['value_min'],
        message: 'Min and max are required for range operators',
      });
      return;
    }
    if (data.value_min > data.value_max) {
      issues.push({
        code: 'custom',
        path: ['value_max'],
        message: 'Max must be greater than or equal to min',
      });
    }
    return;
  }
  // `changed` doesn't require a value — skip the rest of the checks.
  if (NO_VALUE_OPS.includes(data.op)) {
    return;
  }

  // For all other operators exactly one of value_num / value_text /
  // value_bool must be present so the backend knows what type to compare.
  const present = [
    data.value_num != null,
    data.value_text != null && data.value_text !== '',
    data.value_bool != null,
  ].filter(Boolean).length;
  if (present === 0) {
    issues.push({
      code: 'custom',
      path: ['value_num'],
      message: 'A value is required for this operator',
    });
  }
}

/**
 * Validate form input at submit-time. Only catches form-shape errors that ANY
 * caller (template, editor, programmatic insert) must satisfy. Cross-field
 * value-type coercion is handled by the editor before submit.
 */
function safeParse(input: unknown): AlertRuleSafeParseResult {
  const issues: Issues = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    issues.push({
      code: 'invalid_type',
      path: [],
      message: `Expected object, received ${parsedType(input)}`,
    });
    return {success: false, error: {issues}};
  }

  const rec = input as Rec;

  const name = validateString(
    rec,
    'name',
    {
      required: true,
      trim: true,
      min: 1,
      minMessage: 'Name is required',
      max: 120,
      maxMessage: 'Name must be 120 characters or fewer',
    },
    issues,
  );
  const description = validateString(
    rec,
    'description',
    {nullable: true, max: 500},
    issues,
  );
  const enabled = validateBoolean(rec, 'enabled', issues);
  const vehicle_id = validateNumber(
    rec,
    'vehicle_id',
    {nullable: true, int: true, positive: true},
    issues,
  );
  const all_vehicles = validateBoolean(rec, 'all_vehicles', issues);
  const vehicle_ids = validateVehicleIds(rec, issues);
  const signal_name = validateString(
    rec,
    'signal_name',
    {trim: true, max: 120, maxMessage: 'Signal name must be 120 characters or fewer'},
    issues,
  );
  const op = validateEnum(rec, 'op', ALERT_RULE_OPS, issues);
  const value_num = validateNumber(
    rec,
    'value_num',
    {nullable: true, finite: true},
    issues,
  );
  const value_text = validateString(
    rec,
    'value_text',
    {nullable: true, max: 500},
    issues,
  );
  const value_bool = validateBoolean(rec, 'value_bool', issues, true);
  const value_min = validateNumber(
    rec,
    'value_min',
    {nullable: true, finite: true},
    issues,
  );
  const value_max = validateNumber(
    rec,
    'value_max',
    {nullable: true, finite: true},
    issues,
  );
  const severity = validateEnum(rec, 'severity', ALERT_RULE_SEVERITIES, issues);
  const cooldown_min = validateNumber(
    rec,
    'cooldown_min',
    {
      int: true,
      intMessage: 'Cooldown must be a whole number of minutes',
      min: 1,
      minMessage: 'Cooldown must be at least 1 minute',
      max: 1440,
      maxMessage: 'Cooldown cannot exceed 1440 minutes (24 hours)',
    },
    issues,
  );
  const trigger_mode = validateEnum(
    rec,
    'trigger_mode',
    ALERT_RULE_TRIGGER_MODES,
    issues,
  );
  const snoozed_until = validateString(
    rec,
    'snoozed_until',
    {nullable: true},
    issues,
  );
  const max_fires_per_resolution = validateNumber(
    rec,
    'max_fires_per_resolution',
    {
      nullable: true,
      int: true,
      intMessage: 'Max fires must be a whole number',
      positive: true,
      positiveMessage: 'Max fires must be greater than 0',
    },
    issues,
  );
  const escalation_after_min = validateNumber(
    rec,
    'escalation_after_min',
    {
      nullable: true,
      int: true,
      intMessage: 'Escalate after must be a whole number of minutes',
      positive: true,
      positiveMessage: 'Escalate after must be greater than 0',
      max: 1440,
      maxMessage: 'Escalate after cannot exceed 1440 minutes (24 hours)',
    },
    issues,
  );
  const escalation_severity = validateEnum(
    rec,
    'escalation_severity',
    ALERT_RULE_SEVERITIES,
    issues,
    true,
  );
  const kind = validateEnum(rec, 'kind', ALERT_RULE_KINDS, issues);
  const metric_id = validateString(
    rec,
    'metric_id',
    {nullable: true, trim: true, max: 120},
    issues,
  );
  const metric_window = validateString(
    rec,
    'metric_window',
    {nullable: true, trim: true, max: 60},
    issues,
  );
  const metric_threshold = validateNumber(
    rec,
    'metric_threshold',
    {nullable: true, finite: true},
    issues,
  );
  const metric_op = validateEnum(
    rec,
    'metric_op',
    COMPUTED_METRIC_OPS,
    issues,
    true,
  );
  const msg_template = validateString(
    rec,
    'msg_template',
    {
      nullable: true,
      max: 1024,
      maxMessage: 'Message template must be 1024 characters or fewer',
    },
    issues,
  );
  const include_title = validateBoolean(rec, 'include_title', issues);

  const data: AlertRuleFormData = {
    name: name ?? '',
    ...(description !== undefined ? {description} : {}),
    ...(enabled !== undefined ? {enabled} : {}),
    ...(vehicle_id !== undefined ? {vehicle_id} : {}),
    ...(all_vehicles !== undefined ? {all_vehicles} : {}),
    ...(vehicle_ids !== undefined ? {vehicle_ids} : {}),
    ...(signal_name !== undefined ? {signal_name} : {}),
    ...(op !== undefined ? {op} : {}),
    ...(value_num !== undefined ? {value_num} : {}),
    ...(value_text !== undefined ? {value_text} : {}),
    ...(value_bool !== undefined ? {value_bool} : {}),
    ...(value_min !== undefined ? {value_min} : {}),
    ...(value_max !== undefined ? {value_max} : {}),
    ...(severity !== undefined ? {severity} : {}),
    ...(cooldown_min !== undefined ? {cooldown_min} : {}),
    ...(trigger_mode !== undefined ? {trigger_mode} : {}),
    ...(snoozed_until !== undefined ? {snoozed_until} : {}),
    ...(max_fires_per_resolution !== undefined ? {max_fires_per_resolution} : {}),
    ...(escalation_after_min !== undefined ? {escalation_after_min} : {}),
    ...(escalation_severity !== undefined ? {escalation_severity} : {}),
    ...(kind !== undefined ? {kind} : {}),
    ...(metric_id !== undefined ? {metric_id} : {}),
    ...(metric_window !== undefined ? {metric_window} : {}),
    ...(metric_threshold !== undefined ? {metric_threshold} : {}),
    ...(metric_op !== undefined ? {metric_op} : {}),
    ...(msg_template !== undefined ? {msg_template} : {}),
    ...(include_title !== undefined ? {include_title} : {}),
  };

  runSuperRefine(data, issues);

  if (issues.length > 0) {
    return {success: false, error: {issues}};
  }
  return {success: true, data};
}

/** Validate and return the parsed form data, throwing on failure (zod parity). */
function parse(input: unknown): AlertRuleFormData {
  const result = safeParse(input);
  if (!result.success) {
    throw new AlertRuleSchemaError(result.error.issues);
  }
  return result.data;
}

/**
 * Schema applied at submit-time, exposing the zod-compatible surface
 * (`safeParse` / `parse`) the editor relies on.
 */
export const alertRuleSchema = {safeParse, parse};
