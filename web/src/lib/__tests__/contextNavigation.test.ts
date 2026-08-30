import { describe, expect, it } from 'vitest'
import {
  buildContextHref,
  extractRouteParams,
  getParentRouteHref,
  getParentRoutePattern,
  getRelatedRoutes,
  preserveWorkspaceScope,
  resolveRouteHref,
  resolveRoutePattern,
  WORKSPACE_SCOPE_QUERY_KEYS,
} from '../contextNavigation'

describe('buildContextHref', () => {
  it('encodes entity and time context', () => {
    expect(buildContextHref('/signals', {
      from: '2026-08-20',
      to: '2026-08-21',
      signals: ['BatteryLevel', 'VehicleSpeed'],
    })).toBe(
      '/signals?from=2026-08-20&to=2026-08-21&signals=BatteryLevel%2CVehicleSpeed',
    )
  })

  it('omits unavailable values and empty collections', () => {
    expect(buildContextHref('/locations', {
      q: 'Home & Office',
      from: null,
      to: undefined,
      signals: [],
    })).toBe('/locations?q=Home+%26+Office')
  })
})

// ── Contextual navigation (derived from ROUTE_META, never invented) ────────

describe('resolveRoutePattern', () => {
  it('resolves an exact registered path', () => {
    expect(resolveRoutePattern('/drives')).toBe('/drives')
  })

  it('resolves a concrete detail URL to its parameterized pattern', () => {
    expect(resolveRoutePattern('/drives/4421')).toBe('/drives/:id')
    expect(resolveRoutePattern('/drives/4421/replay')).toBe('/drives/:id/replay')
    expect(resolveRoutePattern('/vehicles/7/access')).toBe('/vehicles/:id/access')
  })

  it('ignores query strings, hashes, and trailing slashes', () => {
    expect(resolveRoutePattern('/drives/?from=2026-01-01')).toBe('/drives')
    expect(resolveRoutePattern('/drives#top')).toBe('/drives')
  })

  it('returns null for an unregistered path', () => {
    expect(resolveRoutePattern('/definitely-not-a-route')).toBeNull()
  })
})

describe('getParentRoutePattern', () => {
  it('returns the declared parent for a nested route', () => {
    expect(getParentRoutePattern('/analytics/carbon')).toBe('/analytics')
    expect(getParentRoutePattern('/drives/4421')).toBe('/drives')
  })

  it('returns null for a top-level route', () => {
    expect(getParentRoutePattern('/drives')).toBeNull()
    expect(getParentRoutePattern('/')).toBeNull()
  })

  it('returns null for an unknown route', () => {
    expect(getParentRoutePattern('/nope')).toBeNull()
  })
})

describe('extractRouteParams', () => {
  it('aligns a pattern with the concrete pathname', () => {
    expect(extractRouteParams('/drives/:id', '/drives/4421')).toEqual({ id: '4421' })
    expect(extractRouteParams('/drives/:id/replay', '/drives/4421/replay')).toEqual({
      id: '4421',
    })
    expect(extractRouteParams('/vehicles/:id/access', '/vehicles/7/access')).toEqual({
      id: '7',
    })
  })

  it('returns {} when the pattern does not align', () => {
    expect(extractRouteParams('/drives/:id', '/charging/4421')).toEqual({})
    expect(extractRouteParams('/drives/:id', '/drives')).toEqual({})
    expect(extractRouteParams('/drives', '/drives')).toEqual({})
  })

  it('normalizes query strings and trailing slashes before aligning', () => {
    expect(extractRouteParams('/drives/:id', '/drives/4421/?tab=map')).toEqual({
      id: '4421',
    })
  })
})

describe('resolveRouteHref', () => {
  it('substitutes every placeholder it can fill', () => {
    expect(resolveRouteHref('/drives/:id', { id: '4421' })).toBe('/drives/4421')
    expect(resolveRouteHref('/vehicles/:id/access', { id: '7' })).toBe('/vehicles/7/access')
  })

  it('returns null when any placeholder is unresolved (never a literal :id)', () => {
    expect(resolveRouteHref('/drives/:id', {})).toBeNull()
    expect(resolveRouteHref('/drives/:id/replay', { other: '1' })).toBeNull()
    expect(resolveRouteHref('/drives/:id', { id: '' })).toBeNull()
  })

  it('passes static patterns through unchanged', () => {
    expect(resolveRouteHref('/notifications/rules', {})).toBe('/notifications/rules')
  })

  it('encodes parameter values', () => {
    expect(resolveRouteHref('/drives/:id', { id: 'a b/c' })).toBe('/drives/a%20b%2Fc')
  })
})

describe('getParentRouteHref', () => {
  it('resolves a parameterized parent from the concrete pathname', () => {
    expect(getParentRouteHref('/drives/4421/replay')).toBe('/drives/4421')
    expect(getParentRouteHref('/vehicles/7/access')).toBe('/vehicles/7')
  })

  it('resolves a static parent', () => {
    expect(getParentRouteHref('/drives/4421')).toBe('/drives')
    expect(getParentRouteHref('/analytics/carbon')).toBe('/analytics')
  })

  it('returns null for top-level and unknown routes', () => {
    expect(getParentRouteHref('/drives')).toBeNull()
    expect(getParentRouteHref('/')).toBeNull()
    expect(getParentRouteHref('/definitely-not-a-route')).toBeNull()
  })

  it('returns null when the parent placeholder cannot be filled', () => {
    // Passing the PATTERN (not a concrete URL) leaves `:id` unfillable, so the
    // parent link is omitted rather than emitted as `/drives/:id`.
    expect(getParentRouteHref('/drives/:id/replay')).toBeNull()
  })
})

describe('getRelatedRoutes', () => {
  it('returns nothing for a route with no declared hierarchy (no speculation)', () => {
    expect(getRelatedRoutes('/drives')).toEqual([])
    expect(getRelatedRoutes('/')).toEqual([])
    expect(getRelatedRoutes('/not-a-route')).toEqual([])
  })

  it('leads with the parent, then siblings under the same parent', () => {
    const related = getRelatedRoutes('/analytics/carbon')
    expect(related[0]).toMatchObject({ path: '/analytics', relation: 'parent' })
    expect(related.slice(1).every((r) => r.relation === 'sibling')).toBe(true)
    expect(related.map((r) => r.path)).not.toContain('/analytics/carbon')
  })

  it('NEVER emits a literal parameter URL for any registered route', () => {
    const probes = [
      '/drives/4421',
      '/drives/4421/replay',
      '/vehicles/7',
      '/vehicles/7/access',
      '/trips/9',
      '/charging/88',
      '/notifications/rules',
      '/analytics/carbon',
      '/admin/dlq',
      '/system-status/incidents/12',
      '/automations/33/edit',
      '/year-review/2025',
    ]
    for (const probe of probes) {
      for (const route of getRelatedRoutes(probe)) {
        expect(route.path, `${probe} → ${route.path}`).not.toMatch(/(^|\/):[A-Za-z]/)
      }
    }
  })

  it('resolves the drive chain against the concrete drive id', () => {
    const related = getRelatedRoutes('/drives/4421/replay')
    expect(related[0]).toMatchObject({
      path: '/drives/4421',
      pattern: '/drives/:id',
      relation: 'parent',
    })
  })

  it('resolves the vehicle chain against the concrete vehicle id', () => {
    const related = getRelatedRoutes('/vehicles/7/access')
    expect(related[0]).toMatchObject({
      path: '/vehicles/7',
      pattern: '/vehicles/:id',
      relation: 'parent',
    })
  })

  it('resolves parameterized siblings using the same id', () => {
    // `/vehicles/:id/access` is a sibling of `/vehicles/:id`'s children; from
    // the detail route it must resolve to the SAME vehicle, not a placeholder.
    const related = getRelatedRoutes('/vehicles/7')
    const access = related.find((r) => r.pattern === '/vehicles/:id/access')
    if (access) {
      expect(access.path).toBe('/vehicles/7/access')
    }
    expect(related.every((r) => !r.path.includes('/:'))).toBe(true)
  })

  it('omits unresolvable links instead of emitting placeholders', () => {
    // Asking about the PATTERN (not a concrete URL) leaves `:id` unfillable,
    // so every parameterized relation must be dropped.
    for (const route of getRelatedRoutes('/drives/:id/replay')) {
      expect(route.path).not.toContain(':')
    }
    // The parent here is `/drives/:id`, which cannot be resolved → no parent row.
    expect(
      getRelatedRoutes('/drives/:id/replay').some((r) => r.relation === 'parent'),
    ).toBe(false)
  })

  it('never proposes a parameterized sibling it cannot link to', () => {
    const related = getRelatedRoutes('/notifications/rules')
    expect(related.every((r) => !r.path.includes('/:'))).toBe(true)
    expect(related.map((r) => r.path)).toContain('/notifications/inbox')
  })

  it('never lists the page the user is already on', () => {
    const related = getRelatedRoutes('/notifications/rules')
    expect(related.map((r) => r.path)).not.toContain('/notifications/rules')
  })

  it('carries a label, i18n key and source pattern for every entry', () => {
    for (const route of getRelatedRoutes('/notifications/rules')) {
      expect(route.i18nKey).toBeTruthy()
      expect(route.defaultLabel).toBeTruthy()
      expect(route.pattern).toBeTruthy()
    }
  })

  it('honours the caller-supplied limit', () => {
    expect(getRelatedRoutes('/notifications/rules', { limit: 2 })).toHaveLength(2)
    expect(getRelatedRoutes('/notifications/rules', { limit: 0 })).toHaveLength(0)
  })

  it('resolves related routes from a concrete detail URL', () => {
    const related = getRelatedRoutes('/drives/4421')
    expect(related[0]).toMatchObject({ path: '/drives', relation: 'parent' })
  })
})

describe('preserveWorkspaceScope', () => {
  const scope = 'vehicle_id=7&from=2026-01-01&to=2026-01-31&time_scope=30d&compare=true'

  it('is a no-op without a current query string', () => {
    expect(preserveWorkspaceScope('/drives', '')).toBe('/drives')
  })

  it('carries the analysis window to a range-owning destination', () => {
    const href = preserveWorkspaceScope('/drives', scope)
    const params = new URLSearchParams(href.split('?')[1])
    expect(params.get('from')).toBe('2026-01-01')
    expect(params.get('to')).toBe('2026-01-31')
    expect(params.get('time_scope')).toBe('30d')
    expect(params.get('compare')).toBe('true')
    expect(params.get('vehicle_id')).toBe('7')
  })

  it('does not carry the analysis window to a route that cannot consume it', () => {
    const href = preserveWorkspaceScope('/battery', scope)
    const params = new URLSearchParams(href.split('?')[1])
    expect(params.get('from')).toBeNull()
    expect(params.get('time_scope')).toBeNull()
    // Vehicle scope IS meaningful on /battery.
    expect(params.get('vehicle_id')).toBe('7')
  })

  it('does not carry vehicle scope to fleet-wide destinations', () => {
    const href = preserveWorkspaceScope('/tesla-charging-history', scope)
    const params = new URLSearchParams(href.split('?')[1])
    expect(params.get('vehicle_id')).toBeNull()
    expect(params.get('from')).toBe('2026-01-01')
  })

  it('leaves routes that own no global scope untouched', () => {
    expect(preserveWorkspaceScope('/settings', scope)).toBe('/settings')
  })

  it('never overwrites a value the destination sets explicitly', () => {
    const href = preserveWorkspaceScope('/drives?from=2025-05-05', scope)
    const params = new URLSearchParams(href.split('?')[1])
    expect(params.get('from')).toBe('2025-05-05')
    expect(params.get('to')).toBe('2026-01-31')
  })

  it('drops page-local filters instead of fabricating state on the target', () => {
    const href = preserveWorkspaceScope('/drives', 'page=4&sort=distance&vehicle_id=7')
    const params = new URLSearchParams(href.split('?')[1])
    expect(params.get('page')).toBeNull()
    expect(params.get('sort')).toBeNull()
    expect(params.get('vehicle_id')).toBe('7')
  })

  it('preserves an explicit hash fragment', () => {
    expect(preserveWorkspaceScope('/drives#telemetry', 'vehicle_id=7')).toBe(
      '/drives?vehicle_id=7#telemetry',
    )
  })

  it('ignores empty scope values', () => {
    expect(preserveWorkspaceScope('/drives', 'vehicle_id=')).toBe('/drives')
  })

  it('declares the canonical scope keys', () => {
    expect([...WORKSPACE_SCOPE_QUERY_KEYS]).toEqual([
      'vehicle_id',
      'from',
      'to',
      'time_scope',
      'compare',
    ])
  })
})
