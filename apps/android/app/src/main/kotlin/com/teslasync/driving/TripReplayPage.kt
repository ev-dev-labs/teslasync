// The native Jetpack Compose + Material 3 TripReplayPage driving surface — a parity port of the web page
// web/src/features/trips/pages/TripReplayPage.tsx (re-exported from web/src/features/driving/pages/TripReplayPage.tsx).
// It reproduces all six regions of the web page — the speed-coloured replay map with its playhead marker + layer
// switcher + stationary-GPS banner (§1), the playback scrubber with marker ticks (§2), the six current-position stat
// cards (§3), the elevation profile (§4), the cursor-synced speed+power timeline (§5), and the drive-summary stat strip
// (§6) — plus every data state (loading skeleton / empty / error-retry / content, including the cache-then-network
// stale/offline tier the bound holder carries) and every visible string (resolved from res/values, ADR-014).
//
// Single source of truth: the page owns one cursor — `playback.index` from [TripReplayPageViewModel] — and threads it
// through the map marker, the scrubber, the elevation cursor, and the chart cursor; the scrubber, a map-polyline click,
// and a chart tap all seek that one index, exactly like the web page's `handleSeekToIndex` wiring. SI values are
// converted to the user's units only here at the display boundary via the framework-free model helpers (Phase-48).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// stateless content + sub-components; `LongMethod`/`TooManyFunctions`/`LongParameterList` for the parity-complete set.
@file:Suppress(
    "InvalidPackageDeclaration",
    "MatchingDeclarationName",
    "TooManyFunctions",
    "LongMethod",
    "LongParameterList",
)

package io.teslasync.android.driving.tripreplay

import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.LatLng
import com.google.maps.android.compose.CameraPositionState
import com.google.maps.android.compose.Polyline
import io.teslasync.android.R
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.ChartVerticalMarker
import io.teslasync.android.components.charts.ElevationProfile
import io.teslasync.android.components.charts.MarkerSeverity
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.datadisplay.PlaybackControls
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.ChartBlockSkeleton
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.PageHeaderSkeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.maps.AnimatedVehicleMarker
import io.teslasync.android.components.maps.CameraSnapshot
import io.teslasync.android.components.maps.GeoPoint
import io.teslasync.android.components.maps.MapDotMarker
import io.teslasync.android.components.maps.MapLayerSwitcher
import io.teslasync.android.components.maps.MapMarker
import io.teslasync.android.components.maps.MapStyleId
import io.teslasync.android.components.maps.MapsGlyphs
import io.teslasync.android.components.maps.RouteSample
import io.teslasync.android.components.maps.TeslaMap
import io.teslasync.android.components.maps.VehicleMarker
import io.teslasync.android.components.maps.boundsOf
import io.teslasync.android.components.maps.formatElapsed
import io.teslasync.android.components.maps.headingAtIndex
import io.teslasync.android.components.maps.rememberMapCameraState
import io.teslasync.android.components.maps.toCameraPosition
import io.teslasync.android.components.maps.toLatLngBounds
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.android.components.maps.PlaybackState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import java.util.Locale
import kotlin.math.floor

/** The map panel height (web `TripReplayMap height={450}`, narrowed for a phone). */
private val MAP_HEIGHT = 360.dp

/** The elevation-profile height (web `ElevationProfile height={200}`). */
private val ELEVATION_HEIGHT = 200.dp

/** The speed+power timeline height (web `TripReplayCharts height={220}`). */
private val TIMELINE_HEIGHT = 220.dp

/** Stagger between the body panels' entrance fades (web `FadeIn` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** Padding (px) kept around the fitted route bounds so the trail is not clipped (maps `RoutePlayback`). */
private const val BOUNDS_PADDING_PX = 96

/** Initial map zoom before the camera fits the trail (maps `RoutePlayback` `TRAIL_ZOOM`). */
private const val TRAIL_ZOOM = 13f

/** Fallback zoom for a single-point / stationary route. */
private const val FIT_ZOOM = 15f

/** Trail polyline stroke width (maps `RoutePlayback` `TRAIL_WIDTH`). */
private const val TRAIL_WIDTH = 10f

private const val MILLIS_PER_SECOND = 1000L
private const val EM_DASH = "\u2014"

// The web's speed-segment + start/end hexes (dynamic data-viz values, not static theme tokens — the sibling
// RegenEfficiencyPage precedent). Buckets mirror the web `speedColor` ramp; the cursor matches `AnimatedMarker`.
private val SEG_GREEN = Color(0xFF10B981)
private val SEG_CYAN = Color(0xFF22D3EE)
private val SEG_AMBER = Color(0xFFF59E0B)
private val SEG_RED = Color(0xFFEF4444)
private val PLAYHEAD_COLOR = Color(0xFF00B4D8)

/** Maps a speed-color [bucket] (0..3) to its trail hex (web `speedColor`). */
private fun segmentColor(bucket: Int): Color =
    when (bucket) {
        0 -> SEG_GREEN
        1 -> SEG_CYAN
        2 -> SEG_AMBER
        else -> SEG_RED
    }

/** The page's interaction callbacks, wired to the [TripReplayPageViewModel] (web event handlers). */
data class TripReplayActions(
    val onPlay: () -> Unit,
    val onPause: () -> Unit,
    val onStop: () -> Unit,
    val onSpeedChange: (Int) -> Unit,
    val onSeekProgress: (Float) -> Unit,
    val onSeekToIndex: (Int) -> Unit,
    val onRetry: () -> Unit,
    val onBack: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [TripReplayPageViewModel] over the supplied [source] (the host wires the shared driving
 * repository + settings holder via [tripReplayPageSourceOf]) scoped to [driveId]. [logger] defaults to the app's
 * redacting logger.
 */
@Composable
fun TripReplayPage(
    source: TripReplayPageSource,
    driveId: String,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: TripReplayPageViewModel =
        viewModel(
            key = "${TripReplayPageRegistration.SLUG}:$driveId",
            factory = viewModelFactory { initializer { TripReplayPageViewModel(source, driveId, logger) } },
        )
    TripReplayPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] drive feed + playback cursor + total span + display prefs to the content. */
@Composable
fun TripReplayPage(
    viewModel: TripReplayPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val driveState by viewModel.driveState.collectAsStateWithLifecycle()
    val playback by viewModel.playback.collectAsStateWithLifecycle()
    val totalMs by viewModel.totalMs.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    val backOwner = LocalOnBackPressedDispatcherOwner.current
    val actions =
        remember(viewModel, backOwner) {
            TripReplayActions(
                onPlay = viewModel::play,
                onPause = viewModel::pause,
                onStop = viewModel::stop,
                onSpeedChange = viewModel::setSpeed,
                onSeekProgress = viewModel::seekToProgress,
                onSeekToIndex = viewModel::seekToIndex,
                onRetry = viewModel::retry,
                onBack = { backOwner?.onBackPressedDispatcher?.onBackPressed() },
            )
        }

    TripReplayPageContent(
        driveState = driveState,
        playback = playback,
        totalMs = totalMs,
        prefs = prefs,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body. A still-loading drive feed (nothing cached) renders the full-page skeleton; otherwise the
 * header is drawn, then the hard-error retry surface, the no-GPS empty surface, or the loaded six-section body.
 */
@Composable
fun TripReplayPageContent(
    driveState: UiState<DriveReplay>,
    playback: PlaybackState,
    totalMs: Long,
    prefs: UnitPref,
    actions: TripReplayActions,
    modifier: Modifier = Modifier,
) {
    if (driveState.isLoading) {
        TripReplayLoading(modifier)
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
        TripReplayHeader(drive = driveState.data, prefs = prefs, onBack = actions.onBack)

        val drive = driveState.data
        when {
            driveState.isError -> TripReplayError(onRetry = actions.onRetry)
            drive == null || drive.positions.isEmpty() -> TripReplayEmpty()
            else ->
                TripReplayLoaded(
                    drive = drive,
                    playback = playback,
                    totalMs = totalMs,
                    prefs = prefs,
                    actions = actions,
                )
        }
    }
}

/** The full-page loading skeleton shown before the first drive payload (web `PageContainer loading`). */
@Composable
private fun TripReplayLoading(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxSize().padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        PageHeaderSkeleton()
        ChartBlockSkeleton(height = MAP_HEIGHT)
        ChartBlockSkeleton(height = 56.dp)
        StatGridSkeleton(count = 3)
        ChartBlockSkeleton(height = ELEVATION_HEIGHT)
        ChartBlockSkeleton(height = TIMELINE_HEIGHT)
        StatGridSkeleton(count = 4)
    }
}

/** The page header — the title, a drive subtitle (id · date · addresses), and the Back-to-Drive action (web header). */
@Composable
private fun TripReplayHeader(
    drive: DriveReplay?,
    prefs: UnitPref,
    onBack: () -> Unit,
) {
    val locale = remember(prefs) { localeOf(prefs) }
    val driveWord = stringResource(R.string.translation_replay_drive)
    val subtitle =
        remember(drive, driveWord, locale) {
            drive?.let { buildDriveSubtitle(it, driveWord, locale) }
        }
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PageTitle(stringResource(R.string.translation_replay_title))
            if (subtitle != null) {
                BodyText(subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Button(
            label = stringResource(R.string.translation_replay_backToDrive),
            onClick = onBack,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
        )
    }
}

/** The hard-error surface for the drive feed (no cached fallback) — a retry-able error panel (web `error` prop). */
@Composable
private fun TripReplayError(onRetry: () -> Unit) {
    FadeIn {
        GlassPanel(padding = PanelPadding.Lg) {
            ErrorDisplay(
                message = stringResource(R.string.translation_error_serverError_message),
                title = stringResource(R.string.translation_error_serverError_title),
                onRetry = onRetry,
                retryLabel = stringResource(R.string.translation_common_retry),
            )
        }
    }
}

/** The no-GPS empty surface (web `<EmptyState message={t('replay.noGps', …)} />`). */
@Composable
private fun TripReplayEmpty() {
    FadeIn {
        EmptyState(
            icon = DataDisplayGlyphs.MapPin,
            message = stringResource(R.string.translation_replay_noGps),
        )
    }
}

// ── Loaded body ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The loaded six-section surface. Everything is driven off the single [playback] cursor: the map marker, the scrubber,
 * the current-stats highlight, the elevation cursor, and the chart cursor all reflect `playback.index`, and the map
 * click, the scrubber, and the chart tap all seek it back through [TripReplayActions.onSeekToIndex] / `onSeekProgress`.
 */
@Composable
private fun TripReplayLoaded(
    drive: DriveReplay,
    playback: PlaybackState,
    totalMs: Long,
    prefs: UnitPref,
    actions: TripReplayActions,
) {
    val locale = remember(prefs) { localeOf(prefs) }
    val points = drive.positions
    val markers = remember(points) { computeReplayMarkers(points) }
    val timelineMarkers = remember(markers) { markers.map { it.toTimelineMarker() } }
    val timeline = remember(points, prefs) { buildTimeline(points, prefs) }
    val elevation = remember(points, prefs) { buildElevation(points, prefs) }

    val currentIndex = playback.index
    val progress = if (totalMs > 0L) (playback.elapsedMs.toFloat() / totalMs).coerceIn(0f, 1f) else 0f
    val activeMarker = remember(markers, progress) { nearestMarker(markers, progress) }
    val point = points.getOrNull(currentIndex)

    FadeIn { TripReplayMapSection(points = points, currentIndex = currentIndex, onSeekToIndex = actions.onSeekToIndex) }

    FadeIn(delayMs = FADE_STEP_MS) {
        TripReplayScrubber(
            playback = playback,
            totalMs = totalMs,
            progress = progress,
            markers = timelineMarkers,
            actions = actions,
        )
    }

    FadeIn(delayMs = FADE_STEP_MS * 2) {
        TripReplayCurrentStats(point = point, activeKind = activeMarker?.kind, prefs = prefs, locale = locale)
    }

    FadeIn(delayMs = FADE_STEP_MS * 3) {
        GlassPanel(padding = PanelPadding.Lg) {
            ElevationProfile(
                points = elevation,
                title = stringResource(R.string.translation_replay_elevation_title),
                currentIndex = currentIndex,
                height = ELEVATION_HEIGHT,
                distanceUnit = prefs.distance.label,
                emptyMessage = stringResource(R.string.translation_replay_elevation_noData),
            )
        }
    }

    FadeIn(delayMs = FADE_STEP_MS * 4) {
        TripReplayTimelineSection(
            timeline = timeline,
            currentIndex = currentIndex,
            speedUnitLabel = prefs.speed.label,
            onSeekToIndex = actions.onSeekToIndex,
            locale = locale,
        )
    }

    FadeIn(delayMs = FADE_STEP_MS * 5) {
        TripReplayDriveSummary(drive = drive, prefs = prefs, locale = locale)
    }
}

/* §1 — Map ----------------------------------------------------------------------------------------------------- */

/**
 * The replay map — a speed-coloured route polyline, start/end dots, a heading-aware playhead marker tracking
 * [currentIndex], a layer switcher, a stationary-GPS banner, and click-to-seek. The page above remains the single
 * source of truth; the marker only reflects [currentIndex] and a map click calls back through [onSeekToIndex].
 */
@Composable
private fun TripReplayMapSection(
    points: List<ReplayPoint>,
    currentIndex: Int,
    onSeekToIndex: (Int) -> Unit,
) {
    val reduce = rememberReducedMotion()
    val samples =
        remember(points) {
            points.map { RouteSample(GeoPoint(it.latitude, it.longitude), it.timestampMs, it.speedMps, it.batteryLevel, it.power) }
        }
    val trail = remember(samples) { samples.map { it.point }.filter { it.isValid() } }
    val hasRoute = remember(points) { hasMeaningfulRoute(points) }
    val segments = remember(points) { buildRouteSegments(points) }

    val startLabel = stringResource(R.string.translation_replay_markers_start)
    val endLabel = stringResource(R.string.translation_replay_markers_stop)
    val mapDescription = stringResource(R.string.translation_replay_title)

    GlassPanel(padding = PanelPadding.None) {
        Box(modifier = Modifier.fillMaxWidth().height(MAP_HEIGHT)) {
            if (trail.isEmpty()) {
                EmptyState(
                    message = stringResource(R.string.translation_replay_map_noPositions),
                    icon = MapsGlyphs.Route,
                )
            } else {
                var style by remember { mutableStateOf(MapStyleId.Dark) }
                var mapLoaded by remember { mutableStateOf(false) }
                val camera = rememberMapCameraState(CameraSnapshot(trail.first(), TRAIL_ZOOM))

                LaunchedEffect(mapLoaded, trail) { if (mapLoaded) fitCameraToTrail(camera, trail) }

                TeslaMap(
                    modifier = Modifier.fillMaxSize(),
                    cameraPositionState = camera,
                    style = style,
                    contentDescription = mapDescription,
                    onMapLoaded = { mapLoaded = true },
                    onMapClick = { gp -> onSeekToIndex(nearestSampleIndex(points, gp.lat, gp.lng)) },
                ) {
                    if (hasRoute) {
                        segments.forEach { seg ->
                            Polyline(
                                points = seg.points.map { LatLng(it.latitude, it.longitude) },
                                color = segmentColor(seg.bucket),
                                width = TRAIL_WIDTH,
                            )
                        }
                        MapDotMarker(trail.first(), SEG_GREEN, title = startLabel)
                        MapDotMarker(trail.last(), SEG_RED, title = endLabel)
                    } else {
                        MapDotMarker(trail.first(), PLAYHEAD_COLOR, title = startLabel)
                    }

                    samples.getOrNull(currentIndex)?.let { cur ->
                        if (reduce) {
                            VehicleMarker(
                                MapMarker(id = "cursor", point = cur.point, headingDegrees = headingAtIndex(samples, currentIndex)),
                            )
                        } else {
                            AnimatedVehicleMarker(target = cur.point, headingDegrees = headingAtIndex(samples, currentIndex))
                        }
                    }
                }

                MapLayerSwitcher(
                    current = style,
                    onChange = { style = it },
                    modifier = Modifier.align(Alignment.BottomStart).padding(Spacing.sm),
                )

                if (!hasRoute) {
                    AlertBanner(
                        message = stringResource(R.string.translation_replay_map_stationaryRouteBody),
                        modifier = Modifier.align(Alignment.TopCenter).padding(Spacing.sm),
                        tone = Tone.Info,
                        title = stringResource(R.string.translation_replay_map_stationaryRouteTitle),
                        icon = MapsGlyphs.Navigation,
                    )
                }
            }
        }
    }
}

private suspend fun fitCameraToTrail(
    camera: CameraPositionState,
    trail: List<GeoPoint>,
) {
    val bounds = boundsOf(trail)
    if (bounds != null && trail.size > 1) {
        runCatching {
            camera.animate(CameraUpdateFactory.newLatLngBounds(bounds.toLatLngBounds(), BOUNDS_PADDING_PX))
        }
    } else {
        camera.position = CameraSnapshot(trail.first(), FIT_ZOOM).toCameraPosition()
    }
}

/* §2 — Playback scrubber --------------------------------------------------------------------------------------- */

/** The playback transport + marker-tick scrubber (web `<PlaybackControls>`), driven by the page's [playback] cursor. */
@Composable
private fun TripReplayScrubber(
    playback: PlaybackState,
    totalMs: Long,
    progress: Float,
    markers: List<io.teslasync.android.components.datadisplay.TimelineMarker>,
    actions: TripReplayActions,
) {
    PlaybackControls(
        isPlaying = playback.playing,
        speed = playback.speed,
        progress = progress,
        elapsed = formatElapsed(playback.elapsedMs),
        total = formatElapsed(totalMs),
        onPlay = actions.onPlay,
        onPause = actions.onPause,
        onStop = actions.onStop,
        onSpeedChange = actions.onSpeedChange,
        onSeek = actions.onSeekProgress,
        markers = markers,
        durationSeconds = (totalMs / MILLIS_PER_SECOND).toInt(),
        resetLabel = stringResource(R.string.translation_replay_controls_reset),
        playLabel = stringResource(R.string.translation_replay_controls_play),
        pauseLabel = stringResource(R.string.translation_replay_controls_pause),
        stopLabel = stringResource(R.string.translation_replay_controls_stop),
    )
}

/* §3 — Current position stats ---------------------------------------------------------------------------------- */

/** The six current-position stat cards, highlighted (accent pop) when the playhead is "over" a relevant marker. */
@Composable
private fun TripReplayCurrentStats(
    point: ReplayPoint?,
    activeKind: ReplayMarkerKind?,
    prefs: UnitPref,
    locale: Locale,
) {
    val base = MaterialTheme.colorScheme.primary
    val highlight = MaterialTheme.colorScheme.tertiary
    fun accent(kinds: Set<ReplayMarkerKind>): Color = if (activeKind != null && activeKind in kinds) highlight else base

    GlassPanel(padding = PanelPadding.Lg) {
        PanelTitle(stringResource(R.string.translation_replay_currentStats))
        Spacer(Modifier.height(Spacing.sm))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_replay_stat_speed),
                value = statSpeed(point, prefs, locale),
                icon = DataDisplayGlyphs.Gauge,
                accent = accent(setOf(ReplayMarkerKind.FastSegment)),
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_replay_stat_power),
                value = statPower(point, locale),
                icon = DataDisplayGlyphs.Bolt,
                accent = accent(setOf(ReplayMarkerKind.RegenPeak, ReplayMarkerKind.ChargeStart, ReplayMarkerKind.ChargeStop)),
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_replay_stat_battery),
                value = statBattery(point, locale),
                icon = DataDisplayGlyphs.Battery,
                accent = accent(setOf(ReplayMarkerKind.LowSoc, ReplayMarkerKind.ChargeStart, ReplayMarkerKind.ChargeStop)),
            )
        }
        Spacer(Modifier.height(Spacing.sm))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_replay_stat_elevation),
                value = statElevation(point, locale),
                icon = MapsGlyphs.Route,
                accent = base,
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_replay_stat_range),
                value = statRange(point, prefs, locale),
                icon = MapsGlyphs.Navigation,
                accent = base,
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_replay_stat_temp),
                value = statTemp(point, prefs, locale),
                icon = DataDisplayGlyphs.Snowflake,
                accent = base,
            )
        }
    }
}

/* §5 — Speed + power timeline ---------------------------------------------------------------------------------- */

/** The cursor-synced speed+power area chart; a tap anywhere on the plot seeks the replay (web `<TripReplayCharts>`). */
@Composable
private fun TripReplayTimelineSection(
    timeline: List<TimelinePoint>,
    currentIndex: Int,
    speedUnitLabel: String,
    onSeekToIndex: (Int) -> Unit,
    locale: Locale,
) {
    val speedColor = TeslaTokens.chart.speed
    val powerColor = TeslaTokens.chart.power
    val speedLabel = stringResource(R.string.translation_replay_timeline_speed)
    val powerLabel = stringResource(R.string.translation_replay_timeline_power)
    val seekLabel = stringResource(R.string.translation_replay_timeline_subtitle)

    val series =
        remember(timeline, speedLabel, powerLabel, speedUnitLabel, speedColor, powerColor) {
            listOf(
                ChartSeries(
                    key = "speed",
                    label = "$speedLabel ($speedUnitLabel)",
                    values = timeline.map { it.speed },
                    kind = ChartSeriesKind.Area,
                    color = speedColor,
                    unit = speedUnitLabel,
                ),
                ChartSeries(
                    key = "power",
                    label = "$powerLabel (kW)",
                    values = timeline.map { it.power },
                    kind = ChartSeriesKind.Area,
                    color = powerColor,
                    unit = "kW",
                ),
            )
        }
    val xLabels = remember(timeline, locale) { timeline.map { ChartFormat.number(it.timeMin, 0, locale) } }
    val markers =
        remember(currentIndex, timeline, locale) {
            if (currentIndex in timeline.indices) {
                listOf(
                    ChartVerticalMarker(
                        index = currentIndex,
                        label = "${ChartFormat.number(timeline[currentIndex].timeMin, 0, locale)}m",
                        severity = MarkerSeverity.Info,
                    ),
                )
            } else {
                emptyList()
            }
        }
    val status = if (timeline.isEmpty()) ChartStatus.Empty else ChartStatus.Ready

    ChartContainer(
        title = stringResource(R.string.translation_replay_timeline_title),
        subtitle = stringResource(R.string.translation_replay_timeline_subtitle),
        status = status,
        height = TIMELINE_HEIGHT,
        accessibleDescription = stringResource(R.string.translation_replay_timeline_aria),
        emptyMessage = stringResource(R.string.translation_replay_timeline_noData),
    ) {
        Box(modifier = Modifier.fillMaxWidth()) {
            AreaChartWrapper(
                series = series,
                xLabels = xLabels,
                height = TIMELINE_HEIGHT,
                markers = markers,
                yValueFormatter = { ChartFormat.number(it, 0, locale) },
            )
            Box(
                modifier =
                    Modifier
                        .matchParentSize()
                        .semantics {
                            contentDescription = seekLabel
                            role = Role.Button
                        }.pointerInput(timeline) {
                            detectTapGestures { offset ->
                                seekTargetAt(offset.x, size.width, timeline)?.let(onSeekToIndex)
                            }
                        },
            )
        }
    }
}

/** Maps a horizontal tap [x] over a plot of [width] px to the underlying position index, or `null` when empty. */
private fun seekTargetAt(
    x: Float,
    width: Int,
    timeline: List<TimelinePoint>,
): Int? {
    if (width <= 0 || timeline.isEmpty()) return null
    val fraction = (x / width).coerceIn(0f, 1f)
    val idx = floor(fraction * timeline.size).toInt().coerceIn(0, timeline.lastIndex)
    return timeline[idx].index
}

/* §6 — Drive summary ------------------------------------------------------------------------------------------- */

/** The drive-summary stat strip — distance, duration, efficiency, and the elevation gain/loss cells (web §6). */
@Composable
private fun TripReplayDriveSummary(
    drive: DriveReplay,
    prefs: UnitPref,
    locale: Locale,
) {
    val efficiencyPresent = summaryEfficiency(drive, prefs) != null
    GlassPanel(padding = PanelPadding.Lg) {
        PanelTitle(stringResource(R.string.translation_replay_summary_title))
        Spacer(Modifier.height(Spacing.sm))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_replay_summary_distance),
                value = summaryDistanceValue(drive, prefs, locale),
                unit = prefs.distance.label,
                icon = MapsGlyphs.Route,
            )
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_replay_summary_duration),
                value = summaryDurationValue(drive),
                icon = DataDisplayGlyphs.Clock,
            )
        }
        Spacer(Modifier.height(Spacing.sm))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_replay_summary_efficiency),
                value = summaryEfficiencyValue(drive, prefs, locale),
                unit = if (efficiencyPresent) "Wh/km" else null,
                icon = DataDisplayGlyphs.Bolt,
            )
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_replay_summary_elevGain),
                value = EM_DASH,
                icon = DataDisplayGlyphs.ArrowUp,
            )
        }
        Spacer(Modifier.height(Spacing.sm))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_replay_summary_elevLoss),
                value = EM_DASH,
                icon = DataDisplayGlyphs.ArrowDown,
            )
            Spacer(Modifier.weight(1f))
        }
    }
}

/** Builds the header subtitle "Drive #id — date · start → end" (web `PageContainer subtitle`). */
private fun buildDriveSubtitle(
    drive: DriveReplay,
    driveWord: String,
    locale: Locale,
): String =
    buildString {
        append(driveWord)
        append(" #")
        append(drive.driveId)
        summaryDate(drive.startTsMs, locale)?.let {
            append(" \u2014 ")
            append(it)
        }
        if (!drive.startAddress.isNullOrBlank() && !drive.endAddress.isNullOrBlank()) {
            append(" \u00B7 ")
            append(drive.startAddress)
            append(" \u2192 ")
            append(drive.endAddress)
        }
    }
