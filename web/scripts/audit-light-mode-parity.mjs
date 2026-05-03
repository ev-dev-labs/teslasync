#!/usr/bin/env node
// Phase-45 / Prompt 08 — Light-mode CSS-var parity audit.
//
// Lists Tailwind class literals that bypass the CSS-var token vocabulary
// established in web/src/index.css (Phase-40 / Prompt 10). Every surface
// color, text color, and border in the app must resolve through a project
// token (`var(--text-primary)`, `var(--surface-1)`, `var(--border-subtle)`,
// etc.) so toggling `data-theme="light"` re-resolves the entire palette
// without per-component overrides.
//
// Exits with code 1 when violations exceed LIGHT_MODE_ALLOWED_DRIFT
// (default 0). Use the env var only as a temporary escape hatch while a
// large refactor lands; the long-term target is zero.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import globPkg from 'glob';

// glob v7 (CJS) exposes `sync()`; v10+ (ESM) exposes `globSync`. Support both.
const globSync = globPkg.globSync ?? globPkg.sync;

const ROOT = path.resolve(process.cwd(), 'src');

// Patterns that bypass the token vocabulary. Each entry is the regex source.
const VIOLATION_PATTERNS = [
  {
    id: 'text-white-literal',
    re: /text-white\/(\d+)/g,
    advice: 'use text-[var(--text-primary)] / text-[var(--text-secondary)] / text-[var(--text-muted)]',
  },
  {
    id: 'bg-slate-dark-literal',
    re: /bg-slate-(800|900|950)(\/\d+)?/g,
    advice: 'use bg-[var(--surface-1)] / bg-[var(--surface-2)] / bg-[var(--bg-app)]',
  },
  {
    id: 'bg-black-literal',
    re: /bg-black\/(\d+)/g,
    advice: 'use bg-[var(--surface-overlay)]',
  },
  {
    id: 'border-white-literal',
    re: /border-white\/(\d+)/g,
    advice: 'use border-[var(--border-subtle)] / border-[var(--border-strong)]',
  },
  {
    id: 'text-gray-literal',
    re: /text-gray-(300|400|500)(\/\d+)?/g,
    advice: 'use text-[var(--text-muted)] / text-[var(--text-secondary)]',
  },
  {
    id: 'bg-white-literal',
    re: /bg-white\/(\d+)/g,
    advice: 'use bg-[var(--surface-2)]',
  },
];

// Files that are allowed to use raw colors. Each entry is matched as a
// substring of the file path relative to web/src. Document why each entry
// is exempt next to it so future audits can re-evaluate.
const EXEMPT_FILES = [
  // Token definitions themselves — they are the source of the vocabulary.
  'lib/tokens.ts',
  'lib/tokens/',
  'index.css',
  // Recharts wrapperStyle/contentStyle objects use intentional fixed
  // contrast that does not flip with the theme; the chart palette is
  // theme-locked by design (see "Out of scope" in phase-45/08).
  'components/charts/',
  // Theme primitives that map raw Tailwind tokens to CSS vars.
  'components/theme/',
];

const files = globSync('**/*.{tsx,ts}', {
  cwd: ROOT,
  ignore: ['**/__tests__/**', '**/*.test.*', '**/*.spec.*', '**/*.d.ts'],
});

const findings = [];

for (const rel of files) {
  if (EXEMPT_FILES.some((e) => rel.includes(e))) continue;
  const full = path.join(ROOT, rel);
  const src = readFileSync(full, 'utf8');
  const lines = src.split(/\r?\n/);
  for (const { id, re, advice } of VIOLATION_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      const lineIdx = src.slice(0, m.index).split(/\r?\n/).length - 1;
      findings.push({
        file: rel,
        line: lineIdx + 1,
        id,
        match: m[0],
        advice,
        snippet: lines[lineIdx]?.trim() ?? '',
      });
    }
  }
}

// Group by id for the summary footer.
const counts = findings.reduce((acc, f) => {
  acc[f.id] = (acc[f.id] ?? 0) + 1;
  return acc;
}, {});

for (const f of findings) {
  console.log(`${f.file}:${f.line}  [${f.id}]  ${f.match}  →  ${f.advice}`);
}

console.log(`\nTotal violations: ${findings.length}`);
for (const [id, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${id.padEnd(28)} ${n}`);
}

const ALLOWED_DRIFT = Number(process.env.LIGHT_MODE_ALLOWED_DRIFT ?? 0);
console.log(`\nAllowed drift (LIGHT_MODE_ALLOWED_DRIFT): ${ALLOWED_DRIFT}`);

if (findings.length > ALLOWED_DRIFT) {
  console.error(
    `\nFAIL: ${findings.length} violations exceeds allowed drift ${ALLOWED_DRIFT}.\n` +
      'Replace literal Tailwind color classes with the CSS-var token equivalents.\n' +
      'See web/src/index.css for the token vocabulary.',
  );
  process.exit(1);
}

console.log('\nOK — light-mode CSS-var parity holds.');
process.exit(0);
