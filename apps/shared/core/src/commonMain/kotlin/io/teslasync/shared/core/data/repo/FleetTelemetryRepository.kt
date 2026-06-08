package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.fleettelemetry.FleetTelemetryCoverageResponse
import kotlinx.coroutines.flow.Flow

/**
 * The S7 data port for the Fleet-Telemetry routing-coverage snapshot — the cross-platform analogue
 * of the web `useFleetTelemetry` hook domain (web/src/api/hooks/useFleetTelemetry.ts), served by
 * the Go `FleetTelemetryHandler.Coverage`. Every native Fleet-Telemetry surface (Android/Apple via
 * KMP, Windows via the C# port) reaches the backend exclusively through this interface, so a single
 * fake stands in for the whole domain in the S8 state-holder tests.
 *
 * The domain is a single read — `useFleetTelemetry.ts` contains exactly one `useQuery` and no
 * mutations — so [coverage] streams a cache-then-network [Resource] (ADR-013): the cached value
 * first for an instant cold start, then the refreshed value. There is nothing to invalidate here.
 *
 * The emitted [FleetTelemetryCoverageResponse] is already normalized (its three collections are
 * guaranteed non-null), reproducing the web `queryFn`'s `?? []` / `?? {}` coalescing via the pure
 * [io.teslasync.shared.core.presentation.fleettelemetry.FleetTelemetryCoverage.normalize]
 * derivation. The payload is plain routing metadata (category/field/destination names, integer
 * counts, subscription bools) — not display-unit-bearing — so it round-trips verbatim with no SI
 * conversion.
 */
public interface FleetTelemetryRepository {
    /**
     * `GET /tesla/fleet-telemetry/coverage` — the per-category routing destination map (web
     * `useFleetTelemetryCoverage`). Takes no parameters: the snapshot is fleet-wide and
     * package-derived. Each emission carries the normalized, non-null coverage shape.
     */
    public fun coverage(): Flow<Resource<FleetTelemetryCoverageResponse>>
}
