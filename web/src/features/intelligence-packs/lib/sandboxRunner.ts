/**
 * Sandbox preview runner: deterministically evaluates an installed pack's
 * formulas against the bundled synthetic sample dataset, honoring capability
 * grants and enforcing execution/row/output budgets. This is the ONLY code
 * path that turns pack data into rendered numbers — it never touches
 * `eval`/`Function`/dynamic `import()`, never opens a network connection,
 * and never renders anything other than plain numeric series consumed by
 * allowlisted shared chart primitives.
 */

import { allowedSampleFields } from './capabilityPolicy';
import { ExpressionBudgetExceededError, evaluateSeries, type ExprEvalBudget, type StepCounter } from './expressionInterpreter';
import { MAX_SANDBOX_ROWS, SAMPLE_TELEMETRY_ROWS } from './sampleTelemetry';
import type { PackCapabilityId, PackDashboardLayout, PackFormula, PackManifest, SampleRowField } from './manifestTypes';

export const SANDBOX_BUDGETS = {
  /** Total AST-node evaluations across the whole sandbox run (all formulas x all rows). */
  maxTotalSteps: 20_000,
  /** Wall-clock budget for the whole run. */
  maxDurationMs: 50,
  /** Rows fed to any single formula. */
  maxRows: MAX_SANDBOX_ROWS,
  /** Numeric points returned per formula series. */
  maxOutputPoints: 200,
} as const;

export interface FormulaRunResult {
  formulaId: string;
  label: string;
  unit?: string;
  series: number[];
  latest: number | null;
  average: number | null;
  /** Non-null when this formula's evaluation was cut short by a budget. Partial `series` is still returned. */
  budgetError: string | null;
  /** Sample-data fields this formula referenced that were denied by capability policy (evaluated as 0). */
  deniedFieldRefs: string[];
}

export interface SandboxRunResult {
  formulas: FormulaRunResult[];
  rowsUsed: number;
  totalStepsUsed: number;
  durationMs: number;
  truncated: boolean;
}

function collectFieldRefs(formula: PackFormula): string[] {
  const out: string[] = [];
  const walk = (node: PackFormula['expr']): void => {
    if (node.op === 'field') {
      out.push(node.name);
      return;
    }
    if ('arg' in node) return walk(node.arg);
    if ('args' in node) {
      for (const a of node.args) walk(a);
      return;
    }
    if ('left' in node && 'right' in node) {
      walk(node.left);
      walk(node.right);
      return;
    }
    if (node.op === 'if') {
      walk(node.cond);
      walk(node.then);
      walk(node.else);
    }
  };
  walk(formula.expr);
  return out;
}

/**
 * Runs every formula in `manifest.formulas` against the bundled sample
 * dataset. `grantedCapabilities` gates which sample fields are visible —
 * denied fields are stripped from the row (interpreter treats a missing
 * field as `0`), never thrown, so a partially-approved pack still renders a
 * legible (if less complete) preview.
 */
export function runSandboxPreview(manifest: PackManifest, grantedCapabilities: ReadonlySet<PackCapabilityId>): SandboxRunResult {
  const startedAt = Date.now();
  const steps: StepCounter = { count: 0 };
  const budget: ExprEvalBudget = {
    maxSteps: SANDBOX_BUDGETS.maxTotalSteps,
    deadlineAtMs: startedAt + SANDBOX_BUDGETS.maxDurationMs,
  };

  const rows = SAMPLE_TELEMETRY_ROWS.slice(0, SANDBOX_BUDGETS.maxRows);
  const allowed = allowedSampleFields(grantedCapabilities);
  const maskedRows = rows.map((row) => {
    const out: Record<string, number> = {};
    for (const key of Object.keys(row) as (keyof typeof row)[]) {
      if (allowed.has(key)) out[key] = row[key];
    }
    return out;
  });

  const coefficients: Record<string, number> = {};
  for (const c of manifest.coefficients) coefficients[c.name] = Math.min(c.max, Math.max(c.min, c.value));

  let truncated = false;
  const formulas: FormulaRunResult[] = manifest.formulas.map((formula) => {
    const deniedFieldRefs = Array.from(new Set(collectFieldRefs(formula).filter((f) => !allowed.has(f as SampleRowField))));
    let series: number[] = [];
    let budgetError: string | null = null;
    try {
      series = evaluateSeries(formula.expr, maskedRows, coefficients, budget, steps).slice(0, SANDBOX_BUDGETS.maxOutputPoints);
    } catch (err) {
      if (err instanceof ExpressionBudgetExceededError) {
        budgetError = err.message;
        truncated = true;
      } else {
        budgetError = 'Unexpected evaluation error.';
      }
    }
    const latest = series.length > 0 ? series[series.length - 1] : null;
    const average = series.length > 0 ? series.reduce((a, b) => a + b, 0) / series.length : null;
    return { formulaId: formula.id, label: formula.label, unit: formula.unit, series, latest, average, budgetError, deniedFieldRefs };
  });

  return {
    formulas,
    rowsUsed: maskedRows.length,
    totalStepsUsed: steps.count,
    durationMs: Date.now() - startedAt,
    truncated,
  };
}

/** Convenience: resolve a dashboard's widgets to their formula run results, preserving widget order. */
export function resolveDashboardWidgetResults(
  dashboard: PackDashboardLayout,
  run: SandboxRunResult,
): Array<{ widgetId: string; title: string; kind: string; span?: number; result: FormulaRunResult | null }> {
  const byId = new Map(run.formulas.map((f) => [f.formulaId, f]));
  return dashboard.widgets.map((w) => ({
    widgetId: w.id,
    title: w.title,
    kind: w.kind,
    span: w.span,
    result: byId.get(w.formulaRef) ?? null,
  }));
}
