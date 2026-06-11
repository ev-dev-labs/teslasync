// Pure, framework-free model + projection for the Cost Breakdown dashboard widget — the native analogue
// of everything the web component derives via `useMemo` before returning JSX
// (web/src/features/dashboard/widgets/CostBreakdownWidget.tsx). No Compose, no Android, no HTTP: every
// type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer. The cost feed arrives as raw SI JSON (`/analytics/tco`), so this file owns the
// decode (web optional-chaining → null-safe reads) plus the display-boundary currency + distance
// conversion (Phase-48 SI-canonical rule; web `useFormatting`/`useUnits`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/CostBreakdownWidget — the P3 prompt's allowed-files path) cannot form
// a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.costbreakdown

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale

private const val EM_DASH = "\u2014"
private const val DEFAULT_CURRENCY = "$"

/** Default currency fraction digits (web `useFormatting` `decimal_precision ?? 2`). */
private const val DEFAULT_PRECISION = 2

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The
 * `isCompact` branch reproduces the web `size.cols <= 1` test that swaps the donut + list + stat-card
 * standard layout for the single big-number hero.
 */
data class CostBreakdownSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `size.cols <= 1`): render the compact monthly-total hero. */
    val isCompact: Boolean get() = cols <= 1
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/analytics.ts (`cost-breakdown`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web
 * grids stay in lockstep.
 */
object CostBreakdownRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "cost-breakdown"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "analytics"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "CostBreakdownWidget"

    /** Default footprint: 2 columns × 4 rows (web `defaultSize`). */
    val defaultSize = CostBreakdownSize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val minSize = CostBreakdownSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val maxSize = CostBreakdownSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: CostBreakdownSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: CostBreakdownSize): CostBreakdownSize =
        CostBreakdownSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * One month of the TCO breakdown reduced to the two fields the web component reads from each
 * `monthly_breakdown` entry: the [month] label and the EV charging [evCost] for that month. Other wire
 * fields (`equiv_gas_cost`, `cumulative_savings`, `energy_wh`) are not rendered by this surface, so —
 * like the web — they are intentionally not decoded.
 */
data class MonthlyCost(
    val month: String,
    val evCost: Double,
)

/**
 * The decoded TCO payload — the native analogue of the web `CostBreakdown` shape the component reads
 * (`data?.total_charging_cost`, `cost_per_km_ev`, `total_savings`, `monthly_savings`,
 * `monthly_breakdown`). All numerics are SI/raw on the wire; conversion to display units happens in
 * [CostBreakdownProjection]. Missing/absent fields collapse to zero / empty, exactly like the web
 * optional-chaining (`?? 0`).
 */
data class CostBreakdownData(
    val totalChargingCost: Double,
    val costPerKmEv: Double,
    val totalSavings: Double,
    val monthlySavings: Double,
    val monthlyBreakdown: List<MonthlyCost>,
) {
    /** Web `hasData = monthlyEntries.length > 0` — drives the empty-state gate. */
    val hasData: Boolean get() = monthlyBreakdown.isNotEmpty()

    companion object {
        /** The all-zero / no-month snapshot, surfaced for a null payload or no resolved vehicle. */
        val EMPTY = CostBreakdownData(0.0, 0.0, 0.0, 0.0, emptyList())
    }
}

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` +
 * `useFormatting` reads from the `/settings` document: the [distanceUnit] (for the "Cost / {unit}"
 * label + the per-km→per-mile conversion), the [currencySymbol] (blank → "$"), and the currency
 * [precision] (web `decimal_precision`, floored & non-negative, else 2).
 */
data class CostBreakdownDisplayPrefs(
    val distanceUnit: DistanceUnitPref,
    val currencySymbol: String,
    val precision: Int,
) {
    companion object {
        /** Metric + `$` + 2dp defaults used before settings load (matches the web defaults). */
        val METRIC_DEFAULT = CostBreakdownDisplayPrefs(DistanceUnitPref.KM, DEFAULT_CURRENCY, DEFAULT_PRECISION)

        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`/`useFormatting`). */
        fun fromSettings(settings: JsonElement?): CostBreakdownDisplayPrefs {
            val unit = UnitPreferences.fromSettings(settings)
            val rawSymbol = (settings as? JsonObject)?.get(KEY_CURRENCY_SYMBOL) as? JsonPrimitive
            val symbol = rawSymbol?.contentOrNull?.trim()
            return CostBreakdownDisplayPrefs(
                distanceUnit = unit.distance,
                currencySymbol = if (!symbol.isNullOrEmpty()) symbol else DEFAULT_CURRENCY,
                precision = unit.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION,
            )
        }
    }
}

/**
 * Localized labels the surface folds into its output (the nine web `t('widget.costBreakdown.…')` keys).
 * The pure [CostBreakdownProjection] reads these to assemble each visible string + TalkBack content
 * description; the composable builds this from `stringResource`, while tests pass a deterministic
 * instance. [savedVsGas] and [costPerDist] are the two parameterized templates (a single `%1$s` slot),
 * formatted inside the projection so it stays a pure, locale-stable function.
 */
data class CostBreakdownStrings(
    val title: String,
    val monthlyTotal: String,
    val savedVsGas: String,
    val saving: String,
    val noData: String,
    val totalCost: String,
    val costPerDist: String,
    val gasSavings: String,
    val lifetime: String,
)

/** One donut ring segment: a [label] (month), its SI [value] (EV cost), and a palette [colorIndex]. */
data class DonutSegment(
    val label: String,
    val value: Double,
    val colorIndex: Int,
)

/**
 * One projected, render-ready ranked-list row — the native analogue of a web `RankedItem`. Carries the
 * resolved [label], the already-formatted currency [formattedValue], the raw [value] (sort key), the
 * background-[barFraction] (0..1, value ÷ visible-max), the palette [colorIndex], and a TalkBack
 * [contentDescription] folding the rank + label + value into one phrase.
 */
data class RankedCostRow(
    val id: String,
    val label: String,
    val formattedValue: String,
    val value: Double,
    val barFraction: Float,
    val colorIndex: Int,
    val contentDescription: String,
)

/** A projected stat tile: a [label], an already-formatted [value], and an optional muted [sublabel]. */
data class CostStatCard(
    val label: String,
    val value: String,
    val sublabel: String?,
)

/**
 * The fully projected, render-ready view of the cost breakdown for one footprint — the native analogue
 * of everything the web component computes before returning JSX. Pure data (no Compose types) so the
 * projection is unit-tested without a UI host. Carries both the compact-hero fields and the
 * standard-layout fields; the composable renders one set per [CostBreakdownSize.isCompact].
 */
data class CostBreakdownDisplay(
    val hasData: Boolean,
    val monthlyTotalValue: Double,
    val monthlyTotalDecimals: Int,
    val currencySymbol: String,
    val monthlyTotalLabel: String,
    val savedSubtitle: String?,
    val showSavingBadge: Boolean,
    val savingBadgeText: String,
    val compactContentDescription: String,
    val donutSegments: List<DonutSegment>,
    val donutContentDescription: String,
    val rankedRows: List<RankedCostRow>,
    val totalCostCard: CostStatCard,
    val costPerDistCard: CostStatCard,
    val gasSavingsCard: CostStatCard,
    val emptyMessage: String,
)

/**
 * Decodes the raw `/analytics/tco` [json] (SI, snake_case on the wire) into a [CostBreakdownData]. A
 * non-object input, missing fields, or JSON-null fields all collapse to zero / empty — reproducing the
 * web optional-chaining (`data?.x ?? 0`, `data?.monthly_breakdown ?? []`). The only entries kept are
 * those carrying a usable shape; a malformed element contributes a zero-cost month rather than throwing.
 */
fun parseCostBreakdown(json: JsonElement?): CostBreakdownData {
    val obj = json as? JsonObject ?: return CostBreakdownData.EMPTY
    val months =
        (obj["monthly_breakdown"] as? JsonArray)
            ?.mapNotNull { element -> (element as? JsonObject)?.toMonthlyCost() }
            ?: emptyList()
    return CostBreakdownData(
        totalChargingCost = obj.double("total_charging_cost"),
        costPerKmEv = obj.double("cost_per_km_ev"),
        totalSavings = obj.double("total_savings"),
        monthlySavings = obj.double("monthly_savings"),
        monthlyBreakdown = months,
    )
}

private fun JsonObject.toMonthlyCost(): MonthlyCost =
    MonthlyCost(
        month = (this["month"] as? JsonPrimitive)?.contentOrNull ?: EM_DASH,
        evCost = double("ev_cost"),
    )

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

/**
 * Pure projection from a decoded [CostBreakdownData] to the render-ready [CostBreakdownDisplay] — the
 * native port of the inline `useMemo` derivations + JSX formatting in the web source. SI cost-per-km is
 * converted to the user's distance unit here (web `cpk * MI_TO_KM` for miles); currency is formatted via
 * [formatCurrency] reproducing the web `useFormatting` `currencySymbol + fmtNumber` contract. [locale]
 * drives the grouping/separators (tests pin [Locale.US]).
 */
object CostBreakdownProjection {
    /** Web `const MI_TO_KM = 1.60934` — cost-per-km × this = cost-per-mile (a mile is 1.60934 km). */
    const val MI_TO_KM = 1.60934

    /** Web ranked-list `maxItems={5}`. */
    const val MAX_RANKED_ITEMS = 5

    /** Web donut `monthlyEntries.slice(-6)`. */
    const val MAX_DONUT_SEGMENTS = 6

    /** Web `formatCurrency(costPerDist, 3)` — the cost-per-distance tile uses three fraction digits. */
    const val COST_PER_DIST_DECIMALS = 3

    /** Project [data] for [size] using the user's [prefs] and the localized [strings]. */
    fun project(
        data: CostBreakdownData,
        prefs: CostBreakdownDisplayPrefs,
        strings: CostBreakdownStrings,
        locale: Locale = Locale.US,
    ): CostBreakdownDisplay {
        val entries = data.monthlyBreakdown
        val symbol = prefs.currencySymbol
        return CostBreakdownDisplay(
            hasData = data.hasData,
            monthlyTotalValue = entries.lastOrNull()?.evCost ?: 0.0,
            monthlyTotalDecimals = prefs.precision,
            currencySymbol = symbol,
            monthlyTotalLabel = strings.monthlyTotal,
            savedSubtitle = savedSubtitle(data, prefs, strings, locale),
            showSavingBadge = data.totalSavings > 0.0,
            savingBadgeText = strings.saving,
            compactContentDescription = compactDescription(data, prefs, strings, locale),
            donutSegments = donutSegments(entries),
            donutContentDescription = donutDescription(entries, strings),
            rankedRows = rankedRows(entries, symbol, prefs.precision, locale),
            totalCostCard = CostStatCard(strings.totalCost, formatCurrency(data.totalChargingCost, symbol, prefs.precision, locale), null),
            costPerDistCard = costPerDistCard(data, prefs, strings, locale),
            gasSavingsCard = gasSavingsCard(data, prefs, strings, locale),
            emptyMessage = strings.noData,
        )
    }

    /**
     * Formats a currency [amount] as the web `formatCurrency` does — the user's [symbol] (blank → "$")
     * followed by [decimals]-digit grouped number — via the shared [ChartFormat.number] (the same
     * locale-aware formatter every native cost widget uses).
     */
    fun formatCurrency(
        amount: Double,
        symbol: String,
        decimals: Int,
        locale: Locale = Locale.US,
    ): String = "${symbol.ifBlank { DEFAULT_CURRENCY }}${ChartFormat.number(amount, decimals.coerceAtLeast(0), locale)}"

    /**
     * Cost-per-distance in the user's unit: SI cost-per-km × (1.60934 for miles, else 1), then formatted
     * with three fraction digits, or the em-dash when the rate is zero (web `costPerDist > 0 ? … : '—'`).
     */
    fun costPerDistance(
        costPerKmEv: Double,
        unit: DistanceUnitPref,
    ): Double {
        if (costPerKmEv == 0.0) return 0.0
        return if (unit == DistanceUnitPref.MI) costPerKmEv * MI_TO_KM else costPerKmEv
    }

    private fun savedSubtitle(
        data: CostBreakdownData,
        prefs: CostBreakdownDisplayPrefs,
        strings: CostBreakdownStrings,
        locale: Locale,
    ): String? {
        if (data.monthlySavings <= 0.0) return null
        val amount = formatCurrency(data.monthlySavings, prefs.currencySymbol, prefs.precision, locale)
        return strings.savedVsGas.format(amount)
    }

    private fun compactDescription(
        data: CostBreakdownData,
        prefs: CostBreakdownDisplayPrefs,
        strings: CostBreakdownStrings,
        locale: Locale,
    ): String {
        val current = data.monthlyBreakdown.lastOrNull()?.evCost ?: 0.0
        val value = formatCurrency(current, prefs.currencySymbol, prefs.precision, locale)
        val parts = mutableListOf("${strings.monthlyTotal} $value")
        savedSubtitle(data, prefs, strings, locale)?.let { parts += it }
        if (data.totalSavings > 0.0) parts += strings.saving
        return parts.joinToString(", ")
    }

    private fun donutSegments(entries: List<MonthlyCost>): List<DonutSegment> =
        entries
            .takeLast(MAX_DONUT_SEGMENTS)
            .mapIndexed { index, entry -> DonutSegment(label = entry.month, value = entry.evCost, colorIndex = index) }

    private fun donutDescription(
        entries: List<MonthlyCost>,
        strings: CostBreakdownStrings,
    ): String {
        if (entries.isEmpty()) return strings.noData
        val months = entries.takeLast(MAX_DONUT_SEGMENTS).joinToString(", ") { it.month }
        return "${strings.title}: $months"
    }

    private fun rankedRows(
        entries: List<MonthlyCost>,
        symbol: String,
        precision: Int,
        locale: Locale,
    ): List<RankedCostRow> {
        val visible =
            entries
                .mapIndexed { index, entry -> index to entry }
                .sortedByDescending { it.second.evCost }
                .take(MAX_RANKED_ITEMS)
        val maxValue = visible.maxOfOrNull { it.second.evCost } ?: 0.0
        return visible.mapIndexed { rank, (originalIndex, entry) ->
            val formatted = formatCurrency(entry.evCost, symbol, precision, locale)
            RankedCostRow(
                id = entry.month.ifBlank { rank.toString() },
                label = entry.month,
                formattedValue = formatted,
                value = entry.evCost,
                barFraction = if (maxValue > 0.0) (entry.evCost / maxValue).toFloat() else 0f,
                colorIndex = originalIndex,
                contentDescription = "${rank + 1}. ${entry.month} $formatted",
            )
        }
    }

    private fun costPerDistCard(
        data: CostBreakdownData,
        prefs: CostBreakdownDisplayPrefs,
        strings: CostBreakdownStrings,
        locale: Locale,
    ): CostStatCard {
        val perDist = costPerDistance(data.costPerKmEv, prefs.distanceUnit)
        val value =
            if (perDist > 0.0) {
                formatCurrency(perDist, prefs.currencySymbol, COST_PER_DIST_DECIMALS, locale)
            } else {
                EM_DASH
            }
        return CostStatCard(strings.costPerDist.format(prefs.distanceUnit.label), value, null)
    }

    private fun gasSavingsCard(
        data: CostBreakdownData,
        prefs: CostBreakdownDisplayPrefs,
        strings: CostBreakdownStrings,
        locale: Locale,
    ): CostStatCard {
        val hasSavings = data.totalSavings > 0.0
        val value =
            if (hasSavings) formatCurrency(data.totalSavings, prefs.currencySymbol, prefs.precision, locale) else EM_DASH
        return CostStatCard(strings.gasSavings, value, if (hasSavings) strings.lifetime else null)
    }
}
