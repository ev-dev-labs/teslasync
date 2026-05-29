#!/usr/bin/env node
// RTL physical-direction utility audit.
//
// Walks every `.tsx` file under `web/src` and counts occurrences of
// Tailwind utilities whose meaning is hard-coded to LTR layout —
// `ml-*`, `mr-*`, `pl-*`, `pr-*`, `left-*`, `right-*`. These should
// progressively be migrated to logical equivalents (`ms-*`, `me-*`,
// `ps-*`, `pe-*`, `start-*`, `end-*`) so that switching to Arabic /
// Hebrew / Persian / Urdu mirrors the layout instead of leaving
// visual artefacts pointing the wrong way.
//
// The current count is surfaced both as a per-file table and as a
// single total. The script enforces a baseline budget (`MAX_PHYSICAL`)
// captured at the time RTL support landed; if a future change pushes
// the count above the budget the audit fails so the regression is
// caught at lint time. The budget should be ratcheted DOWN each time
// physical utilities are migrated.
//
// Run via `npm run audit:rtl` (also chained from CI).
//
// Detection details:
// - Only files matching `*.tsx` are scanned (logical properties
// are a JSX layout concern; `.ts` / `.json` are ignored).
// - The regex matches the utility followed by either a digit
// (`ml-3`, `pr-12`) or `auto` (`ml-auto`) or `px` / arbitrary
// bracket value (`pl-[3px]`) so that semantic-only matches like
// `mr-` inside a string are kept out.
// - Non-direction-sensitive utilities (`mx-*`, `my-*`, `inset-*`,
// `start-*`, `end-*`, `ms-*`, `me-*`, `ps-*`, `pe-*`) are NOT
// counted — they are already RTL-safe.
//
// Per-file escape hatch: a file may add `// rtl-audit:no-physical
// <reason>` near the top. The audit then ignores that file's count
// AND records the file in the "explicitly waived" tally so that the
// allowance does not silently grow.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import globPkg from 'glob';

const globSync = globPkg.globSync ?? globPkg.sync;

const ROOT = path.resolve(process.cwd(), 'src');
const FILES_GLOB = '**/*.tsx';

// Baseline budget captured when RTL support landed. The current count
// is just under this ceiling; any new physical
// utility added without a corresponding logical-property migration
// will trip the audit.
//
// Ratchet this number DOWN every time physical utilities are replaced
// with logical equivalents. Never raise it.
//
// History:
// • 395 — RTL support landing.
// • 393 — chore/repo-reorganization A1.8 (YearReviewPage + DashboardPage
// migrated 16 utilities to ms-/me-/start-/end-).
const MAX_PHYSICAL = 393;

const WAIVER_RE = /\/\/\s*rtl-audit:no-physical\b/;

// Utility patterns. Each entry matches a Tailwind utility whose
// meaning is locked to LTR layout. Bracketed arbitrary values
// (`ml-[12px]`) and modifier prefixes (`md:ml-3`, `hover:ml-3`) are
// captured by the leading non-word boundary in the test loop.
const PHYSICAL_UTILS = [
  'ml-',
  'mr-',
  'pl-',
  'pr-',
  'left-',
  'right-',
];

// A token boundary: utility must start at the beginning of a class
// list segment, after whitespace, or after a Tailwind variant
// separator (`:`). This keeps strings like `controller-` from
// accidentally matching `ller-` and prevents `border-r-` from
// counting as `r-`.
const TOKEN_BOUNDARY_RE = /(?:^|[\s"'`{:])/;
const VALUE_RE = /(?:\d|auto\b|px\b|\[)/;

function buildScannerRegex() {
  const utilities = PHYSICAL_UTILS.map((u) => u.replace('-', '\\-')).join('|');
  return new RegExp(
    `${TOKEN_BOUNDARY_RE.source}(?:[a-z]+:)*(${utilities})${VALUE_RE.source}`,
    'g',
  );
}

const SCANNER_RE = buildScannerRegex();

const files = globSync(FILES_GLOB, { cwd: ROOT });

const perFile = [];
const waived = [];
let total = 0;
for (const rel of files) {
  const full = path.join(ROOT, rel);
  const src = readFileSync(full, 'utf8');

  if (WAIVER_RE.test(src)) {
    waived.push(rel);
    continue;
  }

  let count = 0;
  // Walk every match — `String.prototype.matchAll` would also work
  // but the explicit loop keeps the per-utility counts available
  // should we want a more granular report later.
  let m;
  SCANNER_RE.lastIndex = 0;
  while ((m = SCANNER_RE.exec(src)) !== null) {
    count += 1;
  }

  if (count > 0) {
    perFile.push({ file: rel, count });
    total += count;
  }
}

perFile.sort((a, b) => b.count - a.count);

const exceedsBudget = total > MAX_PHYSICAL;

console.log(
  `[audit:rtl] scanned ${files.length} .tsx file(s) under ${ROOT}`,
);
console.log(
  `[audit:rtl] physical-direction utility hits: ${total} (budget: ${MAX_PHYSICAL})`,
);

if (waived.length > 0) {
  console.log(`[audit:rtl] waived files (// rtl-audit:no-physical): ${waived.length}`);
  for (const f of waived) {
    console.log(`  · ${f}`);
  }
}

const TOP_N = 20;
if (perFile.length > 0) {
  console.log(`[audit:rtl] top ${Math.min(TOP_N, perFile.length)} offenders:`);
  for (const row of perFile.slice(0, TOP_N)) {
    const padded = String(row.count).padStart(4, ' ');
    console.log(`  ${padded}  ${row.file}`);
  }
}

if (exceedsBudget) {
  console.error('');
  console.error(
    `[audit:rtl] FAIL — ${total} physical-direction utilities exceeds the budget of ${MAX_PHYSICAL}.`,
  );
  console.error(
    '  Migrate `ml-/mr-` → `ms-/me-`, `pl-/pr-` → `ps-/pe-`, `left-/right-` → `start-/end-`',
  );
  console.error(
    '  (Tailwind 3.3+ ships these logical-property variants natively).',
  );
  console.error(
    '  When the swap is genuinely impossible (e.g. third-party widget DOM),',
  );
  console.error(
    '  add `// rtl-audit:no-physical <reason>` to the file as an escape hatch.',
  );
  process.exit(1);
}

console.log('[audit:rtl] OK — count is at or below the baseline budget.');
process.exit(0);
