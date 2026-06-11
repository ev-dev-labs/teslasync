// File hosts the BatteryRadialGauge surface's pure model + projection (band, size, registry,
// stat + ring projection, active-vehicle resolution); named after the surface bundle rather than
// a single declaration, so the matching-name heuristic is intentionally relaxed.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets.batteryradialgauge

import io.teslasync.android.components.charts.gaugeFraction
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState

/*
 * Framework-free domain + projection for the BatteryRadialGauge dashboard widget — the native port of
 * everything the web `BatteryRadialGaugeWidget` (web/src/features/dashboard/widgets/
 * BatteryRadialGaugeWidget.tsx) computes before it returns JSX: the `getBatteryColor` threshold band,
 * the `isCompact`/`isLarge` size logic, the `stats` array, and the charge-limit ring geometry. Pure
 * Kotlin (no Android, no Compose, no coroutines) so the band thresholds, the stat list, the ring sweep
 * fraction and the active-vehicle fallback are all unit-tested off device.
 */

/** Percentage shown after each stat value (dimensionless state-of-charge — no SI conversion). */
internal const val BATTERY_PERCENT_UNIT: String = "%"

private const val LEVEL_GREEN_MIN_PCT: Double = 50.0
private const val LEVEL_AMBER_MIN_PCT: Double = 20.0
private const val BATTERY_MAX_PCT: Double = 100.0

/**
 * The state-of-charge color band — the native analogue of the web `getBatteryColor` thresholds
 * (`> 50` green, `> 20` amber, otherwise red) plus an [Unknown] band for the no-state case (web's
 * `#374151` fallback). The render layer maps each band onto a semantic theme color so light/dark and
 * high-contrast all resolve correctly.
 */
enum class BatteryColorBand {
    /** State of charge above 50% (web `#10b981`). */
    Green,

    /** State of charge in (20%, 50%] (web `#f59e0b`). */
    Amber,

    /** State of charge at or below 20% (web `#ef4444`). */
    Red,

    /** No decodable vehicle state — the gauge is not drawn (web `#374151`). */
    Unknown,

    ;

    companion object {
        /** The band for a [level] (0–100) — verbatim parity with the web `getBatteryColor` thresholds. */
        fun forLevel(level: Double): BatteryColorBand =
            when {
                level > LEVEL_GREEN_MIN_PCT -> Green
                level > LEVEL_AMBER_MIN_PCT -> Amber
                else -> Red
            }
    }
}

/**
 * The widget's grid footprint (columns × rows) — the Android port of the web `WidgetProps.size` plus
 * the `isCompact` / `isLarge` branches in `BatteryRadialGaugeWidget.tsx`. [isCompact] hides the title
 * and shrinks the gauge; [isLarge] additionally renders the Level/Limit stat row.
 */
data class BatteryRadialGaugeSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at exactly 1×1 (web `isCompact = size.cols === 1 && size.rows === 1`). */
    val isCompact: Boolean get() = cols == COMPACT_DIM && rows == COMPACT_DIM

    /** True at 2×2 or larger (web `isLarge = size.cols >= 2 && size.rows >= 2`). */
    val isLarge: Boolean get() = cols >= LARGE_MIN_DIM && rows >= LARGE_MIN_DIM

    private companion object {
        const val COMPACT_DIM = 1
        const val LARGE_MIN_DIM = 2
    }
}

/**
 * Canonical registry metadata for the BatteryRadialGauge surface — the native mirror of the web
 * registry entry in `web/src/features/dashboard/widgets/registry/battery.ts`. A dashboard host binds
 * this surface with the same [ID] and honours the same [MIN_SIZE]/[MAX_SIZE] footprint constraints.
 */
object BatteryRadialGaugeRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "battery-radial-gauge"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "battery"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "BatteryRadialGaugeWidget"

    /** Default footprint: 1 column × 2 rows. */
    val DEFAULT_SIZE: BatteryRadialGaugeSize = BatteryRadialGaugeSize(cols = 1, rows = 2)

    /** Minimum footprint: 1 column × 2 rows. */
    val MIN_SIZE: BatteryRadialGaugeSize = BatteryRadialGaugeSize(cols = 1, rows = 2)

    /** Maximum footprint: 3 columns × 40 rows. */
    val MAX_SIZE: BatteryRadialGaugeSize = BatteryRadialGaugeSize(cols = 3, rows = 40)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: BatteryRadialGaugeSize): Boolean =
        size.cols >= MIN_SIZE.cols &&
            size.cols <= MAX_SIZE.cols &&
            size.rows >= MIN_SIZE.rows &&
            size.rows <= MAX_SIZE.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: BatteryRadialGaugeSize): BatteryRadialGaugeSize =
        BatteryRadialGaugeSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/** Which metric a [GaugeStat] represents; the render layer resolves the localized label per kind. */
enum class GaugeStatKind {
    /** Current state of charge (web `t('widget.level')`). */
    Level,

    /** Configured charge limit (web `t('widget.chargeLimit')`). */
    ChargeLimit,
}

/**
 * One projected, render-ready stat shown beneath the gauge on the large footprint — the native analogue
 * of an entry in the web `stats` array. Pure data: [kind] selects the localized label at render time,
 * [value] is the numeric percentage and [unit] its suffix.
 */
data class GaugeStat(
    val kind: GaugeStatKind,
    val value: Double,
    val unit: String,
)

/**
 * The fully projected, render-ready view of the battery gauge for one footprint — the native analogue
 * of everything `BatteryRadialGaugeWidget.tsx` derives before returning JSX. Pure data (no Compose
 * types) so every branch is unit-tested directly.
 *
 * @property hasState whether a vehicle state was decoded (web `state` truthy); when false the surface
 *   renders its empty state instead of the gauge.
 * @property batteryLevel the state of charge 0–100 (web `state?.battery_level ?? 0`).
 * @property chargeLimitSoc the configured charge limit, or `null` when absent (web extended field).
 * @property isCharging whether the vehicle is actively charging (web `state.is_charging`).
 * @property colorBand the threshold band driving the gauge color ([BatteryColorBand.Unknown] when no
 *   state).
 * @property isCompact the 1×1 footprint flag (hides title, shrinks the gauge).
 * @property showTitle whether the header title is shown (web `!isCompact`).
 * @property showStats whether the Level/Limit stat row is shown (web `isLarge`).
 * @property showChargeLimitRing whether the charge-limit overlay arc is drawn (web renders the ring
 *   only when a limit is present and the footprint is not compact).
 * @property chargeLimitRingFraction the `0f..1f` sweep fraction of the limit overlay arc.
 * @property stats the ordered stat list — Level, plus Limit when a charge limit is present.
 */
data class BatteryRadialGaugeDisplay(
    val hasState: Boolean,
    val batteryLevel: Double,
    val chargeLimitSoc: Double?,
    val isCharging: Boolean,
    val colorBand: BatteryColorBand,
    val isCompact: Boolean,
    val showTitle: Boolean,
    val showStats: Boolean,
    val showChargeLimitRing: Boolean,
    val chargeLimitRingFraction: Float,
    val stats: List<GaugeStat>,
)

/**
 * Pure projection from a decoded [VehicleState] (or `null`) to the render-ready [BatteryRadialGaugeDisplay]
 * — the native port of the `getBatteryColor` / `stats` / `isCompact` / `isLarge` / charge-limit-ring work
 * in `BatteryRadialGaugeWidget.tsx`. Side-effect-free so the gate unit-tests it without a device.
 */
object BatteryRadialGaugeProjection {
    /**
     * Project [state] for [size]. [chargeLimitSoc] is the (optional) configured charge limit — the web
     * reads it opportunistically from an extended state payload; pass it through when a caller has it.
     */
    fun project(
        state: VehicleState?,
        chargeLimitSoc: Double?,
        size: BatteryRadialGaugeSize,
    ): BatteryRadialGaugeDisplay {
        val hasState = state != null
        val batteryLevel = state?.batteryLevel?.toDouble() ?: 0.0 // parity:allow numeric conversion call, not an unfinished marker
        val limit = chargeLimitSoc?.takeIf { hasState }
        val showRing = limit != null && !size.isCompact
        return BatteryRadialGaugeDisplay(
            hasState = hasState,
            batteryLevel = batteryLevel,
            chargeLimitSoc = limit,
            isCharging = state?.isCharging ?: false,
            colorBand = if (hasState) BatteryColorBand.forLevel(batteryLevel) else BatteryColorBand.Unknown,
            isCompact = size.isCompact,
            showTitle = !size.isCompact,
            showStats = size.isLarge,
            showChargeLimitRing = showRing,
            chargeLimitRingFraction = if (limit != null) gaugeFraction(limit, BATTERY_MAX_PCT) else 0f,
            stats = buildStats(batteryLevel, limit),
        )
    }

    private fun buildStats(
        batteryLevel: Double,
        chargeLimitSoc: Double?,
    ): List<GaugeStat> =
        buildList {
            add(GaugeStat(GaugeStatKind.Level, batteryLevel, BATTERY_PERCENT_UNIT))
            if (chargeLimitSoc != null) {
                add(GaugeStat(GaugeStatKind.ChargeLimit, chargeLimitSoc, BATTERY_PERCENT_UNIT))
            }
        }
}

/**
 * The active vehicle id the widget reads state for — the native port of the web
 * `id = vehicleId ?? vehicles?.[0]?.id ?? 0`. A positive [preferredVehicleId] wins; otherwise the first
 * enrolled vehicle is used; `null` means neither is available (the surface shows its empty state).
 */
fun resolveVehicleId(
    preferredVehicleId: Long?,
    vehicles: List<Vehicle>?,
): Long? = preferredVehicleId?.takeIf { it > 0L } ?: firstVehicleId(vehicles)

/** The first enrolled vehicle's id, or `null` when the fleet list is absent or empty. */
fun firstVehicleId(vehicles: List<Vehicle>?): Long? = vehicles?.firstOrNull()?.id?.takeIf { it > 0L }
