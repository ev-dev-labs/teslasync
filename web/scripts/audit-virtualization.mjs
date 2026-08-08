#!/usr/bin/env node
// DataTable virtualization adoption audit.
//
// Long-list pages MUST opt into row virtualization on their <DataTable/>
// to keep DOM size bounded and scroll smooth. This script verifies a
// curated allowlist of "hot" pages always carry `virtualized` (or one
// of the recognised exemptions) so that future PRs can't silently
// regress the performance budget.
//
// Categories:
// • HOT_TABLE_PAGES — pages whose DataTable rows can grow > 200.
// MUST contain `virtualized` (or an exemption)
// in the same JSX block, otherwise the audit
// fails (exit 1).
// • PENDING_MIGRATION — pages that today render rows via raw
// `.map()` instead of <DataTable/>. We can't
// enforce virtualization on them yet, but we
// emit a warning so the migration backlog
// stays visible. NOT a failure.
//
// Recognised exemptions on a HOT_TABLE_PAGES table:
// 1. `virtualized` — the prop is set (any form).
// 2. `expandable` — variable-height drawer rows
// are incompatible with
// virtualization (out of scope
// per).
// 3. `// virtualize-audit:skip <reason>` — explicit per-file waiver.
//
// Exit 0 when every HOT_TABLE_PAGES table satisfies one of the above;
// exit 1 with a per-table report otherwise.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(process.cwd(), 'src');

// Pages with a <DataTable/> whose row count routinely climbs past 200.
// Each entry is a path relative to `web/src`. The audit reads these
// files even when they live outside the allowed-files regex of any
// given prompt (READ-only — modifications still go through the normal
// allowlist gate).
const HOT_TABLE_PAGES = [
  'features/admin/pages/LiveLogsPage.tsx',
  'features/charging/pages/TeslaChargingSessionsPage.tsx',
  'features/charging/pages/TeslaChargingHistoryPage.tsx',
  'features/admin/pages/RedisSignalViewerPage.tsx',
  'features/telemetry/pages/MQTTInspectorPage.tsx',
];

// Pages that currently render long lists via raw `.map()` over plain
// <div>s instead of <DataTable/>. We can't enforce `virtualized` on a
// component that doesn't exist; document the gap so the future work can
// migrate them to DataTable+virtualized.
const PENDING_MIGRATION = [
  // Successor to the deleted NotificationsPage.tsx (renamed in #64
  // "Refactor/filters"). The page itself is a thin shell — rows are mapped
  // into <NotificationRow> inside InboxBody, so that is what must migrate.
  'features/notifications/components/InboxBody.tsx',
  // Successor to the deleted AlertsPage.tsx (same PR). Renders rows via a
  // raw .map() rather than <DataTable/>, so it cannot satisfy HOT_TABLE_PAGES.
  // Currently bounded by client-side Pagination, hence migration not urgent.
  'features/notifications/pages/AlertsListPage.tsx',
  'features/admin/pages/ApiLogsPage.tsx',
  'features/driving/pages/DrivesListPage.tsx',
  'features/charging/pages/ChargingListPage.tsx',
  'features/trips/pages/TripListPage.tsx',
];

const WAIVER_RE = /\/\/\s*virtualize-audit:skip\b/;

// Find every JSX block opened with `<DataTable` (optionally followed
// by a generic argument like `<DataTable<Foo>`) and capture from the
// opening `<` to the matching `/>` (self-closing) or `</DataTable>`
// (tagged). Self-closing is the dominant pattern in this repo, so we
// prioritise it.
function extractDataTableBlocks(source) {
  const blocks = [];
  const openTagRe = /<DataTable\b/g;
  let m;
  while ((m = openTagRe.exec(source)) !== null) {
    const start = m.index;
    // Walk forward until we find the closing `/>` or `</DataTable>`.
    // Simple bracket-aware scan that ignores brackets inside strings.
    let i = m.index + m[0].length;
    let depth = 1; // count of `<` we've opened minus `>` we've closed
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
        // Self-closing tag.
        i += 2;
        depth -= 1;
        continue;
      }
      if (ch === '>') {
        // Opening-only tag — switch into "look for </DataTable>" mode.
        // Walk until we find the literal closing tag at the top level.
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
    blocks.push(source.slice(start, i));
    openTagRe.lastIndex = i;
  }
  return blocks;
}

function hasProp(block, propName) {
  // Match `<propName>` as a bare boolean prop OR `<propName>={...}` /
  // `<propName>="..."`. We anchor on a non-word boundary on the left
  // so `notVirtualized` doesn't accidentally match.
  const re = new RegExp(`(?:^|\\s)${propName}(?:\\s|=|/|>)`, 'm');
  return re.test(block);
}

const failures = [];
const passes = [];
const exemptedExpandable = [];
const exemptedWaiver = [];

for (const rel of HOT_TABLE_PAGES) {
  const full = path.join(ROOT, rel);
  if (!existsSync(full)) {
    failures.push({ file: rel, reason: 'file not found (HOT_TABLE_PAGES is stale)' });
    continue;
  }
  const src = readFileSync(full, 'utf8');
  const fileWaived = WAIVER_RE.test(src);
  const blocks = extractDataTableBlocks(src);
  if (blocks.length === 0) {
    failures.push({
      file: rel,
      reason:
        'no <DataTable/> blocks found — page may have been refactored; remove from HOT_TABLE_PAGES or restore virtualization.',
    });
    continue;
  }
  let blockIdx = 0;
  for (const block of blocks) {
    blockIdx += 1;
    const id = `${rel}#datatable-${blockIdx}`;
    if (fileWaived) {
      exemptedWaiver.push(id);
      continue;
    }
    if (hasProp(block, 'expandable')) {
      // expandable + virtualized is documented as incompatible
      // because variable-height rows are out of scope.
      exemptedExpandable.push(id);
      continue;
    }
    if (hasProp(block, 'virtualized')) {
      passes.push(id);
      continue;
    }
    failures.push({
      file: id,
      reason: 'missing `virtualized` prop on <DataTable/> (no exemption found).',
    });
  }
}

console.log(
  `[audit:virtualization] HOT_TABLE_PAGES: ${HOT_TABLE_PAGES.length}, ` +
  `passes: ${passes.length}, ` +
  `expandable-exempt: ${exemptedExpandable.length}, ` +
  `waiver-exempt: ${exemptedWaiver.length}, ` +
  `failures: ${failures.length}`,
);

if (passes.length > 0) {
  console.log('[audit:virtualization] virtualized OK:');
  for (const p of passes) console.log(`  ✓ ${p}`);
}
if (exemptedExpandable.length > 0) {
  console.log('[audit:virtualization] exempted (expandable — variable-height rows):');
  for (const e of exemptedExpandable) console.log(`  · ${e}`);
}
if (exemptedWaiver.length > 0) {
  console.log('[audit:virtualization] exempted (// virtualize-audit:skip):');
  for (const w of exemptedWaiver) console.log(`  · ${w}`);
}

// PENDING_MIGRATION — informational only. These pages render long
// lists via raw `.map()` and ought to migrate to DataTable+virtualized
// in a follow-up. Surfaced as warnings so the backlog stays visible.
//
// A *stale* entry is a hard failure, not a warning: a path that no longer
// exists silently stops auditing the surface it was meant to track, which
// is how NotificationsPage.tsx/AlertsPage.tsx rotted through #64.
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
    `[audit:virtualization] WARN — ${PENDING_MIGRATION.length} page(s) ` +
    `render long lists via raw .map() instead of <DataTable/>:`,
  );
  for (const rel of PENDING_MIGRATION) {
    const tag = pendingMissing.includes(rel) ? '(file missing)' : '';
    console.log(`  · ${rel} ${tag}`);
  }
  console.log(
    '  These should be migrated to DataTable+virtualized in a follow-up sweep.',
  );
}

if (failures.length > 0) {
  console.error('');
  console.error('[audit:virtualization] FAIL:');
  for (const f of failures) {
    console.error(`  ✗ ${f.file} — ${f.reason}`);
  }
  console.error('');
  console.error('  Fix by adding `virtualized` (and an explicit `rowHeight={…}`)');
  console.error('  to the <DataTable/>. If the table genuinely cannot be');
  console.error('  virtualized (e.g. uses `expandable` for variable-height');
  console.error('  drawers, or relies on third-party row internals), add');
  console.error('  `// virtualize-audit:skip <reason>` near the top of the file.');
  process.exit(1);
}

console.log('');
console.log('[audit:virtualization] OK — every hot table is virtualized or exempt.');
process.exit(0);
