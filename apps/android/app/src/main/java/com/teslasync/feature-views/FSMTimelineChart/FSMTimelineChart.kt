// The native Jetpack Compose + Material 3 FSM "Transitions Over Time" timeline chart feature view — a parity
// port of web/src/features/system/components/FSMTimelineChart.tsx. The web component is purely
// presentational: it wraps the shared `<ChartContainer>` (title + aria description + loading/empty states)
// around a Recharts stacked `<AreaChart>` with one gradient `<Area>` per FSM name, bucketing the supplied
// `transitions` over the selected `hours` window (its only web hook is `useTranslation`).
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own. The host
// supplies the transitions through the shared P1/S8 state-holder layer as a [UiState], so this feature view
// renders every lifecycle state that layer can carry — loading, hard error with retry, empty, content, and
// stale/offline (cached "last known") — without ever fetching. A web-parity overload that takes the raw
// `transitions` list (web `transitions` prop) is also provided. All time bucketing lives in the pure
// [FSMTimelineChartProjection]; this file only resolves localized chrome, palette colors, and freshness.
//
// Stacking + identification: the shared Vico chart layer renders each area independently (overlaid,
// gradient-filled) rather than vertically stacked — feature views must not import Vico directly nor alter
// the shared chart layer (allowed-files), and the shared `AreaChartWrapper` is the sanctioned area preset.
// Series colors resolve to the generated chart palette by position via [paletteColor] — the exact analogue
// of the web `CHART_COLORS[i % CHART_COLORS.length]`. Because the FSM series are data-driven and a touch
// surface has no hover, a [ChartLegend] maps each FSM name to its color (the touch-equivalent of the web
// hover tooltip's series identification); the web's `chart-a11y:no-table` intent is honored, so no fallback
// data table is rendered (the per-row detail lives in the sibling transition-log surface).
//
// Accessibility: the web passes a dedicated `aria` string to its container, but that string is an inline
// i18next default with no catalog key on either platform; rather than hardcode an English literal, the
// localized title is used as the container's accessible description, and the legend swatch labels carry the
// per-series TalkBack descriptions.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/FSMTimelineChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.fsmtimelinechart

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartLegend
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.LegendEntry
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.ZoneId
import java.util.Locale

/** The web `<ChartContainer height={260}>` plot height. */
private val CHART_HEIGHT: Dp = 260.dp

/** Y-axis fraction digits — the web `<YAxis allowDecimals={false} />` integer count ticks. */
private const val INTEGER_DECIMALS: Int = 0

/** Em dash shown for an unknown freshness age — the shared freshness `'—'` fallback. */
private const val EM_DASH: String = "\u2014"

/**
 * Stateful entry point for the FSM timeline chart. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the shared FSM-transitions feed can carry. The host owns the
 * feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the `FSMTransition[]` (web `transitions`).
 * @param hours the selected time window in hours (web `hours`); drives the bucket width.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param emptyMessage optional override for the empty-state message (web `emptyMessage` prop).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun FSMTimelineChart(
    state: UiState<List<FSMTransitionPoint>>,
    hours: Int,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    emptyMessage: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordFSMTimelineChartOpened(logger) }
    FSMTimelineChartContent(
        state = state,
        hours = hours,
        onRetry = onRetry,
        modifier = modifier,
        emptyMessage = emptyMessage,
    )
}

/**
 * Web-parity overload mirroring the web component's `transitions: FSMTransition[]` prop, for hosts that
 * already hold the loaded list. An empty/`null` list renders the empty state (web `buckets = []`), a
 * non-empty list renders the stacked-area series. Records `view.opened` like the stateful entry. There is no
 * fetch behind it, so it offers no retry affordance.
 */
@Composable
fun FSMTimelineChart(
    transitions: List<FSMTransitionPoint>?,
    hours: Int,
    modifier: Modifier = Modifier,
    emptyMessage: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(transitions) {
            val items = transitions ?: emptyList()
            val phase = if (items.isEmpty()) UiPhase.Empty else UiPhase.Content
            UiState(phase = phase, data = items)
        }
    FSMTimelineChart(
        state = state,
        hours = hours,
        onRetry = {},
        modifier = modifier,
        emptyMessage = emptyMessage,
        logger = logger,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Maps the host feed's [UiState]
 * onto the [ChartContainer] lifecycle (loading / error+retry / empty / ready) and renders the overlaid
 * [AreaChartWrapper] series plus a [ChartLegend] in the ready state, reproducing the web `ChartContainer` +
 * stacked `AreaChart` composition: a localized title, the title as accessible description, a friendly empty
 * state (or the [emptyMessage] override), and a freshness chip when the cached data is refreshing / stale /
 * offline. Stale (non-error) data auto-refreshes, mirroring the web freshness contract. [nowMillis] / [zone]
 * are injected for deterministic bucketing/labels and [locale] formats the integer count axis.
 */
@Composable
fun FSMTimelineChartContent(
    state: UiState<List<FSMTransitionPoint>>,
    hours: Int,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    emptyMessage: String? = null,
    locale: Locale = Locale.getDefault(),
    zone: ZoneId = ZoneId.systemDefault(),
    nowMillis: Long = System.currentTimeMillis(),
    strings: FSMTimelineChartStrings = rememberFSMTimelineChartStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val result =
        remember(state.data, hours, zone, nowMillis) {
            FSMTimelineChartProjection.project(
                transitions = state.data ?: emptyList(),
                hours = hours,
                nowMillis = nowMillis,
                zone = zone,
            )
        }

    val status =
        when {
            state.isLoading -> ChartStatus.Loading
            state.isError -> ChartStatus.Error
            result.isEmpty -> ChartStatus.Empty
            else -> ChartStatus.Ready
        }

    val series =
        remember(result.series) {
            result.series.mapIndexed { index, entry ->
                ChartSeries(
                    key = entry.name,
                    label = entry.name,
                    values = entry.values,
                    kind = ChartSeriesKind.Area,
                    color = paletteColor(index),
                )
            }
        }

    val legend =
        remember(result.fsmTypes) {
            result.fsmTypes.mapIndexed { index, type ->
                LegendEntry(key = type, label = type, color = paletteColor(index))
            }
        }

    val resolvedEmpty = emptyMessage ?: strings.noDataMessage
    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)

    ChartContainer(
        title = strings.title,
        modifier = modifier,
        status = status,
        height = CHART_HEIGHT,
        action =
            if (showFreshness) {
                { FSMTimelineFreshnessChip(state) }
            } else {
                null
            },
        accessibleDescription = strings.title,
        emptyMessage = resolvedEmpty,
        errorMessage = stringResource(R.string.translation_error_serverError_message),
        retryLabel = stringResource(R.string.translation_common_retry),
        onRetry = onRetry,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            AreaChartWrapper(
                series = series,
                xLabels = result.xLabels,
                height = CHART_HEIGHT,
                yValueFormatter = { value -> ChartFormat.number(value, INTEGER_DECIMALS, locale) },
                emptyMessage = resolvedEmpty,
            )
            ChartLegend(entries = legend, modifier = Modifier.fillMaxWidth())
        }
    }
}

/**
 * The freshness chip rendered in the container header when cached data is refreshing / stale / offline —
 * the honest "last known + retry" affordance. Offline (a failed refresh over cached data) reads the
 * localized "Offline" label; a stale-but-reachable value reads its relative age. Mirrors the sibling
 * surfaces' freshness contract; carries no English literal.
 */
@Composable
private fun FSMTimelineFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberFSMTimelineFreshnessFormatter(),
    )
}

/**
 * Builds the localized [FSMTimelineChartStrings] from the i18n catalog (P1/S10): the two `fsm.*` keys the
 * web component resolves. Remembered against the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberFSMTimelineChartStrings(): FSMTimelineChartStrings {
    val title = stringResource(R.string.translation_fsm_timelineChart)
    val noData = stringResource(R.string.translation_fsm_noTimelineData)
    return remember(title, noData) {
        FSMTimelineChartStrings(title = title, noDataMessage = noData)
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same
 * render-only concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberFSMTimelineFreshnessFormatter(): (FreshnessAge) -> String {
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

/** A fixed wall clock so the preview buckets/labels are deterministic (2023-11-14T22:13:20Z). */
private const val PREVIEW_NOW_MILLIS: Long = 1_700_000_000_000L

/** A 6-hour preview window → 10-minute buckets (web `hours <= 6`). */
private const val PREVIEW_HOURS: Int = 6

/** UTC keeps the preview `HH:mm` labels independent of the renderer's machine zone. */
private val PREVIEW_ZONE: ZoneId = ZoneId.of("UTC")

private val PREVIEW_STRINGS =
    FSMTimelineChartStrings(
        title = "Transitions Over Time",
        noDataMessage = "No transition data for timeline",
    )

private val PREVIEW_TRANSITIONS =
    listOf(
        FSMTransitionPoint(ts = "2023-11-14T18:05:00Z", fsmName = "vehicle"),
        FSMTransitionPoint(ts = "2023-11-14T18:40:00Z", fsmName = "telemetry_connection"),
        FSMTransitionPoint(ts = "2023-11-14T20:10:00Z", fsmName = "vehicle"),
        FSMTransitionPoint(ts = "2023-11-14T21:30:00Z", fsmName = "vehicle"),
        FSMTransitionPoint(ts = "2023-11-14T21:55:00Z", fsmName = "telemetry_connection"),
    )

@Composable
private fun FSMTimelinePreviewHost(state: UiState<List<FSMTransitionPoint>>) {
    TeslaSyncTheme(dynamicColor = false) {
        FSMTimelineChartContent(
            state = state,
            hours = PREVIEW_HOURS,
            onRetry = {},
            locale = Locale.US,
            zone = PREVIEW_ZONE,
            nowMillis = PREVIEW_NOW_MILLIS,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun FSMTimelineChartLoadingPreview() {
    FSMTimelinePreviewHost(UiState(UiPhase.Loading))
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun FSMTimelineChartEmptyPreview() {
    FSMTimelinePreviewHost(UiState(UiPhase.Empty, data = emptyList()))
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun FSMTimelineChartErrorPreview() {
    FSMTimelinePreviewHost(UiState(UiPhase.Error, errorKind = ErrorKind.Network))
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun FSMTimelineChartContentPreview() {
    FSMTimelinePreviewHost(UiState(UiPhase.Content, data = PREVIEW_TRANSITIONS))
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun FSMTimelineChartOfflinePreview() {
    FSMTimelinePreviewHost(
        UiState(
            phase = UiPhase.Content,
            data = PREVIEW_TRANSITIONS,
            stale = true,
            fetchedAt = PREVIEW_NOW_MILLIS,
            errorKind = ErrorKind.Network,
        ),
    )
}
