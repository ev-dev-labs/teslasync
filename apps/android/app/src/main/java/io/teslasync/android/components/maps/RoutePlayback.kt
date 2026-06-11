package io.teslasync.android.components.maps

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.maps.android.compose.Polyline
import io.teslasync.android.components.datadisplay.PlaybackControls
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.ui.theme.generated.Spacing
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

/*
 * Self-contained route-replay widget — the Android counterpart of the web `RoutePlayback`.
 * Renders a map with the GPS trail polyline, start / end dots, a heading-aware vehicle marker at
 * the scrub cursor, an optional layer switcher and playback bar (reusing the shared
 * `PlaybackControls`), a position chip, and an accessible route summary. The replay clock is the
 * unit-tested `PlaybackState` machine; reduced motion is honored by the marker layer.
 */

private const val TICK_MS = 50
private const val TRAIL_WIDTH = 10f
private const val BOUNDS_PADDING_PX = 96
private const val FIT_ZOOM = 15f
private const val TRAIL_ZOOM = 13f

/**
 * Plays back [samples] on an interactive map. [onCursorChange] fires as the cursor moves so a
 * page can sync a chart cursor; metric formatting (units) stays the page's responsibility.
 */
@Composable
fun RoutePlayback(
    samples: List<RouteSample>,
    modifier: Modifier = Modifier,
    heightDp: Int = 360,
    initialStyle: MapStyleId = MapStyleId.Dark,
    showLayerSwitcher: Boolean = true,
    showControls: Boolean = true,
    showSummary: Boolean = true,
    autoPlay: Boolean = false,
    emptyMessage: String = "No GPS points to replay for this route.",
    mapContentDescription: String = "Route playback map",
    summaryLabel: String = "Route",
    startLabel: String = "Start",
    endLabel: String = "End",
    onCursorChange: (RouteSample, Int) -> Unit = { _, _ -> },
) {
    val trail = remember(samples) { samples.map { it.point }.filter { it.isValid() } }
    if (trail.isEmpty()) {
        GlassPanel(modifier = modifier) {
            EmptyState(message = emptyMessage, icon = MapsGlyphs.Route)
        }
        return
    }
    val offsets = remember(samples) { routeOffsetsMs(samples) }
    val total = remember(offsets) { playbackTotalMs(offsets) }
    var style by remember { mutableStateOf(initialStyle) }
    var state by remember(samples) { mutableStateOf(PlaybackState(playing = autoPlay && samples.size > 1)) }
    var mapLoaded by remember { mutableStateOf(false) }
    val camera = rememberMapCameraState(CameraSnapshot(trail.first(), TRAIL_ZOOM))

    LaunchedEffect(state.playing, state.speed, offsets) {
        while (state.playing && isActive) {
            delay(TICK_MS.toLong())
            state = playbackTick(state, offsets, TICK_MS)
        }
    }
    LaunchedEffect(state.index, samples) {
        samples.getOrNull(state.index)?.let { onCursorChange(it, state.index) }
    }
    LaunchedEffect(mapLoaded, trail) {
        if (mapLoaded) fitCameraToTrail(camera, trail)
    }

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        GlassPanel(padding = PanelPadding.None) {
            Box(modifier = Modifier.fillMaxWidth().height(heightDp.dp)) {
                TeslaMap(
                    modifier = Modifier.fillMaxSize(),
                    cameraPositionState = camera,
                    style = style,
                    contentDescription = mapContentDescription,
                    onMapLoaded = { mapLoaded = true },
                ) {
                    Polyline(points = trail.map { it.toLatLng() }, color = routeTrailColor(), width = TRAIL_WIDTH)
                    MapDotMarker(trail.first(), routeStartColor(), title = startLabel)
                    if (trail.size > 1) MapDotMarker(trail.last(), routeEndColor(), title = endLabel)
                    samples.getOrNull(state.index)?.let { cur ->
                        VehicleMarker(
                            MapMarker(
                                id = "cursor",
                                point = cur.point,
                                headingDegrees = headingAtIndex(samples, state.index),
                            ),
                        )
                    }
                }
                if (showLayerSwitcher) {
                    MapLayerSwitcher(
                        current = style,
                        onChange = { style = it },
                        modifier = Modifier.align(Alignment.BottomStart).padding(Spacing.sm),
                    )
                }
                PositionChip(
                    index = state.index,
                    count = samples.size,
                    elapsed = formatElapsed(state.elapsedMs),
                    modifier = Modifier.align(Alignment.TopEnd).padding(Spacing.sm),
                )
            }
        }
        if (showControls) {
            PlaybackControls(
                isPlaying = state.playing,
                speed = state.speed,
                progress = playbackProgress(state, offsets),
                elapsed = formatElapsed(state.elapsedMs),
                total = formatElapsed(total),
                onPlay = { state = playbackPlay(state, offsets) },
                onPause = { state = playbackPause(state) },
                onStop = { state = playbackStop(state) },
                onSpeedChange = { state = playbackSetSpeed(state, it) },
                onSeek = { state = playbackSeek(state, offsets, it) },
                durationSeconds = (total / MILLIS_PER_SECOND).toInt(),
            )
        }
        if (showSummary) {
            MapAccessibleSummary(label = summaryLabel, lines = listOf(routeSummaryLine(samples)))
        }
    }
}

@Composable
private fun PositionChip(
    index: Int,
    count: Int,
    elapsed: String,
    modifier: Modifier = Modifier,
) {
    StatusPill(text = "${index + 1}/$count  ·  $elapsed", modifier = modifier)
}

private suspend fun fitCameraToTrail(
    camera: com.google.maps.android.compose.CameraPositionState,
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

private const val MILLIS_PER_SECOND = 1000L
