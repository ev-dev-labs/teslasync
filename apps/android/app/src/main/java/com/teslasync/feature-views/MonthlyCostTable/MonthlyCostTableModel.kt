// Pure, framework-free model + projection for the MonthlyCostTable feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/charging/components/cost-analysis/MonthlyCostTable.tsx). No Compose, no Android, no
// HTTP: every declaration here is exercised off-device by the :app:testReleaseUnitTest gate, so the
// composable stays a thin render layer over these pure functions.
//
// MonthlyCostTable is a presentational surface — the web component takes one `data: MonthlyBucket[]` prop
// from the Cost Analysis page (which owns the TanStack query via `useCostAnalysisData`), so this surface
// binds no data feed of its own. Its only web hook is `useTranslation` (the nine `costAnalysis.table.*`
// keys); the per-cell numbers come from `@/lib/numberFormat` (`fmtInt`, `fmtWithUnit`) and the
// `Currency` data-display component (`useFormatting().currencySymbol` + `fmtNumber`). This file owns the
// `useState`-driven sort (the `sorted` memo + `handleSort` toggle) and the per-cell formatting; the
// composable resolves the localized strings, the currency symbol, and the lifecycle chrome.
//
// Units boundary (unit-conversion instructions): a `MonthlyBucket` is a page-level view model, not a wire
// or DB row. Its `energy` is ALREADY display kWh — the page's `useCostAnalysisData` applies the
// `convertEnergyFromSI(_, 'kWh')` boundary conversion before constructing the bucket, exactly as on the
// web — and `cost` / `avgCostPerKwh` / `gasEquiv` / `savings` are monetary amounts (no SI physical unit).
// So this surface, like the web component, performs no unit conversion: it formats the values it is given.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/MonthlyCostTable — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.monthlycosttable

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.util.Locale

/** Em dash shown for a non-finite currency amount — the web `Currency` `fallback = '—'`. */
internal const val EM_DASH: String = "\u2014"

/** Default currency symbol when the settings document has none — the web `useFormatting` `'$'`. */
internal const val DEFAULT_CURRENCY: String = "$"

/** Fiat amount precision — the web `<Currency />` default (`precision = 2`). */
internal const val COST_DECIMALS: Int = 2

/** Per-kWh rate precision — the web `<Currency value={row.avgCostPerKwh} precision={3} />`. */
internal const val RATE_DECIMALS: Int = 3

/** Energy fraction digits — the web `fmtWithUnit(row.energy, 'kWh', 1)`. */
internal const val ENERGY_DECIMALS: Int = 1

/** Energy unit suffix — the web `fmtWithUnit(_, 'kWh', _)` literal (a symbol, not localized prose). */
internal const val ENERGY_UNIT: String = "kWh"

/** Rows per page — the web `<DataTable pagination />` default (`defaultPageSize ?? 25`). */
internal const val MONTHLY_COST_PAGE_SIZE: Int = 25

/**
 * Stable column keys — the native mirror of the web `Column.key` values. Shared by the rendered
 * [io.teslasync.android.components.ui.TableColumn] list, the sort comparator, and the tests so a header
 * key can never drift from the comparator it drives. Every column is sortable (web `sortable: true`).
 */
object MonthlyCostColumnKey {
    const val MONTH: String = "month"
    const val SESSIONS: String = "sessions"
    const val ENERGY: String = "energy"
    const val COST: String = "cost"
    const val AVG_RATE: String = "avgCostPerKwh"
    const val GAS_EQUIV: String = "gasEquiv"
    const val SAVINGS: String = "savings"
}

/**
 * One month's aggregated charging cost — the native mirror of the web `MonthlyBucket`
 * (web/src/features/charging/components/cost-analysis/types.ts). [month] is the `YYYY-MM` bucket key the
 * page builds (web `${year}-${MM}`); [energy] is display kWh (already converted by the page), and [cost]
 * / [avgCostPerKwh] / [gasEquiv] / [savings] are monetary amounts in the user's currency.
 *
 * @property month the `YYYY-MM` bucket label (web `month`).
 * @property cost total spent that month (web `cost`).
 * @property energy energy added that month, in display kWh (web `energy`).
 * @property sessions charging sessions that month (web `sessions`).
 * @property avgCostPerKwh blended per-kWh rate that month (web `avgCostPerKwh`).
 * @property gasEquiv the equivalent gasoline cost for the same distance (web `gasEquiv`).
 * @property savings gas-equivalent minus actual EV cost; negative when EV cost exceeded gas (web `savings`).
 */
data class MonthlyBucket(
    val month: String,
    val cost: Double,
    val energy: Double,
    val sessions: Long,
    val avgCostPerKwh: Double,
    val gasEquiv: Double,
    val savings: Double,
)

/**
 * The already-localized column headers + empty message the table renders. The web component reads each via
 * `t('costAnalysis.table.…')`; on Android they arrive through the P1/S10 i18n facade (`stringResource`) at
 * the Compose boundary and are passed in, keeping the projection locale-stable and free of any English
 * literal. [title] is the panel heading; [noData] is the friendly empty-state message.
 */
data class MonthlyCostStrings(
    val title: String,
    val month: String,
    val sessions: String,
    val energy: String,
    val cost: String,
    val avgRate: String,
    val gasEquiv: String,
    val savings: String,
    val noData: String,
)

/**
 * The locale-bound number/currency formatters the projection injects so it stays deterministic and UI-free
 * under test — the native analogue of the web `fmtInt` / `fmtWithUnit` calls and the `<Currency />`
 * component. [currency] formats a monetary amount with the user's symbol at the given precision (web
 * `<Currency value precision />`); [integer] formats a session count (web `fmtInt`); [energy] formats the
 * kWh column (web `fmtWithUnit(_, 'kWh', 1)`).
 */
data class MonthlyCostFormatters(
    val currency: (value: Double, precision: Int) -> String,
    val integer: (value: Long) -> String,
    val energy: (value: Double) -> String,
)

/**
 * One render-ready table row — the raw [bucket] (for the row key + sort) plus its already-formatted cell
 * text, the native analogue of what each web `Column.render` callback produces. [savingsNonNegative]
 * carries the web `row.savings >= 0` branch so the composable can pick the green (success) / red (danger)
 * savings color at the render boundary without re-deriving it.
 *
 * @property bucket the source row (key = [MonthlyBucket.month]).
 * @property monthText the month cell (web `row.month`).
 * @property sessionsText the grouped session count (web `fmtInt(row.sessions)`).
 * @property energyText the energy + unit (web `fmtWithUnit(row.energy, 'kWh', 1)`).
 * @property costText the formatted cost (web `<Currency value={row.cost} />`).
 * @property avgRateText the formatted per-kWh rate (web `<Currency value={row.avgCostPerKwh} precision={3} />`).
 * @property gasEquivText the formatted gas-equivalent cost (web `<Currency value={row.gasEquiv} />`).
 * @property savingsText the sign-prefixed savings (web `{savings >= 0 ? '+' : ''}<Currency value={row.savings} />`).
 * @property savingsNonNegative the web `row.savings >= 0` color/sign branch.
 */
data class MonthlyCostRow(
    val bucket: MonthlyBucket,
    val monthText: String,
    val sessionsText: String,
    val energyText: String,
    val costText: String,
    val avgRateText: String,
    val gasEquivText: String,
    val savingsText: String,
    val savingsNonNegative: Boolean,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's `sorted` memo and
 * its seven per-cell `render` callbacks. Stateless and side-effect-free so it is fully covered by the
 * off-device unit gate; the composable only resolves localized strings, the currency symbol, the sort
 * toggle state, and the lifecycle chrome.
 */
object MonthlyCostTableProjection {
    /**
     * Stable-sorts [rows] by [sortKey] — a 1:1 port of the web `sorted` memo's comparator: the `month`
     * column compares lexicographically (web `String(aVal).localeCompare`), every other column compares
     * numerically (web `aVal - bVal`). [descending] flips the comparison (web `dir = asc ? 1 : -1`) while
     * preserving the original order of ties (Kotlin `sortedWith` is stable, like the web `Array.sort`). An
     * unknown/`null` key leaves the order untouched (web `default: return 0`).
     */
    fun sortRows(
        rows: List<MonthlyBucket>,
        sortKey: String?,
        descending: Boolean,
    ): List<MonthlyBucket> {
        val comparator: Comparator<MonthlyBucket> =
            when (sortKey) {
                MonthlyCostColumnKey.MONTH -> compareBy { it.month }
                MonthlyCostColumnKey.SESSIONS -> compareBy { it.sessions }
                MonthlyCostColumnKey.ENERGY -> compareBy { it.energy }
                MonthlyCostColumnKey.COST -> compareBy { it.cost }
                MonthlyCostColumnKey.AVG_RATE -> compareBy { it.avgCostPerKwh }
                MonthlyCostColumnKey.GAS_EQUIV -> compareBy { it.gasEquiv }
                MonthlyCostColumnKey.SAVINGS -> compareBy { it.savings }
                else -> return rows.toList()
            }
        return rows.sortedWith(if (descending) comparator.reversed() else comparator)
    }

    /**
     * Projects one [bucket] into its render-ready [MonthlyCostRow] via the injected [formatters],
     * reproducing each web `render` callback: the month verbatim, the session count via [integer], the
     * energy via [energy], the cost / per-kWh rate / gas-equivalent via [currency] (the rate at
     * [RATE_DECIMALS], the others at [COST_DECIMALS]), and the savings via [savingsText].
     */
    fun rowOf(
        bucket: MonthlyBucket,
        formatters: MonthlyCostFormatters,
    ): MonthlyCostRow =
        MonthlyCostRow(
            bucket = bucket,
            monthText = bucket.month,
            sessionsText = formatters.integer(bucket.sessions),
            energyText = formatters.energy(bucket.energy),
            costText = formatters.currency(bucket.cost, COST_DECIMALS),
            avgRateText = formatters.currency(bucket.avgCostPerKwh, RATE_DECIMALS),
            gasEquivText = formatters.currency(bucket.gasEquiv, COST_DECIMALS),
            savingsText = savingsText(bucket.savings, formatters),
            savingsNonNegative = bucket.savings >= 0.0,
        )

    /** Maps [buckets] to render-ready rows, preserving their (already-sorted) order. */
    fun project(
        buckets: List<MonthlyBucket>,
        formatters: MonthlyCostFormatters,
    ): List<MonthlyCostRow> = buckets.map { rowOf(it, formatters) }

    /**
     * The sign-prefixed savings text — the web `{row.savings >= 0 ? '+' : ''}<Currency value={row.savings} />`:
     * a non-negative value gets a leading `+` before the formatted amount (so a positive saving reads
     * `+$12.34`), a negative value keeps the formatter's own minus sign (`$-12.34`). A non-finite value
     * yields the formatter's em-dash with no prefix (web `savings >= 0` is false for `NaN`).
     */
    fun savingsText(
        savings: Double,
        formatters: MonthlyCostFormatters,
    ): String {
        val amount = formatters.currency(savings, COST_DECIMALS)
        return if (savings >= 0.0) "+$amount" else amount
    }

    /**
     * Currency formatting — the web `<Currency>` contract: a non-finite [value] renders the [EM_DASH]
     * fallback with no symbol; otherwise the user's [symbol] is prefixed to the locale-grouped number at
     * [precision] fraction digits (web `currencySymbol + fmtNumber(value, precision)`). A blank [symbol]
     * falls back to [DEFAULT_CURRENCY] (web `useFormatting` `'$'`).
     */
    fun formatCurrency(
        value: Double,
        symbol: String,
        precision: Int,
        locale: Locale,
    ): String {
        if (!value.isFinite()) return EM_DASH
        return "${symbol.ifBlank { DEFAULT_CURRENCY }}${ChartFormat.number(value, precision, locale)}"
    }

    /**
     * Grouped integer — the web `fmtInt(row.sessions)` (`fmtNumber(v, 0)`): the locale-grouped count with
     * no fraction digits. A negative count keeps its sign (the domain is non-negative, so this is a guard).
     */
    fun formatInteger(
        value: Long,
        locale: Locale,
    ): String = ChartFormat.number(value + 0.0, 0, locale)

    /**
     * Energy + unit — the web `fmtWithUnit(row.energy, 'kWh', 1)` (`fmtNumber(v, 1) + ' kWh'`): the
     * locale-grouped kWh value at [ENERGY_DECIMALS] fraction digits followed by the [ENERGY_UNIT] symbol.
     * A non-finite value is normalized to 0 (web `fmtNumber` `safeNumber`) so the cell never shows `NaN`.
     */
    fun formatEnergy(
        value: Double,
        locale: Locale,
    ): String {
        val safe = if (value.isFinite()) value else 0.0
        return "${ChartFormat.number(safe, ENERGY_DECIMALS, locale)} $ENERGY_UNIT"
    }
}

/**
 * The user's currency display preference this surface needs — the native port of the web `useFormatting`
 * read of the `/settings` document. Only the [currencySymbol] is needed: the columns format with the web's
 * literal precisions (2, and 3 for the rate), so the user's `decimal_precision` does not apply here.
 *
 * @property currencySymbol the symbol prefixed to a formatted amount (web `settings.currency_symbol`, `'$'`).
 */
data class MonthlyCostCurrencyPrefs(
    val currencySymbol: String,
) {
    companion object {
        /** The default ($) preference used for previews / cold start before settings load. */
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
 * The one privacy-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a
 * month, cost, or session count — so a diagnostics line can never leak the user's charging spend.
 */
object MonthlyCostTableDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "MonthlyCostTable"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
