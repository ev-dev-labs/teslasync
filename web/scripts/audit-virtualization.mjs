// DataTable virtualization adoption audit.
//
// NOTE: no `#!` line — this module is imported by
// `src/__tests__/qualityGates.contract.test.ts` so the mutation checks
// exercise the real discovery scan.
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
// • ACKNOWLEDGED_LONG_LIST_SURFACES — surfaces that render a long list
//                       WITHOUT <DataTable/> (so `virtualized` cannot be
//                       enforced on them) and without any virtualizer.
//                       This list is RECONCILED against a source scan on
//                       every run: see `discoverLongListSurfaces`.
//
// The previous version capped the backlog with
// AUDIT_VIRTUALIZATION_BACKLOG_LIMIT, comparing a hardcoded six-item array
// against a default of six. That could only fire if somebody edited the array
// in the same commit — it could not notice a NEW unvirtualized long-list page
// anywhere in the app. The threshold is gone. In its place the audit derives
// the set of long-list surfaces from the sources on every run and fails when
// the derived set and the acknowledged set disagree in either direction:
//
//   discovered \ acknowledged → a NEW unvirtualized long-list surface landed
//   acknowledged \ discovered → the entry migrated or moved; prune it so the
//                               backlog ratchets down for real
//
// Recognised exemptions on a HOT_TABLE_PAGES table:
// 1. `virtualized` — the prop is set (any form).
// 2. `expandable` — variable-height drawer rows
// are incompatible with
// virtualization (out of scope
// per).
// 3. `// virtualize-audit:skip <reason>` — explicit per-file waiver.
//
// Exit 0 when every HOT_TABLE_PAGES table satisfies one of the above and the
// discovered long-list set matches the acknowledged one; exit 1 with a report
// otherwise.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

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

// Surfaces that render a long list WITHOUT <DataTable/>, so `virtualized`
// cannot be enforced on them yet. This list is NOT trusted on its own — it is
// reconciled against `discoverLongListSurfaces()` on every run, so a new page
// that starts rendering a long list is caught even though nobody touched this
// array, and an entry that has since migrated must be pruned.
const ACKNOWLEDGED_LONG_LIST_SURFACES = [
  'features/admin/pages/ApiLogsPage.tsx',
  'features/advanced-intelligence/pages/BehavioralSentinelPage.tsx',
  'features/advanced-intelligence/pages/CausalExperimentationPage.tsx',
  'features/advanced-intelligence/pages/ComponentSurvivalPage.tsx',
  'features/advanced-intelligence/pages/FederatedLearningStudioPage.tsx',
  'features/advanced-intelligence/pages/FirmwareCanaryPage.tsx',
  'features/advanced-intelligence/pages/RoadHazardMeshPage.tsx',
  // Row renderer behind ChargingListPage — the page is a shell, this is what
  // maps sessions into DOM. (The page itself is NOT listed: its only chained
  // `.map` is the `narrativeEvidence` data transform at ChargingListPage.tsx,
  // which builds objects and renders nothing.)
  'features/charging/components/charging-list/SessionListSection.tsx',
  'features/driving/pages/DrivesListPage.tsx',
  'features/maps/pages/LocationsPage.tsx',
  // Successor to the deleted NotificationsPage.tsx (renamed in #64
  // "Refactor/filters"). Rows are mapped into <NotificationRow> here, so this
  // is the file that must migrate.
  'features/notifications/components/InboxBody.tsx',
  // Successor to the deleted AlertsPage.tsx (same PR).
  'features/notifications/pages/AlertsListPage.tsx',
  'features/notifications/pages/AlertStudioPage.tsx',
  'features/system/pages/CommandHistoryPage.tsx',
  // `Array.from(pinnedSignals).sort().map(...)` — a chained render the old
  // `{ident.map(` regex could not see.
  'features/telemetry/pages/SignalsWorkspacePage.tsx',
  'features/trips/pages/TripListPage.tsx',
  'features/vehicle-systems/pages/SoftwareUpdatesPage.tsx',
];

const WAIVER_RE = /\/\/\s*virtualize-audit:skip\b/;

// ── Long-list discovery ─────────────────────────────────────────────────────
//
// A file is an UNVIRTUALIZED LONG-LIST SURFACE when it renders a mapped
// collection into JSX, uses neither <DataTable/> nor a virtualizer, AND
// carries at least one LONG-LIST ADMISSION — a control this codebase only adds
// when the collection is expected to be long. That last condition is what
// keeps the scan honest: `.map()` alone appears in ~1,800 files and would be
// pure noise, but a page that paginates a list, offers select-all/bulk
// operations over it, or exports the whole thing has already declared that the
// list is not small.

export const LONG_LIST_ADMISSIONS = [
  ['pagination', /<Pagination\b|\busePagination\b/],
  ['bulk-actions', /<BulkActionsToolbar\b/],
  ['list-export', /<ListExportMenu\b/],
];

const HAS_DATATABLE = /<DataTable\b/;
const HAS_VIRTUALIZER = /useVirtualizer|react-virtual|Virtuoso/;

/** Skip whitespace leftwards from `i`, returning the first non-space index. */
function skipSpaceLeft(source, i) {
  let j = i;
  while (j >= 0 && /\s/.test(source[j])) j -= 1;
  return j;
}

/** Index of the `(`/`[` matching the closing bracket at `close`, or null. */
function matchOpenBracket(source, close) {
  const pairs = { ')': '(', ']': '[' };
  const open = pairs[source[close]];
  if (!open) return null;
  let depth = 0;
  for (let i = close; i >= 0; i -= 1) {
    const ch = source[i];
    if (ch === source[close]) depth += 1;
    else if (ch === open) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return null;
}

/**
 * Walk left from the `.` of a `.map(` and return the index where the callee
 * chain starts, or null when the thing being mapped is not a collection
 * expression.
 *
 * This is what makes chained idioms visible. The previous regex only matched
 * `{ident.map(`, so every one of these slipped through:
 *
 *   {rows.filter(r => r.active).map(...)}
 *   {items.slice(0, pageSize).map(...)}
 *   {[...entries].sort(byDate).map(...)}
 *   {(data ?? []).map(...)}
 *   {data?.results.map(...)}
 *
 * A regex cannot do this reliably because the intermediate call arguments
 * contain arbitrary nested parentheses, so the chain is walked with a real
 * bracket matcher instead.
 */
export function chainRootIndex(source, dotIndex) {
  let cursor = dotIndex;
  for (let guard = 0; guard < 64; guard += 1) {
    let j = skipSpaceLeft(source, cursor - 1);
    if (j < 0) return null;

    if (source[j] === ')' || source[j] === ']') {
      const open = matchOpenBracket(source, j);
      if (open === null) return null;
      const beforeGroup = skipSpaceLeft(source, open - 1);
      // `foo(...)` / `foo[...]` — the callee identifier continues the chain.
      if (beforeGroup >= 0 && /[\w$]/.test(source[beforeGroup])) {
        j = beforeGroup;
      } else {
        // `(expr).map(...)` / `[...spread].map(...)` — the group IS the root.
        return open;
      }
    } else if (!/[\w$]/.test(source[j])) {
      return null;
    }

    let k = j;
    while (k >= 0 && /[\w$]/.test(source[k])) k -= 1;
    const identStart = k + 1;
    if (identStart > j) return null;

    // Is there a `.` / `?.` connector further left? If so keep walking.
    let p = skipSpaceLeft(source, identStart - 1);
    if (p >= 0 && source[p] === '.') {
      const q = skipSpaceLeft(source, p - 1);
      // For `?.` the cursor must land ON the `?`, so the next iteration looks
      // to the left of it; for a plain `.` it lands on the dot.
      cursor = q >= 0 && source[q] === '?' ? q : p;
      continue;
    }
    return identStart;
  }
  return null;
}

/**
 * A collection whose length is a literal in the source cannot be a long list.
 * These are skeleton/placeholder loops (`{[1,2,3].map(...)}`,
 * `{Array.from({ length: 6 }).map(...)}`) and excluding them is a precision
 * fix, not a tolerance: a fixed six-element render is not a virtualization
 * candidate by definition.
 */
export function isBoundedLiteralCollection(rootExpression) {
  const text = rootExpression.replace(/\s+/g, ' ').trim();
  // `[1, 2, 3]` / `['a', 'b']` — every element a literal.
  if (/^\[\s*(?:-?\d+(?:\.\d+)?|'[^']*'|"[^"]*"|true|false|null)\s*(?:,\s*(?:-?\d+(?:\.\d+)?|'[^']*'|"[^"]*"|true|false|null)\s*)*,?\s*\]/.test(text)) {
    return true;
  }
  // `Array.from({ length: 6 })` / `new Array(6)` — numeric literal length.
  if (/^Array\s*\.\s*from\s*\(\s*\{\s*length\s*:\s*\d+\s*\}/.test(text)) return true;
  if (/^new\s+Array\s*\(\s*\d+\s*\)/.test(text)) return true;
  return false;
}

/**
 * Index of the innermost enclosing `{` that is still open at `index`, or null.
 *
 * Brackets are balanced properly rather than pattern-matched, so an object
 * literal, a call argument list or an index expression between the container
 * and the `.map(` cannot be mistaken for the container itself.
 */
export function enclosingBraceIndex(source, index) {
  let curly = 0;
  let paren = 0;
  let square = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const ch = source[i];
    if (ch === '}') curly += 1;
    else if (ch === ')') paren += 1;
    else if (ch === ']') square += 1;
    else if (ch === ')' || ch === ']') continue;
    else if (ch === '(') {
      if (paren === 0) continue;
      paren -= 1;
    } else if (ch === '[') {
      if (square === 0) continue;
      square -= 1;
    } else if (ch === '{') {
      if (curly === 0) return i;
      curly -= 1;
    }
  }
  return null;
}

/**
 * Is the `{` at `braceIndex` a JSX EXPRESSION CONTAINER (as opposed to an
 * object literal, a block body, or an arrow body)?
 *
 * The previous version accepted any of `{ & ? :` immediately left of the chain
 * root, which is not a context test at all — `?` and `:` are also the ternary
 * operator and an object-property separator, and `&` is also `&&` in plain
 * logic. That is what made
 * `const narrativeEvidence = (cond ? anomalies.map(...) : rows).slice(0, 5).map(...)`
 * in ChargingListPage.tsx look like a rendered list: pure data shaping, never
 * mounted, and it had become a load-bearing acknowledgement.
 *
 * Only three positions can legitimately open a JSX expression container:
 *   `<div>{…}`   child position, right after a tag closes
 *   `{…}{…}`     sibling container in children
 *   `prop={…}`   attribute position
 * Everything else — `const x = {`, `=> {`, `return {`, `) {`, `[{` — is not.
 */
export function isJsxExpressionContainer(source, braceIndex) {
  if (braceIndex === null || braceIndex < 0) return false;
  const p = skipSpaceLeft(source, braceIndex - 1);
  if (p < 0) return false;
  const ch = source[p];

  if (ch === '>') {
    // `=>` is an arrow function body, NOT a JSX child position.
    const before = skipSpaceLeft(source, p - 1);
    return before < 0 || source[before] !== '=';
  }
  if (ch === '}') return true;
  if (ch === '=') {
    // `prop={…}` — an attribute name must sit immediately left of the `=`,
    // and it must be a plain `=` (not `==`, `!=`, `<=`, `>=`, `=>`).
    const before = p - 1;
    if (before < 0) return false;
    return /[\w$\-]/.test(source[before]);
  }
  return false;
}

/**
 * A `<` that opens JSX rather than a less-than comparison.
 *
 * JSX can only start where an expression can start, so the `<` must follow one
 * of `= ( [ { , ; : ? => && || return` (or the start of the fragment) — never
 * an identifier or a closing bracket, which is what `a < b` looks like.
 * Line and block comments between the operator and the element are skipped, so
 * `return (\n  // keep this in sync\n  <Row />\n)` still matches.
 *
 * Covers named elements (`<Row`, `<ui.Row`), intrinsic tags (`<li`) and the
 * fragment shorthand (`<>`).
 */
const JSX_IN_EXPRESSION_POSITION =
  /(?:^|[=(\[{,;:?]|=>|&&|\|\||\breturn\b)\s*(?:(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)\s*)*<\s*(?:[A-Za-z][\w.$:-]*(?=[\s/>])|>)/

/** True when `body` contains JSX in an expression position. */
export function containsJsxInExpressionPosition(body) {
  return JSX_IN_EXPRESSION_POSITION.test(body)
}

/**
 * Source region of a locally-defined `name`, or null.
 *
 * Used to resolve a by-reference map callback (`rows.map(renderWidgetCard)`)
 * to the function it names. Handles the two shapes this codebase uses:
 *   `const name = (…) => …;`  /  `function name(…) { … }`
 */
export function localDefinitionBody(source, name) {
  const declaration = new RegExp(
    `(?:^|[\\s;{])(?:export\\s+)?(?:const|let|var)\\s+${name}\\s*(?::[^=\\n]*)?=`,
    'm',
  ).exec(source);
  if (declaration) {
    const start = declaration.index + declaration[0].length;
    let depth = 0;
    for (let i = start; i < source.length; i += 1) {
      const ch = source[i];
      if ('([{'.includes(ch)) depth += 1;
      else if (')]}'.includes(ch)) {
        depth -= 1;
        // A `)`/`]`/`}` that closes something we never opened means the
        // declaration ran into its enclosing scope: stop there.
        if (depth < 0) return source.slice(start, i);
      } else if (ch === ';' && depth === 0) return source.slice(start, i);
    }
    return source.slice(start);
  }

  const fn = new RegExp(`(?:^|[\\s;{])(?:export\\s+)?function\\s+${name}\\s*[<(]`, 'm').exec(source);
  if (!fn) return null;
  const braceStart = source.indexOf('{', fn.index + fn[0].length - 1);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  return null;
}

/**
 * Does the callback passed to `.map(` at `openParenIndex` produce JSX?
 *
 * This is the semantic half of "is this a rendered list". A data transform —
 * `.map((s) => ({ id: s.id, summary: … }))` — returns objects and mounts
 * nothing; a list render returns elements. Requiring both this and a real JSX
 * container means neither a mis-parsed container nor an in-JSX data transform
 * can produce a false acknowledgement.
 *
 * Three callback forms are recognised:
 *   inline arrow / function  `.map((r) => <Row />)`, `.map((r) => { return <Row />; })`
 *   conditional JSX          `.map((r) => (r.ok ? <Row /> : null))`
 *   by reference             `.map(renderWidgetCard)` — resolved against the
 *                            function of that name defined in the SAME file,
 *                            which is how WidgetPicker.tsx,
 *                            ConsumablesLifecyclePage.tsx, WarrantyCommandPage.tsx
 *                            and the command-center browsers render their rows.
 *
 * RESIDUAL LIMITATION (real, not hypothetical): a callback imported from
 * another module, or produced by a factory (`.map(makeRenderer(x))`), cannot be
 * resolved here — this is a single-file scanner with no module graph. Such a
 * surface would be reported as non-rendering and would have to be acknowledged
 * via a `// virtualize-audit:skip` waiver or by adding it to
 * ACKNOWLEDGED_LONG_LIST_SURFACES, where the reconciliation would immediately
 * flag the mismatch rather than hide it. No current surface uses those forms
 * (verified by scanning every `.map(<identifier>)` call site in `src/`).
 */
export function mapCallbackReturnsJsx(source, openParenIndex) {
  if (source[openParenIndex] !== '(') return false;
  let depth = 0;
  let end = -1;
  for (let i = openParenIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return false;
  const body = source.slice(openParenIndex + 1, end);

  // `.map(renderRow)` / `.map(renderRow, thisArg)` — resolve the reference.
  const byReference = /^\s*([A-Za-z_$][\w$]*)\s*(?:,[^,]*)?$/.exec(body);
  if (byReference) {
    const definition = localDefinitionBody(source, byReference[1]);
    return definition !== null && containsJsxInExpressionPosition(definition);
  }

  return containsJsxInExpressionPosition(body);
}

/**
 * True when the source renders a mapped collection inside a JSX expression
 * container, through any chain depth.
 */
export function rendersMappedList(source) {
  const re = /\.\s*map\s*\(/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    const root = chainRootIndex(source, match.index);
    if (root === null) continue;
    if (isBoundedLiteralCollection(source.slice(root, match.index))) continue;
    if (!isJsxExpressionContainer(source, enclosingBraceIndex(source, root))) continue;
    if (!mapCallbackReturnsJsx(source, match.index + match[0].length - 1)) continue;
    return true;
  }
  return false;
}

/**
 * Classify one source file. Exported so the contract test can feed synthetic
 * sources and prove the scan actually fires.
 *
 * @returns {{isLongListSurface: boolean, reasons: string[], excludedBy: string|null}}
 */
export function classifyLongListSource(source) {
  if (WAIVER_RE.test(source)) {
    return { isLongListSurface: false, reasons: [], excludedBy: 'waiver' };
  }
  if (HAS_DATATABLE.test(source)) {
    return { isLongListSurface: false, reasons: [], excludedBy: 'datatable' };
  }
  if (HAS_VIRTUALIZER.test(source)) {
    return { isLongListSurface: false, reasons: [], excludedBy: 'virtualizer' };
  }
  if (!rendersMappedList(source)) {
    return { isLongListSurface: false, reasons: [], excludedBy: 'no-mapped-list' };
  }
  const reasons = LONG_LIST_ADMISSIONS.filter(([, re]) => re.test(source)).map(([name]) => name);
  if (reasons.length === 0) {
    return { isLongListSurface: false, reasons: [], excludedBy: 'no-long-list-admission' };
  }
  return { isLongListSurface: true, reasons, excludedBy: null };
}

function listTsxFiles(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    const abs = path.join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(abs).isDirectory()) out.push(...listTsxFiles(abs, rel));
    else if (entry.endsWith('.tsx')) out.push(rel);
  }
  return out;
}

/**
 * Scan `src/` for unvirtualized long-list surfaces.
 *
 * @param {string} root absolute path to `web/src`
 * @returns {{file: string, reasons: string[]}[]} sorted
 */
export function discoverLongListSurfaces(root) {
  const found = [];
  for (const rel of listTsxFiles(root)) {
    if (/__tests__|\.test\.|\.stories\./.test(rel)) continue;
    const verdict = classifyLongListSource(readFileSync(path.join(root, rel), 'utf8'));
    if (verdict.isLongListSurface) found.push({ file: rel, reasons: verdict.reasons });
  }
  return found.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Reconcile the derived set with the acknowledged one, in BOTH directions.
 *
 * @param {{discovered: {file: string, reasons: string[]}[], acknowledged: string[]}} input
 */
export function reconcileLongListBacklog({ discovered, acknowledged }) {
  const discoveredNames = new Set(discovered.map((d) => d.file));
  const acknowledgedNames = new Set(acknowledged);
  const problems = [];

  for (const entry of discovered) {
    if (acknowledgedNames.has(entry.file)) continue;
    problems.push({
      file: entry.file,
      reason:
        `renders a long list (${entry.reasons.join('+')}) with neither <DataTable/> nor a ` +
        'virtualizer, and is not acknowledged. Migrate it to <DataTable virtualized/>, add a ' +
        '`// virtualize-audit:skip <reason>` waiver, or add it to ' +
        'ACKNOWLEDGED_LONG_LIST_SURFACES with justification.',
    });
  }
  for (const name of acknowledged) {
    if (discoveredNames.has(name)) continue;
    problems.push({
      file: name,
      reason:
        'is acknowledged as an unvirtualized long-list surface but the scan no longer finds ' +
        'one there (migrated, waived, or moved). Prune the entry so the backlog ratchets down.',
    });
  }
  return problems;
}

// Find every JSX block opened with `<DataTable` (optionally followed
// by a generic argument like `<DataTable<Foo>`) and capture from the
// opening `<` to the matching `/>` (self-closing) or `</DataTable>`
// (tagged). Self-closing is the dominant pattern in this repo, so we
// prioritise it.
export function extractDataTableBlocks(source) {
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

export function hasProp(block, propName) {
  // Match `<propName>` as a bare boolean prop OR `<propName>={...}` /
  // `<propName>="..."`. We anchor on a non-word boundary on the left
  // so `notVirtualized` doesn't accidentally match.
  const re = new RegExp(`(?:^|\\s)${propName}(?:\\s|=|/|>)`, 'm');
  return re.test(block);
}

function main() {
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

// ── Long-list backlog: DERIVED, then reconciled ────────────────────────────
//
// The set is recomputed from the sources on every run, so a new page that
// starts rendering a long list is caught even though nobody edited the
// acknowledged list. A stale entry is a hard failure too: a path that no
// longer renders a long list silently stops tracking anything, which is how
// NotificationsPage.tsx/AlertsPage.tsx rotted through #64.
for (const rel of ACKNOWLEDGED_LONG_LIST_SURFACES) {
  if (existsSync(path.join(ROOT, rel))) continue;
  failures.push({
    file: rel,
    reason:
      'file not found (ACKNOWLEDGED_LONG_LIST_SURFACES is stale — repoint it at the renamed ' +
      'file or drop the entry)',
  });
}

const discovered = discoverLongListSurfaces(ROOT);
console.log('');
console.log(
  `[audit:virtualization] long-list scan: ${discovered.length} unvirtualized surface(s) ` +
  `discovered, ${ACKNOWLEDGED_LONG_LIST_SURFACES.length} acknowledged`,
);
for (const entry of discovered) {
  console.log(`  · ${entry.file} (${entry.reasons.join('+')})`);
}
failures.push(
  ...reconcileLongListBacklog({
    discovered,
    acknowledged: ACKNOWLEDGED_LONG_LIST_SURFACES.filter((rel) =>
      existsSync(path.join(ROOT, rel)),
    ),
  }),
);

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
console.log(
  '[audit:virtualization] OK — every hot table is virtualized or exempt, and the derived ' +
  'long-list set matches the acknowledged one.',
);
process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
