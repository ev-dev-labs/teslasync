// Pure, framework-free model + projection for the ChargingDetailSection feature view — the native
// analogue of everything the web component derives via `useMemo`/inline maps before returning JSX
// (web/src/features/analytics/components/analytics/ChargingDetailSection.tsx). No Compose, no Android, no
// HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping
// the composable a thin render layer over these pure functions.
//
// The web component is purely presentational — its parent (the analytics page) loads the `FleetAnalytics`
// document and passes it down; the component reads `data.charging_analytics` and renders four panels
// (charger-brand leaderboard, monthly-trend composed chart, cost-stat cards, cost-by-charger-type bars),
// each with its own empty state. This file owns the parts the web expresses inline: the null-safe decode
// of the raw `/analytics/fleet` JSON (web optional-chaining → typed reads), the brand leaderboard
// fractions (web `pct = count / maxCount`), the charger-type share fractions (web `count / totalSessions`),
// the four formatted cost values (web `formatCurrency(safe(x), 2)`), the monthly chart series + labels, and
// the lifecycle projection onto the shared cache-then-network [UiState] (so the surface renders every state
// the P1/S8 layer can carry). Currency formatting reproduces the web `useFormatting` `currencySymbol +
// fmtNumber` contract; `fmtInt`/`safe` are mirrored as [ChargingDetailSectionProjection.formatCount] and
// [safeValue].
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ChargingDetailSection — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.chargingdetailsection

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale
import kotlin.math.max
import kotlin.math.roundToLong

/** Em dash shown for a missing label — the web `—` fallback. */
internal const val EM_DASH: String = "\u2014"

/** Default currency symbol when the settings document has none (web `useFormatting` `'$'`). */
internal const val DEFAULT_CURRENCY: String = "$"

/** Cost-card fraction digits — the web `formatCurrency(x, 2)` literal precision. */
internal const val COST_DECIMALS: Int = 2

/** Percent scale for the share bars (web `(count / total) * 100`). */
private const val PERCENT: Double = 100.0

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object ChargingDetailSectionRegistration {
    /** Stable surface id. */
    const val ID: String = "charging-detail-section"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ChargingDetailSection"
}

/**
 * One charger-brand leaderboard row — the native mirror of a web `charger_brands` entry
 * (`{ brand: string; count: number }`). [count] is the number of sessions at that brand (a non-negative
 * integer, so `Long`).
 */
data class ChargerBrand(
    val brand: String,
    val count: Long,
)

/**
 * One charger-type share row — the native mirror of a web `charger_types` entry
 * (`{ type: string; count: number }`).
 */
data class ChargerType(
    val type: String,
    val count: Long,
)

/**
 * One monthly-trend point — the native mirror of the web `monthly_trend` entry. The section reads four of
 * its fields: the [month] label (chart X axis), [energy] (kWh, the area series), [avgPower] (kW, the line
 * series), and [sessions] (the column series).
 */
data class MonthlyChargingPoint(
    val month: String,
    val energy: Double,
    val avgPower: Double,
    val sessions: Long,
)

/**
 * The four cost statistics the section's cards render — the native mirror of the web `StatsSummary` fields
 * the panel reads (`min`/`avg`/`median`/`max`). The other `StatsSummary` fields (`p95`/`count`) are not
 * shown by this section, so they are intentionally omitted.
 */
data class CostStats(
    val min: Double,
    val avg: Double,
    val median: Double,
    val max: Double,
)

/**
 * The decoded `charging_analytics` slice this section renders — the native projection of the parts of the
 * web `FleetAnalytics.charging_analytics` the component reads. Built from the raw `/analytics/fleet`
 * document by [ChargingDetailSectionProjection.parse], or constructed directly by a host that already
 * holds typed analytics.
 */
data class ChargingAnalyticsData(
    val brands: List<ChargerBrand>,
    val chargerTypes: List<ChargerType>,
    val monthlyTrend: List<MonthlyChargingPoint>,
    val costStats: CostStats?,
) {
    companion object {
        /** The all-empty value — the web `data?.charging_analytics` `undefined` outcome (all panels empty). */
        val EMPTY: ChargingAnalyticsData = ChargingAnalyticsData(emptyList(), emptyList(), emptyList(), null)
    }
}

/**
 * The user's currency display preference this surface needs — the native port of the web `useFormatting`
 * read of the `/settings` document. Only the [currencySymbol] is needed: the four cost cards format with
 * the literal 2-digit precision (web `formatCurrency(x, 2)`), so the user's `decimal_precision` does not
 * apply here.
 */
data class ChargingCurrencyPrefs(
    val currencySymbol: String,
) {
    companion object {
        /** The `$` default used before settings load (matches the web default). */
        val DEFAULT: ChargingCurrencyPrefs = ChargingCurrencyPrefs(DEFAULT_CURRENCY)

        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"

        /** Resolves the currency symbol from the raw `/settings` document (web `useFormatting`). */
        fun fromSettings(settings: JsonElement?): ChargingCurrencyPrefs {
            val raw = (settings as? JsonObject)?.get(KEY_CURRENCY_SYMBOL) as? JsonPrimitive
            val symbol = raw?.contentOrNull?.trim()
            return ChargingCurrencyPrefs(if (!symbol.isNullOrEmpty()) symbol else DEFAULT_CURRENCY)
        }
    }
}

/**
 * One render-ready brand leaderboard bar. [value]/[max] feed the proportional `MetricBar` fill (web bar
 * width `pct = count / maxCount`); [rank] + [brand] build the localized `#1 Tesla` label and [countText] is
 * the grouped session count (web `fmtInt(count)`) the composable joins with the localized "sessions" word.
 */
data class BrandBar(
    val rank: Int,
    val brand: String,
    val countText: String,
    val value: Double,
    val max: Double,
)

/**
 * One render-ready charger-type share bar. [value]/[max] feed the proportional `MetricBar` fill (web bar
 * width `pct = count / totalSessions`); [valueText] is the web `{count} ({fmtInt(pct)}%)` label and
 * [colorIndex] selects the categorical palette color (web `CHART_COLORS[i % len]`).
 */
data class ChargerTypeBar(
    val type: String,
    val valueText: String,
    val value: Double,
    val max: Double,
    val colorIndex: Int,
)

/** The four formatted cost-card values (web `formatCurrency(safe(x), 2)`), in source order. */
data class CostCardValues(
    val min: String,
    val avg: String,
    val median: String,
    val max: String,
)

/**
 * The fully projected monthly-trend chart inputs — the native analogue of the web `ComposedChart` data
 * binding. [labels] are the month X-axis labels; [energy]/[avgPower]/[sessions] are the per-month series
 * values in label order (the area, line, and column series). [isEmpty] mirrors the web
 * `monthlyTrend.length > 0` guard so the section shows its empty state instead of a blank plot.
 */
data class MonthlyChartData(
    val labels: List<String>,
    val energy: List<Double?>,
    val avgPower: List<Double?>,
    val sessions: List<Double?>,
    val isEmpty: Boolean,
)

/**
 * Pure projection from the section's inputs to its render state — a 1:1 port of the web component's inline
 * derivations and value formatting. Stateless and side-effect-free so it is fully covered by the off-device
 * unit gate; the composable only resolves localized strings, glyphs, accents, and colors and draws what
 * these return.
 */
object ChargingDetailSectionProjection {
    /**
     * Maps the section's `(data, isLoading)` props onto the shared cache-then-network [UiState] (P1/S8).
     * The web component itself has no loading/error surface (its parent owns those); this adapter adds the
     * lifecycle states the host's feed can carry while preserving web precedence:
     *  - loading → [UiPhase.Loading];
     *  - not loading + data present → [UiPhase.Content] (the four panels, each content-or-empty);
     *  - not loading + no data → [UiPhase.Empty] (the web `data?.charging_analytics` `undefined` outcome —
     *    the four panels still render, each in its own empty state).
     */
    fun projectUiState(
        data: ChargingAnalyticsData?,
        isLoading: Boolean,
    ): UiState<ChargingAnalyticsData> =
        when {
            isLoading -> UiState.loading()
            data != null -> UiState(phase = UiPhase.Content, data = data)
            else -> UiState(phase = UiPhase.Empty)
        }

    /**
     * The brand leaderboard rows in received order — the native mirror of the web `brandLeaderboard`
     * `useMemo`. Each row's [BrandBar.value]/[BrandBar.max] reproduce the web bar width
     * `pct = count / maxCount` (with `maxCount` floored at 1, matching the web `|| 1`), and [BrandBar.rank]
     * is the 1-based position (web `#{idx + 1}`). [locale] groups the session count (web `fmtInt`).
     */
    fun brandLeaderboard(
        brands: List<ChargerBrand>,
        locale: Locale,
    ): List<BrandBar> {
        val maxCount = max(brands.fold(0L) { m, b -> max(m, safeCount(b.count)) }, 1L)
        return brands.mapIndexed { index, b ->
            val count = safeCount(b.count)
            BrandBar(
                rank = index + 1,
                brand = b.brand,
                countText = formatCount(count, locale),
                value = count + 0.0,
                max = maxCount + 0.0,
            )
        }
    }

    /**
     * The charger-type share bars in received order — the native mirror of the web `chargerTypes.map`. The
     * share is `count / totalSessions` (web `pct`, 0 when there are no sessions); [ChargerTypeBar.valueText]
     * reproduces the web `{count} ({fmtInt(pct)}%)` (the raw count, then the grouped, rounded percentage).
     * [locale] groups the percentage (web `fmtInt`).
     */
    fun chargerTypeBars(
        chargerTypes: List<ChargerType>,
        locale: Locale,
    ): List<ChargerTypeBar> {
        val totalSessions = chargerTypes.fold(0L) { s, x -> s + safeCount(x.count) }
        return chargerTypes.mapIndexed { index, ct ->
            val count = safeCount(ct.count)
            // `+ 0.0` widens the Long counts to the bar's Double value type.
            val pct = if (totalSessions > 0L) (count + 0.0) / totalSessions * PERCENT else 0.0
            ChargerTypeBar(
                type = ct.type,
                valueText = "$count (${formatCount(pct, locale)}%)",
                value = count + 0.0,
                max = totalSessions + 0.0,
                colorIndex = index,
            )
        }
    }

    /**
     * The four formatted cost-card values, or `null` when there are no cost statistics (web `costStats ?
     * cards : EmptyState`). Each value is the web `formatCurrency(safe(x), 2)`: the currency symbol then the
     * grouped, 2-digit amount. [locale] drives the grouping/decimal separators.
     */
    fun costCards(
        stats: CostStats?,
        currency: ChargingCurrencyPrefs,
        locale: Locale,
    ): CostCardValues? {
        if (stats == null) return null
        val symbol = currency.currencySymbol
        return CostCardValues(
            min = formatCurrency(stats.min, symbol, COST_DECIMALS, locale),
            avg = formatCurrency(stats.avg, symbol, COST_DECIMALS, locale),
            median = formatCurrency(stats.median, symbol, COST_DECIMALS, locale),
            max = formatCurrency(stats.max, symbol, COST_DECIMALS, locale),
        )
    }

    /**
     * The monthly-trend chart inputs, preserving received (chronological) order — the native analogue of
     * the web `ComposedChart data={monthlyTrend}` binding. Each non-finite series sample is normalized to 0
     * via [safeValue] so a gap never renders as `NaN`.
     */
    fun monthlyChart(points: List<MonthlyChargingPoint>): MonthlyChartData =
        MonthlyChartData(
            labels = points.map { it.month },
            energy = points.map { safeValue(it.energy) },
            avgPower = points.map { safeValue(it.avgPower) },
            sessions = points.map { safeCount(it.sessions) + 0.0 },
            isEmpty = points.isEmpty(),
        )

    /**
     * Currency formatting — the web `useFormatting` `currencySymbol + fmtNumber(amount, decimals)` contract,
     * via the shared [ChartFormat.number] (the same locale-aware formatter every native cost surface uses).
     * A blank symbol falls back to `$`; a non-finite amount is normalized to 0 (web `safe`).
     */
    fun formatCurrency(
        amount: Double,
        symbol: String,
        decimals: Int,
        locale: Locale,
    ): String = "${symbol.ifBlank { DEFAULT_CURRENCY }}${ChartFormat.number(safeValue(amount), decimals.coerceAtLeast(0), locale)}"

    /**
     * Locale-aware grouped integer formatting — the native mirror of the web `fmtInt` (`fmtNumber(v, 0)`).
     * Groups thousands and rounds half away from zero so the output matches ECMAScript `Intl.NumberFormat`
     * (`halfExpand`) rather than Java's default banker's rounding. Accepts any [Number] (the integer counts
     * or the fractional percentage).
     */
    fun formatCount(
        value: Number,
        locale: Locale,
    ): String =
        DecimalFormat("#,##0", DecimalFormatSymbols(locale))
            .apply { roundingMode = RoundingMode.HALF_UP }
            .format(value)

    /**
     * Decodes the raw `/analytics/fleet` document into the typed [ChargingAnalyticsData] this section reads
     * — the native port of the web optional-chaining (`data?.charging_analytics?.charger_brands ?? []`, …).
     * Any missing/malformed branch degrades to an empty list / `null` so the section never throws on a
     * partial payload; element order is preserved (the backend returns brands sorted, types/months ordered).
     */
    fun parse(analyticsDoc: JsonElement?): ChargingAnalyticsData {
        val ca = (analyticsDoc as? JsonObject)?.obj(KEY_CHARGING_ANALYTICS) ?: return ChargingAnalyticsData.EMPTY
        return ChargingAnalyticsData(
            brands = ca.array(KEY_CHARGER_BRANDS).mapNotNull { it.toBrand() },
            chargerTypes = ca.array(KEY_CHARGER_TYPES).mapNotNull { it.toChargerType() },
            monthlyTrend = ca.array(KEY_MONTHLY_TREND).mapNotNull { it.toMonthlyPoint() },
            costStats = ca.obj(KEY_COST_STATS)?.toCostStats(),
        )
    }

    /** Web `safe(v)` for an integer count: a negative or non-finite source becomes 0. */
    private fun safeCount(count: Long): Long = if (count > 0L) count else 0L

    private fun JsonElement.toBrand(): ChargerBrand? {
        val o = this as? JsonObject ?: return null
        return ChargerBrand(brand = o.string(KEY_BRAND), count = o.long(KEY_COUNT))
    }

    private fun JsonElement.toChargerType(): ChargerType? {
        val o = this as? JsonObject ?: return null
        return ChargerType(type = o.string(KEY_TYPE), count = o.long(KEY_COUNT))
    }

    private fun JsonElement.toMonthlyPoint(): MonthlyChargingPoint? {
        val o = this as? JsonObject ?: return null
        return MonthlyChargingPoint(
            month = o.string(KEY_MONTH),
            energy = o.double(KEY_ENERGY),
            avgPower = o.double(KEY_AVG_POWER),
            sessions = o.long(KEY_SESSIONS),
        )
    }

    private fun JsonObject.toCostStats(): CostStats =
        CostStats(
            min = double(KEY_MIN),
            avg = double(KEY_AVG),
            median = double(KEY_MEDIAN),
            max = double(KEY_MAX),
        )

    private fun JsonObject.obj(key: String): JsonObject? = this[key] as? JsonObject

    private fun JsonObject.array(key: String): JsonArray = this[key] as? JsonArray ?: JsonArray(emptyList())

    private fun JsonObject.string(key: String): String = (this[key] as? JsonPrimitive)?.contentOrNull ?: ""

    private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

    private fun JsonObject.long(key: String): Long {
        val primitive = this[key] as? JsonPrimitive ?: return 0L
        return primitive.longOrNull ?: primitive.doubleOrNull?.roundToLong() ?: 0L
    }

    private const val KEY_CHARGING_ANALYTICS = "charging_analytics"
    private const val KEY_CHARGER_BRANDS = "charger_brands"
    private const val KEY_CHARGER_TYPES = "charger_types"
    private const val KEY_MONTHLY_TREND = "monthly_trend"
    private const val KEY_COST_STATS = "cost_stats"
    private const val KEY_BRAND = "brand"
    private const val KEY_TYPE = "type"
    private const val KEY_COUNT = "count"
    private const val KEY_MONTH = "month"
    private const val KEY_ENERGY = "energy"
    private const val KEY_AVG_POWER = "avg_power"
    private const val KEY_SESSIONS = "sessions"
    private const val KEY_MIN = "min"
    private const val KEY_AVG = "avg"
    private const val KEY_MEDIAN = "median"
    private const val KEY_MAX = "max"
}

/** Web `safe(v)` for a real value: a non-finite source (NaN/±∞) becomes 0, so a chart never plots `NaN`. */
internal fun safeValue(value: Double): Double = if (value.isFinite()) value else 0.0

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [ChargingDetailSectionRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it
 * from its first-composition effect. Carries no VIN, location, or cost — only the surface slug.
 */
fun recordChargingDetailSectionOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to ChargingDetailSectionRegistration.SLUG))
}
