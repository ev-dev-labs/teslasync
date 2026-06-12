// Pure, framework-free model + projection for the ForecastDetails feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/charging/components/cost-analysis/ForecastDetails.tsx). No Compose, no Android, no HTTP:
// every declaration here is exercised off-device by the :app:testReleaseUnitTest gate, keeping the composable
// a thin render layer.
//
// ForecastDetails is a presentational surface — the web component takes a single `forecastData`
// (`CostForecastData | undefined`) prop from the Cost Analysis page (which owns the TanStack query), so this
// surface binds no data feed of its own. Its only web hooks are `useTranslation` (the `costAnalysis.forecast.*`
// + `Home`/`Supercharger` keys) and `useFormatting` (the currency symbol). The cache-then-network lifecycle
// (loading / error / stale / offline) is supplied by the owning page through the shared P1/S8 state-holder
// layer as a [io.teslasync.android.data.UiState]; the composable renders every state that layer can carry
// without ever fetching, plus the web-parity `forecastData?` overload for hosts that already hold the value.
//
// From the prop the web renders three GlassPanels: a donut of the Home vs Supercharger charging mix (sized by
// each category's `pct`) with a per-category `formatCurrency(avg_cost_per_kwh, 3)/kWh` legend; a Gas-vs-EV
// savings block (a `$`-prefixed monthly-savings count-up, annual/lifetime `Currency(_, 0)`, the monthly gas
// cost / EV cost / average distance); and a list of free-text insights. This file owns the parts the web
// render derives from the prop: the two fixed donut slices and their proportional sweep, and every formatted
// money / number string (the web `<Currency>` / `<AnimatedNumber>` / `fmtNumber` outputs).
//
// SI / units boundary (unit-conversion instructions): `avg_cost_per_kwh`, the savings, and the gas/EV costs
// are monetary values, not SI physical quantities, so no `useUnits()` conversion applies — the only formatting
// is currency (symbol + grouped number) and a grouped integer for the average monthly distance, kept
// locale-deterministic by injecting the symbol + [java.util.Locale] into [ForecastDetailsProjection.project].
//
// [ForecastData] mirrors the subset of the web `CostForecastData` interface this surface reads (the
// `breakdown`, `gas_comparison`, and `insights` fields — never the `historical` / `forecast` arrays the sibling
// charts own), with snake_case wire names via @SerialName and every field defaulted, so it decodes straight
// off the cached cost-forecast JSON (a decoder must ignore unknown keys).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ForecastDetails — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling CostHeatmap / ChargingBreakdownSlide surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.forecastdetails

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.util.Locale
import kotlin.math.roundToInt

/** Default currency symbol when the settings document has none — the web `useFormatting` `'$'`. */
internal const val DEFAULT_CURRENCY: String = "$"

/** Per-kWh rate fraction digits — the web breakdown `<Currency precision={3} />`. */
internal const val PER_KWH_DECIMALS: Int = 3

/** Annual / lifetime savings fraction digits — the web `<Currency precision={0} />`. */
internal const val WHOLE_DECIMALS: Int = 0

/** Monthly gas / EV cost fraction digits — the web `<Currency />` default `precision = 2`. */
internal const val MONEY_DECIMALS: Int = 2

/** Monthly-savings count-up fraction digits — the web `<AnimatedNumber decimals={0} />`. */
internal const val SAVINGS_DECIMALS: Int = 0

/** "Avg km/mo" fraction digits — the web `fmtNumber(avg_km_per_month, 0)`. */
internal const val KM_DECIMALS: Int = 0

/**
 * One charging-source category — the native mirror of the web `ChargerCategoryData`. Only the two fields this
 * surface reads are modelled: [pct] (the donut slice's proportional size, web `breakdown.{kind}.pct`) and
 * [avgCostPerKwh] (the legend's per-kWh rate, web `breakdown.{kind}.avg_cost_per_kwh`); the unused
 * `monthly_avg` column is skipped. Both default to 0 so a partial payload decodes without error.
 */
@Serializable
data class ChargerCategory(
    @SerialName("pct") val pct: Double = 0.0,
    @SerialName("avg_cost_per_kwh") val avgCostPerKwh: Double = 0.0,
)

/**
 * The Home vs Supercharger split — the native mirror of the web `CostBreakdownData`. Each category defaults to
 * a zeroed [ChargerCategory] so a missing `breakdown` object still decodes.
 */
@Serializable
data class CostBreakdown(
    @SerialName("home") val home: ChargerCategory = ChargerCategory(),
    @SerialName("supercharger") val supercharger: ChargerCategory = ChargerCategory(),
)

/**
 * The gas-vs-EV comparison figures — the native mirror of the web `GasComparisonData`. snake_case wire names
 * via @SerialName, every field defaulted to 0 (the web `data?.x ?? 0` behaviour) so a partial payload decodes.
 */
@Serializable
data class GasComparison(
    @SerialName("avg_km_per_month") val avgKmPerMonth: Double = 0.0,
    @SerialName("gas_cost_per_month") val gasCostPerMonth: Double = 0.0,
    @SerialName("ev_cost_per_month") val evCostPerMonth: Double = 0.0,
    @SerialName("monthly_savings") val monthlySavings: Double = 0.0,
    @SerialName("annual_savings") val annualSavings: Double = 0.0,
    @SerialName("lifetime_savings") val lifetimeSavings: Double = 0.0,
)

/**
 * The subset of the web `CostForecastData` payload this surface renders — the `breakdown`, `gas_comparison`,
 * and `insights` fields the web component reads from its `forecastData` prop. The `historical` / `forecast`
 * time-series arrays (owned by the sibling forecast charts) are intentionally not modelled; a decoder ignoring
 * unknown keys skips them. Every field defaults so a partial or still-loading payload decodes without error.
 */
@Serializable
data class ForecastData(
    @SerialName("breakdown") val breakdown: CostBreakdown = CostBreakdown(),
    @SerialName("gas_comparison") val gasComparison: GasComparison = GasComparison(),
    @SerialName("insights") val insights: List<String> = emptyList(),
)

/**
 * A charging-source category for the breakdown donut. The declared order (Home, then Supercharger) is the
 * exact order the web builds its `<Pie>` data array, which the composable relies on so the positional palette
 * (Home → green, Supercharger → amber) matches the web `<Cell fill>` mapping.
 */
enum class ChargerKind {
    Home,
    Supercharger,
}

/**
 * One donut slice — a charging [kind], its raw [pct] (web `breakdown.{kind}.pct`, the basis of the slice's
 * proportional sweep), and the already-formatted [costPerKwhLabel] the legend renders (web
 * `formatCurrency(avg_cost_per_kwh, 3)` + the localized per-kWh word). Pure data so the projection is
 * unit-tested without a UI host; the localized source label and the positional color are resolved at the
 * Compose boundary.
 */
data class BreakdownSlice(
    val kind: ChargerKind,
    val pct: Double,
    val costPerKwhLabel: String,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component formats before
 * returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property breakdown the two donut slices in fixed Home → Supercharger order (web `<Pie>` cells + legend).
 * @property monthlySavings the raw monthly-savings value, fed to the composable's count-up which applies the
 *   `$` prefix + locale grouping the web `<AnimatedNumber>` does (a render-boundary concern, not pre-formatted).
 * @property monthlySavingsText the settled, currency-prefixed monthly-savings string — the count-up's
 *   reduced-motion value and accessible description so TalkBack never reads a half-counted figure.
 * @property annualText the annual savings, web `<Currency value={annual_savings} precision={0} />`.
 * @property lifetimeText the lifetime savings, web `<Currency value={lifetime_savings} precision={0} />`.
 * @property gasCostText the monthly gas cost, web `<Currency value={gas_cost_per_month} />` (precision 2).
 * @property evCostText the monthly EV cost, web `<Currency value={ev_cost_per_month} />` (precision 2).
 * @property avgKmText the average monthly distance, web `fmtNumber(avg_km_per_month, 0)` (no currency symbol).
 * @property insights the free-text insight strings, passed through verbatim (web `forecastData.insights`).
 */
data class ForecastDetailsDisplay(
    val breakdown: List<BreakdownSlice>,
    val monthlySavings: Double,
    val monthlySavingsText: String,
    val annualText: String,
    val lifetimeText: String,
    val gasCostText: String,
    val evCostText: String,
    val avgKmText: String,
    val insights: List<String>,
) {
    /**
     * True when there is at least one insight to list — the web `(forecastData?.insights ?? []).length > 0`
     * guard. The composable renders the friendly empty state otherwise, so the panel is never a blank box.
     */
    val hasInsights: Boolean get() = insights.isNotEmpty()
}

/**
 * The user's currency display preference this surface needs — the native port of the web `useFormatting` read
 * of the `/settings` document. Only the [currencySymbol] is needed (every figure is formatted with a literal
 * precision, so the user's `decimal_precision` does not apply here).
 *
 * @property currencySymbol the symbol prefixed to a formatted amount (web `settings.currency_symbol`, `'$'`).
 */
data class ForecastDetailsCurrencyPrefs(
    val currencySymbol: String,
) {
    companion object {
        /** The default ($) preference used for previews / cold start before settings load. */
        val DEFAULT: ForecastDetailsCurrencyPrefs = ForecastDetailsCurrencyPrefs(DEFAULT_CURRENCY)

        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"

        /** Resolves the currency symbol from the raw `/settings` document (web `useFormatting`). */
        fun fromSettings(settings: JsonElement?): ForecastDetailsCurrencyPrefs {
            val raw = (settings as? JsonObject)?.get(KEY_CURRENCY_SYMBOL) as? JsonPrimitive
            val symbol = raw?.contentOrNull?.trim()
            return ForecastDetailsCurrencyPrefs(if (!symbol.isNullOrEmpty()) symbol else DEFAULT_CURRENCY)
        }
    }
}

/**
 * Pure projection from a [ForecastData] to its render-ready [ForecastDetailsDisplay] — a 1:1 port of the
 * formatting the web component performs (the `<Currency>` / `<AnimatedNumber>` / `fmtNumber` outputs and the
 * two donut slices) before returning JSX. Stateless and side-effect-free so it is fully covered by the
 * off-device unit gate; the composable only resolves localized strings, the currency symbol, the donut sweep,
 * and the lifecycle chrome.
 */
object ForecastDetailsProjection {
    /**
     * Select the render-ready view for [data]. The two donut slices are always present (the web `<Pie>` is fed
     * both Home and Supercharger regardless of value); [perKwhWord] is the localized per-kWh suffix appended to
     * each slice's formatted rate (web `…/kWh`), and [currencySymbol] + [locale] format every money figure.
     */
    fun project(
        data: ForecastData,
        currencySymbol: String,
        perKwhWord: String,
        locale: Locale,
    ): ForecastDetailsDisplay {
        val gas = data.gasComparison
        return ForecastDetailsDisplay(
            breakdown =
                listOf(
                    slice(ChargerKind.Home, data.breakdown.home, currencySymbol, perKwhWord, locale),
                    slice(ChargerKind.Supercharger, data.breakdown.supercharger, currencySymbol, perKwhWord, locale),
                ),
            monthlySavings = gas.monthlySavings,
            monthlySavingsText = formatCurrency(gas.monthlySavings, currencySymbol, SAVINGS_DECIMALS, locale),
            annualText = formatCurrency(gas.annualSavings, currencySymbol, WHOLE_DECIMALS, locale),
            lifetimeText = formatCurrency(gas.lifetimeSavings, currencySymbol, WHOLE_DECIMALS, locale),
            gasCostText = formatCurrency(gas.gasCostPerMonth, currencySymbol, MONEY_DECIMALS, locale),
            evCostText = formatCurrency(gas.evCostPerMonth, currencySymbol, MONEY_DECIMALS, locale),
            avgKmText = formatNumber(gas.avgKmPerMonth, KM_DECIMALS, locale),
            insights = data.insights,
        )
    }

    private fun slice(
        kind: ChargerKind,
        category: ChargerCategory,
        currencySymbol: String,
        perKwhWord: String,
        locale: Locale,
    ): BreakdownSlice {
        val rate = formatCurrency(category.avgCostPerKwh, currencySymbol, PER_KWH_DECIMALS, locale)
        return BreakdownSlice(kind = kind, pct = category.pct, costPerKwhLabel = "$rate $perKwhWord")
    }

    /**
     * The proportional sweep fraction (0–1) of each donut slice — the native analogue of how the web `<Pie
     * dataKey="value">` sizes each cell by its `pct` relative to the slice total. A non-positive or non-finite
     * `pct` contributes 0; an all-zero breakdown yields all-zero fractions (an empty ring, matching how
     * Recharts renders a zero-total pie) rather than a divide-by-zero. The fractions sum to 1 for any positive
     * total, so the donut closes the full ring.
     */
    fun sweepFractions(breakdown: List<BreakdownSlice>): List<Double> {
        val total = breakdown.sumOf { positive(it.pct) }
        if (total <= 0.0) return List(breakdown.size) { 0.0 }
        return breakdown.map { positive(it.pct) / total }
    }

    /**
     * The whole-number percentage the donut's accessibility description reads for a slice, web
     * `Math.round(pct)`. Kotlin's [roundToInt] rounds halves towards positive infinity, matching JavaScript's
     * `Math.round`; a non-finite input folds to 0 so a malformed payload never crashes the surface.
     */
    fun percent(pct: Double): Int = if (pct.isFinite()) pct.roundToInt() else 0

    /**
     * Currency formatting — the web `<Currency>` contract: `currencySymbol + fmtNumber(value, precision)` for a
     * finite value, and the bare fallback marker ([ChartFormat.EMPTY], `'—'`, with no symbol) for a `null` /
     * non-finite value (web `!Number.isFinite(value)` → `fallback`). The number is grouped with [locale]
     * separators at [precision] fraction digits.
     */
    fun formatCurrency(
        value: Double,
        symbol: String,
        precision: Int,
        locale: Locale,
    ): String {
        if (!value.isFinite()) return ChartFormat.EMPTY
        return "${symbol.ifBlank { DEFAULT_CURRENCY }}${ChartFormat.number(value, precision, locale)}"
    }

    /**
     * Plain grouped-number formatting — the web `fmtNumber(value, decimals)` used for the unit-less "Avg km/mo"
     * figure. Delegates to the shared [ChartFormat.number], which groups by [locale] and renders a non-finite
     * value as [ChartFormat.EMPTY].
     */
    fun formatNumber(
        value: Double,
        decimals: Int,
        locale: Locale,
    ): String = ChartFormat.number(value, decimals, locale)

    /** A slice's contribution to the donut total — its `pct` when strictly positive and finite, else 0. */
    private fun positive(pct: Double): Double = if (pct.isFinite() && pct > 0.0) pct else 0.0
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a savings
 * amount, charging cost, or insight text — so a diagnostics line can never leak a user's spend or habits.
 */
object ForecastDetailsDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "ForecastDetails"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
