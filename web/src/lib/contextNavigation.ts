import { ROUTE_META } from './routeMeta'
import { getWorkspaceRouteScope } from './workspaceScope'

export type ContextQueryValue =
  | string
  | number
  | boolean
  | readonly string[]
  | null
  | undefined

/** Build a deep link while omitting unavailable context instead of serializing placeholders. */
export function buildContextHref(
  path: string,
  query: Readonly<Record<string, ContextQueryValue>> = {},
): string {
  const params = new URLSearchParams()

  for (const [key, rawValue] of Object.entries(query)) {
    if (rawValue == null || rawValue === '') continue
    const value = Array.isArray(rawValue) ? rawValue.filter(Boolean).join(',') : String(rawValue)
    if (value !== '') params.set(key, value)
  }

  const search = params.toString()
  return search ? `${path}?${search}` : path
}

// ── Contextual navigation ──────────────────────────────────────────────────
//
// "Where else can I go from here?" answered from route METADATA only. Nothing
// is invented: a related destination exists only when `ROUTE_META` already
// declares the relationship (a parent, or a sibling under the same parent).
// routes with no declared hierarchy return an empty list rather than a
// speculative guess, so the UI can render nothing instead of noise.

/**
 * Canonical global-scope query keys owned by the app shell.
 *
 * `vehicle_id` is written by `useSelectedVehicle`; the date keys are written
 * by `useRangeState`. Both are already URL-backed so deep links and the
 * browser's back/forward stack keep working — this list lets in-shell
 * navigation CARRY that context to a destination that can actually consume
 * it, instead of silently resetting the user's scope on every jump.
 */
export const WORKSPACE_SCOPE_QUERY_KEYS = [
  'vehicle_id',
  'from',
  'to',
  'time_scope',
  'compare',
] as const

const VEHICLE_SCOPE_KEYS = new Set<string>(['vehicle_id'])

/**
 * Carry the active global scope onto `targetHref` when — and only when — the
 * destination route owns that control.
 *
 * Behaviour-safe by construction:
 * - A key the target already sets explicitly is never overwritten.
 * - Range keys are copied only to routes that own the analysis window;
 *   `vehicle_id` only to routes where a single-vehicle scope is meaningful.
 * - Anything else in the current query string is dropped: page-local filters
 *   are not portable and copying them would fabricate state.
 */
export function preserveWorkspaceScope(
  targetHref: string,
  currentSearch: string,
): string {
  if (!targetHref || !currentSearch) return targetHref
  const [rawPath, rawQuery = ''] = targetHref.split('#', 1)[0].split('?')
  const hashIndex = targetHref.indexOf('#')
  const hash = hashIndex >= 0 ? targetHref.slice(hashIndex) : ''

  const scope = getWorkspaceRouteScope(rawPath)
  if (!scope.range && !scope.vehicle) return targetHref

  const current = new URLSearchParams(currentSearch)
  const next = new URLSearchParams(rawQuery)
  for (const key of WORKSPACE_SCOPE_QUERY_KEYS) {
    if (next.has(key)) continue
    const value = current.get(key)
    if (value == null || value === '') continue
    const allowed = VEHICLE_SCOPE_KEYS.has(key) ? scope.vehicle : scope.range
    if (!allowed) continue
    next.set(key, value)
  }

  const query = next.toString()
  return `${rawPath}${query ? `?${query}` : ''}${hash}`
}

export interface RelatedRoute {
  /**
   * CONCRETE href, ready to navigate to — never a route pattern. Any `:param`
   * is resolved from the pathname the user is currently on.
   */
  path: string
  /** The route pattern this href was resolved from (diagnostics / tests). */
  pattern: string
  /** i18n key for the label. */
  i18nKey: string
  /** Stable English label used as the i18n fallback. */
  defaultLabel: string
  /** How this destination relates to the current route. */
  relation: 'parent' | 'sibling'
}

function normalizeContextPath(pathname: string): string {
  const path = (pathname ?? '').split(/[?#]/, 1)[0] || '/'
  const absolute = path.startsWith('/') ? path : `/${path}`
  return absolute.length > 1 ? absolute.replace(/\/+$/, '') : absolute
}

/**
 * Resolve the registered route pattern for a concrete pathname.
 *
 * Prefers an exact match, then the most specific pattern whose static
 * segments all match (so `/drives/4421` resolves to `/drives/:id`).
 */
export function resolveRoutePattern(pathname: string): string | null {
  const normalized = normalizeContextPath(pathname)
  if (ROUTE_META[normalized]) return normalized

  const segments = normalized.split('/')
  let best: string | null = null
  for (const pattern of Object.keys(ROUTE_META)) {
    const patternSegments = pattern.split('/')
    if (patternSegments.length !== segments.length) continue
    const matches = patternSegments.every((segment, index) =>
      segment.startsWith(':') ? (segments[index]?.length ?? 0) > 0 : segment === segments[index],
    )
    if (!matches) continue
    const staticCount = patternSegments.filter((s) => !s.startsWith(':')).length
    const bestStatic = best
      ? best.split('/').filter((s) => !s.startsWith(':')).length
      : -1
    if (staticCount > bestStatic) best = pattern
  }
  return best
}

/**
 * Extract concrete `:param` values by aligning a matched pattern with the
 * pathname the user is actually on.
 *
 * `('/drives/:id/replay', '/drives/4421/replay')` → `{ id: '4421' }`.
 * Returns `{}` when the pattern does not align (defensive — callers then
 * cannot resolve any parameterized link and must omit it).
 */
export function extractRouteParams(
  pattern: string,
  pathname: string,
): Record<string, string> {
  const patternSegments = pattern.split('/')
  const pathSegments = normalizeContextPath(pathname).split('/')
  if (patternSegments.length !== pathSegments.length) return {}

  const params: Record<string, string> = {}
  for (let index = 0; index < patternSegments.length; index += 1) {
    const segment = patternSegments[index]
    if (!segment.startsWith(':')) {
      if (segment !== pathSegments[index]) return {}
      continue
    }
    const value = pathSegments[index]
    // A value that is itself a placeholder means the caller passed a route
    // PATTERN rather than a concrete pathname. Accepting it would round-trip
    // `:id` straight back into an href — exactly the literal-parameter URL
    // this module must never emit.
    if (!value || value.startsWith(':')) return {}
    params[segment.slice(1)] = value
  }
  return params
}

/**
 * Substitute `:param` placeholders in a route pattern with concrete values.
 *
 * Returns `null` when ANY placeholder is left unresolved — a href containing a
 * literal `:id` is a broken link, and guessing an id would be exactly the
 * speculative content this module refuses to produce.
 */
export function resolveRouteHref(
  pattern: string,
  params: Readonly<Record<string, string | undefined>>,
): string | null {
  const resolved = pattern
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment
      const value = params[segment.slice(1)]
      return value && value.length > 0 ? encodeURIComponent(value) : segment
    })
    .join('/')
  return resolved.includes('/:') || resolved.startsWith(':') ? null : resolved
}

/** The declared parent pattern for `pathname`, or `null` when top-level. */
export function getParentRoutePattern(pathname: string): string | null {
  const pattern = resolveRoutePattern(pathname)
  if (!pattern) return null
  return ROUTE_META[pattern]?.parent ?? null
}

/**
 * Concrete, clickable href for the current route's declared parent.
 *
 * `/drives/4421/replay` → `/drives/4421` (NOT `/drives/:id`).
 * Returns `null` when the route is top-level, unknown, or when the parent
 * pattern has a placeholder that the current pathname cannot fill.
 */
export function getParentRouteHref(pathname: string): string | null {
  const pattern = resolveRoutePattern(pathname)
  if (!pattern) return null
  const parent = ROUTE_META[pattern]?.parent
  if (!parent) return null
  return resolveRouteHref(parent, extractRouteParams(pattern, pathname))
}

/**
 * Sibling + parent destinations declared for the current route.
 *
 * Every emitted `path` is a CONCRETE href, never a route pattern:
 * - Placeholders shared with the current pathname (`/vehicles/:id/access` →
 *   `/vehicles/:id` → `/vehicles/7`) are resolved from the live URL.
 * - A destination whose placeholders cannot be resolved from the current
 *   pathname is omitted rather than emitted as a literal `:id` URL.
 * - Returns `[]` for unknown or top-level routes.
 */
export function getRelatedRoutes(
  pathname: string,
  options: { limit?: number } = {},
): RelatedRoute[] {
  const pattern = resolveRoutePattern(pathname)
  if (!pattern) return []
  const parent = ROUTE_META[pattern]?.parent
  if (!parent) return []

  const params = extractRouteParams(pattern, pathname)
  const related: RelatedRoute[] = []
  const parentMeta = ROUTE_META[parent]
  const parentHref = parentMeta ? resolveRouteHref(parent, params) : null
  if (parentMeta && parentHref) {
    related.push({
      path: parentHref,
      pattern: parent,
      i18nKey: parentMeta.i18nKey,
      defaultLabel: parentMeta.defaultLabel,
      relation: 'parent',
    })
  }

  for (const [candidate, meta] of Object.entries(ROUTE_META)) {
    if (candidate === pattern || candidate === parent) continue
    if (meta.parent !== parent) continue
    const href = resolveRouteHref(candidate, params)
    // Unresolvable placeholder → omit. Never emit `/drives/:id`.
    if (!href || href === pathname) continue
    related.push({
      path: href,
      pattern: candidate,
      i18nKey: meta.i18nKey,
      defaultLabel: meta.defaultLabel,
      relation: 'sibling',
    })
  }

  const limit = options.limit
  return typeof limit === 'number' && limit >= 0 ? related.slice(0, limit) : related
}
