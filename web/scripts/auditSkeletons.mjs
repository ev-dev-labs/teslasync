#!/usr/bin/env node
// Skeleton-loader shape consistency audit.
//
// Forward-looking guard: prevents future PRs from regressing to a bare
// `<Spinner />` as a page's primary loading state. A bare spinner causes
// the page to "pop" from empty to full when data arrives (Cumulative
// Layout Shift), whereas a shaped skeleton mirrors the real layout and
// makes the perceived load feel ~30% faster.
//
// A page in `web/src/features/**/pages/*.tsx` is flagged when BOTH of the
// following are true:
// 1. It contains `isLoading` (or similar) followed on the same logical
// JSX line by `<Spinner` — i.e., the spinner IS the loading branch.
// 2. It does NOT mention any Skeleton component anywhere in the file.
//
// Pages that already render a shaped `<XxxSkeleton>` from any branch are
// considered compliant. Inline `<Spinner>` for in-button micro-loading
// (`mutation.isPending ? <Spinner /> : <Icon />`) is intentionally allowed
// — those are not page-level loading states.
//
// This audit prevents regressions and is expected to exit 0 on a clean tree.
//
// Exit codes:
// 0 — no offenders.
// 1 — at least one offender; their paths are printed.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import globPkg from 'glob';

// glob v7 exposes `sync()`; v10+ exposes `globSync`. Support both.
const globSync = globPkg.globSync ?? globPkg.sync;

const ROOT = path.resolve(process.cwd(), 'src');
const PAGE_GLOB = 'features/**/pages/*.tsx';

// Inline spinner-only loading: `isLoading ? <Spinner …>` on the same line.
// We deliberately use single-line `.` (no `/s` flag) so that multi-line
// loading branches that build a shaped layout around a Spinner aren't
// mis-flagged.
const INLINE_SPINNER_RE = /(?:isLoading|isPending|isFetching)[^\n]*<Spinner\b/;
const SKELETON_RE = /Skeleton/;

const files = globSync(PAGE_GLOB, { cwd: ROOT });

const offenders = [];
for (const rel of files) {
  const full = path.join(ROOT, rel);
  const src = readFileSync(full, 'utf8');

  const usesSpinnerOnly = INLINE_SPINNER_RE.test(src) && !SKELETON_RE.test(src);
  if (usesSpinnerOnly) {
    offenders.push(rel);
  }
}

if (offenders.length === 0) {
  console.log(`[audit:skeletons] OK — ${files.length} page(s) checked, none rely on a bare <Spinner /> as their loading state.`);
  process.exit(0);
}

console.error('[audit:skeletons] Pages without a shaped skeleton loading state:');
for (const f of offenders) {
  console.error(`  - ${f}`);
}
console.error(
  '\nFix: define a local *Skeleton component that mirrors the real layout and ' +
    'render it from `if (isLoading) return <…Skeleton />;` instead of relying ' +
    'on a bare <Spinner />.\n' +
    'Re-usable building blocks live in @/components/feedback ' +
    '(StatGridSkeleton, ChartBlockSkeleton, TableSkeleton, PageHeaderSkeleton).',
);
process.exit(1);

