#!/usr/bin/env node
// Time-zone display audit (TZ-5 guard).
//
// Every displayed date/time in the app must flow through the shared layer
// (`src/lib/dateFormat.ts` via `useDateFormat()`), which renders instants in
// the user's resolved zone and keeps calendar values zone-stable. This audit
// scans every non-test `.ts`/`.tsx` file under `src/` with the TypeScript
// compiler API and fails on:
//
//   R1. `Intl.DateTimeFormat` outside the shared layer (direct formatting).
//   R2. `.toLocaleString()` / `.toLocaleDateString()` / `.toLocaleTimeString()`
//       outside the shared layer (direct formatting, incl. numbers: numbers
//       must use the marker below so the classification stays explicit).
//   R3. `timeZoneName` outside the shared layer (renders a zone name/offset).
//   R4. `.toISOString()` / `.toUTCString()` / `.toGMTString()` rendered
//       directly in JSX (`{value.toISOString()}` with no function boundary
//       between the call and the JSX container). Rendered-through-callback
//       cases (`{rows.map(r => r.ts.toISOString())}`) are NOT caught here;
//       the all-routes e2e sweep covers rendered output instead.
//   R5. `Intl.supportedValuesOf('timeZone')` outside the shared layer (the
//       seed of a time-zone picker; the setting lives in exactly one place).
//       `supportedValuesOf('currency')` and other keys are out of scope.
//
// Exempt files (the shared layer itself): `src/lib/dateFormat.ts`,
// `src/lib/timezone.ts`, `src/lib/dateRange.ts`, `src/lib/numberFormat.ts`,
// `src/lib/locale.ts`, `src/hooks/useDateFormat.ts`. Test files
// (`*.test.*`, `*.spec.*`, `__tests__`, `__mocks__`) are not scanned.
//
// Documented exceptions: a marker comment on the line or up to 3 lines
// above (same convention as audit-freshness-actions):
//   `tz-computation: <reason>`    — Intl validates a zone, extracts parts,
//                                   or detects the browser zone; an ISO string
//                                   feeds a shared formatter, a <time dateTime>
//                                   attribute, or a data prop. The result is
//                                   computed with, never rendered as text.
//   `tz-number-format: <reason>`  — toLocaleString on a plain number.
//   `tz-dst-offset: <reason>`     — a rendered GMT offset that disambiguates
//                                   repeated fall-back hours (same class as
//                                   the shared formatChartInstant).
//   `tz-schedule-data: <reason>`  — a per-record IANA zone shown as schedule
//                                   data (quiet-hours windows, automation
//                                   schedules), not the display zone.
//   `tz-export: <reason>`         — full ISO in a CSV/JSON export builder.
//   `tz-settings: <reason>`       — the Settings page's own explanation.
//   `tz-tool-subject: <reason>`   — a devtools converter whose subject IS the
//                                   raw format (Unix <-> ISO tool).
//
// Run via `npm run audit:timezone-display`.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

import ts from 'typescript'

const SRC_ROOT = join('src')
const EXEMPT_FILES = new Set([
  join('src', 'lib', 'dateFormat.ts'),
  join('src', 'lib', 'timezone.ts'),
  join('src', 'lib', 'dateRange.ts'),
  join('src', 'lib', 'numberFormat.ts'),
  join('src', 'lib', 'locale.ts'),
  join('src', 'hooks', 'useDateFormat.ts'),
])
const MARKER_LOOKBACK = 3
const RULE_MARKERS = {
  R1: new Set(['tz-computation']),
  R2: new Set(['tz-computation', 'tz-number-format']),
  R3: new Set(['tz-computation', 'tz-dst-offset']),
  R4: new Set(['tz-computation', 'tz-export', 'tz-tool-subject', 'tz-settings']),
  R5: new Set(['tz-schedule-data', 'tz-settings']),
}
const TOLOCALE_METHODS = new Set(['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'])
const ISO_METHODS = new Set(['toISOString', 'toUTCString', 'toGMTString'])

/**
 * Walk a directory recursively and yield every `.ts`/`.tsx` file path,
 * excluding test files, specs, and test helpers (they don't ship; the
 * all-routes e2e sweep guards rendered output instead).
 */
function* walk(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === '__mocks__') continue
      yield* walk(p)
      continue
    }
    if (!p.endsWith('.ts') && !p.endsWith('.tsx')) continue
    if (p.endsWith('.test.ts') || p.endsWith('.test.tsx')) continue
    if (p.endsWith('.spec.ts') || p.endsWith('.spec.tsx')) continue
    yield p
  }
}

function calleeName(node) {
  if (ts.isIdentifier(node.expression)) return node.expression.text
  if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.name)) {
    return node.expression.name.text
  }
  return ''
}

function isIntlDateTimeFormatCallee(node) {
  const expr = node.expression
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    return expr.expression.text === 'Intl' && expr.name.text === 'DateTimeFormat'
  }
  return false
}

function isSupportedValuesOfTimeZone(node) {
  if (calleeName(node) !== 'supportedValuesOf') return false
  const first = node.arguments[0]
  return !!first && ts.isStringLiteral(first) && first.text === 'timeZone'
}

/**
 * True when the call renders directly into JSX: a JSXExpressionContainer
 * ancestor with no function boundary between it and the call. Calls inside
 * handlers or memo callbacks (`onClick={() => ...}`, `useMemo(() => ...)`)
 * are deferred, not rendered, and are left to the runtime sweep.
 */
function rendersDirectlyInJsx(node) {
  let current = node.parent
  while (current) {
    if (
      ts.isArrowFunction(current) ||
      ts.isFunctionExpression(current) ||
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current)
    ) {
      return false
    }
    if (ts.isJsxExpression(current)) return true
    current = current.parent
  }
  return false
}

function markerOnOrAbove(lines, lineIndex, allowed) {
  for (let i = lineIndex; i >= Math.max(0, lineIndex - MARKER_LOOKBACK); i -= 1) {
    const match = /(tz-[a-z-]+):/.exec(lines[i])
    if (match && allowed.has(match[1])) return match[1]
  }
  return null
}

function scanSource(text, rel) {
  const failures = []
  const scriptKind = rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, scriptKind)
  const lines = text.split('\n')
  const report = (rule, node, why, fix) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
    if (markerOnOrAbove(lines, line, RULE_MARKERS[rule])) return
    failures.push({ where: `${rel}:${line + 1}`, rule, why, fix })
  }

  const visit = (node) => {
    if (ts.isNewExpression(node) || ts.isCallExpression(node)) {
      if (isIntlDateTimeFormatCallee(node)) {
        report(
          'R1', node,
          'direct Intl.DateTimeFormat outside the shared date layer',
          'use useDateFormat() / @/lib/dateFormat, or mark tz-computation with a reason',
        )
      } else if (
        ts.isPropertyAccessExpression(node.expression) &&
        TOLOCALE_METHODS.has(node.expression.name.text)
      ) {
        report(
          'R2', node,
          `direct .${node.expression.name.text}() outside the shared date layer`,
          'use useDateFormat() / @/lib/dateFormat, or mark tz-number-format / tz-computation with a reason',
        )
      } else if (
        ts.isPropertyAccessExpression(node.expression) &&
        ISO_METHODS.has(node.expression.name.text) &&
        scriptKind === ts.ScriptKind.TSX &&
        rendersDirectlyInJsx(node)
      ) {
        report(
          'R4', node,
          `raw ${node.expression.name.text}() rendered directly in JSX`,
          'render through the shared layer, or mark tz-computation / tz-export / tz-tool-subject / tz-settings with a reason',
        )
      } else if (isSupportedValuesOfTimeZone(node)) {
        report(
          'R5', node,
          "supportedValuesOf('timeZone') outside the shared layer (time-zone picker seed)",
          'link to Settings > Units instead, or mark tz-schedule-data / tz-settings with a reason',
        )
      }
    }
    if (ts.isIdentifier(node) && node.text === 'timeZoneName') {
      report(
        'R3', node,
        'timeZoneName outside the shared date layer (renders a zone name/offset)',
        'drop the suffix, or mark tz-dst-offset / tz-computation with a reason',
      )
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return failures
}

export function _scanSourceForTest(source, { rel = 'synthetic.tsx' } = {}) {
  return scanSource(source, rel)
}

export function _rulesForTest() {
  return { markers: RULE_MARKERS, lookback: MARKER_LOOKBACK }
}

const argvTarget = (process.argv[1] ?? '').replace(/\\/g, '/')
const isMainModule = argvTarget !== '' && (
  import.meta.url === `file://${argvTarget}` || import.meta.url.endsWith(argvTarget)
)
if (isMainModule) {
  let scanned = 0
  const failures = []
  for (const file of walk(SRC_ROOT)) {
    if (EXEMPT_FILES.has(file)) continue
    scanned++
    failures.push(...scanSource(readFileSync(file, 'utf8'), file))
  }

  if (failures.length > 0) {
    console.error(`\ntime-zone display violations (${failures.length}):`)
    for (const f of failures) {
      console.error(`  ${f.where} [${f.rule}] ${f.why}\n      fix: ${f.fix}`)
    }
    console.error('\nAll displayed dates/times must use useDateFormat() / @/lib/dateFormat.')
    process.exit(1)
  }
  console.log(`OK — no direct date/time formatting outside the shared layer (${scanned} files scanned)`)
}
