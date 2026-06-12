// Pure, framework-free model + projection for the operator-grade TeslaApiUsageCard feature view — the native
// analogue of every value the web component derives before returning JSX
// (web/src/features/system/components/status/TeslaApiUsageCard.tsx). No Compose, no Android UI, no HTTP: every
// declaration here is exercised off-device by the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer over these pure functions.
//
// This is the operator Tesla Fleet API "spend & volume" card on the system status surface. It combines the
// bare `/system/api-usage` snapshot (this-month total + cost + monthly credit) with the richer
// `/api-logs/stats` payload (last-24h burn, average latency, error rate, by-method and by-service splits) and
// feeds the shared <UsageCard> primitive — a budget bar, three at-a-glance bands (This month / Last 24h /
// Forecast EOM), a four-cell detail grid (Useful / Skipped / Avg latency / Error rate), two top-list
// breakdowns (Top services / By method), an over-budget banner, and two footer links (API logs / Tesla
// account).
//
// This file owns the parts the web render derives from those two payloads:
//   • the billing-window arithmetic — month start/end, total days in the month, days elapsed (web
//     `Math.max(1, Math.ceil(...))`) and days remaining, all in the user's local time zone exactly as the web
//     `new Date(year, month, 1)` does;
//   • the budget percentage (web `monthly_credit > 0 ? estimated_cost / monthly_credit * 100 : 0`) and the
//     budget / forecast intents (over-budget danger, >80% warn, EOM-forecast danger);
//   • the band figures — grouped request counts, the per-day average + last-24h burn + two end-of-month
//     forecasts, each currency-formatted through the user's symbol + precision;
//   • the detail figures — useful (total − skipped) and skipped counts, the rounded average latency, and the
//     error rate (web `fmtPercent(errorPct, 1)`) + error-count suffix, each degrading to the long em-dash for
//     a missing / non-finite field exactly as the web `fmtCount` does;
//   • the by-service / by-method de-duplication (web `dedupeMap`) that collapses the camelCase clones the
//     web `camelCaseKeys()` mirrors into grouped maps, then the top-services sort + slice(0, 3).
//
// Binding (P1/S8): this surface performs NO HTTP. The owning host owns the two shared `AdminStore` feeds
// (`/system/api-usage` via the `useAdmin` domain and `/api-logs/stats` via `useApiLogStats`) and threads their
// cache-then-network `Resource<JsonElement>` down through [toTeslaApiUsageUiState] / [toTeslaApiLogStatsUiState],
// so the composable renders every lifecycle state that layer can carry (loading / empty / error / stale /
// offline) without ever fetching — the same host-owns-the-feed contract the sibling AiUsageCard / QuickMetrics
// ports follow. The `fromJson` adapters are the cached-payload → typed-projection seams the off-device unit
// gate covers.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/TeslaApiUsageCard — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.teslaapiusagecard

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.errorKindOf
import io.teslasync.android.data.httpStatusOf
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.math.RoundingMode
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.roundToLong

/** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no PII. */
const val TESLA_API_USAGE_SLUG: String = "TeslaApiUsageCard"

/** Long em dash shown for an unrenderable figure — the native mirror of the web `'—'` fallback. */
internal const val TESLA_API_USAGE_EM_DASH: String = "\u2014"

/** Default currency symbol — the web `useFormatting` fallback when `settings.currency_symbol` is blank. */
internal const val TESLA_API_USAGE_DEFAULT_CURRENCY: String = "$"

/** Default decimal precision — the web `useFormatting` global default (`decimal_precision`, floored at 0). */
internal const val TESLA_API_USAGE_DEFAULT_PRECISION: Int = 2

private const val MILLIS_PER_DAY: Double = 86_400_000.0
private const val PERCENT_SCALE: Double = 100.0
private const val BUDGET_WARN_PCT: Double = 80.0
private const val ERROR_WARN_PCT: Double = 1.0
private const val ERROR_DANGER_PCT: Double = 5.0
private const val TOP_SERVICES_LIMIT: Int = 3
private const val COUNT_DECIMALS: Int = 0
private const val PERCENT_DECIMALS_WHOLE: Int = 0
private const val PERCENT_DECIMALS_TENTHS: Int = 1

/** The visual intent the web computes for a figure; mapped to the shared `UsageIntent` at the render edge. */
enum class ApiUsageIntent { Normal, Warn, Danger }

/**
 * The slice of the `/system/api-usage` snapshot this card reads — the native mirror of the web `APIUsage`
 * fields the component renders (web/src/api/types.ts). Every field is nullable [Double] so a sparse / partial
 * payload never produces `NaN`; the projection coerces the arithmetic inputs to zero (web treats them as
 * present numbers) while keeping the displayed counts em-dashed when genuinely absent.
 *
 * @property totalRequests requests this billing period (web `total_requests`).
 * @property skippedPolls polls skipped because the vehicle was asleep (web `skipped_polls`).
 * @property estimatedCost estimated spend this period (web `estimated_cost`), in the account currency.
 * @property costPerRequest marginal cost of one request (web `cost_per_request`); drives the 24h burn.
 * @property monthlyCredit the documented free monthly credit (web `monthly_credit`); the budget denominator.
 * @property estimatedRemaining the provider's own remaining-credit estimate (web `estimated_remaining`).
 */
data class TeslaApiUsage(
    val totalRequests: Double?,
    val skippedPolls: Double?,
    val estimatedCost: Double?,
    val costPerRequest: Double?,
    val monthlyCredit: Double?,
    val estimatedRemaining: Double?,
) {
    companion object {
        private const val KEY_TOTAL_REQUESTS = "total_requests"
        private const val KEY_SKIPPED_POLLS = "skipped_polls"
        private const val KEY_ESTIMATED_COST = "estimated_cost"
        private const val KEY_COST_PER_REQUEST = "cost_per_request"
        private const val KEY_MONTHLY_CREDIT = "monthly_credit"
        private const val KEY_ESTIMATED_REMAINING = "estimated_remaining"

        /** Parses the shared store's raw `/system/api-usage` element into this typed slice; non-object ⇒ null. */
        fun fromJson(json: JsonElement?): TeslaApiUsage? {
            val obj = json as? JsonObject ?: return null
            return TeslaApiUsage(
                totalRequests = obj.number(KEY_TOTAL_REQUESTS, "totalRequests"),
                skippedPolls = obj.number(KEY_SKIPPED_POLLS, "skippedPolls"),
                estimatedCost = obj.number(KEY_ESTIMATED_COST, "estimatedCost"),
                costPerRequest = obj.number(KEY_COST_PER_REQUEST, "costPerRequest"),
                monthlyCredit = obj.number(KEY_MONTHLY_CREDIT, "monthlyCredit"),
                estimatedRemaining = obj.number(KEY_ESTIMATED_REMAINING, "estimatedRemaining"),
            )
        }
    }
}

/**
 * The slice of `/api-logs/stats` the bands / details / top-lists read — the native mirror of the web
 * `APICallLogStats` fields the component renders. The scalar fields are read snake_case first (the shared
 * `AdminRepository` carries the server JSON unchanged) with the web `camelCaseKeys` alias as a fallback, so the
 * surface binds whether the store mirrors keys or not. The grouped maps keep their original keys; the
 * camelCase clones the web mirror injects are collapsed later by [TeslaApiUsageProjection.dedupeMap].
 *
 * @property last24h calls in the trailing 24h (web `last24h`); `null` ⇒ the web em-dash, never zero.
 * @property errorRate the error rate the backend already returns as a percentage (web `errorRate`).
 * @property errorCount failed calls in the window (web `errorCount`); the optional error-rate suffix.
 * @property avgDurationMs mean request latency in ms (web `avgDurationMs`).
 * @property byMethod call counts grouped by HTTP method (web `by_method`).
 * @property byService call counts grouped by upstream service (web `by_service`).
 */
data class TeslaApiLogStats(
    val last24h: Double?,
    val errorRate: Double?,
    val errorCount: Double?,
    val avgDurationMs: Double?,
    val byMethod: Map<String, Double>,
    val byService: Map<String, Double>,
) {
    companion object {
        /** The all-absent payload used before stats load / when the feed carries nothing. */
        val EMPTY: TeslaApiLogStats =
            TeslaApiLogStats(
                last24h = null,
                errorRate = null,
                errorCount = null,
                avgDurationMs = null,
                byMethod = emptyMap(),
                byService = emptyMap(),
            )

        /** Parses the shared store's raw `/api-logs/stats` element into this typed slice; non-object ⇒ null. */
        fun fromJson(json: JsonElement?): TeslaApiLogStats? {
            val obj = json as? JsonObject ?: return null
            return TeslaApiLogStats(
                last24h = obj.number("last_24h", "last24h"),
                errorRate = obj.number("error_rate", "errorRate"),
                errorCount = obj.number("error_count", "errorCount"),
                avgDurationMs = obj.number("avg_duration_ms", "avgDurationMs"),
                byMethod = obj.numberMap("by_method", "byMethod"),
                byService = obj.numberMap("by_service", "byService"),
            )
        }
    }
}

/**
 * The user's currency + decimal preferences this card needs — the native analogue of the web `useFormatting`
 * inputs (`currency_symbol`, `decimal_precision`) plus the `numberFormat` locale.
 *
 * @property currencySymbol the user's preferred symbol (web `useFormatting().currencySymbol`); blank ⇒ "$".
 * @property precision the currency fraction digits (web `useFormatting` `userPrecision`); negative ⇒ 0.
 * @property locale drives the thousands grouping + decimal separators (web `numberFormat` locale).
 */
data class TeslaApiUsageFormatting(
    val currencySymbol: String,
    val precision: Int,
    val locale: Locale,
) {
    /** The currency symbol with the web's blank ⇒ "$" fallback applied. */
    val resolvedSymbol: String get() = currencySymbol.ifBlank { TESLA_API_USAGE_DEFAULT_CURRENCY }

    /** The precision floored at zero (web `Math.max(0, …)`) so a stray negative never breaks formatting. */
    val resolvedPrecision: Int get() = if (precision < 0) 0 else precision

    companion object {
        /** The web-default bundle ("$", 2 dp, en-US) used by previews / tests and before settings load. */
        val DEFAULT: TeslaApiUsageFormatting =
            TeslaApiUsageFormatting(TESLA_API_USAGE_DEFAULT_CURRENCY, TESLA_API_USAGE_DEFAULT_PRECISION, Locale.US)
    }
}

/** One projected top-list row — the label (HTTP method or service name) and its grouped call count. */
data class TopEntry(
    val label: String,
    val value: String,
)

/**
 * The fully projected, render-ready figures — the native analogue of everything the web component computes
 * before returning JSX. Pure strings + intents + ordered rows (no Compose / no localized words), so the whole
 * projection is unit-tested off-device and the composable only resolves i18n labels and draws this.
 *
 * @property pctOfBudget the budget bar fill (web `pctOfBudget`), unclamped so over-budget is honest.
 * @property pctOfBudgetText the budget percentage label (web `fmtPercent(pctOfBudget, 0)`), e.g. "875%".
 * @property estimatedCostText the spend headline part (web `formatCurrency(estimated_cost)`).
 * @property monthlyCreditText the credit headline part (web `formatCurrency(monthly_credit)`).
 * @property daysElapsed billing-window day index (web `Math.max(1, Math.ceil(...))`).
 * @property totalDaysInMonth days in the billing month (web `Math.ceil((monthEnd − monthStart) / DAY)`).
 * @property daysRemaining days until reset (web `Math.max(0, total − elapsed)`).
 * @property budgetIntent the budget bar intent (over-budget danger / >80% warn / normal).
 * @property overBudget whether the over-budget banner shows (web `estimated_cost > monthly_credit`).
 * @property overageText the banner overage (web `formatCurrency(estimated_cost − monthly_credit)`).
 * @property totalRequestsText the "This month" request count (web `fmtCount(total_requests)`).
 * @property dailyAvgCostText the per-day average spend (web `formatCurrency(dailyAvgCost)`).
 * @property last24hText the "Last 24h" request count (web `fmtCount(last24h)`), em-dash when absent.
 * @property last24hBurnText the per-day burn (web `formatCurrency(last24hBurn)`).
 * @property forecastFromMtdText the month-to-date EOM forecast (web `formatCurrency(forecastFromMtd)`).
 * @property forecastFromRecentText the recent-rate EOM forecast (web `formatCurrency(forecastFromRecent)`).
 * @property forecastIntent the "Forecast EOM" band intent (danger when it exceeds the credit).
 * @property usefulText useful requests (web `fmtCount(total_requests − skipped_polls)`).
 * @property skippedText skipped polls (web `fmtCount(skipped_polls)`).
 * @property avgLatencyText the rounded mean latency (web `Math.round(avgDurationMs)`), null ⇒ em-dash.
 * @property errorRateText the formatted error rate (web `fmtPercent(errorPct, 1)`), null ⇒ em-dash.
 * @property errorCountText the optional error-count suffix (web `fmtCount(errorCount)`), null ⇒ omitted.
 * @property errorIntent the error-rate detail intent (>=5% danger / >=1% warn / normal).
 * @property topServices the top-3 services by call count (web `dedupeMap(...).sort().slice(0, 3)`).
 * @property methodEntries the by-method breakdown (web `dedupeMap(by_method).sort()`), all rows.
 */
@Suppress("LongParameterList") // A resolved-figures DTO: one field per web-derived value the card renders.
data class TeslaApiUsageDisplay(
    val pctOfBudget: Double,
    val pctOfBudgetText: String,
    val estimatedCostText: String,
    val monthlyCreditText: String,
    val daysElapsed: Int,
    val totalDaysInMonth: Int,
    val daysRemaining: Int,
    val budgetIntent: ApiUsageIntent,
    val overBudget: Boolean,
    val overageText: String,
    val totalRequestsText: String,
    val dailyAvgCostText: String,
    val last24hText: String,
    val last24hBurnText: String,
    val forecastFromMtdText: String,
    val forecastFromRecentText: String,
    val forecastIntent: ApiUsageIntent,
    val usefulText: String,
    val skippedText: String,
    val avgLatencyText: String?,
    val errorRateText: String?,
    val errorCountText: String?,
    val errorIntent: ApiUsageIntent,
    val topServices: List<TopEntry>,
    val methodEntries: List<TopEntry>,
)

/**
 * Pure projection from the two payloads (+ the current instant) to the render-ready [TeslaApiUsageDisplay] — a
 * 1:1 port of the figure derivations the web component performs inline (the billing-window arithmetic, the
 * budget / forecast intents, the `fmtCount` counts, the micro-budget currency formatting, the rounded latency,
 * the error-rate rule, and the `dedupeMap` + sort + slice top-lists). Stateless and side-effect-free so it is
 * fully covered by the off-device unit gate.
 */
object TeslaApiUsageProjection {
    /** Projects a present `apiUsage` snapshot (+ the optional `logStats`) onto the render-ready figures. */
    @Suppress("LongMethod", "CyclomaticComplexMethod") // Flat null-safe 1:1 transcription of the web pre-JSX derivations.
    fun project(
        usage: TeslaApiUsage,
        logStats: TeslaApiLogStats?,
        formatting: TeslaApiUsageFormatting,
        now: Long,
        zone: ZoneId,
    ): TeslaApiUsageDisplay {
        val locale = formatting.locale
        val symbol = formatting.resolvedSymbol
        val precision = formatting.resolvedPrecision

        val monthStart = startOfMonthMillis(now, zone)
        val monthEnd = startOfNextMonthMillis(now, zone)
        val totalDaysInMonth = ceil((monthEnd - monthStart) / MILLIS_PER_DAY).toInt()
        val daysElapsed = maxOf(1, ceil((now - monthStart) / MILLIS_PER_DAY).toInt())
        val daysRemaining = maxOf(0, totalDaysInMonth - daysElapsed)

        val estimatedCost = usage.estimatedCost ?: 0.0
        val monthlyCredit = usage.monthlyCredit ?: 0.0
        val costPerRequest = usage.costPerRequest ?: 0.0

        val pctOfBudget = if (monthlyCredit > 0.0) estimatedCost / monthlyCredit * PERCENT_SCALE else 0.0
        val dailyAvgCost = estimatedCost / daysElapsed
        val last24hBurn = (logStats?.last24h ?: 0.0) * costPerRequest
        val forecastFromMtd = dailyAvgCost * totalDaysInMonth
        val forecastFromRecent = last24hBurn * totalDaysInMonth

        val overBudget = estimatedCost > monthlyCredit
        val usefulRequests = usage.totalRequests?.let { it - (usage.skippedPolls ?: 0.0) }
        val errorPct = logStats?.errorRate

        return TeslaApiUsageDisplay(
            pctOfBudget = pctOfBudget,
            pctOfBudgetText = formatPercent(pctOfBudget, PERCENT_DECIMALS_WHOLE, locale),
            estimatedCostText = formatCurrency(estimatedCost, symbol, precision, locale),
            monthlyCreditText = formatCurrency(monthlyCredit, symbol, precision, locale),
            daysElapsed = daysElapsed,
            totalDaysInMonth = totalDaysInMonth,
            daysRemaining = daysRemaining,
            budgetIntent = budgetIntent(estimatedCost, monthlyCredit, pctOfBudget),
            overBudget = overBudget,
            overageText = formatCurrency(estimatedCost - monthlyCredit, symbol, precision, locale),
            totalRequestsText = formatCount(usage.totalRequests, locale),
            dailyAvgCostText = formatCurrency(dailyAvgCost, symbol, precision, locale),
            last24hText = formatCount(logStats?.last24h, locale),
            last24hBurnText = formatCurrency(last24hBurn, symbol, precision, locale),
            forecastFromMtdText = formatCurrency(forecastFromMtd, symbol, precision, locale),
            forecastFromRecentText = formatCurrency(forecastFromRecent, symbol, precision, locale),
            forecastIntent = forecastIntent(forecastFromMtd, monthlyCredit),
            usefulText = formatCount(usefulRequests, locale),
            skippedText = formatCount(usage.skippedPolls, locale),
            avgLatencyText = roundedLatency(logStats?.avgDurationMs)?.let { formatCount(it, locale) },
            errorRateText = errorPct?.let { formatPercent(it, PERCENT_DECIMALS_TENTHS, locale) },
            errorCountText = logStats?.errorCount?.let { formatCount(it, locale) },
            errorIntent = errorIntent(errorPct),
            topServices =
                dedupeMap(logStats?.byService)
                    .sortedByDescending { it.second }
                    .take(TOP_SERVICES_LIMIT)
                    .map { TopEntry(label = it.first, value = formatCount(it.second, locale)) },
            methodEntries =
                dedupeMap(logStats?.byMethod)
                    .sortedByDescending { it.second }
                    .map { TopEntry(label = it.first, value = formatCount(it.second, locale)) },
        )
    }

    /** Web budget intent: over-budget danger, then >80%-of-credit warn, else normal. */
    fun budgetIntent(
        estimatedCost: Double,
        monthlyCredit: Double,
        pctOfBudget: Double,
    ): ApiUsageIntent =
        when {
            estimatedCost > monthlyCredit -> ApiUsageIntent.Danger
            pctOfBudget > BUDGET_WARN_PCT -> ApiUsageIntent.Warn
            else -> ApiUsageIntent.Normal
        }

    /** Web "Forecast EOM" intent: danger when the month-to-date forecast exceeds the monthly credit. */
    fun forecastIntent(
        forecastFromMtd: Double,
        monthlyCredit: Double,
    ): ApiUsageIntent = if (forecastFromMtd > monthlyCredit) ApiUsageIntent.Danger else ApiUsageIntent.Normal

    /** Web error-rate intent: danger at >=5%, warn at >=1%, else normal (also normal when the rate is absent). */
    fun errorIntent(errorPct: Double?): ApiUsageIntent =
        when {
            errorPct != null && errorPct >= ERROR_DANGER_PCT -> ApiUsageIntent.Danger
            errorPct != null && errorPct >= ERROR_WARN_PCT -> ApiUsageIntent.Warn
            else -> ApiUsageIntent.Normal
        }

    /** Local-time start of the billing month — the native mirror of the web `new Date(year, month, 1)`. */
    fun startOfMonthMillis(
        now: Long,
        zone: ZoneId,
    ): Long =
        Instant
            .ofEpochMilli(now)
            .atZone(zone)
            .toLocalDate()
            .withDayOfMonth(1)
            .atStartOfDay(zone)
            .toInstant()
            .toEpochMilli()

    /** Local-time start of the next month — the native mirror of the web `new Date(year, month + 1, 1)`. */
    fun startOfNextMonthMillis(
        now: Long,
        zone: ZoneId,
    ): Long =
        Instant
            .ofEpochMilli(now)
            .atZone(zone)
            .toLocalDate()
            .withDayOfMonth(1)
            .plusMonths(1)
            .atStartOfDay(zone)
            .toInstant()
            .toEpochMilli()

    /**
     * Web `dedupeMap`: collapses the camelCase clones `camelCaseKeys()` mirrors into a grouped map so a service
     * / method renders once. A snake_case key is kept; its camelCase alias (no underscore) is dropped; any
     * further key whose underscore-stripped lowercase form was already seen is skipped. Iteration order (and
     * therefore tie order) follows the source map's insertion order, exactly as the web `Object.entries` does.
     */
    fun dedupeMap(map: Map<String, Double>?): List<Pair<String, Double>> {
        if (map == null) return emptyList()
        val entries = map.entries.toList()
        val aliases =
            entries
                .map { it.key }
                .filter { it.contains('_') }
                .map { snake -> CAMEL_BOUNDARY.replace(snake) { it.groupValues[1].uppercase(Locale.ROOT) } }
                .toSet()
        val out = mutableListOf<Pair<String, Double>>()
        val seen = mutableSetOf<String>()
        for ((key, value) in entries) {
            val isCamelClone = key in aliases && !key.contains('_')
            if (!isCamelClone) {
                val normalized = key.lowercase(Locale.ROOT).replace("_", "")
                if (seen.add(normalized)) out.add(key to value)
            }
        }
        return out
    }

    /** Web `Math.round(avg_duration_ms)` — rounds to a whole millisecond, or `null` for a null / non-finite input. */
    fun roundedLatency(ms: Double?): Double? = if (ms == null || !ms.isFinite()) null else 1.0 * ms.roundToLong()

    /** Web `fmtCount(n)` == `fmtInt(n)`: grouped integer, or the em-dash for a null / non-finite value. */
    fun formatCount(
        value: Double?,
        locale: Locale,
    ): String {
        if (value == null || !value.isFinite()) return TESLA_API_USAGE_EM_DASH
        return numberFormat(COUNT_DECIMALS, locale).format(value)
    }

    /** Web `formatCurrency(amount)`: the currency symbol followed by the grouped amount at [precision] dp. */
    fun formatCurrency(
        dollars: Double,
        symbol: String,
        precision: Int,
        locale: Locale,
    ): String {
        val safe = if (dollars.isFinite()) dollars else 0.0
        return symbol + numberFormat(if (precision < 0) 0 else precision, locale).format(safe)
    }

    /** Web `fmtPercent(v, d)` == `fmtNumber(v, d) + '%'`, coercing a non-finite input to zero (web `safeNumber`). */
    fun formatPercent(
        value: Double,
        decimals: Int,
        locale: Locale,
    ): String {
        val safe = if (value.isFinite()) value else 0.0
        return numberFormat(if (decimals < 0) 0 else decimals, locale).format(safe) + "%"
    }

    // Web `fmtNumber` uses ECMAScript `Intl.NumberFormat` (halfExpand) grouping; HALF_UP matches it rather
    // than Java's default banker's rounding (HALF_EVEN).
    private fun numberFormat(
        decimals: Int,
        locale: Locale,
    ): NumberFormat =
        NumberFormat.getNumberInstance(locale).apply {
            minimumFractionDigits = decimals
            maximumFractionDigits = decimals
            isGroupingUsed = true
            roundingMode = RoundingMode.HALF_UP
        }

    private val CAMEL_BOUNDARY = Regex("_([a-z0-9])")
}

/**
 * Maps the shared `AdminStore` `/system/api-usage` feed's cache-then-network [Resource] onto the Android
 * [UiState] this card binds (the host wires `store.apiUsage().map { it.toTeslaApiUsageUiState() }`). The cached
 * payload is parsed at every emission so a cold-start replay and an offline "last known" snapshot both render
 * the real card; an unparseable / absent payload resolves to the empty phase (the web `!apiUsage` empty card).
 */
fun Resource<JsonElement>.toTeslaApiUsageUiState(): UiState<TeslaApiUsage> =
    when (this) {
        is Resource.Loading ->
            TeslaApiUsage.fromJson(cached)?.let { value ->
                UiState(UiPhase.Content, data = value, fetchedAt = fetchedAt, stale = stale, refreshing = true)
            } ?: UiState.loading()

        is Resource.Success ->
            TeslaApiUsage.fromJson(data)?.let { value ->
                UiState(UiPhase.Content, data = value, fetchedAt = fetchedAt)
            } ?: UiState(UiPhase.Empty, fetchedAt = fetchedAt)

        is Resource.Error ->
            TeslaApiUsage.fromJson(cached)?.let { value ->
                UiState(
                    phase = UiPhase.Content,
                    data = value,
                    fetchedAt = fetchedAt,
                    stale = true,
                    errorKind = errorKindOf(error),
                    httpStatus = httpStatusOf(error),
                )
            } ?: UiState(
                phase = UiPhase.Error,
                fetchedAt = fetchedAt,
                stale = stale,
                errorKind = errorKindOf(error),
                httpStatus = httpStatusOf(error),
            )
    }

/**
 * Maps the shared `AdminStore` `/api-logs/stats` feed onto a [UiState] of the parsed stats. This is the
 * secondary feed: it only contributes the 24h / latency / error / breakdown figures, so it never drives the
 * empty phase (the primary usage feed does) — the predicate is therefore always `false`. A loading / error
 * emission with no cache carries a `null` payload, which the composable degrades to the web em-dashes.
 */
fun Resource<JsonElement>.toTeslaApiLogStatsUiState(): UiState<TeslaApiLogStats> =
    when (this) {
        is Resource.Loading -> Resource.Loading(TeslaApiLogStats.fromJson(cached), fetchedAt, stale)
        is Resource.Success -> Resource.Success(TeslaApiLogStats.fromJson(data) ?: TeslaApiLogStats.EMPTY, fetchedAt, stale)
        is Resource.Error -> Resource.Error(TeslaApiLogStats.fromJson(cached), fetchedAt, stale, error)
    }.toUiState { false }

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a request
 * count, a cost, an error rate, or a service name — so a diagnostics line can never leak the operator's spend.
 */
object TeslaApiUsageDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = TESLA_API_USAGE_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

/** Reads the first present numeric value across [keys] (snake_case first, camelCase alias fallback). */
private fun JsonObject.number(vararg keys: String): Double? {
    for (key in keys) {
        val value = (this[key] as? JsonPrimitive)?.doubleOrNull
        if (value != null) return value
    }
    return null
}

/** Reads the first present grouped numeric map across [keys], preserving the server's insertion order. */
private fun JsonObject.numberMap(vararg keys: String): Map<String, Double> {
    for (key in keys) {
        val obj = this[key] as? JsonObject ?: continue
        val out = LinkedHashMap<String, Double>(obj.size)
        for ((mapKey, mapValue) in obj) {
            val number = (mapValue as? JsonPrimitive)?.doubleOrNull
            if (number != null) out[mapKey] = number
        }
        return out
    }
    return emptyMap()
}
