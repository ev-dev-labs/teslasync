// The native Jetpack Compose + Material 3 SignalChartPanel feature view — a parity port of
// web/src/features/telemetry/components/SignalChartPanel.tsx. The web component is purely presentational: a
// `GlassPanel` whose header carries a mode icon (live `Radio` pulse / historical `BarChart3`), the resolved
// title, and a trailing counter (live `{events} · {points}`, or historical `{pointsLoaded} points loaded`),
// over a body that switches between a loading skeleton, the multi-line chart (overlay `LineChart` or the
// small-multiples `grid`), a live "waiting for data" state, and a historical "no data" state. It owns no
// fetching — its parents (SignalExplorerPage / SignalsWorkspacePage) pass `data` / `selectedSignals` / `stats`
// down.
//
// This port keeps that composition end to end. It performs NO HTTP and binds no data hook of its own; its web
// hooks map as: `useTranslation` → the i18n catalog (P1/S10), `useDateFormat().formatTime` → the injectable
// [timeFormatter] (the same host-owns-the-time-label split the sibling chart surfaces document). The host
// supplies the payload through the shared P1/S8 state-holder layer as a [UiState] (the cache-then-network
// projection of the live-signal stream), so this feature view renders every lifecycle state that layer can
// carry — loading, hard error with retry, empty, content, and stale/offline (cached "last known") — without
// ever fetching. A web-parity overload that takes the raw props is also provided.
//
// Documented platform differences (no data/composition/state drift):
//  • Dual axis — the web moves the 2nd series to a right axis when the first two stats' ranges differ >10×.
//    The shared Vico chart layer exposes a single value axis (feature views must not modify it), so the
//    decision is computed + tested in the model for parity, and the magnitude-separation intent is realized
//    natively through the small-multiples grid (one independent y-scale per cell) — which is also the web's
//    answer once many signals are pinned (the `auto` mode flip).
//  • Live "no animation" — the web disables series animation in live mode; the shared chart owns its own
//    animation policy, so this is not toggled per-surface. Purely visual; no data difference.
//  • Live pulse — rendered with [rememberReducedMotion] respected: a static red indicator when the user
//    prefers reduced motion, the gentle alpha pulse otherwise.
//
// Colors map to design tokens (never raw hex): the live indicator → [TeslaTokens.status.danger] (web
// `text-red-500/400`); the historical header icon → [TeslaTokens.chart.regen] (#06B6D4 cyan, the toned-down
// counterpart of the web `text-neon-cyan`); each series → the generated `ChartPalette` by position
// ([paletteColor]), mirroring the web `CHART_COLORS[i % len]`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SignalChartPanel — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.signalchartpanel

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartLegend
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.LegendEntry
import io.teslasync.android.components.charts.LineChartWrapper
import io.teslasync.android.components.charts.SmallMultiplesChart
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.charts.rememberChartLegendState
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** The web `height = 350` default plot height. */
private val DEFAULT_HEIGHT: Dp = 350.dp

/** The web `gridCellHeight = 140` default — a 3-row grid stack roughly matches the 350px overlay footprint. */
private val DEFAULT_GRID_CELL_HEIGHT: Dp = 140.dp

/** Column count for the small-multiples grid (native compact layout). */
private const val GRID_COLUMNS: Int = 2

/** The middle-dot separator between the live event and point counters (web `·`). */
private const val COUNTER_SEPARATOR: String = " · "

/** Live-pulse alpha floor + cadence — mirrors the shared `StatusPill` live pulse. */
private const val PULSE_MIN_ALPHA: Float = 0.35f
private const val PULSE_DURATION_MS: Int = 900
private const val FULL_ALPHA: Float = 1f

private val LIVE_DOT_SIZE: Dp = 6.dp

/**
 * Stateful entry point. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11) and renders every
 * lifecycle [state] the host's live-signal feed can carry. The host owns the feed (P1/S8) and supplies
 * [onRetry] (its `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the chart payload (web `data`/`selectedSignals`/`stats`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param isLive the live visual treatment (web `isLive`): red pulse, event/point counters, live empty copy.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SignalChartPanel(
    state: UiState<SignalChartData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    isLive: Boolean = false,
    title: String? = null,
    height: Dp = DEFAULT_HEIGHT,
    chartMode: SignalChartMode = SignalChartMode.Auto,
    gridAutoThreshold: Int = DEFAULT_GRID_AUTO_THRESHOLD,
    gridCellHeight: Dp = DEFAULT_GRID_CELL_HEIGHT,
    timeFormatter: (String) -> String = SignalChartPanelProjection::defaultTimeLabel,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordSignalChartPanelOpened(logger) }
    SignalChartPanelContent(
        state = state,
        onRetry = onRetry,
        modifier = modifier,
        isLive = isLive,
        title = title,
        height = height,
        chartMode = chartMode,
        gridAutoThreshold = gridAutoThreshold,
        gridCellHeight = gridCellHeight,
        timeFormatter = timeFormatter,
    )
}

/**
 * Web-parity overload mirroring the web component's raw props for hosts that already hold the loaded payload.
 * Maps [loading]/[data] onto a [UiState] (loading → spinner-equivalent, empty rows → empty state, else
 * content) and records `view.opened` like the stateful entry. There is no fetch behind it, so it offers no
 * retry affordance.
 */
@Composable
fun SignalChartPanel(
    selectedSignals: List<String>,
    data: List<SignalChartRow>,
    stats: List<SignalStat>,
    modifier: Modifier = Modifier,
    isLive: Boolean = false,
    loading: Boolean = false,
    pointsLoaded: Int? = null,
    liveEventCount: Int? = null,
    title: String? = null,
    height: Dp = DEFAULT_HEIGHT,
    chartMode: SignalChartMode = SignalChartMode.Auto,
    gridAutoThreshold: Int = DEFAULT_GRID_AUTO_THRESHOLD,
    gridCellHeight: Dp = DEFAULT_GRID_CELL_HEIGHT,
    timeFormatter: (String) -> String = SignalChartPanelProjection::defaultTimeLabel,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(selectedSignals, data, stats, loading, pointsLoaded, liveEventCount) {
            val payload =
                SignalChartData(
                    selectedSignals = selectedSignals,
                    rows = data,
                    stats = stats,
                    pointsLoaded = pointsLoaded,
                    liveEventCount = liveEventCount,
                )
            val phase =
                when {
                    loading -> UiPhase.Loading
                    data.isEmpty() -> UiPhase.Empty
                    else -> UiPhase.Content
                }
            UiState(phase = phase, data = payload)
        }
    SignalChartPanel(
        state = state,
        onRetry = {},
        modifier = modifier,
        isLive = isLive,
        title = title,
        height = height,
        chartMode = chartMode,
        gridAutoThreshold = gridAutoThreshold,
        gridCellHeight = gridCellHeight,
        timeFormatter = timeFormatter,
        logger = logger,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Always draws the header (icon +
 * resolved title + trailing counter/freshness, web parity), then switches the body the same way the web
 * ternary does, extended with the mandated error branch: a hard failure with no cached rows shows
 * `QueryError` with retry; otherwise the live/historical empty copy or the chart renders. Stale (non-error)
 * cached data auto-refreshes, mirroring the freshness contract. [locale] formats the counters.
 */
@Composable
fun SignalChartPanelContent(
    state: UiState<SignalChartData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    isLive: Boolean = false,
    title: String? = null,
    height: Dp = DEFAULT_HEIGHT,
    chartMode: SignalChartMode = SignalChartMode.Auto,
    gridAutoThreshold: Int = DEFAULT_GRID_AUTO_THRESHOLD,
    gridCellHeight: Dp = DEFAULT_GRID_CELL_HEIGHT,
    timeFormatter: (String) -> String = SignalChartPanelProjection::defaultTimeLabel,
    locale: Locale = Locale.getDefault(),
    strings: SignalChartPanelStrings = rememberSignalChartPanelStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val data = state.data ?: SignalChartData.EMPTY
    val projection =
        remember(data, chartMode, gridAutoThreshold) {
            SignalChartPanelProjection.project(data, chartMode, gridAutoThreshold)
        }
    val hasRows = !projection.isEmpty
    val resolvedTitle = title ?: if (isLive) strings.titleLive else strings.titleHistorical

    GlassPanel(modifier = modifier) {
        SignalChartHeader(
            isLive = isLive,
            title = resolvedTitle,
            data = data,
            hasRows = hasRows,
            state = state,
            strings = strings,
            locale = locale,
        )
        Spacer(Modifier.height(Spacing.sm))
        SignalChartBody(
            state = state,
            projection = projection,
            isLive = isLive,
            hasRows = hasRows,
            height = height,
            gridCellHeight = gridCellHeight,
            timeFormatter = timeFormatter,
            resourceName = resolvedTitle,
            strings = strings,
            onRetry = onRetry,
        )
    }
}

@Composable
private fun SignalChartHeader(
    isLive: Boolean,
    title: String,
    data: SignalChartData,
    hasRows: Boolean,
    state: UiState<SignalChartData>,
    strings: SignalChartPanelStrings,
    locale: Locale,
) {
    val reduceMotion = rememberReducedMotion()
    // The honest "last known + retry" chip shows once cached data is refreshing / stale / offline (and never
    // during a first load); extracted to a flag so the `if` stays a simple condition (detekt ComplexCondition).
    val showFreshness = !state.isLoading && (state.refreshing || state.stale || state.hasError)
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        val pulseAlpha = if (isLive && !reduceMotion) livePulseAlpha() else FULL_ALPHA
        if (isLive) {
            Icon(
                SignalChartGlyphs.Radio,
                contentDescription = null,
                size = IconSize.Md,
                tint = TeslaTokens.status.danger.copy(alpha = pulseAlpha),
            )
        } else {
            Icon(
                SignalChartGlyphs.BarChart,
                contentDescription = null,
                size = IconSize.Md,
                tint = TeslaTokens.chart.regen,
            )
        }
        SectionTitle(title, modifier = Modifier.weight(1f))
        SignalChartCounter(
            isLive = isLive,
            data = data,
            hasRows = hasRows,
            strings = strings,
            locale = locale,
            pulseAlpha = pulseAlpha,
        )
        if (showFreshness) {
            SignalChartFreshnessChip(state)
        }
    }
}

@Composable
private fun SignalChartCounter(
    isLive: Boolean,
    data: SignalChartData,
    hasRows: Boolean,
    strings: SignalChartPanelStrings,
    locale: Locale,
    pulseAlpha: Float,
) {
    when {
        isLive -> {
            val events = SignalChartPanelProjection.fmtInt(data.liveEventCount ?: 0, locale)
            val points = SignalChartPanelProjection.fmtInt(data.rows.size, locale)
            val label = "$events ${strings.events}$COUNTER_SEPARATOR$points ${strings.points}"
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Box(
                    modifier =
                        Modifier
                            .size(LIVE_DOT_SIZE)
                            .clip(CircleShape)
                            .background(TeslaTokens.status.danger.copy(alpha = pulseAlpha)),
                )
                Caption(label)
            }
        }

        hasRows && data.pointsLoaded != null -> {
            val loaded = SignalChartPanelProjection.fmtInt(data.pointsLoaded, locale)
            Caption("$loaded ${strings.pointsLoadedNoun}")
        }

        else -> Unit
    }
}

@Composable
private fun SignalChartBody(
    state: UiState<SignalChartData>,
    projection: SignalChartProjectionResult,
    isLive: Boolean,
    hasRows: Boolean,
    height: Dp,
    gridCellHeight: Dp,
    timeFormatter: (String) -> String,
    resourceName: String,
    strings: SignalChartPanelStrings,
    onRetry: () -> Unit,
) {
    when {
        state.isError && !hasRows ->
            QueryError(
                kind = state.toSignalChartQueryErrorKind(),
                resourceName = resourceName,
                onRetry = onRetry,
                modifier = Modifier.fillMaxWidth(),
            )

        hasRows ->
            SignalChartPlot(
                projection = projection,
                isLive = isLive,
                height = height,
                gridCellHeight = gridCellHeight,
                timeFormatter = timeFormatter,
                emptyMessage = strings.noData,
            )

        isLive ->
            SignalChartMessage(
                icon = SignalChartGlyphs.Radio,
                message = strings.liveWaiting,
                height = height,
                iconTint = TeslaTokens.status.danger,
            )

        state.isLoading ->
            Skeleton(modifier = Modifier.fillMaxWidth(), height = height)

        else ->
            SignalChartMessage(
                icon = SignalChartGlyphs.Activity,
                message = strings.noData,
                height = height,
                iconTint = null,
            )
    }
}

@Composable
private fun SignalChartPlot(
    projection: SignalChartProjectionResult,
    isLive: Boolean,
    height: Dp,
    gridCellHeight: Dp,
    timeFormatter: (String) -> String,
    emptyMessage: String,
) {
    val chartSeries =
        remember(projection.series) {
            projection.series.mapIndexed { index, series ->
                ChartSeries(
                    key = series.signal,
                    label = series.signal,
                    values = series.values,
                    kind = ChartSeriesKind.Line,
                    color = paletteColor(index),
                )
            }
        }
    when (projection.resolvedMode) {
        ResolvedChartMode.Grid ->
            SmallMultiplesChart(
                series = chartSeries,
                xLabels = projection.xLabels,
                columns = GRID_COLUMNS,
                cellHeight = gridCellHeight,
                syncId = "signal-chart-${if (isLive) "live" else "historical"}",
                emptyCellLabel = emptyMessage,
            )

        ResolvedChartMode.Overlay -> {
            val legendState = rememberChartLegendState()
            val legend =
                remember(chartSeries) {
                    chartSeries.map { LegendEntry(key = it.key, label = it.label, color = it.color ?: Color.Unspecified) }
                }
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                LineChartWrapper(
                    series = chartSeries,
                    xLabels = projection.xLabels,
                    height = height,
                    hiddenKeys = legendState.hidden,
                    xValueFormatter = timeFormatter,
                    emptyMessage = emptyMessage,
                )
                ChartLegend(entries = legend, state = legendState, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

/** A fixed-height, centered icon + message — the web live "waiting" / historical "no data" empty regions. */
@Composable
private fun SignalChartMessage(
    icon: ImageVector,
    message: String,
    height: Dp,
    iconTint: Color?,
) {
    Box(
        modifier = Modifier.fillMaxWidth().height(height),
        contentAlignment = Alignment.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            if (iconTint != null) {
                Icon(icon, contentDescription = null, size = IconSize.Md, tint = iconTint)
            } else {
                Icon(icon, contentDescription = null, size = IconSize.Md)
            }
            BodyText(message)
        }
    }
}

/**
 * The freshness chip rendered in the header when cached data is refreshing / stale / offline — the honest
 * "last known + retry" affordance (a native addition; the web component is presentational and has none). The
 * relative-age label resolves through the localized `translation_freshness_*` keys.
 */
@Composable
private fun SignalChartFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberSignalChartFreshnessFormatter(),
    )
}

/** Animated live-pulse alpha, mirroring the shared `StatusPill` cadence. Gate the call on reduced motion. */
@Composable
private fun livePulseAlpha(): Float {
    val transition = rememberInfiniteTransition(label = "signal-chart-live-pulse")
    val alpha by transition.animateFloat(
        initialValue = PULSE_MIN_ALPHA,
        targetValue = FULL_ALPHA,
        animationSpec = infiniteRepeatable(tween(PULSE_DURATION_MS), RepeatMode.Reverse),
        label = "signal-chart-live-pulse-alpha",
    )
    return alpha
}

/**
 * Classifies the host feed's failure into the recovery copy the `QueryError` branch shows — the established
 * `UiState.toQueryErrorKind` mapping the sibling chart widgets use.
 */
private fun UiState<*>.toSignalChartQueryErrorKind(): QueryErrorKind =
    when (errorKind) {
        ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
        ErrorKind.Http -> classifyQueryError(status = httpStatus, online = true, transientWaiting = false)
        ErrorKind.Decode -> QueryErrorKind.ServerError
        null, ErrorKind.Unknown -> QueryErrorKind.Network
    }

/**
 * Resolves the localized [SignalChartPanelStrings] from the i18n catalog (P1/S10). See the holder's KDoc for
 * the per-string web-key → P1/S10-key mapping (the web keys are bare phrases the catalog lacks; the closest
 * existing keys are used and any divergence is documented). Remembered against the resolved strings so a
 * locale change re-projects the surface.
 */
@Composable
private fun rememberSignalChartPanelStrings(): SignalChartPanelStrings {
    val titleLive = stringResource(R.string.translation_widget_liveSignals)
    val titleHistorical =
        "${stringResource(R.string.translation_liveMonitor_signal)} ${stringResource(R.string.translation_Chart)}"
    val events = stringResource(R.string.translation_events)
    val points = stringResource(R.string.translation_points)
    val pointsLoadedNoun = stringResource(R.string.translation_points)
    val liveWaiting = stringResource(R.string.translation_liveMonitor_waiting)
    val noData = stringResource(R.string.translation_chart_noData)
    return remember(titleLive, titleHistorical, events, points, pointsLoadedNoun, liveWaiting, noData) {
        SignalChartPanelStrings(
            titleLive = titleLive,
            titleHistorical = titleHistorical,
            events = events,
            points = points,
            pointsLoadedNoun = pointsLoadedNoun,
            liveWaiting = liveWaiting,
            noData = noData,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberSignalChartFreshnessFormatter(): (FreshnessAge) -> String {
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

/** Em dash shown for an unknown freshness age — the shared freshness `'—'` fallback. */
private const val EM_DASH: String = "\u2014"

/**
 * Self-contained line glyphs for the surface, authored as 24×24 stroked vectors (the web leans on lucide-react,
 * which has no bundled Android equivalent). Each is monochrome and recolored at render by the [Icon] tint, in
 * the same style the sibling chart/widget surfaces use rather than expanding the shared icon set from a feature
 * prompt.
 */
private object SignalChartGlyphs {
    /** Broadcast "radio" (lucide `radio`) — the live mode + waiting-state icon (web `Radio`). */
    val Radio: ImageVector =
        signalChartVector("SignalChartRadio") {
            moveTo(4.9f, 19.1f)
            curveTo(1f, 15.2f, 1f, 8.8f, 4.9f, 4.9f)
            moveTo(7.8f, 16.2f)
            curveToRelative(-2.3f, -2.3f, -2.3f, -6.1f, 0f, -8.5f)
            moveTo(14f, 12f)
            arcToRelative(2f, 2f, 0f, true, true, -4f, 0f)
            arcToRelative(2f, 2f, 0f, true, true, 4f, 0f)
            close()
            moveTo(16.2f, 7.8f)
            curveToRelative(2.3f, 2.3f, 2.3f, 6.1f, 0f, 8.5f)
            moveTo(19.1f, 4.9f)
            curveTo(23f, 8.8f, 23f, 15.1f, 19.1f, 19f)
        }

    /** Bar chart (lucide `bar-chart-3`) — the historical mode header icon (web `BarChart3`). */
    val BarChart: ImageVector =
        signalChartVector("SignalChartBarChart") {
            moveTo(4f, 21f)
            lineTo(4f, 10f)
            moveTo(10f, 21f)
            lineTo(10f, 4f)
            moveTo(16f, 21f)
            lineTo(16f, 14f)
            moveTo(3f, 21f)
            lineTo(20f, 21f)
        }

    /** Activity pulse (lucide `activity`) — the historical empty-state icon (web `Activity`). */
    val Activity: ImageVector =
        signalChartVector("SignalChartActivity") {
            moveTo(3f, 12f)
            lineTo(7f, 12f)
            lineTo(10f, 5f)
            lineTo(14f, 19f)
            lineTo(17f, 12f)
            lineTo(21f, 12f)
        }
}

private const val GLYPH_VIEWPORT: Float = 24f
private const val GLYPH_STROKE: Float = 2f
private val GLYPH_SIZE: Dp = 24.dp

private fun signalChartVector(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_SIZE,
            defaultHeight = GLYPH_SIZE,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────

private val PREVIEW_STRINGS =
    SignalChartPanelStrings(
        titleLive = "Live Signals",
        titleHistorical = "Signal Chart",
        events = "events",
        points = "points",
        pointsLoadedNoun = "points",
        liveWaiting = "Waiting for signals\u2026",
        noData = "No data available",
    )

private fun previewRows(count: Int): List<SignalChartRow> =
    (0 until count).map { i ->
        SignalChartRow(
            timestamp = "2026-06-12T10:%02d:00Z".format(i % 60),
            values = mapOf("VehicleSpeed" to (i * 3.0), "BatteryLevel" to (80.0 - i)),
        )
    }

private fun previewData(
    signals: List<String> = listOf("VehicleSpeed", "BatteryLevel"),
    rows: List<SignalChartRow> = previewRows(12),
    pointsLoaded: Int? = 12,
    liveEventCount: Int? = null,
): SignalChartData =
    SignalChartData(
        selectedSignals = signals,
        rows = rows,
        stats =
            listOf(
                SignalStat("VehicleSpeed", min = 0.0, max = 120.0, avg = 60.0, count = rows.size),
                SignalStat("BatteryLevel", min = 60.0, max = 80.0, avg = 70.0, count = rows.size),
            ),
        pointsLoaded = pointsLoaded,
        liveEventCount = liveEventCount,
    )

@Preview(name = "Loading (historical)", showBackground = true)
@Composable
private fun SignalChartPanelLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalChartPanelContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Live (waiting)", showBackground = true)
@Composable
private fun SignalChartPanelLiveWaitingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalChartPanelContent(
            state = UiState(UiPhase.Empty, data = SignalChartData.EMPTY),
            onRetry = {},
            isLive = true,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content (overlay)", showBackground = true)
@Composable
private fun SignalChartPanelOverlayPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalChartPanelContent(
            state = UiState(UiPhase.Content, data = previewData()),
            onRetry = {},
            chartMode = SignalChartMode.Overlay,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content (grid)", showBackground = true)
@Composable
private fun SignalChartPanelGridPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalChartPanelContent(
            state = UiState(UiPhase.Content, data = previewData()),
            onRetry = {},
            chartMode = SignalChartMode.Grid,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Live (streaming)", showBackground = true)
@Composable
private fun SignalChartPanelLiveStreamingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalChartPanelContent(
            state = UiState(UiPhase.Content, data = previewData(liveEventCount = 4096)),
            onRetry = {},
            isLive = true,
            chartMode = SignalChartMode.Overlay,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun SignalChartPanelErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalChartPanelContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun SignalChartPanelOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalChartPanelContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewData(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty (historical)", showBackground = true)
@Composable
private fun SignalChartPanelEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalChartPanelContent(
            state = UiState(UiPhase.Empty, data = SignalChartData.EMPTY),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}
