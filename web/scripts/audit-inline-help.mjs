#!/usr/bin/env node
/**
 * Inline-help (`<HelpIcon>`) coverage audit.
 *
 * Asserts that the four high-confusion form surfaces — Settings,
 * AlertStudio, Automation Builder, Notification Channels — each carry
 * at least the configured minimum number of `<HelpIcon>` adoptions.
 *
 * Why this design (vs. JSX-walking each `<Label>`):
 * The richer "every Label needs a HelpIcon sibling" check produces a
 * long tail of false positives on toggle rows, single-select buttons,
 * and conditional editors. The simpler per-target minimum count
 * captures the intended target ("≥ 25 fields gain inline help") and
 * prevents regression without manual JSX parsing.
 *
 * Each TARGETS entry is either a single.tsx file or a directory; for
 * directories we recursively scan every.tsx file (excluding tests).
 * The audit counts occurrences of `<HelpIcon` (opening tag) plus
 * `HelpIcon` import statements — the import alone doesn't count, only
 * actual JSX usage.
 *
 * Allowlist:
 * `web/src/lib/inlineHelpAllowlist.ts` lists i18n keys that are
 * explicitly excused from inline help (self-evident fields like
 * "Name", "Email"). The audit reads it for visibility only — pages
 * that exclusively bind allowlisted fields are still required to
 * meet the minimum count from non-allowlisted fields.
 *
 * Run from anywhere; paths resolve from the script's own location, not
 * `process.cwd()`. Exit 0 = all targets meet their minimums and the
 * total adoption count is ≥ TOTAL_MIN; exit 1 + per-file MISSING_HELP[…]
 * lines when the audit regresses.
 */
import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(SCRIPT_DIR, '..');
const SRC_ROOT = resolve(WEB_ROOT, 'src');

/**
 * Per-target adoption budget. `path` is relative to `web/`; either a
 * single.tsx file or a directory we recursively scan. `min` is the
 * minimum number of `<HelpIcon` JSX usages the target must contain.
 */
const TARGETS = [
  {
    name: 'settings',
    path: 'src/features/settings',
    min: 6,
  },
  {
    name: 'alert-studio',
    path: 'src/features/notifications/pages/AlertStudioPage.tsx',
    min: 6,
  },
  {
    name: 'automation-builder',
    path: 'src/features/automations',
    min: 6,
  },
  {
    name: 'notification-channels',
    // The former single-file NotificationChannelsView.tsx was decomposed into
    // this directory (ChannelCard / ChannelFormModal / ChannelProvidersPanel /
    // ChannelsGrid / ChannelStatsBand). Point at the directory so the target
    // survives further decomposition inside it.
    path: 'src/features/notifications/components/channels',
    min: 4,
  },
];

// Minimum total HelpIcon adoptions across every target combined.
const TOTAL_MIN = 25;

// Each opening tag like `<HelpIcon` (with a word boundary so `HelpIconBox`
// or similar wouldn't be miscounted). Matches both `<HelpIcon ` (props)
// and `<HelpIcon/>` (no props).
const HELP_ICON_TAG_RE = /<HelpIcon\b/g;

// Sites that pass `help={...}` to a UI primitive (Input/Select/Textarea/
// SettingField). Each renders a HelpIcon internally — counting the prop
// usage gives credit to surfaces that adopt help via the cleaner declarative
// API instead of inlining the icon themselves.
const HELP_PROP_RE = /\bhelp=\{/g;

// Skip *.test.tsx files in directory scans — adoption in tests doesn't
// count toward production coverage.
function isTestFile(file) {
  return /\.test\.tsx?$/.test(file) || file.includes('__tests__');
}

function gatherTsxFiles(root) {
  const out = [];
  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (name === 'node_modules' || name === '__tests__') continue;
        walk(full);
      } else if (stat.isFile()) {
        if (!/\.tsx?$/.test(name)) continue;
        if (isTestFile(full)) continue;
        out.push(full);
      }
    }
  }
  walk(root);
  return out;
}

function countHelpIconUsage(absPath) {
  let src;
  try {
    src = readFileSync(absPath, 'utf8');
  } catch {
    return { count: 0, found: false };
  }
  // Strip the file's own primitive definitions so an Input.tsx / Select.tsx
  // / SettingField.tsx implementation doesn't self-credit by parameterising
  // its own `help` prop. Each primitive contributes only when an adopting
  // page passes the prop in.
  const isPrimitiveDef = /\bcomponents\b[\\/]ui\b|\bSettingField\.tsx$/.test(absPath);
  const helpIconMatches = src.match(HELP_ICON_TAG_RE);
  const helpIconCount = helpIconMatches ? helpIconMatches.length : 0;
  let helpPropCount = 0;
  if (!isPrimitiveDef) {
    const helpPropMatches = src.match(HELP_PROP_RE);
    helpPropCount = helpPropMatches ? helpPropMatches.length : 0;
  }
  return { count: helpIconCount + helpPropCount, found: true };
}

function readAllowlist() {
  const file = resolve(SRC_ROOT, 'lib', 'inlineHelpAllowlist.ts');
  if (!existsSync(file)) return [];
  const src = readFileSync(file, 'utf8');
  // Pull every quoted i18n key out of the exported array. We don't try
  // to parse TypeScript — a regex over the source is enough for the
  // visibility line we print at the end of the run.
  const keys = [];
  const re = /['"]([a-z][a-zA-Z0-9_.]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m[1].includes('.')) keys.push(m[1]);
  }
  return keys;
}

const allowlist = readAllowlist();

const report = [];
const failures = [];
let totalAdoptions = 0;

for (const target of TARGETS) {
  const abs = resolve(WEB_ROOT, target.path);
  if (!existsSync(abs)) {
    failures.push({
      name: target.name,
      path: target.path,
      reason: `target path does not exist (TARGETS is stale)`,
    });
    continue;
  }
  const stat = statSync(abs);
  const files = stat.isDirectory() ? gatherTsxFiles(abs) : [abs];
  let count = 0;
  const adoptingFiles = [];
  for (const file of files) {
    const { count: n } = countHelpIconUsage(file);
    if (n > 0) {
      count += n;
      adoptingFiles.push({ file: relative(WEB_ROOT, file), count: n });
    }
  }
  totalAdoptions += count;
  report.push({
    name: target.name,
    path: target.path,
    count,
    min: target.min,
    files: adoptingFiles,
  });
  if (count < target.min) {
    failures.push({
      name: target.name,
      path: target.path,
      reason: `${count} HelpIcon usage(s) < required minimum of ${target.min}`,
    });
  }
}

if (totalAdoptions < TOTAL_MIN) {
  failures.push({
    name: 'TOTAL',
    path: '(all targets)',
    reason: `${totalAdoptions} total HelpIcon usage(s) < required minimum of ${TOTAL_MIN}`,
  });
}

console.log(
  `[audit:inline-help] targets: ${TARGETS.length}, ` +
    `total adoptions: ${totalAdoptions} (min ${TOTAL_MIN}), ` +
    `failures: ${failures.length}`,
);

for (const r of report) {
  const status = r.count >= r.min ? '✓' : '✗';
  console.log(
    `  ${status} ${r.name.padEnd(22)} ${r.count.toString().padStart(2)}/${r.min} → ${r.path}`,
  );
  for (const f of r.files) {
    console.log(`        · ${f.file} (${f.count})`);
  }
}

if (allowlist.length > 0) {
  console.log('');
  console.log(
    `[audit:inline-help] inlineHelpAllowlist.ts excuses ${allowlist.length} ` +
      `i18n key(s) from inline help (informational only):`,
  );
  for (const k of allowlist) console.log(`  · ${k}`);
}

if (failures.length > 0) {
  console.error('');
  console.error('[audit:inline-help] FAIL:');
  for (const f of failures) {
    console.error(`  MISSING_HELP[${f.path}] target=${f.name} reason=${f.reason}`);
  }
  console.error('');
  console.error('  Fix by adding `<HelpIcon i18nKey="…" for="…" />` next to');
  console.error('  the field labels on the affected target. Add the i18n key to');
  console.error('  web/src/i18n/en.json under `help.fields.<page>.<field>`.');
  console.error('  For genuinely self-evident fields, add the label key to');
  console.error('  web/src/lib/inlineHelpAllowlist.ts (use sparingly).');
  process.exit(1);
}

console.log('');
console.log('[audit:inline-help] OK — every target meets its inline-help budget.');
process.exit(0);
