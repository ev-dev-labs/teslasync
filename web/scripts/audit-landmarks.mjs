#!/usr/bin/env node
/**
 * Landmark + heading structure audit (A11Y-09).
 *
 * Screen-reader users navigate by landmark ("go to main content") and
 * by heading ("list all headings"). Both only work if the markup is
 * structurally honest. This audit enforces the four contracts that
 * ordinary feature work most often breaks:
 *
 * 1. **Every `<h1>` is a route-focus target.** `<RouteFocusManager>`
 *    parks keyboard focus on `[data-route-focus-target]` after a
 *    client-side navigation. A page that renders its own bespoke
 *    heading without the marker silently falls back to `<main>`, so
 *    the user is dropped above the page title instead of on it.
 * 2. **One `<h1>` per rendered page.** A file may not emit two
 *    top-level headings on the same branch — "list all headings" turns
 *    into guesswork about which one is the page.
 * 3. **Every navigation landmark is named.** A page with three
 *    unnamed `<nav>` elements gives the user "navigation, navigation,
 *    navigation" in the landmark list.
 * 4. **Every generic region is named.** `role="region"` without an
 *    accessible name is not exposed as a landmark at all by most
 *    screen readers — the markup looks correct and does nothing.
 *
 * Escape hatch: `{/* a11y-landmark-ok: <reason> *␘/}` on one of the two
 * lines above the element.
 *
 * Run: `node scripts/audit-landmarks.mjs`
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import process from 'node:process';

const ROOT = join('src');

/** Marker attribute that `<RouteFocusManager>` looks for. */
const ROUTE_FOCUS_ATTR = 'data-route-focus-target';

const OPT_OUT_RE = /a11y-landmark-ok/;

/**
 * Files that legitimately render an `<h1>` that is NOT the route
 * heading, or that contain landmark markup for documentation purposes.
 */
const H1_EXEMPT = new Set([
  // The manager documents the `<h1>` contract in its own doc comment.
  toKey(join('src', 'components', 'a11y', 'RouteFocusManager.tsx')),
]);

function toKey(p) {
  return p.split(sep).join('/');
}

const offenders = [];

function walk(dir) {
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
      walk(p);
      continue;
    }
    if (!p.endsWith('.tsx')) continue;
    if (p.includes('.test.')) continue;
    auditFile(p);
  }
}

function buildCommentRegions(text) {
  const regions = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      const start = i;
      i += 2;
      while (i < text.length && text[i] !== '\n') i++;
      regions.push([start, i]);
      continue;
    }
    if (c === '/' && next === '*') {
      const start = i;
      i += 2;
      while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      regions.push([start, i]);
      continue;
    }
    i++;
  }
  return regions;
}

function isMasked(regions, offset) {
  for (const [s, e] of regions) {
    if (offset >= s && offset < e) return true;
    if (s > offset) return false;
  }
  return false;
}

/** End of the JSX opening tag beginning at `start`; quote/brace aware. */
function findOpenTagEnd(text, start) {
  let i = start + 1;
  let depth = 0;
  let quote = null;
  while (i < text.length) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '{') {
      depth++;
      i++;
      continue;
    }
    if (c === '}') {
      depth--;
      i++;
      continue;
    }
    if (depth === 0 && c === '>') return i + 1;
    i++;
  }
  return -1;
}

function lineOf(text, offset) {
  return text.slice(0, offset).split('\n').length;
}

/**
 * True when an `a11y-landmark-ok` marker appears on the element's own
 * line or within the five lines above it. Five, not two, because the
 * justification for an exemption is usually a sentence or three of
 * prose and the marker sits at the top of that block.
 */
function optedOut(lines, line) {
  const from = Math.max(0, line - 6);
  return lines.slice(from, line).some((l) => OPT_OUT_RE.test(l ?? ''));
}

function report(path, text, lines, offset, rule, detail) {
  const line = lineOf(text, offset);
  if (optedOut(lines, line)) return;
  offenders.push({ where: `${path}:${line}`, rule, detail });
}

/** Collect every occurrence of `pattern` with its opening-tag text. */
function* tags(text, comments, pattern) {
  const re = new RegExp(pattern, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    if (isMasked(comments, m.index)) continue;
    const end = findOpenTagEnd(text, m.index);
    if (end === -1) continue;
    yield { index: m.index, openTag: text.slice(m.index, end) };
  }
}

function hasName(openTag) {
  return (
    openTag.includes('aria-label') ||
    openTag.includes('aria-labelledby') ||
    openTag.includes('{...')
  );
}

function auditFile(path) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  const comments = buildCommentRegions(text);
  const key = toKey(path);

  // 1 + 2 — <h1> contract.
  if (!H1_EXEMPT.has(key)) {
    const h1s = [...tags(text, comments, '<h1(?=[\\s/>])')];
    for (const h1 of h1s) {
      if (!h1.openTag.includes(ROUTE_FOCUS_ATTR)) {
        report(
          path,
          text,
          lines,
          h1.index,
          'h1-not-focus-target',
          `<h1> has no ${ROUTE_FOCUS_ATTR}, so route focus falls back to <main>`,
        );
      } else if (!/tabIndex=\{-1\}/.test(h1.openTag)) {
        report(
          path,
          text,
          lines,
          h1.index,
          'h1-not-focusable',
          '<h1> is a route-focus target but is not programmatically focusable (needs tabIndex={-1})',
        );
      }
    }
    if (h1s.length > 1) {
      report(
        path,
        text,
        lines,
        h1s[1].index,
        'multiple-h1',
        `${h1s.length} <h1> elements in one file — a page has exactly one top-level heading`,
      );
    }
  }

  // 3 — navigation landmarks must be named.
  for (const nav of tags(text, comments, '<nav(?=[\\s/>])')) {
    if (!hasName(nav.openTag)) {
      report(
        path,
        text,
        lines,
        nav.index,
        'unnamed-nav',
        '<nav> landmark has no aria-label / aria-labelledby',
      );
    }
  }

  // 4 — generic regions must be named or they are not landmarks at all.
  for (const region of tags(text, comments, '<[A-Za-z][\\w.]*(?=[^>]*role="region")')) {
    if (!hasName(region.openTag)) {
      report(
        path,
        text,
        lines,
        region.index,
        'unnamed-region',
        'role="region" has no accessible name, so it is not exposed as a landmark',
      );
    }
  }
}

walk(ROOT);

if (offenders.length > 0) {
  console.error(
    `\nlandmark audit: ${offenders.length} structural accessibility ` +
      `violation(s):`,
  );
  for (const o of offenders) {
    console.error(`  [${o.rule}] ${o.where}\n      ${o.detail}`);
  }
  console.error(
    '\nRemediation:\n' +
      '\n' +
      '  // A page heading must be the route-focus target:\n' +
      '  <h1 tabIndex={-1} data-route-focus-target="true">…</h1>\n' +
      '  // …or just use <PageContainer title=…>, which does it for you.\n' +
      '\n' +
      '  // Name every navigation landmark:\n' +
      "  <nav aria-label={t('battery.links.title', 'Explore more')}>…</nav>\n" +
      '\n' +
      '  // Name every generic region (or drop role="region" entirely):\n' +
      "  <section role=\"region\" aria-label={t('drives.map', 'Route map')}>…</section>\n",
  );
  process.exit(1);
}

console.log(`OK — landmark and heading structure is sound across ${ROOT}`);
