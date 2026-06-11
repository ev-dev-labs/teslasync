// Pure, framework-free model + projection for the Charging Optimizer dashboard widget — the native
// analogue of the data the web component computes before returning JSX
// (web/src/features/dashboard/widgets/ChargingOptimizerWidget.tsx) and the canonical cross-platform
// port (apps/windows/.../ChargingOptimizerWidget/ChargingOptimizerWidget.Model.cs). No Compose, no
// Android, no HTTP: every type here is unit-tested off-device in the :android:testReleaseUnitTest gate,
// keeping the composable a thin render layer.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/ChargingOptimizerWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so
// the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.chargingoptimizer

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
private const val MAX_CLOCK_HOUR = 24
private const val LAST_HOUR_OF_DAY = 23
private const val NOON_HOUR = 12
private const val PEAK_THRESHOLD_PCT = 30.0

/**
 * The widget grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the `isCompact` /
 * `isWide` branches in the web source: a single column renders the compact optimal-start hero, wider
 * footprints render the metric tiles + schedule badge, and four-plus columns add the 24h rate timeline.
 */
data class ChargingOptimizerSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `isCompact = size.cols <= 1`): show the compact hero. */
    val isCompact: Boolean get() = cols <= 1

    /** True at four-plus columns (web `isWide = size.cols >= 4`): add the 24h rate timeline. */
    val isWide: Boolean get() = cols >= MAX_WIDE_COLS

    companion object {
        /** Column count at which the wide 24h timeline appears (web `size.cols >= 4`). */
        const val MAX_WIDE_COLS = 4
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/charging.ts (`charging-optimizer`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web grids
 * stay in lockstep.
 */
object ChargingOptimizerRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "charging-optimizer"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "charging"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "ChargingOptimizerWidget"

    /** Default footprint: 2 columns × 2 rows. */
    val defaultSize = ChargingOptimizerSize(cols = 2, rows = 2)

    /** Minimum footprint: 1 column × 2 rows. */
    val minSize = ChargingOptimizerSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows. */
    val maxSize = ChargingOptimizerSize(cols = 4, rows = 40)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: ChargingOptimizerSize): Boolean =
        size.cols in minSize.cols..maxSize.cols && size.rows in minSize.rows..maxSize.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: ChargingOptimizerSize): ChargingOptimizerSize =
        ChargingOptimizerSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/** The rate band a single hour of the 24h timeline falls into (web peak / off-peak / standard fill). */
enum class OptimizerRateKind { Standard, Peak, Offpeak }

/** Badge tint for the schedule-match badge and a recommendation's impact chip (web `Badge` variant). */
enum class OptimizerBadgeTone { Success, Warning, Neutral }

/**
 * One smart-charging recommendation from `GET /analytics/charging-optimizer` (the web
 * `OptimizerRecommendation`, web/src/types/charging.ts). Field names mirror the Go API's snake_case JSON
 * tags; parsing is null-tolerant so a partial row never throws, and [title]/[detail] fall back to the
 * em-dash exactly as the web component does (`rec.title ?? '—'`).
 */
data class OptimizerRecommendation(
    val type: String,
    val priority: String,
    val title: String,
    val detail: String,
    val estimatedSavings: Double?,
) {
    companion object {
        /** Project a single `recommendations[]` JSON object into a tolerant row. */
        fun fromJson(obj: JsonObject): OptimizerRecommendation =
            OptimizerRecommendation(
                type = OptimizerJson.getString(obj, "type") ?: "",
                priority = OptimizerJson.getString(obj, "priority") ?: "",
                title = OptimizerJson.getString(obj, "title") ?: EM_DASH,
                detail = OptimizerJson.getString(obj, "detail") ?: EM_DASH,
                estimatedSavings = OptimizerJson.getDouble(obj, "estimated_savings"),
            )
    }
}

/**
 * The optimizer read-model the widget consumes — the subset of the `GET /analytics/charging-optimizer`
 * object body the web component actually reads (`current_schedule.most_common_start_hour` /
 * `avg_charge_to_pct`, `cost_analysis.potential_monthly_savings` / `sessions_during_peak_pct` /
 * `peak_hours` / `offpeak_hours`, and `recommendations`; the sibling `battery_health_score` /
 * `weekly_heatmap` fields are not surfaced by this widget). Parsing is tolerant so a partial or non-object
 * body yields [Empty] rather than throwing. [hasData] mirrors the web `!data` truthiness gate.
 */
data class ChargingOptimizerReport(
    val hasData: Boolean,
    val optimalStartHour: Int,
    val targetSocPct: Double,
    val monthlySavings: Double,
    val peakPct: Double,
    val peakHours: List<Int>,
    val offpeakHours: List<Int>,
    val recommendations: List<OptimizerRecommendation>,
) {
    /**
     * True when the optimizer schedule is already off-peak-aligned — the web
     * `scheduleMatchesOptimal = peakPct < 30` gate that drives the "Optimized" vs "Can improve" badge.
     */
    val scheduleMatchesOptimal: Boolean get() = peakPct < PEAK_THRESHOLD_PCT

    companion object {
        /** The no-data report — the parse fallback for an absent / non-object / empty body. */
        val Empty =
            ChargingOptimizerReport(
                hasData = false,
                optimalStartHour = 0,
                targetSocPct = 0.0,
                monthlySavings = 0.0,
                peakPct = 0.0,
                peakHours = emptyList(),
                offpeakHours = emptyList(),
                recommendations = emptyList(),
            )

        /** Project a `GET /analytics/charging-optimizer` JSON body into a tolerant report. */
        fun fromJson(element: JsonElement): ChargingOptimizerReport {
            val obj = element as? JsonObject
            if (obj == null || obj.isEmpty()) {
                // Web parity: `!data` — an absent or empty body renders the "No optimizer data" state.
                return Empty
            }
            val schedule = OptimizerJson.getObject(obj, "current_schedule")
            val cost = OptimizerJson.getObject(obj, "cost_analysis")
            return ChargingOptimizerReport(
                hasData = true,
                optimalStartHour = OptimizerJson.getHour(schedule, "most_common_start_hour"),
                targetSocPct = OptimizerJson.getDouble(schedule, "avg_charge_to_pct") ?: 0.0,
                monthlySavings = OptimizerJson.getDouble(cost, "potential_monthly_savings") ?: 0.0,
                peakPct = OptimizerJson.getDouble(cost, "sessions_during_peak_pct") ?: 0.0,
                peakHours = OptimizerJson.getHourArray(cost, "peak_hours"),
                offpeakHours = OptimizerJson.getHourArray(cost, "offpeak_hours"),
                recommendations = parseRecommendations(obj),
            )
        }

        private fun parseRecommendations(obj: JsonObject): List<OptimizerRecommendation> {
            val arr = obj["recommendations"] as? JsonArray ?: return emptyList()
            return arr.mapNotNull { item -> (item as? JsonObject)?.let(OptimizerRecommendation::fromJson) }
        }
    }
}

/** Null-tolerant JSON readers shared by the optimizer parse adapter (snake_case wire shape). */
object OptimizerJson {
    /** Read a nested object property, or `null` when absent / not an object. */
    fun getObject(
        parent: JsonObject?,
        name: String,
    ): JsonObject? = parent?.get(name) as? JsonObject

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

    /** Read a clock hour (0..24) from a tolerant number, defaulting to 0 (web `?? 0`). */
    fun getHour(
        obj: JsonObject?,
        name: String,
    ): Int {
        val raw = getDouble(obj, name) ?: return 0
        return raw.roundToInt().coerceIn(0, MAX_CLOCK_HOUR)
    }

    /** Read a tolerant array of clock hours (0..23), skipping non-numeric / out-of-range entries. */
    fun getHourArray(
        obj: JsonObject?,
        name: String,
    ): List<Int> {
        val arr = obj?.get(name) as? JsonArray ?: return emptyList()
        return arr.mapNotNull { item ->
            val prim = item as? JsonPrimitive ?: return@mapNotNull null
            if (prim.isString) return@mapNotNull null
            val number = prim.doubleOrNull ?: return@mapNotNull null
            if (!number.isFinite()) return@mapNotNull null
            val hour = number.roundToInt()
            hour.takeIf { it in 0..LAST_HOUR_OF_DAY }
        }
    }
}

/**
 * One projected metric tile for the standard layout — the native analogue of a web key-metric cell
 * (Optimal start / Target SOC / Savings/mo). Holds the formatted [value], the caption [label] and a
 * TalkBack [contentDescription]. Pure data (no Compose); the glyph + accent are resolved at the render
 * boundary.
 */
data class OptimizerMetric(
    val value: String,
    val label: String,
    val contentDescription: String,
)

/**
 * One projected, display-ready recommendation tip consumed by the view — the native analogue of a web
 * `TipItem` (the `tips` `useMemo`). Holds the [title] (`rec.title`), the [description] (`rec.detail`), and
 * the optional priority-coloured impact chip (the web `impactBadgeMap`) plus a folded TalkBack phrase.
 */
data class OptimizerTip(
    val id: Int,
    val title: String,
    val description: String,
    val hasImpact: Boolean,
    val impactLabel: String,
    val impactTone: OptimizerBadgeTone,
    val contentDescription: String,
)

/**
 * One hour-cell of the wide-layout 24h rate timeline — the native analogue of a single web timeline cell
 * (`Array.from({ length: 24 })`). Holds the [hour], its rate band [kind], whether the optimal-start marker
 * overlays it, and the composed tooltip/Narrator [label] (`{hour} — {Peak|Off-peak|Standard}`).
 */
data class OptimizerHourSegment(
    val hour: Int,
    val kind: OptimizerRateKind,
    val isCurrentStart: Boolean,
    val label: String,
)

/**
 * The fully projected, render-ready view of the optimizer body for one footprint — the native analogue of
 * everything the web component computes before returning JSX. Holds the compact hero strings, the three
 * standard metric tiles, the schedule-match badge, the 24h timeline segments, and the recommendation tips.
 * Pure data so the projection is unit-tested without a UI host.
 */
data class ChargingOptimizerDisplay(
    val isCompact: Boolean,
    val isWide: Boolean,
    val hasData: Boolean,
    val optimalStartText: String,
    val targetSocShortText: String,
    val savingsShortText: String,
    val showSavingsBadge: Boolean,
    val optimalStartMetric: OptimizerMetric,
    val targetSocMetric: OptimizerMetric,
    val savingsMetric: OptimizerMetric,
    val peakUsageText: String,
    val scheduleMatchesOptimal: Boolean,
    val scheduleBadgeText: String,
    val scheduleBadgeTone: OptimizerBadgeTone,
    val rateTimelineLabel: String,
    val segments: List<OptimizerHourSegment>,
    val tips: List<OptimizerTip>,
    val maxTips: Int,
    val noRecommendationsMessage: String,
    val compactContentDescription: String,
)

/**
 * Localized labels + the relative-time formatter the surface folds into its output. The pure
 * [ChargingOptimizerProjection] reads the body/value labels + templates + [emDash]; the composable chrome
 * additionally reads [title] / [noData] / the header refresh microcopy / [formatRelative]. The composable
 * builds this from `stringResource`; tests pass a deterministic instance. Keeping i18n out of the
 * projection lets the projection stay a pure, locale-stable function.
 *
 * The `*Template` fields carry the raw resource strings whose single `%1$s` slot the projection fills
 * (`SOC %1$s%%`, `$%1$s/mo`, `Peak charging: %1$s%%`).
 */
data class ChargingOptimizerStrings(
    val title: String,
    val noData: String,
    val optimalStart: String,
    val targetSoc: String,
    val savingsLabel: String,
    val peakUsageTemplate: String,
    val optimized: String,
    val canImprove: String,
    val rateTimeline: String,
    val peak: String,
    val offpeak: String,
    val standard: String,
    val noRecommendations: String,
    val targetSocShortTemplate: String,
    val savingsShortTemplate: String,
    val refreshLabel: String,
    val refreshingLabel: String,
    val offlineLabel: String,
    val formatRelative: (FreshnessAge) -> String,
    val emDash: String = EM_DASH,
)

/**
 * Pure projection from a parsed [ChargingOptimizerReport] to the [ChargingOptimizerDisplay] — the native
 * port of the rendering logic in web/src/features/dashboard/widgets/ChargingOptimizerWidget.tsx. Formats
 * the optimal hour (the web `formatHour` 12-hour clock), the target SOC, the monthly savings, the
 * schedule-match badge, the 24h rate timeline and the recommendation tips; every label resolves through
 * the injected [ChargingOptimizerStrings]. Kept UI-free so each branch is unit-tested without a runtime.
 */
object ChargingOptimizerProjection {
    /** Tips rendered in the standard (non-wide) layout, mirroring the web `maxTips={3}`. */
    const val MAX_STANDARD_TIPS = 3

    /** Tips rendered in the wide layout, mirroring the web `maxTips={5}`. */
    const val MAX_WIDE_TIPS = 5

    private val KNOWN_PRIORITIES = setOf("high", "medium", "low")

    /** Project [report] for [size] using the localized [strings]. */
    fun project(
        report: ChargingOptimizerReport,
        size: ChargingOptimizerSize,
        strings: ChargingOptimizerStrings,
    ): ChargingOptimizerDisplay {
        val optimalStart = formatHour(report.optimalStartHour)
        val socInt = formatInt(report.targetSocPct)
        val savingsAmount = formatInt(report.monthlySavings)
        val peakInt = formatInt(report.peakPct)

        val targetSocValue = "$socInt%"
        val savingsValue = "\$$savingsAmount"
        val targetSocShort = fill(strings.targetSocShortTemplate, socInt)
        val savingsShort = fill(strings.savingsShortTemplate, savingsAmount)

        val optimalStartMetric =
            OptimizerMetric(optimalStart, strings.optimalStart, compose(strings.optimalStart, optimalStart))
        val targetSocMetric =
            OptimizerMetric(targetSocValue, strings.targetSoc, compose(strings.targetSoc, targetSocValue))
        val savingsMetric =
            OptimizerMetric(savingsValue, strings.savingsLabel, compose(strings.savingsLabel, savingsValue))

        val optimized = report.scheduleMatchesOptimal
        val showSavings = report.monthlySavings > 0
        val compactCd =
            buildString {
                append(optimalStartMetric.contentDescription).append(", ").append(targetSocShort)
                if (showSavings) append(", ").append(savingsShort)
            }

        return ChargingOptimizerDisplay(
            isCompact = size.isCompact,
            isWide = size.isWide,
            hasData = report.hasData,
            optimalStartText = optimalStart,
            targetSocShortText = targetSocShort,
            savingsShortText = savingsShort,
            showSavingsBadge = showSavings,
            optimalStartMetric = optimalStartMetric,
            targetSocMetric = targetSocMetric,
            savingsMetric = savingsMetric,
            peakUsageText = fill(strings.peakUsageTemplate, peakInt),
            scheduleMatchesOptimal = optimized,
            scheduleBadgeText = if (optimized) strings.optimized else strings.canImprove,
            scheduleBadgeTone = if (optimized) OptimizerBadgeTone.Success else OptimizerBadgeTone.Warning,
            rateTimelineLabel = strings.rateTimeline,
            segments = buildTimeline(report, strings),
            tips = buildTips(report.recommendations),
            maxTips = if (size.isWide) MAX_WIDE_TIPS else MAX_STANDARD_TIPS,
            noRecommendationsMessage = strings.noRecommendations,
            compactContentDescription = compactCd,
        )
    }

    /**
     * The web component's local `formatHour`: hour 0/24 → "12 AM", 12 → "12 PM", &lt;12 → "{h} AM",
     * otherwise "{h-12} PM". The AM/PM strings are not localized in the web source, so they are kept
     * verbatim here for parity.
     */
    fun formatHour(hour: Int): String =
        when {
            hour == 0 || hour == MAX_CLOCK_HOUR -> "12 AM"
            hour == NOON_HOUR -> "12 PM"
            hour < NOON_HOUR -> "$hour AM"
            else -> "${hour - NOON_HOUR} PM"
        }

    /**
     * The web `impactBadgeMap` applied to a recommendation priority: high → success, medium → warning,
     * low (and anything else) → neutral. Drives the tip impact-chip tint.
     */
    fun impactToneFor(priority: String): OptimizerBadgeTone =
        when (priority) {
            "high" -> OptimizerBadgeTone.Success
            "medium" -> OptimizerBadgeTone.Warning
            else -> OptimizerBadgeTone.Neutral
        }

    /** True when [priority] is one of the recognised web impact levels (drives whether a chip shows). */
    fun isKnownPriority(priority: String): Boolean = priority in KNOWN_PRIORITIES

    /** Build the off-peak / peak / standard 24h timeline with the optimal-start marker overlaid. */
    fun buildTimeline(
        report: ChargingOptimizerReport,
        strings: ChargingOptimizerStrings,
    ): List<OptimizerHourSegment> {
        val peak = report.peakHours.toHashSet()
        val offpeak = report.offpeakHours.toHashSet()
        return (0..LAST_HOUR_OF_DAY).map { hour ->
            // Web precedence: peak wins over off-peak when an hour is (erroneously) in both sets.
            val kind =
                when {
                    peak.contains(hour) -> OptimizerRateKind.Peak
                    offpeak.contains(hour) -> OptimizerRateKind.Offpeak
                    else -> OptimizerRateKind.Standard
                }
            OptimizerHourSegment(
                hour = hour,
                kind = kind,
                isCurrentStart = hour == report.optimalStartHour,
                label = "${formatHour(hour)} ${strings.emDash} ${kindWord(kind, strings)}",
            )
        }
    }

    /** The localized band word used in timeline labels (web peak / off-peak / standard tooltips). */
    fun kindWord(
        kind: OptimizerRateKind,
        strings: ChargingOptimizerStrings,
    ): String =
        when (kind) {
            OptimizerRateKind.Peak -> strings.peak
            OptimizerRateKind.Offpeak -> strings.offpeak
            OptimizerRateKind.Standard -> strings.standard
        }

    private fun buildTips(recommendations: List<OptimizerRecommendation>): List<OptimizerTip> =
        recommendations.mapIndexed { index, rec ->
            val hasImpact = isKnownPriority(rec.priority)
            // Web parity: the chip label is `t('…priority.{p}', rec.priority)`. Those keys are absent from
            // both the web and Android catalogs, so the i18n fallback (the raw priority) is the label.
            val impactLabel = rec.priority
            val description =
                if (hasImpact) {
                    "$impactLabel: ${rec.title}. ${rec.detail}"
                } else {
                    "${rec.title}. ${rec.detail}"
                }
            OptimizerTip(
                id = index,
                title = rec.title,
                description = rec.detail,
                hasImpact = hasImpact,
                impactLabel = impactLabel,
                impactTone = impactToneFor(rec.priority),
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

    private fun compose(
        label: String,
        value: String,
    ): String = "$label: $value"
}
