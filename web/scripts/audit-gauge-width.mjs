#!/usr/bin/env node
/**
 * LinearGauge width audit.
 *
 * `LinearGauge` replaced the app's radial gauges. A ring had an intrinsic
 * size (`size` was a pixel diameter), so it laid out correctly wherever it
 * was dropped. A bar has no intrinsic width — its root is `w-full` and it
 * takes its width from the parent. That difference silently breaks three
 * layouts that were perfectly fine for rings:
 *
 *   1. A shrink-to-fit parent (`inline-flex`, `w-fit`, `w-max`). The parent
 *      sizes to its content while the child asks for 100% of the parent —
 *      a cyclic dependency browsers resolve by collapsing the bar to
 *      min-content, i.e. a barely-visible sliver.
 *   2. A wrapping gauge row (`flex flex-wrap`). Each `w-full` bar claims a
 *      whole line, so a tidy row of six gauges becomes six stacked
 *      full-width bars and the panel grows enormously tall.
 *   3. A gauge sharing a flex row with a `flex-1` sibling (the common
 *      "gauge beside a detail list" card). Both compete for the same space
 *      and the result depends on flex-shrink rounding rather than intent.
 *
 * None of these fail a type-check or a jsdom test, because jsdom has no
 * layout engine — they are only visible in a real browser. This audit is
 * therefore the only automated guard, and it is why it exists.
 *
 * THE RULE: a `<LinearGauge>` whose nearest enclosing element is a
 * horizontal flex container (or a shrink-to-fit box) MUST declare its own
 * width — `w-<n>`, `w-full`, `max-w-*`, `flex-1`, `basis-*` or `grow` — via
 * `className`. `cn()` uses tailwind-merge, so a `className` width cleanly
 * overrides the component's base `w-full`.
 *
 * Grid parents are fine: a grid item is sized by its track, so `w-full`
 * resolves against a real width. `flex-col` parents are fine for the same
 * reason (cross-axis stretch gives the child the container width).
 *
 * Why a regex walker rather than a JSX parser: matches the existing audit
 * scripts in this directory — fast, dependency-free, runs in CI and
 * pre-commit without pulling in @babel/parser.
 *
 * Exit 0 on success, 1 with per-file FAIL lines (file:line) on regression.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(SCRIPT_DIR, '..');
const SRC_ROOT = resolve(WEB_ROOT, 'src');

/** Parents that cannot give a percentage-width child a real width. */
const HORIZONTAL_FLEX_RE = /\bflex\b(?![-\w])/;
const COLUMN_RE = /\bflex-col\b/;
const SHRINK_TO_FIT_RE = /\b(inline-flex|inline-grid|w-fit|w-max|w-min)\b/;

/** Width declarations that settle the question on the gauge itself. */
const SELF_WIDTH_RE = /className=\{?["'`][^"'`]*\b(w-\d+(\.\d+)?|w-full|w-fit|w-\[[^\]]+\]|max-w-[\w[\]]+|flex-1|grow|basis-[\w[\]]+)\b/;

/** How far back to look for the enclosing element's className. */
const LOOKBACK_LINES = 6;
/** How far forward the gauge's own opening tag may run. */
const TAG_LINES = 16;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '__snapshots__') continue;
      walk(full, out);
    } else if (entry.endsWith('.tsx') && !entry.includes('.test.')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The className of the element that encloses the gauge, or null when the
 * nearest preceding element carries none (in which case we cannot judge and
 * deliberately stay silent rather than guess).
 */
function enclosingClassName(lines, index) {
  for (let i = index - 1; i >= Math.max(0, index - LOOKBACK_LINES); i--) {
    const match = lines[i].match(/className=(?:\{)?["'`]([^"'`]*)/);
    if (match) return match[1];
  }
  return null;
}

const failures = [];
let scannedFiles = 0;
let gauges = 0;

for (const file of walk(SRC_ROOT)) {
  const source = readFileSync(file, 'utf8');
  if (!source.includes('<LinearGauge')) continue;
  scannedFiles += 1;

  const lines = source.split('\n');
  lines.forEach((line, index) => {
    if (!line.includes('<LinearGauge')) return;
    gauges += 1;

    const openingTag = lines.slice(index, index + TAG_LINES).join('\n').split('/>')[0];
    if (SELF_WIDTH_RE.test(openingTag)) return;

    const parent = enclosingClassName(lines, index);
    if (parent === null) return;

    const isHorizontalFlex = HORIZONTAL_FLEX_RE.test(parent) && !COLUMN_RE.test(parent);
    const isShrinkToFit = SHRINK_TO_FIT_RE.test(parent);
    if (!isHorizontalFlex && !isShrinkToFit) return;

    failures.push({
      file: relative(WEB_ROOT, file).replace(/\\/g, '/'),
      line: index + 1,
      parent: parent.trim().slice(0, 70),
      reason: isShrinkToFit
        ? 'shrink-to-fit parent collapses a percentage-width bar to min-content'
        : 'horizontal flex parent gives the bar no width of its own',
    });
  });
}

console.log(
  `[audit:gauge-width] scanned ${scannedFiles} file(s) / ${gauges} LinearGauge(s); failures=${failures.length}`,
);

if (failures.length > 0) {
  console.error('\n[audit:gauge-width] FAIL — gauges without a resolvable width:\n');
  for (const f of failures) {
    console.error(`  ${f.file}:${f.line}`);
    console.error(`    parent: ${f.parent}`);
    console.error(`    ${f.reason}`);
    console.error(
      '    fix: add an explicit width to the gauge (e.g. className="w-32 shrink-0"',
    );
    console.error('         or className="max-w-xs"), or lay the parent out as a grid.\n');
  }
  process.exit(1);
}

console.log('[audit:gauge-width] OK — every gauge resolves to a real width.');
