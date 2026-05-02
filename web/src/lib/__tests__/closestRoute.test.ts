import { describe, it, expect } from 'vitest'
import { closestRoutes } from '../closestRoute'
import type { RouteEntry } from '../routeRegistry'

const REGISTRY: readonly RouteEntry[] = [
  { path: '/', name: 'Dashboard', label: 'Dashboard', i18nKey: 'routes.dashboard' },
  { path: '/vehicles', name: 'Vehicles', label: 'Vehicles', i18nKey: 'routes.vehicles' },
  { path: '/vehicles/:id', name: 'VehicleDetail', label: 'Vehicle Detail', i18nKey: 'routes.vehicleDetail', hidden: true },
  { path: '/battery', name: 'BatteryHealth', label: 'Battery Health', i18nKey: 'routes.batteryHealth' },
  { path: '/charging', name: 'Charging', label: 'Charging', i18nKey: 'routes.charging' },
  { path: '/drives', name: 'Drives', label: 'Drives', i18nKey: 'routes.drives' },
  { path: '/settings', name: 'Settings', label: 'Settings', i18nKey: 'routes.settings' },
]

describe('closestRoutes', () => {
  it('returns an empty list for an empty query', () => {
    expect(closestRoutes('', REGISTRY)).toEqual([])
    expect(closestRoutes('/', REGISTRY)).toEqual([])
  })

  it('suggests /vehicles for /vehiclees (typo)', () => {
    const out = closestRoutes('/vehiclees', REGISTRY, 3)
    expect(out.length).toBeGreaterThan(0)
    expect(out[0].path).toBe('/vehicles')
  })

  it('suggests /battery for /baterry (typo)', () => {
    const out = closestRoutes('/baterry', REGISTRY, 3)
    expect(out[0].path).toBe('/battery')
  })

  it('suggests /charging for /charing (typo)', () => {
    const out = closestRoutes('/charing', REGISTRY, 3)
    expect(out[0].path).toBe('/charging')
  })

  it('matches against label as well as path (e.g. /dashboard → Dashboard at /)', () => {
    const out = closestRoutes('/dashboard', REGISTRY, 3)
    expect(out[0].path).toBe('/')
  })

  it('excludes hidden (parameterized) routes from suggestions', () => {
    const out = closestRoutes('/vehicles/123', REGISTRY, 5)
    expect(out.every((r) => r.path !== '/vehicles/:id')).toBe(true)
  })

  it('respects the limit parameter', () => {
    const out = closestRoutes('/x', REGISTRY, 2)
    expect(out.length).toBeLessThanOrEqual(2)
  })

  it('drops candidates whose distance exceeds the cap (6)', () => {
    const out = closestRoutes('/totally-unrelated-gibberish-path', REGISTRY)
    expect(out).toEqual([])
  })

  it('returns suggestions sorted by ascending distance', () => {
    const out = closestRoutes('/setings', REGISTRY, 5)
    for (let i = 1; i < out.length; i++) {
      expect(out[i].distance).toBeGreaterThanOrEqual(out[i - 1].distance)
    }
    expect(out[0].path).toBe('/settings')
  })
})
