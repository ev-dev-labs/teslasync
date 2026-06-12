// Pure, framework-free model + projection for the Monthly Cost Trend chart feature view — the native
// analogue of everything the web component needs before it returns JSX
// (web/src/features/charging/components/cost-analysis/MonthlyCostChart.tsx). No Compose, no Android, no
// HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the
// composable stays a thin render layer over these pure functions.
//
// The web component is purely presentational. Its parent (the Cost Analysis page, via the monthly buckets
// the page computes) supplies a `MonthlyBucket[]`; the component reads only each bucket's `month` and
// `cost`, maps them onto the shared `<ChartContainer>` + Recharts `<AreaChart>` (a single `cost` area over a
// `month` X axis), and falls back to a "Not enough data" message when the series is empty
// (`data.length > 0`). This file owns that render-ready projection plus the `useFormatting` currency
// contract (`currencySymbol + fmtNumber(amount, 0)`), the X-axis month tick reformat, the accessible-table
// rows, and the `annotations={{ vehicleId, scope, chartId }}` binding.
//
// Fallback-table fidelity: the web `dataColumns` declare NO `format`, so the ChartContainer renders each
// cell as `String(raw)` — the raw month string and the raw cost number, ungrouped and without a currency
// symbol. This port reproduces that exactly via [MonthlyCostChartProjection.rawCostCell]; the currency
// symbol + grouping (0 decimals) is applied only to the chart Y axis (web `formatCurrency(v, 0)`), never to
// the table — mirroring the web precisely rather than "improving" it.
//
// Annotation binding: the web passes `annotations={{ vehicleId, scope: 'cost', chartId: 'cost-monthly-trend' }}`
// to `<ChartContainer>`, which fetches + overlays user annotation reference lines. That overlay lives in the
// shared charts layer; the native shared `ChartContainer` does not yet expose it, and editing the shared
// component is outside this surface's allowed files (the sibling ChartContainer-based surfaces observe the
// same boundary). So the binding is preserved here as the pure, unit-tested [MonthlyCostAnnotationScope] —
// the `vehicleId` prop flows into it and its `chartId` becomes the chart's stable identity — and wiring the
// overlay later is a shared-layer change only.
//
// SI boundary (ADR / unit-conversion instructions): `cost` is a money amount, not a unit-suffixed physical
// quantity, so there is no SI conversion here — only the user's display `currency_symbol` and decimal
// rendering, exactly as the web `useFormatting` applies them.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/MonthlyCostChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.monthlycostchart

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.util.Locale
import kotlin.math.floor

/** Default currency symbol when the settings document has none (web `useFormatting` `'$'`). */
internal const val DEFAULT_CURRENCY: String = "$"

/** Cost fraction digits — the web `formatCurrency(v, 0)` literal precision on the Y axis. */
internal const val COST_DECIMALS: Int = 0

/** Number of `YYYY-MM` segments the X-axis tick reformat expects (web `v.split('-').length === 2`). */
private const val MONTH_TICK_PARTS: Int = 2

/** Characters dropped from the year segment to leave the 2-digit year (web `parts[0].slice(2)`). */
private const val YEAR_PREFIX_DROP: Int = 2

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object MonthlyCostChartRegistration {
    /** Stable surface id. */
    const val ID: String = "monthly-cost-chart"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "MonthlyCostChart"
}

/**
 * One trend point — the native mirror of the two fields the web component reads from each `MonthlyBucket`
 * (`{ month, cost }`). [month] is the `YYYY-MM` bucket label the parent emits (the chart X value, an opaque
 * string here exactly as the web `<XAxis dataKey="month" />`), and [cost] is the bucket's total charging
 * spend (the Y value).
 */
data class MonthlyCostPoint(
    val month: String,
    val cost: Double,
)

/**
 * The user's currency display preference this surface needs — the native port of the web `useFormatting`
 * read of the `/settings` document. Only the [currencySymbol] is needed: the Y axis formats with the literal
 * 0-digit precision (web `formatCurrency(v, 0)`), so the user's `decimal_precision` does not apply here.
 */
data class MonthlyCostCurrencyPrefs(
    val currencySymbol: String,
) {
    companion object {
        /** The `$` default used before settings load (matches the web default). */
        val DEFAULT: MonthlyCostCurrencyPrefs = MonthlyCostCurrencyPrefs(DEFAULT_CURRENCY)

        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"

        /** Resolves the currency symbol from the raw `/settings` document (web `useFormatting`). */
        fun fromSettings(settings: JsonElement?): MonthlyCostCurrencyPrefs {
            val raw = (settings as? JsonObject)?.get(KEY_CURRENCY_SYMBOL) as? JsonPrimitive
            val symbol = raw?.contentOrNull?.trim()
            return MonthlyCostCurrencyPrefs(if (!symbol.isNullOrEmpty()) symbol else DEFAULT_CURRENCY)
        }
    }
}

/**
 * The chart-annotation binding the web passes to `<ChartContainer annotations={...}>` — `{ vehicleId,
 * scope: 'cost', chartId: 'cost-monthly-trend' }`. The web ChartContainer uses it to fetch + overlay user
 * annotation reference lines; the native shared ChartContainer does not yet expose that overlay (a
 * shared-layer capability outside this surface's allowed files), so the binding is preserved here as a pure,
 * unit-tested value and its [chartId] becomes the chart's stable identity (test tag). The web `vehicleId`
 * prop flows into [vehicleId].
 */
data class MonthlyCostAnnotationScope(
    val vehicleId: Int?,
    val scope: String = SCOPE,
    val chartId: String = CHART_ID,
) {
    companion object {
        /** Web `annotations.scope`. */
        const val SCOPE: String = "cost"

        /** Web `annotations.chartId` — also the chart's stable identity. */
        const val CHART_ID: String = "cost-monthly-trend"

        /** Builds the binding for the given vehicle (web `{ vehicleId, scope, chartId }`). */
        fun forVehicle(vehicleId: Int?): MonthlyCostAnnotationScope = MonthlyCostAnnotationScope(vehicleId)
    }
}

/**
 * The already-localized chart microcopy the composable reads from the i18n catalog (P1/S10) — the
 * `costAnalysis.charts.*` keys the web component resolves via `t(...)`.
 *
 * @property title the panel title (web `costAnalysis.charts.monthlyCost`).
 * @property ariaLabel the chart's screen-reader description (web `costAnalysis.charts.monthlyCost.aria`,
 *   catalog-absent ⇒ resolved by name with the reproduced inline default).
 * @property costLabel the area's series name (web `costAnalysis.charts.cost`).
 * @property noData the empty-state message (web `costAnalysis.charts.noData`).
 * @property monthColumn the fallback-table month-column header (web `costAnalysis.charts.col.month`).
 * @property costColumn the fallback-table cost-column header (web `costAnalysis.charts.col.cost`).
 */
data class MonthlyCostChartStrings(
    val title: String,
    val ariaLabel: String,
    val costLabel: String,
    val noData: String,
    val monthColumn: String,
    val costColumn: String,
)

/**
 * The fully projected, render-ready chart inputs — the native analogue of the web component's direct use of
 * its `data` prop plus the ChartContainer `data`/`dataColumns` accessible-table props. Pure data (no Compose
 * types) so the projection is unit-tested without a UI host: the composable wraps [values] into a single
 * area `ChartSeries`, feeds [months] to the area chart's bottom axis, and renders [tableRows] as the
 * accessible fallback table (Month / Cost ($)).
 */
data class MonthlyCostChartProjectionResult(
    val months: List<String>,
    val values: List<Double?>,
    val tableRows: List<List<String>>,
    val isEmpty: Boolean,
)

/**
 * The pure projection the composable renders — a 1:1 port of the web component's chart + table bindings.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate; the composable only
 * resolves localized strings, the palette color, the annotation scope, and the freshness chrome.
 */
object MonthlyCostChartProjection {
    /**
     * Projects [points] into render-ready chart inputs, preserving input order (the parent emits the buckets
     * chronologically, so the component renders the series verbatim — the web never re-sorts). [months] feed
     * the X axis (the web `<XAxis dataKey="month" />`), [values] become the single area series, and each
     * point contributes one accessible-table row (`[month, formatCostCell(cost)]`). Injecting [formatCostCell]
     * keeps the projection deterministic for tests; the composable supplies [rawCostCell] to reproduce the
     * web table's raw `String(cost)`. [isEmpty] mirrors the web `data.length > 0` empty branch.
     */
    fun project(
        points: List<MonthlyCostPoint>,
        formatCostCell: (cost: Double) -> String,
    ): MonthlyCostChartProjectionResult =
        MonthlyCostChartProjectionResult(
            months = points.map { it.month },
            values = points.map { it.cost },
            tableRows = points.map { listOf(it.month, formatCostCell(it.cost)) },
            isEmpty = points.isEmpty(),
        )

    /**
     * Projects the web component's `data` prop onto the shared cache-then-network [UiState], mirroring the
     * web component's only branch (`data.length > 0`): a non-empty series is [UiPhase.Content]; an empty (or,
     * defensively, `null`) series is [UiPhase.Empty] — the "Not enough data" surface. The web component
     * itself carries no loading or error branch (its parent gates those with a skeleton), so neither does
     * this overload projection; the loading / error / stale / offline states are driven only through the
     * stateful entry's host-owned [UiState].
     */
    fun projectUiState(points: List<MonthlyCostPoint>?): UiState<List<MonthlyCostPoint>> =
        if (points.isNullOrEmpty()) {
            UiState(phase = UiPhase.Empty, data = emptyList())
        } else {
            UiState(phase = UiPhase.Content, data = points)
        }

    /**
     * Locale-aware currency formatting for the chart Y axis — the native mirror of the web `useFormatting`
     * `formatCurrency(amount, 0)` (`currencySymbol + fmtNumber(amount, 0)`). A blank [symbol] degrades to
     * [DEFAULT_CURRENCY] (web `'$'`); a non-finite [amount] is coerced to 0 before formatting (web
     * `safeNumber`), so the axis never renders `NaN`.
     */
    fun formatCurrency(
        amount: Double,
        symbol: String,
        decimals: Int = COST_DECIMALS,
        locale: Locale = Locale.getDefault(),
    ): String = "${symbol.ifBlank { DEFAULT_CURRENCY }}${ChartFormat.number(safeValue(amount), decimals.coerceAtLeast(0), locale)}"

    /**
     * Reproduces the web fallback table's `String(d.cost)`: the raw cost number with no currency symbol and
     * no grouping — an integral value drops the decimal (`42`), a fractional value keeps its shortest
     * round-trip form (`42.5`), both locale-independent like JS `String(Number)`. A non-finite value
     * degrades to the em-dash empty marker (the web table's `raw == null ? '—'` gap convention), so a
     * malformed bucket never renders `NaN`.
     */
    fun rawCostCell(value: Double): String {
        if (!value.isFinite()) return ChartFormat.EMPTY
        return if (floor(value) == value) value.toLong().toString() else value.toString()
    }

    /**
     * Reproduces the web `<XAxis tickFormatter>`: a `YYYY-MM` label becomes `MM/YY` (e.g. `2024-03` →
     * `03/24`) by joining the month segment with the 2-digit year (`parts[0].slice(2)`); any other shape is
     * returned unchanged (the web ternary's `: v` fallback).
     */
    fun formatMonthTick(month: String): String {
        val parts = month.split("-")
        return if (parts.size == MONTH_TICK_PARTS) "${parts[1]}/${parts[0].drop(YEAR_PREFIX_DROP)}" else month
    }

    /** Coerces a non-finite value to 0 — the web `safeNumber` guard for formatter inputs. */
    internal fun safeValue(value: Double): Double = if (value.isFinite()) value else 0.0
}

/** Resource name for the web `costAnalysis.charts.monthlyCost.aria` key (by-name; absent ⇒ default). */
const val KEY_ARIA_LABEL: String = "translation_costAnalysis_charts_monthlyCost_aria"

/**
 * The web `t(key, default)` fallback for the one key the web component supplies inline but that is absent
 * from the shared, drift-checked catalog (ADR-014). This reproduces the web inline default exactly; the
 * composable reads the key by name and falls back here when it is absent — mirroring the sibling
 * `YearlyTrendChart` / `SessionComparisonChart` surfaces.
 */
object MonthlyCostChartDefaults {
    /** Web `t('costAnalysis.charts.monthlyCost.aria', …)` default. */
    const val ARIA_LABEL: String = "Monthly charging cost trend area chart"
}

/**
 * Optional by-name resolution — the seam that reproduces the web `t(key, default)` for keys the catalog may
 * not carry. Pure (a `(String) -> String?` lookup is injected) so it is unit-tested without Android; the
 * composable supplies the real `resources.getIdentifier`-backed lookup.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [MonthlyCostChartRegistration.SLUG]
 * (P1/S11). Carries only the slug — never a month or cost — so a diagnostics line can never leak the fleet's
 * charging spend. Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls
 * it from its first-composition effect.
 */
fun recordMonthlyCostChartOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to MonthlyCostChartRegistration.SLUG))
}
