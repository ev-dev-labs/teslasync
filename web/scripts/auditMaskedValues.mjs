#!/usr/bin/env node
// Phase-46 / Prompt 32 — masked-value adoption audit (tripwire).
//
// Walks web/src/**/*.tsx and fails when a JSX expression renders the
// raw value of a known-sensitive field (api token, secret, refresh
// token, etc.) without wrapping it in <MaskedValue>.
//
// Detection — a JSX expression `{expr}` is flagged when ALL of the
// following hold:
//
//   1. `expr` is a PropertyAccessExpression whose right-hand
//      identifier is in SENSITIVE_FIELD_NAMES, OR an Identifier whose
//      name is in SENSITIVE_FIELD_NAMES.
//   2. The expression is rendered as direct JSX text content (i.e.
//      the immediate parent is a JsxElement / JsxFragment), NOT
//      inside a JSX attribute value, NOT inside a comparison /
//      condition, and NOT a property destructure.
//   3. None of the JSX ancestors up to the file root is a
//      `<MaskedValue>` element.
//
// Per-call escape hatch — add a comment within the 10 lines preceding
// the offending JSX:
//
//     // masked-value:no <reason>
//
// Files allowed to keep the cleartext render:
//
//   - `src/components/ui/MaskedValue.tsx`         (the primitive)
//   - `src/components/ui/__tests__/MaskedValue.test.tsx`
//   - `src/lib/maskValue.ts` (no JSX but listed for completeness)
//
// Run via `npm run audit:masked-values` (chained from `npm run lint`).

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import process from 'node:process'

import ts from 'typescript'

const ROOT = join('src')

const ALLOWED_FILES = new Set(
  [
    join('src', 'components', 'ui', 'MaskedValue.tsx'),
    join('src', 'components', 'ui', '__tests__', 'MaskedValue.test.tsx'),
  ].map((p) => p.split('/').join(sep)),
)

// Field names that should never be rendered cleartext in JSX. Keep
// this list narrow — overly broad matches (e.g. plain "token") would
// produce too many false positives across the codebase.
const SENSITIVE_FIELD_NAMES = new Set([
  'refresh_token',
  'refreshToken',
  'access_token',
  'accessToken',
  'client_secret',
  'clientSecret',
  'secret_key',
  'secretKey',
  'private_key',
  'privateKey',
  'api_secret',
  'apiSecret',
])

const JUSTIFICATION = 'masked-value:no'

function isTestPath(p) {
  return (
    p.endsWith('.test.tsx') ||
    p.endsWith('.spec.tsx') ||
    p.endsWith('.stories.tsx') ||
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

function jsxTagName(node) {
  if (!node) return ''
  let opening
  if (ts.isJsxElement(node)) opening = node.openingElement
  else if (ts.isJsxSelfClosingElement(node)) opening = node
  else return ''
  const tag = opening.tagName
  if (ts.isIdentifier(tag)) return tag.text
  if (ts.isPropertyAccessExpression(tag) && ts.isIdentifier(tag.name)) {
    return tag.name.text
  }
  return ''
}

function isInsideMaskedValueAncestor(node) {
  let cur = node.parent
  while (cur) {
    if (ts.isJsxElement(cur) || ts.isJsxSelfClosingElement(cur)) {
      if (jsxTagName(cur) === 'MaskedValue') return true
    }
    cur = cur.parent
  }
  return false
}

function sensitiveNameOfExpression(expr) {
  if (!expr) return null
  if (ts.isIdentifier(expr) && SENSITIVE_FIELD_NAMES.has(expr.text)) {
    return expr.text
  }
  if (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.name) &&
    SENSITIVE_FIELD_NAMES.has(expr.name.text)
  ) {
    return expr.name.text
  }
  // Element access like data['refresh_token'].
  if (
    ts.isElementAccessExpression(expr) &&
    expr.argumentExpression &&
    ts.isStringLiteral(expr.argumentExpression) &&
    SENSITIVE_FIELD_NAMES.has(expr.argumentExpression.text)
  ) {
    return expr.argumentExpression.text
  }
  return null
}

function hasNoJustification(text, position) {
  const lineStart = text.lastIndexOf('\n', position - 1) + 1
  const before = text.slice(0, lineStart)
  const lines = before.split('\n')
  const window = lines.slice(Math.max(0, lines.length - 10))
  return !window.some((l) => l.includes(JUSTIFICATION))
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

function* allJsxExpressions(root) {
  const stack = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) continue
    if (ts.isJsxExpression(node)) {
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
  for (const expr of allJsxExpressions(sf)) {
    // Only flag JSX expressions that render as text content. The
    // immediate parent for that case is a JsxElement / JsxFragment.
    // Attribute values (`<div x={value} />`) have a JsxAttribute
    // parent and are NOT user-visible cleartext.
    const parent = expr.parent
    if (
      !parent ||
      (!ts.isJsxElement(parent) && !ts.isJsxFragment(parent))
    ) {
      continue
    }
    const sensitive = sensitiveNameOfExpression(expr.expression)
    if (!sensitive) continue
    if (isInsideMaskedValueAncestor(expr)) continue

    const { display, pos } = locOf(file, sf, expr)
    if (!hasNoJustification(text, pos)) continue

    offences.push({
      where: display,
      field: sensitive,
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
    `\nMaskedValue adoption audit failed (${offenders.length} issue(s)):`,
  )
  for (const o of offenders) {
    console.error(
      `  ${o.where}\n      JSX renders sensitive field "${o.field}" without <MaskedValue>.`,
    )
  }
  console.error(
    '\nFix by wrapping the value with the shared privacy primitive:\n' +
      '\n' +
      "  import { MaskedValue } from '@/components/ui';\n" +
      '\n' +
      '  <MaskedValue\n' +
      '    value={obj.refresh_token}\n' +
      '    variant="token"\n' +
      "    ariaLabel={t('aria.refreshToken', 'Refresh token')}\n" +
      '    copyable\n' +
      '  />\n' +
      '\n' +
      `Or add a justification comment within the 10 lines above the JSX:\n` +
      `  // ${JUSTIFICATION} <reason>\n`,
  )
  process.exit(1)
}

console.log(
  `audit:masked-values OK — scanned ${scanned} .tsx file(s); no cleartext sensitive renders found.`,
)
