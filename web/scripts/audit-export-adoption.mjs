#!/usr/bin/env node
// DataTable export adoption audit.
//
// Long-tail list pages (charging, drives, trips, automation, alerts,
// notifications, api-logs, audit) MUST expose a deliberate export
// contract. DataTables use the shared `exportable` prop. Rich lists
// may keep their more suitable interaction model, but must expose
// explicit CSV and JSON actions (or a server export for large data).
//
// This audit:
// 1. Walks src/features/**/pages/*.tsx looking for files whose name
// matches the long-tail list-page pattern.
// 2. For every <DataTable.../> JSX block in those files, requires
// either `exportable` or a `// export-audit:skip <reason>`
// file-level waiver.
// 3. Checks approved non-DataTable surfaces for their explicit export
// contract so rich list/card interactions do not have to regress merely
// to satisfy a textual audit.
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

import { readFileSync, readdirSync, statSync } from 'node:fs';
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
  'alertrules',
  'notifications',
  'api-logs',
  'apilogs',
  'audit',
];

// Rich operational surfaces whose row expansion, grouping, responsive cards,
// or server-sized datasets make DataTable an inappropriate replacement.
// Each marker is part of the production contract and its absence is a failure.
const ALTERNATIVE_EXPORT_SURFACES = [
  {
    file: 'features/notifications/components/InboxBody.tsx',
    label: 'Notification inbox',
    markers: [
      'ListExportMenu',
      'onExportCsv=',
      'onExportJson=',
      'selectedCount=',
      'thread_count',
    ],
  },
  {
    file: 'features/admin/pages/ApiLogsPage.tsx',
    label: 'API logs',
    markers: ['ListExportMenu', 'onExportCsv=', 'onExportJson='],
  },
  {
    file: 'features/driving/pages/DrivesListPage.tsx',
    label: 'Drive history',
    markers: [
      "scopedPath('/export/drives', exportScope)",
      "filters: { format: 'csv' }",
      "filters: { format: 'json' }",
      'download="teslasync-drives.csv"',
      'download="teslasync-drives.json"',
    ],
  },
  {
    file: 'features/charging/pages/ChargingListPage.tsx',
    label: 'Charging history',
    markers: ['ListExportMenu', 'onExportCsv=', 'onExportJson='],
  },
  {
    file: 'features/trips/pages/TripListPage.tsx',
    label: 'Trips',
    markers: ['exportAsCSV', 'exportAsJSON'],
  },
  {
    file: 'features/automations/pages/AutomationListPage.tsx',
    label: 'Automation rules',
    markers: ['AutomationListTable'],
  },
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
const alternativePasses = [];

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
    '[audit:export-adoption] target page name with no direct <DataTable/>:',
  );
  for (const s of skippedNoDataTable) console.log(`  - ${s}`);
}

for (const surface of ALTERNATIVE_EXPORT_SURFACES) {
  const full = path.join(ROOT, surface.file);
  let source;
  try {
    source = readFileSync(full, 'utf8');
  } catch {
    failures.push({
      file: surface.file,
      reason: 'approved alternative export surface is missing or unreadable',
    });
    continue;
  }

  const missingMarkers = surface.markers.filter((marker) => !source.includes(marker));
  if (missingMarkers.length > 0) {
    failures.push({
      file: surface.file,
      reason: `missing alternative export contract marker(s): ${missingMarkers.join(', ')}`,
    });
    continue;
  }
  alternativePasses.push(`${surface.label} (${surface.file})`);
}

if (alternativePasses.length > 0) {
  console.log('');
  console.log('[audit:export-adoption] explicit non-DataTable export contracts OK:');
  for (const p of alternativePasses) console.log(`  ✓ ${p}`);
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
console.log(
  '[audit:export-adoption] OK — every long-tail list uses an exportable DataTable or an approved explicit export surface.',
);
process.exit(0);
