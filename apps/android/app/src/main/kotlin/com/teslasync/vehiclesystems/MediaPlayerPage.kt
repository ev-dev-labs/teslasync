// The native Jetpack Compose + Material 3 MediaPlayerPage vehicle-systems surface — a parity port of
// web/src/features/vehicle-systems/pages/MediaPlayerPage.tsx, the in-car media "now playing / volume / listening
// history" dashboard. It reproduces the page's nine panels (the now-playing hero card, the volume RadialGauge panel,
// the four overview metric cards — unique tracks / top source / average volume / volume step, the volume-over-time
// area chart, the source-distribution donut, and the playback-history table), all three charts (RadialGauge canvas +
// the A3 area wrapper + the source-distribution donut canvas), every data state (loading skeleton / empty / error-retry
// / content, plus the cache-then-network stale/offline tier the bound state holders carry), and every visible string
// (resolved from the generated res/values catalog, ADR-014).
//
// Composition: [MediaPlayerPage] is the stateful entry (constructs the view-model over the host-wired source, records
// the one-shot `view.opened` diagnostic, collects the latest-snapshot feed + the history feed + the live display
// preferences); [MediaPlayerPageContent] is the stateless render layer. The `/media/latest` snapshot powers the
// now-playing card + the volume gauge; the `/media` history is folded by the framework-free model (mediaStats /
// volumePoints / sourceSlices) into the metric cards, the two charts, and the table — exactly as the web page threads
// its loaded data through the useMemo chain. Audio volume is a raw device scale, so the only display formatting is the
// locale-aware number formatting applied here at the render boundary via the model's [MediaPlayerDisplayPrefs].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + sub-components; `LongMethod`/`TooManyFunctions` for the parity-complete set.
@file:Suppress(
    "InvalidPackageDeclaration",
    "MatchingDeclarationName",
    "TooManyFunctions",
    "LongMethod",
)

package io.teslasync.android.vehiclesystems.mediaplayer

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.ChartBlockSkeleton
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.PageHeaderSkeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Stagger between the body panels' entrance fades (web `FadeIn` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** The volume RadialGauge diameter (web `RadialGauge size={120}`). */
private val GAUGE_SIZE = 120.dp

/** The volume-over-time area chart height (web `ResponsiveContainer height={260}`). */
private val VOLUME_CHART_HEIGHT = 260.dp

/** The source-distribution donut box size (web `PieChart` height 200, inner 45 / outer 80). */
private val DONUT_SIZE = 168.dp

/** The donut ring radius the arcs are stroked along (within the web inner-45 / outer-80 band). */
private val DONUT_RING_RADIUS = 60.dp

/** The donut ring thickness — the web `outerRadius - innerRadius` (80 − 45), kept proportional. */
private val DONUT_RING_THICKNESS = 30.dp

/** The album-art tile + status-dot sizes. */
private val ALBUM_TILE = 96.dp
private val LEGEND_DOT = 10.dp

/** The now-playing progress bar height + the gap between donut slices (web `paddingAngle={3}`). */
private val PROGRESS_BAR_HEIGHT = 6.dp
private const val DONUT_PADDING_ANGLE = 3f
private const val FULL_SWEEP = 360f
private const val DONUT_START_ANGLE = -90f
private const val TRACK_ALPHA = 0.4f
private const val ALBUM_TILE_ALPHA = 0.6f

/** The most-recent playback-history rows the table renders (web DataTable paginates; the native list caps the page). */
private const val HISTORY_TABLE_ROWS = 50

// The web's data-viz accent hexes (dynamic chart / semantic values, not static theme tokens — the sibling
// RegenEfficiencyPage precedent). Used for the gauge sweep + the metric-card glyph tints.
private val VOLUME_COLOR = Color(0xFF00F0FF)
private val ACCENT_PURPLE = Color(0xFFA855F7)
private val ACCENT_GREEN = Color(0xFF10B981)
private val ACCENT_CYAN = Color(0xFF00F0FF)

/** The page's interaction callbacks, wired to the [MediaPlayerPageViewModel] (web event handlers). */
data class MediaPlayerActions(
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [MediaPlayerPageViewModel] over the supplied [source] (the host wires the shared
 * resilient client + the app-scoped active-vehicle selection + the settings holder via [mediaPlayerPageSourceOf]).
 * [logger] defaults to the app's redacting logger.
 */
@Composable
fun MediaPlayerPage(
    source: MediaPlayerPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: MediaPlayerPageViewModel =
        viewModel(
            key = MediaPlayerPageRegistration.SLUG,
            factory = viewModelFactory { initializer { MediaPlayerPageViewModel(source, logger) } },
        )
    MediaPlayerPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] latest feed + history feed + display prefs to the stateless content. */
@Composable
fun MediaPlayerPage(
    viewModel: MediaPlayerPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val latestState by viewModel.latestState.collectAsStateWithLifecycle()
    val historyState by viewModel.historyState.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    val actions = remember(viewModel) { MediaPlayerActions(onRetry = viewModel::retry) }

    MediaPlayerPageContent(
        latestState = latestState,
        historyState = historyState,
        prefs = prefs,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body. A still-loading latest feed (with nothing cached) renders the full-page skeleton; otherwise
 * the page header is drawn, then either the hard-error retry surface (latest failed with no cache) or the loaded body
 * (which itself renders the chart + table empty states inline — so no region ever blanks).
 */
@Composable
fun MediaPlayerPageContent(
    latestState: UiState<MediaSnapshot?>,
    historyState: UiState<List<MediaSnapshot>>,
    prefs: MediaPlayerDisplayPrefs,
    actions: MediaPlayerActions,
    modifier: Modifier = Modifier,
) {
    if (latestState.isLoading) {
        MediaLoading(modifier)
        return
    }

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        MediaHeader(latestState = latestState)

        if (latestState.isError) {
            MediaError(onRetry = actions.onRetry)
        } else {
            MediaLoaded(
                latest = latestState.data,
                history = historyState.data.orEmpty(),
                prefs = prefs,
            )
        }
    }
}

/** The full-page loading skeleton shown before the first snapshot (web `PageContainer loading`). */
@Composable
private fun MediaLoading(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxSize().padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        PageHeaderSkeleton()
        ChartBlockSkeleton(height = ALBUM_TILE)
        StatGridSkeleton(count = 2)
        StatGridSkeleton(count = 2)
        ChartBlockSkeleton(height = VOLUME_CHART_HEIGHT)
        ChartBlockSkeleton(height = DONUT_SIZE)
    }
}

/** The page header — the title + muted subtitle + the query-freshness chip (web `PageContainer` title/subtitle). */
@Composable
private fun MediaHeader(latestState: UiState<MediaSnapshot?>) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PageTitle(stringResource(R.string.translation_Media_Player))
            BodyText(
                stringResource(R.string.translation_Now_playing_volume_and_listening_history),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        DataFreshness(
            updatedAtMillis = latestState.fetchedAt?.takeIf { it > 0L },
            isFetching = latestState.refreshing,
            isStale = latestState.stale,
            isError = latestState.hasError,
            compact = true,
        )
    }
}

/** The hard-error surface for the latest feed (no cached fallback) — a retry-able error panel (web `error` prop). */
@Composable
private fun MediaError(onRetry: () -> Unit) {
    FadeIn {
        GlassPanel(padding = PanelPadding.Lg) {
            ErrorDisplay(
                message = stringResource(R.string.translation_error_loadFailed),
                onRetry = onRetry,
            )
        }
    }
}

// ── Loaded body ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The loaded surface — the now-playing card, the volume gauge + four overview metric cards, the volume-over-time area
 * chart, the source-distribution donut, and the playback-history table. The latest snapshot drives the card + gauge;
 * the history is folded by the framework-free model into the cards, charts, and table.
 */
@Composable
private fun MediaLoaded(
    latest: MediaSnapshot?,
    history: List<MediaSnapshot>,
    prefs: MediaPlayerDisplayPrefs,
) {
    val stats = remember(history) { mediaStats(history) }
    val volume = remember(history) { volumePoints(history) }
    val slices = remember(history) { sourceSlices(history) }

    FadeIn(delayMs = 0) { MediaNowPlayingPanel(latest = latest) }
    FadeIn(delayMs = FADE_STEP_MS) { MediaVolumeGaugePanel(latest = latest) }
    FadeIn(delayMs = FADE_STEP_MS * 2) { MediaMetricCards(latest = latest, stats = stats, prefs = prefs) }
    FadeIn(delayMs = FADE_STEP_MS * 3) { MediaVolumeChartPanel(points = volume) }
    FadeIn(delayMs = FADE_STEP_MS * 4) { MediaSourceDistributionPanel(slices = slices) }
    FadeIn(delayMs = FADE_STEP_MS * 5) { MediaPlaybackHistoryPanel(history = history, prefs = prefs) }
}

/** GlassPanel1 — the now-playing hero: album-art tile, track title + status badge, artist/album, source, progress. */
@Composable
private fun MediaNowPlayingPanel(latest: MediaSnapshot?) {
    GlassPanel(padding = PanelPadding.Lg) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            Box(
                modifier =
                    Modifier
                        .size(ALBUM_TILE)
                        .clip(RoundedCornerShape(Spacing.md))
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = ALBUM_TILE_ALPHA)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(DataDisplayGlyphs.Play, contentDescription = null, size = IconSize.Xl, tint = VOLUME_COLOR)
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    SectionTitle(latest?.nowPlayingTitle?.takeIf { it.isNotBlank() } ?: stringResource(R.string.translation_No_track))
                    if (latest?.playbackStatus != null) {
                        val kind = MediaStatusKind.fromStatus(latest.playbackStatus)
                        Badge(text = statusLabel(kind), variant = statusVariant(kind), dot = true)
                    }
                }
                BodyText(
                    text = mediaArtistLine(latest),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                )
                if (!latest?.nowPlayingStation.isNullOrBlank()) {
                    HelperText(latest.nowPlayingStation.orEmpty())
                }
                if (!latest?.playbackSource.isNullOrBlank()) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                        Icon(DataDisplayGlyphs.Wifi, contentDescription = null, size = IconSize.Sm, tint = ACCENT_CYAN)
                        Caption(latest.playbackSource.orEmpty())
                    }
                }
                if ((latest?.nowPlayingDurationMs ?: 0.0) > 0.0) {
                    MediaProgressRow(latest)
                }
            }
        }
    }
}

/** The now-playing progress row — elapsed / track + a thin fraction-filled bar (web progress bar). */
@Composable
private fun MediaProgressRow(latest: MediaSnapshot?) {
    val fraction = (mediaProgressPercent(latest) / 100.0).toFloat().coerceIn(0f, 1f)
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Caption(formatPlayTime(latest?.nowPlayingElapsedMs ?: 0.0))
        Box(
            modifier =
                Modifier
                    .weight(1f)
                    .height(PROGRESS_BAR_HEIGHT)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.surfaceVariant),
            contentAlignment = Alignment.CenterStart,
        ) {
            Box(
                modifier =
                    Modifier
                        .fillMaxWidth(fraction)
                        .height(PROGRESS_BAR_HEIGHT)
                        .clip(CircleShape)
                        .background(VOLUME_COLOR),
                contentAlignment = Alignment.Center,
            ) { Spacer(Modifier.size(Spacing.none)) }
        }
        Caption(formatPlayTime(latest?.nowPlayingDurationMs ?: 0.0))
    }
}

/** GlassPanel2 — the volume RadialGauge (web `<RadialGauge value={audio_volume} max={audio_volume_max || 11} />`). */
@Composable
private fun MediaVolumeGaugePanel(latest: MediaSnapshot?) {
    GlassPanel {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            RadialGauge(
                value = latest?.audioVolume ?: 0.0,
                max = volumeMaxOf(latest),
                label = stringResource(R.string.translation_Volume),
                unit = "",
                color = VOLUME_COLOR,
                size = GAUGE_SIZE,
            )
        }
    }
}

/** GlassPanel3–GlassPanel6 — Unique Tracks, Top Source, Avg Volume, and Volume Step metric cards (2×2). */
@Composable
private fun MediaMetricCards(
    latest: MediaSnapshot?,
    stats: MediaStats,
    prefs: MediaPlayerDisplayPrefs,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_Unique_Tracks),
                value = prefs.integer(stats.uniqueTracks),
                icon = DataDisplayGlyphs.History,
                accent = ACCENT_PURPLE,
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_Top_Source),
                value = stats.topSource,
                icon = DataDisplayGlyphs.Wifi,
                accent = ACCENT_GREEN,
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_Avg_Volume),
                value = prefs.integer(stats.avgVolume),
                icon = DataDisplayGlyphs.Gauge,
                accent = ACCENT_CYAN,
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_Volume_Step),
                value = latest?.audioVolumeIncrement?.let { prefs.decimal(it, VOLUME_STEP_DECIMALS) } ?: MEDIA_EM_DASH,
                icon = DataDisplayGlyphs.Bolt,
                accent = ACCENT_PURPLE,
            )
        }
    }
}

/** GlassPanel7 — the volume-over-time area chart, framed by [ChartContainer] (web `<AreaChart>`). */
@Composable
private fun MediaVolumeChartPanel(points: List<MediaVolumePoint>) {
    val ready = points.isNotEmpty()
    ChartContainer(
        title = stringResource(R.string.translation_Volume_over_Time),
        status = if (ready) ChartStatus.Ready else ChartStatus.Empty,
        height = VOLUME_CHART_HEIGHT,
        accessibleDescription = stringResource(R.string.translation_Volume_over_Time),
        emptyMessage = stringResource(R.string.translation_No_volume_data_for_this_period),
        dataTableHeader = listOf(stringResource(R.string.translation_Time), stringResource(R.string.translation_Volume)),
        dataTableRows = points.map { listOf(it.timeLabel, it.volume.toString()) },
    ) {
        AreaChartWrapper(
            series =
                listOf(
                    ChartSeries(
                        key = "volume",
                        label = stringResource(R.string.translation_Volume),
                        values = points.map { it.volume },
                        color = VOLUME_COLOR,
                    ),
                ),
            xLabels = points.map { it.timeLabel },
            height = VOLUME_CHART_HEIGHT,
        )
    }
}

/** GlassPanel8 — the source-distribution donut + legend, or its inline empty state (web `<PieChart>` | EmptyState). */
@Composable
private fun MediaSourceDistributionPanel(slices: List<MediaSourceSlice>) {
    GlassPanel {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Icon(DataDisplayGlyphs.Wifi, contentDescription = null, size = IconSize.Md, tint = ACCENT_PURPLE)
            PanelTitle(stringResource(R.string.translation_Source_Distribution))
        }
        Spacer(Modifier.height(Spacing.sm))
        if (slices.isEmpty()) {
            EmptyState(
                icon = DataDisplayGlyphs.Wifi,
                message = stringResource(R.string.translation_No_source_data_available),
            )
        } else {
            val colors = slices.indices.map { paletteColor(it) }
            val description =
                slices.joinToString(separator = ", ") { "${it.name} ${it.value}" }
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
            ) {
                MediaSourceDonut(slices = slices, colors = colors, contentDescription = description)
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    slices.forEachIndexed { index, slice ->
                        MediaSourceLegendRow(slice = slice, color = colors[index % colors.size])
                    }
                }
            }
        }
    }
}

/** A single source-distribution legend row — a color dot + the source name + its count (web legend item). */
@Composable
private fun MediaSourceLegendRow(
    slice: MediaSourceSlice,
    color: Color,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Box(
            modifier =
                Modifier
                    .size(LEGEND_DOT)
                    .clip(CircleShape)
                    .background(color),
            contentAlignment = Alignment.Center,
        ) { Spacer(Modifier.size(Spacing.none)) }
        Caption(slice.name, modifier = Modifier.weight(1f))
        HelperText("(${slice.value})")
    }
}

/**
 * The source-distribution donut — the native counterpart of the web `<PieChart><Pie innerRadius={45} outerRadius={80}
 * paddingAngle={3} dataKey="value">`. A faint full-ring track is drawn first (so the ring is never blank), then each
 * slice is a stroked Canvas arc whose sweep is proportional to its share; a small gap between slices reproduces the web
 * `paddingAngle`. The whole ring exposes one combined [contentDescription] so TalkBack reads the breakdown.
 */
@Composable
private fun MediaSourceDonut(
    slices: List<MediaSourceSlice>,
    colors: List<Color>,
    contentDescription: String,
    modifier: Modifier = Modifier,
) {
    val trackColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = TRACK_ALPHA)
    val gap = if (slices.size > 1) DONUT_PADDING_ANGLE else 0f
    Canvas(
        modifier =
            modifier
                .size(DONUT_SIZE)
                .clearAndSetSemantics { this.contentDescription = contentDescription },
    ) {
        val ringRadiusPx = DONUT_RING_RADIUS.toPx()
        val strokePx = DONUT_RING_THICKNESS.toPx()
        val topLeft = Offset(center.x - ringRadiusPx, center.y - ringRadiusPx)
        val arcSize = Size(ringRadiusPx * 2f, ringRadiusPx * 2f)
        drawArc(
            color = trackColor,
            startAngle = 0f,
            sweepAngle = FULL_SWEEP,
            useCenter = false,
            topLeft = topLeft,
            size = arcSize,
            style = Stroke(width = strokePx, cap = StrokeCap.Butt),
        )
        var startAngle = DONUT_START_ANGLE
        slices.forEachIndexed { index, slice ->
            val sweep = (slice.fraction * FULL_SWEEP).toFloat()
            drawArc(
                color = colors[index % colors.size],
                startAngle = startAngle + gap / 2f,
                sweepAngle = (sweep - gap).coerceAtLeast(0f),
                useCenter = false,
                topLeft = topLeft,
                size = arcSize,
                style = Stroke(width = strokePx, cap = StrokeCap.Butt),
            )
            startAngle += sweep
        }
    }
}

/** GlassPanel9 — the playback-history table (web `<DataTable>`), or its inline empty state. */
@Composable
private fun MediaPlaybackHistoryPanel(
    history: List<MediaSnapshot>,
    prefs: MediaPlayerDisplayPrefs,
) {
    GlassPanel(padding = PanelPadding.Lg) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(DataDisplayGlyphs.History, contentDescription = null, size = IconSize.Md, tint = ACCENT_CYAN)
            SectionTitle(stringResource(R.string.translation_Playback_History), modifier = Modifier.weight(1f))
            Badge(text = "${prefs.integer(history.size)} ${stringResource(R.string.translation_records)}", variant = BadgeVariant.Neutral)
        }
        Spacer(Modifier.height(Spacing.sm))
        if (history.isEmpty()) {
            EmptyState(
                icon = DataDisplayGlyphs.History,
                title = stringResource(R.string.translation_No_playback_history),
                message = stringResource(R.string.translation_No_playback_history_for_this_period),
            )
        } else {
            MediaHistoryHeaderRow()
            history
                .sortedByDescending { it.createdAt }
                .take(HISTORY_TABLE_ROWS)
                .forEach { row -> MediaHistoryRow(row) }
        }
    }
}

/** The playback-history table header — Time / Track / Artist / Source / Volume / Status (web `Column` headers). */
@Composable
private fun MediaHistoryHeaderRow() {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Caption(stringResource(R.string.translation_Time), modifier = Modifier.weight(TIME_WEIGHT))
        Caption(stringResource(R.string.translation_Track), modifier = Modifier.weight(TRACK_WEIGHT))
        Caption(stringResource(R.string.translation_Artist), modifier = Modifier.weight(ARTIST_WEIGHT))
        Caption(stringResource(R.string.translation_Source), modifier = Modifier.weight(SOURCE_WEIGHT))
        Caption(stringResource(R.string.translation_Volume), modifier = Modifier.weight(VOLUME_WEIGHT))
        Caption(stringResource(R.string.translation_Status), modifier = Modifier.weight(STATUS_WEIGHT))
    }
}

/** One playback-history row — the snapshot's time, track, artist, source, volume reading, and status badge. */
@Composable
private fun MediaHistoryRow(row: MediaSnapshot) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        HelperText(row.createdAt, modifier = Modifier.weight(TIME_WEIGHT))
        BodyText(
            row.nowPlayingTitle?.takeIf { it.isNotBlank() } ?: MEDIA_DOUBLE_DASH,
            modifier = Modifier.weight(TRACK_WEIGHT),
            maxLines = 1,
        )
        HelperText(row.nowPlayingArtist?.takeIf { it.isNotBlank() } ?: MEDIA_DOUBLE_DASH, modifier = Modifier.weight(ARTIST_WEIGHT))
        HelperText(row.playbackSource?.takeIf { it.isNotBlank() } ?: MEDIA_DOUBLE_DASH, modifier = Modifier.weight(SOURCE_WEIGHT))
        BodyText(
            mediaVolumeReading(row),
            modifier = Modifier.weight(VOLUME_WEIGHT),
            color = ACCENT_CYAN,
            maxLines = 1,
        )
        Box(modifier = Modifier.weight(STATUS_WEIGHT)) {
            val kind = MediaStatusKind.fromStatus(row.playbackStatus)
            Badge(text = statusLabel(kind), variant = statusVariant(kind))
        }
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────

private const val VOLUME_STEP_DECIMALS = 2
private const val TIME_WEIGHT = 1.4f
private const val TRACK_WEIGHT = 1.6f
private const val ARTIST_WEIGHT = 1.3f
private const val SOURCE_WEIGHT = 1.1f
private const val VOLUME_WEIGHT = 0.9f
private const val STATUS_WEIGHT = 1.2f

/** The badge palette for a playback status (web `statusVariant`): Playing → success, Paused → warning, else neutral. */
private fun statusVariant(kind: MediaStatusKind): BadgeVariant =
    when (kind) {
        MediaStatusKind.Playing -> BadgeVariant.Success
        MediaStatusKind.Paused -> BadgeVariant.Warning
        MediaStatusKind.Stopped -> BadgeVariant.Neutral
    }

/** The localized label for a playback status (web `statusLabel`). */
@Composable
private fun statusLabel(kind: MediaStatusKind): String =
    when (kind) {
        MediaStatusKind.Playing -> stringResource(R.string.translation_Playing)
        MediaStatusKind.Paused -> stringResource(R.string.translation_Paused)
        MediaStatusKind.Stopped -> stringResource(R.string.translation_Stopped)
    }

/** The artist line under the title — the artist (or "Unknown artist") plus the album when present (web template). */
@Composable
private fun mediaArtistLine(latest: MediaSnapshot?): String {
    val artist = latest?.nowPlayingArtist?.takeIf { it.isNotBlank() } ?: stringResource(R.string.translation_Unknown_artist)
    val album = latest?.nowPlayingAlbum?.takeIf { it.isNotBlank() }
    return if (album != null) "$artist \u2014 $album" else artist
}

/** The per-row volume reading "v/max" (web `{audio_volume}/{audio_volume_max}`), em-dashing missing values. */
private fun mediaVolumeReading(row: MediaSnapshot): String {
    val volume = row.audioVolume?.let { roundedPercent(it).toString() } ?: MEDIA_EM_DASH
    val max = row.audioVolumeMax?.let { roundedPercent(it).toString() } ?: MEDIA_EM_DASH
    return "$volume/$max"
}
