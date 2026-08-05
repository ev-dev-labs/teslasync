/**
 * Parser / validator for Intelligence-Pack signed envelopes.
 *
 * Defense-in-depth ordering matters here:
 *   1. Byte-size ceiling on the raw text (before we even `JSON.parse` it).
 *   2. `JSON.parse` itself (rejects non-JSON outright).
 *   3. A generic structural walk over the *parsed, untyped* value that
 *      bounds recursion depth, total node count, string lengths, and array
 *      lengths — deliberately shape-agnostic so it protects against
 *      hostile input BEFORE any manifest-specific validation logic (which
 *      assumes reasonably-sized input) ever runs. Depth is checked BEFORE
 *      recursing further, so a pathologically deep input cannot blow the
 *      JS call stack.
 *   4. Manifest-shape validation: every field is type/range/format checked
 *      by hand (no `eval`, no dynamic `Function`, no schema-driven codegen).
 *      Unknown top-level or nested keys are rejected outright (same
 *      strictness as `lib/settingsImportSchema.ts`).
 *   5. Expression AST validation (`validateExpr`): closed op vocabulary,
 *      per-formula node-count + depth budgets, field/coefficient name
 *      allowlisting.
 *
 * Nothing in this file ever calls `eval`, `new Function`, dynamic
 * `import()`, or executes any part of the input as code.
 */

import {
  MANIFEST_LIMITS,
  PACK_CAPABILITY_IDS,
  PACK_ENVELOPE_VERSION,
  PACK_EXPR_OPS,
  PACK_VIZ_KINDS,
  SAMPLE_ROW_FIELDS,
  SUPPORTED_MANIFEST_SCHEMA_VERSIONS,
  type PackAutomationRecommendation,
  type PackCapabilityId,
  type PackCoefficient,
  type PackDashboardLayout,
  type PackDashboardWidget,
  type PackExpr,
  type PackFormula,
  type PackManifest,
  type PackSignature,
  type SampleRowField,
  type SignedPackEnvelope,
} from './manifestTypes';

export interface ParseFailure {
  ok: false;
  errors: string[];
}

export interface ParseSuccess<T> {
  ok: true;
  value: T;
}

export type ParseResult<T> = ParseSuccess<T> | ParseFailure;

const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SEMVER_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const FINGERPRINT_RE = /^[a-f0-9]{64}$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function fail(...errors: string[]): ParseFailure {
  return { ok: false, errors };
}

// ── Stage 1+2: size ceiling + JSON.parse ─────────────────────────────────

export function parseJsonWithSizeLimit(rawText: string): ParseResult<unknown> {
  if (typeof rawText !== 'string') return fail('Input must be a string.');
  const byteLength = new TextEncoder().encode(rawText).length;
  if (byteLength > MANIFEST_LIMITS.maxEnvelopeJsonBytes) {
    return fail(`Envelope is ${byteLength} bytes, exceeding the ${MANIFEST_LIMITS.maxEnvelopeJsonBytes}-byte limit.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(rawText);
  } catch {
    return fail('Input is not valid JSON.');
  }
  return { ok: true, value };
}

// ── Stage 3: shape-agnostic structural limits ────────────────────────────

/**
 * Walks an arbitrary parsed-JSON value and enforces depth/node-count/
 * string-length/array-length ceilings. Returns the first violation found,
 * or `null` if the value is within all limits. Depth is checked BEFORE
 * recursing so a malicious 50,000-deep array literal fails fast instead of
 * overflowing the stack.
 */
export function checkStructuralLimits(value: unknown): string | null {
  const nodeCounter = { count: 0 };

  function walk(node: unknown, depth: number): string | null {
    nodeCounter.count += 1;
    if (nodeCounter.count > MANIFEST_LIMITS.maxJsonNodeCount) {
      return `Envelope has more than ${MANIFEST_LIMITS.maxJsonNodeCount} JSON nodes.`;
    }
    if (depth > MANIFEST_LIMITS.maxJsonDepth) {
      return `Envelope JSON nesting exceeds ${MANIFEST_LIMITS.maxJsonDepth} levels.`;
    }
    if (typeof node === 'string') {
      if (node.length > MANIFEST_LIMITS.maxStringLength) {
        return `A string value exceeds ${MANIFEST_LIMITS.maxStringLength} characters.`;
      }
      return null;
    }
    if (Array.isArray(node)) {
      if (node.length > MANIFEST_LIMITS.maxArrayLength) {
        return `An array exceeds ${MANIFEST_LIMITS.maxArrayLength} elements.`;
      }
      for (const child of node) {
        const err = walk(child, depth + 1);
        if (err) return err;
      }
      return null;
    }
    if (node !== null && typeof node === 'object') {
      for (const key of Object.keys(node as Record<string, unknown>)) {
        if (key.length > MANIFEST_LIMITS.maxStringLength) return 'An object key is unreasonably long.';
        const err = walk((node as Record<string, unknown>)[key], depth + 1);
        if (err) return err;
      }
      return null;
    }
    // number / boolean / null — leaf, nothing further to bound.
    return null;
  }

  return walk(value, 0);
}

// ── small shared helpers ──────────────────────────────────────────────────

function isFiniteNumberInBound(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MANIFEST_LIMITS.maxAbsNumericValue;
}

function isNonEmptyString(v: unknown, maxLen: number = MANIFEST_LIMITS.maxStringLength): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= maxLen;
}

function rejectUnknownKeys(obj: Record<string, unknown>, allowed: readonly string[], where: string): string | null {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) return `Unknown field "${key}" in ${where}.`;
  }
  return null;
}

// ── Expression AST validation ─────────────────────────────────────────────

interface ExprValidationCtx {
  nodeCount: { count: number };
  coefficientNames: ReadonlySet<string>;
}

function validateExpr(node: unknown, depth: number, ctx: ExprValidationCtx): string | PackExpr {
  ctx.nodeCount.count += 1;
  if (ctx.nodeCount.count > MANIFEST_LIMITS.maxExprNodesPerFormula) {
    return `Formula expression exceeds ${MANIFEST_LIMITS.maxExprNodesPerFormula} nodes.`;
  }
  if (depth > MANIFEST_LIMITS.maxExprDepth) {
    return `Formula expression nesting exceeds ${MANIFEST_LIMITS.maxExprDepth} levels.`;
  }
  if (node == null || typeof node !== 'object' || Array.isArray(node)) {
    return 'Expression node must be an object.';
  }
  const n = node as Record<string, unknown>;
  const op = n.op;
  if (typeof op !== 'string' || !PACK_EXPR_OPS.includes(op)) {
    return `Unknown or disallowed expression operator "${String(op)}".`;
  }

  if (op === 'const') {
    const err = rejectUnknownKeys(n, ['op', 'value'], 'const expression');
    if (err) return err;
    if (!isFiniteNumberInBound(n.value)) return 'const.value must be a finite bounded number.';
    return { op: 'const', value: n.value };
  }
  if (op === 'field') {
    const err = rejectUnknownKeys(n, ['op', 'name'], 'field expression');
    if (err) return err;
    if (typeof n.name !== 'string' || !(SAMPLE_ROW_FIELDS as readonly string[]).includes(n.name)) {
      return `field.name "${String(n.name)}" is not an allowlisted sample data field.`;
    }
    return { op: 'field', name: n.name as SampleRowField };
  }
  if (op === 'coef') {
    const err = rejectUnknownKeys(n, ['op', 'name'], 'coef expression');
    if (err) return err;
    if (typeof n.name !== 'string' || !ctx.coefficientNames.has(n.name)) {
      return `coef.name "${String(n.name)}" does not reference a declared coefficient.`;
    }
    return { op: 'coef', name: n.name };
  }
  if (op === 'abs' || op === 'neg' || op === 'round' || op === 'clamp01') {
    const err = rejectUnknownKeys(n, ['op', 'arg'], `${op} expression`);
    if (err) return err;
    const arg = validateExpr(n.arg, depth + 1, ctx);
    if (typeof arg === 'string') return arg;
    return { op, arg };
  }
  if (op === 'add' || op === 'sub' || op === 'mul' || op === 'div' || op === 'min' || op === 'max' || op === 'avg') {
    const err = rejectUnknownKeys(n, ['op', 'args'], `${op} expression`);
    if (err) return err;
    if (!Array.isArray(n.args) || n.args.length < 1 || n.args.length > 8) {
      return `${op}.args must be an array of 1-8 expressions.`;
    }
    const args: PackExpr[] = [];
    for (const raw of n.args) {
      const parsed = validateExpr(raw, depth + 1, ctx);
      if (typeof parsed === 'string') return parsed;
      args.push(parsed);
    }
    return { op, args };
  }
  if (op === 'lt' || op === 'lte' || op === 'gt' || op === 'gte' || op === 'eq') {
    const err = rejectUnknownKeys(n, ['op', 'left', 'right'], `${op} expression`);
    if (err) return err;
    const left = validateExpr(n.left, depth + 1, ctx);
    if (typeof left === 'string') return left;
    const right = validateExpr(n.right, depth + 1, ctx);
    if (typeof right === 'string') return right;
    return { op, left, right };
  }
  if (op === 'if') {
    const err = rejectUnknownKeys(n, ['op', 'cond', 'then', 'else'], 'if expression');
    if (err) return err;
    const cond = validateExpr(n.cond, depth + 1, ctx);
    if (typeof cond === 'string') return cond;
    const thenB = validateExpr(n.then, depth + 1, ctx);
    if (typeof thenB === 'string') return thenB;
    const elseB = validateExpr(n.else, depth + 1, ctx);
    if (typeof elseB === 'string') return elseB;
    return { op: 'if', cond, then: thenB, else: elseB };
  }
  return `Unhandled expression operator "${op}".`;
}

// ── Manifest section validators ───────────────────────────────────────────

function validateCoefficients(raw: unknown): ParseResult<PackCoefficient[]> {
  if (!Array.isArray(raw)) return fail('coefficients must be an array.');
  if (raw.length > MANIFEST_LIMITS.maxCoefficients) {
    return fail(`coefficients exceeds the ${MANIFEST_LIMITS.maxCoefficients}-entry limit.`);
  }
  const out: PackCoefficient[] = [];
  const seen = new Set<string>();
  for (const [i, entry] of raw.entries()) {
    if (entry == null || typeof entry !== 'object') return fail(`coefficients[${i}] must be an object.`);
    const e = entry as Record<string, unknown>;
    const err = rejectUnknownKeys(e, ['name', 'value', 'min', 'max', 'description'], `coefficients[${i}]`);
    if (err) return fail(err);
    if (typeof e.name !== 'string' || !SLUG_RE.test(e.name)) return fail(`coefficients[${i}].name is not a valid identifier.`);
    if (seen.has(e.name)) return fail(`Duplicate coefficient name "${e.name}".`);
    seen.add(e.name);
    if (!isFiniteNumberInBound(e.value)) return fail(`coefficients[${i}].value must be a finite bounded number.`);
    if (!isFiniteNumberInBound(e.min)) return fail(`coefficients[${i}].min must be a finite bounded number.`);
    if (!isFiniteNumberInBound(e.max)) return fail(`coefficients[${i}].max must be a finite bounded number.`);
    if (e.min > e.max) return fail(`coefficients[${i}]: min must be <= max.`);
    if (e.value < e.min || e.value > e.max) return fail(`coefficients[${i}].value is outside [min, max].`);
    if (e.description !== undefined && !isNonEmptyString(e.description, 500)) {
      return fail(`coefficients[${i}].description must be a non-empty string when provided.`);
    }
    out.push({
      name: e.name,
      value: e.value,
      min: e.min,
      max: e.max,
      description: typeof e.description === 'string' ? e.description : undefined,
    });
  }
  return { ok: true, value: out };
}

function validateFormulas(raw: unknown, coefficientNames: ReadonlySet<string>): ParseResult<PackFormula[]> {
  if (!Array.isArray(raw)) return fail('formulas must be an array.');
  if (raw.length > MANIFEST_LIMITS.maxFormulas) return fail(`formulas exceeds the ${MANIFEST_LIMITS.maxFormulas}-entry limit.`);
  const out: PackFormula[] = [];
  const seen = new Set<string>();
  for (const [i, entry] of raw.entries()) {
    if (entry == null || typeof entry !== 'object') return fail(`formulas[${i}] must be an object.`);
    const e = entry as Record<string, unknown>;
    const err = rejectUnknownKeys(e, ['id', 'label', 'unit', 'expr'], `formulas[${i}]`);
    if (err) return fail(err);
    if (typeof e.id !== 'string' || !SLUG_RE.test(e.id)) return fail(`formulas[${i}].id is not a valid identifier.`);
    if (seen.has(e.id)) return fail(`Duplicate formula id "${e.id}".`);
    seen.add(e.id);
    if (!isNonEmptyString(e.label, 200)) return fail(`formulas[${i}].label must be a non-empty string (<=200 chars).`);
    if (e.unit !== undefined && !isNonEmptyString(e.unit, 20)) return fail(`formulas[${i}].unit must be a non-empty string (<=20 chars) when provided.`);
    const exprCtx: ExprValidationCtx = { nodeCount: { count: 0 }, coefficientNames };
    const expr = validateExpr(e.expr, 0, exprCtx);
    if (typeof expr === 'string') return fail(`formulas[${i}].expr: ${expr}`);
    out.push({ id: e.id, label: e.label, unit: typeof e.unit === 'string' ? e.unit : undefined, expr });
  }
  return { ok: true, value: out };
}

function validateDashboards(raw: unknown, formulaIds: ReadonlySet<string>): ParseResult<PackDashboardLayout[]> {
  if (!Array.isArray(raw)) return fail('dashboards must be an array.');
  if (raw.length > MANIFEST_LIMITS.maxDashboards) return fail(`dashboards exceeds the ${MANIFEST_LIMITS.maxDashboards}-entry limit.`);
  const out: PackDashboardLayout[] = [];
  const seenDash = new Set<string>();
  for (const [i, entry] of raw.entries()) {
    if (entry == null || typeof entry !== 'object') return fail(`dashboards[${i}] must be an object.`);
    const e = entry as Record<string, unknown>;
    const err = rejectUnknownKeys(e, ['id', 'title', 'widgets'], `dashboards[${i}]`);
    if (err) return fail(err);
    if (typeof e.id !== 'string' || !SLUG_RE.test(e.id)) return fail(`dashboards[${i}].id is not a valid identifier.`);
    if (seenDash.has(e.id)) return fail(`Duplicate dashboard id "${e.id}".`);
    seenDash.add(e.id);
    if (!isNonEmptyString(e.title, 200)) return fail(`dashboards[${i}].title must be a non-empty string.`);
    if (!Array.isArray(e.widgets)) return fail(`dashboards[${i}].widgets must be an array.`);
    if (e.widgets.length > MANIFEST_LIMITS.maxWidgetsPerDashboard) {
      return fail(`dashboards[${i}].widgets exceeds the ${MANIFEST_LIMITS.maxWidgetsPerDashboard}-entry limit.`);
    }
    const widgets: PackDashboardWidget[] = [];
    const seenWidget = new Set<string>();
    for (const [j, w] of (e.widgets as unknown[]).entries()) {
      if (w == null || typeof w !== 'object') return fail(`dashboards[${i}].widgets[${j}] must be an object.`);
      const wo = w as Record<string, unknown>;
      const werr = rejectUnknownKeys(wo, ['id', 'kind', 'title', 'formulaRef', 'span'], `dashboards[${i}].widgets[${j}]`);
      if (werr) return fail(werr);
      if (typeof wo.id !== 'string' || !SLUG_RE.test(wo.id)) return fail(`dashboards[${i}].widgets[${j}].id is invalid.`);
      if (seenWidget.has(wo.id)) return fail(`Duplicate widget id "${wo.id}" in dashboard "${e.id}".`);
      seenWidget.add(wo.id);
      if (typeof wo.kind !== 'string' || !(PACK_VIZ_KINDS as readonly string[]).includes(wo.kind)) {
        return fail(`dashboards[${i}].widgets[${j}].kind "${String(wo.kind)}" is not an allowlisted visualization primitive.`);
      }
      if (!isNonEmptyString(wo.title, 200)) return fail(`dashboards[${i}].widgets[${j}].title must be a non-empty string.`);
      if (typeof wo.formulaRef !== 'string' || !formulaIds.has(wo.formulaRef)) {
        return fail(`dashboards[${i}].widgets[${j}].formulaRef "${String(wo.formulaRef)}" does not reference a declared formula.`);
      }
      if (wo.span !== undefined && ![1, 2, 3, 4].includes(wo.span as number)) {
        return fail(`dashboards[${i}].widgets[${j}].span must be 1, 2, 3, or 4 when provided.`);
      }
      widgets.push({
        id: wo.id,
        kind: wo.kind as PackDashboardWidget['kind'],
        title: wo.title,
        formulaRef: wo.formulaRef,
        span: wo.span as PackDashboardWidget['span'],
      });
    }
    out.push({ id: e.id, title: e.title, widgets });
  }
  return { ok: true, value: out };
}

function validateAutomationRecommendations(raw: unknown): ParseResult<PackAutomationRecommendation[]> {
  if (!Array.isArray(raw)) return fail('automationRecommendations must be an array.');
  if (raw.length > MANIFEST_LIMITS.maxAutomationRecommendations) {
    return fail(`automationRecommendations exceeds the ${MANIFEST_LIMITS.maxAutomationRecommendations}-entry limit.`);
  }
  const out: PackAutomationRecommendation[] = [];
  const seen = new Set<string>();
  const fields = ['id', 'title', 'rationale', 'suggestedTriggerSummary', 'suggestedConditionSummary', 'suggestedActionSummary'] as const;
  for (const [i, entry] of raw.entries()) {
    if (entry == null || typeof entry !== 'object') return fail(`automationRecommendations[${i}] must be an object.`);
    const e = entry as Record<string, unknown>;
    const err = rejectUnknownKeys(e, fields, `automationRecommendations[${i}]`);
    if (err) return fail(err);
    if (typeof e.id !== 'string' || !SLUG_RE.test(e.id)) return fail(`automationRecommendations[${i}].id is invalid.`);
    if (seen.has(e.id)) return fail(`Duplicate automation recommendation id "${e.id}".`);
    seen.add(e.id);
    if (!isNonEmptyString(e.title, 200)) return fail(`automationRecommendations[${i}].title must be a non-empty string.`);
    if (!isNonEmptyString(e.rationale, 1000)) return fail(`automationRecommendations[${i}].rationale must be a non-empty string.`);
    if (!isNonEmptyString(e.suggestedTriggerSummary, 300)) return fail(`automationRecommendations[${i}].suggestedTriggerSummary must be a non-empty string.`);
    if (!isNonEmptyString(e.suggestedConditionSummary, 300)) return fail(`automationRecommendations[${i}].suggestedConditionSummary must be a non-empty string.`);
    if (!isNonEmptyString(e.suggestedActionSummary, 300)) return fail(`automationRecommendations[${i}].suggestedActionSummary must be a non-empty string.`);
    out.push({
      id: e.id,
      title: e.title,
      rationale: e.rationale,
      suggestedTriggerSummary: e.suggestedTriggerSummary,
      suggestedConditionSummary: e.suggestedConditionSummary,
      suggestedActionSummary: e.suggestedActionSummary,
    });
  }
  return { ok: true, value: out };
}

/** Validates the manifest-shaped sub-object. Assumes global structural limits already passed. */
export function validateManifestShape(raw: unknown): ParseResult<PackManifest> {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return fail('manifest must be an object.');
  const m = raw as Record<string, unknown>;
  const allowedTop = [
    'schemaVersion', 'id', 'name', 'version', 'description', 'publisher',
    'appCompatibility', 'capabilities', 'coefficients', 'formulas', 'dashboards', 'automationRecommendations',
  ];
  const topErr = rejectUnknownKeys(m, allowedTop, 'manifest');
  if (topErr) return fail(topErr);

  if (typeof m.schemaVersion !== 'number' || !SUPPORTED_MANIFEST_SCHEMA_VERSIONS.includes(m.schemaVersion)) {
    return fail(`manifest.schemaVersion ${JSON.stringify(m.schemaVersion)} is not supported by this build.`);
  }
  if (typeof m.id !== 'string' || !SLUG_RE.test(m.id)) return fail('manifest.id must be a valid identifier.');
  if (!isNonEmptyString(m.name, 200)) return fail('manifest.name must be a non-empty string.');
  if (typeof m.version !== 'string' || !SEMVER_RE.test(m.version)) return fail('manifest.version must be a semver string (x.y.z).');
  if (!isNonEmptyString(m.description, 2000)) return fail('manifest.description must be a non-empty string.');

  if (m.publisher == null || typeof m.publisher !== 'object') return fail('manifest.publisher must be an object.');
  const pub = m.publisher as Record<string, unknown>;
  const pubErr = rejectUnknownKeys(pub, ['name', 'fingerprint'], 'manifest.publisher');
  if (pubErr) return fail(pubErr);
  if (!isNonEmptyString(pub.name, 120)) return fail('manifest.publisher.name must be a non-empty string.');
  if (typeof pub.fingerprint !== 'string' || (pub.fingerprint !== '' && !FINGERPRINT_RE.test(pub.fingerprint))) {
    return fail('manifest.publisher.fingerprint must be a 64-char lowercase hex string, or empty for unsigned packs.');
  }

  if (m.appCompatibility == null || typeof m.appCompatibility !== 'object') return fail('manifest.appCompatibility must be an object.');
  const compat = m.appCompatibility as Record<string, unknown>;
  const compatErr = rejectUnknownKeys(compat, ['minAppVersion', 'maxAppVersion'], 'manifest.appCompatibility');
  if (compatErr) return fail(compatErr);
  if (typeof compat.minAppVersion !== 'string' || !SEMVER_RE.test(compat.minAppVersion)) {
    return fail('manifest.appCompatibility.minAppVersion must be a semver string.');
  }
  if (compat.maxAppVersion !== null && compat.maxAppVersion !== undefined) {
    if (typeof compat.maxAppVersion !== 'string' || !SEMVER_RE.test(compat.maxAppVersion)) {
      return fail('manifest.appCompatibility.maxAppVersion must be a semver string or null.');
    }
  }

  if (!Array.isArray(m.capabilities)) return fail('manifest.capabilities must be an array.');
  if (m.capabilities.length > MANIFEST_LIMITS.maxCapabilities) return fail('manifest.capabilities exceeds the entry limit.');
  const capabilities: PackCapabilityId[] = [];
  const capSeen = new Set<string>();
  for (const c of m.capabilities) {
    if (typeof c !== 'string' || !(PACK_CAPABILITY_IDS as readonly string[]).includes(c)) {
      return fail(`manifest.capabilities requests "${String(c)}", which is outside the capability allowlist.`);
    }
    if (!capSeen.has(c)) {
      capSeen.add(c);
      capabilities.push(c as PackCapabilityId);
    }
  }

  const coefficientsResult = validateCoefficients(m.coefficients);
  if (!coefficientsResult.ok) return coefficientsResult;
  const coefficientNames = new Set(coefficientsResult.value.map((c) => c.name));

  const formulasResult = validateFormulas(m.formulas, coefficientNames);
  if (!formulasResult.ok) return formulasResult;
  const formulaIds = new Set(formulasResult.value.map((f) => f.id));

  const dashboardsResult = validateDashboards(m.dashboards, formulaIds);
  if (!dashboardsResult.ok) return dashboardsResult;

  const automationResult = validateAutomationRecommendations(m.automationRecommendations);
  if (!automationResult.ok) return automationResult;

  return {
    ok: true,
    value: {
      schemaVersion: m.schemaVersion,
      id: m.id,
      name: m.name,
      version: m.version,
      description: m.description,
      publisher: { name: pub.name, fingerprint: pub.fingerprint },
      appCompatibility: {
        minAppVersion: compat.minAppVersion,
        maxAppVersion: (compat.maxAppVersion as string | null | undefined) ?? null,
      },
      capabilities,
      coefficients: coefficientsResult.value,
      formulas: formulasResult.value,
      dashboards: dashboardsResult.value,
      automationRecommendations: automationResult.value,
    },
  };
}

function validateSignature(raw: unknown): ParseResult<PackSignature | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'object') return fail('signature must be an object or null.');
  const s = raw as Record<string, unknown>;
  const err = rejectUnknownKeys(s, ['algorithm', 'publicKeyBase64', 'signatureBase64'], 'signature');
  if (err) return fail(err);
  if (s.algorithm !== 'Ed25519') return fail('signature.algorithm must be "Ed25519".');
  if (typeof s.publicKeyBase64 !== 'string' || !BASE64_RE.test(s.publicKeyBase64)) {
    return fail('signature.publicKeyBase64 must be base64.');
  }
  if (typeof s.signatureBase64 !== 'string' || !BASE64_RE.test(s.signatureBase64)) {
    return fail('signature.signatureBase64 must be base64.');
  }
  return { ok: true, value: { algorithm: 'Ed25519', publicKeyBase64: s.publicKeyBase64, signatureBase64: s.signatureBase64 } };
}

/**
 * Full pipeline: raw text -> size limit -> JSON.parse -> structural limits
 * -> envelope shape -> manifest shape -> expression AST validation.
 * This is the ONLY sanctioned entry point for turning untrusted text into a
 * `SignedPackEnvelope`; nothing downstream should re-parse raw JSON.
 */
export function parseSignedEnvelope(rawText: string): ParseResult<SignedPackEnvelope> {
  const parsed = parseJsonWithSizeLimit(rawText);
  if (!parsed.ok) return parsed;

  const structuralError = checkStructuralLimits(parsed.value);
  if (structuralError) return fail(structuralError);

  const value = parsed.value;
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return fail('Envelope must be a JSON object.');
  const env = value as Record<string, unknown>;
  const envErr = rejectUnknownKeys(env, ['envelopeVersion', 'manifest', 'contentDigestSha256Hex', 'signature'], 'envelope');
  if (envErr) return fail(envErr);

  if (env.envelopeVersion !== PACK_ENVELOPE_VERSION) {
    return fail(`envelope.envelopeVersion ${JSON.stringify(env.envelopeVersion)} is not supported (expected ${PACK_ENVELOPE_VERSION}).`);
  }

  const manifestResult = validateManifestShape(env.manifest);
  if (!manifestResult.ok) return manifestResult;

  if (env.contentDigestSha256Hex !== undefined) {
    if (typeof env.contentDigestSha256Hex !== 'string' || !/^[a-f0-9]{64}$/.test(env.contentDigestSha256Hex)) {
      return fail('envelope.contentDigestSha256Hex must be a 64-char lowercase hex string when provided.');
    }
  }

  const signatureResult = validateSignature(env.signature);
  if (!signatureResult.ok) return signatureResult;

  return {
    ok: true,
    value: {
      envelopeVersion: PACK_ENVELOPE_VERSION,
      manifest: manifestResult.value,
      contentDigestSha256Hex: env.contentDigestSha256Hex as string | undefined,
      signature: signatureResult.value,
    },
  };
}
