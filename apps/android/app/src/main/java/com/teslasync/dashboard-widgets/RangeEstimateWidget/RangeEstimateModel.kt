// Pure, framework-free model + projection for the Range Estimate dashboard widget — the native analogue
// of the data the web component derives before returning JSX
// (web/src/features/dashboard/widgets/RangeEstimateWidget.tsx). No Compose, no Android, no HTTP: every
// type here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the composable a thin
// render layer. SI range values (meters) are converted to the user's display unit here, at the single
// render-boundary seam (Phase-48 SI-canonical rule; web `convertDistanceFromSI` + `useUnits`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/RangeEstimateWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located
// supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.rangeestimate

import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

/** Range figures render as whole display units (web `fmtNumber(convertDistanceFromSI(…), 0)`). */
private const val RANGE_DECIMALS = 0

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The web
 * `RangeEstimateWidget` renders the same layout at every footprint (it destructures only `vehicleId`, never
 * `size`), so this type carries no layout branch; it exists only to honour the registry's min/max
 * constraints in the dashboard grid.
 */
data class RangeEstimateSize(
    val cols: Int,
    val rows: Int,
)

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/battery.ts (`range-estimate`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay
 * in lockstep.
 */
object RangeEstimateRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "range-estimate"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "battery"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "RangeEstimateWidget"

    /** Default footprint: 1 column × 2 rows (web `defaultSize`). */
    val defaultSize = RangeEstimateSize(cols = 1, rows = 2)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val minSize = RangeEstimateSize(cols = 1, rows = 2)

    /** Maximum footprint: 2 columns × 40 rows (web `maxSize`). */
    val maxSize = RangeEstimateSize(cols = 2, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: RangeEstimateSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: RangeEstimateSize): RangeEstimateSize =
        RangeEstimateSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * Localized labels the surface folds into its output (web `t('widget.…')` calls). The pure
 * [RangeEstimateProjection] reads these to assemble the TalkBack content description and the empty-state
 * message; the composable additionally renders [ratedRange]/[idealRange] as the visible field labels. The
 * composable builds this from `stringResource`; tests pass a deterministic instance. Keeping i18n out of
 * the projection lets the projection stay a pure, locale-stable function.
 */
data class RangeEstimateStrings(
    val ratedRange: String,
    val idealRange: String,
    val noRange: String,
)

/**
 * The fully projected, render-ready view of the vehicle's range estimate for one footprint — the native
 * analogue of everything the web component computes before returning JSX. Pure data (no Compose types) so
 * the projection is unit-tested without a UI host. Exactly one variant is produced per [VehicleState],
 * mirroring the web's `state ? <ranges> : <EmptyState>` ternary.
 */
sealed interface RangeEstimateDisplay {
    /** A TalkBack phrase folding the whole surface into one announcement. */
    val contentDescription: String

    /**
     * Decodable state (web `state` truthy). Carries the two already-formatted, display-unit figures: the
     * [ratedRangeText] (EPA-rated range) and the [idealRangeText] (ideal/typical range).
     */
    data class Ranges(
        val ratedRangeText: String,
        val idealRangeText: String,
        override val contentDescription: String,
    ) : RangeEstimateDisplay

    /** No decodable state (web `state` undefined ⇒ friendly empty state). */
    data class NoData(
        override val contentDescription: String,
    ) : RangeEstimateDisplay
}

/**
 * Pure projection from a decoded [VehicleState] (or `null`) to the [RangeEstimateDisplay] — the native port
 * of the inline formatting the web component performs in JSX. SI ranges (meters) are converted to the
 * user's display unit via [convertDistanceFromSI]; numbers reproduce the web `fmtNumber(…, 0)` en-US
 * display contract (grouped thousands, zero fraction digits, half-expand rounding) using [Locale.US] so the
 * output is deterministic and matches the web truth.
 */
object RangeEstimateProjection {
    /**
     * Project [state] using the user's [prefs] (distance unit) and the localized [strings]. `null` [state]
     * yields [RangeEstimateDisplay.NoData]; otherwise both the rated and ideal range are converted and
     * formatted, exactly as the web component renders them.
     */
    fun project(
        state: VehicleState?,
        prefs: UnitPref,
        strings: RangeEstimateStrings,
    ): RangeEstimateDisplay {
        if (state == null) return RangeEstimateDisplay.NoData(strings.noRange)
        val ratedText = formatRange(state.ratedRange, prefs)
        val idealText = formatRange(state.idealRange, prefs)
        val description =
            listOf(
                "${strings.ratedRange} $ratedText",
                "${strings.idealRange} $idealText",
            ).joinToString(", ")
        return RangeEstimateDisplay.Ranges(
            ratedRangeText = ratedText,
            idealRangeText = idealText,
            contentDescription = description,
        )
    }

    /**
     * Range magnitude: SI metres → whole display-unit value + label (web
     * `fmtNumber(convertDistanceFromSI(meters ?? 0, unit), 0)} {unit}`). A non-finite SI value is coerced to
     * zero first, reproducing the web `state.<range> ?? 0` guard and `fmtNumber`'s `safeNumber`.
     */
    private fun formatRange(
        meters: Double,
        prefs: UnitPref,
    ): String {
        val safe = if (meters.isFinite()) meters else 0.0
        val value = convertDistanceFromSI(safe, prefs.distance)
        return "${formatNumber(value, RANGE_DECIMALS)} ${prefs.distance.label}"
    }

    /**
     * Locale-stable decimal formatter (web `fmtNumber`): grouped thousands and a fixed number of fraction
     * digits, half-expand rounding. Uses [Locale.US] grouping/decimal symbols so the output is deterministic
     * and matches the web default (which falls back to en-US when no locale is supplied).
     */
    fun formatNumber(
        value: Double,
        decimals: Int,
    ): String = groupedFormat(decimals).format(value)

    private fun groupedFormat(decimals: Int): DecimalFormat {
        val pattern = if (decimals > 0) "#,##0." + "0".repeat(decimals) else "#,##0"
        return DecimalFormat(pattern, DecimalFormatSymbols(Locale.US)).apply {
            // ECMAScript `Intl.NumberFormat` rounds half away from zero (`halfExpand`); match it so the
            // native output equals the web truth instead of Java's default banker's rounding (HALF_EVEN).
            roundingMode = RoundingMode.HALF_UP
        }
    }
}
