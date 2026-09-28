import type { FleetTelemetryCoverageResponse } from '@/api/types'
import type { SolarChargeAdvice, TeslaEnergySite } from '@/types/energy'
import { chargingDomain } from './chargingDomain'

type FixtureResult = { status: number; body: unknown }

const found = (body: unknown): FixtureResult => ({ status: 200, body })
const invalid = (): FixtureResult => ({
  status: 400, body: { error: 'Invalid synthetic Tesla fixture filters', code: 'INVALID_FILTER' },
})
const unavailable = (): FixtureResult => ({
  status: 404, body: { error: 'No fictional energy site with that ID', code: 'DEMO_NOT_AVAILABLE' },
})

// A virtual sample site is not a connected Powerwall, a charger, or an account asset.
const sampleSite: TeslaEnergySite = {
  id: 1, energy_site_id: 1, resource_type: 'synthetic_demo',
  site_name: 'Fictional energy site (not connected)', gateway_id: null,
  total_pack_energy: null, percentage_charged: null, battery_type: null,
  backup_capable: false, storm_mode_enabled: false, has_solar: false,
  has_battery: false, has_grid: false, has_load_meter: false,
  tou_capable: false, storm_mode_capable: false,
  fetched_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z', site_info_fetched_at: null,
}

const noAdvice: SolarChargeAdvice = {
  verdict: 'no_data', surplus_w: 0, solar_w: 0, home_w: 0,
  battery_charge_w: 0, recommended_amps: 0, snapshot_age_s: 0,
  explanation: 'Fictional demo: no connected energy site or measured solar surplus; no charging recommendation.',
}

const coverage: FleetTelemetryCoverageResponse = {
  categories: [], destination_totals: {}, orphan_fields: [],
}

function validHistoryFilters(params: URLSearchParams): boolean {
  if ([...params.keys()].some(key => !['since', 'until', 'limit'].includes(key))) return false
  const since = params.get('since')
  const until = params.get('until')
  const date = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    const parsed = new Date(`${value}T00:00:00Z`)
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  }
  if ((since != null && !date(since)) || (until != null && !date(until))
    || (since != null && until != null && since > until)) return false
  const limit = params.get('limit')
  return limit == null || (/^[1-9]\d*$/.test(limit) && Number(limit) <= 2000)
}

/**
 * Read-only browser fixtures. No Tesla authentication, purchases, telemetry
 * subscription, home electricity measurements, or charge actions are simulated.
 */
export function teslaDomain(pathname: string, params: URLSearchParams): FixtureResult | undefined {
  if (pathname === '/tesla/charging/history'
    || pathname === '/tesla/charging/history/sites'
    || pathname === '/tesla/charging/sessions') {
    return chargingDomain(pathname, params)
  }
  if (pathname === '/tesla/user/feature-config') {
    return found({ data: { synthetic_demo: true }, fetched_at: null })
  }
  if (pathname === '/tesla/user/region') {
    return found({ data: {}, fetched_at: null })
  }
  if (pathname === '/tesla/user/orders') {
    // Vehicle records are not proof of a purchase through this Tesla account.
    return found({ orders: [], fetched_at: null })
  }
  if (pathname === '/tesla/user/profile') {
    return found({ profile: null, fetched_at: null })
  }
  if (pathname === '/tesla/fleet-telemetry/coverage') return found(coverage)
  if (pathname === '/tesla/fleet-telemetry/error-vins') return found([])
  if (pathname === '/tesla/energy-sites') return found([sampleSite])

  const site = pathname.match(/^\/tesla\/energy-sites\/([^/]+)\/(live-status(?:\/history)?|charge-advice)$/)
  if (site) {
    const [, rawId, suffix] = site
    if (!/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(Number(rawId))) return invalid()
    if (Number(rawId) !== sampleSite.energy_site_id) return unavailable()
    if (suffix === 'live-status/history') {
      return validHistoryFilters(params) ? found([]) : invalid()
    }
    if (params.size) return invalid()
    if (suffix === 'charge-advice') return found(noAdvice)
    return found({ message: 'No live energy measurements in this fictional demo.' })
  }
  return undefined
}
