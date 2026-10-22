#!/usr/bin/env node
// Time-zone display audit (TZ-5 guard).
//
// Every displayed date/time in the app must flow through the shared layer
// (`src/lib/dateFormat.ts` via `useDateFormat()`), which renders instants in
// the user's resolved zone and keeps calendar values zone-stable. Numbers
// must flow through the shared number layer (`src/lib/numberFormat.ts`),
// which carries the user's locale and precision. This audit scans every
// non-test `.ts`/`.tsx` file under `src/` with the TypeScript compiler API
// and fails on:
//
//   R1. `Intl.DateTimeFormat` outside the shared layer (direct formatting).
//   R2. `.toLocaleString()` / `.toLocaleDateString()` / `.toLocaleTimeString()`
//       outside the shared layer. Dates must use `@/lib/dateFormat`;
//       numbers must use `@/lib/numberFormat` (fmtInt/fmtNumber), which
//       honors the user's locale and precision. No syntactic carve-out:
//       both layers exist precisely so call sites never format directly.
//   R3. `timeZoneName` outside the shared layer (renders a zone name/offset).
//   R4. `.toISOString()` / `.toUTCString()` / `.toGMTString()` whose value
//       reaches JSX directly (`{value.toISOString()}` with no function
//       boundary between the call and the JSX container). NOT flagged:
//       calls inside handlers or memo callbacks (deferred, left to the
//       runtime sweep); ISO nested as an argument to a shared-layer
//       formatter (imported from `@/lib/dateFormat` / `@/hooks/useDateFormat`
//       or a known formatter name, which also covers hook-destructured
//       fns); ISO in a `<time dateTime>` machine attribute (ISO is its
//       correct content); ISO in props of the shared date components
//       (`TimeStamp`, `DateTime`), which render through the shared layer.
//       Chained derivations (`x.toISOString().slice(0, 10)`) and ISO passed
//       to non-shared calls (`String(x.toISOString())`) still fail.
//   R5. `Intl.supportedValuesOf('timeZone')` outside the shared layer (the
//       seed of a time-zone picker; the setting lives in exactly one place).
//       `supportedValuesOf('currency')` and other keys are out of scope.
//       Per-window schedule zones (quiet hours) enumerate via the shared
//       `supportedTimeZones()` helper, not directly.
//
// Exempt files (the shared layer itself): `src/lib/dateFormat.ts`,
// `src/lib/timezone.ts`, `src/lib/dateRange.ts`, `src/lib/numberFormat.ts`,
// `src/lib/locale.ts`, `src/hooks/useDateFormat.ts`. Test files
// (`*.test.*`, `*.spec.*`, `__tests__`, `__mocks__`) are not scanned.
//
// There are no marker comments or per-site exceptions: every finding is
// fixed by using the shared layer, hoisting machine values out of JSX,
// or narrowing this guard (with a guard test). If the guard flags correct
// code, the guard is wrong: extend the R4 narrowing above, never annotate
// the call site.
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
const SHARED_DATE_MODULES = new Set(['@/lib/dateFormat', '@/hooks/useDateFormat'])
// Known shared formatter names. Import-aware recognition (below) covers
// direct imports; this static set additionally covers the same functions
// destructured from useDateFormat() at call sites.
const KNOWN_FORMATTERS = new Set([
  'formatDateTime', 'formatDate', 'formatTime', 'formatDateShort',
  'formatRelativeTime', 'formatRelativeDays', 'formatRelativeDayKey',
  'formatDayKey', 'formatMonthYear', 'formatMonthName', 'formatWeekdayName',
  'formatChartInstant', 'formatMonthDayHour', 'formatHourName',
  'formatDateWithDay', 'formatDateRange', 'formatGmtOffset',
  'ymdInTz', 'zonedWallTimeToUtc', 'zonedDateParts', 'toIsoString',
  'formatDurationMs', 'formatDurationMsCompact', 'formatDurationMsLong',
  'formatDurationSecondsAsMinutes', 'formatDurationMinutes',
  'formatDurationRange', 'formatDurationClock',
  'fmtNumber', 'fmtInt',
])
// Shared date components: values passed to their props render through the
// shared layer, so R4 does not treat them as raw rendered ISO.
const SHARED_DATE_COMPONENTS = new Set(['TimeStamp', 'DateTime'])
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

/** Names imported from the shared date modules in this source file. */
function collectSharedImports(sf) {
  const names = new Set()
  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      SHARED_DATE_MODULES.has(node.moduleSpecifier.text) &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      for (const el of node.importClause.namedBindings.elements) names.add(el.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return names
}

function isFunctionBoundary(node) {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node)
  )
}

function enclosingJsxElementName(attr) {
  let current = attr.parent
  while (current) {
    if (ts.isJsxOpeningElement(current) || ts.isJsxSelfClosingElement(current)) {
      const tag = current.tagName
      return ts.isIdentifier(tag) ? tag.text : ''
    }
    current = current.parent
  }
  return ''
}

/**
 * How an ISO-method call reaches JSX, or null when it never renders:
 * 'violation' (raw ISO text on screen), 'deferred' (handlers/callbacks,
 * covered by the runtime sweep), 'shared' (transformed by the shared
 * layer, machine attributes, or shared-component props).
 */
function classifyIsoCall(node, sharedCalls) {
  let current = node
  while (current.parent) {
    const parent = current.parent
    if (isFunctionBoundary(parent)) return 'deferred'
    if (ts.isCallExpression(parent)) {
      if (parent.arguments.includes(current)) {
        // The ISO string feeds another call: shared formatters transform
        // it (fine); anything else renders it through (keep walking).
        if (sharedCalls.has(calleeName(parent))) return 'shared'
        current = parent
        continue
      }
      // Method chain on the ISO result (`x.toISOString().slice(...)`):
      // still ISO-derived text. Keep walking.
      current = parent
      continue
    }
    if (ts.isJsxAttribute(parent)) {
      const attrName = parent.name ? ts.idText(parent.name) : ''
      if (attrName === 'dateTime') return 'shared'
      if (SHARED_DATE_COMPONENTS.has(enclosingJsxElementName(parent))) return 'shared'
      return 'violation'
    }
    if (ts.isJsxExpression(parent)) {
      // Attribute values (`prop={...}`) defer to the attribute handler
      // below; child expressions (`<span>{...}</span>`) render directly.
      if (parent.parent && ts.isJsxAttribute(parent.parent)) {
        current = parent
        continue
      }
      return 'violation'
    }
    if (ts.isSourceFile(parent)) return 'deferred'
    current = parent
  }
  return 'deferred'
}

function scanSource(text, rel) {
  const failures = []
  const scriptKind = rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, scriptKind)
  const sharedCalls = new Set([...KNOWN_FORMATTERS, ...collectSharedImports(sf)])
  const report = (rule, node, why, fix) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
    failures.push({ where: `${rel}:${line + 1}`, rule, why, fix })
  }

  const visit = (node) => {
    if (ts.isNewExpression(node) || ts.isCallExpression(node)) {
      if (isIntlDateTimeFormatCallee(node)) {
        report(
          'R1', node,
          'direct Intl.DateTimeFormat outside the shared date layer',
          'use useDateFormat() / @/lib/dateFormat (isValidTimeZone, zonedDateParts, browserTimeZone)',
        )
      } else if (
        ts.isPropertyAccessExpression(node.expression) &&
        TOLOCALE_METHODS.has(node.expression.name.text)
      ) {
        report(
          'R2', node,
          `direct .${node.expression.name.text}() outside the shared layers`,
          'dates: useDateFormat() / @/lib/dateFormat; numbers: @/lib/numberFormat (fmtInt/fmtNumber)',
        )
      } else if (
        ts.isPropertyAccessExpression(node.expression) &&
        ISO_METHODS.has(node.expression.name.text) &&
        scriptKind === ts.ScriptKind.TSX &&
        classifyIsoCall(node, sharedCalls) === 'violation'
      ) {
        report(
          'R4', node,
          `raw ${node.expression.name.text}() rendered in JSX`,
          'render through the shared layer, or hoist machine values (filenames, dateTime) out of JSX',
        )
      } else if (isSupportedValuesOfTimeZone(node)) {
        report(
          'R5', node,
          "supportedValuesOf('timeZone') outside the shared layer (time-zone picker seed)",
          'use supportedTimeZones() from @/lib/dateFormat, or link to Settings > Units',
        )
      }
    }
    if (ts.isIdentifier(node) && node.text === 'timeZoneName') {
      report(
        'R3', node,
        'timeZoneName outside the shared date layer (renders a zone name/offset)',
        'use formatGmtOffset() from @/lib/dateFormat for DST-disambiguating offsets',
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
