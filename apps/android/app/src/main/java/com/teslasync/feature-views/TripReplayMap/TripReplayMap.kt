// The native Jetpack Compose + Material 3 TripReplayMap feature view — a parity port of
// web/src/features/trips/components/TripReplayMap.tsx. The web component is a thin wrapper around the trip-replay
// Leaflet map: one fixed-height (450 px) translucent panel carrying a speed-coloured polyline (four bands), a
// green start dot, a red end dot, a base-layer switcher, and a heading-aware playhead marker that tracks the
// page's `currentIndex` (animated, or a snap-on-reduced-motion dot); clicking the route seeks the page's
// scrubber to the nearest sample. When the recorded GPS is a single stationary cluster it drops one anchor
// marker and overlays an explanatory banner instead of a polyline; when there are no positions it shows a
// friendly empty state.
//
// The surface binds NO data hook of its own (web parity — the component's only hooks are `useTranslation` and
// `useMap`): the TripReplayPage owns the drive query + the `useTripReplay` scrubber and threads the samples in as
// a [TripReplayMapSnapshot] carried on the shared cache-then-network [UiState] (P1/S8), plus the interactive
// `currentIndex` / `onSeekToIndex` / `reduceMotion` the page controls. So this view also renders every lifecycle
// state that layer can carry (a loading skeleton, a hard error + retry, the content map, and a stale/offline
// "last known" freshness chip) without ever fetching, exactly like the sibling RouteMapSection port. Every
// derivation flows through the pure [TripReplayMapProjection]; the composable is a thin render layer that
// resolves the i18n labels (P1/S10), maps each [SpeedBand] to its `TeslaTokens.status` colour (P1/S9), and draws
// what the projection returns. `useMap`'s FitBounds is reproduced as a camera bounds-fit on map load.
//
// Colour mapping (P1/S9 tokens, no ported Tailwind / no raw hex): the four web hex speed colours map to the
// per-theme `TeslaTokens.status` palette — emerald `#10b981` → `status.success`, cyan `#22d3ee` → `status.info`,
// amber `#f59e0b` → `status.warning`, red `#ef4444` → `status.danger`. The start/end dots reuse the shared
// `routeStartColor()` / `routeEndColor()` (success / danger); the stationary anchor uses `status.info`; the
// playhead uses the brand `colorScheme.primary` (the "active vehicle" colour the maps layer's own RoutePlayback
// cursor uses), so all read correctly in light, dark, and high-contrast themes.
//
// Map rendering: the base map is the shared `TeslaMap` wrapper, the start/end/anchor dots are the shared
// `MapDotMarker`, the playhead is the shared `AnimatedVehicleMarker` (which honours reduced motion by snapping)
// or, under the `reduceMotion` flag, a static `MapDotMarker`; the base-layer control is the shared
// `MapLayerSwitcher`, and the opaque map is paired with a `MapAccessibleSummary` list alternative. The
// speed-coloured trail is drawn with Google Maps Compose `Polyline` directly inside the `TeslaMap` content slot —
// exactly as the sibling RouteMapSection + the maps layer's own RoutePlayback do — because the maps layer ships
// no multi-colour polyline wrapper and extending `components/maps` is out of this surface's scope (atomic shared
// components are a separate prompt). The web polyline-`click` → nearest-sample seek is wired through the map's
// tap handler (`onMapClick`), because the maps SDK's `Polyline` click does not surface the tapped coordinate; the
// same `nearestSampleIndex` scan the web uses resolves the tap to a scrubber index. The one-shot PII-safe
// `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TripReplayMap — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.tripreplaymap

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.maps.android.compose.CameraPositionState
import com.google.maps.android.compose.Polyline
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.maps.AnimatedVehicleMarker
import io.teslasync.android.components.maps.CameraSnapshot
import io.teslasync.android.components.maps.MapAccessibleSummary
import io.teslasync.android.components.maps.MapDotMarker
import io.teslasync.android.components.maps.MapLayerSwitcher
import io.teslasync.android.components.maps.MapStyleId
import io.teslasync.android.components.maps.MapsGlyphs
import io.teslasync.android.components.maps.TeslaMap
import io.teslasync.android.components.maps.boundsOf
import io.teslasync.android.components.maps.rememberMapCameraState
import io.teslasync.android.components.maps.routeEndColor
import io.teslasync.android.components.maps.routeStartColor
import io.teslasync.android.components.maps.toCameraPosition
import io.teslasync.android.components.maps.toLatLng
import io.teslasync.android.components.maps.toLatLngBounds
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** The web `height={450}` map default, reproduced 1:1. */
private val MAP_HEIGHT: Dp = 450.dp

/** Loading skeleton header-bar height. */
private val SKELETON_HEADER_HEIGHT: Dp = 20.dp

/** Web `weight: 4` Leaflet polyline stroke, in device pixels (scaled for the denser native map). */
private const val TRAIL_WIDTH: Float = 8f

/** Web `opacity: 0.8` polyline alpha. */
private const val TRAIL_ALPHA: Float = 0.8f

/** Bounds-fit camera padding in pixels (the web FitBounds `padding: [40, 40]`, scaled for the denser map). */
private const val BOUNDS_PADDING_PX: Int = 72

/**
 * Stateful entry point — the faithful port of the web `TripReplayMap({ positions, currentIndex, onSeekToIndex,
 * reduceMotion })`. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11) on first composition and
 * renders every lifecycle [state] the shared drive feed can carry. The host (the Trip Replay page) owns the feed
 * + the scrubber (P1/S8) and supplies [currentIndex] (the scrub cursor), [onSeekToIndex] (the scrubber seek), and
 * [onRetry] (the feed's refetch); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the [TripReplayMapSnapshot] the page holds.
 * @param currentIndex the scrubber cursor the playhead tracks (web `currentIndex`).
 * @param onSeekToIndex seeks the page scrubber to the sample nearest a route tap (web `onSeekToIndex`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale/offline refresh.
 * @param reduceMotion when true the playhead snaps (a static dot) instead of animating (web `reduceMotion`).
 * @param initialMapStyle the base-map style the layer switcher starts on (web `initialMapStyle`, default dark).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun TripReplayMap(
    state: UiState<TripReplayMapSnapshot>,
    currentIndex: Int,
    onSeekToIndex: (Int) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    reduceMotion: Boolean = false,
    initialMapStyle: MapStyleId = MapStyleId.Dark,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { TripReplayMapDiagnostics.recordViewOpened(logger) }
    TripReplayMapContent(
        state = state,
        currentIndex = currentIndex,
        onSeekToIndex = onSeekToIndex,
        onRetry = onRetry,
        modifier = modifier,
        reduceMotion = reduceMotion,
        initialMapStyle = initialMapStyle,
    )
}

/**
 * Web-parity convenience overload for a host that already holds a [TripReplayMapSnapshot] (the web `{ positions,
 * … }` props): projects it onto a content [UiState] and renders. Useful for embedding without the
 * cache-then-network lifecycle plumbing.
 */
@Composable
fun TripReplayMap(
    snapshot: TripReplayMapSnapshot,
    currentIndex: Int,
    onSeekToIndex: (Int) -> Unit,
    modifier: Modifier = Modifier,
    reduceMotion: Boolean = false,
    initialMapStyle: MapStyleId = MapStyleId.Dark,
    logger: Logger = LocalDataContainer.current.logger,
) {
    TripReplayMap(
        state = TripReplayMapProjection.projectUiState(snapshot, isLoading = false),
        currentIndex = currentIndex,
        onSeekToIndex = onSeekToIndex,
        onRetry = {},
        modifier = modifier,
        reduceMotion = reduceMotion,
        initialMapStyle = initialMapStyle,
        logger = logger,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Short-circuits to the
 * loading skeleton or the hard-error retry surface; otherwise renders the panel with the freshness header over
 * the replay map (the speed-coloured trail + start/end dots + playhead, or the stationary anchor + banner) and
 * the accessible-summary list, or the friendly "No position data available for this drive" empty state.
 */
@Composable
fun TripReplayMapContent(
    state: UiState<TripReplayMapSnapshot>,
    currentIndex: Int,
    onSeekToIndex: (Int) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    reduceMotion: Boolean = false,
    initialMapStyle: MapStyleId = MapStyleId.Dark,
) {
    val strings = rememberTripReplayMapStrings()
    when {
        state.isLoading -> LoadingChrome(modifier)
        state.isError -> ErrorChrome(kind = state.toQueryErrorKind(), onRetry = onRetry, modifier = modifier)
        else -> {
            val snapshot = state.data
            val display = remember(snapshot, strings) { snapshot?.let { TripReplayMapProjection.project(it, strings) } }
            TripReplayMapPanel(
                state = state,
                display = display,
                positions = snapshot?.positions ?: emptyList(),
                currentIndex = currentIndex,
                onSeekToIndex = onSeekToIndex,
                onRetry = onRetry,
                strings = strings,
                reduceMotion = reduceMotion,
                initialMapStyle = initialMapStyle,
                modifier = modifier,
            )
        }
    }
}

@Composable
private fun TripReplayMapPanel(
    state: UiState<TripReplayMapSnapshot>,
    display: TripReplayMapDisplay?,
    positions: List<ReplayPosition>,
    currentIndex: Int,
    onSeekToIndex: (Int) -> Unit,
    onRetry: () -> Unit,
    strings: TripReplayMapStrings,
    reduceMotion: Boolean,
    initialMapStyle: MapStyleId,
    modifier: Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.None) {
        Column(modifier = Modifier.fillMaxWidth().padding(Spacing.md)) {
            TripReplayMapHeader(
                title = strings.routeLabel,
                fetchedAtMillis = state.fetchedAt,
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                onRefresh = onRetry,
            )
        }
        if (display != null && display.hasPositions) {
            TripReplayMapBody(
                display = display,
                positions = positions,
                currentIndex = currentIndex,
                onSeekToIndex = onSeekToIndex,
                strings = strings,
                reduceMotion = reduceMotion,
                initialMapStyle = initialMapStyle,
            )
            MapAccessibleSummary(
                label = strings.routeLabel,
                lines = display.summaryLines,
                modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.sm),
            )
        } else {
            TripReplayMapEmpty(message = strings.noPositions)
        }
    }
}

/**
 * The freshness + refresh header — the native chrome that hosts the state-matrix affordances the web headerless
 * map omits (the web TripReplayPage owns the feed + its error/refresh). Shows the route icon + the localized
 * "Trip Replay" title, the freshness chip (which surfaces the stale / offline state), and the refresh control.
 * `internal` so the title + TalkBack labels are asserted in the UI test without a live base map (which needs Play
 * Services).
 */
@Composable
internal fun TripReplayMapHeader(
    title: String,
    fetchedAtMillis: Long?,
    isFetching: Boolean,
    isStale: Boolean,
    isError: Boolean,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val formatAge = rememberFreshnessFormatter()
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(MapsGlyphs.Route, contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.primary)
        PanelTitle(title, modifier = Modifier.weight(1f).semantics { heading() })
        DataFreshness(
            updatedAtMillis = fetchedAtMillis?.takeIf { it > 0 },
            isFetching = isFetching,
            isStale = isStale,
            isError = isError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_freshness_updating),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = formatAge,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !isFetching,
            size = IconSize.Sm,
        )
    }
}

/**
 * The live base map — the native analogue of the web `<MapContainer>`. Carries the speed-coloured trail polylines
 * + the green start / red end dots and the heading-aware playhead (a meaningful route), or the single anchor +
 * the stationary-route banner overlay. The camera fits the trail bounds once the map loads (the web FitBounds);
 * tapping the map seeks the page scrubber to the nearest sample (the web polyline `click`). The base-layer
 * switcher overlays a corner. The opaque map node carries the accessible route name. The maps SDK is reached only
 * for the multi-colour polylines (no shared wrapper exists; see the file header).
 */
@Composable
private fun TripReplayMapBody(
    display: TripReplayMapDisplay,
    positions: List<ReplayPosition>,
    currentIndex: Int,
    onSeekToIndex: (Int) -> Unit,
    strings: TripReplayMapStrings,
    reduceMotion: Boolean,
    initialMapStyle: MapStyleId,
    modifier: Modifier = Modifier,
) {
    var mapStyle by remember { mutableStateOf(initialMapStyle) }
    val camera = rememberMapCameraState(CameraSnapshot(display.center, display.zoom))
    var mapLoaded by remember { mutableStateOf(false) }
    val startColor = routeStartColor()
    val endColor = routeEndColor()
    val anchorColor = TeslaTokens.status.info
    val playheadColor = MaterialTheme.colorScheme.primary
    val palette = rememberSpeedBandPalette()
    val currentLabel = stringResource(R.string.translation_replay_currentStats)
    val currentPoint =
        remember(positions, currentIndex, display.hasRoute) {
            TripReplayMapProjection.currentPoint(positions, currentIndex, display.hasRoute)
        }
    val heading =
        remember(positions, currentIndex, display.hasRoute) {
            TripReplayMapProjection.headingForIndex(positions, currentIndex, display.hasRoute)
        }

    LaunchedEffect(mapLoaded, display.trail) {
        if (mapLoaded) fitReplayCamera(camera, display)
    }

    Box(modifier = modifier.fillMaxWidth().height(MAP_HEIGHT)) {
        TeslaMap(
            modifier = Modifier.fillMaxSize(),
            cameraPositionState = camera,
            style = mapStyle,
            contentDescription = strings.routeLabel,
            onMapClick = { point ->
                if (positions.isNotEmpty()) {
                    onSeekToIndex(TripReplayMapProjection.nearestSampleIndex(positions, point.lat, point.lng))
                }
            },
            onMapLoaded = { mapLoaded = true },
        ) {
            if (display.hasRoute) {
                display.segments.forEach { segment ->
                    Polyline(
                        points = segment.points.map { it.toLatLng() },
                        color = (palette[segment.band] ?: startColor).copy(alpha = TRAIL_ALPHA),
                        width = TRAIL_WIDTH,
                    )
                }
                display.startPos?.let { MapDotMarker(point = it, color = startColor, title = strings.start) }
                display.endPos?.let { MapDotMarker(point = it, color = endColor, title = strings.end) }
            } else {
                display.anchorPoint?.let { MapDotMarker(point = it, color = anchorColor, title = strings.routeLabel) }
            }
            if (currentPoint != null) {
                if (reduceMotion) {
                    MapDotMarker(point = currentPoint, color = playheadColor, title = currentLabel)
                } else {
                    AnimatedVehicleMarker(target = currentPoint, headingDegrees = heading, title = currentLabel)
                }
            }
        }
        MapLayerSwitcher(
            current = mapStyle,
            onChange = { mapStyle = it },
            modifier = Modifier.align(Alignment.BottomStart).padding(Spacing.sm),
        )
        if (!display.hasRoute) {
            AlertBanner(
                message = strings.stationaryBody,
                tone = Tone.Info,
                title = strings.stationaryTitle,
                icon = MapsGlyphs.Navigation,
                modifier = Modifier.align(Alignment.TopCenter).padding(Spacing.sm),
            )
        }
    }
}

@Composable
private fun TripReplayMapEmpty(
    message: String,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier.fillMaxWidth().height(MAP_HEIGHT),
        contentAlignment = Alignment.Center,
    ) {
        EmptyState(message = message, icon = MapsGlyphs.Map)
    }
}

@Composable
private fun LoadingChrome(modifier: Modifier = Modifier) {
    val label = stringResource(R.string.translation_common_loading)
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(height = SKELETON_HEADER_HEIGHT, rounded = true)
        Skeleton(height = MAP_HEIGHT, rounded = true)
    }
}

@Composable
private fun ErrorChrome(
    kind: QueryErrorKind,
    onRetry: () -> Unit,
    modifier: Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        QueryError(kind = kind, onRetry = onRetry, modifier = Modifier.fillMaxWidth())
    }
}

/** Resolves the four [SpeedBand] line colours from the per-theme `TeslaTokens.status` palette (P1/S9). */
@Composable
private fun rememberSpeedBandPalette(): Map<SpeedBand, Color> {
    val status = TeslaTokens.status
    return remember(status) {
        mapOf(
            SpeedBand.Low to status.success,
            SpeedBand.Moderate to status.info,
            SpeedBand.Fast to status.warning,
            SpeedBand.VeryFast to status.danger,
        )
    }
}

/**
 * Builds the localized [TripReplayMapStrings] from the i18n catalog (P1/S10) — the `replay.*` keys the web
 * component uses (the "Trip Replay" map label, the start/end marker labels, the stationary-route banner head +
 * body, and the empty-state message).
 */
@Composable
private fun rememberTripReplayMapStrings(): TripReplayMapStrings {
    val routeLabel = stringResource(R.string.translation_replay_title)
    val start = stringResource(R.string.translation_replay_markers_start)
    val end = stringResource(R.string.translation_replay_markers_stop)
    val stationaryTitle = stringResource(R.string.translation_replay_map_stationaryRouteTitle)
    val stationaryBody = stringResource(R.string.translation_replay_map_stationaryRouteBody)
    val noPositions = stringResource(R.string.translation_replay_map_noPositions)
    return remember(routeLabel, start, end, stationaryTitle, stationaryBody, noPositions) {
        TripReplayMapStrings(
            routeLabel = routeLabel,
            start = start,
            end = end,
            stationaryTitle = stationaryTitle,
            stationaryBody = stationaryBody,
            noPositions = noPositions,
        )
    }
}

/**
 * The `translation_freshness_*`-backed relative-time formatter shared with the freshness chip's TalkBack
 * description, so the header microcopy stays localized (ADR-014).
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
                FreshnessAge.Unknown -> TRIP_REPLAY_EM_DASH
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

/** Maps the [UiState] failure classification onto the shared [QueryErrorKind] recovery copy. */
private fun UiState<*>.toQueryErrorKind(): QueryErrorKind =
    when (errorKind) {
        ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
        ErrorKind.Http -> classifyQueryError(status = httpStatus, online = true, transientWaiting = false)
        ErrorKind.Decode -> QueryErrorKind.ServerError
        null, ErrorKind.Unknown -> QueryErrorKind.Network
    }

/**
 * Fits the camera to the route — the web FitBounds: a multi-point meaningful route frames the whole trail's
 * bounds; otherwise the camera centres on the start (or the stationary anchor) at the close-up zoom, or on the
 * computed centre when nothing renders.
 */
private suspend fun fitReplayCamera(
    camera: CameraPositionState,
    display: TripReplayMapDisplay,
) {
    if (display.trail.size > 1) {
        val bounds = boundsOf(display.trail)
        if (bounds != null) {
            runCatching {
                camera.animate(CameraUpdateFactory.newLatLngBounds(bounds.toLatLngBounds(), BOUNDS_PADDING_PX))
            }
            return
        }
    }
    val focus = display.startPos ?: display.anchorPoint
    camera.position =
        if (focus != null) {
            CameraSnapshot(focus, REPLAY_FIT_ZOOM).toCameraPosition()
        } else {
            CameraSnapshot(display.center, display.zoom).toCameraPosition()
        }
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_ROUTE =
    TripReplayMapSnapshot(
        positions =
            listOf(
                ReplayPosition(47.610, -122.330, 5.0),
                ReplayPosition(47.612, -122.333, 18.0),
                ReplayPosition(47.615, -122.338, 30.0),
                ReplayPosition(47.620, -122.345, 46.0),
            ),
    )

private val PREVIEW_STATIONARY =
    TripReplayMapSnapshot(
        positions =
            listOf(
                ReplayPosition(47.610, -122.330, 0.0),
                ReplayPosition(47.610001, -122.330001, 0.0),
            ),
    )

@Preview(name = "Loading")
@Composable
private fun PreviewLoading() = PreviewSurface(UiState(UiPhase.Loading), currentIndex = 0)

@Preview(name = "Empty")
@Composable
private fun PreviewEmpty() = PreviewSurface(UiState(UiPhase.Empty, data = TripReplayMapSnapshot()), currentIndex = 0)

@Preview(name = "Error")
@Composable
private fun PreviewError() = PreviewSurface(UiState(UiPhase.Error, errorKind = ErrorKind.Network), currentIndex = 0)

@Preview(name = "Route — content", showBackground = true, widthDp = 360)
@Composable
private fun PreviewRoute() = PreviewSurface(UiState(UiPhase.Content, data = PREVIEW_ROUTE, fetchedAt = 1L), currentIndex = 1)

@Preview(name = "Stationary — content", showBackground = true, widthDp = 360)
@Composable
private fun PreviewStationary() = PreviewSurface(UiState(UiPhase.Content, data = PREVIEW_STATIONARY, fetchedAt = 1L), currentIndex = 0)

@Composable
private fun PreviewSurface(
    state: UiState<TripReplayMapSnapshot>,
    currentIndex: Int,
) {
    TeslaSyncTheme(dynamicColor = false) {
        TripReplayMapContent(state = state, currentIndex = currentIndex, onSeekToIndex = {}, onRetry = {})
    }
}
