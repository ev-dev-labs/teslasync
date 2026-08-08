#!/usr/bin/env node
// Motion duration token consistency audit.
//
// Flags any raw `duration-NNN` Tailwind class outside the token system. The
// token system exposes three semantic buckets via `tailwind.config.js →
// transitionDuration`, backed by `--motion-duration-*` CSS variables in
// index.css that collapse to 0ms under `prefers-reduced-motion: reduce`:
//
// duration-fast → 150ms (hover, focus, micro-feedback)
// duration-normal → 250ms (entrance, exit, panel transitions)
// duration-slow → 400ms (page transitions, large layout shifts)
//
// Why this matters: ad-hoc Tailwind durations (`duration-200`, `duration-300`,
// `duration-500`, …) drift between components, leaving the UI feeling
// uneven — some hover effects snap, others linger. Routing every transition
// through the same three buckets keeps motion timings cohesive and ensures
// reduced-motion users get a consistent zero-duration experience.
//
// Allowed exceptions (NOT flagged because they don't match the regex):
// - framer-motion `transition={{duration: 0.2 }}` (numeric seconds)
// - Recharts `animationDuration={300}` (numeric ms prop)
// - CSS keyframe `@keyframes` blocks in *.css files (this audit only scans
// *.ts/*.tsx)
// - The `tokens.ts` file itself (excluded via the ignore list)
//
// Exit codes:
// 0 — no offenders.
// 1 — at least one offender; offender paths and the matched class strings
// are printed.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import globPkg from 'glob';

// glob v7 exposes `sync()`; v10+ exposes `globSync`. Support both.
const globSync = globPkg.globSync ?? globPkg.sync;

const ROOT = path.resolve(process.cwd(), 'src');
const FILE_GLOB = '**/*.{ts,tsx}';

// Match `duration-NNN` (one or more digits) as a whole token. We use word
// boundaries so we don't match utilities like `slide-in-from-bottom-4`
// which have `-4` at the end. The token system replacements (`duration-fast`,
// `duration-normal`, `duration-slow`) contain letters, not digits, so they
// won't match either.
const PATTERN = /\bduration-(\d+)\b/g;

// Files to skip (paths relative to web/src). The tokens module legitimately
// references the raw `duration-NNN` form for documentation; excluding it
// keeps the audit honest without forcing a circular reference.
//
// `lib/cn.test.ts` asserts that the custom `duration-fast|normal|slow` keys
// were registered into twMerge's SAME class group as the built-in numeric
// scale — proving that requires spelling a raw `duration-200` as test input.
// It ships no CSS, so it cannot cause the timing drift this audit prevents.
const IGNORED = new Set([
  'lib/tokens.ts',
  'lib/cn.test.ts',
]);

const files = globSync(FILE_GLOB, { cwd: ROOT });

const offenders = [];
for (const rel of files) {
  // Normalize Windows-style `\` to `/` so the IGNORED set matches uniformly.
  const norm = rel.split(path.sep).join('/');
  if (IGNORED.has(norm)) continue;

  const full = path.join(ROOT, rel);
  const src = readFileSync(full, 'utf8');
  const matches = [...src.matchAll(PATTERN)];
  if (matches.length > 0) {
    offenders.push({
      file: norm,
      hits: matches.map((m) => `duration-${m[1]}`).slice(0, 5),
      total: matches.length,
    });
  }
}

if (offenders.length === 0) {
  console.log(
    `[audit:motion] OK — ${files.length} file(s) checked, no raw duration-NNN classes found.`,
  );
  process.exit(0);
}

console.error('[audit:motion] Files with raw duration-NNN classes:');
console.error('  Use duration-fast | duration-normal | duration-slow instead.');
console.error('  Bucket guide: 100-180ms → fast, 200-350ms → normal, 400ms+ → slow.');
console.error('');
const SHOW = 30;
for (const o of offenders.slice(0, SHOW)) {
  const more = o.total > o.hits.length ? `, +${o.total - o.hits.length} more` : '';
  console.error(`  - ${o.file} → ${o.hits.join(', ')}${more}`);
}
if (offenders.length > SHOW) {
  console.error(`  …and ${offenders.length - SHOW} more file(s).`);
}
process.exit(1);
