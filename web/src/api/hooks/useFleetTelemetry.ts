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

/**
 * GET /tesla/fleet-telemetry/coverage — per-category routing destination
 * map served by `FleetTelemetryHandler.Coverage`. The response is
 * already typed snake_case (matching the Go struct's JSON tags) so the
 * hook just forwards it; the only normalization is defaulting
 * `orphan_fields` to an empty array so consumers can iterate without a
 * null guard.
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
        categories: raw.categories ?? [],
        destination_totals: raw.destination_totals ?? {},
        orphan_fields: raw.orphan_fields ?? [],
      }
    },
    staleTime: STALE_TIMES.SLOW,
  })
}
