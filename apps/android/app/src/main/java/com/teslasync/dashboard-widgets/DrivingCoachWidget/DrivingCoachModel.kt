// Pure, framework-free model + projection for the Driving Coach dashboard widget — the native analogue
// of the data the web component computes before returning JSX
// (web/src/features/dashboard/widgets/DrivingCoachWidget.tsx). No Compose, no Android, no HTTP: every
// type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/DrivingCoachWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located
// supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.drivingcoach

import io.teslasync.android.components.datadisplay.FreshnessAge
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale
import kotlin.math.roundToInt

private const val EM_DASH = "\u2014"
private const val PERCENT = 100.0

/**
 * The widget grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the single
 * `isCompact` branch in the web source: a single column renders the compact score hero, wider footprints
 * render the score header above the recommendation tip cards.
 */
data class DrivingCoachSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `isCompact = size.cols <= 1`): show the compact score hero. */
    val isCompact: Boolean get() = cols <= 1
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/driving.ts (`driving-coach`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay
 * in lockstep.
 */
object DrivingCoachRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "driving-coach"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "driving"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "DrivingCoachWidget"

    /** Default footprint: 2 columns × 4 rows. */
    val defaultSize = DrivingCoachSize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 2 rows. */
    val minSize = DrivingCoachSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows. */
    val maxSize = DrivingCoachSize(cols = 4, rows = 40)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: DrivingCoachSize): Boolean = size.cols in minSize.cols..maxSize.cols && size.rows in minSize.rows..maxSize.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: DrivingCoachSize): DrivingCoachSize =
        DrivingCoachSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/** Badge tint for a recommendation's impact chip (web `impactBadgeMap`). */
enum class CoachBadgeTone { Success, Warning, Neutral }

/**
 * One personalized driving recommendation from `GET /analytics/driving-coach` (the web
 * `CoachRecommendation`, web/src/types/driving.ts). Field names mirror the Go API's snake_case JSON tags;
 * parsing is null-tolerant so a partial row never throws, and [category]/[tip] fall back to the em-dash
 * exactly as the web component does (`rec.category ?? '—'`, `rec.tip ?? '—'`). [impact] is the raw
 * priority string (`rec.impact ?? undefined`); a blank value means no impact chip.
 */
data class CoachRecommendation(
    val category: String,
    val tip: String,
    val impact: String,
) {
    companion object {
        /** Project a single `recommendations[]` JSON object into a tolerant row. */
        fun fromJson(obj: JsonObject): CoachRecommendation =
            CoachRecommendation(
                category = CoachJson.getString(obj, "category") ?: EM_DASH,
                tip = CoachJson.getString(obj, "tip") ?: EM_DASH,
                impact = CoachJson.getString(obj, "impact") ?: "",
            )
    }
}

/**
 * The driving-coach read-model the widget consumes — the subset of the `GET /analytics/driving-coach`
 * object body the web component actually reads (`overall_score`, `efficiency_wh_km`,
 * `best_efficiency_wh_km`, and `recommendations`; the sibling `patterns` / `weekly_trend` /
 * `per_drive_scores` / `style_breakdown` fields are not surfaced by this widget). Parsing is tolerant so a
 * partial or non-object body yields [Empty] rather than throwing. [hasData] mirrors the web `!data`
 * truthiness gate.
 */
data class DrivingCoachReport(
    val hasData: Boolean,
    val overallScore: Double,
    val efficiencyWhKm: Double,
    val bestEfficiencyWhKm: Double,
    val recommendations: List<CoachRecommendation>,
) {
    /**
     * Potential efficiency savings versus the best observed drive, as a whole percent — the web
     * `currentEff > 0 ? Math.round(((currentEff - bestEff) / currentEff) * 100) : 0`. Half rounds toward
     * positive infinity (JS `Math.round` parity). Drives whether the "Potential savings" badge shows.
     */
    val savingsPct: Int
        get() =
            if (efficiencyWhKm > 0) {
                ((efficiencyWhKm - bestEfficiencyWhKm) / efficiencyWhKm * PERCENT).roundToInt()
            } else {
                0
            }

    companion object {
        /** The no-data report — the parse fallback for an absent / non-object / empty body. */
        val Empty =
            DrivingCoachReport(
                hasData = false,
                overallScore = 0.0,
                efficiencyWhKm = 0.0,
                bestEfficiencyWhKm = 0.0,
                recommendations = emptyList(),
            )

        /** Project a `GET /analytics/driving-coach` JSON body into a tolerant report. */
        fun fromJson(element: JsonElement): DrivingCoachReport {
            val obj = element as? JsonObject
            if (obj == null || obj.isEmpty()) {
                // Web parity: `!data` — an absent or empty body renders the "No tips available" state.
                return Empty
            }
            return DrivingCoachReport(
                hasData = true,
                overallScore = CoachJson.getDouble(obj, "overall_score") ?: 0.0,
                efficiencyWhKm = CoachJson.getDouble(obj, "efficiency_wh_km") ?: 0.0,
                bestEfficiencyWhKm = CoachJson.getDouble(obj, "best_efficiency_wh_km") ?: 0.0,
                recommendations = parseRecommendations(obj),
            )
        }

        private fun parseRecommendations(obj: JsonObject): List<CoachRecommendation> {
            val arr = obj["recommendations"] as? JsonArray ?: return emptyList()
            return arr.mapNotNull { item -> (item as? JsonObject)?.let(CoachRecommendation::fromJson) }
        }
    }
}

/** Null-tolerant JSON readers shared by the coach parse adapter (snake_case wire shape). */
object CoachJson {
    /** Read a tolerant string property (`null` when absent or not a string). */
    fun getString(
        obj: JsonObject?,
        name: String,
    ): String? {
        val prim = obj?.get(name) as? JsonPrimitive ?: return null
        return if (prim.isString) prim.content else null
    }

    /** Read a tolerant finite double (number or numeric string), `null` when absent / NaN / unparseable. */
    fun getDouble(
        obj: JsonObject?,
        name: String,
    ): Double? {
        val prim = obj?.get(name) as? JsonPrimitive ?: return null
        return prim.doubleOrNull?.takeIf { it.isFinite() }
    }
}

/**
 * One projected, display-ready recommendation tip consumed by the view — the native analogue of a web
 * `TipItem` (the `tips` `useMemo`). Holds the [title] (`rec.category`), the [description] (`rec.tip`), and
 * the optional impact-coloured chip (the web `impactBadgeMap`) plus a folded TalkBack phrase.
 */
data class DrivingCoachTip(
    val id: Int,
    val title: String,
    val description: String,
    val hasImpact: Boolean,
    val impactLabel: String,
    val impactTone: CoachBadgeTone,
    val contentDescription: String,
)

/**
 * The fully projected, render-ready view of the coach body for one footprint — the native analogue of
 * everything the web component computes before returning JSX. Holds the formatted score + "/ 100" label,
 * the potential-savings badge, the recommendation tips, and (for the compact hero) whether the inline
 * empty state shows. Pure data so the projection is unit-tested without a UI host.
 */
data class DrivingCoachDisplay(
    val isCompact: Boolean,
    val hasData: Boolean,
    val scoreText: String,
    val scoreLabel: String,
    val savingsPct: Int,
    val showSavingsBadge: Boolean,
    val savingsBadgeText: String,
    val tips: List<DrivingCoachTip>,
    val maxTips: Int,
    val compactShowsEmptyState: Boolean,
    val compactContentDescription: String,
)

/**
 * Localized labels + the relative-time formatter the surface folds into its output. The pure
 * [DrivingCoachProjection] reads [scoreLabel] / [potentialSavingsTemplate] / [noTips] / [emDash]; the
 * composable chrome additionally reads [title] / the header refresh microcopy / [formatRelative]. The
 * composable builds this from `stringResource`; tests pass a deterministic instance. Keeping i18n out of
 * the projection lets the projection stay a pure, locale-stable function.
 *
 * [potentialSavingsTemplate] carries the single `%1$s` slot the projection fills (`Potential savings:
 * %1$s%%`).
 */
data class DrivingCoachStrings(
    val title: String,
    val scoreLabel: String,
    val potentialSavingsTemplate: String,
    val noTips: String,
    val refreshLabel: String,
    val refreshingLabel: String,
    val offlineLabel: String,
    val formatRelative: (FreshnessAge) -> String,
    val emDash: String = EM_DASH,
)

/**
 * Pure projection from a parsed [DrivingCoachReport] to the [DrivingCoachDisplay] — the native port of the
 * rendering logic in web/src/features/dashboard/widgets/DrivingCoachWidget.tsx. Formats the overall score
 * (the web `fmtInt`), the potential-savings badge, and the recommendation tips; every label resolves
 * through the injected [DrivingCoachStrings]. Kept UI-free so each branch is unit-tested without a runtime.
 */
object DrivingCoachProjection {
    /** Tips rendered in the tip list, mirroring the web `maxTips={3}`. */
    const val MAX_TIPS = 3

    private val KNOWN_IMPACTS = setOf("high", "medium", "low")

    /** Project [report] for [size] using the localized [strings]. */
    fun project(
        report: DrivingCoachReport,
        size: DrivingCoachSize,
        strings: DrivingCoachStrings,
    ): DrivingCoachDisplay {
        val scoreText = formatInt(report.overallScore)
        val savingsPct = report.savingsPct
        val showSavings = savingsPct > 0
        val savingsBadgeText = fill(strings.potentialSavingsTemplate, savingsPct.toString())
        val tips = buildTips(report.recommendations)
        // Web compact branch: the inline empty shows only when there is no savings AND no recommendations.
        val compactEmpty = !showSavings && tips.isEmpty()
        val compactCd =
            buildString {
                append(scoreText)
                if (showSavings) append(", ").append(savingsBadgeText)
                if (compactEmpty) append(", ").append(strings.noTips)
            }
        return DrivingCoachDisplay(
            isCompact = size.isCompact,
            hasData = report.hasData,
            scoreText = scoreText,
            scoreLabel = strings.scoreLabel,
            savingsPct = savingsPct,
            showSavingsBadge = showSavings,
            savingsBadgeText = savingsBadgeText,
            tips = tips,
            maxTips = MAX_TIPS,
            compactShowsEmptyState = compactEmpty,
            compactContentDescription = compactCd,
        )
    }

    /**
     * The web `impactBadgeMap` applied to a recommendation impact: high → success, medium → warning, low
     * (and anything else) → neutral. Drives the tip impact-chip tint.
     */
    fun impactToneFor(impact: String): CoachBadgeTone =
        when (impact) {
            "high" -> CoachBadgeTone.Success
            "medium" -> CoachBadgeTone.Warning
            else -> CoachBadgeTone.Neutral
        }

    /**
     * True when [impact] is a recognised web impact level (high/medium/low) — drives whether a chip shows.
     * Mirrors the web `{tip.impact && …}` truthiness for the typed `'high' | 'medium' | 'low'` union.
     */
    fun isKnownImpact(impact: String): Boolean = impact in KNOWN_IMPACTS

    private fun buildTips(recommendations: List<CoachRecommendation>): List<DrivingCoachTip> =
        recommendations.mapIndexed { index, rec ->
            val hasImpact = isKnownImpact(rec.impact)
            // Web parity: the chip label is `t('…impact.{i}', rec.impact)`. Those keys are absent from both
            // the web and Android catalogs, so the i18n fallback (the raw impact) is the label.
            val impactLabel = rec.impact
            val description =
                if (hasImpact) {
                    "$impactLabel: ${rec.category}. ${rec.tip}"
                } else {
                    "${rec.category}. ${rec.tip}"
                }
            DrivingCoachTip(
                id = index,
                title = rec.category,
                description = rec.tip,
                hasImpact = hasImpact,
                impactLabel = impactLabel,
                impactTone = impactToneFor(rec.impact),
                contentDescription = description,
            )
        }

    /**
     * Locale-stable integer formatter (web `fmtInt` / `fmtNumber(x, 0)`): grouped thousands, no fraction
     * digits, half-up rounding (matching the web `Intl.NumberFormat` default round-half-away-from-zero).
     */
    private fun formatInt(value: Double): String =
        DecimalFormat("#,##0", DecimalFormatSymbols(Locale.US))
            .apply { roundingMode = RoundingMode.HALF_UP }
            .format(value)

    private fun fill(
        template: String,
        value: String,
    ): String = String.format(Locale.US, template, value)
}
