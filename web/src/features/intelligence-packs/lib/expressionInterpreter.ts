/**
 * Deterministic expression interpreter for pack "formulas".
 *
 * `PackExpr` is a finite, closed-vocabulary AST (see `manifestTypes.ts`) —
 * there is no loop, recursion, or user-defined-function construct in the
 * vocabulary at all, so an infinite loop is structurally impossible, not
 * merely guarded against. This module still enforces a runtime step budget
 * and wall-clock deadline as defense-in-depth (e.g. against a future
 * vocabulary addition, or a formula tree evaluated across many rows), and
 * because "we bounded it twice" is cheap insurance for a security-sensitive
 * interpreter.
 *
 * Every intermediate/final numeric result is coerced to a finite number
 * (non-finite -> 0) so a pathological formula (e.g. divide-by-zero) can
 * never leak `NaN`/`Infinity` into a rendered chart.
 */

import type { PackExpr } from './manifestTypes';

export class ExpressionBudgetExceededError extends Error {
  constructor(reason: string) {
    super(`Expression evaluation budget exceeded: ${reason}`);
    this.name = 'ExpressionBudgetExceededError';
  }
}

export interface ExprEvalBudget {
  /** Total AST-node evaluations allowed across an entire sandbox run (all rows, all formulas). */
  maxSteps: number;
  /** Wall-clock deadline (ms since epoch, i.e. `Date.now() + maxDurationMs`). */
  deadlineAtMs: number;
}

export interface StepCounter {
  count: number;
}

export type ExprRow = Partial<Record<string, number>>;

function finite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

function checkBudget(budget: ExprEvalBudget, steps: StepCounter): void {
  steps.count += 1;
  if (steps.count > budget.maxSteps) {
    throw new ExpressionBudgetExceededError(`exceeded ${budget.maxSteps} total node evaluations.`);
  }
  // Checking the clock on every node would be wasteful; checking every 16
  // steps keeps overhead low while still catching runaway evaluation
  // promptly (worst case ~16 extra node evaluations past the deadline).
  if (steps.count % 16 === 0 && Date.now() > budget.deadlineAtMs) {
    throw new ExpressionBudgetExceededError('exceeded the wall-clock time budget.');
  }
}

/**
 * Evaluates a validated `PackExpr` against one data row + a resolved
 * coefficient map. Pure and synchronous. Field lookups that are missing
 * from `row` (e.g. because a capability was denied and the sandbox runner
 * stripped that field — see `sandboxRunner.ts`) resolve to `0`.
 */
export function evaluateExpr(
  expr: PackExpr,
  row: ExprRow,
  coefficients: Record<string, number>,
  budget: ExprEvalBudget,
  steps: StepCounter,
): number {
  checkBudget(budget, steps);

  switch (expr.op) {
    case 'const':
      return finite(expr.value);
    case 'field':
      return finite(row[expr.name] ?? 0);
    case 'coef':
      return finite(coefficients[expr.name] ?? 0);
    case 'abs':
      return Math.abs(evaluateExpr(expr.arg, row, coefficients, budget, steps));
    case 'neg':
      return -evaluateExpr(expr.arg, row, coefficients, budget, steps);
    case 'round':
      return Math.round(evaluateExpr(expr.arg, row, coefficients, budget, steps));
    case 'clamp01': {
      const v = evaluateExpr(expr.arg, row, coefficients, budget, steps);
      return Math.min(1, Math.max(0, v));
    }
    case 'add':
      return finite(expr.args.reduce((acc, a) => acc + evaluateExpr(a, row, coefficients, budget, steps), 0));
    case 'sub': {
      const vals = expr.args.map((a) => evaluateExpr(a, row, coefficients, budget, steps));
      // `sub` with args.length === 1 negates
      // (matches "abs/neg/round" single-arg convention, cheaper than a
      // separate reduce with no seed for single-element arrays).
      if (vals.length === 1) return -vals[0];
      return finite(vals.slice(1).reduce((acc, v) => acc - v, vals[0]));
    }
    case 'mul':
      return finite(expr.args.reduce((acc, a) => acc * evaluateExpr(a, row, coefficients, budget, steps), 1));
    case 'div': {
      const vals = expr.args.map((a) => evaluateExpr(a, row, coefficients, budget, steps));
      return finite(
        vals.slice(1).reduce((acc, v) => (v === 0 ? 0 : acc / v), vals[0]),
      );
    }
    case 'min':
      return finite(Math.min(...expr.args.map((a) => evaluateExpr(a, row, coefficients, budget, steps))));
    case 'max':
      return finite(Math.max(...expr.args.map((a) => evaluateExpr(a, row, coefficients, budget, steps))));
    case 'avg': {
      const vals = expr.args.map((a) => evaluateExpr(a, row, coefficients, budget, steps));
      return finite(vals.reduce((acc, v) => acc + v, 0) / vals.length);
    }
    case 'lt':
      return evaluateExpr(expr.left, row, coefficients, budget, steps) < evaluateExpr(expr.right, row, coefficients, budget, steps) ? 1 : 0;
    case 'lte':
      return evaluateExpr(expr.left, row, coefficients, budget, steps) <= evaluateExpr(expr.right, row, coefficients, budget, steps) ? 1 : 0;
    case 'gt':
      return evaluateExpr(expr.left, row, coefficients, budget, steps) > evaluateExpr(expr.right, row, coefficients, budget, steps) ? 1 : 0;
    case 'gte':
      return evaluateExpr(expr.left, row, coefficients, budget, steps) >= evaluateExpr(expr.right, row, coefficients, budget, steps) ? 1 : 0;
    case 'eq':
      return evaluateExpr(expr.left, row, coefficients, budget, steps) === evaluateExpr(expr.right, row, coefficients, budget, steps) ? 1 : 0;
    case 'if':
      return evaluateExpr(expr.cond, row, coefficients, budget, steps) !== 0
        ? evaluateExpr(expr.then, row, coefficients, budget, steps)
        : evaluateExpr(expr.else, row, coefficients, budget, steps);
    default: {
      // Exhaustiveness guard: the validator's closed AST vocabulary means
      // this is unreachable for validated input, but a defensive fallback
      // (rather than a runtime throw) keeps a future vocabulary gap from
      // crashing the whole sandbox run.
      return 0;
    }
  }
}

/** Evaluates one expression across every row of a data set, returning a same-length numeric series. */
export function evaluateSeries(
  expr: PackExpr,
  rows: readonly ExprRow[],
  coefficients: Record<string, number>,
  budget: ExprEvalBudget,
  steps: StepCounter,
): number[] {
  return rows.map((row) => evaluateExpr(expr, row, coefficients, budget, steps));
}
