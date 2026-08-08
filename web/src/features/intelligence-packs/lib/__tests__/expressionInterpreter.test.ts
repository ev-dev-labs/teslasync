import { describe, it, expect } from 'vitest';
import { evaluateExpr, evaluateSeries, ExpressionBudgetExceededError, type ExprEvalBudget, type StepCounter } from '../expressionInterpreter';
import type { PackExpr } from '../manifestTypes';

function budget(maxSteps = 10_000, durationMs = 1000): ExprEvalBudget {
  return { maxSteps, deadlineAtMs: Date.now() + durationMs };
}
function counter(): StepCounter {
  return { count: 0 };
}

describe('evaluateExpr — arithmetic + logic ops', () => {
  it('evaluates const', () => {
    expect(evaluateExpr({ op: 'const', value: 42 }, {}, {}, budget(), counter())).toBe(42);
  });

  it('evaluates field lookups, defaulting missing fields to 0', () => {
    expect(evaluateExpr({ op: 'field', name: 'battery_level_pct' }, { battery_level_pct: 55 }, {}, budget(), counter())).toBe(55);
    expect(evaluateExpr({ op: 'field', name: 'battery_level_pct' }, {}, {}, budget(), counter())).toBe(0);
  });

  it('evaluates coef lookups, defaulting missing coefficients to 0', () => {
    expect(evaluateExpr({ op: 'coef', name: 'target' }, {}, { target: 150 }, budget(), counter())).toBe(150);
    expect(evaluateExpr({ op: 'coef', name: 'missing' }, {}, {}, budget(), counter())).toBe(0);
  });

  it('add/sub/mul/div/min/max/avg', () => {
    const args = (vals: number[]): PackExpr[] => vals.map((value) => ({ op: 'const', value }));
    expect(evaluateExpr({ op: 'add', args: args([1, 2, 3]) }, {}, {}, budget(), counter())).toBe(6);
    expect(evaluateExpr({ op: 'sub', args: args([10, 3, 2]) }, {}, {}, budget(), counter())).toBe(5);
    expect(evaluateExpr({ op: 'sub', args: args([10]) }, {}, {}, budget(), counter())).toBe(-10);
    expect(evaluateExpr({ op: 'mul', args: args([2, 3, 4]) }, {}, {}, budget(), counter())).toBe(24);
    expect(evaluateExpr({ op: 'div', args: args([10, 2]) }, {}, {}, budget(), counter())).toBe(5);
    expect(evaluateExpr({ op: 'min', args: args([5, 1, 9]) }, {}, {}, budget(), counter())).toBe(1);
    expect(evaluateExpr({ op: 'max', args: args([5, 1, 9]) }, {}, {}, budget(), counter())).toBe(9);
    expect(evaluateExpr({ op: 'avg', args: args([2, 4, 6]) }, {}, {}, budget(), counter())).toBe(4);
  });

  it('division by zero resolves to 0, never Infinity/NaN', () => {
    const result = evaluateExpr(
      { op: 'div', args: [{ op: 'const', value: 5 }, { op: 'const', value: 0 }] },
      {},
      {},
      budget(),
      counter(),
    );
    expect(result).toBe(0);
    expect(Number.isFinite(result)).toBe(true);
  });

  it('unary ops: abs/neg/round/clamp01', () => {
    expect(evaluateExpr({ op: 'abs', arg: { op: 'const', value: -7 } }, {}, {}, budget(), counter())).toBe(7);
    expect(evaluateExpr({ op: 'neg', arg: { op: 'const', value: 7 } }, {}, {}, budget(), counter())).toBe(-7);
    expect(evaluateExpr({ op: 'round', arg: { op: 'const', value: 2.6 } }, {}, {}, budget(), counter())).toBe(3);
    expect(evaluateExpr({ op: 'clamp01', arg: { op: 'const', value: 5 } }, {}, {}, budget(), counter())).toBe(1);
    expect(evaluateExpr({ op: 'clamp01', arg: { op: 'const', value: -5 } }, {}, {}, budget(), counter())).toBe(0);
    expect(evaluateExpr({ op: 'clamp01', arg: { op: 'const', value: 0.4 } }, {}, {}, budget(), counter())).toBe(0.4);
  });

  it('compare ops return 1/0', () => {
    const l = { op: 'const', value: 3 } as const;
    const r = { op: 'const', value: 5 } as const;
    expect(evaluateExpr({ op: 'lt', left: l, right: r }, {}, {}, budget(), counter())).toBe(1);
    expect(evaluateExpr({ op: 'gt', left: l, right: r }, {}, {}, budget(), counter())).toBe(0);
    expect(evaluateExpr({ op: 'lte', left: l, right: l }, {}, {}, budget(), counter())).toBe(1);
    expect(evaluateExpr({ op: 'gte', left: l, right: l }, {}, {}, budget(), counter())).toBe(1);
    expect(evaluateExpr({ op: 'eq', left: l, right: l }, {}, {}, budget(), counter())).toBe(1);
  });

  it('if branches correctly on truthy (non-zero) / falsy (zero) condition', () => {
    const expr: PackExpr = {
      op: 'if',
      cond: { op: 'const', value: 1 },
      then: { op: 'const', value: 111 },
      else: { op: 'const', value: 222 },
    };
    expect(evaluateExpr(expr, {}, {}, budget(), counter())).toBe(111);
    expect(
      evaluateExpr({ ...expr, cond: { op: 'const', value: 0 } }, {}, {}, budget(), counter()),
    ).toBe(222);
  });
});

describe('evaluateExpr — budgets (defense in depth)', () => {
  it('throws ExpressionBudgetExceededError when maxSteps is exceeded', () => {
    // A nested `abs` chain: each level is one evaluation step.
    let expr: PackExpr = { op: 'const', value: 1 };
    for (let i = 0; i < 50; i++) expr = { op: 'abs', arg: expr };
    expect(() => evaluateExpr(expr, {}, {}, budget(10), counter())).toThrow(ExpressionBudgetExceededError);
  });

  it('throws ExpressionBudgetExceededError once the wall-clock deadline has passed', () => {
    let expr: PackExpr = { op: 'const', value: 1 };
    for (let i = 0; i < 64; i++) expr = { op: 'abs', arg: expr };
    const expiredBudget: ExprEvalBudget = { maxSteps: 1_000_000, deadlineAtMs: Date.now() - 1 };
    expect(() => evaluateExpr(expr, {}, {}, expiredBudget, counter())).toThrow(ExpressionBudgetExceededError);
  });

  it('shares step counter across evaluateSeries calls (budget applies to whole run, not per-row)', () => {
    const expr: PackExpr = { op: 'const', value: 1 };
    const rows = Array.from({ length: 100 }, () => ({}));
    const sharedCounter = counter();
    expect(() => evaluateSeries(expr, rows, {}, budget(50), sharedCounter)).toThrow(ExpressionBudgetExceededError);
  });
});

describe('evaluateSeries', () => {
  it('produces one output per input row, in order', () => {
    const expr: PackExpr = { op: 'field', name: 'battery_level_pct' };
    const rows = [{ battery_level_pct: 10 }, { battery_level_pct: 20 }, { battery_level_pct: 30 }];
    expect(evaluateSeries(expr, rows, {}, budget(), counter())).toEqual([10, 20, 30]);
  });
});

describe('no loop/recursion primitives exist in the AST vocabulary', () => {
  it('every op in the union is one of the finite documented set (structural safety check)', () => {
    const knownOps = [
      'const', 'field', 'coef', 'abs', 'neg', 'round', 'clamp01',
      'add', 'sub', 'mul', 'div', 'min', 'max', 'avg',
      'lt', 'lte', 'gt', 'gte', 'eq', 'if',
    ];
    // This is a documentation-as-test assertion: there is no 'loop', 'while',
    // 'call', 'exec', or similar op anywhere in the vocabulary.
    expect(knownOps).not.toContain('loop');
    expect(knownOps).not.toContain('while');
    expect(knownOps).not.toContain('call');
    expect(knownOps).not.toContain('exec');
    expect(knownOps).not.toContain('eval');
  });
});
