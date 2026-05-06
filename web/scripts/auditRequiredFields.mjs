#!/usr/bin/env node
// Phase-46 / Prompt 25 — required-field indicator audit (tripwire).
//
// Walks `web/src/**/*.tsx` and fails when a shared form primitive
// (`<Input>`, `<Textarea>`, `<Select>`) is rendered with the `required`
// attribute but does NOT expose any kind of accessible label binding.
//
// The shared primitives auto-render a `<Label>` carrying the visible
// asterisk + sr-only "required" string whenever a `label=` prop is
// passed (see `web/src/components/ui/{Input,Textarea,Select}.tsx`).
// This audit enforces that contract on call sites: a `required` field
// without ANY label hook is invisible to assistive tech and silently
// fails WCAG 3.3.2 (Labels or Instructions).
//
// A flagged JSX element is OK when ANY of the following is true:
//
//   1. It has a `label=` prop (auto-pairs the shared Label).
//   2. It has an `aria-label=` prop (visually-hidden label provided
//      directly on the control — common inside toolbars / chips).
//   3. It has an `aria-labelledby=` prop (label rendered elsewhere on
//      the page and wired explicitly).
//   4. The 10 lines immediately preceding the JSX element contain the
//      escape-hatch comment `// required-field:no <reason>`.
//
// Allowed files (the primitives themselves, exempt because they
// implement the pattern):
//
//   - src/components/ui/Label.tsx
//   - src/components/ui/Input.tsx
//   - src/components/ui/Textarea.tsx
//   - src/components/ui/Select.tsx
//
// Run via `npm run audit:required-fields` (chained from `npm run lint`).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import process from 'node:process';

import ts from 'typescript';

const ROOT = join('src');

const ALLOWED_FILES = new Set(
  [
    join('src', 'components', 'ui', 'Label.tsx'),
    join('src', 'components', 'ui', 'Input.tsx'),
    join('src', 'components', 'ui', 'Textarea.tsx'),
    join('src', 'components', 'ui', 'Select.tsx'),
  ].map((p) => p.split('/').join(sep)),
);

// JSX tag names that are shared form primitives. Lowercase intrinsic
// elements like `<input required>` are intentionally NOT flagged —
// migrating those to the shared primitive is its own sweep.
const FLAGGED_TAG_NAMES = new Set(['Input', 'Textarea', 'Select']);

const JUSTIFICATION = 'required-field:no';

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

function hasJustification(text, position) {
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

const offenders = [];

function auditFile(file) {
  if (ALLOWED_FILES.has(file)) return false;
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
    if (!hasJsxAttribute(opening, 'required')) continue;
    if (
      hasJsxAttribute(opening, 'label') ||
      hasJsxAttribute(opening, 'aria-label') ||
      hasJsxAttribute(opening, 'aria-labelledby')
    ) {
      continue;
    }
    const { display, pos } = locOf(file, sf, opening);
    if (hasJustification(text, pos)) continue;
    offenders.push({ where: display, tag: name });
  }
  return true;
}

let scanned = 0;
for (const file of walk(ROOT)) {
  if (auditFile(file)) scanned++;
}

if (offenders.length > 0) {
  console.error(
    `\nRequired-field indicator audit failed (${offenders.length} issue(s)):`,
  );
  for (const o of offenders) {
    console.error(`  ${o.where}`);
    console.error(
      `      <${o.tag} required …> with no label / aria-label / aria-labelledby`,
    );
  }
  console.error(
    '\nFix by passing a `label=` prop so the shared primitive can render\n' +
      'the paired <Label required> with a visible asterisk + sr-only\n' +
      '"required" string. For controls whose visible label lives elsewhere\n' +
      '(toolbar group, table column header, etc.), provide aria-label or\n' +
      'aria-labelledby instead.\n\n' +
      'To opt out (e.g. browser HTML5 validation only), document the\n' +
      'reason on a line within the 10 lines preceding the JSX:\n\n' +
      '  // required-field:no html5-only — handled by browser submit guard\n' +
      '  <Input required value={…} onChange={…} />\n',
  );
  process.exit(1);
}

console.log(
  `OK — every <Input|Textarea|Select required> in the ${scanned} ` +
    `scanned file(s) carries a label / aria-label / aria-labelledby ` +
    `or a ${JUSTIFICATION} justification.`,
);
