// Pure, framework-free model + projection for the Projected Range dashboard widget — the native analogue
// of everything the web component derives before returning JSX
// (web/src/features/dashboard/widgets/ProjectedRangeWidget.tsx). No Compose, no Android, no HTTP: every
// type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer. The Helix projected-range feed arrives as raw JSON
// (`/vehicles/{id}/battery/projected-range`) carrying kilometre rollups, so this file owns the decode
// (web optional-chaining → null-safe reads) plus the display-boundary distance conversion (Phase-48
// SI-canonical rule; web `useUnits` + `convertDistanceFromSI`), the health-band badge heuristic, the
// projected-vs-EPA comparison ratio, and the range-factors list.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/ProjectedRangeWidget — the P3 prompt's allowed-files path) cannot form
// a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.projectedrange

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale
import kotlin.math.floor
import kotlin.math.min

/** Em dash shown for an absent projected/EPA range (web `'—'`). */
private const val EM_DASH = "\u2014"

/** 1 km = 1000 m — scales the backend's kilometre rollup to SI metres for `convertDistanceFromSI`. */
private const val METERS_PER_KM = 1000.0

/** Range hero precision (web `Math.round(projectedRange)` + `fmtNumber(epaRange, 0)`). */
private const val WHOLE_DECIMALS = 0

/** Health-score / percent-of-EPA badge precision (web `fmtNumber(healthScore ?? 0, 0)`). */
private const val SCORE_DECIMALS = 0

/** Degradation / capacity factor precision (web `fmtNumber(…, 1)`). */
private const val PERCENT_DECIMALS = 1

/** Percent scale for the projected/EPA ratio (web `* 100`). */
private const val PERCENT_SCALE = 100.0

/** Upper clamp for the comparison bar (web `Math.min(100, …)`). */
private const val RANGE_PCT_MAX = 100

/** Half-up rounding bias reproducing JavaScript `Math.round` for non-negative values. */
private const val ROUND_HALF = 0.5

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The
 * `isCompact` branch reproduces the web `isCompact = size.cols <= 1` test that swaps the standard
 * range + comparison body for the single big-number hero; `isWide` mirrors the web `isWide =
 * size.cols >= 3` test that adds the range-factors list beneath the comparison bar.
 */
data class ProjectedRangeSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `isCompact = size.cols <= 1`): render the compact range hero. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    /** True at three or more columns (web `isWide = size.cols >= 3`): add the range-factors list. */
    val isWide: Boolean get() = cols >= WIDE_MIN_COLS

    private companion object {
        const val COMPACT_MAX_COLS = 1
        const val WIDE_MIN_COLS = 3
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/battery.ts (`projected-range`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay
 * in lockstep.
 */
object ProjectedRangeRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "projected-range"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "battery"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "ProjectedRangeWidget"

    /** Default footprint: 2 columns × 2 rows (web `defaultSize`). */
    val defaultSize = ProjectedRangeSize(cols = 2, rows = 2)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val minSize = ProjectedRangeSize(cols = 1, rows = 2)

    /** Maximum footprint: 3 columns × 40 rows (web `maxSize`). */
    val maxSize = ProjectedRangeSize(cols = 3, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: ProjectedRangeSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: ProjectedRangeSize): ProjectedRangeSize =
        ProjectedRangeSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * The decoded `/vehicles/{id}/battery/projected-range` payload reduced to the seven fields the web
 * component reads. Distances are kilometres on the wire; the SI conversion happens in
 * [ProjectedRangeProjection]. The web treats `current_range_km` / `new_range_km` / `avg_daily_km` /
 * `health_score` as nullable (its `!= null` / `?? null` checks) and the remaining percent/cycle fields
 * as `?? 0`; this decode preserves that distinction so the projection reproduces the web em-dash + badge
 * gates exactly.
 *
 * [present] mirrors the web `data ? … : <EmptyState />` gate: the surface shows content whenever the
 * request resolved a payload (even an all-null one), and the friendly empty state only when no payload
 * exists (no vehicle resolved, or a null body).
 */
data class ProjectedRangeData(
    val present: Boolean,
    val currentRangeKm: Double?,
    val newRangeKm: Double?,
    val avgDailyKm: Double?,
    val healthScore: Double?,
    val degradationPct: Double,
    val currentCapacityPct: Double,
    val totalCycles: Double,
) {
    /** Web `data ? … : empty` — drives the empty-state gate. */
    val hasData: Boolean get() = present

    companion object {
        /** The "no payload" snapshot, surfaced for a null body or no resolved vehicle (web `data: undefined`). */
        val EMPTY = ProjectedRangeData(false, null, null, null, null, 0.0, 0.0, 0.0)
    }
}

/**
 * The localized labels the surface folds into its output — the fourteen web `t('widget.projectedRange.…')`
 * keys. The pure [ProjectedRangeProjection] reads these to assemble each visible string + TalkBack content
 * description; the composable builds this from `stringResource`, while tests pass a deterministic instance.
 */
data class ProjectedRangeStrings(
    val title: String,
    val projected: String,
    val epa: String,
    val ofEpa: String,
    val factors: String,
    val degradation: String,
    val avgDaily: String,
    val capacity: String,
    val cycles: String,
    val excellent: String,
    val good: String,
    val fair: String,
    val poor: String,
    val noData: String,
)

/** The health-score band a value falls into — the native analogue of the web `healthBadge` buckets. */
enum class HealthBand { Excellent, Good, Fair, Poor }

/** The projected-vs-EPA comparison band — the native analogue of the web bar-color thresholds. */
enum class ComparisonBand { Good, Fair, Poor }

/** Which leading glyph a range-factor row shows — mapped to an `ImageVector` at the Compose boundary. */
enum class ProjectedRangeFactorIcon { Degradation, AvgDaily, Capacity, Cycles }

/**
 * One projected, render-ready range-factor row — the native analogue of a web `factors[]` entry. Carries
 * the resolved [label], the already-formatted [value] (percent or distance), and the [icon] marker.
 */
data class ProjectedRangeFactor(
    val label: String,
    val value: String,
    val icon: ProjectedRangeFactorIcon,
)

/**
 * The confidence badge — the native analogue of the web `badge` object. [compactText] is the bare band
 * label the compact hero shows (web `WidgetBigNumber badge.text`); [standardText] appends the health
 * score (web ``${badge.text} · ${fmtNumber(healthScore, 0)}%``) for the standard / wide header.
 */
data class ProjectedRangeBadge(
    val band: HealthBand,
    val compactText: String,
    val standardText: String,
)

/**
 * The fully projected, render-ready view of the projected range for one footprint — the native analogue
 * of everything the web component computes before returning JSX. Pure data (no Compose types) so the
 * projection is unit-tested without a UI host. Carries the compact-hero fields, the standard
 * range + comparison fields, and the wide range-factors list; the composable renders the subset its
 * footprint needs.
 */
data class ProjectedRangeDisplay(
    val hasData: Boolean,
    val isCompact: Boolean,
    val isWide: Boolean,
    val title: String,
    val projectedRangeValue: Double?,
    val projectedRangeText: String,
    val distanceUnitLabel: String,
    val projectedLabel: String,
    val badge: ProjectedRangeBadge?,
    val epaLabel: String,
    val epaText: String,
    val rangePct: Int?,
    val comparisonBand: ComparisonBand,
    val comparisonFraction: Float,
    val ofEpaText: String?,
    val factorsLabel: String,
    val factors: List<ProjectedRangeFactor>,
    val compactContentDescription: String,
    val emptyMessage: String,
)

/**
 * Decodes the raw projected-range [json] (kilometre rollups, snake_case on the wire) into a
 * [ProjectedRangeData]. A non-object input, an empty object (the view-model's no-vehicle sentinel), or a
 * null body collapses to [ProjectedRangeData.EMPTY] (web `data: undefined` → empty state). Within a real
 * payload, the four web-nullable fields stay nullable while the percent/cycle fields default to zero —
 * reproducing the web `?? null` vs `?? 0` distinction.
 */
fun parseProjectedRange(json: JsonElement?): ProjectedRangeData {
    val obj = (json as? JsonObject)?.takeIf { it.isNotEmpty() } ?: return ProjectedRangeData.EMPTY
    return ProjectedRangeData(
        present = true,
        currentRangeKm = obj.numberOrNull("current_range_km"),
        newRangeKm = obj.numberOrNull("new_range_km"),
        avgDailyKm = obj.numberOrNull("avg_daily_km"),
        healthScore = obj.numberOrNull("health_score"),
        degradationPct = obj.numberOrNull("degradation_pct") ?: 0.0,
        currentCapacityPct = obj.numberOrNull("current_capacity_pct") ?: 0.0,
        totalCycles = obj.numberOrNull("total_cycles") ?: 0.0,
    )
}

private fun JsonObject.numberOrNull(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

/**
 * Pure projection from a decoded [ProjectedRangeData] to the render-ready [ProjectedRangeDisplay] — the
 * native port of the inline derivations + JSX formatting in the web source. SI kilometres are scaled to
 * metres and converted to the user's distance unit at this display boundary (web `toDistanceDisplay` =
 * `convertDistanceFromSI`); numbers are formatted via the shared [ChartFormat] (web `fmtNumber`). [locale]
 * drives the grouping/separators (tests pin [Locale.US]).
 */
object ProjectedRangeProjection {
    /**
     * Project [data] for [size] using the user's display [prefs] (distance unit), the localized
     * [strings], and [locale] for number grouping.
     */
    fun project(
        data: ProjectedRangeData,
        size: ProjectedRangeSize,
        strings: ProjectedRangeStrings,
        prefs: UnitPref,
        locale: Locale = Locale.US,
    ): ProjectedRangeDisplay {
        val unit = prefs.distance
        val unitLabel = unit.label
        val projected = data.currentRangeKm?.let { displayDistance(it, unit) }
        val epa = data.newRangeKm?.let { displayDistance(it, unit) }
        val projectedValue = projected?.let { jsRound(it) }
        val projectedText = projectedValue?.let { ChartFormat.number(it, WHOLE_DECIMALS, locale) } ?: EM_DASH
        val badge = data.healthScore?.let { badge(it, strings, locale) }
        val pct = rangePct(projected, epa)
        return ProjectedRangeDisplay(
            hasData = data.hasData,
            isCompact = size.isCompact,
            isWide = size.isWide,
            title = strings.title,
            projectedRangeValue = projectedValue,
            projectedRangeText = projectedText,
            distanceUnitLabel = unitLabel,
            projectedLabel = strings.projected,
            badge = badge,
            epaLabel = strings.epa,
            epaText = epa?.let { "${ChartFormat.number(it, WHOLE_DECIMALS, locale)} $unitLabel" } ?: EM_DASH,
            rangePct = pct,
            comparisonBand = comparisonBandFor(pct),
            comparisonFraction = (pct ?: 0) / PERCENT_SCALE.toFloat(),
            ofEpaText = pct?.let { "$it% ${strings.ofEpa}" },
            factorsLabel = strings.factors,
            factors = if (data.hasData) factors(data, unit, unitLabel, strings, locale) else emptyList(),
            compactContentDescription = compactDescription(projectedText, unitLabel, strings.projected, badge),
            emptyMessage = strings.noData,
        )
    }

    /** The display-unit distance for an SI-kilometre [km] value (web `toDistanceDisplay(km * 1000)`). */
    fun displayDistance(
        km: Double,
        unit: DistanceUnitPref,
    ): Double = convertDistanceFromSI(km * METERS_PER_KM, unit)

    /**
     * The percent-of-EPA ratio (web `Math.min(100, Math.round((projected / epa) * 100))`), or `null` when
     * either range is missing or the EPA range is non-positive (web `epaRange > 0` guard).
     */
    fun rangePct(
        projected: Double?,
        epa: Double?,
    ): Int? {
        if (projected == null || epa == null || epa <= 0.0) return null
        return min(RANGE_PCT_MAX, jsRound(projected / epa * PERCENT_SCALE).toInt())
    }

    /** The health band for [score] (web `healthBadge` thresholds: 90 / 70 / 50). */
    fun healthBandFor(score: Double): HealthBand =
        when {
            score >= EXCELLENT_MIN -> HealthBand.Excellent
            score >= GOOD_MIN -> HealthBand.Good
            score >= FAIR_MIN -> HealthBand.Fair
            else -> HealthBand.Poor
        }

    /** The comparison band for [pct] (web bar-color thresholds: 80 / 60; a null ratio is the poor band). */
    fun comparisonBandFor(pct: Int?): ComparisonBand =
        when {
            pct != null && pct >= COMPARISON_GOOD_MIN -> ComparisonBand.Good
            pct != null && pct >= COMPARISON_FAIR_MIN -> ComparisonBand.Fair
            else -> ComparisonBand.Poor
        }

    private fun badge(
        score: Double,
        strings: ProjectedRangeStrings,
        locale: Locale,
    ): ProjectedRangeBadge {
        val band = healthBandFor(score)
        val label = bandLabel(band, strings)
        return ProjectedRangeBadge(
            band = band,
            compactText = label,
            standardText = "$label \u00B7 ${ChartFormat.number(score, SCORE_DECIMALS, locale)}%",
        )
    }

    private fun bandLabel(
        band: HealthBand,
        strings: ProjectedRangeStrings,
    ): String =
        when (band) {
            HealthBand.Excellent -> strings.excellent
            HealthBand.Good -> strings.good
            HealthBand.Fair -> strings.fair
            HealthBand.Poor -> strings.poor
        }

    private fun factors(
        data: ProjectedRangeData,
        unit: DistanceUnitPref,
        unitLabel: String,
        strings: ProjectedRangeStrings,
        locale: Locale,
    ): List<ProjectedRangeFactor> {
        val avgDaily = data.avgDailyKm?.let { displayDistance(it, unit) } ?: 0.0
        return listOf(
            ProjectedRangeFactor(
                label = strings.degradation,
                value = "${ChartFormat.number(data.degradationPct, PERCENT_DECIMALS, locale)}%",
                icon = ProjectedRangeFactorIcon.Degradation,
            ),
            ProjectedRangeFactor(
                label = strings.avgDaily,
                value = "${ChartFormat.number(avgDaily, WHOLE_DECIMALS, locale)} $unitLabel",
                icon = ProjectedRangeFactorIcon.AvgDaily,
            ),
            ProjectedRangeFactor(
                label = strings.capacity,
                value = "${ChartFormat.number(data.currentCapacityPct, PERCENT_DECIMALS, locale)}%",
                icon = ProjectedRangeFactorIcon.Capacity,
            ),
            ProjectedRangeFactor(
                label = strings.cycles,
                value = ChartFormat.number(data.totalCycles, WHOLE_DECIMALS, locale),
                icon = ProjectedRangeFactorIcon.Cycles,
            ),
        )
    }

    private fun compactDescription(
        projectedText: String,
        unitLabel: String,
        projectedLabel: String,
        badge: ProjectedRangeBadge?,
    ): String =
        buildString {
            append(projectedText)
            append(' ')
            append(unitLabel)
            append(", ")
            append(projectedLabel)
            if (badge != null) {
                append(", ")
                append(badge.compactText)
            }
        }

    /** Half-up rounding reproducing JavaScript `Math.round` for the non-negative ranges this surface shows. */
    private fun jsRound(value: Double): Double = floor(value + ROUND_HALF)

    /** Health score ≥ this is the excellent band (web `score >= 90`). */
    private const val EXCELLENT_MIN = 90.0

    /** Health score ≥ this (and below [EXCELLENT_MIN]) is the good band (web `score >= 70`). */
    private const val GOOD_MIN = 70.0

    /** Health score ≥ this (and below [GOOD_MIN]) is the fair band (web `score >= 50`); below it is poor. */
    private const val FAIR_MIN = 50.0

    /** Percent-of-EPA ≥ this is the green comparison band (web `rangePct >= 80`). */
    private const val COMPARISON_GOOD_MIN = 80

    /** Percent-of-EPA ≥ this (and below [COMPARISON_GOOD_MIN]) is the amber band (web `rangePct >= 60`). */
    private const val COMPARISON_FAIR_MIN = 60
}
