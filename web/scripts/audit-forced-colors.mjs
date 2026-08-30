/*
 * Forced-colors / Windows High Contrast audit.
 *
 * NOTE: intentionally no `#!/usr/bin/env node` shebang. Unlike the other
 * audit scripts this module is also IMPORTED (by
 * `ForcedColors.contract.test.tsx`, so the spec and the build gate share
 * one cascade resolver instead of two drifting copies). Vitest inlines
 * imported modules through `vm.Script`, which rejects a `#!` line. The
 * script is always invoked as `node scripts/audit-forced-colors.mjs`, so
 * the shebang bought nothing anyway.
 *
 * Two independent checks:
 *
 * 1. **Component coverage.** Every file in {@link CRITICAL_COMPONENTS}
 *    must carry an explicit `forced-colors:` Tailwind variant or its own
 *    `@media (forced-colors: active)` block, so the panel / chip /
 *    dialog stays perceivable when the OS overrides colours.
 *
 * 2. **Design-token cascade.** The global `@media (forced-colors:
 *    active)` block must actually WIN at runtime for the tokens the app
 *    is styled with.
 *
 * Why check #2 resolves the cascade instead of grepping for text
 * ------------------------------------------------------------
 * The first version of this audit only asserted that
 * `--surface-1: Canvas` appeared somewhere inside the media block. That
 * passed while the remap was completely inert in the browser:
 * `ThemeProvider` writes the live theme onto `<html>` as INLINE style
 * (`root.style.setProperty('--surface-1', …)`), and an inline
 * declaration outranks every normal author rule regardless of selector
 * specificity. A plain `:root { --surface-1: Canvas }` therefore lost
 * every time, and a High-Contrast user still got the near-black
 * glassmorphism surface.
 *
 * Only an `!important` author declaration beats a non-important inline
 * one (CSS Cascade 4 §6.6.1). So the audit models the real cascade —
 * author rules with their specificity and source order, plus the inline
 * declarations `ThemeProvider` is known to write — and asserts that the
 * declaration which actually wins is the system-colour one. It also
 * fails if `ThemeProvider` ever starts writing those tokens with
 * `'important'` priority, which would be unbeatable and would silently
 * re-break the remap.
 *
 * Exported so `ForcedColors.contract.test.tsx` runs the identical
 * resolver rather than a second, drifting copy of the rules.
 *
 * Run: `npm run audit:forced-colors`
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

export const CRITICAL_COMPONENTS = [
  'src/components/ui/Button.tsx',
  'src/components/ui/GlassPanel.tsx',
  'src/components/ui/Card.tsx',
  'src/components/ui/Badge.tsx',
  'src/components/ui/Modal.tsx',
  'src/components/ui/Toggle.tsx',
  'src/components/ui/Tooltip.tsx',
  'src/components/ui/DataTable.tsx',
  'src/components/feedback/Toast.tsx',
  'src/components/charts/ChartContainer.tsx',
  'src/components/maps/MapLayerSwitcher.tsx',
];

// The Tailwind variant we register in `tailwind.config.js` produces
// `forced-colors:<utility>` class names. We accept either the variant
// directly or a raw `@media (forced-colors: active)` block.
const VARIANT_RE = /\bforced-colors:[\w[\]/#-]+/;
const MEDIA_RE = /@media\s*\(\s*forced-colors\s*:\s*active\s*\)/;

/**
 * Tokens that must resolve to a system colour when forced-colors is
 * active, with the system colour each one is expected to land on.
 */
export const TOKEN_FALLBACKS = [
  ['--bg', 'Canvas'],
  ['--bg-app', 'Canvas'],
  ['--surface-1', 'Canvas'],
  ['--surface-2', 'Canvas'],
  ['--surface-3', 'Canvas'],
  ['--surface-elevated', 'Canvas'],
  ['--surface-overlay', 'Canvas'],
  ['--glass-bg', 'Canvas'],
  ['--glass-border', 'CanvasText'],
  ['--text-primary', 'CanvasText'],
  ['--text-secondary', 'CanvasText'],
  ['--text-muted', 'GrayText'],
  ['--border-subtle', 'CanvasText'],
  ['--border-default', 'CanvasText'],
  ['--border-strong', 'CanvasText'],
  ['--theme-primary', 'Highlight'],
  ['--theme-accent', 'Highlight'],
  ['--theme-on-primary', 'HighlightText'],
  ['--theme-on-accent', 'HighlightText'],
];

/** Elevation tokens must collapse to `none`; shadows are suppressed anyway. */
export const ELEVATION_TOKENS = ['--elevation-1', '--elevation-2', '--elevation-3'];

/**
 * Theme states `ThemeProvider` can put the document element into. The
 * cascade is resolved independently for each, because the light palette
 * lives behind a more specific `:root.light-mode` selector.
 */
export const THEME_STATES = [
  { name: 'dark', classes: ['dark'] },
  { name: 'light', classes: ['light-mode'] },
];

const GLOBAL_CSS = join('src', 'index.css');
const THEME_PROVIDER = join('src', 'components', 'ui', 'ThemeProvider.tsx');

/* ── CSS parsing ─────────────────────────────────────────────────────── */

/** Blank out comments so braces inside prose cannot confuse the scan. */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
}

function parseDeclarations(body) {
  const decls = [];
  for (const chunk of body.split(';')) {
    const idx = chunk.indexOf(':');
    if (idx === -1) continue;
    const prop = chunk.slice(0, idx).trim();
    if (!prop.startsWith('--')) continue;
    let value = chunk.slice(idx + 1).trim();
    const important = /!\s*important$/i.test(value);
    if (important) value = value.replace(/!\s*important$/i, '').trim();
    decls.push({ prop, value, important });
  }
  return decls;
}

/**
 * Flatten a stylesheet into `{ selector, decls, media, order }` records.
 *
 * Deliberately minimal: `index.css` nests at-rules one level deep,
 * which is all the resolver needs. Nested style rules are not supported
 * and would surface as an unmatched selector rather than a wrong
 * answer, because only declarations found directly inside a rule body
 * are collected.
 *
 * Two shapes the scanner has to get right, both of which it previously
 * got wrong:
 *
 * - **Top-level at-STATEMENTS** (`@tailwind base;`, `@import …;`,
 *   `@charset …;`) end with a semicolon and open no block. Leaving them
 *   in the prelude buffer meant the next real selector arrived as
 *   `"@tailwind base; @tailwind components; @tailwind utilities; :root"`,
 *   which `startsWith('@')` then mistook for an at-rule CONTAINER — so
 *   the base `:root` block (the largest token rule in the stylesheet)
 *   was pushed as a fake media context and never recorded as a rule at
 *   all. The cascade model was blind to it, which would have hidden any
 *   future `!important` conflict declared there.
 * - **Quoted strings** in a prelude may contain `;`, `{`, or `}`
 *   (`@import url("a;b.css");`). Structural characters are therefore
 *   only honoured outside quotes.
 *
 * Comments are blanked by {@link stripComments} before the scan, so a
 * `;` inside prose cannot reach this loop.
 */
export function parseCssRules(rawCss) {
  const css = stripComments(rawCss);
  const rules = [];
  const mediaStack = [];
  let order = 0;
  let i = 0;
  let buffer = '';
  // Quote character we are currently inside of, or null. Only tracked
  // between rules — declaration bodies are consumed wholesale below and
  // handed to `parseDeclarations`, which does its own splitting.
  let quote = null;

  while (i < css.length) {
    const ch = css[i];

    if (quote) {
      // `\\` escapes the next character, including a closing quote.
      if (ch === '\\') {
        buffer += ch + (css[i + 1] ?? '');
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      buffer += ch;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      buffer += ch;
      i += 1;
      continue;
    }

    if (ch === ';') {
      // A top-level at-statement. It opens no block, so discard it and
      // start the next prelude clean.
      buffer = '';
      i += 1;
      continue;
    }

    if (ch === '{') {
      const prelude = buffer.trim();
      buffer = '';
      if (prelude.startsWith('@')) {
        mediaStack.push(prelude);
        i += 1;
        continue;
      }
      let depth = 1;
      let j = i + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth += 1;
        else if (css[j] === '}') depth -= 1;
        if (depth > 0) j += 1;
      }
      rules.push({
        selector: prelude,
        decls: parseDeclarations(css.slice(i + 1, j)),
        media: [...mediaStack],
        order: order++,
      });
      i = j + 1;
      continue;
    }
    if (ch === '}') {
      buffer = '';
      mediaStack.pop();
    } else {
      buffer += ch;
    }
    i += 1;
  }
  return rules;
}

/* ── Cascade resolution ──────────────────────────────────────────────── */

/** Crude but sufficient specificity: [ids, classes/attrs/pseudo, elements]. */
export function specificity(selector) {
  const ids = (selector.match(/#[\w-]+/g) || []).length;
  const classes =
    (selector.match(/\.[\w-]+/g) || []).length +
    (selector.match(/\[[^\]]+\]/g) || []).length +
    (selector.match(/:(?!:)[\w-]+/g) || []).length;
  const elements = (selector.match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length;
  return [ids, classes, elements];
}

function compareSpecificity(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * Does `selector` match `<html class="…">` in the given theme state?
 *
 * Only the shapes this stylesheet actually uses are recognised;
 * anything unrecognised is treated as non-matching, which makes the
 * resolver conservative — it can under-count competitors but never
 * invents one.
 */
export function matchesRoot(selector, classes) {
  const s = selector.trim();
  if (s === ':root' || s === 'html' || s === '*') return true;
  const rooted = /^(?::root|html)((?:\.[\w-]+)+)$/.exec(s);
  if (rooted) {
    return rooted[1].split('.').filter(Boolean).every((c) => classes.includes(c));
  }
  const bare = /^((?:\.[\w-]+)+)$/.exec(s);
  if (bare) {
    return bare[1].split('.').filter(Boolean).every((c) => classes.includes(c));
  }
  return false;
}

/** Media conditions that are inactive while forced-colors is on. */
function mediaApplies(media) {
  return media.every((m) => {
    if (/@media\s+print/i.test(m)) return false;
    if (/prefers-reduced-motion/i.test(m)) return false;
    if (/prefers-contrast/i.test(m)) return false;
    return true;
  });
}

export function isForcedColorsRule(rule) {
  return rule.media.some((m) => MEDIA_RE.test(m));
}

/**
 * Resolve which declaration of `token` wins for `<html>` in `state`,
 * with forced-colors active.
 *
 * Cascade order applied (highest first):
 *   1. `!important` author declarations, by specificity then source order
 *   2. inline (non-important) declarations written by ThemeProvider
 *   3. normal author declarations, by specificity then source order
 */
export function resolveTokenWinner(rules, token, state, inlineTokens) {
  const candidates = [];
  for (const rule of rules) {
    if (!mediaApplies(rule.media)) continue;
    const matching = rule.selector
      .split(',')
      .map((s) => s.trim())
      .filter((s) => matchesRoot(s, state.classes));
    if (matching.length === 0) continue;
    const spec = matching
      .map(specificity)
      .reduce((best, cur) => (compareSpecificity(cur, best) > 0 ? cur : best));
    for (const decl of rule.decls) {
      if (decl.prop !== token) continue;
      candidates.push({
        ...decl,
        spec,
        order: rule.order,
        forcedColors: isForcedColorsRule(rule),
        selector: rule.selector.replace(/\s+/g, ' ').trim(),
      });
    }
  }

  const important = candidates.filter((c) => c.important);
  if (important.length > 0) {
    important.sort((a, b) => compareSpecificity(a.spec, b.spec) || a.order - b.order);
    return { source: 'author-important', decl: important[important.length - 1] };
  }

  if (inlineTokens.has(token)) {
    return {
      source: 'inline',
      decl: { prop: token, value: '<ThemeProvider inline>', forcedColors: false },
    };
  }

  if (candidates.length === 0) return { source: 'none', decl: null };
  candidates.sort((a, b) => compareSpecificity(a.spec, b.spec) || a.order - b.order);
  return { source: 'author-normal', decl: candidates[candidates.length - 1] };
}

/* ── ThemeProvider inspection ────────────────────────────────────────── */

/**
 * Custom properties `ThemeProvider` writes inline onto `<html>`, plus
 * any it writes with `'important'` priority — which would be unbeatable
 * and is therefore forbidden for the audited tokens.
 */
export function readThemeProviderInline(path = THEME_PROVIDER) {
  const inline = new Set();
  const importantInline = new Set();
  if (!existsSync(path)) return { inline, importantInline, found: false };
  const text = readFileSync(path, 'utf8');
  const re = /setProperty\(\s*['"`](--[\w-]+)['"`]\s*,([^)]*)\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    inline.add(m[1]);
    if (/['"`]important['"`]/.test(m[2])) importantInline.add(m[1]);
  }
  return { inline, importantInline, found: true };
}

/* ── Audit ───────────────────────────────────────────────────────────── */

export function auditForcedColors({
  cssPath = GLOBAL_CSS,
  themeProviderPath = THEME_PROVIDER,
  componentPaths = CRITICAL_COMPONENTS,
} = {}) {
  const missing = [];
  const offenders = [];
  const cascadeOffenders = [];

  for (const rel of componentPaths) {
    if (!existsSync(rel)) {
      missing.push(rel);
      continue;
    }
    const text = readFileSync(rel, 'utf8');
    if (!VARIANT_RE.test(text) && !MEDIA_RE.test(text)) offenders.push(rel);
  }

  if (!existsSync(cssPath)) {
    cascadeOffenders.push(`${cssPath} not found`);
    return { missing, offenders, cascadeOffenders };
  }

  const rules = parseCssRules(readFileSync(cssPath, 'utf8'));
  if (!rules.some(isForcedColorsRule)) {
    cascadeOffenders.push(`${cssPath} has no @media (forced-colors: active) block`);
    return { missing, offenders, cascadeOffenders };
  }

  const theme = readThemeProviderInline(themeProviderPath);
  if (!theme.found) {
    cascadeOffenders.push(
      `${themeProviderPath} not found — cannot verify inline theme tokens`,
    );
  }

  const expectations = [
    ...TOKEN_FALLBACKS,
    ...ELEVATION_TOKENS.map((t) => [t, 'none']),
  ];

  for (const token of theme.importantInline) {
    if (expectations.some(([t]) => t === token)) {
      cascadeOffenders.push(
        `${token} is written inline with 'important' priority by ThemeProvider — ` +
          `no author rule can ever beat that, so the forced-colors remap is dead`,
      );
    }
  }

  for (const state of THEME_STATES) {
    for (const [token, expected] of expectations) {
      const winner = resolveTokenWinner(rules, token, state, theme.inline);
      if (winner.source === 'none') {
        cascadeOffenders.push(
          `[${state.name}] ${token} has no forced-colors declaration at all`,
        );
        continue;
      }
      if (winner.source === 'inline') {
        cascadeOffenders.push(
          `[${state.name}] ${token} resolves to ThemeProvider's INLINE value — the ` +
            `forced-colors declaration is not !important, so it loses the cascade`,
        );
        continue;
      }
      if (!winner.decl.forcedColors) {
        cascadeOffenders.push(
          `[${state.name}] ${token} resolves to \`${winner.decl.selector} { ${token}: ` +
            `${winner.decl.value}${winner.decl.important ? ' !important' : ''} }\` — ` +
            `a rule outside the forced-colors block wins`,
        );
        continue;
      }
      if (!winner.decl.value.includes(expected)) {
        cascadeOffenders.push(
          `[${state.name}] ${token} resolves to \`${winner.decl.value}\`, expected a ` +
            `\`${expected}\` system colour`,
        );
      }
    }
  }

  return { missing, offenders, cascadeOffenders };
}

/* ── CLI ─────────────────────────────────────────────────────────────── */

function main() {
  const { missing, offenders, cascadeOffenders } = auditForcedColors();

  if (missing.length > 0) {
    console.error(
      `\nforced-colors audit: ${missing.length} critical component file(s) ` +
        `listed in the audit allow-list do not exist. Update ` +
        `CRITICAL_COMPONENTS in ${join('scripts', 'audit-forced-colors.mjs')}:`,
    );
    for (const m of missing) console.error(`  ${m}`);
    process.exit(1);
  }

  if (offenders.length > 0) {
    console.error(
      `\nforced-colors audit: ${offenders.length} critical component(s) ` +
        `lack an explicit forced-colors override:`,
    );
    for (const o of offenders) console.error(`  ${o}`);
    console.error(
      '\nAdd a `forced-colors:` Tailwind variant on the component root:\n' +
        '\n' +
        '  className={cn(\n' +
        "    'border border-[var(--border-subtle)] bg-[var(--surface-2)]',\n" +
        "    'forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]',\n" +
        '  )}\n' +
        '\n' +
        'System colours: Canvas / CanvasText, ButtonBorder / ButtonText,\n' +
        'Highlight / HighlightText, GrayText, LinkText.\n',
    );
    process.exit(1);
  }

  if (cascadeOffenders.length > 0) {
    console.error(
      `\nforced-colors audit: ${cascadeOffenders.length} design token(s) do not ` +
        `WIN the cascade when forced-colors is active:`,
    );
    for (const o of cascadeOffenders) console.error(`  ${o}`);
    console.error(
      '\nThemeProvider writes the live theme onto <html> as inline style, and an\n' +
        'inline declaration outranks every normal author rule. Mark the\n' +
        'forced-colors declarations `!important` so they win:\n' +
        '\n' +
        '  @media (forced-colors: active) {\n' +
        '    :root, :root.dark, :root.light-mode {\n' +
        '      --surface-1: Canvas !important;\n' +
        '      --text-primary: CanvasText !important;\n' +
        '      --theme-primary: Highlight !important;\n' +
        '    }\n' +
        '  }\n' +
        '\n' +
        "Never call setProperty(..., 'important') for these tokens in\n" +
        'ThemeProvider — an important inline declaration is unbeatable.\n',
    );
    process.exit(1);
  }

  console.log(
    `OK — ${CRITICAL_COMPONENTS.length} critical components carry a forced-colors ` +
      `override, and ${TOKEN_FALLBACKS.length + ELEVATION_TOKENS.length} design tokens ` +
      `win the cascade in both theme states`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
