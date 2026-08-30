/**
 * CSS parser contract for the forced-colors cascade model.
 *
 * The resolver in `scripts/audit-forced-colors.mjs` can only be trusted
 * if it actually SEES every rule that declares a design token. It once
 * did not: top-level at-statements (`@tailwind base;`) open no block and
 * end in a semicolon, and the scanner left them sitting in the prelude
 * buffer. The next real selector therefore arrived as
 *
 *     "@tailwind base; @tailwind components; @tailwind utilities; :root"
 *
 * which `startsWith('@')` mistook for an at-rule CONTAINER — so the base
 * `:root` block, the largest token rule in the stylesheet, was pushed as
 * a fake media context and never recorded as a rule at all.
 *
 * The audit still produced the right answer at the time, purely because
 * nothing in that invisible block was `!important`. That is luck, not
 * correctness: any future `!important` declared there would have won in
 * the browser while the gate reported green.
 *
 * These tests pin the parse itself, so the cascade assertions in
 * `ForcedColors.contract.test.tsx` rest on a complete model.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseCssRules,
  resolveTokenWinner,
  THEME_STATES,
  // @ts-expect-error — plain ESM build script, no type declarations.
} from '../../../../scripts/audit-forced-colors.mjs';

interface ParsedDecl {
  prop: string;
  value: string;
  important: boolean;
}

interface ParsedRule {
  selector: string;
  decls: ParsedDecl[];
  media: string[];
  order: number;
}

/** Rules whose selector list contains `selector` verbatim. */
function rulesFor(rules: ParsedRule[], selector: string): ParsedRule[] {
  return rules.filter((rule) =>
    rule.selector
      .split(',')
      .map((part) => part.trim())
      .includes(selector),
  );
}

describe('parseCssRules — the real stylesheet', () => {
  const css = readFileSync(join('src', 'index.css'), 'utf8');
  const rules: ParsedRule[] = parseCssRules(css);

  it('records the base :root token block, unmediated', () => {
    // Regression guard for the `@tailwind base;` prelude bug. Before the
    // fix this was 0 and the whole block was invisible to the cascade.
    const base = rulesFor(rules, ':root').filter((rule) => rule.media.length === 0);
    expect(base.length).toBeGreaterThanOrEqual(1);

    const withSurface = base.filter((rule) =>
      rule.decls.some((decl) => decl.prop === '--surface-1'),
    );
    expect(
      withSurface,
      'the base :root rule declaring --surface-1 is missing from the parse',
    ).toHaveLength(1);

    // Non-vacuous: assert the ACTUAL authored dark-theme value, so a
    // parser that returned an empty decl list would still fail.
    const surface = withSurface[0].decls.find((d) => d.prop === '--surface-1')!;
    expect(surface.value).toMatch(/^#[0-9a-f]{6}$/i);
    expect(surface.important).toBe(false);
  });

  it('sees the base :root before the forced-colors override', () => {
    // Source order matters to the cascade, so the base block must not
    // only be present but present FIRST.
    const base = rulesFor(rules, ':root').filter((r) => r.media.length === 0);
    const forced = rulesFor(rules, ':root').filter((r) =>
      r.media.some((m) => /forced-colors/.test(m)),
    );
    expect(forced.length).toBeGreaterThanOrEqual(1);
    expect(base[0].order).toBeLessThan(forced[0].order);
  });

  it('captures the other token-bearing theme rules too', () => {
    // `:root.light-mode` is the light palette. If the parser dropped it,
    // the light-state cascade assertions would be vacuous.
    const light = rulesFor(rules, ':root.light-mode');
    expect(light.length).toBeGreaterThanOrEqual(1);
    expect(
      light.some((rule) => rule.decls.some((d) => d.prop.startsWith('--border-'))),
    ).toBe(true);
  });

  it('does not leak an at-statement into any selector', () => {
    const leaked = rules.filter((rule) => /@tailwind|@import|@charset/.test(rule.selector));
    expect(
      leaked.map((r) => r.selector),
      'an at-statement leaked into a rule prelude',
    ).toEqual([]);
  });
});

describe('parseCssRules — minimal fixtures', () => {
  it('parses a base rule that follows @tailwind at-statements', () => {
    const fixture = `
      @tailwind base;
      @tailwind components;
      @tailwind utilities;

      :root {
        --surface-1: #11151c;
        --text-primary: #f4f7fb;
      }

      @media (forced-colors: active) {
        :root {
          --surface-1: Canvas !important;
        }
      }
    `;
    const rules: ParsedRule[] = parseCssRules(fixture);

    expect(rules).toHaveLength(2);

    const [base, forced] = rules;
    expect(base.selector).toBe(':root');
    expect(base.media).toEqual([]);
    expect(base.decls).toEqual([
      { prop: '--surface-1', value: '#11151c', important: false },
      { prop: '--text-primary', value: '#f4f7fb', important: false },
    ]);

    expect(forced.selector).toBe(':root');
    expect(forced.media).toHaveLength(1);
    expect(forced.media[0]).toMatch(/forced-colors/);
    expect(forced.decls).toEqual([
      { prop: '--surface-1', value: 'Canvas', important: true },
    ]);
  });

  it('still resolves the cascade correctly across those two rules', () => {
    const fixture = `
      @tailwind base;
      :root { --surface-1: #11151c; }
      @media (forced-colors: active) {
        :root { --surface-1: Canvas !important; }
      }
    `;
    const rules = parseCssRules(fixture);
    for (const state of THEME_STATES) {
      const winner = resolveTokenWinner(rules, '--surface-1', state, new Set(['--surface-1']));
      expect(winner.source).toBe('author-important');
      expect(winner.decl.value).toBe('Canvas');
    }
  });

  it('keeps the base rule when the override is NOT important (negative control)', () => {
    // Same fixture without `!important`: the inline theme value wins, and
    // the resolver must say so rather than silently reporting the
    // forced-colors declaration.
    const fixture = `
      @tailwind base;
      :root { --surface-1: #11151c; }
      @media (forced-colors: active) {
        :root { --surface-1: Canvas; }
      }
    `;
    const rules = parseCssRules(fixture);
    for (const state of THEME_STATES) {
      const winner = resolveTokenWinner(rules, '--surface-1', state, new Set(['--surface-1']));
      expect(winner.source).toBe('inline');
    }
  });

  it('does not treat a semicolon inside a quoted prelude as a statement end', () => {
    const fixture = `
      @import url("theme;with;semicolons.css");
      :root { --surface-1: #11151c; }
    `;
    const rules: ParsedRule[] = parseCssRules(fixture);
    expect(rules).toHaveLength(1);
    expect(rules[0].selector).toBe(':root');
    expect(rules[0].decls[0].prop).toBe('--surface-1');
  });

  it('does not treat a semicolon inside a declaration value as structural', () => {
    // Declaration bodies are consumed wholesale, so a quoted `;` in a
    // value must not split the declaration or end the rule.
    const fixture = `
      @tailwind base;
      :root {
        --sep: "a;b";
        --surface-1: #11151c;
      }
    `;
    const rules: ParsedRule[] = parseCssRules(fixture);
    expect(rules).toHaveLength(1);
    expect(
      rules[0].decls.some((d) => d.prop === '--surface-1' && d.value === '#11151c'),
    ).toBe(true);
  });

  it('ignores a semicolon that appears inside a comment', () => {
    const fixture = `
      /* @tailwind base; this is prose, not a statement */
      :root { --surface-1: #11151c; }
    `;
    const rules: ParsedRule[] = parseCssRules(fixture);
    expect(rules).toHaveLength(1);
    expect(rules[0].selector).toBe(':root');
  });

  it('keeps nested at-rule context on the rules inside it', () => {
    const fixture = `
      @tailwind base;
      @media print {
        :root { --surface-1: #ffffff; }
      }
      :root { --surface-1: #11151c; }
    `;
    const rules: ParsedRule[] = parseCssRules(fixture);
    expect(rules).toHaveLength(2);
    expect(rules[0].media).toEqual(['@media print']);
    expect(rules[1].media).toEqual([]);
  });
});
