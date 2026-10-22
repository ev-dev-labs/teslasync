/** Exact source calls and real canonical/generated English for final integration. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInstance } from 'i18next'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import catalog from './en.json'
import shell from './en/shell.json'
import baseline from './known-missing-keys.json'
import runtimeManifest from './en/runtime-manifest.json'
import i18n, { flushPendingEnglishResourcesForTest, loadEnglishNamespace } from './index'

function sourceFile(path: string) {
  const text = readFileSync(resolve(process.cwd(), 'src', path), 'utf8')
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function translationCalls(source: ts.SourceFile) {
  const calls: ts.CallExpression[] = []
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') {
      calls.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return calls
}

function literalPair(source: ts.SourceFile, key: string, fallback: string) {
  const calls = translationCalls(source).filter(call =>
    call.arguments[0] && ts.isStringLiteral(call.arguments[0]) && call.arguments[0].text === key,
  )
  expect(calls).toHaveLength(1)
  const call = calls[0]
  const defaultValue = call.arguments[1]
  expect(defaultValue && ts.isStringLiteral(defaultValue)).toBe(true)
  if (!defaultValue || !ts.isStringLiteral(defaultValue)) throw new Error('Expected literal English default')
  expect(defaultValue.text).toBe(fallback)
  return call
}

function option(call: ts.CallExpression, name: string, source: ts.SourceFile) {
  const options = call.arguments[2]
  expect(options && ts.isObjectLiteralExpression(options)).toBe(true)
  if (!options || !ts.isObjectLiteralExpression(options)) throw new Error('Expected interpolation options')
  const property = options.properties.find(prop =>
    ts.isPropertyAssignment(prop) && prop.name.getText(source) === name,
  )
  if (!property || !ts.isPropertyAssignment(property)) throw new Error(`Missing ${name} parameter`)
  return property.initializer.getText(source)
}

// Top-level so the trio checkpoint script reads the same fixtures the test asserts.
const additions = [
  [['ai', 'limit', 'retryIn'], 'Try again in {{seconds}}s'],
  [['palette', 'clearScope'], 'Clear {{scope}} filter'],
  [['devtools', 'utils', 'regexEmptyMatch'], '(empty match)'],
  [['app', 'temperatureLabel'], 'Temperature'],
] as const

// Accepted Phase-4 source-owned additions: sticky-control-localization (1),
// watch-key-capability (5), and signal-catalog-canonical-repair (6).
const acceptedLaterAdditions = [
  [['a11y', 'scrollToTop'], '{{region}} — scroll to top'],
  [['watch', 'capability', 'notConfigured'], 'Watch access is not configured'],
  [['watch', 'capability', 'description'], 'Watch readings require a wearable API key in this session. Manage API keys and open your configured watch link to enable readings. Retained readings are not refreshed until access is configured.'],
  [['watch', 'capability', 'configure'], 'Manage API keys'],
  [['watch', 'capability', 'readError'], 'Watch access could not be checked'],
  [['watch', 'capability', 'readErrorDescription'], 'Watch access is unknown because browser session storage could not be read or saved. Retry after storage becomes available. Retained readings remain visible.'],
  [['widget', 'signalCatalog', 'destination'], 'Destination: {{destination}}'],
  [['widget', 'signalCatalog', 'valueKind'], 'Value kind'],
  [['widget', 'signalCatalog', 'metadataUnavailable'], 'Unit and description are not provided by this catalog.'],
  [['widget', 'signalCatalog', 'totalSamples'], 'Total observations: {{count}}'],
  [['widget', 'signalCatalog', 'vehicleCount'], 'Vehicles observed: {{count}}'],
  [['widget', 'signalCatalog', 'lastSeen'], 'Last seen: {{timestamp}}'],
] as const

function physical(value: unknown, parts: string[] = []): [string[], unknown][] {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.entries(value).flatMap(([key, child]) => physical(child, [...parts, key]))
    : [[parts, value]]
}

describe('final four genuine localization gaps — production source contracts', () => {
  it('adds exactly four structural leaves while retaining the frozen 31091-leaf projection', () => {
    // Verify each exact structural path/value before projecting it out; the
    // original four additions and frozen predecessor fingerprint stay intact.
    const currentEntries = physical(catalog)
    const acceptedLaterPaths = new Set(acceptedLaterAdditions.map(([parts]) => JSON.stringify(parts)))
    expect(acceptedLaterAdditions).toHaveLength(12)
    expect(acceptedLaterPaths.size).toBe(12)
    for (const [parts, value] of acceptedLaterAdditions) {
      expect(currentEntries.filter(([path]) => JSON.stringify(path) === JSON.stringify(parts))).toEqual([[parts, value]])
    }
    const entries = currentEntries.filter(([parts]) => !acceptedLaterPaths.has(JSON.stringify(parts)))
    const exact = new Set(additions.map(([parts]) => JSON.stringify(parts)))
    expect(entries).toHaveLength(33002)
    expect(exact.size).toBe(4)
    for (const [parts, value] of additions) {
      expect(entries.filter(([path]) => JSON.stringify(path) === JSON.stringify(parts))).toEqual([[parts, value]])
    }
    const predecessor = entries.filter(([parts]) => !exact.has(JSON.stringify(parts)))
    expect(predecessor).toHaveLength(32998)
    expect(createHash('sha256').update(JSON.stringify(predecessor)).digest('hex'))
      .toBe("0405b75fe87639489a29f6a0afefbae311eb0d4cafd28d780d3be2f432794d93")
    expect(typeof catalog.temperature).toBe('object')
    expect(catalog.share.curve).toBe('Charge curve')
    expect(catalog.signalLog.composition).toBe('Value composition')
    expect(baseline).toEqual([])
    expect(runtimeManifest.missing).toEqual([])
  })

  it('executes the exact four production fragments with installed canonical English', async () => {
    const english = createInstance()
    await english.init({
      lng: 'en', fallbackLng: 'en', fallbackNS: 'translation',
      resources: { en: { translation: catalog } },
      interpolation: { escapeValue: false },
    })
    const t = english.getFixedT('en', 'translation')
    const countdown = sourceFile('components/ai/AiLimitBanner.tsx')
    const retry = literalPair(countdown, 'ai.limit.retryIn', 'Try again in {{seconds}}s')
    expect(english.exists('ai.limit.retryIn')).toBe(true)
    expect(english.t('ai.limit.retryIn', { skipInterpolation: true })).toBe('Try again in {{seconds}}s')
    const retryCall = new Function('t', 'secondsLeft', `return ${retry.getText(countdown)}`) as
      (translate: typeof t, seconds: number) => unknown
    for (const seconds of [0, 1, 2, 99]) expect(retryCall(t, seconds)).toBe(`Try again in ${seconds}s`)

    const palette = sourceFile('components/ui/CommandPalette.tsx')
    const clear = literalPair(palette, 'palette.clearScope', 'Clear {{scope}} filter')
    expect(english.exists('palette.clearScope')).toBe(true)
    expect(english.t('palette.clearScope', { scope: 'Commands' })).toBe('Clear Commands filter')
    const clearCall = new Function('t', 'activeScope', 'getScopeMeta', `return ${clear.getText(palette)}`) as
      (translate: typeof t, scope: string, meta: (scope: string) => { label: string }) => unknown
    for (const scope of ['Commands', 'Pages', '']) expect(clearCall(t, scope, label => ({ label }))).toBe(`Clear ${scope} filter`)

    const regex = sourceFile('features/admin/components/devtools/tools/RegexTester.tsx')
    const empty = literalPair(regex, 'devtools.utils.regexEmptyMatch', '(empty match)')
    expect(english.exists('devtools.utils.regexEmptyMatch')).toBe(true)
    expect(english.t('devtools.utils.regexEmptyMatch')).toBe('(empty match)')
    const matchCall = new Function('t', 'm', `return ${empty.parent.getText(regex)}`) as
      (translate: typeof t, match: { match: string }) => unknown
    expect(matchCall(t, { match: '' })).toBe('(empty match)')
    expect(matchCall(t, { match: '0' })).toBe('0')
    expect(matchCall(t, { match: 'aa' })).toBe('aa')

    const settings = sourceFile('features/settings/components/GeneralSettings.tsx')
    const temperature = literalPair(settings, 'app.temperatureLabel', 'Temperature')
    expect(english.exists('app.temperatureLabel')).toBe(true)
    expect(english.t('app.temperatureLabel')).toBe('Temperature')
    const toast = new Function('t', 'updates', `return ${temperature.parent.parent.getText(settings)}`) as
      (translate: typeof t, updates: { unit_of_length: string; unit_of_temp: string; unit_of_pressure: string }) => unknown
    expect(toast(english.getFixedT('en', 'settings'), {
      unit_of_length: 'mi', unit_of_temp: 'F', unit_of_pressure: 'psi',
    })).toBe('Distance: Miles, Temperature: Fahrenheit, Pressure: PSI')
    expect(toast(english.getFixedT('en', 'settings'), {
      unit_of_length: 'km', unit_of_temp: 'C', unit_of_pressure: 'bar',
    })).toBe('Distance: Kilometers, Temperature: Celsius, Pressure: Bar')

    const incidents = sourceFile('features/system/components/status/IncidentsCard.tsx')
    const guard = "{updateCount > 1 && ` · ${t('systemStatus.incidents.updateCount', { defaultValue: '{{count}} updates', count: updateCount })}`}"
    expect(incidents.text).toContain(guard)
    const updates = new Function('t', 'updateCount', `return ${guard.slice(1, -1)}`) as
      (translate: typeof t, count: number) => unknown
    for (const count of [0, 1]) expect(updates(t, count)).toBe(false)
    for (const count of [2, 3]) expect(updates(t, count)).toBe(` · ${count} updates`)
    expect(english.exists('systemStatus.incidents.updateCount_one')).toBe(false)
  })

  it('loads the actual generated resources through the production namespace loader', async () => {
    try {
      await Promise.all(['ai', 'palette', 'devtools', 'app'].map(namespace => loadEnglishNamespace(namespace)))
      for (const [key, expected, options] of [
        ['ai.limit.retryIn', 'Try again in 2s', { seconds: 2 }],
        ['palette.clearScope', 'Clear Commands filter', { scope: 'Commands' }],
        ['devtools.utils.regexEmptyMatch', '(empty match)', {}],
        ['app.temperatureLabel', 'Temperature', {}],
      ] as const) {
        expect(i18n.exists(key, { lng: 'en' })).toBe(true)
        expect(i18n.t(key, { ...options, lng: 'en', returnObjects: true })).toBe(expected)
      }
      expect(i18n.t('app.temperatureLabel', { lng: 'en', ns: 'settings' })).toBe('Temperature')
      expect(shell.palette.clearScope).toBe('Clear {{scope}} filter')
    } finally {
      flushPendingEnglishResourcesForTest()
    }
  })

  it('uses static countdown copy with the live seconds operand and retains ready branching', () => {
    const source = sourceFile('components/ai/AiLimitBanner.tsx')
    const call = literalPair(source, 'ai.limit.retryIn', 'Try again in {{seconds}}s')
    expect(option(call, 'seconds', source)).toBe('secondsLeft')
    expect(option(call, 'defaultValue', source)).toBe("'Try again in {{seconds}}s'")
    expect(source.text).toContain('const retryReady = secondsLeft <= 0;')
    expect(source.text).toContain('{!retryReady && (')
    expect(source.text).toContain('{onRetry && retryReady && (')
    expect(source.text).toContain('onClick={onRetry}')
  })

  it('uses a static accessible clear label with the localized scope operand', () => {
    const source = sourceFile('components/ui/CommandPalette.tsx')
    const call = literalPair(source, 'palette.clearScope', 'Clear {{scope}} filter')
    expect(option(call, 'scope', source)).toBe('getScopeMeta(activeScope).label')
    expect(ts.isJsxExpression(call.parent) && ts.isJsxAttribute(call.parent.parent)).toBe(true)
    expect(call.parent.parent.getText(source)).toContain('aria-label=')
    expect(source.text).toContain("setQuery('')")
    expect(source.text).toContain('setSelectedIndex(0)')
    expect(source.text).toContain('inputRef.current?.focus()')
  })

  it('uses the regex feature-owned key only for empty matched text', () => {
    const source = sourceFile('features/admin/components/devtools/tools/RegexTester.tsx')
    const call = literalPair(source, 'devtools.utils.regexEmptyMatch', '(empty match)')
    expect(call.parent.getText(source)).toBe("m.match || t('devtools.utils.regexEmptyMatch', '(empty match)')")
    expect(translationCalls(source).some(candidate =>
      candidate.arguments[0]?.getText(source) === "'(empty match)'",
    )).toBe(false)
    expect(source.text).toContain('if (m.index === re.lastIndex) re.lastIndex += 1')
  })

  it('uses a settings feature scalar label in the existing unit-sync toast without changing units', () => {
    const source = sourceFile('features/settings/components/GeneralSettings.tsx')
    const call = literalPair(source, 'app.temperatureLabel', 'Temperature')
    expect(ts.isTemplateSpan(call.parent)).toBe(true)
    expect(source.text).not.toContain("t('temperature', 'Temperature')")
    expect(source.text).toContain("useTranslation('settings')")
    expect(source.text).toContain('settingsMut.mutate(newForm)')
    expect(source.text).toContain('toast.success(')
    expect(source.text).toContain("updates.unit_of_temp === 'F' ? t('fahrenheit', 'Fahrenheit') : t('celsius', 'Celsius')")
  })
})
