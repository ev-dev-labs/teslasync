#!/usr/bin/env node
// PrefetchLink adoption audit.
//
// Locks in the rule that the layout primitives that render in-app
// navigation links MUST use `<PrefetchLink>` instead of any of the
// underlying link primitives (`<Link>`, `<NavLink>`,
// `<GuardedLink>`, `<GuardedNavLink>`). PrefetchLink wraps
// `<GuardedLink>` and additionally calls `prefetchRoute()` on
// hover/focus so the lazy chunk for the destination route is in
// the cache by the time the click lands.
//
// Why this exists
// ---------------
// Every route in `App.tsx` is code-split via `React.lazy()`. The
// first navigation pays the full chunk-fetch + parse cost — visible
// as a brief PageLoadSkeleton flash on a typical 100 ms-RTT network.
// PrefetchLink eliminates the flash for hovered/focused destinations.
//
// Audit scope
// -----------
// Only the small set of layout files that own the primary nav
// chrome — Sidebar, BottomTabBar, Breadcrumbs. Application-level
// shells (Layout.tsx) and feature pages are out of scope until they
// migrate; gating on them right now would be unenforceable.
//
// Forward-going contract: any new layout file added under the audit
// scope must use PrefetchLink for in-app navigation, or carry a
// `// prefetch-link:no <reason>` justification on a line within 10
// lines preceding the offending JSX (e.g. an external link, an
// anchor target outside the SPA, a dev-only placeholder).
//
// Run via `npm run audit:prefetch-link` (chained from `npm run lint`).

import { readFileSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import process from 'node:process';

import ts from 'typescript';

const ROOT = join('src');

// Files in scope. PrefetchLink.tsx itself is excluded — it must
// internally render `<GuardedLink>` to do its work.
const TARGETS = [
  join(ROOT, 'components', 'layout', 'Sidebar.tsx'),
  join(ROOT, 'components', 'layout', 'BottomTabBar.tsx'),
  join(ROOT, 'components', 'layout', 'Breadcrumbs.tsx'),
];

// Tag names that, when used as a JSX element in a target file,
// indicate the caller is rendering an in-app navigation link
// without the prefetch + guard wrapper.
const FLAGGED_TAG_NAMES = new Set([
  'Link',
  'NavLink',
  'GuardedLink',
  'GuardedNavLink',
]);

const JUSTIFICATION = 'prefetch-link:no';

function isTestPath(p) {
  return (
    p.endsWith('.test.tsx') ||
    p.endsWith('.spec.tsx') ||
    p.includes(`${sep}__tests__${sep}`) ||
    p.includes(`${sep}__mocks__${sep}`)
  );
}

function jsxTagName(opening) {
  const tag = opening.tagName;
  if (ts.isIdentifier(tag)) return tag.text;
  if (ts.isPropertyAccessExpression(tag) && ts.isIdentifier(tag.name)) {
    return tag.name.text;
  }
  return '';
}

function* allJsxOpenings(root) {
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (ts.isJsxElement(node)) {
      stack.push(node.openingElement);
      ts.forEachChild(node, (c) => stack.push(c));
      continue;
    }
    if (ts.isJsxSelfClosingElement(node)) {
      yield node;
      ts.forEachChild(node, (c) => stack.push(c));
      continue;
    }
    if (ts.isJsxOpeningElement(node)) {
      yield node;
      continue;
    }
    ts.forEachChild(node, (c) => stack.push(c));
  }
}

function hasJustification(text, pos) {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const before = text.slice(0, lineStart);
  const lines = before.split('\n');
  const window = lines.slice(Math.max(0, lines.length - 10));
  return window.some((l) => l.includes(JUSTIFICATION));
}

function locOf(file, sf, node) {
  const { line, character } = sf.getLineAndCharacterOfPosition(
    node.getStart(sf),
  );
  return {
    display: `${file}:${line + 1}:${character + 1}`,
    pos: node.getStart(sf),
  };
}

const offenders = [];

function auditFile(file) {
  if (!existsSync(file)) return false;
  if (isTestPath(file)) return false;
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  for (const opening of allJsxOpenings(sf)) {
    const name = jsxTagName(opening);
    if (!FLAGGED_TAG_NAMES.has(name)) continue;
    const { display, pos } = locOf(file, sf, opening);
    if (hasJustification(text, pos)) continue;
    offenders.push({
      where: display,
      tag: name,
      why:
        `<${name}> rendered in a layout primitive that owns in-app ` +
        `navigation chrome. Replace with <PrefetchLink> so the lazy ` +
        `chunk for the destination route is fetched on hover/focus, ` +
        `or justify with a \`// ${JUSTIFICATION} <reason>\` comment ` +
        `on one of the 10 lines preceding the JSX.`,
    });
  }
  return true;
}

let scanned = 0;
for (const file of TARGETS) {
  if (auditFile(file)) scanned++;
}

if (offenders.length > 0) {
  console.error(
    `\nPrefetchLink adoption audit failed (${offenders.length} issue(s)):`,
  );
  for (const o of offenders) {
    console.error(`  ${o.where}\n      ${o.why}`);
  }
  console.error(
    '\nFix by replacing the primitive with the shared component:\n' +
      '\n' +
      '  // BEFORE:\n' +
      "  import { GuardedLink } from '../feedback/GuardedLink';\n" +
      '  …\n' +
      '  <GuardedLink to="/battery">Battery</GuardedLink>\n' +
      '\n' +
      '  // AFTER:\n' +
      "  import { PrefetchLink } from './PrefetchLink';\n" +
      '  …\n' +
      '  <PrefetchLink to="/battery">Battery</PrefetchLink>\n' +
      '\n' +
      'If the link genuinely should not be a PrefetchLink (external\n' +
      'href, anchor inside the same page, dev-only stub, etc.),\n' +
      'document the reason on the line above the JSX:\n' +
      '\n' +
      '  // prefetch-link:no external — opens vendor docs in a new tab\n' +
      '  <Link to="https://example.com">Docs</Link>\n',
  );
  process.exit(1);
}

console.log(
  `OK — every <Link>/<NavLink>/<GuardedLink>/<GuardedNavLink> in the ` +
    `${scanned} audited layout file(s) is either a <PrefetchLink> or ` +
    `carries a ${JUSTIFICATION} justification.`,
);
