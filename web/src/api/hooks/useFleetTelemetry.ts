/**
 * @module api/hooks/useFleetTelemetry
 *
 * introduced the package-derived
 * `/tesla/fleet-telemetry/coverage` endpoint that replaces the legacy
 * `fleet_telemetry_subscriptions` table query with a routing-layer
 * snapshot built from `router.LoadMap()` + `teslaconfig.Builder`.
 * This hook surfaces the typed response so the Settings / Diagnostics
 * pages can render "what's actively ingested" with per-category
 * destination breakdowns.
 *
 * The legacy MQTT-error / subscription health hooks live in
 * `useTelemetry.ts` and are not touched here — those endpoints
 * (`/tesla/fleet-telemetry/error-vins`, `/errors`) still use the same
 * shape.
 */

import { useQuery } from '@tanstack/react-query'
import { request } from '../client'
import { STALE_TIMES } from '@/lib/constants'
import type { FleetTelemetryCoverageResponse } from '../types'

export const fleetTelemetryKeys = {
  coverage: ['fleet-telemetry', 'coverage'] as const,
}

function normalizeDestinations(destinations: Record<string, number> | null | undefined) {
  const entries = Object.entries(destinations ?? {})
  const aliases = new Set(
    entries.flatMap(([key, value]) => {
      const alias = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
      return alias !== key && destinations?.[alias] === value ? [alias] : []
    }),
  )
  return Object.fromEntries(entries.filter(([key]) => !aliases.has(key)))
}

/**
 * GET /tesla/fleet-telemetry/coverage — per-category routing destination
 * map served by `FleetTelemetryHandler.Coverage`. Destination keys are
 * opaque identifiers: remove the shared client's generated camelCase
 * aliases before consumers enumerate them, retaining the original keys.
 * Missing collections default to empty collections.
 */
export function useFleetTelemetryCoverage() {
  return useQuery({
    queryKey: fleetTelemetryKeys.coverage,
    queryFn: async ({ signal }): Promise<FleetTelemetryCoverageResponse> => {
      const raw = await request<FleetTelemetryCoverageResponse>(
        '/tesla/fleet-telemetry/coverage',
        { signal },
      )
      return {
        categories: (raw.categories ?? []).map(category => ({
          ...category,
          destinations: normalizeDestinations(category.destinations),
        })),
        destination_totals: normalizeDestinations(raw.destination_totals),
        orphan_fields: raw.orphan_fields ?? [],
      }
    },
    staleTime: STALE_TIMES.SLOW,
  })
}
