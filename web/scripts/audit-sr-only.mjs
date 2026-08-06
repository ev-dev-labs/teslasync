#!/usr/bin/env node
/**
 * sr-only audit.
 *
 * Walks `web/src/**` and fails if the literal Tailwind utility
 * `sr-only` appears anywhere outside the canonical
 * `src/components/a11y/VisuallyHidden.tsx` implementation.
 *
 * Why this exists
 * ---------------
 * retired ad-hoc `<span class="sr-only">` spans
 * in favour of `<VisuallyHidden>` and `useAnnouncer()`. Centralising
 * the styling target lets us:
 * - add `aria-live` / `aria-atomic` consistently via `liveRegion`
 * (instead of every dev forgetting one of the trio of attributes),
 * - swap the underlying CSS implementation in one place (e.g. drop
 * to a `clip: rect(...)` polyfill if a future Tailwind version
 * changes the shipped `.sr-only` definition), and
 * - guarantee the audit is the only mechanism that checks for the
 * class — no string concat tricks slipping past code review.
 *
 * The audit allows the negative form `not-sr-only` everywhere
 * (Tailwind exposes it explicitly to override `sr-only` while the
 * element is focused; banning it would prevent legitimate skip-link
 * patterns built on top of `<VisuallyHidden focusable>`).
 *
 * Run via `npm run audit:sr-only` (chained from `npm run lint`).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import process from 'node:process';

const ROOT = join('src');

/**
 * Files that are explicitly allowed to contain the literal `sr-only`
 * class name. Any other file referencing it fails the audit.
 *
 * - `VisuallyHidden.tsx` is the canonical implementation.
 * - The matching test file asserts the exact class name lands on the
 * rendered DOM, so it has to spell `sr-only` to make assertions.
 * - `Checkbox.tsx` (UI primitive) layers a real `<input type="checkbox">`
 * underneath a styled indicator. The native input MUST be `peer sr-only`
 * so Tailwind `peer-*:` variants on the indicator can read its state
 * while it stays in the accessibility tree. Wrapping it in
 * `<VisuallyHidden>` would break the `peer` sibling relationship.
 * - `RadioCard.tsx` is the same pattern for `<input type="radio">`: the
 * card body reads `peer-checked:` / `peer-focus-visible:` off the native
 * input, so the input has to stay a direct `peer` sibling.
 */
const ALLOWED_FILES = new Set([
  toAllowKey(join('src', 'components', 'a11y', 'VisuallyHidden.tsx')),
  toAllowKey(join('src', 'components', 'a11y', '__tests__', 'VisuallyHidden.test.tsx')),
  toAllowKey(join('src', 'components', 'ui', 'Checkbox.tsx')),
  toAllowKey(join('src', 'components', 'ui', 'RadioCard.tsx')),
]);

function toAllowKey(p) {
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
    if (!isScannable(p)) continue;
    auditFile(p);
  }
}

function isScannable(p) {
  return (
    p.endsWith('.ts') ||
    p.endsWith('.tsx') ||
    p.endsWith('.js') ||
    p.endsWith('.jsx')
  );
}

// Match `sr-only` as a Tailwind class — bounded by word boundaries
// so it doesn't false-match `screen-reader-only` or similar — and
// EXCLUDE the negation form `not-sr-only` (which is a legitimate
// Tailwind utility for overriding `sr-only` on focus). The negative
// lookbehind requires Node 14+; CI runs on Node 20.
const SR_ONLY_RE = /(?<!not-)\bsr-only\b/g;

// Build a list of [start, end) ranges in `text` covering line and
// block comments. Mentions of `sr-only` inside doc-comments are
// allowed (this audit only cares about runtime CSS class names),
// so the scanner skips matches that fall inside a masked range.
//
// String literals are deliberately NOT masked — `className="sr-only"`
// IS a string literal and is exactly the pattern this audit is
// designed to catch.
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

function auditFile(path) {
  const text = readFileSync(path, 'utf8');
  const allowKey = toAllowKey(path);
  const isAllowed = ALLOWED_FILES.has(allowKey);
  // Reset before each scan because the regex is global.
  SR_ONLY_RE.lastIndex = 0;
  let m;
  let masked = null;
  while ((m = SR_ONLY_RE.exec(text)) !== null) {
    if (isAllowed) continue;
    if (masked === null) masked = buildCommentRegions(text);
    if (isMasked(masked, m.index)) continue;
    const line = text.slice(0, m.index).split('\n').length;
    offenders.push({
      where: `${path}:${line}`,
      snippet: snippetAt(text, m.index),
    });
  }
}

function snippetAt(text, offset) {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const lineEndRaw = text.indexOf('\n', offset);
  const lineEnd = lineEndRaw === -1 ? text.length : lineEndRaw;
  return text.slice(lineStart, lineEnd).trim();
}

walk(ROOT);

if (offenders.length > 0) {
  console.error(
    `\nsr-only audit: ${offenders.length} unexpected occurrence(s) of the ` +
      `Tailwind \`sr-only\` utility outside the VisuallyHidden component.`,
  );
  for (const o of offenders) {
    console.error(`  ${o.where}\n      ${o.snippet}`);
  }
  console.error(
    '\nFix by routing through the shared accessibility primitives:\n' +
      '\n' +
      '  // Visually-hidden static label:\n' +
      "  import { VisuallyHidden } from '@/components/a11y';\n" +
      '  <VisuallyHidden as="label" htmlFor="x">Select all</VisuallyHidden>\n' +
      '\n' +
      '  // Live-region announcement (role=status + aria-live + aria-atomic):\n' +
      '  <VisuallyHidden liveRegion>{message}</VisuallyHidden>\n' +
      '\n' +
      '  // Skip-link / "visible on focus" pattern:\n' +
      '  <VisuallyHidden as="a" focusable href="#main"\n' +
      '    className="focus:fixed focus:top-4 focus:left-4 ...">\n' +
      "    Skip to main content\n" +
      '  </VisuallyHidden>\n' +
      '\n' +
      '  // Imperative announcements from event handlers / mutations:\n' +
      "  import { useAnnouncer } from '@/hooks/useAnnouncer';\n" +
      '  const { announce } = useAnnouncer();\n' +
      '  announce(t(\'bulk.archived\', \'{{count}} items archived\', { count }));\n',
  );
  process.exit(1);
}

console.log(`OK — no ad-hoc \`sr-only\` outside VisuallyHidden in ${ROOT}`);
