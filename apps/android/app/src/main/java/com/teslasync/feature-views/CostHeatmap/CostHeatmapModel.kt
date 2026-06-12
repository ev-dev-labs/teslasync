// Pure, framework-free model + projection for the CostHeatmap feature view — the native analogue of
// everything the web component derives inline before returning JSX
// (web/src/features/charging/components/charging-list/CostHeatmap.tsx). No Compose, no Android, no HTTP:
// every declaration here is exercised off-device by the :app:testReleaseUnitTest gate, so the composable
// stays a thin render layer over these pure functions.
//
// CostHeatmap is a presentational surface — the web component takes two props (`heatmap` +
// `peakCostPerKwh`) from the Charging Optimizer page (which owns the TanStack query via
// `useChargingOptimizer`), so this surface binds no data feed of its own. Its only web hooks are
// `useTranslation` (the three `charging.optimizer.*` keys) and `useFormatting` (the currency symbol +
// `formatCurrency`). From the props the web builds a fixed 7×24 (day × hour) grid: for each cell it looks up
// the matching `OptimizerHeatmapEntry`, derives a 0..1 cost `intensity` against `maxCost`
// (`peakCostPerKwh || 0.30`), and paints an `rgba(...)` whose hue ramps cheap→expensive and whose alpha
// grows with the session count; empty cells get a faint `rgba(255,255,255,0.02)`. A five-swatch
// Cheap→Expensive legend uses the same color ramp at fixed opacities. This file owns that derivation plus
// the per-cell accessible label (the native analogue of the web cell `title` tooltip).
//
// SI / units boundary (unit-conversion instructions): `avg_cost_per_kwh` is a monetary rate, not an SI
// physical quantity, so no `useUnits()` conversion applies; the only formatting is the web
// `formatCurrency(cost, 3)` (currency symbol + three-decimal grouped number), kept locale-deterministic by
// injecting the formatter into [CostHeatmapProjection.project].
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/CostHeatmap — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.costheatmap

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.text.DateFormatSymbols
import java.util.Calendar
import java.util.Locale
import kotlin.math.min
import kotlin.math.roundToInt

/** Rows in the grid — one per weekday, web `['Sun','Mon','Tue','Wed','Thu','Fri','Sat']` (day index 0 = Sun). */
internal const val DAYS_PER_WEEK: Int = 7

/** Columns in the grid — one per hour of the day, web `Array.from({ length: 24 })`. */
internal const val HOURS_PER_DAY: Int = 24

/** Fallback peak rate when `peakCostPerKwh` is falsy — the web `peakCostPerKwh || 0.30`. */
internal const val DEFAULT_MAX_COST: Double = 0.30

/** Cost fraction digits — the web `formatCurrency(cost, 3)` literal precision. */
internal const val COST_DECIMALS: Int = 3

/** Hour-axis label cadence — the web `i % 3 === 0 ? i : ''` (labels at 0, 3, 6, … 21). */
internal const val HOUR_LABEL_INTERVAL: Int = 3

/** Default currency symbol when the settings document has none — the web `useFormatting` `'$'`. */
internal const val DEFAULT_CURRENCY: String = "$"

/** Red channel ceiling in the cheap→expensive ramp — the web `Math.round(intensity * 239)`. */
internal const val RED_MAX: Double = 239.0

/** Green channel ceiling in the ramp — the web `Math.round((1 - intensity) * 187)`. */
internal const val GREEN_MAX: Double = 187.0

/** Blue channel ceiling in the ramp — the web `Math.round((1 - intensity) * 100)`. */
internal const val BLUE_MAX: Double = 100.0

/** Base alpha of a single-session cell — the web `0.15 + sessions * 0.12`. */
internal const val ALPHA_BASE: Double = 0.15

/** Per-session alpha increment — the web `sessions * 0.12`. */
internal const val ALPHA_PER_SESSION: Double = 0.12

/** Alpha ceiling for a busy cell — the web `Math.min(0.9, …)`. */
internal const val ALPHA_MAX: Double = 0.9

/** Fixed alpha of every legend swatch — the web legend `0.6`. */
internal const val LEGEND_ALPHA: Double = 0.6

/** RGB channel value of an empty (no-session) cell — the web `rgba(255,255,255,0.02)`. */
internal const val EMPTY_CELL_CHANNEL: Int = 255

/** Alpha of an empty (no-session) cell — the web `rgba(255,255,255,0.02)`. */
internal const val EMPTY_CELL_ALPHA: Double = 0.02

/** The five legend swatch opacities, cheap→expensive — the web `[0.15, 0.3, 0.5, 0.7, 0.9]`. */
internal val LEGEND_OPACITIES: List<Double> = listOf(0.15, 0.3, 0.5, 0.7, 0.9)

/**
 * One charging-cost heatmap entry — the native mirror of the web `OptimizerHeatmapEntry`
 * (`{ day; hour; sessions; avg_cost_per_kwh }`). [day] is 0 (Sun) … 6 (Sat) and [hour] is 0 … 23, matching
 * the web grid coordinates the component looks each cell up by.
 *
 * @property day weekday index, 0 = Sunday (web `e.day === dayIdx`).
 * @property hour hour of day, 0 … 23 (web `e.hour === hourIdx`).
 * @property sessions charging sessions recorded in that day/hour bucket (web `entry?.sessions ?? 0`).
 * @property avgCostPerKwh the bucket's average cost per kWh (web `entry?.avg_cost_per_kwh ?? 0`).
 */
data class CostHeatmapEntry(
    val day: Int,
    val hour: Int,
    val sessions: Int,
    val avgCostPerKwh: Double,
)

/**
 * The two web props this presentational surface renders, bundled so the host can carry them through one
 * shared-S8 [io.teslasync.android.data.UiState] (the native lifecycle wrapper the sibling surfaces use).
 *
 * @property heatmap the day/hour cost buckets (web `heatmap`); buckets are sparse, so a missing day/hour
 *   renders as an empty cell.
 * @property peakCostPerKwh the peak rate the cost intensity is scaled against (web `peakCostPerKwh`); a
 *   falsy value falls back to [DEFAULT_MAX_COST].
 */
data class CostHeatmapData(
    val heatmap: List<CostHeatmapEntry>,
    val peakCostPerKwh: Double,
) {
    companion object {
        /** Empty data — no buckets; the empty-state contract (no sessions to visualize). */
        val EMPTY: CostHeatmapData = CostHeatmapData(emptyList(), 0.0)
    }
}

/**
 * A render-ready cell color — the native analogue of one web `rgba(r, g, b, a)`. Kept as web-exact integer
 * channels (0 … 255) and a 0 … 1 [alpha] so the projection is unit-tested without Compose; the composable
 * converts it to a clamped Compose `Color` at the render boundary (a browser likewise clamps out-of-range
 * CSS rgba).
 */
data class CostCellColor(
    val red: Int,
    val green: Int,
    val blue: Int,
    val alpha: Double,
)

/**
 * One projected grid cell — the native analogue of a single web heatmap `<div>`.
 *
 * @property day weekday index, 0 = Sunday.
 * @property hour hour of day, 0 … 23.
 * @property sessions the bucket's session count (0 for an empty cell).
 * @property cost the bucket's average cost per kWh (0 for an empty cell).
 * @property intensity the 0 … 1 cost intensity used to ramp the cell hue (web `intensity`).
 * @property color the web-exact cell color (filled ramp, or the faint empty fill).
 * @property accessibilityLabel the cell's screen-reader label — the localized native analogue of the web
 *   cell `title` tooltip (day, hour, and, when busy, the session count + formatted cost).
 */
data class CostCell(
    val day: Int,
    val hour: Int,
    val sessions: Int,
    val cost: Double,
    val intensity: Double,
    val color: CostCellColor,
    val accessibilityLabel: String,
)

/** One grid row — a localized weekday [label] (web `dayLabel`) and its 24 hour [cells]. */
data class CostHeatmapRow(
    val label: String,
    val cells: List<CostCell>,
)

/** One Cheap→Expensive legend swatch — its source [opacity] and the web-exact swatch [color]. */
data class CostLegendSwatch(
    val opacity: Double,
    val color: CostCellColor,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes
 * before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property hourLabels the 24 hour-axis labels; only every third is non-blank (web `i % 3 === 0 ? i : ''`).
 * @property rows the seven weekday rows, each with its localized label and 24 cells.
 * @property legend the five Cheap→Expensive legend swatches.
 * @property isEmpty true when no bucket has any sessions — the surface has nothing to visualize and the
 *   composable renders the friendly empty state rather than a grid of faint cells.
 */
data class CostHeatmapDisplay(
    val hourLabels: List<String>,
    val rows: List<CostHeatmapRow>,
    val legend: List<CostLegendSwatch>,
    val isEmpty: Boolean,
)

/**
 * The two already-localized tooltip fragments the per-cell accessible label is built from (web
 * `useTranslation`). Bundled so the projection stays under the parameter-count budget while keeping the
 * label logic locale-deterministic for tests.
 *
 * @property sessionsWord the "sessions" fragment (reused `translation_sessions`).
 * @property perKwhWord the per-kWh fragment (reused `translation_charging_detail_perKwh`).
 */
data class CostHeatmapTooltipWords(
    val sessionsWord: String,
    val perKwhWord: String,
)

/**
 * The user's currency display preference this surface needs — the native port of the web `useFormatting`
 * read of the `/settings` document. Only the [currencySymbol] is needed: the cell tooltip formats with the
 * literal three-digit precision (web `formatCurrency(cost, 3)`), so the user's `decimal_precision` does not
 * apply here.
 *
 * @property currencySymbol the symbol prefixed to a formatted cost (web `settings.currency_symbol`, `'$'`).
 */
data class CostHeatmapCurrencyPrefs(
    val currencySymbol: String,
) {
    companion object {
        /** The default ($) preference used for previews / cold start before settings load. */
        val DEFAULT: CostHeatmapCurrencyPrefs = CostHeatmapCurrencyPrefs(DEFAULT_CURRENCY)

        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"

        /** Resolves the currency symbol from the raw `/settings` document (web `useFormatting`). */
        fun fromSettings(settings: JsonElement?): CostHeatmapCurrencyPrefs {
            val raw = (settings as? JsonObject)?.get(KEY_CURRENCY_SYMBOL) as? JsonPrimitive
            val symbol = raw?.contentOrNull?.trim()
            return CostHeatmapCurrencyPrefs(if (!symbol.isNullOrEmpty()) symbol else DEFAULT_CURRENCY)
        }
    }
}

/**
 * The pure projection the composable renders — a 1:1 port of the derivations the web component performs
 * inline: the `maxCost` fallback, the per-cell `intensity`, the cheap→expensive `rgba` ramp, the busy-cell
 * alpha, the hour-axis labels, and the legend swatches. Stateless and side-effect-free so it is fully
 * covered by the off-device unit gate; the composable only resolves localized strings, the currency
 * formatter, the weekday labels, and the freshness chrome.
 */
object CostHeatmapProjection {
    /**
     * The peak rate the cell intensity is scaled against — the web `peakCostPerKwh || 0.30`. JS treats only
     * `0`/`NaN` as falsy among numbers, so a zero or non-finite [peakCostPerKwh] falls back to
     * [DEFAULT_MAX_COST]; any other value (including a negative one) is kept verbatim.
     */
    fun maxCost(peakCostPerKwh: Double): Double =
        if (peakCostPerKwh != 0.0 && peakCostPerKwh.isFinite()) peakCostPerKwh else DEFAULT_MAX_COST

    /**
     * The 0 … 1 cost intensity for a cell — the web `maxCost > 0 ? Math.min(1, cost / maxCost) : 0`. A
     * non-positive [maxCost] yields 0 (no ramp), otherwise the ratio is capped at 1.
     */
    fun intensity(
        cost: Double,
        maxCost: Double,
    ): Double = if (maxCost > 0.0) min(1.0, cost / maxCost) else 0.0

    /**
     * The cell color for a bucket — a verbatim port of the web cell `backgroundColor`. A busy cell
     * (`sessions > 0`) ramps from cheap (low [intensity] → greenish) to expensive (high [intensity] →
     * red), with alpha growing per session up to [ALPHA_MAX]; an empty cell is the faint
     * `rgba(255,255,255,0.02)`. Channels use JS `Math.round` semantics (half up; the domain is
     * non-negative).
     */
    fun cellColor(
        sessions: Int,
        intensity: Double,
    ): CostCellColor =
        if (sessions > 0) {
            CostCellColor(
                red = (intensity * RED_MAX).roundToInt(),
                green = ((1.0 - intensity) * GREEN_MAX).roundToInt(),
                blue = ((1.0 - intensity) * BLUE_MAX).roundToInt(),
                alpha = min(ALPHA_MAX, ALPHA_BASE + sessions * ALPHA_PER_SESSION),
            )
        } else {
            CostCellColor(EMPTY_CELL_CHANNEL, EMPTY_CELL_CHANNEL, EMPTY_CELL_CHANNEL, EMPTY_CELL_ALPHA)
        }

    /**
     * A legend swatch color for the given [opacity] — the web legend's
     * `rgba(round(o*239), round((1-o)*187), round((1-o)*100), 0.6)`. The same cheap→expensive ramp the
     * cells use, at a fixed [LEGEND_ALPHA].
     */
    fun legendColor(opacity: Double): CostCellColor =
        CostCellColor(
            red = (opacity * RED_MAX).roundToInt(),
            green = ((1.0 - opacity) * GREEN_MAX).roundToInt(),
            blue = ((1.0 - opacity) * BLUE_MAX).roundToInt(),
            alpha = LEGEND_ALPHA,
        )

    /** The 24 hour-axis labels — a number every third hour, else blank (the web "i % 3 === 0 ? i : ''"). */
    fun hourLabels(): List<String> = (0 until HOURS_PER_DAY).map { hour -> if (hour % HOUR_LABEL_INTERVAL == 0) hour.toString() else "" }

    /**
     * The seven localized short weekday labels in web grid order (index 0 = Sunday … 6 = Saturday) — the
     * native, localizing replacement for the web component's hardcoded English
     * `['Sun','Mon','Tue','Wed','Thu','Fri','Sat']`, sourced from the platform [DateFormatSymbols] for
     * [locale] (so the native code carries no hardcoded weekday literal). A locale whose short name is blank
     * falls back to the platform en-US name, mirroring the sibling surfaces' marker fallback.
     */
    fun weekdayLabels(locale: Locale): List<String> {
        val localized = DateFormatSymbols.getInstance(locale).shortWeekdays
        val fallback = DateFormatSymbols.getInstance(Locale.US).shortWeekdays
        // Calendar weekdays are 1-based from Sunday, so grid day d (0 = Sun) maps to index d + SUNDAY.
        return (0 until DAYS_PER_WEEK).map { day ->
            val index = day + Calendar.SUNDAY
            localized.getOrNull(index)?.takeIf { it.isNotBlank() } ?: (fallback.getOrNull(index) ?: "")
        }
    }

    /**
     * Projects [data] into the render-ready [CostHeatmapDisplay] — the verbatim port of the web grid build.
     * Buckets are indexed by day/hour for O(1) lookup (web `heatmap.find(...)`); each of the 7×24 cells
     * derives its session count, cost, [intensity], color, and accessible label. [dayLabels] supplies the
     * seven localized weekday names (index 0 = Sun), [formatCost] the localized `formatCurrency(cost, 3)`,
     * and [words] the localized tooltip fragments — all injected so the projection stays locale-deterministic
     * for tests.
     */
    fun project(
        data: CostHeatmapData,
        dayLabels: List<String>,
        formatCost: (Double) -> String,
        words: CostHeatmapTooltipWords,
    ): CostHeatmapDisplay {
        val maxCost = maxCost(data.peakCostPerKwh)
        val byCoordinate = data.heatmap.associateBy { it.day * HOURS_PER_DAY + it.hour }
        val rows =
            (0 until DAYS_PER_WEEK).map { day ->
                val label = dayLabels.getOrElse(day) { "" }
                val cells =
                    (0 until HOURS_PER_DAY).map { hour ->
                        val entry = byCoordinate[day * HOURS_PER_DAY + hour]
                        val sessions = entry?.sessions ?: 0
                        val cost = entry?.avgCostPerKwh ?: 0.0
                        val intensity = intensity(cost, maxCost)
                        CostCell(
                            day = day,
                            hour = hour,
                            sessions = sessions,
                            cost = cost,
                            intensity = intensity,
                            color = cellColor(sessions, intensity),
                            accessibilityLabel = cellLabel(label, hour, sessions, formatCost(cost), words),
                        )
                    }
                CostHeatmapRow(label = label, cells = cells)
            }
        return CostHeatmapDisplay(
            hourLabels = hourLabels(),
            rows = rows,
            legend = LEGEND_OPACITIES.map { opacity -> CostLegendSwatch(opacity, legendColor(opacity)) },
            isEmpty = data.heatmap.none { it.sessions > 0 },
        )
    }

    /**
     * The cell's screen-reader label — the localized native analogue of the web cell `title`. A busy cell
     * reads "{day} {hour}:00, {n} {sessions}, {cost} {perKwh}" (web
     * "{day} {hour}:00 — {n} sessions, {cost}/kWh") using the already-formatted [costText] and the localized
     * [words]; an empty cell reads just "{day} {hour}:00". Commas replace the web em dash / slash so TalkBack
     * pauses naturally.
     */
    fun cellLabel(
        dayLabel: String,
        hour: Int,
        sessions: Int,
        costText: String,
        words: CostHeatmapTooltipWords,
    ): String {
        val time = "$dayLabel $hour:00"
        return if (sessions > 0) {
            "$time, $sessions ${words.sessionsWord}, $costText ${words.perKwhWord}"
        } else {
            time
        }
    }

    /**
     * Currency formatting — the web `useFormatting` `currencySymbol + fmtNumber(amount, 3)` contract. A
     * blank [symbol] falls back to `$`; a non-finite [amount] is normalized to 0 (web `safeNumber`); the
     * number is grouped with [locale] separators at [COST_DECIMALS] fraction digits.
     */
    fun formatCurrency(
        amount: Double,
        symbol: String,
        locale: Locale,
    ): String = "${symbol.ifBlank { DEFAULT_CURRENCY }}${ChartFormat.number(safe(amount), COST_DECIMALS, locale)}"

    /** Coerces a non-finite value to 0 — the native mirror of the web `safeNumber`. */
    fun safe(value: Double): Double = if (value.isFinite()) value else 0.0
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a cost,
 * session count, or weekday — so a diagnostics line can never leak the user's charging habits.
 */
object CostHeatmapDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "CostHeatmap"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
