// The native Jetpack Compose + Material 3 TeslaApiUsageCard feature view — a parity port of the operator-grade
// Tesla Fleet API spend & volume card on the system status surface
// (web/src/features/system/components/status/TeslaApiUsageCard.tsx). The web component combines the
// `/system/api-usage` snapshot (this-month total + cost + monthly credit) with the `/api-logs/stats` payload
// (last-24h burn, average latency, error rate, by-method and by-service splits) and feeds the shared
// <UsageCard> primitive: a budget bar, three at-a-glance bands (This month / Last 24h / Forecast EOM), a
// four-cell detail grid, two top-list breakdowns (Top services / By method), an over-budget banner, and two
// footer links (API logs / Tesla account). Its only hooks are `useApiLogStats` (the `useAdmin` domain) and
// `useFormatting`; the `apiUsage` snapshot + the ticking `now` arrive from the page.
//
// This port keeps that contract end to end and binds to the native <UsageCard> counterpart. The host owns the
// two shared `AdminStore` feeds (P1/S8) and threads their cache-then-network state down as two [UiState]s plus
// an `onRetry` (the store's refresh) and the two navigation callbacks the footer links fire; this view performs
// NO HTTP. Because the web card owns no skeleton / error-screen / retry chrome of its own, this surface layers
// the honest cache-then-network states the P3 contract requires: a header freshness chip surfaces refreshing /
// stale / offline; a soft-stale value auto-refreshes (mirroring the web `refetchInterval`); an offline "last
// known" snapshot is shown from cache rather than blanked; and a hard error with no cache shows a localized
// retryable error card. Every figure derivation flows through the pure [TeslaApiUsageProjection]; this file
// resolves the i18n labels (P1/S10), the currency symbol + locale + precision (P1/S8 settings store), the
// billing-window time zone, and draws them. There is no hard-coded English literal here — every visible string
// resolves through the shared i18n facade [resolveI18nKey], reproducing i18next's key-as-fallback: a
// catalog-backed key localizes, otherwise the verbatim region text from the (anonymous) web source renders,
// identical to the web output. The Android string-resource name is `translation_` + the key with every
// non-resource character folded to `_`, matching the P1/S10 generator's `androidName` transform.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/TeslaApiUsageCard — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path — exactly as the sibling feature-view
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located stateless content, helpers and
// previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.teslaapiusagecard

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.UsageBand
import io.teslasync.android.components.datadisplay.UsageBanner
import io.teslasync.android.components.datadisplay.UsageBudget
import io.teslasync.android.components.datadisplay.UsageCard
import io.teslasync.android.components.datadisplay.UsageDetail
import io.teslasync.android.components.datadisplay.UsageFooterLink
import io.teslasync.android.components.datadisplay.UsageIntent
import io.teslasync.android.components.datadisplay.UsageTopList
import io.teslasync.android.components.datadisplay.UsageTopListItem
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.time.ZoneId
import java.util.Locale

/** The settings document key the web `useFormatting` reads the preferred currency symbol from. */
private const val CURRENCY_SYMBOL_KEY = "currency_symbol"

private const val I18N_RESOURCE_PREFIX = "translation_"
private val NON_RESOURCE_CHARS = Regex("[^A-Za-z0-9_]")

/** The " · " separator the web joins the billing-window caption parts with (punctuation, language-neutral). */
private const val CAPTION_SEPARATOR = " \u00B7 "

// ── i18n keys (verbatim regions from the anonymous web source; resolved key-as-fallback via the P1/S10 facade) ──
private const val KEY_EMPTY = "Tesla API usage data is not available yet."
private const val KEY_BUDGET_ARIA = "Tesla API budget used"
private const val KEY_OF = "of"
private const val KEY_OF_MONTHLY_CREDIT = "of monthly credit"
private const val KEY_CAPTION_DAY_OF = "Day %1\$d of %2\$d"
private const val KEY_RESETS_TOMORROW = "resets tomorrow"
private const val KEY_RESETS_IN_DAY = "resets in %1\$d day"
private const val KEY_RESETS_IN_DAYS = "resets in %1\$d days"
private const val KEY_BAND_THIS_MONTH = "This month"
private const val KEY_BAND_LAST_24H = "Last 24h"
private const val KEY_BAND_FORECAST_EOM = "Forecast EOM"
private const val KEY_UNIT_REQUESTS = "requests"
private const val KEY_DAY_AVG_SUFFIX = "/day avg"
private const val KEY_DAY_BURN_SUFFIX = "/day burn"
private const val KEY_RECENT_RATE_PREFIX = "recent rate: "
private const val KEY_DETAIL_USEFUL = "Useful"
private const val KEY_DETAIL_SKIPPED = "Skipped (asleep)"
private const val KEY_DETAIL_AVG_LATENCY = "Avg latency"
private const val KEY_DETAIL_ERROR_RATE = "Error rate"
private const val KEY_MS = "ms"
private const val KEY_TOP_SERVICES = "Top services"
private const val KEY_BY_METHOD = "By method"
private const val KEY_BANNER_TITLE = "Over monthly credit"
private const val KEY_BANNER_DESC =
    "Spend has exceeded the %1\$s monthly credit by %2\$s. Review polling cadence or vehicle subscriptions."
private const val KEY_FOOTER_API_LOGS = "Open API Logs"
private const val KEY_FOOTER_TESLA_ACCOUNT = "Tesla account"

// Error-state copy — the web card has no error chrome; the P3 contract mandates a retryable error surface, so
// these native-added regions resolve through the same facade (catalog-backed if present, else this fallback).
private const val KEY_ERROR_TITLE = "Couldn\u2019t load Tesla API usage"
private const val KEY_ERROR_MESSAGE = "Check your connection and try again."
private const val KEY_RETRY = "Retry"

/**
 * Stateful entry point — the faithful port of the web `TeslaApiUsageCard({ apiUsage, now })` (which also owns
 * `useApiLogStats()`). Resolves the display formatting from the shared settings store (P1/S8), records the
 * one-shot PII-safe `view.opened` diagnostic (P1/S11) on first composition, and renders every lifecycle state
 * the host's two `AdminStore` feeds carry. The host maps those feeds via [toTeslaApiUsageUiState] /
 * [toTeslaApiLogStatsUiState] and supplies [onRetry] (its refresh) plus the footer navigation callbacks; this
 * view never performs HTTP.
 *
 * @param apiUsage the cache-then-network projection of `/system/api-usage` (web `apiUsage` prop).
 * @param logStats the projection of `/api-logs/stats` (web `useApiLogStats()` result).
 * @param onRetry re-runs the host's load — wired to the soft-stale auto-refresh + the error retry.
 * @param onOpenApiLogs fires the "Open API Logs" footer link (web `<Link to="/api-logs">`).
 * @param onOpenTeslaAccount fires the "Tesla account" footer link (web `<Link to="/tesla-account">`).
 * @param now the instant the billing-window countdown is computed against (web `now` page tick).
 * @param zone the time zone the month boundaries are computed in (web `new Date(...)` local time).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun TeslaApiUsageCard(
    apiUsage: UiState<TeslaApiUsage>,
    logStats: UiState<TeslaApiLogStats>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    onOpenApiLogs: () -> Unit = {},
    onOpenTeslaAccount: () -> Unit = {},
    now: Long = System.currentTimeMillis(),
    zone: ZoneId = ZoneId.systemDefault(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val container = LocalDataContainer.current
    val settings by container.settingsStore.settings().collectAsStateWithLifecycle()
    val formatting = remember(settings.cached) { resolveFormatting(settings.cached) }
    LaunchedEffect(Unit) { TeslaApiUsageDiagnostics.recordViewOpened(logger) }
    TeslaApiUsageCardContent(
        apiUsage = apiUsage,
        logStats = logStats,
        onRetry = onRetry,
        modifier = modifier,
        onOpenApiLogs = onOpenApiLogs,
        onOpenTeslaAccount = onOpenTeslaAccount,
        now = now,
        zone = zone,
        formatting = formatting,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web card
 * (the <UsageCard> budget bar / bands / details / top-lists / banner / footer) and adds the honest freshness
 * chip + retryable error surface the host's feeds imply. A soft-stale (non-error) `apiUsage` auto-refreshes,
 * mirroring the web `refetchInterval`. The primary `apiUsage` feed drives the surface (web `!apiUsage` ⇒ the
 * empty message; otherwise the populated card); the secondary `logStats` feed only contributes the 24h / latency
 * / error / breakdown figures, degrading each missing field to the web em-dash and omitting an empty top-list.
 */
@Composable
fun TeslaApiUsageCardContent(
    apiUsage: UiState<TeslaApiUsage>,
    logStats: UiState<TeslaApiLogStats>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    onOpenApiLogs: () -> Unit = {},
    onOpenTeslaAccount: () -> Unit = {},
    now: Long = System.currentTimeMillis(),
    zone: ZoneId = ZoneId.systemDefault(),
    formatting: TeslaApiUsageFormatting = TeslaApiUsageFormatting.DEFAULT,
) {
    LaunchedEffect(apiUsage.stale, apiUsage.refreshing, apiUsage.hasError) {
        if (apiUsage.stale && !apiUsage.refreshing && !apiUsage.hasError) onRetry()
    }
    val strings = rememberTeslaApiUsageStrings()
    if (apiUsage.isError) {
        GlassPanel(modifier = modifier) {
            ErrorDisplay(
                message = strings.errorMessage,
                title = strings.errorTitle,
                icon = DataDisplayGlyphs.WifiOff,
                onRetry = onRetry,
                retryLabel = strings.retry,
            )
        }
        return
    }
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        if (shouldShowFreshness(apiUsage)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TeslaApiUsageFreshnessChip(state = apiUsage)
            }
        }
        TeslaApiUsageBody(
            apiUsage = apiUsage,
            logStats = logStats,
            strings = strings,
            formatting = formatting,
            now = now,
            zone = zone,
            onOpenApiLogs = onOpenApiLogs,
            onOpenTeslaAccount = onOpenTeslaAccount,
        )
    }
}

/** True whenever the `apiUsage` feed is loading, refreshing over cache, stale, or offline — i.e. not settled-fresh. */
private fun shouldShowFreshness(state: UiState<*>): Boolean = state.isLoading || state.refreshing || state.stale || state.hasError

/**
 * The <UsageCard> body, driven by the primary `apiUsage` feed: the friendly empty message (web `!apiUsage` —
 * also the first-load surface, the freshness chip above marking it as loading), or the populated budget / bands
 * / details / top-lists / banner / footer. Offline "last known" and refreshing-over-cache both fall through to
 * the populated branch (the chip above carries the freshness), so a working snapshot is never blanked.
 */
@Composable
private fun TeslaApiUsageBody(
    apiUsage: UiState<TeslaApiUsage>,
    logStats: UiState<TeslaApiLogStats>,
    strings: TeslaApiUsageStrings,
    formatting: TeslaApiUsageFormatting,
    now: Long,
    zone: ZoneId,
    onOpenApiLogs: () -> Unit,
    onOpenTeslaAccount: () -> Unit,
) {
    val usage = apiUsage.data
    if (usage == null) {
        UsageCard(emptyMessage = strings.empty)
        return
    }
    val display =
        remember(usage, logStats.data, formatting, now, zone) {
            TeslaApiUsageProjection.project(usage, logStats.data, formatting, now, zone)
        }
    UsageCard(
        budget = teslaApiUsageBudget(display, strings),
        bands = teslaApiUsageBands(display, strings),
        details = teslaApiUsageDetails(display, strings),
        topLists = teslaApiUsageTopLists(display, strings),
        banner = teslaApiUsageBanner(display, strings),
        footer = teslaApiUsageFooter(strings, onOpenApiLogs, onOpenTeslaAccount),
    )
}

/** The budget progress bar (web `budget`): the spend headline, percentage label, day countdown, and intent. */
private fun teslaApiUsageBudget(
    display: TeslaApiUsageDisplay,
    strings: TeslaApiUsageStrings,
): UsageBudget {
    val resetText =
        when (display.daysRemaining) {
            0 -> strings.resetsTomorrow
            1 -> strings.resetsInDay.format(1)
            else -> strings.resetsInDays.format(display.daysRemaining)
        }
    val caption = "${strings.captionDayOf.format(display.daysElapsed, display.totalDaysInMonth)}$CAPTION_SEPARATOR$resetText"
    return UsageBudget(
        headline = "${display.estimatedCostText} ${strings.of} ${display.monthlyCreditText}",
        pct = display.pctOfBudget.toFloat(),
        ariaLabel = strings.budgetAria,
        rightLabel = "${display.pctOfBudgetText} ${strings.ofMonthlyCredit}",
        caption = caption,
        intent = toUsageIntent(display.budgetIntent),
    )
}

/** The three at-a-glance bands (web This month / Last 24h / Forecast EOM), with the forecast intent on band 3. */
private fun teslaApiUsageBands(
    display: TeslaApiUsageDisplay,
    strings: TeslaApiUsageStrings,
): List<UsageBand> =
    listOf(
        UsageBand(
            label = strings.bandThisMonth,
            value = "${display.totalRequestsText} ${strings.unitRequests}",
            sub = "${display.dailyAvgCostText}${strings.dayAvgSuffix}",
            icon = DataDisplayGlyphs.Gauge,
        ),
        UsageBand(
            label = strings.bandLast24h,
            value = "${display.last24hText} ${strings.unitRequests}",
            sub = "${display.last24hBurnText}${strings.dayBurnSuffix}",
            icon = DataDisplayGlyphs.Clock,
        ),
        UsageBand(
            label = strings.bandForecastEom,
            value = display.forecastFromMtdText,
            sub = "${strings.recentRatePrefix}${display.forecastFromRecentText}",
            icon = DataDisplayGlyphs.ArrowUp,
            intent = toUsageIntent(display.forecastIntent),
        ),
    )

/** The four-cell detail grid (web Useful / Skipped / Avg latency / Error rate). */
private fun teslaApiUsageDetails(
    display: TeslaApiUsageDisplay,
    strings: TeslaApiUsageStrings,
): List<UsageDetail> {
    val avgLatency = display.avgLatencyText?.let { "$it ${strings.ms}" } ?: TESLA_API_USAGE_EM_DASH
    val errorRate =
        display.errorRateText?.let { rate ->
            display.errorCountText?.let { count -> "$rate ($count)" } ?: rate
        } ?: TESLA_API_USAGE_EM_DASH
    return listOf(
        UsageDetail(label = strings.detailUseful, value = display.usefulText),
        UsageDetail(label = strings.detailSkipped, value = display.skippedText),
        UsageDetail(label = strings.detailAvgLatency, value = avgLatency),
        UsageDetail(label = strings.detailErrorRate, value = errorRate, intent = toUsageIntent(display.errorIntent)),
    )
}

/** The two top-list breakdowns, each added only when its source carries rows (web `length > 0`). */
private fun teslaApiUsageTopLists(
    display: TeslaApiUsageDisplay,
    strings: TeslaApiUsageStrings,
): List<UsageTopList> =
    buildList {
        if (display.topServices.isNotEmpty()) {
            add(
                UsageTopList(
                    key = "services",
                    title = strings.topServices,
                    icon = DataDisplayGlyphs.Bolt,
                    items = display.topServices.map { UsageTopListItem(key = it.label, label = it.label, value = it.value) },
                ),
            )
        }
        if (display.methodEntries.isNotEmpty()) {
            add(
                UsageTopList(
                    key = "methods",
                    title = strings.byMethod,
                    icon = DataDisplayGlyphs.Gauge,
                    items = display.methodEntries.map { UsageTopListItem(key = it.label, label = it.label, value = it.value) },
                ),
            )
        }
    }

/** The over-budget callout (web `banner`), present only when spend exceeds the monthly credit. */
private fun teslaApiUsageBanner(
    display: TeslaApiUsageDisplay,
    strings: TeslaApiUsageStrings,
): UsageBanner? =
    if (display.overBudget) {
        UsageBanner(
            title = strings.bannerTitle,
            description = strings.bannerDescription.format(display.monthlyCreditText, display.overageText),
            intent = UsageIntent.Danger,
        )
    } else {
        null
    }

/** The two footer links (web `/api-logs` primary + `/tesla-account`), wired to the host's navigation callbacks. */
private fun teslaApiUsageFooter(
    strings: TeslaApiUsageStrings,
    onOpenApiLogs: () -> Unit,
    onOpenTeslaAccount: () -> Unit,
): List<UsageFooterLink> =
    listOf(
        UsageFooterLink(key = "logs", label = strings.footerApiLogs, onClick = onOpenApiLogs, primary = true),
        UsageFooterLink(key = "tesla", label = strings.footerTeslaAccount, onClick = onOpenTeslaAccount),
    )

/** Maps the pure [ApiUsageIntent] onto the shared [UsageIntent] the <UsageCard> accent uses. */
private fun toUsageIntent(intent: ApiUsageIntent): UsageIntent =
    when (intent) {
        ApiUsageIntent.Normal -> UsageIntent.Normal
        ApiUsageIntent.Warn -> UsageIntent.Warn
        ApiUsageIntent.Danger -> UsageIntent.Danger
    }

/** The header freshness chip — the honest "refreshing / stale / offline / loading" affordance over the card. */
@Composable
private fun TeslaApiUsageFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing || state.isLoading,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberFreshnessFormatter(),
    )
}

/**
 * Resolves the [TeslaApiUsageFormatting] from a settings document (P1/S8) — the native projection of the web
 * `useFormatting` result (currency symbol + precision) plus the `numberFormat` locale. The symbol falls back to
 * the web default ("$") when blank; the locale + precision come from the shared [UnitPreferences] derivation.
 */
private fun resolveFormatting(cached: JsonElement?): TeslaApiUsageFormatting {
    val symbol = ((cached as? JsonObject)?.get(CURRENCY_SYMBOL_KEY) as? JsonPrimitive)?.contentOrNull
    val currencySymbol = if (!symbol.isNullOrBlank()) symbol else TESLA_API_USAGE_DEFAULT_CURRENCY
    val prefs = UnitPreferences.fromSettings(cached)
    val localeTag = prefs.locale
    val locale = if (localeTag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(localeTag)
    val precision = prefs.precision ?: TESLA_API_USAGE_DEFAULT_PRECISION
    return TeslaApiUsageFormatting(currencySymbol = currencySymbol, precision = precision, locale = locale)
}

/** The surface's display strings, resolved once per locale from the i18n facade (P1/S10) at the render boundary. */
@Suppress("LongParameterList") // A resolved-strings DTO: one field per visible region of the web source.
private data class TeslaApiUsageStrings(
    val empty: String,
    val budgetAria: String,
    val of: String,
    val ofMonthlyCredit: String,
    val captionDayOf: String,
    val resetsTomorrow: String,
    val resetsInDay: String,
    val resetsInDays: String,
    val bandThisMonth: String,
    val bandLast24h: String,
    val bandForecastEom: String,
    val unitRequests: String,
    val dayAvgSuffix: String,
    val dayBurnSuffix: String,
    val recentRatePrefix: String,
    val detailUseful: String,
    val detailSkipped: String,
    val detailAvgLatency: String,
    val detailErrorRate: String,
    val ms: String,
    val topServices: String,
    val byMethod: String,
    val bannerTitle: String,
    val bannerDescription: String,
    val footerApiLogs: String,
    val footerTeslaAccount: String,
    val errorTitle: String,
    val errorMessage: String,
    val retry: String,
)

/** Resolves every web region through [resolveI18nKey] once per locale, reproducing i18next's key-as-fallback. */
@Composable
private fun rememberTeslaApiUsageStrings(): TeslaApiUsageStrings {
    val context = LocalContext.current
    return remember(context) {
        TeslaApiUsageStrings(
            empty = context.resolveI18nKey(KEY_EMPTY),
            budgetAria = context.resolveI18nKey(KEY_BUDGET_ARIA),
            of = context.resolveI18nKey(KEY_OF),
            ofMonthlyCredit = context.resolveI18nKey(KEY_OF_MONTHLY_CREDIT),
            captionDayOf = context.resolveI18nKey(KEY_CAPTION_DAY_OF),
            resetsTomorrow = context.resolveI18nKey(KEY_RESETS_TOMORROW),
            resetsInDay = context.resolveI18nKey(KEY_RESETS_IN_DAY),
            resetsInDays = context.resolveI18nKey(KEY_RESETS_IN_DAYS),
            bandThisMonth = context.resolveI18nKey(KEY_BAND_THIS_MONTH),
            bandLast24h = context.resolveI18nKey(KEY_BAND_LAST_24H),
            bandForecastEom = context.resolveI18nKey(KEY_BAND_FORECAST_EOM),
            unitRequests = context.resolveI18nKey(KEY_UNIT_REQUESTS),
            dayAvgSuffix = context.resolveI18nKey(KEY_DAY_AVG_SUFFIX),
            dayBurnSuffix = context.resolveI18nKey(KEY_DAY_BURN_SUFFIX),
            recentRatePrefix = context.resolveI18nKey(KEY_RECENT_RATE_PREFIX),
            detailUseful = context.resolveI18nKey(KEY_DETAIL_USEFUL),
            detailSkipped = context.resolveI18nKey(KEY_DETAIL_SKIPPED),
            detailAvgLatency = context.resolveI18nKey(KEY_DETAIL_AVG_LATENCY),
            detailErrorRate = context.resolveI18nKey(KEY_DETAIL_ERROR_RATE),
            ms = context.resolveI18nKey(KEY_MS),
            topServices = context.resolveI18nKey(KEY_TOP_SERVICES),
            byMethod = context.resolveI18nKey(KEY_BY_METHOD),
            bannerTitle = context.resolveI18nKey(KEY_BANNER_TITLE),
            bannerDescription = context.resolveI18nKey(KEY_BANNER_DESC),
            footerApiLogs = context.resolveI18nKey(KEY_FOOTER_API_LOGS),
            footerTeslaAccount = context.resolveI18nKey(KEY_FOOTER_TESLA_ACCOUNT),
            errorTitle = context.resolveI18nKey(KEY_ERROR_TITLE),
            errorMessage = context.resolveI18nKey(KEY_ERROR_MESSAGE),
            retry = context.resolveI18nKey(KEY_RETRY),
        )
    }
}

/**
 * Resolves a web region against the shared catalog (P1/S10): the localized string when the catalog carries the
 * key, otherwise the region text itself — reproducing i18next's key-as-fallback. The by-name lookup is the only
 * way to express "resolve if present, else fall back" (a compile-time `R.string` reference cannot), so
 * `DiscouragedApi` is suppressed; release builds keep resource names (shrinking is off), so the lookup is stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.resolveI18nKey(key: String): String {
    val resourceName = I18N_RESOURCE_PREFIX + NON_RESOURCE_CHARS.replace(key, "_")
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else key
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> TESLA_API_USAGE_EM_DASH
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(age.value)
                is FreshnessAge.Minutes -> minutes.format(age.value)
                is FreshnessAge.Hours -> hours.format(age.value)
                is FreshnessAge.Days -> days.format(age.value)
                is FreshnessAge.Weeks -> weeks.format(age.value)
            }
        }
    }
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private const val PREVIEW_NOW = 1_736_942_400_000L // 2025-01-15T12:00:00Z
private val PREVIEW_ZONE = ZoneId.of("UTC")

private val PREVIEW_USAGE =
    TeslaApiUsage(
        totalRequests = 39_436.0,
        skippedPolls = 1_280.0,
        estimatedCost = 87.55,
        costPerRequest = 0.00222,
        monthlyCredit = 10.0,
        estimatedRemaining = 0.0,
    )

private val PREVIEW_LOG_STATS =
    TeslaApiLogStats(
        last24h = 2_800.0,
        errorRate = 1.2,
        errorCount = 470.0,
        avgDurationMs = 184.0,
        byMethod = linkedMapOf("GET" to 30_000.0, "POST" to 9_436.0),
        byService = linkedMapOf("tesla_fleet" to 28_000.0, "tesla_streaming" to 11_000.0),
    )

@Preview(name = "Content — over budget", showBackground = true, widthDp = 420)
@Composable
private fun TeslaApiUsageContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TeslaApiUsageCardContent(
            apiUsage = UiState(UiPhase.Content, data = PREVIEW_USAGE),
            logStats = UiState(UiPhase.Content, data = PREVIEW_LOG_STATS),
            onRetry = {},
            now = PREVIEW_NOW,
            zone = PREVIEW_ZONE,
        )
    }
}

@Preview(name = "Empty — no snapshot", showBackground = true, widthDp = 420)
@Composable
private fun TeslaApiUsageEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TeslaApiUsageCardContent(
            apiUsage = UiState(UiPhase.Empty),
            logStats = UiState(UiPhase.Empty, data = TeslaApiLogStats.EMPTY),
            onRetry = {},
            now = PREVIEW_NOW,
            zone = PREVIEW_ZONE,
        )
    }
}

@Preview(name = "Loading — first fetch", showBackground = true, widthDp = 420)
@Composable
private fun TeslaApiUsageLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TeslaApiUsageCardContent(
            apiUsage = UiState(UiPhase.Loading),
            logStats = UiState(UiPhase.Loading),
            onRetry = {},
            now = PREVIEW_NOW,
            zone = PREVIEW_ZONE,
        )
    }
}

@Preview(name = "Error — no cache", showBackground = true, widthDp = 420)
@Composable
private fun TeslaApiUsageErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TeslaApiUsageCardContent(
            apiUsage = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            logStats = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            now = PREVIEW_NOW,
            zone = PREVIEW_ZONE,
        )
    }
}

@Preview(name = "Offline — cached last known", showBackground = true, widthDp = 420)
@Composable
private fun TeslaApiUsageOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TeslaApiUsageCardContent(
            apiUsage =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_USAGE,
                    stale = true,
                    fetchedAt = PREVIEW_NOW,
                    errorKind = ErrorKind.Network,
                ),
            logStats = UiState(UiPhase.Content, data = PREVIEW_LOG_STATS),
            onRetry = {},
            now = PREVIEW_NOW,
            zone = PREVIEW_ZONE,
        )
    }
}
