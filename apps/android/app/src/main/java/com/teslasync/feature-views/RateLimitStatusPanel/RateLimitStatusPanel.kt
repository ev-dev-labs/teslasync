// The native Jetpack Compose + Material 3 RateLimitStatusPanel feature view — a parity port of
// web/src/features/admin/components/RateLimitStatusPanel.tsx. The web component binds the
// `useRateLimitStatus` feed (web `useSystem` hook domain) and renders one `MetricBar` per `ScopeBudget`
// the backend reports, with a header (title / subtitle / "Updated {when}" / Refresh) above a
// loading / error / empty / rows body.
//
// This surface keeps that contract end to end. The primary entry binds the shared P1/S8 [SystemStore]
// (the cross-platform port of `useRateLimitStatus`), projects its cache-then-network `Resource` onto the
// shared [UiState], drives the web `refetchInterval` (30 s, paused while the screen is not STARTED — the
// `refetchIntervalInBackground:false` analogue), and renders every lifecycle state the layer can carry —
// loading, hard error with retry, empty, content, and stale/offline ("last known" + chip). It performs
// NO HTTP itself. A `UiState`-prop overload (the web `testHookOverride`) and a stateless content renderer
// give hosts / tests / previews a fetch-free entry. Every display string resolves through the P1/S10
// catalog; the compact duration tokens (ms/s/m) are reproduced verbatim from the web lib like the sibling
// surfaces.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/RateLimitStatusPanel — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.ratelimitstatuspanel

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.MetricBar
import io.teslasync.android.components.datadisplay.computeAgeSeconds
import io.teslasync.android.components.datadisplay.relativeAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.system.RateLimitStatusResponse
import io.teslasync.shared.core.presentation.system.ScopeBudget
import io.teslasync.shared.core.presentation.system.SystemStore
import kotlinx.coroutines.delay
import java.time.Instant
import java.util.Locale

/** The web `useRateLimitStatus` `refetchInterval` (30 s). Drives the live-poll re-fetch cadence. */
private const val RATE_LIMIT_REFRESH_INTERVAL_MS: Long = 30_000L

/** Vertical gap between the header block and the body (web header `mb-4` = 16 dp). */
private val HEADER_BODY_GAP = Spacing.lg

/**
 * The already-localized panel-chrome strings the surface renders. The web component resolves every label
 * through `useTranslation`; these arrive through the P1/S10 i18n facade at the Compose boundary so the
 * rest of the surface carries no English literal. [lastUpdatedPattern] keeps the raw `Updated %1$s`
 * template, formatted with the relative "when" at render.
 */
data class RateLimitStatusPanelStrings(
    val title: String,
    val subtitle: String,
    val refresh: String,
    val loading: String,
    val empty: String,
    val lastUpdatedPattern: String,
)

/**
 * The already-localized per-row strings. [usagePattern] (`%1$s / %2$s`), [windowSecondsPattern]
 * (`Last %1$ss window`) and [resetInPattern] (`Refills in %1$s`) are raw templates formatted per row;
 * the three severity labels back the `ok`/`warn`/`critical` bands (an unknown band labels itself with
 * the raw wire string, mirroring the web `t(key, severity)` fallback).
 */
data class RateLimitRowStrings(
    val windowInstant: String,
    val windowSecondsPattern: String,
    val usagePattern: String,
    val resetInPattern: String,
    val severityOk: String,
    val severityWarn: String,
    val severityCritical: String,
)

/**
 * Primary entry — the faithful native binding of the web `useRateLimitStatus` hook. Records the one-shot
 * PII-safe `view.opened` diagnostic (P1/S11), collects the shared [SystemStore] feed lifecycle-aware,
 * projects it onto the shared [UiState], and re-fetches every [RATE_LIMIT_REFRESH_INTERVAL_MS] while the
 * screen is STARTED (the web `refetchInterval` + `refetchIntervalInBackground:false`). It performs no HTTP
 * — the store and its repository do (ADR-002).
 *
 * @param systemStore the shared P1/S8 holder porting the `useSystem`/`useRateLimitStatus` domain.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun RateLimitStatusPanel(
    systemStore: SystemStore,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordRateLimitStatusPanelOpened(logger) }

    val feed = remember(systemStore) { systemStore.rateLimitStatus() }
    val resource by feed.collectAsStateWithLifecycle()
    val state = remember(resource) { resource.toUiState { RateLimitStatusPanelProjection.isEmpty(it) } }

    val lifecycleOwner = LocalLifecycleOwner.current
    LaunchedEffect(systemStore, lifecycleOwner) {
        lifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                delay(RATE_LIMIT_REFRESH_INTERVAL_MS)
                systemStore.refreshRateLimitStatus()
            }
        }
    }

    RateLimitStatusPanelContent(
        state = state,
        onRefresh = systemStore::refreshRateLimitStatus,
        modifier = modifier,
    )
}

/**
 * Override entry — the web `testHookOverride` analogue, for hosts that already hold the feed as a
 * [UiState]. Records `view.opened` like the live entry and renders the same content; the host owns the
 * `onRefresh` (its feed's `refetch`). No fetch lives behind this overload.
 */
@Composable
fun RateLimitStatusPanel(
    state: UiState<RateLimitStatusResponse>,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordRateLimitStatusPanelOpened(logger) }
    RateLimitStatusPanelContent(state = state, onRefresh = onRefresh, modifier = modifier)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Always draws the
 * header (title / subtitle / "Updated {when}" / Refresh) then switches the body: a spinner while a first
 * load is in flight, a retry surface on a hard error (web `QueryError` equivalent), the italic empty
 * message when the backend reports no scopes, otherwise one [MetricBar] per scope. Stale (non-error) data
 * auto-refreshes via [onRefresh]; stale/refreshing/offline data also shows a freshness chip so the cached
 * "last known" value is never presented as live. [nowMillis] feeds the relative "updated" label and each
 * row's reset countdown (injectable for deterministic tests/previews).
 */
@Composable
fun RateLimitStatusPanelContent(
    state: UiState<RateLimitStatusResponse>,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    nowMillis: Long = System.currentTimeMillis(),
    panelStrings: RateLimitStatusPanelStrings = rememberRateLimitStatusPanelStrings(),
    rowStrings: RateLimitRowStrings = rememberRateLimitRowStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val formatAge = rememberRateLimitFreshnessFormatter()

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        RateLimitHeader(
            state = state,
            strings = panelStrings,
            onRefresh = onRefresh,
            nowMillis = nowMillis,
            formatAge = formatAge,
        )
        Spacer(Modifier.height(HEADER_BODY_GAP))
        when {
            state.isLoading -> RateLimitLoading(strings = panelStrings)
            state.isError -> RateLimitError(onRefresh = onRefresh)
            state.isEmpty -> RateLimitEmpty(strings = panelStrings)
            else ->
                RateLimitRows(
                    state = state,
                    rowStrings = rowStrings,
                    locale = locale,
                    nowMillis = nowMillis,
                    formatAge = formatAge,
                )
        }
    }
}

@Composable
private fun RateLimitHeader(
    state: UiState<RateLimitStatusResponse>,
    strings: RateLimitStatusPanelStrings,
    onRefresh: () -> Unit,
    nowMillis: Long,
    formatAge: (FreshnessAge) -> String,
) {
    val updatedAt =
        remember(state.data) {
            state.data?.generatedAt?.let(RateLimitStatusPanelProjection::updatedAtMillis)
        }
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PanelTitle(strings.title)
            BodyText(strings.subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (updatedAt != null) {
                val whenLabel = formatAge(relativeAge(computeAgeSeconds(updatedAt, nowMillis)))
                Caption(strings.lastUpdatedPattern.format(whenLabel))
            }
        }
        Button(
            label = strings.refresh,
            onClick = onRefresh,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            enabled = !state.isLoading,
            loading = state.refreshing,
            leadingIcon = FeedbackGlyphs.Refresh,
        )
    }
}

@Composable
private fun RateLimitLoading(strings: RateLimitStatusPanelStrings) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.lg),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Spinner(size = SpinnerSize.Sm, accessibleLabel = strings.loading)
        BodyText(strings.loading, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun RateLimitError(onRefresh: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        icon = TeslaGlyphs.Warning,
        onRetry = onRefresh,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Empty surface — web parity: the italic "no rate-limited resources observed" message, never a blank box. */
@Composable
private fun RateLimitEmpty(strings: RateLimitStatusPanelStrings) {
    EmptyState(
        message = strings.empty,
        icon = FeedbackGlyphs.Clock,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun RateLimitRows(
    state: UiState<RateLimitStatusResponse>,
    rowStrings: RateLimitRowStrings,
    locale: Locale,
    nowMillis: Long,
    formatAge: (FreshnessAge) -> String,
) {
    val rows = remember(state.data) { RateLimitStatusPanelProjection.rows(state.data) }
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        val offlineWithData = state.hasError && state.hasData
        val showFreshness = state.stale || state.refreshing || offlineWithData
        if (showFreshness) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                DataFreshness(
                    updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                    isFetching = state.refreshing,
                    isStale = state.stale,
                    isError = state.hasError,
                    fetchingLabel = stringResource(R.string.translation_common_loading),
                    errorLabel = stringResource(R.string.translation_common_offline),
                    formatAge = formatAge,
                )
            }
        }
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xl)) {
            rows.forEach { row ->
                RateLimitRow(row = row, strings = rowStrings, locale = locale, nowMillis = nowMillis)
            }
        }
    }
}

/**
 * One scope row — the native port of the web `RateLimitRow`. The scope name + severity label sit above an
 * animated [MetricBar] (window label left, `current / limit` usage right, both tinted by the severity
 * band); the detail footnote + "Refills in …" countdown render beneath when present.
 */
@Composable
private fun RateLimitRow(
    row: RateLimitRowView,
    strings: RateLimitRowStrings,
    locale: Locale,
    nowMillis: Long,
) {
    val color = severityColor(row.severity)
    val windowLabel =
        if (RateLimitStatusPanelProjection.isInstantWindow(row.windowSeconds)) {
            strings.windowInstant
        } else {
            strings.windowSecondsPattern.format(row.windowSeconds)
        }
    val usageLabel =
        strings.usagePattern.format(
            RateLimitStatusPanelProjection.formatBudget(row.current, locale),
            RateLimitStatusPanelProjection.formatBudget(row.limit, locale),
        )
    val resetLabel =
        RateLimitStatusPanelProjection.resetCountdownMs(row.resetAt, nowMillis)?.let { ms ->
            strings.resetInPattern.format(RateLimitStatusPanelProjection.formatResetDuration(ms))
        }

    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = row.name,
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = severityLabel(row, strings),
                style = MaterialTheme.typography.labelMedium,
                color = color,
            )
        }
        MetricBar(value = row.current, max = row.barMax, label = windowLabel, valueText = usageLabel, color = color)
        if (row.detail.isNotEmpty() || resetLabel != null) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = Spacing.xs),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (row.detail.isNotEmpty()) {
                    Caption(row.detail, modifier = Modifier.weight(1f))
                } else {
                    Spacer(Modifier.weight(1f))
                }
                if (resetLabel != null) {
                    Caption(resetLabel)
                }
            }
        }
    }
}

/** Severity → semantic status colour — the native mirror of the web `SEVERITY_COLOR`/`SEVERITY_TONE_CLASS`. */
@Composable
private fun severityColor(severity: RateLimitSeverity): Color =
    when (severity) {
        RateLimitSeverity.Ok -> TeslaTokens.status.success
        RateLimitSeverity.Warn -> TeslaTokens.status.warning
        RateLimitSeverity.Critical -> TeslaTokens.status.danger
        RateLimitSeverity.Unknown -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/** The localized severity label, falling back to the raw wire value for an unknown band (web `t(key, severity)`). */
private fun severityLabel(
    row: RateLimitRowView,
    strings: RateLimitRowStrings,
): String =
    when (row.severity) {
        RateLimitSeverity.Ok -> strings.severityOk
        RateLimitSeverity.Warn -> strings.severityWarn
        RateLimitSeverity.Critical -> strings.severityCritical
        RateLimitSeverity.Unknown -> row.severityWire
    }

/** Resolves the panel-chrome strings from the P1/S10 catalog (the web `rateLimitStatus.*` keys). */
@Composable
fun rememberRateLimitStatusPanelStrings(): RateLimitStatusPanelStrings {
    val title = stringResource(R.string.translation_rateLimitStatus_title)
    val subtitle = stringResource(R.string.translation_rateLimitStatus_subtitle)
    val refresh = stringResource(R.string.translation_rateLimitStatus_refresh)
    val loading = stringResource(R.string.translation_rateLimitStatus_loading)
    val empty = stringResource(R.string.translation_rateLimitStatus_empty)
    val lastUpdated = stringResource(R.string.translation_rateLimitStatus_lastUpdated)
    return remember(title, subtitle, refresh, loading, empty, lastUpdated) {
        RateLimitStatusPanelStrings(
            title = title,
            subtitle = subtitle,
            refresh = refresh,
            loading = loading,
            empty = empty,
            lastUpdatedPattern = lastUpdated,
        )
    }
}

/** Resolves the per-row strings from the P1/S10 catalog (the web `rateLimitStatus.*` keys). */
@Composable
fun rememberRateLimitRowStrings(): RateLimitRowStrings {
    val windowInstant = stringResource(R.string.translation_rateLimitStatus_windowInstant)
    val windowSeconds = stringResource(R.string.translation_rateLimitStatus_windowSeconds)
    val usage = stringResource(R.string.translation_rateLimitStatus_usage)
    val resetIn = stringResource(R.string.translation_rateLimitStatus_resetIn)
    val severityOk = stringResource(R.string.translation_rateLimitStatus_severity_ok)
    val severityWarn = stringResource(R.string.translation_rateLimitStatus_severity_warn)
    val severityCritical = stringResource(R.string.translation_rateLimitStatus_severity_critical)
    return remember(windowInstant, windowSeconds, usage, resetIn, severityOk, severityWarn, severityCritical) {
        RateLimitRowStrings(
            windowInstant = windowInstant,
            windowSecondsPattern = windowSeconds,
            usagePattern = usage,
            resetInPattern = resetIn,
            severityOk = severityOk,
            severityWarn = severityWarn,
            severityCritical = severityCritical,
        )
    }
}

/**
 * Localized relative-age formatter for the "Updated {when}" label + freshness chip
 * (`translation_freshness_*`) — the render-only concern the sibling surfaces resolve the same way, kept
 * out of the pure projection.
 */
@Composable
private fun rememberRateLimitFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
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

private val PREVIEW_NOW: Long = Instant.parse("2026-06-11T12:00:00Z").toEpochMilli()

private val PREVIEW_STRINGS =
    RateLimitStatusPanelStrings(
        title = "Rate-limit budgets",
        subtitle = "Live view of every server-side throttle. Bars climb as the window fills.",
        refresh = "Refresh",
        loading = "Loading rate-limit status\u2026",
        empty = "No rate-limited resources are currently observed.",
        lastUpdatedPattern = "Updated %1\$s",
    )

private val PREVIEW_ROW_STRINGS =
    RateLimitRowStrings(
        windowInstant = "Live snapshot",
        windowSecondsPattern = "Last %1\$ss window",
        usagePattern = "%1\$s / %2\$s",
        resetInPattern = "Refills in %1\$s",
        severityOk = "Healthy",
        severityWarn = "Warning",
        severityCritical = "Critical",
    )

private val PREVIEW_RESPONSE =
    RateLimitStatusResponse(
        generatedAt = "2026-06-11T12:00:00Z",
        scopes =
            listOf(
                ScopeBudget(
                    id = "tesla_fleet",
                    name = "Tesla Fleet API",
                    current = 820.0,
                    limit = 1000.0,
                    windowSeconds = 3600,
                    resetAt = null,
                    severity = "warn",
                    detail = "Shared across every vehicle in this install.",
                ),
                ScopeBudget(
                    id = "command",
                    name = "Vehicle commands",
                    current = 12.0,
                    limit = 200.0,
                    windowSeconds = 0,
                    resetAt = "2026-06-11T12:05:00Z",
                    severity = "ok",
                    detail = "",
                ),
                ScopeBudget(
                    id = "telemetry",
                    name = "Telemetry ingest",
                    current = 49_500.0,
                    limit = 50_000.0,
                    windowSeconds = 60,
                    resetAt = null,
                    severity = "critical",
                    detail = "Approaching the per-minute cap.",
                ),
            ),
    )

@Composable
private fun previewContent(state: UiState<RateLimitStatusResponse>) {
    TeslaSyncTheme(dynamicColor = false) {
        RateLimitStatusPanelContent(
            state = state,
            onRefresh = {},
            locale = Locale.US,
            nowMillis = PREVIEW_NOW,
            panelStrings = PREVIEW_STRINGS,
            rowStrings = PREVIEW_ROW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun RateLimitContentPreview() {
    previewContent(UiState(phase = UiPhase.Content, data = PREVIEW_RESPONSE, fetchedAt = PREVIEW_NOW))
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun RateLimitLoadingPreview() {
    previewContent(UiState.loading())
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun RateLimitErrorPreview() {
    previewContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network))
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun RateLimitEmptyPreview() {
    previewContent(UiState(phase = UiPhase.Empty, data = RateLimitStatusResponse(), fetchedAt = PREVIEW_NOW))
}

@Preview(name = "Offline (cached + chip)", showBackground = true)
@Composable
private fun RateLimitOfflinePreview() {
    previewContent(
        UiState(
            phase = UiPhase.Content,
            data = PREVIEW_RESPONSE,
            fetchedAt = PREVIEW_NOW,
            stale = true,
            errorKind = ErrorKind.Network,
        ),
    )
}
