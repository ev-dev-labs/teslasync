// Pure, framework-free model + projection for the DetailedStatistics feature view — the native analogue
// of everything the web component derives before returning JSX
// (web/src/features/charging/components/charging-list/DetailedStatistics.tsx). No Compose, no Android, no
// HTTP: every declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer over these pure functions.
//
// The web component is purely presentational — its parent (the charging-list page) computes the
// `ChargingStats` and `EnhancedStats` from the session history and passes them down. The component reads
// six values and renders a titled `GlassPanel` of six centered stat cells: total session count
// (`AnimatedNumber`), average duration (`formatDuration`), average power (`fmtWithUnit(..,'kW')`), the
// most-common charger type with its occurrence count, total cost (`Currency`), and average cost-per-kWh
// (`Currency` at 3 decimals). Its only web hook is `useTranslation`; the currency symbol comes from
// `useFormatting`. This file owns the parts the web expresses inline: the lifecycle projection onto the
// shared cache-then-network [UiState] (so the surface renders every state the P1/S8 layer can carry), the
// six formatted values reproducing the web `formatDurationMinutes` / `fmtWithUnit` / `Currency` contracts,
// the currency-symbol read from the raw `/settings` document, and the redaction-safe `view.opened`
// diagnostic.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/DetailedStatistics — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.detailedstatistics

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
import kotlin.math.roundToLong

/** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, cost, or actor. */
const val DETAILED_STATISTICS_SLUG: String = "DetailedStatistics"

/** Em dash shown for an absent value — the web `—` fallback (the `Currency` `fallback` default). */
internal const val EM_DASH: String = "\u2014"

/** Multiplication sign joining the top-charger count to its label — web `(${count}×)`. */
internal const val MULTIPLY_SIGN: String = "\u00D7"

/** Default currency symbol when the settings document has none (web `useFormatting` `'$'`). */
internal const val DEFAULT_CURRENCY: String = "$"

/** Web `fmtWithUnit(stats.avgPower, 'kW')` fraction digits — the global precision default (2). */
internal const val POWER_DECIMALS: Int = 2

/** Web `<Currency value={stats.totalCost} />` fraction digits — the `Currency` precision default (2). */
internal const val COST_DECIMALS: Int = 2

/** Web `<Currency value={stats.avgCostPerKwh} precision={3} />` fraction digits. */
internal const val COST_PER_KWH_DECIMALS: Int = 3

/** The unit suffix the web appends to the average-power value (`fmtWithUnit(.., 'kW')`). */
internal const val POWER_UNIT: String = "kW"

private const val MINUTES_PER_HOUR: Double = 60.0

/**
 * The subset of the web `ChargingStats` this surface reads (web `stats.count` / `stats.avgPower` /
 * `stats.totalCost` / `stats.avgCostPerKwh`). The owning charging-list page computes the full stats from the
 * session history and threads these four through; the unit-bearing values are display-ready (the web
 * `computeStats` already converts `avgPower` to kW before this component renders it).
 *
 * @property count total number of charging sessions (web `stats.count`).
 * @property avgPower average charging power, already in kW for display (web `stats.avgPower`).
 * @property totalCost summed session cost in the user's currency (web `stats.totalCost`).
 * @property avgCostPerKwh average cost per kWh in the user's currency (web `stats.avgCostPerKwh`).
 */
data class DetailedChargingStats(
    val count: Int,
    val avgPower: Double,
    val totalCost: Double,
    val avgCostPerKwh: Double,
)

/**
 * The subset of the web `EnhancedStats` this surface reads (web `enhanced.avgDuration` /
 * `enhanced.mostCommonType`). The most-common charger type arrives as a (name, count) pair, mirroring the
 * web tuple `mostCommonType: [string, number]`.
 *
 * @property avgDurationMinutes mean session duration in minutes (web `enhanced.avgDuration`).
 * @property topChargerName the most-frequent charger type (web `enhanced.mostCommonType[0]`).
 * @property topChargerCount how many sessions used it (web `enhanced.mostCommonType[1]`).
 */
data class DetailedEnhancedStats(
    val avgDurationMinutes: Double,
    val topChargerName: String,
    val topChargerCount: Int,
)

/**
 * The render payload — the two web props (`stats` + `enhanced`) bundled so the surface carries a single
 * [UiState] data value. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 */
data class DetailedStatisticsSnapshot(
    val stats: DetailedChargingStats,
    val enhanced: DetailedEnhancedStats,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes
 * before returning JSX. The session [count] and [topChargerCount] stay numeric (the web renders them via
 * `AnimatedNumber` and a bare `{count}` template respectively); every other field is the already-formatted
 * string the matching web helper produces.
 *
 * @property count session count fed to the animated counter (web `<AnimatedNumber value={stats.count} />`).
 * @property avgDuration formatted mean duration (web `formatDuration(enhanced.avgDuration)`).
 * @property avgPower formatted average power with its "kW" unit (web `fmtWithUnit(stats.avgPower, 'kW')`).
 * @property topChargerName the most-common charger type, or [EM_DASH] when absent.
 * @property topChargerCount its occurrence count, rendered bare in the caption (web `(${count}×)`).
 * @property totalCost formatted total cost (web `<Currency value={stats.totalCost} />`).
 * @property avgCostPerKwh formatted cost-per-kWh at 3 decimals (web `<Currency .. precision={3} />`).
 */
data class DetailedStatisticsDisplay(
    val count: Int,
    val avgDuration: String,
    val avgPower: String,
    val topChargerName: String,
    val topChargerCount: Int,
    val totalCost: String,
    val avgCostPerKwh: String,
)

/**
 * The user's currency symbol, resolved from the shared `/settings` document — the native mirror of the web
 * `useFormatting().currencySymbol`. Bundled as a value object so the composable can resolve it once and the
 * projection stays pure.
 *
 * @property currencySymbol the prefix the cost cells render (web default `'$'`).
 */
data class DetailedStatisticsCurrencyPrefs(
    val currencySymbol: String,
) {
    companion object {
        /** The `$` default used before settings load (matches the web default). */
        val DEFAULT: DetailedStatisticsCurrencyPrefs = DetailedStatisticsCurrencyPrefs(DEFAULT_CURRENCY)

        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"

        /** Resolves the currency symbol from the raw `/settings` document (web `useFormatting`). */
        fun fromSettings(settings: JsonElement?): DetailedStatisticsCurrencyPrefs {
            val raw = (settings as? JsonObject)?.get(KEY_CURRENCY_SYMBOL) as? JsonPrimitive
            val symbol = raw?.contentOrNull?.trim()
            return DetailedStatisticsCurrencyPrefs(if (!symbol.isNullOrEmpty()) symbol else DEFAULT_CURRENCY)
        }
    }
}

/**
 * Pure projection from the panel's inputs to its render state — a 1:1 port of the web component's value
 * formatting and the `isLoading ? skeletons : stats ? cards : empty` lifecycle the parent expresses through
 * the shared state holder. Stateless and side-effect-free so it is fully covered by the off-device unit
 * gate; the composable only resolves localized strings, glyphs, and accents and draws what these return.
 */
object DetailedStatisticsProjection {
    /**
     * Maps the panel's `(snapshot, isLoading)` props onto the shared cache-then-network [UiState] (P1/S8),
     * reproducing the web outcomes with the same precedence (`isLoading` wins, then content, then empty):
     *  - loading → [UiPhase.Loading] (the skeleton grid; takes precedence even with a cached snapshot);
     *  - not loading + snapshot present → [UiPhase.Content] (the six stat cells);
     *  - not loading + no snapshot → [UiPhase.Empty] (a friendly empty state, never a blank box).
     *
     * The host's stateful binding can additionally carry refreshing/stale/offline/error; the composable
     * renders those too. This parity adapter only produces the states the web props can express.
     */
    fun projectUiState(
        snapshot: DetailedStatisticsSnapshot?,
        isLoading: Boolean,
    ): UiState<DetailedStatisticsSnapshot> =
        when {
            isLoading -> UiState.loading()
            snapshot != null -> UiState(phase = UiPhase.Content, data = snapshot)
            else -> UiState(phase = UiPhase.Empty)
        }

    /**
     * Projects a resolved [snapshot] onto the render-ready [DetailedStatisticsDisplay], applying the same
     * formatting the web helpers apply at render time. [currency] supplies the cost-cell symbol and [locale]
     * drives every number's grouping/decimal separators (the composable passes the device locale; tests pin
     * one for determinism).
     */
    fun project(
        snapshot: DetailedStatisticsSnapshot,
        currency: DetailedStatisticsCurrencyPrefs,
        locale: Locale,
    ): DetailedStatisticsDisplay {
        val stats = snapshot.stats
        val enhanced = snapshot.enhanced
        return DetailedStatisticsDisplay(
            count = stats.count,
            avgDuration = formatDuration(enhanced.avgDurationMinutes),
            avgPower = formatPower(stats.avgPower, locale),
            topChargerName = enhanced.topChargerName.ifBlank { EM_DASH },
            topChargerCount = enhanced.topChargerCount,
            totalCost = formatCurrency(stats.totalCost, currency.currencySymbol, COST_DECIMALS, locale),
            avgCostPerKwh =
                formatCurrency(stats.avgCostPerKwh, currency.currencySymbol, COST_PER_KWH_DECIMALS, locale),
        )
    }

    /**
     * Formats a duration given in [minutes] — a verbatim port of the web `formatDurationMinutes` (no
     * `subMinuteLabel`, as the web `formatDuration(enhanced.avgDuration)` call passes none): a non-finite or
     * negative value renders [EM_DASH]; otherwise `Hh Mm` when there is at least one whole hour, else `Mm`.
     * The hour part is a bare integer and the minute part is the remainder rounded half away from zero
     * (matching the web `formatRoundedInt` `en-US` `halfExpand`), so 125 → "2h 5m" and 45 → "45m" on both
     * platforms. It is locale-independent, exactly like the web helper's hard-coded `'en-US'` minute group.
     */
    fun formatDuration(minutes: Double): String {
        if (!minutes.isFinite() || minutes < 0.0) return EM_DASH
        val hours = floor(minutes / MINUTES_PER_HOUR).toLong()
        val remainderMinutes = (minutes % MINUTES_PER_HOUR).roundToLong()
        return if (hours > 0L) "${hours}h ${remainderMinutes}m" else "${remainderMinutes}m"
    }

    /**
     * Formats the average power the way the web `fmtWithUnit(stats.avgPower, 'kW')` does: the value is
     * coerced to 0 when non-finite (web `safeNumber`), formatted with [POWER_DECIMALS] grouped fraction
     * digits, then suffixed with a space and "kW". [locale] drives the grouping/decimal symbols.
     */
    fun formatPower(
        value: Double,
        locale: Locale,
    ): String = "${ChartFormat.number(safeValue(value), POWER_DECIMALS, locale)} $POWER_UNIT"

    /**
     * Formats a currency [amount] the way the web `Currency` renders it: a `null` or non-finite value
     * renders [EM_DASH] (the `fallback`), otherwise the [symbol] is prefixed to the value formatted with
     * [decimals] grouped fraction digits (web `currencySymbol + fmtNumber(value, precision)`). A blank symbol
     * degrades to the [DEFAULT_CURRENCY] so the value is never left without a prefix.
     */
    fun formatCurrency(
        amount: Double?,
        symbol: String,
        decimals: Int,
        locale: Locale,
    ): String {
        if (amount == null || !amount.isFinite()) return EM_DASH
        val prefix = symbol.ifBlank { DEFAULT_CURRENCY }
        return "$prefix${ChartFormat.number(amount, decimals.coerceAtLeast(0), locale)}"
    }
}

/** Coerces a non-finite [value] to 0, mirroring the web `safeNumber` guard used before formatting. */
internal fun safeValue(value: Double): Double = if (value.isFinite()) value else 0.0

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [DETAILED_STATISTICS_SLUG] (P1/S11).
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect. Carries no VIN, location, or cost — only the surface slug.
 */
fun recordDetailedStatisticsOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to DETAILED_STATISTICS_SLUG))
}
