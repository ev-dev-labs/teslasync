package io.teslasync.shared.core.presentation.fleettelemetry

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/*
 * The wire shapes of the Fleet-Telemetry routing-coverage snapshot — the cross-platform port of
 * the web `useFleetTelemetry` hook domain's response types (web/src/api/types.ts), served by the
 * Go `FleetTelemetryHandler.Coverage` from `router.LoadMap()` + `teslaconfig.Builder`. Keys arrive
 * snake_case from `GET /api/v1/tesla/fleet-telemetry/coverage`; they are matched verbatim via
 * @SerialName so the cached payload round-trips unchanged.
 *
 * None of these fields is unit-bearing — they are category/field/destination names, integer counts
 * and routing booleans — so every value round-trips verbatim with no SI conversion; display
 * formatting is the render boundary's job (S5).
 */

/**
 * One routed field within a category (web `FleetTelemetryFieldCoverage`): the Tesla [field], the
 * [destination] table it lands in, the optional [column] it maps to, whether it is ALSO mirrored
 * to `signal_log` ([alsoSignalLog]), and whether it is currently [subscribed] in the active
 * routing map.
 */
@Serializable
public data class FleetTelemetryFieldCoverage(
    val field: String = "",
    val destination: String = "",
    val column: String? = null,
    @SerialName("also_signal_log") val alsoSignalLog: Boolean = false,
    val subscribed: Boolean = false,
)

/**
 * One category bucket in the coverage response (web `FleetTelemetryCategoryCoverage`): the
 * [category] name, its [totalFields] count, a per-[destinations] field-count breakdown, and the
 * individual [fields] routed under it.
 */
@Serializable
public data class FleetTelemetryCategoryCoverage(
    val category: String = "",
    @SerialName("total_fields") val totalFields: Int = 0,
    val destinations: Map<String, Int> = emptyMap(),
    val fields: List<FleetTelemetryFieldCoverage> = emptyList(),
)

/**
 * The raw, on-the-wire envelope of `GET /tesla/fleet-telemetry/coverage` BEFORE normalization. The
 * three collection fields are nullable because the backend may omit them or send an explicit
 * `null` (the web type marks `orphan_fields` optional, and any of the three can arrive null), and
 * the web `queryFn` defends every one with `?? []` / `?? {}`. This raw shape preserves that
 * null-vs-present distinction so [FleetTelemetryCoverage.normalize] can reproduce the web
 * coalescing exactly, rather than relying on serializer-specific null coercion that the Windows
 * C# port could not match (ADR-004).
 */
@Serializable
public data class FleetTelemetryCoverageRaw(
    val categories: List<FleetTelemetryCategoryCoverage>? = null,
    @SerialName("destination_totals") val destinationTotals: Map<String, Int>? = null,
    @SerialName("orphan_fields") val orphanFields: List<String>? = null,
)

/**
 * The normalized, consumer-facing coverage snapshot (web's queryFn return shape). Every collection
 * is guaranteed non-null so native screens can iterate without a null guard — the exact contract
 * the web hook hands its consumers after its `?? []` / `?? {}` defaulting.
 *
 * @property categories per-category routing breakdown (never null).
 * @property destinationTotals fleet-wide field-count per destination table (never null).
 * @property orphanFields fields present in the package map but routed nowhere (never null).
 */
public data class FleetTelemetryCoverageResponse(
    val categories: List<FleetTelemetryCategoryCoverage>,
    val destinationTotals: Map<String, Int>,
    val orphanFields: List<String>,
)

/**
 * The lone client-side derivation of the Fleet-Telemetry domain — the port of the web
 * `useFleetTelemetryCoverage` `queryFn` normalization
 * (`{ categories: raw.categories ?? [], destination_totals: raw.destination_totals ?? {},
 * orphan_fields: raw.orphan_fields ?? [] }`). Extracted as a pure, side-effect-free function so the
 * KMP state holder, its golden vectors, and the future Windows C# port all coalesce identically
 * (ADR-004) and can never drift.
 */
public object FleetTelemetryCoverage {
    /**
     * Coalesces a [raw] coverage envelope into the guaranteed-non-null [FleetTelemetryCoverageResponse],
     * defaulting each absent/`null` collection to empty — verbatim with the web `?? []` / `?? {}`. A
     * fully-null [raw] (the defensive "no data" case) yields the all-empty snapshot.
     */
    public fun normalize(raw: FleetTelemetryCoverageRaw?): FleetTelemetryCoverageResponse =
        FleetTelemetryCoverageResponse(
            categories = raw?.categories ?: emptyList(),
            destinationTotals = raw?.destinationTotals ?: emptyMap(),
            orphanFields = raw?.orphanFields ?: emptyList(),
        )
}
