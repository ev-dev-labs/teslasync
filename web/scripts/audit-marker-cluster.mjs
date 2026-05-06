#!/usr/bin/env node
// Phase-46 / Prompt 17 — MarkerCluster adoption audit.
//
// Walks `web/src/**/*.tsx` and fails if any `<Marker>` or `<CircleMarker>`
// JSX element is rendered inside an `Array#map(...)` arrow callback
// without either:
//
//   1. The same file rendering `<MarkerCluster>` somewhere (which means
//      the loop is feeding the `points` prop and is fine), OR
//   2. A `// marker-cluster:no <reason>` justification comment on one
//      of the 10 lines preceding the offending JSX.
//
// Why this exists
// ---------------
// `web/src/components/maps/MarkerCluster.tsx` exists and works, but
// only `TeslaChargingSessionsMap` adopts it. Other map pages that
// render hundreds of markers individually freeze browsers when zoomed
// out and make overlapping pins indistinguishable. This audit locks
// the contract in: any new code that wants to render markers in a
// loop must consciously decide between clustering or documenting why
// clustering is inappropriate (e.g., heatmap density, trip-specific
// charge stops, etc.).
//
// Allowed escape hatch
// --------------------
//   - `// marker-cluster:no heatmap — density visualization`
//   - `// marker-cluster:no trail — sub-second drive playback`
//   - `// marker-cluster:no waypoints — low-cardinality (<10) trip stops`
//
// Run via `npm run audit:marker-cluster` (chained from `npm run lint`).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import process from 'node:process';

import ts from 'typescript';

const ROOT = join('src');

// Tag names that, when rendered inside an Array#map callback, indicate
// the caller is laying out per-point markers without clustering.
const FLAGGED_TAG_NAMES = new Set(['Marker', 'CircleMarker']);

// Skip test files and other non-production render paths. The component
// suite mocks leaflet aggressively, so its render trees deliberately
// contain `<Marker>` / `<CircleMarker>` inside loops as test fixtures.
function isTestPath(p) {
  return (
    p.endsWith('.test.tsx') ||
    p.endsWith('.spec.tsx') ||
    p.includes(`${sep}__tests__${sep}`) ||
    p.includes(`${sep}__mocks__${sep}`)
  );
}

const offenders = [];

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walk(p);
      continue;
    }
    if (!p.endsWith('.tsx')) continue;
    if (isTestPath(p)) continue;
    yield p;
  }
}

// True when `node` is a CallExpression of the form `<expr>.map(<arg>)`.
function isArrayMapCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (!ts.isIdentifier(callee.name)) return false;
  return callee.name.text === 'map';
}

// Returns the function expression body of the first argument of a `.map()`
// call, or null if the argument isn't an inline arrow / function expression.
function mapCallback(node) {
  const arg = node.arguments?.[0];
  if (!arg) return null;
  if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) return arg;
  return null;
}

// Resolve a JSX element's tag name (handles `<Marker>` and `<X.Marker>`).
function jsxTagName(opening) {
  const tag = opening.tagName;
  if (ts.isIdentifier(tag)) return tag.text;
  if (ts.isPropertyAccessExpression(tag) && ts.isIdentifier(tag.name)) {
    return tag.name.text;
  }
  return '';
}

// Walk every JSX element under `root` and yield its opening element node.
function* allJsxElements(root) {
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (ts.isJsxElement(node)) {
      yield node.openingElement;
    } else if (ts.isJsxSelfClosingElement(node)) {
      yield node;
    }
    ts.forEachChild(node, (c) => stack.push(c));
  }
}

// Returns true if `text` contains any line within the 10 lines preceding
// `tagStart` that includes the literal `marker-cluster:no` marker (typically
// inside a `//` comment immediately above the JSX).
function hasNoMarkerJustification(text, tagStart) {
  const lineStart = text.lastIndexOf('\n', tagStart - 1) + 1;
  const before = text.slice(0, lineStart);
  const lines = before.split('\n');
  const window = lines.slice(Math.max(0, lines.length - 10));
  return window.some((l) => l.includes('marker-cluster:no'));
}

// Returns true if any JSX element in the file uses `<MarkerCluster>`.
function fileRendersMarkerCluster(sourceFile) {
  for (const opening of allJsxElements(sourceFile)) {
    if (jsxTagName(opening) === 'MarkerCluster') return true;
  }
  return false;
}

function locOf(file, sf, node) {
  const { line, character } = sf.getLineAndCharacterOfPosition(
    node.getStart(sf),
  );
  return { display: `${file}:${line + 1}:${character + 1}`, pos: node.getStart(sf) };
}

function auditFile(file) {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  const usesMarkerCluster = fileRendersMarkerCluster(sf);

  // For each `.map()` call, scan its callback body for any flagged JSX
  // tag and decide whether the loop is justified.
  const visit = (node) => {
    if (isArrayMapCall(node)) {
      const fn = mapCallback(node);
      if (fn && fn.body) {
        for (const opening of allJsxElements(fn.body)) {
          const name = jsxTagName(opening);
          if (!FLAGGED_TAG_NAMES.has(name)) continue;

          const { display, pos } = locOf(file, sf, opening);
          // The file rendering MarkerCluster anywhere is treated as
          // having adopted the pattern — typically the loop is feeding
          // a derived `points` array, which is the canonical adoption.
          if (usesMarkerCluster) continue;

          if (hasNoMarkerJustification(text, pos)) continue;

          offenders.push({
            where: display,
            why:
              `<${name}> rendered inside an Array#map callback without ` +
              `clustering. Either replace the loop with <MarkerCluster ` +
              `points={...}/>, or justify with a ` +
              `\`// marker-cluster:no <reason>\` comment within the ` +
              `preceding 10 lines.`,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

let scanned = 0;
for (const file of walk(ROOT)) {
  scanned++;
  auditFile(file);
}

if (offenders.length > 0) {
  console.error(
    `\nMarkerCluster adoption audit failed (${offenders.length} issue(s)):`,
  );
  for (const o of offenders) {
    console.error(`  ${o.where}\n      ${o.why}`);
  }
  console.error(
    '\nFix by replacing the loop with the shared component:\n' +
      '\n' +
      '  // BEFORE — every marker rendered individually:\n' +
      '  {sites.map((s) => (\n' +
      '    <Marker key={s.id} position={[s.lat, s.lng]} />\n' +
      '  ))}\n' +
      '\n' +
      '  // AFTER — one MarkerCluster, density-aware:\n' +
      '  <MarkerCluster\n' +
      '    points={sites.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng }))}\n' +
      '  />\n' +
      '\n' +
      'If clustering is genuinely inappropriate (heatmap, trail, ≤10\n' +
      'semantically distinct waypoints, etc.), document the reason on\n' +
      'the line above the loop:\n' +
      '\n' +
      '  // marker-cluster:no heatmap — density encoded in radius / opacity\n' +
      '  {clusters.map((c) => (\n' +
      '    <CircleMarker center={[c.lat, c.lng]} radius={r(c)} />\n' +
      '  ))}\n',
  );
  process.exit(1);
}

console.log(
  `OK — every <Marker>/<CircleMarker> in ${ROOT} is either inside a ` +
    `<MarkerCluster> file or carries a marker-cluster:no justification ` +
    `(${scanned} files scanned)`,
);
