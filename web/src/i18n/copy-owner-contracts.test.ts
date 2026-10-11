import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { cleanup, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import ts from 'typescript'
import catalog from './en.json'
import { authorizedCanonicalAdditions } from './authorized-canonical-recovery.test'
import { AIThinkingIndicator } from '@/components/ai/AIThinkingIndicator'
import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { useDrivesListPageCollections } from '@/features/driving/hooks/useDrivesListPageCollections'

vi.unmock('react-i18next')

// Independent static fixture: preservation tests use their own exported fixture,
// never import this module and thereby register its render tests a second time.
const pairs = [
  ['helix.thinkingButtonLabel', 'Helix is thinking…'],
  ['helix.thinkingStatusLabel', 'Helix is thinking'],
  ['drives.coll.allOption', 'All drives'],
  ['drives.coll.allPill', 'All'],
  ['commandHistory.selectVehicleActivityPrompt', 'Select a vehicle to view command activity'],
  ['commandHistory.selectVehicleHistoryPrompt', 'Select a vehicle to view command history'],
  ['signalExplorer.liveHelpAria', 'More info about live signal streaming'],
  ['signalsWorkspace.liveCompareHelpAria', 'More info about live and compare modes'],
  ['fleet.batteryLevelAriaSuffix', 'battery level'],
  ['fleet.batteryLevelAriaLabel', 'Battery level'],
] as const

const sourceContracts = [
  ['components/ai/AIFeatureCard.tsx', 'helix.thinkingButtonLabel', 1, 'translation'],
  ['components/ai/AIThinkingIndicator.tsx', 'helix.thinkingStatusLabel', 1, 'translation'],
  ['features/driving/components/DrivesEvidenceTable.tsx', 'drives.coll.allOption', 1, 'translation'],
  ['features/driving/hooks/useDrivesListPageCollections.ts', 'drives.coll.allPill', 2, 'translation'],
  ['features/system/pages/CommandHistoryPage.tsx', 'commandHistory.selectVehicleActivityPrompt', 1, 'translation'],
  ['features/system/pages/CommandHistoryPage.tsx', 'commandHistory.selectVehicleHistoryPrompt', 2, 'translation'],
  ['features/telemetry/pages/SignalExplorerPage.tsx', 'signalExplorer.liveHelpAria', 1, 'translation'],
  ['features/telemetry/pages/SignalsWorkspacePage.tsx', 'signalsWorkspace.liveCompareHelpAria', 1, 'translation'],
  ['features/vehicles/components/BatteryComparison.tsx', 'fleet.batteryLevelAriaSuffix', 1, 'vehicles'],
  ['features/vehicles/components/VehicleCard.tsx', 'fleet.batteryLevelAriaLabel', 1, 'vehicles'],
] as const

const english = createInstance()
const generated = import.meta.glob<{ default: Record<string, unknown> }>('./en/locale-*.json', { eager: true })
function nested(resource: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((value, segment) =>
    value && typeof value === 'object' ? (value as Record<string, unknown>)[segment] : undefined, resource)
}
function source(file: string): string {
  return readFileSync(resolve(process.cwd(), 'src', file), 'utf8')
}
function calls(file: string, key: string): ts.CallExpression[] {
  const tree = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found: ts.CallExpression[] = []
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't'
      && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === key) {
      found.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return found
}
beforeAll(async () => {
  await english.init({
    lng: 'en', fallbackLng: 'en', fallbackNS: 'translation',
    resources: { en: { translation: catalog } },
    interpolation: { escapeValue: false },
  })
})
afterEach(cleanup)

describe('five source-backed copy-owner contracts', () => {
  it('preserves the frozen 29063 predecessor leaves before exact copy-owner additions', () => {
    for (const [key, value] of pairs) expect(nested(catalog, key)).toBe(value)
    expect(nested(catalog, 'drives.emptyForCollection.title')).toBe('No drives in this view')
    expect(nested(catalog, 'systemStatus.incidents.updateCount_other')).toBe('{{count}} updates')
    const approved = new Set<string>([
      ...pairs.map(([key]) => key),
      'drives.emptyForCollection.title',
      'systemStatus.incidents.updateCount_other',
    ])
    expect(approved.size).toBe(12)
    for (const [key, value] of authorizedCanonicalAdditions) {
      expect(nested(catalog, key)).toBe(value)
      approved.add(key)
    }
    function leaves(resource: Record<string, unknown>, prefix = ''): [string, unknown][] {
      return Object.entries(resource).flatMap(([key, value]) => {
        const path = prefix ? `${prefix}.${key}` : key
        return value && typeof value === 'object' && !Array.isArray(value)
          ? leaves(value as Record<string, unknown>, path)
          : [[path, value] as [string, unknown]]
      })
    }
    const entries = leaves(catalog)
    expect(entries).toHaveLength(30996)
    const predecessor = entries.filter(([key]) => !approved.has(key))
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    expect(predecessor).toHaveLength(29063)
    expect(createHash('sha256').update(JSON.stringify(predecessor)).digest('hex'))
      .toBe('268e4c475cb756eefb02b0d49ee0213ade3ab360895cc5faae00e1950914f037')
  })

  it('executes the actual guarded incident count producer with English plurals', () => {
    expect(catalog.systemStatus.incidents.updateCount_other).toBe('{{count}} updates')
    const actualCalls = calls('features/system/components/status/IncidentsCard.tsx', 'systemStatus.incidents.updateCount')
    expect(actualCalls).toHaveLength(1)
    const call = actualCalls[0]
    expect(call.arguments).toHaveLength(2)
    expect(call.arguments[1].getText()).toBe("{ defaultValue: '{{count}} updates', count: updateCount }")
    const evaluate = new Function('t', 'updateCount', `return ${call.getText()}`) as
      (t: ReturnType<typeof english.getFixedT>, count: number) => unknown
    for (const count of [2, 3]) {
      expect(english.exists('systemStatus.incidents.updateCount', { count })).toBe(true)
      expect(evaluate(english.getFixedT('en', 'translation'), count)).toBe(`${count} updates`)
    }
    expect(english.exists('systemStatus.incidents.updateCount_one')).toBe(false)
    expect(Object.values(generated).some(resource =>
      nested(resource.default, 'systemStatus.incidents.updateCount_other') === '{{count}} updates')).toBe(true)
    expect(source('features/system/components/status/IncidentsCard.tsx'))
      .toContain("{updateCount > 1 && ` · ${t('systemStatus.incidents.updateCount', { defaultValue: '{{count}} updates', count: updateCount })}`}")
  })

  it.each(pairs)('ships exact scalar %s with installed i18next and generated resources', (key, value) => {
    expect(nested(catalog, key)).toBe(value)
    expect(english.exists(key)).toBe(true)
    expect(english.t(key, { returnObjects: true })).toBe(value)
    expect(Object.values(generated).some(resource => nested(resource.default, key) === value)).toBe(true)
  })

  it.each(sourceContracts)('executes every actual %s call for %s with its original arguments', (file, key, count, ns) => {
    const actualCalls = calls(file, key)
    expect(actualCalls).toHaveLength(count)
    const value = pairs.find(([candidate]) => candidate === key)?.[1]
    expect(value).toBeDefined()
    for (const call of actualCalls) {
      expect(call.arguments).toHaveLength(2)
      const fallback = call.arguments[1]
      if (ts.isStringLiteral(fallback)) expect(fallback.text).toBe(value)
      else {
        expect(ts.isObjectLiteralExpression(fallback)).toBe(true)
        expect(fallback.getText()).toBe(`{ defaultValue: '${value}' }`)
      }
      // Execute only the actual source t-call, never a rewritten fixture call.
      const evaluate = new Function('t', `return ${call.getText()}`) as
        (t: ReturnType<typeof english.getFixedT>) => unknown
      expect(evaluate(english.getFixedT('en', ns))).toBe(value)
    }
  })

  it('keeps the old help body scalar, not an aria-label subtree or alias', () => {
    expect(typeof catalog.help.signal.live).toBe('string')
    expect(english.t('signalExplorer.liveHelpAria')).not.toBe(english.t('signalsWorkspace.liveCompareHelpAria'))
    expect(english.t('fleet.batteryLevelAriaSuffix', { ns: 'vehicles' })).toBe('battery level')
    expect(english.t('fleet.batteryLevelAriaLabel', { ns: 'vehicles' })).toBe('Battery level')
  })

  it('retains analytics/history gating and timeline filter precedence in the actual page expressions', () => {
    const text = source('features/system/pages/CommandHistoryPage.tsx')
    const expressions = text.slice(text.indexOf('  const analyticsEmptyMsg ='), text.indexOf('  const operationalMetrics ='))
    const evaluate = new Function('t', 'noVehicle', 'searchQuery', 'statusFilter',
      `${expressions}; return [analyticsEmptyMsg, timelineEmptyMsg]`) as
      (t: ReturnType<typeof english.getFixedT>, noVehicle: boolean, search: string, statusFilter: string) => string[]
    const t = english.getFixedT('en')
    expect(evaluate(t, true, '', 'all')).toEqual([
      'Select a vehicle to view command activity', 'Select a vehicle to view command history',
    ])
    expect(evaluate(t, true, 'query', 'all')[1]).toBe('No commands match the current filters')
    expect(evaluate(t, true, '', 'failed')[1]).toBe('No commands match the current filters')
    expect(evaluate(t, false, '', 'all')).toEqual([
      'No commands in the selected range', 'No commands have been sent yet',
    ])
    expect(text).toContain("? t('commandHistory.selectVehicleHistoryPrompt', 'Select a vehicle to view command history')")
  })

  it.each(['all', 'unrecognized'])('keeps the compact all pill and selected-label fallback for %s', collection => {
    const input = {
      t: english.getFixedT('en'), collection, fsdFilter: 'all',
      hasDrivePayload: false, fsdDataAvailable: false, fsdByDriveID: new Map(),
      dateFilteredDrives: [], anomalyDrives: [], notableDrives: [], commuteDrives: [], filteredDrives: [],
    } as Parameters<typeof useDrivesListPageCollections>[0]
    const { result } = renderHook(() => useDrivesListPageCollections(input))
    expect(result.current.collectionLabel).toBe('All')
    expect(result.current.filterPills[0]).toMatchObject({ key: 'all', label: 'All', count: undefined })
    expect(result.current.activeFilterKey).toBe(collection === 'all' ? 'all' : 'coll:unrecognized')
    expect(english.t('drives.coll.allOption')).toBe('All drives')
  })

  it.each([undefined, '', '   ', 'Custom pending label'])('preserves polite status fallback and override %s', label => {
    render(createElement(I18nextProvider, { i18n: english },
      createElement(AIThinkingIndicator, { label })))
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status.textContent).toBe(label?.trim() ? label : 'Helix is thinking')
    expect(status.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })

  it.each(['idle', 'streaming'] as const)('preserves %s button label, contextual aria and streaming gate', state => {
    const start = vi.fn()
    render(createElement(I18nextProvider, { i18n: english },
      createElement(AIFeatureCard, {
        title: 'Test feature', description: 'Test description', buttonLabel: 'Summarize',
        canStart: true, stream: { state, text: '', error: null, start },
      })))
    const button = screen.getByRole('button', { name: 'Ask Helix · Summarize' })
    expect(button).toHaveTextContent(state === 'streaming' ? 'Helix is thinking…' : 'Ask Helix')
    if (state === 'streaming') {
      expect(button).toBeDisabled()
      expect(button).toHaveAttribute('aria-busy', 'true')
      expect(screen.getByRole('status').textContent).toBe('Helix is thinking')
    } else expect(button).not.toBeDisabled()
    expect(start).not.toHaveBeenCalled()
  })
})
