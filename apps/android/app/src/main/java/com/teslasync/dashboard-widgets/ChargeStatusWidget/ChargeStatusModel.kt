// Pure, framework-free model + projection for the Charge Status dashboard widget — the native analogue
// of the data the web component derives before returning JSX
// (web/src/features/dashboard/widgets/ChargeStatusWidget.tsx). No Compose, no Android, no HTTP: every
// type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer. SI values (meters, m·h⁻¹) are converted to the user's display unit here, at the
// single render-boundary seam (Phase-48 SI-canonical rule; web `convertDistanceFromSI` + `useUnits`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/ChargeStatusWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located
// supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.chargestatus

import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

private const val EM_DASH = "\u2014"
private const val MIDDLE_DOT = "\u00b7"

/** Default `fmtNumber` precision — the web `numberFormat` global precision default (`_globalPrecision = 2`). */
private const val DEFAULT_PRECISION = 2

/** Time-to-full is rendered with one decimal (web `fmtNumber(state.time_to_full_charge, 1)`). */
private const val TIME_TO_FULL_DECIMALS = 1

/** Distance figures (charge rate, rated range) render as whole units (web `fmtInt` / `fmtNumber(…, 0)`). */
private const val DISTANCE_DECIMALS = 0

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The web
 * `ChargeStatusWidget` renders the same layout at every footprint (it destructures only `vehicleId`, never
 * `size`), so this type carries no layout branch; it exists only to honour the registry's min/max
 * constraints in the dashboard grid.
 */
data class ChargeStatusSize(
    val cols: Int,
    val rows: Int,
)

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/charging.ts (`charge-status`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay
 * in lockstep.
 */
object ChargeStatusRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "charge-status"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "charging"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "ChargeStatusWidget"

    /** Default footprint: 2 columns × 2 rows (web `defaultSize`). */
    val defaultSize = ChargeStatusSize(cols = 2, rows = 2)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val minSize = ChargeStatusSize(cols = 1, rows = 2)

    /** Maximum footprint: 3 columns × 40 rows (web `maxSize`). */
    val maxSize = ChargeStatusSize(cols = 3, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: ChargeStatusSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: ChargeStatusSize): ChargeStatusSize =
        ChargeStatusSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * Localized labels the surface folds into its output (web `t('widget.…')` calls). The pure
 * [ChargeStatusProjection] reads these to assemble each row's TalkBack content description; the composable
 * additionally renders them as the visible field labels. The composable builds this from `stringResource`;
 * tests pass a deterministic instance. Keeping i18n out of the projection lets the projection stay a pure,
 * locale-stable function.
 */
data class ChargeStatusStrings(
    val charging: String,
    val power: String,
    val rate: String,
    val battery: String,
    val timeToFull: String,
    val notCharging: String,
    val noChargeData: String,
)

/**
 * The fully projected, render-ready view of the vehicle's charge state for one footprint — the native
 * analogue of everything the web component computes before returning JSX. Pure data (no Compose types) so
 * the projection is unit-tested without a UI host. Exactly one variant is produced per [VehicleState],
 * mirroring the web's `is_charging ? … : state ? … : EmptyState` ternary.
 */
sealed interface ChargeStatusDisplay {
    /** A TalkBack phrase folding the whole surface into one announcement. */
    val contentDescription: String

    /**
     * Active charge session (web `state.is_charging`). Carries the four already-formatted, display-unit
     * grid values: charger [powerText] (kW), charge [rateText] (distance/h), [batteryText] (%), and
     * [timeToFullText] (hours, or an em-dash when not yet known).
     */
    data class Charging(
        val powerText: String,
        val rateText: String,
        val batteryText: String,
        val timeToFullText: String,
        override val contentDescription: String,
    ) : ChargeStatusDisplay

    /**
     * Parked / idle (web `state` truthy but not charging). Carries the [batteryText] (%) and rated
     * [rangeText] (display distance) plus the combined "{battery} · {range}" [summaryText] the web renders.
     */
    data class NotCharging(
        val batteryText: String,
        val rangeText: String,
        val summaryText: String,
        override val contentDescription: String,
    ) : ChargeStatusDisplay

    /** No decodable state (web `state` undefined ⇒ friendly empty state). */
    data class NoData(
        override val contentDescription: String,
    ) : ChargeStatusDisplay
}

/**
 * Pure projection from a decoded [VehicleState] (or `null`) to the [ChargeStatusDisplay] — the native port
 * of the inline formatting the web component performs in JSX. SI distances are converted to the user's
 * display unit via [convertDistanceFromSI]; numbers reproduce the web `fmtNumber`/`fmtInt` en-US display
 * contract (grouped thousands, fixed fraction digits, half-expand rounding) using [Locale.US] so the output
 * is deterministic and matches the web truth.
 */
object ChargeStatusProjection {
    /**
     * Project [state] using the user's [prefs] (distance unit + precision) and the localized [strings].
     * `null` [state] yields [ChargeStatusDisplay.NoData]; otherwise the charging / not-charging branch is
     * chosen by [VehicleState.isCharging], exactly as the web ternary does.
     */
    fun project(
        state: VehicleState?,
        prefs: UnitPref,
        strings: ChargeStatusStrings,
    ): ChargeStatusDisplay {
        if (state == null) return ChargeStatusDisplay.NoData(strings.noChargeData)
        return if (state.isCharging) charging(state, prefs, strings) else notCharging(state, prefs, strings)
    }

    private fun charging(
        state: VehicleState,
        prefs: UnitPref,
        strings: ChargeStatusStrings,
    ): ChargeStatusDisplay.Charging {
        val powerText = "${formatNumber(state.chargerPower, powerDecimals(prefs))} kW"
        val rateText = "${formatDistance(state.chargeRate, prefs)}/h"
        val batteryText = "${state.batteryLevel}%"
        val timeToFullText =
            if (state.timeToFullCharge > 0) {
                "${formatNumber(state.timeToFullCharge, TIME_TO_FULL_DECIMALS)}h"
            } else {
                EM_DASH
            }
        val description =
            listOf(
                strings.charging,
                "${strings.power} $powerText",
                "${strings.rate} $rateText",
                "${strings.battery} $batteryText",
                "${strings.timeToFull} $timeToFullText",
            ).joinToString(", ")
        return ChargeStatusDisplay.Charging(
            powerText = powerText,
            rateText = rateText,
            batteryText = batteryText,
            timeToFullText = timeToFullText,
            contentDescription = description,
        )
    }

    private fun notCharging(
        state: VehicleState,
        prefs: UnitPref,
        strings: ChargeStatusStrings,
    ): ChargeStatusDisplay.NotCharging {
        val batteryText = "${state.batteryLevel}%"
        val rangeText = formatDistance(state.ratedRange, prefs)
        val summaryText = "$batteryText $MIDDLE_DOT $rangeText"
        return ChargeStatusDisplay.NotCharging(
            batteryText = batteryText,
            rangeText = rangeText,
            summaryText = summaryText,
            contentDescription = "${strings.notCharging}, $summaryText",
        )
    }

    /**
     * Distance/rate magnitude: SI metres (or metres-per-hour) → whole display-unit value + label
     * (web `fmtInt(convertDistanceFromSI())` for the rate, `fmtNumber(convertDistanceFromSI(), 0)` for the
     * rated range — both render zero fraction digits, so they share one helper).
     */
    private fun formatDistance(
        meters: Double,
        prefs: UnitPref,
    ): String {
        val value = convertDistanceFromSI(meters, prefs.distance)
        return "${formatNumber(value, DISTANCE_DECIMALS)} ${prefs.distance.label}"
    }

    /** The power figure's precision: the user's `decimal_precision` setting, else the web default of 2. */
    private fun powerDecimals(prefs: UnitPref): Int = prefs.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION

    /**
     * Locale-stable decimal formatter (web `fmtNumber`): grouped thousands and a fixed number of fraction
     * digits, half-expand rounding. Uses [Locale.US] grouping/decimal symbols so the output is deterministic
     * and matches the web default (which falls back to en-US when no locale is supplied).
     */
    fun formatNumber(
        value: Double,
        decimals: Int,
    ): String = groupedFormat(decimals).format(value)

    /** Locale-stable integer formatter (web `fmtInt`). */
    fun formatInt(value: Double): String = groupedFormat(decimals = 0).format(value)

    private fun groupedFormat(decimals: Int): DecimalFormat {
        val pattern = if (decimals > 0) "#,##0." + "0".repeat(decimals) else "#,##0"
        return DecimalFormat(pattern, DecimalFormatSymbols(Locale.US)).apply {
            // ECMAScript `Intl.NumberFormat` rounds half away from zero (`halfExpand`); match it so the
            // native output equals the web truth instead of Java's default banker's rounding (HALF_EVEN).
            roundingMode = RoundingMode.HALF_UP
        }
    }
}
