// The native Jetpack Compose + Material 3 AIUsageCard feature view — a parity port of the lightweight
// "Usage today" card on the Helix settings panel (web/src/features/settings/components/AIUsageCard.tsx). The
// web component reads `/ai/usage/today` via `useAiUsageToday()` and renders three top-line figures — tokens
// in, tokens out, and the estimated cost in the user's locale currency — over a live/empty caption,
// deliberately degrading every missing value to the long em-dash fallback so the visual layout stays stable
// while data arrives (its only other hooks are `useTranslation` + `useFormatting`).
//
// This port keeps that contract end to end. The card always renders the title, the three-cell figure grid,
// and the caption — never a blank box, exactly the web's layout-stable design (the same em-dash degradation
// the web tests lock in). Because the lightweight web card owns no skeleton / error-screen / retry chrome of
// its own, this surface layers the honest cache-then-network states the P3 contract requires *without*
// disturbing that always-present layout: a header freshness chip surfaces refreshing / stale / offline, a
// soft-stale value auto-refreshes (mirroring the web `refetchInterval`), and an offline "last known" value is
// shown from cache rather than blanked. First-load (no cache) and a hard error (no cache) show the em-dash
// fallback verbatim with the web's `aria-busy` loading state mapped to a TalkBack state description. The host
// owns the shared `AiUsageStore.today()` feed (P1/S8) and wires `onRetry` to its refresh; this view performs
// NO HTTP. Every figure derivation flows through the pure [AiUsageProjection]; this file is a thin render
// layer that resolves the i18n labels (P1/S10), the currency symbol + locale + precision (P1/S8 settings
// store), and draws them. There is no English literal here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AIUsageCard) cannot form a valid Kotlin package, so the package intentionally
// diverges from the path — exactly as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.aiusagecard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.util.Locale

/** The settings document key the web `useFormatting` reads the preferred currency symbol from. */
private const val CURRENCY_SYMBOL_KEY = "currency_symbol"

/**
 * Stateful entry point — the faithful port of the web `AIUsageCard()` (which owns `useAiUsageToday()`).
 * Records the one-shot PII-safe `view.opened` diagnostic (P1/S11) on first composition, resolves the display
 * formatting from the shared settings store (P1/S8), and renders every lifecycle [state] the host's shared
 * `AiUsageStore.today()` feed can carry. The host maps that feed via [toAiUsageTodayUiState] and supplies
 * [onRetry] (its `refreshToday`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of `/ai/usage/today` (web `useAiUsageToday()` result).
 * @param onRetry re-runs the host's load — wired to the soft-stale auto-refresh.
 * @param formatting the currency symbol + locale + precision, resolved from the shared settings store.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun AIUsageCard(
    state: UiState<AiUsageToday>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    formatting: AiUsageFormatting = rememberAiUsageFormatting(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { AiUsageCardDiagnostics.recordViewOpened(logger) }
    AIUsageCardContent(state = state, onRetry = onRetry, modifier = modifier, formatting = formatting)
}

/**
 * Web-parity overload for a host that already holds the value (no feed). A `null` payload renders the
 * em-dash / loading surface (web `!data`); a present payload renders the figures, selecting the empty phase
 * when there has been no usage today so the empty caption shows. Records `view.opened` like the stateful
 * entry; with no fetch behind it there is no retry.
 */
@Composable
fun AIUsageCard(
    data: AiUsageToday?,
    modifier: Modifier = Modifier,
    formatting: AiUsageFormatting = rememberAiUsageFormatting(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(data) {
            when {
                data == null -> UiState(UiPhase.Loading)
                data.isEmpty -> UiState(UiPhase.Empty, data = data)
                else -> UiState(UiPhase.Content, data = data)
            }
        }
    AIUsageCard(state = state, onRetry = {}, modifier = modifier, formatting = formatting, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web
 * card (title, three-cell figure grid, live/empty caption) and adds the honest freshness chip the host's feed
 * implies. A soft-stale (non-error) value auto-refreshes, mirroring the web `refetchInterval`. The figures
 * show the cached/fresh values whenever a payload is present (including offline "last known"), and the em-dash
 * fallback only when there is nothing to show yet (first load) or a hard error left no cache — exactly the web
 * `!data || isError ? '—' : …` rule.
 */
@Composable
fun AIUsageCardContent(
    state: UiState<AiUsageToday>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    formatting: AiUsageFormatting = AiUsageFormatting.DEFAULT,
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val display = remember(state.data, formatting) { state.data?.let { AiUsageProjection.project(it, formatting) } }
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            AiUsageHeader(state = state)
            AiUsageGrid(display = display, isLoading = state.isLoading)
            AiUsageCaption(display = display)
        }
    }
}

/**
 * The card header — the web `<Subhead>Usage today</Subhead>` title (marked as a heading for TalkBack) with the
 * honest freshness chip (refreshing / stale / offline / loading) rendered at the trailing edge when the feed
 * is not in a settled fresh state.
 */
@Composable
private fun AiUsageHeader(state: UiState<*>) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Subhead(
            text = stringResource(R.string.translation_ai_settings_usage_title),
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        if (shouldShowFreshness(state)) {
            AiUsageFreshnessChip(state = state)
        }
    }
}

/** True whenever the feed is loading, refreshing over cache, stale, or offline — i.e. not settled-fresh. */
private fun shouldShowFreshness(state: UiState<*>): Boolean = state.isLoading || state.refreshing || state.stale || state.hasError

/**
 * The three-cell figure grid — the web `grid grid-cols-3 gap-3` of tokens-in / tokens-out / estimated-cost
 * cells, each filling a third of the row. A `null` [display] (no payload yet / hard error with no cache)
 * renders the em-dash fallback, matching the web `!data || isError` degradation.
 */
@Composable
private fun AiUsageGrid(
    display: AiUsageDisplay?,
    isLoading: Boolean,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        UsageCell(
            label = stringResource(R.string.translation_ai_settings_usage_tokensIn),
            value = display?.tokensIn ?: AI_USAGE_EM_DASH,
            isLoading = isLoading,
            modifier = Modifier.weight(1f),
        )
        UsageCell(
            label = stringResource(R.string.translation_ai_settings_usage_tokensOut),
            value = display?.tokensOut ?: AI_USAGE_EM_DASH,
            isLoading = isLoading,
            modifier = Modifier.weight(1f),
        )
        UsageCell(
            label = stringResource(R.string.translation_ai_settings_usage_cost),
            value = display?.cost ?: AI_USAGE_EM_DASH,
            isLoading = isLoading,
            modifier = Modifier.weight(1f),
        )
    }
}

/**
 * One figure cell — a muted label above the primary-text value, the native mirror of the web
 * `<div class="flex flex-col"><span class="text-muted">{label}</span><span class="text-primary">{value}</span>`.
 * While the first load is in flight the value carries a TalkBack state description (the web `aria-busy`), so an
 * assistive-tech user hears that the figure is loading rather than just the em-dash.
 */
@Composable
private fun UsageCell(
    label: String,
    value: String,
    isLoading: Boolean,
    modifier: Modifier = Modifier,
) {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        MetricLabel(label)
        BodyText(
            text = value,
            modifier = if (isLoading) Modifier.semantics { stateDescription = loadingLabel } else Modifier,
            maxLines = 1,
        )
    }
}

/**
 * The footer caption — the web `data.call_count > 0 ? '{n} {liveSuffix}' : '{empty caption}'`. The live branch
 * appends the localized "Helix calls today." suffix to the formatted call count; otherwise the localized empty
 * caption explains that usage populates as features run — a friendly, never-blank message.
 */
@Composable
private fun AiUsageCaption(display: AiUsageDisplay?) {
    val liveSuffix = stringResource(R.string.translation_ai_settings_usage_liveSuffix)
    val emptyCaption = stringResource(R.string.translation_ai_settings_usage_placeholder) // parity:allow shared i18n catalog key
    val text =
        if (display != null && display.hasUsage) {
            "${display.callCountText} $liveSuffix"
        } else {
            emptyCaption
        }
    Caption(text)
}

/** The header freshness chip — the honest "refreshing / stale / offline" affordance over the figures. */
@Composable
private fun AiUsageFreshnessChip(state: UiState<*>) {
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
                FreshnessAge.Unknown -> AI_USAGE_EM_DASH
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

/**
 * Resolves the [AiUsageFormatting] from the shared settings store (P1/S8) — the native projection of the web
 * `useFormatting` result (currency symbol + precision) plus the `numberFormat` locale. Remembered against the
 * settings document so a currency / precision / locale change re-projects. The symbol falls back to the web
 * default ("$") when blank; the locale + precision come from the shared [UnitPreferences] derivation.
 */
@Composable
private fun rememberAiUsageFormatting(): AiUsageFormatting {
    val container = LocalDataContainer.current
    val settings by container.settingsStore.settings().collectAsStateWithLifecycle()
    return remember(settings) {
        val cached = settings.cached
        val symbol = ((cached as? JsonObject)?.get(CURRENCY_SYMBOL_KEY) as? JsonPrimitive)?.contentOrNull
        val currencySymbol = if (!symbol.isNullOrBlank()) symbol else AI_USAGE_DEFAULT_CURRENCY
        val prefs = UnitPreferences.fromSettings(cached)
        val localeTag = prefs.locale
        val locale = if (localeTag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(localeTag)
        val precision = prefs.precision ?: AI_USAGE_DEFAULT_PRECISION
        AiUsageFormatting(currencySymbol = currencySymbol, precision = precision, locale = locale)
    }
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_DATA =
    AiUsageToday(callCount = 80.0, inputTokens = 134_795.0, outputTokens = 8_512.0, costMicroCents = 12_500_000.0)

@Preview(name = "Content — live usage", showBackground = true, widthDp = 420)
@Composable
private fun AiUsageContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIUsageCardContent(state = UiState(UiPhase.Content, data = PREVIEW_DATA), onRetry = {})
    }
}

@Preview(name = "Empty — no usage yet", showBackground = true, widthDp = 420)
@Composable
private fun AiUsageEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIUsageCardContent(state = UiState(UiPhase.Empty, data = AiUsageToday.EMPTY), onRetry = {})
    }
}

@Preview(name = "Loading — first fetch", showBackground = true, widthDp = 420)
@Composable
private fun AiUsageLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIUsageCardContent(state = UiState(UiPhase.Loading), onRetry = {})
    }
}

@Preview(name = "Error — no cache", showBackground = true, widthDp = 420)
@Composable
private fun AiUsageErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIUsageCardContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = {})
    }
}

@Preview(name = "Offline — cached last known", showBackground = true, widthDp = 420)
@Composable
private fun AiUsageOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIUsageCardContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_DATA,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
        )
    }
}
