// Pure, framework-free model + projection for the Range Bar dashboard widget — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/dashboard/widgets/RangeBarWidget.tsx). No Compose, no Android, no HTTP: every type
// here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin
// render layer. The vehicle-state ranges arrive as SI metres, so this file owns the decode (web
// optional-chaining → null-safe reads) plus the display-boundary distance conversion (Phase-48
// SI-canonical rule; web `useUnits` + `convertDistanceFromSI`). The EPA-variance ratio is computed from
// the SI magnitudes (a ratio is unit-independent) so it matches the web truth exactly.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/RangeBarWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.rangebar

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import java.util.Locale

/** Rated/ideal range render as whole display units (web `fmtNumber(value, 0)`). */
private const val RANGE_DECIMALS = 0

/** EPA variance renders with one fraction digit (web `fmtNumber(pct, 1)`). */
private const val EPA_DECIMALS = 1

/** Percent scale for the EPA variance ratio (web `… * 100`). */
private const val PERCENT_SCALE = 100.0

/** Floor for the bar denominator so an all-zero payload never divides by zero (web `Math.max(…, 1)`). */
private const val MIN_RANGE_METERS = 1.0

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The web
 * `isCompact = size.cols === 1 && size.rows === 1` test swaps the two-bar comparison for a single big
 * rated-range hero; [isCompact] reproduces it for any footprint at or below one column and one row.
 */
data class RangeBarSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single cell (web `size.cols === 1 && size.rows === 1`): render the compact hero. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_CELLS && rows <= COMPACT_MAX_CELLS

    private companion object {
        const val COMPACT_MAX_CELLS = 1
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/battery.ts (`range-bar`). A dashboard grid host binds this
 * surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay in
 * lockstep.
 */
object RangeBarRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "range-bar"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "battery"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "RangeBarWidget"

    /** Default footprint: 2 columns × 2 rows (web `defaultSize`). */
    val defaultSize = RangeBarSize(cols = 2, rows = 2)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val minSize = RangeBarSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val maxSize = RangeBarSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: RangeBarSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: RangeBarSize): RangeBarSize =
        RangeBarSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * The localized labels the surface folds into its output — the six web `t('widget.…')` keys the
 * component reads. The pure [RangeBarProjection] reads these to assemble each visible string and the
 * TalkBack content descriptions; the composable builds this from `stringResource`, while tests pass a
 * deterministic instance. Keeping i18n out of the projection lets it stay a pure, locale-stable function.
 */
data class RangeBarStrings(
    val range: String,
    val rated: String,
    val ratedRange: String,
    val idealRange: String,
    val epaComparison: String,
    val noRange: String,
)

/**
 * The decoded vehicle-state ranges reduced to the two fields the web component reads (`rated_range`,
 * `ideal_range`), in SI metres. A `null` state (web `state?.… ?? 0`) collapses to [EMPTY]. [hasData]
 * mirrors the web `hasData = state != null && (rated > 0 || ideal > 0)` gate: a present state whose
 * ranges are both zero still shows the friendly empty state rather than two empty bars.
 */
data class RangeBarData(
    val present: Boolean,
    val ratedMeters: Double,
    val idealMeters: Double,
) {
    /** Web `state != null && (rated > 0 || ideal > 0)` — drives the empty-state gate. */
    val hasData: Boolean get() = present && (ratedMeters > 0.0 || idealMeters > 0.0)

    companion object {
        /** The "no decodable state" snapshot, surfaced for a null state (web `state: undefined`). */
        val EMPTY = RangeBarData(present = false, ratedMeters = 0.0, idealMeters = 0.0)
    }
}

/**
 * The fully projected, render-ready view of the vehicle's range for one footprint — the native analogue
 * of everything the web component computes before returning JSX. Pure data (no Compose types) so the
 * projection is unit-tested without a UI host. Carries both the compact-hero fields and the standard
 * two-bar fields; the composable renders one set per [isCompact], or the [emptyMessage] when [hasData] is
 * false. Bar tints are resolved at the Compose boundary (the web `#22d3ee` / `#a78bfa` map onto the
 * design-token chart palette), keeping this layer free of UI types.
 */
data class RangeBarDisplay(
    val hasData: Boolean,
    val isCompact: Boolean,
    val title: String,
    val distanceUnitLabel: String,
    val compactRatedValue: Double,
    val compactValueText: String,
    val compactUnitLabel: String,
    val compactContentDescription: String,
    val ratedValue: Double,
    val idealValue: Double,
    val maxValue: Double,
    val ratedLabel: String,
    val idealLabel: String,
    val ratedSublabel: String,
    val idealSublabel: String,
    val epaVisible: Boolean,
    val epaLabel: String,
    val epaValueText: String,
    val standardContentDescription: String,
    val emptyMessage: String,
)

/**
 * Decodes a [VehicleState] (or `null`) into a [RangeBarData] in SI metres — reproducing the web
 * optional-chaining (`state?.rated_range ?? 0`). A `null` state yields [RangeBarData.EMPTY]; otherwise the
 * SI `rated_range` / `ideal_range` magnitudes are carried through verbatim for display conversion.
 */
fun parseRangeState(state: VehicleState?): RangeBarData =
    if (state == null) {
        RangeBarData.EMPTY
    } else {
        RangeBarData(present = true, ratedMeters = state.ratedRange, idealMeters = state.idealRange)
    }

/**
 * Pure projection from a decoded [VehicleState] (or `null`) to the render-ready [RangeBarDisplay] — the
 * native port of the inline derivations + JSX formatting in the web source. SI metres are converted to the
 * user's display unit at this boundary (web `toDistanceDisplay` = `convertDistanceFromSI(value, prefs.distance)`);
 * numbers are formatted via the shared [ChartFormat] (web `fmtNumber`). [locale] drives the grouping/
 * separators (tests pin [Locale.US]).
 */
object RangeBarProjection {
    /**
     * Project [state] for [size] using the user's display [prefs] (distance unit), the localized
     * [strings], and [locale] for number grouping. The result carries every visible string + the folded
     * TalkBack content descriptions so the composable stays a pure render layer.
     */
    fun project(
        state: VehicleState?,
        size: RangeBarSize,
        prefs: UnitPref,
        strings: RangeBarStrings,
        locale: Locale = Locale.US,
    ): RangeBarDisplay {
        val data = parseRangeState(state)
        val unit = prefs.distance
        val unitLabel = unit.label
        val ratedConverted = convertDistanceFromSI(data.ratedMeters, unit)
        val idealConverted = convertDistanceFromSI(data.idealMeters, unit)
        val maxMeters = maxOf(data.ratedMeters, data.idealMeters, MIN_RANGE_METERS)
        val maxConverted = convertDistanceFromSI(maxMeters, unit)

        val ratedText = ChartFormat.number(ratedConverted, RANGE_DECIMALS, locale)
        val idealText = ChartFormat.number(idealConverted, RANGE_DECIMALS, locale)
        val ratedSublabel = "$ratedText $unitLabel"
        val idealSublabel = "$idealText $unitLabel"
        val compactUnitLabel = "$unitLabel ${strings.rated}"

        val epaVisible = data.ratedMeters > 0.0 && data.idealMeters > 0.0
        val epaValueText = if (epaVisible) epaVariance(data.ratedMeters, data.idealMeters, locale) else ""

        return RangeBarDisplay(
            hasData = data.hasData,
            isCompact = size.isCompact,
            title = strings.range,
            distanceUnitLabel = unitLabel,
            compactRatedValue = ratedConverted,
            compactValueText = ratedText,
            compactUnitLabel = compactUnitLabel,
            compactContentDescription = "$ratedText $compactUnitLabel",
            ratedValue = ratedConverted,
            idealValue = idealConverted,
            maxValue = maxConverted,
            ratedLabel = strings.ratedRange,
            idealLabel = strings.idealRange,
            ratedSublabel = ratedSublabel,
            idealSublabel = idealSublabel,
            epaVisible = epaVisible,
            epaLabel = strings.epaComparison,
            epaValueText = epaValueText,
            standardContentDescription =
                standardDescription(strings, ratedSublabel, idealSublabel, epaVisible, epaValueText),
            emptyMessage = strings.noRange,
        )
    }

    /**
     * The signed EPA-variance percentage (web `${ideal >= rated ? '+' : ''}${fmtNumber(((ideal - rated) /
     * rated) * 100, 1)}%`). Computed from the SI magnitudes because a ratio is unit-independent, so the
     * result is identical to the web truth regardless of the user's distance unit. A leading `+` is added
     * when ideal ≥ rated; a negative value already carries its own `-`.
     */
    fun epaVariance(
        ratedMeters: Double,
        idealMeters: Double,
        locale: Locale = Locale.US,
    ): String {
        val pct = ((idealMeters - ratedMeters) / ratedMeters) * PERCENT_SCALE
        val sign = if (idealMeters >= ratedMeters) "+" else ""
        return "$sign${ChartFormat.number(pct, EPA_DECIMALS, locale)}%"
    }

    /** Folds the two bars (+ optional EPA variance) into one TalkBack phrase for the standard layout. */
    private fun standardDescription(
        strings: RangeBarStrings,
        ratedSublabel: String,
        idealSublabel: String,
        epaVisible: Boolean,
        epaValueText: String,
    ): String {
        val parts =
            buildList {
                add("${strings.ratedRange} $ratedSublabel")
                add("${strings.idealRange} $idealSublabel")
                if (epaVisible) add("${strings.epaComparison} $epaValueText")
            }
        return parts.joinToString(", ")
    }
}
