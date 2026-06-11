// File hosts the BatteryGauge surface's pure model + projection + registry metadata; named after the
// surface bundle (BatteryGaugeWidget*) rather than the single declaration it leads with.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState

/** The em dash shown wherever a value is unknown (matches the shared formatter fallback). */
internal const val BATTERY_GAUGE_EM_DASH: String = "\u2014"

/**
 * The widget's grid footprint (columns × rows) — the Android port of the web `WidgetProps.size` and
 * the `isCompact` branch in `web/src/features/dashboard/widgets/BatteryGaugeWidget.tsx`
 * (`size.cols === 1 && size.rows === 1`). The compact layout shrinks the gauge and, exactly like the
 * web `WidgetGaugeHero` (`!compact && children`), hides the "Charging" indicator.
 */
data class BatteryGaugeSize(
    val cols: Int,
    val rows: Int,
) {
    /** True only at a 1×1 footprint (verbatim web `isCompact`); a smaller gauge with no charging line. */
    val isCompact: Boolean get() = cols == COMPACT_COLS && rows == COMPACT_ROWS

    private companion object {
        const val COMPACT_COLS = 1
        const val COMPACT_ROWS = 1
    }
}

/**
 * Canonical registry metadata for the Battery Level surface — the native mirror of the web registry
 * entry `battery-gauge` in `web/src/features/dashboard/widgets/registry/battery.ts`. A dashboard host
 * binds this surface with the same [ID] and honours the same [MIN_SIZE]/[MAX_SIZE] footprint bounds.
 */
object BatteryGaugeRegistration {
    /** Stable registry id (matches the web registry `battery-gauge`). */
    const val ID: String = "battery-gauge"

    /** Widget category (matches the web registry `battery`). */
    const val CATEGORY: String = "battery"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "BatteryGaugeWidget"

    /** Default footprint: 1 column × 2 rows. */
    val DEFAULT_SIZE: BatteryGaugeSize = BatteryGaugeSize(cols = 1, rows = 2)

    /** Minimum footprint: 1 column × 2 rows. */
    val MIN_SIZE: BatteryGaugeSize = BatteryGaugeSize(cols = 1, rows = 2)

    /** Maximum footprint: 2 columns × 40 rows. */
    val MAX_SIZE: BatteryGaugeSize = BatteryGaugeSize(cols = 2, rows = 40)

    /** True when [size] falls within the min/max footprint constraints. */
    fun isWithinBounds(size: BatteryGaugeSize): Boolean =
        size.cols >= MIN_SIZE.cols &&
            size.cols <= MAX_SIZE.cols &&
            size.rows >= MIN_SIZE.rows &&
            size.rows <= MAX_SIZE.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: BatteryGaugeSize): BatteryGaugeSize =
        BatteryGaugeSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/**
 * The state-of-charge band that selects the gauge color — the semantic, theme-mappable port of the web
 * `batteryColor()` thresholds (`> 50` green, `> 20` amber, else red; no state ⇒ neutral). Kept as a
 * pure enum so the threshold logic is unit-tested off-device and the render layer maps the band onto a
 * design token (P1/S9) instead of a hard-coded hex.
 */
enum class BatteryStatusLevel {
    /** State of charge above 50% — web `#10b981` (maps to `status.success`). */
    Good,

    /** State of charge in (20%, 50%] — web `#f59e0b` (maps to `status.warning`). */
    Warning,

    /** State of charge at or below 20% — web `#ef4444` (maps to `status.danger`). */
    Critical,

    /** No decodable vehicle state — web `#374151` (maps to a neutral track color). */
    Unknown,
}

/**
 * The fully projected, render-ready battery reading for one vehicle — the native analogue of the values
 * the web component reads off `state` before drawing the gauge: the [batteryLevel] percentage (the
 * gauge value, web `state.battery_level`), whether the pack [isCharging] (web `state.is_charging`,
 * gating the "⚡ Charging" line), and the derived [statusLevel] band that picks the gauge color. Pure
 * data — no Compose types — so it is unit-tested directly.
 *
 * @property batteryLevel the state of charge as a whole-number percentage (0–100), clamped for display.
 * @property isCharging whether the vehicle is actively charging (drives the charging indicator).
 * @property statusLevel the [BatteryStatusLevel] band the gauge color is selected from.
 */
data class BatteryGaugeSnapshot(
    val batteryLevel: Int,
    val isCharging: Boolean,
    val statusLevel: BatteryStatusLevel,
) {
    /** The gauge sweep value (the SoC percentage as a Double), for the radial gauge `value`. */
    val gaugeValue: Double get() = batteryLevel.toDouble() // parity:allow toDouble() trips the case-insensitive stub-word scan

    companion object {
        /** The gauge maximum — state of charge is always a percentage of 100 (web `max={100}`). */
        const val GAUGE_MAX: Double = 100.0

        /** The gauge unit suffix shown after the value (web `unit="%"`). */
        const val GAUGE_UNIT: String = "%"
    }
}

/**
 * Framework-free domain projection for the BatteryGauge surface — the native port of the small amount of
 * logic the web `BatteryGaugeWidget` runs before it renders JSX: the default-vehicle resolution
 * (`vehicleId ?? vehicles?.[0]?.id ?? 0`), the `batteryColor()` threshold bands, and reading
 * `battery_level` / `is_charging` off the normalised state. Pure Kotlin (no Android, no Compose, no
 * coroutines) so every branch is unit-tested without a device.
 */
object BatteryGaugeProjection {
    /** Above this SoC the band is [BatteryStatusLevel.Good] (web `state.battery_level > 50`). */
    const val GOOD_THRESHOLD: Long = 50

    /** Above this SoC (and at or below [GOOD_THRESHOLD]) the band is [BatteryStatusLevel.Warning]. */
    const val WARNING_THRESHOLD: Long = 20

    /** The fallback vehicle id when neither an explicit id nor an enrolled vehicle is available. */
    const val NO_VEHICLE_ID: Long = 0

    private const val MIN_PERCENT: Int = 0
    private const val MAX_PERCENT: Int = 100

    /**
     * Resolve the vehicle whose state the gauge shows — the verbatim web precedence
     * `vehicleId ?? vehicles?.[0]?.id ?? 0`: an explicit [explicitVehicleId] wins, else the first
     * enrolled vehicle's id, else [NO_VEHICLE_ID] (for which the backend returns no state ⇒ empty).
     */
    fun resolveVehicleId(
        explicitVehicleId: Long?,
        vehicles: List<Vehicle>?,
    ): Long = explicitVehicleId ?: vehicles?.firstOrNull()?.id ?: NO_VEHICLE_ID

    /**
     * The [BatteryStatusLevel] band for a [batteryLevel] SoC percentage — the web `batteryColor()`
     * thresholds with identical strict comparisons (50 ⇒ Warning, 20 ⇒ Critical).
     */
    fun statusLevelFor(batteryLevel: Long): BatteryStatusLevel =
        when {
            batteryLevel > GOOD_THRESHOLD -> BatteryStatusLevel.Good
            batteryLevel > WARNING_THRESHOLD -> BatteryStatusLevel.Warning
            else -> BatteryStatusLevel.Critical
        }

    /**
     * Project a normalised [state] into a render-ready [BatteryGaugeSnapshot], or `null` when there is no
     * decodable state — the web `state ? <gauge/> : <EmptyState/>` branch. The percentage is clamped to
     * 0–100 for the gauge sweep while the band is computed from the raw value (web parity).
     */
    fun snapshotOf(state: VehicleState?): BatteryGaugeSnapshot? {
        if (state == null) return null
        return BatteryGaugeSnapshot(
            batteryLevel = state.batteryLevel.coerceIn(MIN_PERCENT.toLong(), MAX_PERCENT.toLong()).toInt(),
            isCharging = state.isCharging,
            statusLevel = statusLevelFor(state.batteryLevel),
        )
    }
}
