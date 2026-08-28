import { describe, expect, it } from 'vitest'
// @ts-expect-error - shared probe parser authored as ESM JavaScript
import { ROUTE_BUDGETS, localityFailures, parseProbeReport } from './locale-request-locality.mjs'

const budgets = {
  'cold NotFound': { grouped: [], maxRequests: 0 },
  Dashboard: { grouped: ['dashboard'], maxRequests: 3 },
  Drives: { grouped: ['driving', 'trips'], maxRequests: 3 },
}

function line(route: string, chunks: string[]) {
  const detail = chunks.map((chunk) => `${chunk} (100 raw / 40 gzip bytes)`).join(', ')
  return `[i18n-runtime] ${route}: ${chunks.length} deferred locale requests${chunks.length ? ` (${detail})` : ''}`
}

describe('probe report parsing', () => {
  it('extracts route, count and bundle names', () => {
    const output = [
      line('cold NotFound', []),
      line('Dashboard', ['locale-dashboard-Ab12Cd34.js', 'locale-detail-toast-Zz98Yy76.js']),
    ].join('\n')

    expect(parseProbeReport(output)).toEqual([
      { route: 'cold NotFound', count: 0, bundles: [] },
      { route: 'Dashboard', count: 2, bundles: ['dashboard', 'detail-toast'] },
    ])
  })
})

describe('locale fallback locality gate', () => {
  it('accepts a route that loads its own bundle plus per-namespace fallbacks', () => {
    const output = [
      line('cold NotFound', []),
      line('Dashboard', ['locale-dashboard-Ab12Cd34.js', 'locale-detail-toast-Zz98Yy76.js']),
      line('Drives', ['locale-driving-Qw12Er34.js', 'locale-detail-battery-Mn45Bv67.js']),
    ].join('\n')

    expect(localityFailures(output, budgets)).toEqual([])
  })

  it('fails when a route downloads another feature grouped catalog', () => {
    const output = [
      line('cold NotFound', []),
      line('Dashboard', ['locale-dashboard-Ab12Cd34.js']),
      line('Drives', ['locale-driving-Qw12Er34.js', 'locale-charging-Pl09Ok88.js']),
    ].join('\n')

    expect(localityFailures(output, budgets)).toEqual([
      'Drives downloaded foreign grouped locale bundle "charging"',
    ])
  })

  it('fails when the cold shell route requests any locale bundle at all', () => {
    const output = [
      line('cold NotFound', ['locale-detail-notFound-Aa11Bb22.js']),
      line('Dashboard', []),
      line('Drives', []),
    ].join('\n')

    expect(localityFailures(output, budgets)).toEqual([
      'cold NotFound issued 1 deferred locale requests, budget is 0',
    ])
  })

  it('enforces the per-route request-count budget even for allowed bundles', () => {
    const output = [
      line('cold NotFound', []),
      line('Dashboard', [
        'locale-dashboard-Ab12Cd34.js',
        'locale-detail-toast-Zz98Yy76.js',
        'locale-detail-kiosk-Cc33Dd44.js',
        'locale-detail-common-Ee55Ff66.js',
      ]),
      line('Drives', []),
    ].join('\n')

    expect(localityFailures(output, budgets)).toEqual([
      'Dashboard issued 4 deferred locale requests, budget is 3',
    ])
  })

  it('detects a truncated report whose chunk names never arrived', () => {
    // A gate that read stdout at `exit` instead of `close` sees exactly this:
    // the count survives but the trailing chunk list is cut off.
    const truncated = '[i18n-runtime] Drives: 2 deferred locale requests (locale-driv'
    const output = [line('cold NotFound', []), line('Dashboard', []), truncated].join('\n')

    expect(localityFailures(output, budgets)).toEqual([
      'Drives reported 2 deferred locale requests but named 0 chunks (truncated probe output?)',
    ])
  })

  it('fails when a probed route never reported', () => {
    const output = [line('cold NotFound', []), line('Dashboard', [])].join('\n')

    expect(localityFailures(output, budgets)).toEqual(['probe never reported route "Drives"'])
  })

  it('matches hyphenated grouped bundle names without confusing them with fallbacks', () => {
    const hyphenated = { Systems: { grouped: ['vehicle-systems'], maxRequests: 2 } }
    const clean = line('Systems', ['locale-vehicle-systems-Aa11Bb22.js', 'locale-detail-vehicles-Cc33Dd44.js'])
    expect(localityFailures(clean, hyphenated)).toEqual([])

    const dirty = line('Systems', ['locale-action-center-Aa11Bb22.js'])
    expect(localityFailures(dirty, hyphenated)).toEqual([
      'Systems downloaded foreign grouped locale bundle "action-center"',
    ])
  })

  it('ships a budget for every probed route with a zero cold-shell allowance', () => {
    expect(ROUTE_BUDGETS['cold NotFound']).toEqual({ grouped: [], maxRequests: 0 })
    const entries = Object.entries(ROUTE_BUDGETS) as [string, { grouped: string[]; maxRequests: number }][]
    for (const [route, budget] of entries) {
      expect(Number.isInteger(budget.maxRequests), route).toBe(true)
      expect(Array.isArray(budget.grouped), route).toBe(true)
    }
  })
})
