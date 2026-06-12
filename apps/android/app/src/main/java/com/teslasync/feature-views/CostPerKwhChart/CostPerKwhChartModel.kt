// Pure, framework-free model + projection for the Cost per kWh Trend chart feature view — the native
// analogue of everything the web component needs before it returns JSX
// (web/src/features/charging/components/cost-analysis/CostPerKwhChart.tsx). No Compose, no Android, no
// HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the
// composable stays a thin render layer over these pure functions.
//
// The web component is purely presentational. Its parent (the Cost Analysis page, via
// `useCostAnalysisData`) builds the `{ date, costPerKwh }[]` series — sorting sessions by start time and
// dividing each session's `cost_decimal` by its energy in kWh — and passes it down. The component then
// renders a single Recharts `<Line dataKey="costPerKwh" name="$/kWh" stroke={palette[2]} />` over a
// `date` X axis with a currency-formatted Y axis (`formatCurrency(v, 2)`), falling back to a
// "Not enough data" message when the series is empty (`data.length > 0`). This file owns that render-ready
// projection plus the `useFormatting` currency contract (`currencySymbol + fmtNumber(amount, 2)`) and the
// accessible-table rows; the composable only resolves localized strings, the palette color, and the
// lifecycle/freshness chrome the shared P1/S8 state layer implies.
//
// SI boundary (ADR / unit-conversion instructions): `costPerKwh` is a money-per-energy ratio, not a
// unit-suffixed physical quantity, so there is no SI conversion here — only the user's display
// `currency_symbol` and decimal rendering, exactly as the web `useFormatting` applies them.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/CostPerKwhChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.costperkwhchart

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.util.Locale

/** Default currency symbol when the settings document has none (web `useFormatting` `'$'`). */
internal const val DEFAULT_CURRENCY: String = "$"

/** Cost fraction digits — the web `formatCurrency(v, 2)` literal precision on the Y axis + table. */
internal const val COST_DECIMALS: Int = 2

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object CostPerKwhChartRegistration {
    /** Stable surface id. */
    const val ID: String = "cost-per-kwh-chart"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "CostPerKwhChart"
}

/**
 * One trend point — the native mirror of a web `data` element
 * (`{ date: string; costPerKwh: number }`). [date] is the already-formatted short date the parent emits
 * (the chart X label, an opaque string here exactly as the web `<XAxis dataKey="date" />`), and
 * [costPerKwh] is the session's cost divided by its energy in kWh (the Y value).
 */
data class CostPerKwhPoint(
    val date: String,
    val costPerKwh: Double,
)

/**
 * The user's currency display preference this surface needs — the native port of the web `useFormatting`
 * read of the `/settings` document. Only the [currencySymbol] is needed: the Y axis and the accessible
 * table format with the literal 2-digit precision (web `formatCurrency(v, 2)`), so the user's
 * `decimal_precision` does not apply here.
 */
data class CostCurrencyPrefs(
    val currencySymbol: String,
) {
    companion object {
        /** The `$` default used before settings load (matches the web default). */
        val DEFAULT: CostCurrencyPrefs = CostCurrencyPrefs(DEFAULT_CURRENCY)

        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"

        /** Resolves the currency symbol from the raw `/settings` document (web `useFormatting`). */
        fun fromSettings(settings: JsonElement?): CostCurrencyPrefs {
            val raw = (settings as? JsonObject)?.get(KEY_CURRENCY_SYMBOL) as? JsonPrimitive
            val symbol = raw?.contentOrNull?.trim()
            return CostCurrencyPrefs(if (!symbol.isNullOrEmpty()) symbol else DEFAULT_CURRENCY)
        }
    }
}

/**
 * The already-localized chart microcopy the composable reads from the i18n catalog (P1/S10) — the three
 * `costAnalysis.charts.*` keys the web component resolves via `t(...)` plus the accessible chrome the
 * native ChartContainer needs (a chart description and the fallback-table headers, drawn from existing
 * catalog keys since the web canvas relies on Recharts' implicit accessibility). The lifecycle-chrome
 * strings (error / retry / offline / freshness) are resolved inline at the Compose boundary, not here, so
 * this holder stays a thin content carrier.
 *
 * @property title the panel title (web `costAnalysis.charts.costPerKwh`).
 * @property rateLabel the line's tooltip name + the table rate-column header (web `costAnalysis.charts.rateLabel`).
 * @property noData the empty-state message (web `costAnalysis.charts.noData`).
 * @property accessibleDescription the chart's screen-reader description (the localized title).
 * @property dateColumn the accessible-table date-column header (the generic `common.date` key).
 */
data class CostPerKwhChartStrings(
    val title: String,
    val rateLabel: String,
    val noData: String,
    val accessibleDescription: String,
    val dateColumn: String,
)

/**
 * The fully projected, render-ready chart inputs — the native analogue of the web component's direct use
 * of its `data` prop plus the ChartContainer `data`/`dataColumns` accessible-table props. Pure data (no
 * Compose types) so the projection is unit-tested without a UI host: the composable wraps [values] into a
 * single `ChartSeries`, feeds [dates] to the line chart's bottom axis, and renders [tableRows] as the
 * accessible fallback table (`Date`, `$/kWh`).
 */
data class CostPerKwhChartProjectionResult(
    val dates: List<String>,
    val values: List<Double?>,
    val tableRows: List<List<String>>,
    val isEmpty: Boolean,
)

/**
 * The pure projection the composable renders — a 1:1 port of the web component's chart + table bindings.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate; the composable only
 * resolves localized strings, the palette color, and the freshness chrome.
 */
object CostPerKwhChartProjection {
    /**
     * Projects [points] into render-ready chart inputs, preserving input order (the parent already sorts
     * ascending by start time, so the component renders the series verbatim — the web never re-sorts).
     * [dates] feed the X axis (the web `<XAxis dataKey="date" />`), [values] become the single line
     * series, and each point contributes one accessible-table row (`[date, formatValue(costPerKwh)]`).
     * Injecting [formatValue] keeps the projection locale-deterministic for tests; the composable supplies
     * the real localized currency formatter. [isEmpty] mirrors the web `data.length > 0` empty branch.
     */
    fun project(
        points: List<CostPerKwhPoint>,
        formatValue: (cost: Double) -> String,
    ): CostPerKwhChartProjectionResult =
        CostPerKwhChartProjectionResult(
            dates = points.map { it.date },
            values = points.map { it.costPerKwh },
            tableRows = points.map { listOf(it.date, formatValue(it.costPerKwh)) },
            isEmpty = points.isEmpty(),
        )

    /**
     * Projects the web component's `{ data }` prop onto the shared cache-then-network [UiState], mirroring
     * the web component's only branch (`data.length > 0`): a non-empty series is [UiPhase.Content]; an
     * empty (or, defensively, `null`) series is [UiPhase.Empty] — the "Not enough data" surface. The web
     * component itself carries no loading or error branch (its parent gates those with a skeleton), so
     * neither does this overload projection; the loading / error / stale / offline states are driven only
     * through the stateful entry's host-owned [UiState].
     */
    fun projectUiState(points: List<CostPerKwhPoint>?): UiState<List<CostPerKwhPoint>> =
        if (points.isNullOrEmpty()) {
            UiState(phase = UiPhase.Empty, data = emptyList())
        } else {
            UiState(phase = UiPhase.Content, data = points)
        }

    /**
     * Locale-aware currency formatting — the native mirror of the web `useFormatting` `formatCurrency`
     * (`currencySymbol + fmtNumber(amount, decimals)`). A blank [symbol] degrades to [DEFAULT_CURRENCY]
     * (web `'$'`); a non-finite [amount] is coerced to 0 before formatting (web `safeNumber`), so the Y
     * axis and table never render `NaN`.
     */
    fun formatCurrency(
        amount: Double,
        symbol: String,
        decimals: Int = COST_DECIMALS,
        locale: Locale = Locale.getDefault(),
    ): String = "${symbol.ifBlank { DEFAULT_CURRENCY }}${ChartFormat.number(safeValue(amount), decimals.coerceAtLeast(0), locale)}"

    /** Coerces a non-finite value to 0 — the web `safeNumber` guard for formatter inputs. */
    internal fun safeValue(value: Double): Double = if (value.isFinite()) value else 0.0
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [CostPerKwhChartRegistration.SLUG]
 * (P1/S11). Carries only the slug — never a date or cost — so a diagnostics line can never leak the
 * fleet's charging spend. Kept free of Compose so it is unit-tested with a recording [Logger]; the
 * composable calls it from its first-composition effect.
 */
fun recordCostPerKwhChartOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to CostPerKwhChartRegistration.SLUG))
}
