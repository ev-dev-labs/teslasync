import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loads = vi.hoisted(() => ({ dashboard: 0, driving: 0, charging: 0, vehicles: 0, chart: 0 }))
vi.mock('./en/locale-dashboard.json', async (original) => {
  loads.dashboard++
  return original()
})
vi.mock('./en/locale-driving.json', async (original) => {
  loads.driving++
  return original()
})
vi.mock('./en/locale-charging.json', async (original) => {
  loads.charging++
  return original()
})
vi.mock('./en/locale-vehicles.json', async (original) => {
  loads.vehicles++
  return original()
})
vi.mock('./en/locale-detail-chart.json', async (original) => {
  loads.chart++
  return original()
})

let runtime: typeof import('./index')

beforeEach(async () => {
  vi.resetModules()
  for (const key of Object.keys(loads) as Array<keyof typeof loads>) loads[key] = 0
  window.history.replaceState(null, '', '/__locale-shell-probe__')
  runtime = await import('./index')
})

afterEach(() => {
  runtime.flushPendingEnglishResourcesForTest()
  vi.restoreAllMocks()
})

describe('route-owned shared locale closures', () => {
  it.each([
    {
      path: '/', namespace: 'dashboard', bundle: 'dashboard',
      keys: ['dashboard.shortcuts.group', 'theme.firstRunTitle', 'kiosk.settings',
        'freshness.noData', 'delta.title', 'chart.a11y.fallbackTableLabel',
        'lifetime.unlocked', 'toast.settings.dashboardLayouts.success'],
    },
    {
      path: '/drives/412/', namespace: 'drives', bundle: 'driving',
      keys: ['date.preset.last24h', 'drives.title', 'bulk.actions.delete',
        'operations.drives.noDataTitle', 'savedViews.title', 'chart.col.date',
        'driveDetail.report.overview', 'driveDetail.report.sampleMeanPower',
        'driveDetail.report.energyEstimate', 'driveDetail.report.honesty.missing'],
    },
    {
      path: '/charging', namespace: 'charging', bundle: 'charging',
      keys: ['date.preset.last24h', 'charging.list.title', 'bulk.actions.delete',
        'operations.charging.noDataTitle', 'savedViews.title', 'chargeQueue.title',
        'chart.col.date', 'listExport.menuLabel'],
    },
    {
      path: '/vehicles', namespace: 'vehicles', bundle: 'vehicles',
      keys: ['operations.vehicles.narrative.whatChangedWithoutBattery', 'vehicles.preview.trust.checking',
        'dataState.staleNamed.title', 'dataState.refreshBlocked.message'],
    },
  ])('serves $path shared keys from its own lazy bundle', async ({ path, namespace, bundle, keys }) => {
    window.history.replaceState(null, '', path)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    for (const key of keys) runtime.default.t(key, { defaultValue: '__fallback__', saveMissing: true })
    await runtime.loadEnglishNamespace(namespace)
    await new Promise(resolve => setTimeout(resolve, 80))
    for (const key of keys) expect(runtime.default.t(key, '__fallback__'), key).not.toBe('__fallback__')
    expect(loads[bundle as keyof typeof loads]).toBe(1)
    expect(Object.values(loads).reduce((sum, count) => sum + count, 0)).toBe(1)
    expect(errors).not.toHaveBeenCalled()
  })

  it('keeps first-visit changelog UI and base accessibility labels shell-only', async () => {
    for (const key of ['changelog.modal.title', 'changelog.modal.subtitleFirstVisit',
      'changelog.modal.gotIt', 'changelog.sections.added', 'a11y.loading']) {
      expect(runtime.default.t(key, '__fallback__'), key).not.toBe('__fallback__')
    }
    runtime.default.t('a11y.summary.gauge.value', { defaultValue: '__fallback__', saveMissing: true })
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(Object.values(loads).every(count => count === 0)).toBe(true)
  })

  it('preserves narrow namespace fallback loading on unrelated routes', async () => {
    await runtime.loadEnglishNamespace('chart')
    expect(runtime.default.t('chart.col.date', '__fallback__')).not.toBe('__fallback__')
    expect(loads).toEqual({ dashboard: 0, driving: 0, charging: 0, vehicles: 0, chart: 1 })
  })

})
