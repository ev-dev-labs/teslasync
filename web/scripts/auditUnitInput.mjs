#!/usr/bin/env node
// UnitInput adoption audit (tripwire).
//
// Walks `web/src/**/*.tsx` and fails when any feature page hand-rolls
// the canonical "number with a static unit symbol" pattern instead of
// using the shared `<UnitInput>` from `@/components/forms`.
//
// Detection — a JSX element is flagged when ALL of the following hold:
//
// 1. The element's tag name is one of the known input aliases:
// `Input`, `UiInput`, `ControlInput`, `TextField`. (These are the
// identifiers used in TeslaSync today; new aliases must be added
// to FLAGGED_TAG_NAMES.)
// 2. The element carries a `suffix=` prop whose value is a JSX or
// string literal matching one of the canonical unit symbols
// that `<UnitInput>` knows how to render natively. The literal
// may include a single leading space (e.g. ` mph`).
//
// The set of flagged literals is intentionally conservative — it only
// catches patterns that have a clean drop-in replacement via the
// shared primitive's six `unit` kinds. Compound rate suffixes such as
// "$/kWh", "$/gal", "mpg" are NOT flagged because UnitInput's
// `currency` kind only renders a single symbol and would silently
// drop the per-quantity denominator.
//
// Files allowed to keep a hand-rolled implementation:
//
// - `src/components/forms/UnitInput.tsx` (the primitive itself).
//
// Per-file escape hatch — add a comment within the 10 lines preceding
// the offending JSX:
//
// // unit-input:no <reason>
//
// Run via `npm run audit:unit-input` (chained from `npm run lint`).

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import process from 'node:process'

import ts from 'typescript'

const ROOT = join('src')

const ALLOWED_FILES = new Set(
  [
    join('src', 'components', 'forms', 'UnitInput.tsx'),
  ].map((p) => p.split('/').join(sep)),
)

const FLAGGED_TAG_NAMES = new Set([
  'Input',
  'UiInput',
  'ControlInput',
  'TextField',
])

// Canonical unit-symbol literals UnitInput renders natively. Match
// the trimmed value to keep " mph" and "mph" both flagged.
const FLAGGED_UNIT_SUFFIXES = new Set([
  'mi',
  'km',
  'mph',
  'km/h',
  '°C',
  '°F',
  'kWh',
  'kW',
  'Wh',
  '%',
  'psi',
  'bar',
])

const JUSTIFICATION = 'unit-input:no'

function isTestPath(p) {
  return (
    p.endsWith('.test.tsx') ||
    p.endsWith('.spec.tsx') ||
    p.endsWith('.stories.tsx') ||
    p.includes(`${sep}__tests__${sep}`) ||
    p.includes(`${sep}__mocks__${sep}`)
  )
}

function* walk(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    const p = join(dir, name)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      yield* walk(p)
      continue
    }
    if (!p.endsWith('.tsx')) continue
    if (isTestPath(p)) continue
    yield p
  }
}

/* ── AST helpers ──────────────────────────────────────────────── */

function jsxTagName(opening) {
  const tag = opening.tagName
  if (ts.isIdentifier(tag)) return tag.text
  if (ts.isPropertyAccessExpression(tag) && ts.isIdentifier(tag.name)) {
    return tag.name.text
  }
  return ''
}

/**
 * Returns the raw string value of the `suffix` prop on `opening`,
 * or null when the attribute is absent / non-string.
 *
 *   suffix="mph"               → "mph"
 *   suffix={"mph"}             → "mph"
 *   suffix={" mph"}            → " mph"
 *   suffix={`mph`}             → "mph"   (no-substitution template)
 *   suffix={someExpr}          → null    (non-literal, ignore)
 *   suffix={<span>mph</span>}  → null    (JSX, ignore — caller already
 *                                          used a span explicitly)
 */
function suffixStringLiteral(opening) {
  for (const attr of opening.attributes.properties) {
    if (
      !ts.isJsxAttribute(attr) ||
      !ts.isIdentifier(attr.name) ||
      attr.name.text !== 'suffix'
    ) {
      continue
    }
    const init = attr.initializer
    if (!init) return null
    if (ts.isStringLiteral(init)) return init.text
    if (!ts.isJsxExpression(init) || !init.expression) return null
    const expr = init.expression
    if (ts.isStringLiteral(expr)) return expr.text
    if (
      ts.isNoSubstitutionTemplateLiteral(expr) &&
      typeof expr.text === 'string'
    ) {
      return expr.text
    }
    return null
  }
  return null
}

function hasNoUnitInputJustification(text, position) {
  const lineStart = text.lastIndexOf('\n', position - 1) + 1
  const before = text.slice(0, lineStart)
  const lines = before.split('\n')
  const window = lines.slice(Math.max(0, lines.length - 10))
  return window.some((l) => l.includes(JUSTIFICATION))
}

function locOf(file, sf, node) {
  const { line, character } = sf.getLineAndCharacterOfPosition(
    node.getStart(sf),
  )
  return {
    display: `${file}:${line + 1}:${character + 1}`,
    pos: node.getStart(sf),
  }
}

function* allJsxOpenings(root) {
  const stack = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) continue
    if (ts.isJsxElement(node)) {
      yield node.openingElement
    } else if (ts.isJsxSelfClosingElement(node)) {
      yield node
    }
    ts.forEachChild(node, (c) => stack.push(c))
  }
}

function auditFile(file) {
  const text = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )

  const offences = []
  for (const opening of allJsxOpenings(sf)) {
    const tag = jsxTagName(opening)
    if (!FLAGGED_TAG_NAMES.has(tag)) continue
    const literal = suffixStringLiteral(opening)
    if (literal == null) continue
    const trimmed = literal.trim()
    if (!FLAGGED_UNIT_SUFFIXES.has(trimmed)) continue

    const { display, pos } = locOf(file, sf, opening)
    if (hasNoUnitInputJustification(text, pos)) continue

    offences.push({
      where: display,
      tag,
      suffix: literal,
    })
  }
  return offences
}

/* ── Main ─────────────────────────────────────────────────────── */

const offenders = []
let scanned = 0

for (const file of walk(ROOT)) {
  if (ALLOWED_FILES.has(file)) continue
  scanned++
  const list = auditFile(file)
  for (const o of list) offenders.push(o)
}

if (offenders.length > 0) {
  console.error(
    `\nUnitInput adoption audit failed (${offenders.length} issue(s)):`,
  )
  for (const o of offenders) {
    console.error(
      `  ${o.where}\n      <${o.tag} suffix="${o.suffix}"> uses a canonical unit symbol that <UnitInput> renders natively.`,
    )
  }
  console.error(
    '\nFix by replacing the hand-rolled number+suffix with the shared primitive:\n' +
      '\n' +
      "  import { UnitInput } from '@/components/forms';\n" +
      '\n' +
      '  <UnitInput\n' +
      "    label={t('foo.label', 'Battery Capacity')}\n" +
      "    unit=\"energy\"          // 'distance' | 'energy' | 'temperature' |\n" +
      "                            //  'speed'   | 'percent' | 'currency'\n" +
      '    value={canonicalKwh}    // canonical metric: miles, mph, °C,\n' +
      '                            //  kWh, percent, or currency-as-typed\n' +
      '    onChange={setKwh}\n' +
      '  />\n' +
      '\n' +
      'Compound rate suffixes ("$/kWh", "$/gal", "mpg") are NOT covered ' +
      'by\nthe primitive — document those exceptions with a comment ' +
      'within the 10 lines\npreceding the offending JSX:\n' +
      '\n' +
      `     // ${JUSTIFICATION} <reason>\n`,
  )
  process.exit(1)
}

console.log(
  `OK — no hand-rolled unit-input patterns found (${scanned} file(s) scanned, ` +
    `${ALLOWED_FILES.size} allow-listed primitive(s) skipped).`,
)
