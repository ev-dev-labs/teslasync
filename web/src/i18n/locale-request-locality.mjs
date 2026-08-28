/**
 * Pure parser for the headless locale probe's report.
 *
 * Kept separate from the perf gate that spawns the browser so the fallback
 * locality contract can be unit-tested against fixture output.
 */

const ROUTE_LINE = /^\[i18n-runtime\] (?<route>[^:]+): (?<count>\d+) deferred locale requests(?<rest>.*)$/
// Bundle names may contain hyphens (`vehicle-systems`, `detail-toast`), so the
// name is matched greedily and only the trailing content hash is peeled off.
const LOCALE_CHUNK = /locale-(?<bundle>[A-Za-z0-9-]+)-[A-Za-z0-9_-]{8,}\.js/g

/**
 * Per-route deferred-locale budget.
 *
 * `grouped` lists the feature catalogs a route may download.
 * `locale-detail-*` chunks are never listed — they are per-namespace by
 * construction and cannot carry an unrelated feature's strings — but they do
 * count against `maxRequests`, the ceiling on total deferred locale requests.
 * `maxRequests: 0` is the cold-shell contract for a direct NotFound hit:
 * nothing at all may be downloaded.
 */
export const ROUTE_BUDGETS = {
  'cold NotFound': { grouped: [], maxRequests: 0 },
  Dashboard: { grouped: ['dashboard'], maxRequests: 3 },
  Drives: { grouped: ['driving', 'trips'], maxRequests: 4 },
  Charging: { grouped: ['charging'], maxRequests: 4 },
  Vehicles: { grouped: ['vehicles'], maxRequests: 2 },
}

/**
 * Parses a probe report into `{ route, count, bundles }` records.
 * Exported so tests can assert the parse independently of the budget rules.
 */
export function parseProbeReport(probeOutput) {
  const routes = []
  for (const line of probeOutput.split(/\r?\n/)) {
    const match = ROUTE_LINE.exec(line.trim())
    if (!match) continue
    routes.push({
      route: match.groups.route,
      count: Number(match.groups.count),
      bundles: [...match.groups.rest.matchAll(LOCALE_CHUNK)].map((chunk) => chunk.groups.bundle),
    })
  }
  return routes
}

export function localityFailures(probeOutput, budgets = ROUTE_BUDGETS) {
  const failures = []
  const seenRoutes = new Set()
  for (const { route, count, bundles } of parseProbeReport(probeOutput)) {
    seenRoutes.add(route)
    const budget = budgets[route]
    if (!budget) continue
    if (count > budget.maxRequests) {
      failures.push(
        `${route} issued ${count} deferred locale requests, budget is ${budget.maxRequests}`,
      )
      continue
    }
    // A truncated report names fewer chunks than the count claims; parsing must
    // agree with the probe's own tally or the locality gate is reading a
    // half-flushed pipe and silently passing.
    if (bundles.length !== count) {
      failures.push(
        `${route} reported ${count} deferred locale requests but named ${bundles.length} chunks (truncated probe output?)`,
      )
      continue
    }
    for (const bundle of bundles) {
      if (bundle.startsWith('detail-')) continue
      if (!budget.grouped.includes(bundle)) {
        failures.push(`${route} downloaded foreign grouped locale bundle "${bundle}"`)
      }
    }
  }
  for (const route of Object.keys(budgets)) {
    if (!seenRoutes.has(route)) failures.push(`probe never reported route "${route}"`)
  }
  return failures
}
