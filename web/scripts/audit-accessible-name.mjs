#!/usr/bin/env node
/**
 * Accessible-name audit (A11Y).
 *
 * Walks `web/src/**` and fails when an interactive control ships with
 * no accessible name.
 *
 * Why this exists
 * ---------------
 * An icon-only control is announced by screen readers as "button" —
 * nothing more. Voice-control users cannot address it at all ("click
 * …what?"). WCAG 4.1.2 (Name, Role, Value) makes a name mandatory for
 * every user-interface component, and it is the single most common
 * violation reintroduced by ordinary feature work: `<Button
 * icon={<Trash2 />} />` looks complete in review and is invisible to
 * the audit tools that only run on built pages.
 *
 * axe (via the Playwright a11y project) catches these at runtime, but
 * only on the handful of routes the smoke suite visits. This audit is
 * the static complement: it covers every file, runs in a second, and
 * fails the build before the code is ever rendered.
 *
 * What counts as a name
 * ---------------------
 * Any of:
 *   - `aria-label` / `aria-labelledby` / `title` / `alt` attribute
 *     (including the spread-through `{...props}` case — see below),
 *   - visible text content between the tags,
 *   - a `{expression}` child (a variable or `t()` call that renders
 *     text),
 *   - a `<VisuallyHidden>` child.
 *
 * A control whose children are exclusively self-closing JSX elements
 * (i.e. icons) and which carries none of the labelling attributes is an
 * offender.
 *
 * Escape hatch
 * ------------
 * Controls whose name genuinely comes from somewhere the scanner
 * cannot see (a spread of pre-built props, a parent `aria-labelledby`)
 * can opt out with an inline `{/* a11y-name-ok: <reason> *␘/}` comment
 * on the line directly above, or by listing the file in
 * {@link ALLOWED_FILES}.
 *
 * Run: `node scripts/audit-accessible-name.mjs`
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import process from 'node:process';

const ROOT = join('src');

/** Tags that must carry an accessible name. */
const AUDITED_TAGS = new Set(['button', 'Button', 'IconButton', 'a']);

/**
 * Native form controls that must be named. These are audited with a
 * looser rule than buttons: an `id` counts as named, because the label
 * may be a sibling `<label htmlFor>` that a static scanner cannot
 * follow. The check still catches the common real defect — a control
 * named by `placeholder` alone, which vanishes the moment the user
 * types.
 */
const AUDITED_FORM_TAGS = new Set(['input', 'select', 'textarea']);

/** `input` types that are not user-facing controls needing a name. */
const UNNAMED_INPUT_TYPES = new Set(['hidden']);

/** Attributes that supply a name directly. */
const NAME_ATTRS = [
  'aria-label',
  'aria-labelledby',
  'title',
  'alt',
  // `Button` forwards these to the DOM node; a caller that threads a
  // label through a prop bag is named at runtime.
  '{...',
];

/**
 * Files exempt from the audit.
 *
 * - The shared `Button` implementation itself renders `{children}` and
 *   cannot know its own name.
 * - Test files assert on unnamed controls deliberately.
 */
const ALLOWED_FILES = new Set([
  toKey(join('src', 'components', 'ui', 'Button.tsx')),
]);

/** Inline opt-out marker, checked on the two lines above the tag. */
const OPT_OUT_RE = /a11y-name-ok/;

function toKey(p) {
  return p.split(sep).join('/');
}

const offenders = [];

/**
 * Ranges covering line and block comments. JSX inside a doc-comment
 * `@example` is documentation, not shipped markup, and must not be
 * audited — otherwise every component that documents its own usage
 * fails its own rule.
 */
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
    if (ALLOWED_FILES.has(toKey(p))) continue;
    auditFile(p);
  }
}

/**
 * Find the index just past the `>` that closes the JSX opening tag
 * starting at `start` (which points at the `<`).
 *
 * Quote- and brace-aware, so `icon={<Download className="h-4 w-4" />}`
 * does not terminate the scan early. Returns `{ end, selfClosing }`, or
 * null when the tag is unterminated (truncated file).
 */
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
    // Comments are legal between JSX attributes and routinely contain
    // `>` (e.g. a doc note mentioning `<RefreshCw>`). Skipping them
    // keeps the scan from terminating the tag early and losing the
    // `aria-label` that follows.
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
    if (depth === 0 && c === '>') {
      const selfClosing = text[i - 1] === '/';
      return { end: i + 1, selfClosing };
    }
    i++;
  }
  return null;
}

/**
 * Extract the children of `<tag>` whose opening tag ends at `from`.
 * Counts nested same-name tags so `<button><button/></button>` does not
 * terminate on the inner close. Returns null when unbalanced.
 */
function findChildren(text, tag, from) {
  const openRe = new RegExp(`<${tag}(?=[\\s/>])`, 'g');
  const closeRe = new RegExp(`</${tag}\\s*>`, 'g');
  let depth = 1;
  let cursor = from;
  while (cursor < text.length) {
    openRe.lastIndex = cursor;
    closeRe.lastIndex = cursor;
    const open = openRe.exec(text);
    const close = closeRe.exec(text);
    if (!close) return null;
    if (open && open.index < close.index) {
      depth++;
      const openEnd = findOpenTagEnd(text, open.index);
      cursor = openEnd ? openEnd.end : open.index + 1;
      if (openEnd?.selfClosing) depth--;
      continue;
    }
    depth--;
    if (depth === 0) return text.slice(from, close.index);
    cursor = close.index + close[0].length;
  }
  return null;
}

/**
 * True when `children` renders something a screen reader can read.
 *
 * Self-closing JSX elements are stripped first: those are icons. What
 * remains must contain a `{expression}` (a variable or `t()` call), a
 * `<VisuallyHidden>`, or literal non-whitespace text.
 */
function hasReadableChildren(children) {
  if (children == null) return false;
  if (/<VisuallyHidden\b/.test(children)) return true;
  // Drop self-closing elements (icons) and JSX comments.
  const stripped = children
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/<[A-Za-z][\w.]*(?:\s[^<>]*?)?\/>/g, '');
  if (/\{[^}]*\}/.test(stripped)) return true;
  // Any remaining tag pair with content counts as text.
  const text = stripped.replace(/<[^>]*>/g, '');
  return /\S/.test(text);
}

function hasNameAttribute(openTag) {
  return NAME_ATTRS.some((attr) => openTag.includes(attr));
}

/**
 * True when `offset` sits inside a `<label>…</label>` pair — the
 * implicit-labelling pattern, where the wrapper's text names the
 * control it contains.
 *
 * Implemented as a backwards scan for the most recent `<label` /
 * `</label>` marker: if the nearest one is an opening tag, we are
 * inside a label.
 */
function isInsideLabel(text, offset) {
  const before = text.slice(0, offset);
  const lastOpen = before.lastIndexOf('<label');
  if (lastOpen === -1) return false;
  const lastClose = before.lastIndexOf('</label>');
  return lastOpen > lastClose;
}

function auditFile(path) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  const comments = buildCommentRegions(text);

  for (const tag of AUDITED_TAGS) {
    const tagRe = new RegExp(`<${tag}(?=[\\s/>])`, 'g');
    let match;
    while ((match = tagRe.exec(text)) !== null) {
      if (isMasked(comments, match.index)) continue;
      const openInfo = findOpenTagEnd(text, match.index);
      if (!openInfo) continue;
      const openTag = text.slice(match.index, openInfo.end);
      if (hasNameAttribute(openTag)) continue;

      // `<a>` without href is not an interactive control.
      if (tag === 'a' && !/\bhref[=\s]/.test(openTag) && !/\bto[=\s]/.test(openTag)) {
        continue;
      }

      const children = openInfo.selfClosing
        ? null
        : findChildren(text, tag, openInfo.end);
      if (hasReadableChildren(children)) continue;

      const line = text.slice(0, match.index).split('\n').length;
      const context = [lines[line - 3] ?? '', lines[line - 2] ?? ''].join('\n');
      if (OPT_OUT_RE.test(context) || OPT_OUT_RE.test(lines[line - 1] ?? '')) {
        continue;
      }

      offenders.push({
        where: `${path}:${line}`,
        snippet: openTag.replace(/\s+/g, ' ').slice(0, 160),
      });
    }
  }

  for (const tag of AUDITED_FORM_TAGS) {
    const tagRe = new RegExp(`<${tag}(?=[\\s/>])`, 'g');
    let match;
    while ((match = tagRe.exec(text)) !== null) {
      if (isMasked(comments, match.index)) continue;
      const openInfo = findOpenTagEnd(text, match.index);
      if (!openInfo) continue;
      const openTag = text.slice(match.index, openInfo.end);
      if (hasNameAttribute(openTag)) continue;
      // An `id` implies a `<label htmlFor>` we cannot resolve statically.
      if (/\bid[=\s]/.test(openTag)) continue;
      // Implicit labelling: `<label> <input/> text </label>` names the
      // control by its wrapper's text content. Look backwards for an
      // unclosed `<label` to detect it.
      if (isInsideLabel(text, match.index)) continue;
      const typeMatch = /\btype=["']([\w-]+)["']/.exec(openTag);
      if (typeMatch && UNNAMED_INPUT_TYPES.has(typeMatch[1])) continue;

      const line = text.slice(0, match.index).split('\n').length;
      const context = [lines[line - 3] ?? '', lines[line - 2] ?? ''].join('\n');
      if (OPT_OUT_RE.test(context) || OPT_OUT_RE.test(lines[line - 1] ?? '')) {
        continue;
      }

      offenders.push({
        where: `${path}:${line}`,
        snippet: openTag.replace(/\s+/g, ' ').slice(0, 160),
      });
    }
  }
}

walk(ROOT);

if (offenders.length > 0) {
  console.error(
    `\naccessible-name audit: ${offenders.length} interactive control(s) ` +
      `have no accessible name (WCAG 4.1.2):`,
  );
  for (const o of offenders) {
    console.error(`  ${o.where}\n      ${o.snippet}`);
  }
  console.error(
    '\nFix by giving the control a name:\n' +
      '\n' +
      '  // Icon-only button — label it:\n' +
      "  <Button icon={<Trash2 className=\"h-4 w-4\" />}\n" +
      "          aria-label={t('drives.delete', 'Delete drive')} />\n" +
      '\n' +
      '  // Or add visually-hidden text (also gives voice control a target):\n' +
      "  <Button icon={<Trash2 className=\"h-4 w-4\" />}>\n" +
      "    <VisuallyHidden>{t('drives.delete', 'Delete drive')}</VisuallyHidden>\n" +
      '  </Button>\n' +
      '\n' +
      '  // If the name genuinely comes from elsewhere, document it:\n' +
      '  {/* a11y-name-ok: named by the parent aria-labelledby group */}\n',
  );
  process.exit(1);
}

console.log(`OK — every audited interactive control in ${ROOT} has an accessible name`);
