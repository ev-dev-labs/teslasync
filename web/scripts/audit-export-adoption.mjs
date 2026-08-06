#!/usr/bin/env node
// DataTable export adoption audit.
//
// Long-tail list pages (charging, drives, trips, automation, alerts,
// notifications, api-logs, audit) MUST opt their <DataTable/> into
// client-side CSV export by setting the `exportable` prop. Users
// routinely export to spreadsheets for tax records, insurance, and
// fleet reporting — DataTable already supports it (/
//), but most pages forget to flip the flag.
//
// This audit:
// 1. Walks src/features/**/pages/*.tsx looking for files whose name
// matches the long-tail list-page pattern.
// 2. For every <DataTable.../> JSX block in those files, requires
// either `exportable` or a `// export-audit:skip <reason>`
// file-level waiver.
// 3. Surfaces a separate informational warning for files that
// match the pattern but render rows via raw `.map()` /
// `<table>` instead of <DataTable/>. These can't be enforced
// yet — they belong on the migration backlog.
//
// Recognised exemptions on a target page's <DataTable/>:
// • `exportable` — the prop is set.
// • `// export-audit:skip <reason>` — explicit per-file
// waiver (use for
// pages where the
// rendered cells are
// not meaningfully
// exportable, e.g.
// embedded action
// bars).
//
// Exit 0 when every <DataTable/> in a target page satisfies one of
// the above; exit 1 with a per-table report otherwise.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(process.cwd(), 'src');
const PAGES_ROOT = path.join(ROOT, 'features');

// Long-tail list-page name fragments. A page file whose basename
// (case-insensitive) contains any of these fragments is considered an
// export target.
//
// NOTE: We deliberately keep the fragments conservative so generic
// detail/summary pages (e.g. ChargingDetailPage, ChargingHeatmapPage)
// that happen to embed a DataTable for non-list content don't get
// roped in. The waiver mechanism is the escape valve when something
// genuinely doesn't belong in the export target set.
const TARGET_FRAGMENTS = [
  'charging',
  'drives',
  'trips',
  'automation',
  'alerts',
  'notifications',
  'api-logs',
  'apilogs',
  'audit',
];

// Pages that match the target pattern but don't actually use
// <DataTable/>. They render long lists via raw `.map()` /
// `<table>` (or, in TripListPage's case, a hand-rolled CSV export
// outside DataTable). We surface them as warnings so the migration
// backlog stays visible. NOT a failure — there's nothing to enforce
// `exportable` on if there's no <DataTable/>.
const PENDING_MIGRATION = [
  // Successor to the deleted NotificationsPage.tsx (renamed in #64
  // "Refactor/filters"). InboxPage is a thin shell; rows are mapped into
  // <NotificationRow> inside InboxBody, so that is what must migrate.
  'features/notifications/components/InboxBody.tsx',
  'features/notifications/pages/AlertRulesPage.tsx',
  'features/admin/pages/ApiLogsPage.tsx',
  'features/driving/pages/DrivesListPage.tsx',
  'features/charging/pages/ChargingListPage.tsx',
  'features/trips/pages/TripListPage.tsx',
  'features/automations/pages/AutomationListPage.tsx',
];

const WAIVER_RE = /\/\/\s*export-audit:skip\b/;

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = path.join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...walk(p));
      continue;
    }
    if (!p.endsWith('.tsx')) continue;
    out.push(p);
  }
  return out;
}

function isPagesPath(absPath) {
  // Only enforce on files whose path includes /features/.../pages/.
  const norm = absPath.replace(/\\/g, '/');
  return /\/features\/[^/]+\/pages\/[^/]+\.tsx$/.test(norm);
}

function pageMatchesTarget(absPath) {
  const base = path.basename(absPath).toLowerCase();
  // Skip co-located test files — they would otherwise pollute the
  // audit (a *.test.tsx file might import + render a DataTable to
  // exercise it, and we don't want to flag fixtures).
  if (base.endsWith('.test.tsx')) return false;
  return TARGET_FRAGMENTS.some((frag) => base.includes(frag));
}

// Walk forward from `<DataTable` until the matching `/>` or
// `</DataTable>`. Mirrors the bracket-aware scanner in
// audit-virtualization.mjs so behavior stays consistent across audits.
function extractDataTableBlocks(source) {
  const blocks = [];
  const openTagRe = /<DataTable\b/g;
  let m;
  while ((m = openTagRe.exec(source)) !== null) {
    const start = m.index;
    let i = m.index + m[0].length;
    let depth = 1;
    let inString = false;
    let stringQuote = '';
    let inBraces = 0;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      const next = source[i + 1] ?? '';
      if (inString) {
        if (ch === '\\') {
          i += 2;
          continue;
        }
        if (ch === stringQuote) {
          inString = false;
        }
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        inString = true;
        stringQuote = ch;
        i += 1;
        continue;
      }
      if (ch === '{') {
        inBraces += 1;
        i += 1;
        continue;
      }
      if (ch === '}') {
        if (inBraces > 0) inBraces -= 1;
        i += 1;
        continue;
      }
      if (inBraces > 0) {
        i += 1;
        continue;
      }
      if (ch === '/' && next === '>') {
        i += 2;
        depth -= 1;
        continue;
      }
      if (ch === '>') {
        const closeIdx = source.indexOf('</DataTable>', i);
        if (closeIdx === -1) {
          i = source.length;
          depth = 0;
          break;
        }
        i = closeIdx + '</DataTable>'.length;
        depth -= 1;
        break;
      }
      i += 1;
    }
    // Compute 1-based line number of the opening tag for nicer error
    // reporting.
    const lineNumber = source.slice(0, start).split('\n').length;
    blocks.push({ start, end: i, lineNumber, text: source.slice(start, i) });
    openTagRe.lastIndex = i;
  }
  return blocks;
}

function hasProp(blockText, propName) {
  // Match `<propName>` as a bare boolean prop OR `<propName>={...}` /
  // `<propName>="..."`. Anchor on a non-word boundary on the left so
  // `foo-exportable` doesn't accidentally match `exportable`.
  const re = new RegExp(`(?:^|\\s)${propName}(?:\\s|=|/|>)`, 'm');
  return re.test(blockText);
}

const failures = [];
const passes = [];
const exemptedWaiver = [];
const skippedNoDataTable = [];

const pageFiles = walk(PAGES_ROOT).filter(isPagesPath);

for (const file of pageFiles) {
  if (!pageMatchesTarget(file)) continue;
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const src = readFileSync(file, 'utf8');
  const fileWaived = WAIVER_RE.test(src);
  const blocks = extractDataTableBlocks(src);
  if (blocks.length === 0) {
    skippedNoDataTable.push(rel);
    continue;
  }
  let blockIdx = 0;
  for (const block of blocks) {
    blockIdx += 1;
    const id = `${rel}:${block.lineNumber}#datatable-${blockIdx}`;
    if (fileWaived) {
      exemptedWaiver.push(id);
      continue;
    }
    if (hasProp(block.text, 'exportable')) {
      passes.push(id);
      continue;
    }
    failures.push({
      file: id,
      reason: 'missing `exportable` prop on <DataTable/> (long-tail list page).',
    });
  }
}

console.log(
  `[audit:export-adoption] target pages scanned: ${pageFiles.filter(pageMatchesTarget).length}, ` +
  `passes: ${passes.length}, ` +
  `waiver-exempt: ${exemptedWaiver.length}, ` +
  `no-datatable (skipped): ${skippedNoDataTable.length}, ` +
  `failures: ${failures.length}`,
);

if (passes.length > 0) {
  console.log('[audit:export-adoption] exportable OK:');
  for (const p of passes) console.log(`  ✓ ${p}`);
}
if (exemptedWaiver.length > 0) {
  console.log('[audit:export-adoption] exempted (// export-audit:skip):');
  for (const w of exemptedWaiver) console.log(`  · ${w}`);
}
if (skippedNoDataTable.length > 0) {
  console.log(
    '[audit:export-adoption] skipped (target page name but no <DataTable/> found):',
  );
  for (const s of skippedNoDataTable) console.log(`  - ${s}`);
}

// PENDING_MIGRATION — informational only. Mirror the pattern used by
// audit-virtualization.mjs: surface backlog so future sweeps can
// migrate raw `.map()` / `<table>` rows to <DataTable/> + exportable.
//
// A *stale* entry is a hard failure, not a warning: a path that no longer
// exists silently stops auditing the surface it was meant to track, which
// is how NotificationsPage.tsx rotted through #64.
const pendingMissing = [];
for (const rel of PENDING_MIGRATION) {
  const full = path.join(ROOT, rel);
  if (!existsSync(full)) {
    pendingMissing.push(rel);
    failures.push({
      file: rel,
      reason: 'file not found (PENDING_MIGRATION is stale — repoint it at the renamed file or drop the entry)',
    });
  }
}
if (PENDING_MIGRATION.length > 0) {
  console.log('');
  console.log(
    `[audit:export-adoption] WARN — ${PENDING_MIGRATION.length} page(s) ` +
    `match the long-tail list pattern but render rows outside <DataTable/>:`,
  );
  for (const rel of PENDING_MIGRATION) {
    const tag = pendingMissing.includes(rel) ? '(file missing)' : '';
    console.log(`  · ${rel} ${tag}`);
  }
  console.log(
    '  These should migrate to <DataTable exportable .../> in a follow-up sweep.',
  );
}

if (failures.length > 0) {
  console.error('');
  console.error('[audit:export-adoption] FAIL:');
  for (const f of failures) {
    console.error(`  ✗ ${f.file} — ${f.reason}`);
  }
  console.error('');
  console.error('  Fix by adding `exportable` (and an `exportFilename` /');
  console.error('  `exportRow` when the visible columns render React nodes)');
  console.error('  to the <DataTable/>. If the table genuinely should not');
  console.error('  expose a CSV download (e.g. embedded action bar with no');
  console.error('  meaningful data cells), add `// export-audit:skip <reason>`');
  console.error('  near the top of the file.');
  process.exit(1);
}

console.log('');
console.log('[audit:export-adoption] OK — every long-tail list page enables exportable.');
process.exit(0);
