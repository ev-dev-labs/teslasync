// Pure, framework-free model + projection for the BatteryComparison feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/vehicles/components/BatteryComparison.tsx). No Compose, no Android framework, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web component takes the enrolled-vehicle list, runs ONE aggregating `useQuery` that fetches each
// vehicle's state (`fetchVehicleState(id)`, per-vehicle errors swallowed to a `null` state), keeps only the
// vehicles whose state resolved (`bars = allStates.filter(q => q.state !== null)`), and — for each bar —
// renders the name (`display_name || vin`), a meter whose fill is `${level}%` tinted by `batteryColor(level)`,
// the `{level}%` label, and `formatDistance(rated_range)`. The two derivations the web performs before JSX —
// the `batteryColor` band and the bar width — live here as the pure [BatteryComparisonProjection]; the SI
// `rated_range` stays in metres and is converted only at the render boundary (Phase-48 SI-canonical rule).
//
// `batteryColor` (web/src/lib/colors.ts) is STRICTLY greater-than and uses different cutoffs from the
// weekly-digest BatteryPill's `STATUS_COLORS` (`>=60`/`>=30`): here `level > 60` is good, `level > 25` is
// warning, else critical. The composable maps each band onto the per-theme `TeslaTokens.status` palette
// (P1/S9), whose success/warning/danger values are exactly the web `#10b981` / `#f59e0b` / `#ef4444` hexes.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/BatteryComparison — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling FleetStatsBar / SecurityStatusCards surfaces
// do. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.batterycomparison

import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.diagnostics.Logger

/** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
const val BATTERY_COMPARISON_SLUG: String = "BatteryComparison"

/**
 * The state-of-charge colour band — the native analogue of the web `batteryColor(level)` ternary
 * (web/src/lib/colors.ts): `level > 60 ? GOOD : level > 25 ? WARN : BAD`. The comparisons are STRICTLY
 * greater-than (unlike the weekly-digest BatteryPill's inclusive `>=` cutoffs), so the exact threshold values
 * land in the LOWER band. The composable maps each band onto the per-theme `TeslaTokens.status` palette
 * (P1/S9), whose success/warning/danger values are exactly the web `#10b981` / `#f59e0b` / `#ef4444` hexes.
 */
enum class BatteryBand {
    Good,
    Warning,
    Critical,
    ;

    companion object {
        /** Web `level > 60`: above this the charge is healthy (green). */
        const val GOOD_THRESHOLD: Int = 60

        /** Web `level > 25`: above this (but at or below [GOOD_THRESHOLD]) the charge is a warning (amber). */
        const val WARNING_THRESHOLD: Int = 25

        /**
         * Classify a 0–100 [level] into its band. The comparisons are exclusive (`>`), matching the web
         * `batteryColor` ternary, so the exact threshold values land in the lower band (e.g. `60` is a
         * warning, `25` is critical).
         */
        fun fromLevel(level: Int): BatteryBand =
            when {
                level > GOOD_THRESHOLD -> Good
                level > WARNING_THRESHOLD -> Warning
                else -> Critical
            }
    }
}

/**
 * One vehicle's raw battery reading — the native mirror of a web `{ vehicle, state }` query entry. [state] is
 * `null` when the vehicle's state fetch failed or carried no decodable state (the web per-vehicle `catch`
 * returning `state: null`), which excludes the vehicle from the rendered bars.
 *
 * @property vehicleId the enrolled-vehicle id (web `vehicle.id`); the row key.
 * @property name the already-resolved display label (`display_name || vin`).
 * @property state the vehicle's last-known state, or `null` when none resolved.
 */
data class VehicleBatteryReading(
    val vehicleId: Long,
    val name: String,
    val state: VehicleState?,
)

/**
 * The fully projected, render-ready bar — the native analogue of everything the web component computes for one
 * `bars` entry before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a
 * UI host. [rangeMeters] stays SI; the composable converts it at the display boundary via the live
 * `UnitFormatter` (the web `formatDistance` boundary).
 *
 * @property vehicleId the row key (web `vehicle.id`).
 * @property name the bar label (web `vehicle.display_name || vehicle.vin`).
 * @property level the 0–100 state of charge rendered as the `{level}%` value (web `state.battery_level ?? 0`).
 * @property band the colour band (web `batteryColor`) driving the meter-fill tint.
 * @property barFraction the meter fill as a 0..1 fraction — the web `${level}%` width, clamped so an
 *   out-of-range level renders a full/empty bar instead of an overflowing/negative one.
 * @property rangeMeters the SI rated range in metres (web `state.rated_range ?? 0`), formatted at render.
 */
data class BatteryComparisonRow(
    val vehicleId: Long,
    val name: String,
    val level: Int,
    val band: BatteryBand,
    val barFraction: Float,
    val rangeMeters: Double,
)

/**
 * Pure projection from raw [VehicleBatteryReading]s to render-ready [BatteryComparisonRow]s — a 1:1 port of
 * the derivations the web component performs (the `bars` null-state filter, the `batteryColor` band, and the
 * `${level}%` meter width) before returning JSX. Stateless and side-effect-free so it is fully covered by the
 * off-device unit gate.
 */
object BatteryComparisonProjection {
    private const val BAR_MIN: Int = 0
    private const val BAR_MAX: Int = 100
    private const val PERCENT_SUFFIX: String = "%"

    /**
     * Project the loaded [readings] into render-ready rows, dropping every vehicle whose state did not resolve
     * — the web `bars = allStates.filter(q => q.state !== null)`. Input order is preserved (web `map`).
     */
    fun project(readings: List<VehicleBatteryReading>): List<BatteryComparisonRow> =
        readings.mapNotNull { reading -> reading.state?.let { row(reading.vehicleId, reading.name, it) } }

    /** Project one resolved [state] into its render-ready row. */
    fun row(
        vehicleId: Long,
        name: String,
        state: VehicleState,
    ): BatteryComparisonRow {
        val level = state.batteryLevel.toInt()
        return BatteryComparisonRow(
            vehicleId = vehicleId,
            name = name,
            level = level,
            band = BatteryBand.fromLevel(level),
            barFraction = barFraction(level),
            rangeMeters = state.ratedRange,
        )
    }

    /** The bar label — web `vehicle.display_name || vehicle.vin`: the display name, falling back to the VIN. */
    fun displayName(
        displayName: String,
        vin: String,
    ): String = displayName.ifBlank { vin }

    /** The meter fill as a 0..1 fraction — the web `${level}%` width, clamped to `[0, 100] / 100`. */
    fun barFraction(level: Int): Float = level.coerceIn(BAR_MIN, BAR_MAX).toFloat() / BAR_MAX

    /** The value text the web renders, `{level}%` — the raw level (web `?? 0`) followed by a percent sign. */
    fun percentLabel(level: Int): String = "$level$PERCENT_SUFFIX"

    /** True when no vehicle resolved a state — the web `bars.length === 0` (which returns `null`). */
    fun isEmpty(rows: List<BatteryComparisonRow>): Boolean = rows.isEmpty()
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a vehicle
 * name, VIN, battery level, or range — so a diagnostics line can never leak the fleet's charge posture.
 */
object BatteryComparisonDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = BATTERY_COMPARISON_SLUG

    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
