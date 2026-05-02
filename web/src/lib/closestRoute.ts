import type { RouteEntry } from './routeRegistry'

/**
 * Phase 40 / Prompt 38 — Closest-route suggestion engine for the 404 page.
 *
 * Given a typed pathname (e.g. `/vehiclees`) and the registry of known routes,
 * return up to `limit` candidates ranked by Levenshtein edit distance.
 *
 * Distance is computed against BOTH the route path and the route label
 * (lower-cased, alphanumerics only) so that:
 *   - `/dashboards` → `/` (label="Dashboard", distance 1 vs label)
 *   - `/vehiclees`  → `/vehicles` (distance 1 vs path)
 *   - `/baterry`    → `/battery`  (distance 2 vs path)
 *
 * Hidden entries (parameterized routes like `/vehicles/:id`) are excluded
 * because we cannot navigate to them without supplying the parameter.
 */
export interface RouteSuggestion extends RouteEntry {
  distance: number
}

export function closestRoutes(
  query: string,
  registry: readonly RouteEntry[],
  limit = 5,
): RouteSuggestion[] {
  const q = normalize(query)
  if (!q) return []

  const scored: RouteSuggestion[] = []
  for (const r of registry) {
    if (r.hidden) continue
    const pathDist = levenshtein(q, normalize(r.path))
    const labelDist = levenshtein(q, normalize(r.label))
    const distance = Math.min(pathDist, labelDist)
    if (distance <= 6) scored.push({ ...r, distance })
  }
  scored.sort((a, b) => a.distance - b.distance || a.path.localeCompare(b.path))
  return scored.slice(0, limit)
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\-_/]+/g, '')
}

/**
 * Iterative two-row Levenshtein. O(m*n) time, O(min(m,n)) space.
 * Standard textbook implementation; no external deps.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  // Always iterate over the shorter string in the inner loop for cache locality.
  if (a.length > b.length) {
    const tmp = a
    a = b
    b = tmp
  }

  const m = a.length
  const n = b.length
  let prev: number[] = new Array(m + 1)
  let curr: number[] = new Array(m + 1)
  for (let i = 0; i <= m; i++) prev[i] = i

  for (let j = 1; j <= n; j++) {
    curr[0] = j
    for (let i = 1; i <= m; i++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      curr[i] = Math.min(curr[i - 1] + 1, prev[i] + 1, prev[i - 1] + cost)
    }
    const tmp = prev
    prev = curr
    curr = tmp
  }
  return prev[m]
}
