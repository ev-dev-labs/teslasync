// The native Jetpack Compose + Material 3 AiUsageCard feature view — a parity port of the operator-grade AI
// spend & volume card on the system status surface (web/src/features/system/components/status/AiUsageCard.tsx).
// The web component feeds the shared <UsageCard> primitive with three at-a-glance bands (Today / Tokens /
// Cost·latency), a four-cell detail grid, and two top-list breakdowns (By feature over 7 days, Recent calls),
// reading three audit feeds (`useAiUsageToday`, `useAiUsageByFeature`, `useAiUsageRecent(10)`) plus
// `useFormatting`; its `AiUsageCard()` wrapper gates on `ai_mode != 'off'` (ADR-015 §I4) and renders nothing
// when AI is off, so no AI surface ever enters an off-mode app.
//
// This port keeps that contract end to end and binds to the native <UsageCard> counterpart. The host owns the
// three shared `AiUsageStore` feeds (P1/S8) and threads their cache-then-network state down as three [UiState]s
// plus an `onRetry` (the store's refresh); this view performs NO HTTP. Because the lightweight web card owns no
// skeleton / error-screen / retry chrome of its own, this surface layers the honest cache-then-network states
// the P3 contract requires: a header freshness chip surfaces refreshing / stale / offline; a soft-stale value
// auto-refreshes (mirroring the web `refetchInterval`); an offline "last known" value is shown from cache rather
// than blanked; and a hard error with no cache shows a localized retryable error card. Every figure derivation
// flows through the pure [AiUsageStatusProjection]; this file resolves the i18n labels (P1/S10), the currency +
// locale + precision (P1/S8 settings store), and draws them. There is no hard-coded English literal here — every
// visible string resolves through the shared i18n facade [resolveI18nKey], reproducing i18next's key-as-fallback:
// a catalog-backed key localizes, otherwise the verbatim region text from the (anonymous) web source renders,
// identical to the web output. The Android string-resource name is `translation_` + the key with every
// non-resource character folded to `_`, matching the P1/S10 generator's `androidName` transform.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/AiUsageCard — the P3 prompt's allowed-files path, folded onto the sibling
// AIUsageCard directory by the case-insensitive Windows runner) cannot form a valid Kotlin package, so the
// package intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located stateless content, helpers and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.aiusagecardstatus

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
import io.teslasync.android.components.datadisplay.UsageCard
import io.teslasync.android.components.datadisplay.UsageDetail
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
import java.util.Locale

/** The settings document key the web `useFormatting` reads the preferred currency symbol from. */
private const val CURRENCY_SYMBOL_KEY = "currency_symbol"

private const val I18N_RESOURCE_PREFIX = "translation_"
private val NON_RESOURCE_CHARS = Regex("[^A-Za-z0-9_]")

// ── i18n keys (verbatim regions from the anonymous web source; resolved key-as-fallback via the P1/S10 facade) ──
private const val KEY_LOADING = "Loading Helix usage\u2026"
private const val KEY_EMPTY = "No Helix calls yet \u2014 turn on a feature to start."
private const val KEY_BAND_TODAY = "Today"
private const val KEY_BAND_TOKENS = "Tokens"
private const val KEY_BAND_COST_LATENCY = "Cost / latency"
private const val KEY_UNIT_CALLS = "calls"
private const val KEY_UNIT_TOTAL = "total"
private const val KEY_ERROR_ONE = "error"
private const val KEY_ERROR_OTHER = "errors"
private const val KEY_TOKENS_IN = "in"
private const val KEY_TOKENS_OUT = "out"
private const val KEY_MS_AVG = "ms avg"
private const val KEY_MS = "ms"
private const val KEY_DETAIL_AVG_LATENCY = "Avg latency"
private const val KEY_DETAIL_ERRORS = "Errors"
private const val KEY_DETAIL_INPUT_TOKENS = "Input tokens"
private const val KEY_DETAIL_OUTPUT_TOKENS = "Output tokens"
private const val KEY_TOP_FEATURES = "By feature (7 days)"
private const val KEY_RECENT = "Recent calls"
private const val KEY_TOK = "tok"
private const val KEY_SECONDS_AGO = "s ago"
private const val KEY_MINUTES_AGO = "m ago"
private const val KEY_HOURS_AGO = "h ago"
private const val KEY_DAYS_AGO = "d ago"

// Error-state copy — the web card has no error chrome; the P3 contract mandates a retryable error surface, so
// these native-added regions resolve through the same facade (catalog-backed if present, else this fallback).
private const val KEY_ERROR_TITLE = "Couldn\u2019t load AI usage"
private const val KEY_ERROR_MESSAGE = "Check your connection and try again."
private const val KEY_RETRY = "Retry"

/**
 * Stateful, off-mode-gated entry point — the faithful port of the web `AiUsageCard()` wrapper. Reads the live
 * settings document (P1/S8) to apply the ADR-015 §I4 gate (render nothing when settings have not loaded or
 * `ai_mode == 'off'`), resolves the display formatting, records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) on first composition, and renders every lifecycle state the host's three `AiUsageStore` feeds carry.
 * The host maps those feeds via [toAiUsageTodayUiState] / [toAiUsageByFeatureUiState] / [toAiUsageRecentUiState]
 * and supplies [onRetry] (its refresh); this view never performs HTTP.
 *
 * @param today the cache-then-network projection of `/ai/usage/today` (web `useAiUsageToday()` result).
 * @param byFeature the projection of `/ai/usage/by-feature` (web `useAiUsageByFeature()` result).
 * @param recent the projection of `/ai/usage/recent` (web `useAiUsageRecent(10)` result).
 * @param onRetry re-runs the host's load — wired to the soft-stale auto-refresh + the error retry.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun AiUsageCard(
    today: UiState<AiUsageToday>,
    byFeature: UiState<List<AiUsageFeatureRow>>,
    recent: UiState<List<AiUsageRecentRow>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val container = LocalDataContainer.current
    val settings by container.settingsStore.settings().collectAsStateWithLifecycle()
    val cached = settings.cached
    if (!aiUsageStatusEnabled(aiModeOf(cached))) return
    val formatting = remember(cached) { resolveFormatting(cached) }
    LaunchedEffect(Unit) { AiUsageStatusDiagnostics.recordViewOpened(logger) }
    AiUsageCardContent(
        today = today,
        byFeature = byFeature,
        recent = recent,
        onRetry = onRetry,
        modifier = modifier,
        formatting = formatting,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web card
 * (the <UsageCard> bands / details / top-lists) and adds the honest freshness chip + retryable error surface the
 * host's feeds imply. A soft-stale (non-error) `today` auto-refreshes, mirroring the web `refetchInterval`. The
 * `today` feed drives the primary surface (web `isLoading && !today` ⇒ loading; `!today || call_count === 0` ⇒
 * empty; otherwise populated); the secondary by-feature / recent feeds only contribute their top-lists when they
 * carry rows, exactly as the web omits a `topList` whose source array is empty.
 */
@Composable
fun AiUsageCardContent(
    today: UiState<AiUsageToday>,
    byFeature: UiState<List<AiUsageFeatureRow>>,
    recent: UiState<List<AiUsageRecentRow>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    formatting: AiUsageStatusFormatting = AiUsageStatusFormatting.DEFAULT,
) {
    LaunchedEffect(today.stale, today.refreshing, today.hasError) {
        if (today.stale && !today.refreshing && !today.hasError) onRetry()
    }
    val strings = rememberAiUsageStatusStrings()
    if (today.isError) {
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
        if (shouldShowFreshness(today)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                AiUsageStatusFreshnessChip(state = today)
            }
        }
        AiUsageStatusBody(today = today, byFeature = byFeature, recent = recent, formatting = formatting, strings = strings)
    }
}

/** True whenever the `today` feed is loading, refreshing over cache, stale, or offline — i.e. not settled-fresh. */
private fun shouldShowFreshness(state: UiState<*>): Boolean = state.isLoading || state.refreshing || state.stale || state.hasError

/**
 * The <UsageCard> body, driven by the primary `today` feed: the loading skeleton (web `Loading Helix usage…`),
 * the friendly empty state (web `No Helix calls yet — …`, never a blank box), or the populated bands / details /
 * top-lists. Offline "last known" and refreshing-over-cache both fall through to the populated branch (the chip
 * above carries the freshness), so working data is never blanked.
 */
@Composable
private fun AiUsageStatusBody(
    today: UiState<AiUsageToday>,
    byFeature: UiState<List<AiUsageFeatureRow>>,
    recent: UiState<List<AiUsageRecentRow>>,
    formatting: AiUsageStatusFormatting,
    strings: AiUsageStatusStrings,
) {
    val data = today.data
    when {
        today.isLoading && data == null -> UsageCard(emptyMessage = strings.loading)
        data == null || !data.hasUsage -> UsageCard(emptyMessage = strings.empty)
        else -> {
            val byFeatureRows = byFeature.data.orEmpty()
            val recentRows = recent.data.orEmpty()
            val now = remember(data, byFeatureRows, recentRows) { System.currentTimeMillis() }
            val display =
                remember(data, byFeatureRows, recentRows, formatting, now) {
                    AiUsageStatusProjection.project(data, byFeatureRows, recentRows, formatting, now)
                }
            UsageCard(
                bands = aiUsageBands(display, strings),
                details = aiUsageDetails(display, strings),
                topLists = aiUsageTopLists(display, strings),
            )
        }
    }
}

/** The three at-a-glance bands (web Today / Tokens / Cost·latency), with the error intent on the Today band. */
private fun aiUsageBands(
    display: AiUsageStatusDisplay,
    strings: AiUsageStatusStrings,
): List<UsageBand> {
    val errorWord = if (display.errorCountInt == 1) strings.errorOne else strings.errorOther
    return listOf(
        UsageBand(
            label = strings.bandToday,
            value = "${display.callCount} ${strings.unitCalls}",
            sub = "${display.errorCount} $errorWord",
            icon = DataDisplayGlyphs.Gauge,
            intent = toUsageIntent(display.callIntent),
        ),
        UsageBand(
            label = strings.bandTokens,
            value = "${display.tokensTotal} ${strings.unitTotal}",
            sub = "${display.tokensIn} ${strings.tokensIn}${AI_USAGE_STATUS_SEPARATOR}${display.tokensOut} ${strings.tokensOut}",
            icon = DataDisplayGlyphs.Robot,
        ),
        UsageBand(
            label = strings.bandCostLatency,
            value = display.cost,
            sub = "${display.avgLatency} ${strings.msAvg}",
            icon = DataDisplayGlyphs.Clock,
        ),
    )
}

/** The four-cell detail grid (web Avg latency / Errors / Input tokens / Output tokens). */
private fun aiUsageDetails(
    display: AiUsageStatusDisplay,
    strings: AiUsageStatusStrings,
): List<UsageDetail> =
    listOf(
        UsageDetail(label = strings.detailAvgLatency, value = "${display.avgLatency} ${strings.ms}"),
        UsageDetail(
            label = strings.detailErrors,
            value = display.errorCount,
            intent = if (display.errorCountInt > 0) UsageIntent.Danger else UsageIntent.Normal,
        ),
        UsageDetail(label = strings.detailInputTokens, value = display.tokensIn),
        UsageDetail(label = strings.detailOutputTokens, value = display.tokensOut),
    )

/** The two top-list breakdowns, each added only when its source carries rows (web `length > 0`). */
private fun aiUsageTopLists(
    display: AiUsageStatusDisplay,
    strings: AiUsageStatusStrings,
): List<UsageTopList> =
    buildList {
        if (display.topFeatures.isNotEmpty()) {
            add(
                UsageTopList(
                    key = "features",
                    title = strings.topFeatures,
                    icon = DataDisplayGlyphs.Bolt,
                    items = display.topFeatures.map { UsageTopListItem(key = it.featureId, label = it.featureId, value = it.callCount) },
                ),
            )
        }
        if (display.recentRows.isNotEmpty()) {
            add(
                UsageTopList(
                    key = "recent",
                    title = strings.recent,
                    icon = DataDisplayGlyphs.Clock,
                    items =
                        display.recentRows.mapIndexed { index, row ->
                            UsageTopListItem(
                                key = index.toString(),
                                label = summarizeRecentRow(row, strings),
                                value = if (row.isError) AI_USAGE_STATUS_ERROR_MARK else AI_USAGE_STATUS_OK_MARK,
                            )
                        },
                ),
            )
        }
    }

/** Web `summarizeRecentRow`: `{feature} · {model} · {n} tok · {relativeTime}`, joined by the " · " separator. */
private fun summarizeRecentRow(
    row: RecentRowDisplay,
    strings: AiUsageStatusStrings,
): String =
    listOf(
        row.featureId,
        row.model,
        "${row.tokens} ${strings.tok}",
        formatRelativeAge(row.age, row.rawTime, strings),
    ).joinToString(AI_USAGE_STATUS_SEPARATOR)

/** Formats a relative-age bucket into the web suffix (`Ns ago` / `Nm ago` / …), or the raw timestamp fallback. */
private fun formatRelativeAge(
    age: RelativeAge?,
    rawTime: String,
    strings: AiUsageStatusStrings,
): String =
    when (age) {
        null -> rawTime
        is RelativeAge.Seconds -> "${age.value}${strings.secondsAgo}"
        is RelativeAge.Minutes -> "${age.value}${strings.minutesAgo}"
        is RelativeAge.Hours -> "${age.value}${strings.hoursAgo}"
        is RelativeAge.Days -> "${age.value}${strings.daysAgo}"
    }

/** Maps the pure [AiUsageIntent] onto the shared [UsageIntent] the <UsageCard> accent uses. */
private fun toUsageIntent(intent: AiUsageIntent): UsageIntent =
    when (intent) {
        AiUsageIntent.Normal -> UsageIntent.Normal
        AiUsageIntent.Warn -> UsageIntent.Warn
        AiUsageIntent.Danger -> UsageIntent.Danger
    }

/** The header freshness chip — the honest "refreshing / stale / offline / loading" affordance over the card. */
@Composable
private fun AiUsageStatusFreshnessChip(state: UiState<*>) {
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
 * Resolves the [AiUsageStatusFormatting] from a settings document (P1/S8) — the native projection of the web
 * `useFormatting` result (currency symbol + precision) plus the `numberFormat` locale. The symbol falls back to
 * the web default ("$") when blank; the locale + precision come from the shared [UnitPreferences] derivation.
 */
private fun resolveFormatting(cached: JsonElement?): AiUsageStatusFormatting {
    val symbol = ((cached as? JsonObject)?.get(CURRENCY_SYMBOL_KEY) as? JsonPrimitive)?.contentOrNull
    val currencySymbol = if (!symbol.isNullOrBlank()) symbol else AI_USAGE_STATUS_DEFAULT_CURRENCY
    val prefs = UnitPreferences.fromSettings(cached)
    val localeTag = prefs.locale
    val locale = if (localeTag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(localeTag)
    val precision = prefs.precision ?: AI_USAGE_STATUS_DEFAULT_PRECISION
    return AiUsageStatusFormatting(currencySymbol = currencySymbol, precision = precision, locale = locale)
}

/** The surface's display strings, resolved once per locale from the i18n facade (P1/S10) at the render boundary. */
@Suppress("LongParameterList") // A resolved-strings DTO: one field per visible region of the web source.
private data class AiUsageStatusStrings(
    val loading: String,
    val empty: String,
    val bandToday: String,
    val bandTokens: String,
    val bandCostLatency: String,
    val unitCalls: String,
    val unitTotal: String,
    val errorOne: String,
    val errorOther: String,
    val tokensIn: String,
    val tokensOut: String,
    val msAvg: String,
    val ms: String,
    val detailAvgLatency: String,
    val detailErrors: String,
    val detailInputTokens: String,
    val detailOutputTokens: String,
    val topFeatures: String,
    val recent: String,
    val tok: String,
    val secondsAgo: String,
    val minutesAgo: String,
    val hoursAgo: String,
    val daysAgo: String,
    val errorTitle: String,
    val errorMessage: String,
    val retry: String,
)

/** Resolves every web region through [resolveI18nKey] once per locale, reproducing i18next's key-as-fallback. */
@Composable
private fun rememberAiUsageStatusStrings(): AiUsageStatusStrings {
    val context = LocalContext.current
    return remember(context) {
        AiUsageStatusStrings(
            loading = context.resolveI18nKey(KEY_LOADING),
            empty = context.resolveI18nKey(KEY_EMPTY),
            bandToday = context.resolveI18nKey(KEY_BAND_TODAY),
            bandTokens = context.resolveI18nKey(KEY_BAND_TOKENS),
            bandCostLatency = context.resolveI18nKey(KEY_BAND_COST_LATENCY),
            unitCalls = context.resolveI18nKey(KEY_UNIT_CALLS),
            unitTotal = context.resolveI18nKey(KEY_UNIT_TOTAL),
            errorOne = context.resolveI18nKey(KEY_ERROR_ONE),
            errorOther = context.resolveI18nKey(KEY_ERROR_OTHER),
            tokensIn = context.resolveI18nKey(KEY_TOKENS_IN),
            tokensOut = context.resolveI18nKey(KEY_TOKENS_OUT),
            msAvg = context.resolveI18nKey(KEY_MS_AVG),
            ms = context.resolveI18nKey(KEY_MS),
            detailAvgLatency = context.resolveI18nKey(KEY_DETAIL_AVG_LATENCY),
            detailErrors = context.resolveI18nKey(KEY_DETAIL_ERRORS),
            detailInputTokens = context.resolveI18nKey(KEY_DETAIL_INPUT_TOKENS),
            detailOutputTokens = context.resolveI18nKey(KEY_DETAIL_OUTPUT_TOKENS),
            topFeatures = context.resolveI18nKey(KEY_TOP_FEATURES),
            recent = context.resolveI18nKey(KEY_RECENT),
            tok = context.resolveI18nKey(KEY_TOK),
            secondsAgo = context.resolveI18nKey(KEY_SECONDS_AGO),
            minutesAgo = context.resolveI18nKey(KEY_MINUTES_AGO),
            hoursAgo = context.resolveI18nKey(KEY_HOURS_AGO),
            daysAgo = context.resolveI18nKey(KEY_DAYS_AGO),
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
                FreshnessAge.Unknown -> AI_USAGE_STATUS_EM_DASH
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

private val PREVIEW_TODAY =
    AiUsageToday(
        callCount = 312.0,
        inputTokens = 134_795.0,
        outputTokens = 48_512.0,
        costMicroCents = 12_500_000.0,
        errorCount = 4.0,
        avgLatencyMs = 287.0,
    )

private val PREVIEW_FEATURES =
    listOf(
        AiUsageFeatureRow(featureId = "chatbot", callCount = 180.0),
        AiUsageFeatureRow(featureId = "route_summary", callCount = 92.0),
        AiUsageFeatureRow(featureId = "anomaly_explain", callCount = 40.0),
    )

private val PREVIEW_RECENT =
    listOf(
        AiUsageRecentRow(
            id = 1,
            featureId = "chatbot",
            model = "gpt-4o-mini",
            inputTokens = 50.0,
            outputTokens = 80.0,
            startedAt = "2025-01-01T00:00:00Z",
            isError = false,
        ),
        AiUsageRecentRow(
            id = 2,
            featureId = "route_summary",
            model = "gpt-4o",
            inputTokens = 30.0,
            outputTokens = 60.0,
            startedAt = "2025-01-01T00:00:00Z",
            isError = true,
        ),
    )

@Preview(name = "Content — live usage", showBackground = true, widthDp = 420)
@Composable
private fun AiUsageStatusContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AiUsageCardContent(
            today = UiState(UiPhase.Content, data = PREVIEW_TODAY),
            byFeature = UiState(UiPhase.Content, data = PREVIEW_FEATURES),
            recent = UiState(UiPhase.Content, data = PREVIEW_RECENT),
            onRetry = {},
        )
    }
}

@Preview(name = "Empty — no usage yet", showBackground = true, widthDp = 420)
@Composable
private fun AiUsageStatusEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AiUsageCardContent(
            today = UiState(UiPhase.Empty, data = AiUsageToday.EMPTY),
            byFeature = UiState(UiPhase.Empty, data = emptyList()),
            recent = UiState(UiPhase.Empty, data = emptyList()),
            onRetry = {},
        )
    }
}

@Preview(name = "Loading — first fetch", showBackground = true, widthDp = 420)
@Composable
private fun AiUsageStatusLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AiUsageCardContent(
            today = UiState(UiPhase.Loading),
            byFeature = UiState(UiPhase.Loading),
            recent = UiState(UiPhase.Loading),
            onRetry = {},
        )
    }
}

@Preview(name = "Error — no cache", showBackground = true, widthDp = 420)
@Composable
private fun AiUsageStatusErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AiUsageCardContent(
            today = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            byFeature = UiState(UiPhase.Loading),
            recent = UiState(UiPhase.Loading),
            onRetry = {},
        )
    }
}

@Preview(name = "Offline — cached last known", showBackground = true, widthDp = 420)
@Composable
private fun AiUsageStatusOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AiUsageCardContent(
            today =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_TODAY,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            byFeature = UiState(UiPhase.Content, data = PREVIEW_FEATURES),
            recent = UiState(UiPhase.Content, data = PREVIEW_RECENT),
            onRetry = {},
        )
    }
}
