// Pure, framework-free model + projection for the LifetimeSummary feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/charging/components/cost-analysis/LifetimeSummary.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// LifetimeSummary is a presentational surface — the web component takes `lifetimeMetrics` and `coreStats`
// props from the Cost Analysis page (which owns the TanStack query over charging sessions), so this surface
// binds no data hooks. As in the sibling WeekOverWeekSummary / SummaryStatsRow ports, the cache-then-network
// states (fetch error, stale, offline) live on the owning page, NOT here. The two branches the web source
// defines are the complete render set: the resolved seven-tile grid (when both props are non-null) and the
// "No data" empty branch (when either is null). A host `loading` flag is threaded so the tiles can show their
// own skeleton while the page's query is in flight, the lifecycle chrome the host's load implies.
//
// The web renders seven tiles in order, each a small label + value card: total spent
// (`formatCurrency(_, 2)`), total energy (`fmtWithUnit(_, 'kWh', 1)`), total sessions (`fmtInt`), average
// session cost (`formatCurrency(_, 2)`), average energy per session (`fmtWithUnit(_, 'kWh', 1)`), average
// duration (`fmtNumber(_, 0)` + ' min'), and free sessions (`fmtInt` + ' (' + `fmtWithUnit(_, 'kWh', 1)` +
// ')'). The currency symbol is read from the shared `/settings` document (web `useFormatting`, P1/S8); the
// cost tiles use the web's literal 2-digit precision so the user's `decimal_precision` does not apply here.
// The physical unit symbols ('kWh', 'min') are rendered verbatim from the web source's hardcoded literals —
// exactly as the WeekOverWeekSummary port does for its units — so they are not routed through i18n; only the
// seven tile labels and the empty message are (P1/S10).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/LifetimeSummary — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.lifetimesummary

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.util.Locale

/** Default currency symbol when the settings document has none (web `useFormatting` `'$'`). */
internal const val DEFAULT_CURRENCY: String = "$"

/** Cost-tile fraction digits — the web `formatCurrency(_, 2)` literal precision. */
internal const val COST_DECIMALS: Int = 2

/** Energy-tile fraction digits — the web `fmtWithUnit(_, 'kWh', 1)` literal precision. */
internal const val ENERGY_DECIMALS: Int = 1

/** Average-duration fraction digits — the web `fmtNumber(avgDuration, 0)` literal precision. */
internal const val DURATION_DECIMALS: Int = 0

/** Count fraction digits — the web `fmtInt` (`fmtNumber(v, 0)`). */
internal const val COUNT_DECIMALS: Int = 0

/** Unit symbol for the energy tiles — the web `fmtWithUnit(_, 'kWh', 1)` literal. */
internal const val UNIT_KWH: String = "kWh"

/** Unit symbol for the average-duration tile — the web `` `${fmtNumber(_, 0)} min` `` literal. */
internal const val UNIT_MIN: String = "min"

/**
 * The seven tiles this surface renders, in web source order. The composable resolves each one's localized
 * label (P1/S10) from this identity, keeping the projection pure.
 */
enum class LifetimeMetricKind {
    TotalSpent,
    TotalEnergy,
    TotalSessions,
    AvgSessionCost,
    AvgEnergy,
    AvgDuration,
    FreeSessions,
}

/**
 * One render-ready tile — the native analogue of a single web `<LifetimeMetric label value />`.
 *
 * @property kind the tile identity, which the composable maps to a localized label.
 * @property value the already-formatted display value (web `formatCurrency` / `fmtWithUnit` / `fmtInt` / …).
 */
data class LifetimeTile(
    val kind: LifetimeMetricKind,
    val value: String,
)

/**
 * The subset of the web `CoreStats` this surface consumes — total spend, total energy, and the session
 * count. The full web interface carries more fields used by sibling Cost Analysis sections; this surface
 * needs only these three.
 *
 * @property totalCost lifetime charging spend (web `coreStats.totalCost`).
 * @property totalEnergy lifetime energy added in kWh (web `coreStats.totalEnergy`).
 * @property count total charging-session count (web `coreStats.count`, a `number`).
 */
data class LifetimeCoreStats(
    val totalCost: Double,
    val totalEnergy: Double,
    val count: Double,
)

/**
 * The subset of the web `LifetimeMetrics` this surface consumes. The full web interface carries min/max
 * session cost used elsewhere; this surface needs only the five averages / free-session fields.
 *
 * @property avgSessionCost mean cost per session (web `lifetimeMetrics.avgSessionCost`).
 * @property avgSessionEnergy mean energy per session in kWh (web `lifetimeMetrics.avgSessionEnergy`).
 * @property avgDuration mean session duration in minutes (web `lifetimeMetrics.avgDuration`).
 * @property freeCount number of zero-cost sessions (web `lifetimeMetrics.freeCount`, a `number`).
 * @property freeEnergy energy added across the free sessions in kWh (web `lifetimeMetrics.freeEnergy`).
 */
data class LifetimeMetricsData(
    val avgSessionCost: Double,
    val avgSessionEnergy: Double,
    val avgDuration: Double,
    val freeCount: Double,
    val freeEnergy: Double,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes
 * before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property loading whether the owning page's query is still in flight; the tiles render their skeleton while
 *   true (the lifecycle chrome the host's load implies).
 * @property hasData whether both `coreStats` and `lifetimeMetrics` resolved (web `lifetimeMetrics &&
 *   coreStats`); drives the grid-vs-"No data" branch.
 * @property tiles the seven tiles in web source order when [hasData]; empty otherwise. Always-render
 *   contract: when present, every tile formats its value (zeros format as "$0.00" / "0.0 kWh" / "0"), never a
 *   blank card.
 */
data class LifetimeSummaryDisplay(
    val loading: Boolean,
    val hasData: Boolean,
    val tiles: List<LifetimeTile>,
)

/**
 * The user's currency display preference this surface needs — the native port of the web `useFormatting`
 * read of the `/settings` document. Only the [currencySymbol] is needed: the cost tiles format with the
 * literal 2-digit precision, so the user's `decimal_precision` does not apply here.
 *
 * @property currencySymbol the symbol prefixed to the cost values (web `settings.currency_symbol`, `'$'`).
 */
data class LifetimeCurrencyPrefs(
    val currencySymbol: String,
) {
    companion object {
        /** The default ($) preference used for previews / cold start before settings load. */
        val DEFAULT: LifetimeCurrencyPrefs = LifetimeCurrencyPrefs(DEFAULT_CURRENCY)

        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"

        /** Resolves the currency symbol from the raw `/settings` document (web `useFormatting`). */
        fun fromSettings(settings: JsonElement?): LifetimeCurrencyPrefs {
            val raw = (settings as? JsonObject)?.get(KEY_CURRENCY_SYMBOL) as? JsonPrimitive
            val symbol = raw?.contentOrNull?.trim()
            return LifetimeCurrencyPrefs(if (!symbol.isNullOrEmpty()) symbol else DEFAULT_CURRENCY)
        }
    }
}

/**
 * Pure projection from the surface's props to its render-ready [LifetimeSummaryDisplay] — a 1:1 port of the
 * derivations the web component performs inline: the seven `formatCurrency` / `fmtWithUnit` / `fmtInt` /
 * `fmtNumber` values, the `lifetimeMetrics && coreStats` data gate, and the hardcoded unit symbols. The tile
 * labels are resolved in the composable from each tile's [LifetimeMetricKind] identity against the i18n
 * catalog.
 */
object LifetimeSummaryProjection {
    /**
     * Select the render-ready view for the given [coreStats] / [lifetimeMetrics] props, resolved [currency],
     * and host [loading] flag. [locale] pins the number grouping / decimal separators (the composable passes
     * the device locale; tests pass a fixed locale for deterministic output).
     */
    fun project(
        coreStats: LifetimeCoreStats?,
        lifetimeMetrics: LifetimeMetricsData?,
        currency: LifetimeCurrencyPrefs,
        loading: Boolean,
        locale: Locale,
    ): LifetimeSummaryDisplay {
        val hasData = coreStats != null && lifetimeMetrics != null
        val tiles =
            if (coreStats != null && lifetimeMetrics != null) {
                buildTiles(coreStats, lifetimeMetrics, currency, locale)
            } else {
                emptyList()
            }
        return LifetimeSummaryDisplay(loading = loading, hasData = hasData, tiles = tiles)
    }

    private fun buildTiles(
        core: LifetimeCoreStats,
        metrics: LifetimeMetricsData,
        currency: LifetimeCurrencyPrefs,
        locale: Locale,
    ): List<LifetimeTile> {
        val symbol = currency.currencySymbol
        return listOf(
            LifetimeTile(
                kind = LifetimeMetricKind.TotalSpent,
                value = formatCurrency(core.totalCost, symbol, COST_DECIMALS, locale),
            ),
            LifetimeTile(
                kind = LifetimeMetricKind.TotalEnergy,
                value = formatWithUnit(core.totalEnergy, UNIT_KWH, ENERGY_DECIMALS, locale),
            ),
            LifetimeTile(
                kind = LifetimeMetricKind.TotalSessions,
                value = formatCount(core.count, locale),
            ),
            LifetimeTile(
                kind = LifetimeMetricKind.AvgSessionCost,
                value = formatCurrency(metrics.avgSessionCost, symbol, COST_DECIMALS, locale),
            ),
            LifetimeTile(
                kind = LifetimeMetricKind.AvgEnergy,
                value = formatWithUnit(metrics.avgSessionEnergy, UNIT_KWH, ENERGY_DECIMALS, locale),
            ),
            LifetimeTile(
                kind = LifetimeMetricKind.AvgDuration,
                value = formatWithUnit(metrics.avgDuration, UNIT_MIN, DURATION_DECIMALS, locale),
            ),
            LifetimeTile(
                kind = LifetimeMetricKind.FreeSessions,
                value = formatFreeSessions(metrics.freeCount, metrics.freeEnergy, locale),
            ),
        )
    }

    /**
     * The free-sessions tile value — a 1:1 port of the web
     * `` `${fmtInt(freeCount)} (${fmtWithUnit(freeEnergy, 'kWh', 1)})` ``: the grouped free-session count
     * followed by the parenthesized free energy in kWh, e.g. `"3 (12.5 kWh)"`.
     */
    fun formatFreeSessions(
        freeCount: Double,
        freeEnergy: Double,
        locale: Locale,
    ): String {
        val count = formatCount(freeCount, locale)
        val energy = formatWithUnit(freeEnergy, UNIT_KWH, ENERGY_DECIMALS, locale)
        return "$count ($energy)"
    }

    /**
     * Locale-aware fixed-precision formatting — the native mirror of the web `fmtNumber(value, decimals)`: a
     * non-finite value is coerced to 0 (web `safeNumber`), then grouped with the locale separators and the
     * exact [decimals] fraction digits.
     */
    fun formatNumber(
        value: Double,
        decimals: Int,
        locale: Locale,
    ): String = ChartFormat.number(safe(value), decimals.coerceAtLeast(0), locale)

    /**
     * Value + trailing unit — the web `fmtWithUnit(value, unit, decimals)` contract
     * (`` `${fmtNumber(value, decimals)} ${unit}` ``), e.g. `"42.6 kWh"` / `"30 min"`.
     */
    fun formatWithUnit(
        value: Double,
        unit: String,
        decimals: Int,
        locale: Locale,
    ): String = "${formatNumber(value, decimals, locale)} $unit"

    /**
     * Grouped integer formatting — the native mirror of the web `fmtInt` (`fmtNumber(v, 0)`): the count
     * (a web `number`) is rendered with zero fraction digits, so a whole value reads as a grouped integer.
     */
    fun formatCount(
        value: Double,
        locale: Locale,
    ): String = formatNumber(value, COUNT_DECIMALS, locale)

    /**
     * Currency formatting — the web `useFormatting` `currencySymbol + fmtNumber(amount, decimals)` contract.
     * A blank symbol falls back to `$`; a non-finite amount is normalized to 0 (web `safeNumber`).
     */
    fun formatCurrency(
        amount: Double,
        symbol: String,
        decimals: Int,
        locale: Locale,
    ): String = "${symbol.ifBlank { DEFAULT_CURRENCY }}${formatNumber(amount, decimals, locale)}"

    /** Coerces a non-finite value to 0, the native mirror of the web `safeNumber`. */
    fun safe(value: Double): Double = if (value.isFinite()) value else 0.0
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a cost,
 * energy, duration, or session count — so a diagnostics line can never leak the user's charging data.
 */
object LifetimeSummaryDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "LifetimeSummary"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
