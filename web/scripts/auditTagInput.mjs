#!/usr/bin/env node
// Phase-46 / Prompt 24 — TagInput adoption audit (tripwire).
//
// Walks `web/src/**/*.tsx` and fails if any feature page hand-rolls
// the canonical free-text-tag-chip pattern instead of using the shared
// `<TagInput>` from `@/components/forms`.
//
// Detection — a file is flagged when ALL of the following are true
// inside a single function/component scope:
//
//   1. It declares a `useState<string[]>(...)` hook (the tag list state).
//   2. It renders a JSX `<input ... onKeyDown={...}>` element (free-text
//      typing field with key-handling — the typical Backspace-to-delete
//      / Enter-to-add wiring).
//   3. The same scope iterates a string[] via `Array#map(...)` whose
//      callback renders a JSX element with a child `<button>` carrying
//      `aria-label="Remove ..."` (the chip remove affordance).
//
// Files allowed to keep a hand-rolled implementation:
//
//   - `src/components/forms/TagInput.tsx` (the primitive itself).
//   - `src/components/forms/ComboboxMulti.tsx` (sibling primitive that
//     also uses the chip pattern but for fixed option sets).
//   - Test fixtures and stories.
//
// Per-file escape hatch — add a comment within the 10 lines preceding
// the offending block:
//
//     // tag-input:no <reason>
//
// e.g. the SignalQueryControls signal-multi-select belongs in
// ComboboxMulti, not TagInput, because it picks from a known signal
// universe; that file documents the deferral until the Combobox
// migration lands.
//
// Run via `npm run audit:tag-input` (chained from `npm run lint`).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import process from 'node:process';

import ts from 'typescript';

const ROOT = join('src');

const ALLOWED_FILES = new Set(
  [
    join('src', 'components', 'forms', 'TagInput.tsx'),
    join('src', 'components', 'forms', 'ComboboxMulti.tsx'),
  ].map((p) => p.split('/').join(sep)),
);

const JUSTIFICATION = 'tag-input:no';

function isTestPath(p) {
  return (
    p.endsWith('.test.tsx') ||
    p.endsWith('.spec.tsx') ||
    p.endsWith('.stories.tsx') ||
    p.includes(`${sep}__tests__${sep}`) ||
    p.includes(`${sep}__mocks__${sep}`)
  );
}

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

/* ── AST helpers ──────────────────────────────────────────────── */

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
      yield node.openingElement;
    } else if (ts.isJsxSelfClosingElement(node)) {
      yield node;
    }
    ts.forEachChild(node, (c) => stack.push(c));
  }
}

function isStringArrayUseState(node) {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  // Must be `useState` or `React.useState`.
  if (ts.isIdentifier(callee) && callee.text !== 'useState') return false;
  if (
    ts.isPropertyAccessExpression(callee) &&
    (!ts.isIdentifier(callee.name) || callee.name.text !== 'useState')
  ) {
    return false;
  }
  // Type argument must be `string[]` or `Array<string>` or `readonly string[]`.
  const typeArg = node.typeArguments?.[0];
  if (!typeArg) return false;
  if (ts.isArrayTypeNode(typeArg)) {
    return typeArg.elementType.kind === ts.SyntaxKind.StringKeyword;
  }
  if (ts.isTypeReferenceNode(typeArg) && ts.isIdentifier(typeArg.typeName)) {
    if (
      typeArg.typeName.text === 'Array' &&
      typeArg.typeArguments?.[0]?.kind === ts.SyntaxKind.StringKeyword
    ) {
      return true;
    }
    if (
      typeArg.typeName.text === 'ReadonlyArray' &&
      typeArg.typeArguments?.[0]?.kind === ts.SyntaxKind.StringKeyword
    ) {
      return true;
    }
  }
  return false;
}

/** Whether `opening` is a lower-case `<input>` (HTML element). */
function isHtmlInput(opening) {
  const tag = opening.tagName;
  if (!ts.isIdentifier(tag)) return false;
  // Lower-case first character ⇒ intrinsic element.
  if (tag.text !== 'input') return false;
  return true;
}

function hasJsxAttribute(opening, name) {
  for (const attr of opening.attributes.properties) {
    if (
      ts.isJsxAttribute(attr) &&
      ts.isIdentifier(attr.name) &&
      attr.name.text === name
    ) {
      return true;
    }
  }
  return false;
}

function isArrayMapCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (!ts.isIdentifier(callee.name)) return false;
  return callee.name.text === 'map';
}

function mapCallback(node) {
  const arg = node.arguments?.[0];
  if (!arg) return null;
  if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) return arg;
  return null;
}

/**
 * Returns the JSX string-literal (or template) value of `name`
 * attribute, or null when the attribute is absent / non-string.
 */
function jsxStringAttr(opening, name) {
  for (const attr of opening.attributes.properties) {
    if (
      ts.isJsxAttribute(attr) &&
      ts.isIdentifier(attr.name) &&
      attr.name.text === name
    ) {
      const init = attr.initializer;
      if (init && ts.isStringLiteral(init)) return init.text;
      if (
        init &&
        ts.isJsxExpression(init) &&
        init.expression &&
        ts.isStringLiteral(init.expression)
      ) {
        return init.expression.text;
      }
      // Non-literal expression: return a sentinel non-empty value so
      // detection is conservative — we treat any aria-label expression
      // that mentions "Remove" via `t('...remove...', 'Remove ...')`
      // as a chip remove affordance.
      return '<expr>';
    }
  }
  return null;
}

/**
 * True when `opening` is a `<button ... aria-label="Remove ...">`
 * JSX element (the chip's remove affordance).
 */
function isRemoveButton(opening) {
  if (jsxTagName(opening) !== 'button') return false;
  const aria = jsxStringAttr(opening, 'aria-label');
  if (!aria) return false;
  return /remove/i.test(aria);
}

/**
 * Walk descendants of `body` looking for a JSX element that is a chip
 * remove button. Returns true if found.
 */
function bodyContainsRemoveButton(body) {
  for (const opening of allJsxOpenings(body)) {
    if (isRemoveButton(opening)) return true;
  }
  return false;
}

/* ── Detection ────────────────────────────────────────────────── */

function hasNoTagInputJustification(text, position) {
  const lineStart = text.lastIndexOf('\n', position - 1) + 1;
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

function auditFile(file) {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  // First pass: gather signals.
  let hasStringArrayState = false;
  let hasTypingInput = false;
  let mapWithRemoveBtn = null;

  function visit(node) {
    if (isStringArrayUseState(node)) {
      hasStringArrayState = true;
    }
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      isHtmlInput(node) &&
      hasJsxAttribute(node, 'onKeyDown')
    ) {
      hasTypingInput = true;
    }
    if (mapWithRemoveBtn === null && isArrayMapCall(node)) {
      const fn = mapCallback(node);
      if (fn && fn.body && bodyContainsRemoveButton(fn.body)) {
        mapWithRemoveBtn = node;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);

  if (!hasStringArrayState) return null;
  if (!hasTypingInput) return null;
  if (mapWithRemoveBtn === null) return null;

  const { display, pos } = locOf(file, sf, mapWithRemoveBtn);
  if (hasNoTagInputJustification(text, pos)) return null;

  return {
    where: display,
    why:
      `File hand-rolls the free-text tag-chip pattern (string[] state + ` +
      `typing <input onKeyDown> + .map() rendering a chip with a ` +
      `Remove button). Replace with the shared <TagInput> from ` +
      `'@/components/forms', or document the exception with a ` +
      `\`// ${JUSTIFICATION} <reason>\` comment within the 10 lines ` +
      `preceding the offending JSX.`,
  };
}

/* ── Main ─────────────────────────────────────────────────────── */

const offenders = [];
let scanned = 0;

for (const file of walk(ROOT)) {
  if (ALLOWED_FILES.has(file)) continue;
  scanned++;
  const offence = auditFile(file);
  if (offence) offenders.push(offence);
}

if (offenders.length > 0) {
  console.error(
    `\nTagInput adoption audit failed (${offenders.length} issue(s)):`,
  );
  for (const o of offenders) {
    console.error(`  ${o.where}\n      ${o.why}`);
  }
  console.error(
    '\nFix by replacing the hand-rolled chips with the shared primitive:\n' +
      '\n' +
      "  import { TagInput } from '@/components/forms';\n" +
      '\n' +
      '  const [tags, setTags] = useState<string[]>([]);\n' +
      '  // ...\n' +
      "  <TagInput\n" +
      "    label={t('alerts.tagsLabel', 'Tags')}\n" +
      '    value={tags}\n' +
      '    onChange={setTags}\n' +
      '    placeholder={t("alerts.tagsPlaceholder", "Add tag…")}\n' +
      '    maxTags={20}\n' +
      '  />\n' +
      '\n' +
      'If the chip strip is fed by a known set of values rather than ' +
      'free text,\n' +
      'use <ComboboxMulti> from the same barrel — it covers the ' +
      'autocomplete-from-options case.\n' +
      '\n' +
      'If neither applies, document the exception with a comment ' +
      'within the 10 lines\n' +
      'preceding the offending JSX:\n' +
      '\n' +
      `     // ${JUSTIFICATION} <reason>\n`,
  );
  process.exit(1);
}

console.log(
  `OK — no hand-rolled tag-input patterns found (${scanned} file(s) scanned, ` +
    `${ALLOWED_FILES.size} allow-listed primitive(s) skipped).`,
);
