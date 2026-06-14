// Pure, framework-free model + projection for the Cost Forecast dashboard widget — the native analogue
// of everything the web component derives via `useMemo` before returning JSX
// (web/src/features/dashboard/widgets/CostForecastWidget.tsx). No Compose, no Android view types, no
// HTTP: every type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer. The widget composes five feeds — the enrolled-vehicle list (only to
// resolve the default vehicle, web `vehicles?.[0]?.id`), the per-vehicle `/analytics/cost-forecast`
// envelope (web `useCostForecast`, `{ historical[], forecast[], … }`), and the settings document
// (web `useFormatting`, for the currency symbol). This file owns the decode (web optional-chaining →
// null-safe reads), the historical+forecast → trailing-6 bar build (web `buildChartData(...).slice(-6)`),
// the next-month / last-month / trend derivations, and the display-boundary currency formatting
// (web `useFormatting`'s `currencySymbol + fmtNumber`). Cost figures are currency on the wire (not SI
// distances), so there is no unit conversion — only currency formatting at the render boundary.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/CostForecastWidget — the P3 prompt's allowed-files path) cannot form
// a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.costforecast

import io.teslasync.android.components.charts.ChartFormat
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale

private const val EM_DASH = "\u2014"
private const val DEFAULT_CURRENCY = "$"

/** Web `↑`/`↓` trend glyphs — the up/down arrows the compact + standard Trend stats prefix. */
private const val ARROW_UP = "\u2191"
private const val ARROW_DOWN = "\u2193"

/** Web `formatCurrency(nextCost, 0)` / the Y-axis `fmt(v, 0)` — integer currency (zero fraction digits). */
private const val INT_DECIMALS = 0

/** Web `formatCurrency(cost_per_kwh ?? 0, 2)` — the Avg $/kWh stat uses two fraction digits. */
private const val PER_KWH_DECIMALS = 2

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The
 * [isCompact] branch reproduces the web `size.cols <= 1` test that swaps the stat-row + bar-chart
 * standard layout for the two-stat (Next Month + Trend) compact summary; [isWide] mirrors the web
 * `size.cols >= 3` axis-tick toggle (Vico subsumes the tick-density tuning, so it carries no separate
 * native branch but is preserved for parity/clarity).
 */
data class CostForecastSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `size.cols <= 1`): the two-stat compact summary, no chart. */
    val isCompact: Boolean get() = cols <= 1

    /** True at three+ columns (web `size.cols >= 3`): the web widens the axis ticks. */
    val isWide: Boolean get() = cols >= 3
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/charging.ts (`cost-forecast`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay
 * in lockstep.
 */
object CostForecastRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "cost-forecast"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "charging"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "CostForecastWidget"

    /** Trailing window the chart covers: 6 months (web `buildChartData(...).slice(-6)`). */
    const val MAX_BARS = 6

    /** Default footprint: 2 columns × 4 rows (web `defaultSize`). */
    val defaultSize = CostForecastSize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val minSize = CostForecastSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val maxSize = CostForecastSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: CostForecastSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: CostForecastSize): CostForecastSize =
        CostForecastSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * The user's display preference this surface needs — the native port of the web `useFormatting` read
 * from the `/settings` document: just the [currencySymbol] (blank → "$"). Every cost value the widget
 * renders is formatted with an explicit fraction-digit count (web `formatCurrency(x, 0)` /
 * `formatCurrency(x, 2)`), so — unlike a distance widget — no unit conversion or stored precision is
 * needed here.
 */
data class CostForecastDisplayPrefs(
    val currencySymbol: String,
) {
    companion object {
        /** The `$` default used before settings load (matches the web `currency_symbol ?? '$'` fallback). */
        val DEFAULT = CostForecastDisplayPrefs(DEFAULT_CURRENCY)

        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"

        /**
         * Resolves the display preference from the raw `/settings` document (web `useFormatting`): the
         * `currency_symbol`, trimmed, with a blank / absent value falling back to "$" exactly as the web
         * `settings.currency_symbol && trim ? … : '$'` guard does.
         */
        fun fromSettings(settings: JsonElement?): CostForecastDisplayPrefs {
            val rawSymbol = (settings as? JsonObject)?.get(KEY_CURRENCY_SYMBOL) as? JsonPrimitive
            val symbol = rawSymbol?.contentOrNull?.trim()
            return CostForecastDisplayPrefs(currencySymbol = if (!symbol.isNullOrEmpty()) symbol else DEFAULT_CURRENCY)
        }
    }
}

/**
 * Localized labels the surface folds into its output — the six web `t('widget.costForecast.…')` keys the
 * component reads. The pure [CostForecastProjection] reads these to assemble each visible string + the
 * chart's TalkBack description; the composable builds this from `stringResource`, while tests pass a
 * deterministic instance.
 */
data class CostForecastStrings(
    val title: String,
    val noData: String,
    val nextMonth: String,
    val trend: String,
    val avgPerKwh: String,
    val costLabel: String,
)

/**
 * One decoded `historical` entry reduced to the three fields the web component reads: the [month] label
 * ('YYYY-MM' on the wire), the month's EV charging [cost], and its [costPerKwh] (used only by the last
 * historical month's Avg $/kWh stat). The other wire fields (`kwh`, `sessions`) are not rendered, so —
 * like the web — they are intentionally not decoded.
 */
data class HistoricalMonth(
    val month: String,
    val cost: Double,
    val costPerKwh: Double,
)

/**
 * One decoded `forecast` entry reduced to the two fields the web component reads: the [month] label and
 * the projected [cost]. The confidence band (`cost_low`/`cost_high`) and `kwh` are not rendered by this
 * surface, so — like the web — they are intentionally not decoded.
 */
data class ForecastMonth(
    val month: String,
    val cost: Double,
)

/**
 * The decoded cost-forecast payload — the native analogue of the web `CostForecastData` shape the
 * component reads (`data?.historical`, `data?.forecast`). All numerics are currency/raw on the wire;
 * currency formatting happens in [CostForecastProjection]. Missing/absent arrays collapse to empty,
 * exactly like the web optional-chaining (`data?.historical ?? []`).
 */
data class CostForecastData(
    val historical: List<HistoricalMonth>,
    val forecast: List<ForecastMonth>,
) {
    /** Web `hasData = chartData.length > 0` — at least one historical or forecast month exists. */
    val hasData: Boolean get() = historical.isNotEmpty() || forecast.isNotEmpty()

    companion object {
        /** The empty snapshot, surfaced for a null payload or when no vehicle resolves. */
        val EMPTY = CostForecastData(emptyList(), emptyList())
    }
}

/**
 * One projected, render-ready chart bar — the native analogue of a web `BarDatum`. [month] is the raw
 * 'YYYY-MM' label the web plots verbatim, [cost] is the month's currency value, and [isForecast] flags a
 * projected month (the web computes this on every datum; both historical and forecast bars render in the
 * same indigo, so the flag drives only the accessible description here).
 */
data class ForecastBar(
    val month: String,
    val cost: Double,
    val isForecast: Boolean,
)

/** A projected summary stat: a [label] and an already-formatted [value] (currency embedded). */
data class ForecastStat(
    val label: String,
    val value: String,
)

/**
 * The fully projected, render-ready view of the widget body for one footprint — the native analogue of
 * everything the web component computes before returning JSX (`chartData`, `nextCost`, `lastCost`,
 * `trendUp`, the compact/standard `WidgetChartSummary` stats, and the `hasData` gate). Pure data (no
 * Compose types) so the projection is unit-tested without a UI host. [compactStats] holds the two stats
 * the 1-column branch shows; [standardStats] holds the three the wider branch shows.
 */
data class CostForecastDisplay(
    val hasData: Boolean,
    val bars: List<ForecastBar>,
    val compactStats: List<ForecastStat>,
    val standardStats: List<ForecastStat>,
    val trendUp: Boolean,
    val currencySymbol: String,
    val chartContentDescription: String,
    val emptyMessage: String,
)

/**
 * Decodes the raw `/analytics/cost-forecast` [json] (snake_case on the wire) into a [CostForecastData].
 * A non-object input, missing arrays, or JSON-null arrays all collapse to empty — reproducing the web
 * optional-chaining (`data?.historical ?? []`). A malformed array element contributes a zero-cost month
 * (web `h.cost ?? 0`) rather than throwing.
 */
fun parseCostForecast(json: JsonElement?): CostForecastData {
    val obj = json as? JsonObject ?: return CostForecastData.EMPTY
    val historical =
        (obj["historical"] as? JsonArray)
            ?.mapNotNull { element -> (element as? JsonObject)?.toHistorical() }
            ?: emptyList()
    val forecast =
        (obj["forecast"] as? JsonArray)
            ?.mapNotNull { element -> (element as? JsonObject)?.toForecast() }
            ?: emptyList()
    return CostForecastData(historical = historical, forecast = forecast)
}

private fun JsonObject.toHistorical(): HistoricalMonth =
    HistoricalMonth(
        month = monthOrDash(),
        cost = double("cost"),
        costPerKwh = double("cost_per_kwh"),
    )

private fun JsonObject.toForecast(): ForecastMonth =
    ForecastMonth(
        month = monthOrDash(),
        cost = double("cost"),
    )

private fun JsonObject.monthOrDash(): String = (this["month"] as? JsonPrimitive)?.contentOrNull ?: EM_DASH

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

/**
 * Pure projection from a decoded [CostForecastData] to the render-ready [CostForecastDisplay] — the
 * native port of the inline `useMemo` derivations + JSX formatting in the web source. Builds the
 * trailing-6 historical+forecast bars (web `buildChartData(...).slice(-6)`), derives next-month / last-
 * month / trend, and assembles the compact (Next Month + Trend) and standard (Next Month + Avg $/kWh +
 * Trend) stat rows. Currency is formatted via [formatCurrency] reproducing the web `useFormatting`
 * `currencySymbol + fmtNumber` contract; [locale] drives the grouping/separators (tests pin [Locale.US]).
 */
object CostForecastProjection {
    /** Project [data] for the user's [prefs] and localized [strings]. */
    fun project(
        data: CostForecastData,
        prefs: CostForecastDisplayPrefs,
        strings: CostForecastStrings,
        locale: Locale = Locale.US,
    ): CostForecastDisplay {
        val symbol = prefs.currencySymbol
        val bars = buildBars(data)

        val nextCost = data.forecast.firstOrNull()?.cost ?: 0.0
        val lastHistorical = data.historical.lastOrNull()
        val lastCost = lastHistorical?.cost ?: 0.0
        val trendUp = nextCost >= lastCost

        val nextMonthValue = formatCurrency(nextCost, INT_DECIMALS, symbol, locale)
        val avgPerKwhValue =
            if (lastHistorical != null) formatCurrency(lastHistorical.costPerKwh, PER_KWH_DECIMALS, symbol, locale) else EM_DASH
        val trendArrow = if (trendUp) ARROW_UP else ARROW_DOWN
        val trendDelta = if (trendUp) nextCost - lastCost else lastCost - nextCost
        val trendStandardValue = "$trendArrow ${formatCurrency(trendDelta, INT_DECIMALS, symbol, locale)}"

        return CostForecastDisplay(
            hasData = data.hasData,
            bars = bars,
            compactStats =
                listOf(
                    ForecastStat(strings.nextMonth, nextMonthValue),
                    ForecastStat(strings.trend, trendArrow),
                ),
            standardStats =
                listOf(
                    ForecastStat(strings.nextMonth, nextMonthValue),
                    ForecastStat(strings.avgPerKwh, avgPerKwhValue),
                    ForecastStat(strings.trend, trendStandardValue),
                ),
            trendUp = trendUp,
            currencySymbol = symbol,
            chartContentDescription = chartDescription(bars, strings),
            emptyMessage = strings.noData,
        )
    }

    /**
     * Builds the trailing-6 bar series — the web `buildChartData(historical, forecast)`: every historical
     * month (`isForecast = false`) followed by every forecast month (`isForecast = true`), then
     * `slice(-6)`. Each datum's cost defaults to zero for a missing value (web `?? 0`).
     */
    fun buildBars(data: CostForecastData): List<ForecastBar> {
        val historical = data.historical.map { ForecastBar(month = it.month, cost = it.cost, isForecast = false) }
        val forecast = data.forecast.map { ForecastBar(month = it.month, cost = it.cost, isForecast = true) }
        return (historical + forecast).takeLast(CostForecastRegistration.MAX_BARS)
    }

    /**
     * Formats a currency [amount] as the web `formatCurrency` does — the user's [symbol] (blank → "$")
     * followed by a [decimals]-digit grouped number — via the shared [ChartFormat.number] (the same
     * locale-aware formatter every native cost widget uses).
     */
    fun formatCurrency(
        amount: Double,
        decimals: Int,
        symbol: String,
        locale: Locale = Locale.US,
    ): String = "${symbol.ifBlank { DEFAULT_CURRENCY }}${ChartFormat.number(amount, decimals.coerceAtLeast(0), locale)}"

    private fun chartDescription(
        bars: List<ForecastBar>,
        strings: CostForecastStrings,
    ): String {
        if (bars.isEmpty()) return strings.noData
        val months = bars.joinToString(", ") { it.month }
        return "${strings.title}: $months"
    }
}
