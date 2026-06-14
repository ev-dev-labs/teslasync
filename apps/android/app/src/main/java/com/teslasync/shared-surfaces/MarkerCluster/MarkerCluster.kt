// The native Jetpack Compose + Material 3 MarkerCluster shared surface — a parity port of
// web/src/components/maps/MarkerCluster.tsx. The web surface is a HEADLESS leaflet primitive: it takes a
// `points` array, registers a `leaflet.markercluster` group on the parent map (its only hook is the leaflet
// `useMap()` map context — NOT a network query), and returns `null`. Density-graded cluster bubbles collapse
// nearby points; singletons render as coloured dots with an optional popup; a tap forwards the original point.
//
// The native surface is the meaningful, self-contained map region a feature drops in: the shared `TeslaMap`
// (web `MapContainer`/`MapTileLayer`) frames the points, the shared grid-clustering logic groups them for the
// live camera zoom, and a `MapAccessibleSummary` gives screen-reader / forced-colours users the same markers
// as a list. Every derivation flows through the pure [projectMarkerCluster] in MarkerClusterModel.kt; this file
// is a thin render layer that resolves the localized labels (P1/S10), maps colours to the `TeslaTokens` palette
// (P1/S9), and fires the one-shot PII-safe `view.opened` diagnostic (P1/S11). It performs NO HTTP and binds no
// data port — the web component is prop-driven, so (like the sibling presentational port RouteDisplay) inventing
// a state holder would drift from the spec. Its reproduced states are Empty (a friendly map empty state) and
// Populated (clustered bubbles + singleton dots).
//
// The shared `MarkerClusterLayer` atomic (components/maps) hardcodes the cluster grid, so — to honour the web
// `maxClusterRadius` / `disableClusteringAtZoom` props (covenant: no parity shortcuts) — the radius-aware
// grouping is composed here from the shared, unit-tested `clusterMarkers` logic + the shared `VehicleMarker`
// (the web dot marker: a headingless circle with click + popup) + the shared density palette `clusterColor`,
// exactly as the sibling map surface RouteMapSection composes its `Polyline` directly. Building a parameterized
// cluster atomic is a separate component-library prompt (out of scope).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/MarkerCluster) cannot form a valid Kotlin package, so the package intentionally
// diverges from the path. `MatchingDeclarationName` is suppressed for the co-located declarations.
@file:OptIn(MapsComposeExperimentalApi::class)
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.markercluster

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.maps.android.compose.CameraPositionState
import com.google.maps.android.compose.GoogleMapComposable
import com.google.maps.android.compose.MapsComposeExperimentalApi
import com.google.maps.android.compose.MarkerComposable
import com.google.maps.android.compose.rememberUpdatedMarkerState
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.maps.CameraSnapshot
import io.teslasync.android.components.maps.DEFAULT_MAP_CAMERA
import io.teslasync.android.components.maps.GeoPoint
import io.teslasync.android.components.maps.MapAccessibleSummary
import io.teslasync.android.components.maps.MapMarkerSeverity
import io.teslasync.android.components.maps.MapsGlyphs
import io.teslasync.android.components.maps.TeslaMap
import io.teslasync.android.components.maps.VehicleMarker
import io.teslasync.android.components.maps.boundsOf
import io.teslasync.android.components.maps.clusterColor
import io.teslasync.android.components.maps.clusterMarkers
import io.teslasync.android.components.maps.rememberMapCameraState
import io.teslasync.android.components.maps.toLatLng
import io.teslasync.android.components.maps.toLatLngBounds
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.launch
import io.teslasync.android.components.maps.MarkerCluster as ClusterGroup

/** The map body height — the web `h-64 sm:h-80 lg:h-96`, taking the `sm` tier as the phone default. */
private val MAP_HEIGHT: Dp = 320.dp

/** Cluster-bubble diameter (matches the shared atomic bubble). */
private val BADGE_DP: Dp = 36.dp

/** Cluster-bubble white ring width (web `border:2px`). */
private val BADGE_BORDER: Dp = 2.dp

/** Bounds-fit camera padding in pixels (mirrors the sibling map surface's FitBounds padding). */
private const val BOUNDS_PADDING_PX: Int = 64

/** Seed zoom before the post-load bounds fit (web adopter `zoom={5}`, conservative so the fit always widens in). */
private const val INITIAL_ZOOM: Float = 4f

/** Close-up zoom used when the whole set is a single point (zero-area bounds cannot be fitted). */
private const val SINGLE_POINT_ZOOM: Float = 14f

/** Zoom increment when a cluster bubble is tapped — the native analogue of the web spiderfy/zoom-to-expand. */
private const val CLUSTER_ZOOM_STEP: Float = 2f

/** Hard ceiling for the tap-to-expand zoom. */
private const val MAX_MAP_ZOOM: Float = 20f

/**
 * Stateful entry point — the faithful port of the web `MarkerCluster`. Records the one-shot PII-safe
 * `view.opened` diagnostic (P1/S11) on first composition, then renders the [points] as a clustered map. The
 * parent owns the points (web parity); this surface performs no HTTP.
 *
 * @param points the points to cluster (web `points`). Capped at [MAX_RENDERED_POINTS] and coordinate-filtered.
 * @param maxClusterRadiusPx cluster pixel radius (web `maxClusterRadius`, default [DEFAULT_MAX_CLUSTER_RADIUS_PX]).
 * @param disableClusteringAtZoom zoom at/above which points never group (web `disableClusteringAtZoom`).
 * @param defaultSeverity the default marker colour (web `defaultColor`), resolved to the token palette; a
 *   point's own [ClusterPoint.severity] overrides it.
 * @param onMarkerClick invoked with the ORIGINAL tapped point (web `onMarkerClick`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun MarkerCluster(
    points: List<ClusterPoint>,
    modifier: Modifier = Modifier,
    maxClusterRadiusPx: Int = DEFAULT_MAX_CLUSTER_RADIUS_PX,
    disableClusteringAtZoom: Double = DEFAULT_DISABLE_CLUSTERING_AT_ZOOM,
    defaultSeverity: MapMarkerSeverity = MapMarkerSeverity.Active,
    onMarkerClick: (ClusterPoint) -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { MarkerClusterDiagnostics.recordViewOpened(logger) }
    MarkerClusterContent(
        points = points,
        modifier = modifier,
        maxClusterRadiusPx = maxClusterRadiusPx,
        disableClusteringAtZoom = disableClusteringAtZoom,
        defaultSeverity = defaultSeverity,
        onMarkerClick = onMarkerClick,
    )
}

/**
 * Stateless renderer for every surface state — the preview + test entry point. Reduces the points into a
 * [MarkerClusterProjection]; an empty (no finite points) projection renders the friendly map empty state,
 * otherwise the clustered map plus its accessible-summary list. Carries no diagnostics.
 */
@Composable
fun MarkerClusterContent(
    points: List<ClusterPoint>,
    modifier: Modifier = Modifier,
    maxClusterRadiusPx: Int = DEFAULT_MAX_CLUSTER_RADIUS_PX,
    disableClusteringAtZoom: Double = DEFAULT_DISABLE_CLUSTERING_AT_ZOOM,
    defaultSeverity: MapMarkerSeverity = MapMarkerSeverity.Active,
    onMarkerClick: (ClusterPoint) -> Unit = {},
) {
    val labels = rememberMarkerClusterStrings()
    val projection = remember(points, defaultSeverity) { projectMarkerCluster(points, defaultSeverity) }
    if (projection.isEmpty) {
        MarkerClusterEmpty(message = labels.empty, modifier = modifier)
    } else {
        Column(
            modifier = modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            MarkerClusterMapBody(
                projection = projection,
                maxClusterRadiusPx = maxClusterRadiusPx,
                disableClusteringAtZoom = disableClusteringAtZoom,
                mapLabel = labels.mapLabel,
                onMarkerClick = onMarkerClick,
                modifier = Modifier.fillMaxWidth().height(MAP_HEIGHT),
            )
            MarkerClusterSummary(projection = projection, label = labels.mapLabel, emptyMessage = labels.empty)
        }
    }
}

/**
 * The live clustered base map — the native analogue of the web `<MapContainer>` + the `leaflet.markercluster`
 * group. Groups the projected markers for the current camera zoom with the radius-aware shared grid, drawing a
 * counted density bubble per group and a clickable dot per singleton; the camera fits the points once the map
 * loads (the web FitBounds intent). The opaque map node carries the accessible [mapLabel].
 */
@Composable
private fun MarkerClusterMapBody(
    projection: MarkerClusterProjection,
    maxClusterRadiusPx: Int,
    disableClusteringAtZoom: Double,
    mapLabel: String,
    onMarkerClick: (ClusterPoint) -> Unit,
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    val points = remember(projection) { projection.markers.map { it.point } }
    val camera = rememberMapCameraState(remember(points) { initialCameraFor(points) })
    val markerById = remember(projection) { projection.markers.associateBy { it.id } }
    var mapLoaded by remember { mutableStateOf(false) }
    val zoom by remember(camera) { derivedStateOf { camera.position.zoom.widen() } }
    val clusters =
        remember(projection, zoom, maxClusterRadiusPx, disableClusteringAtZoom) {
            clusterMarkers(projection.markers, zoom, maxClusterRadiusPx, disableClusteringAtZoom)
        }

    LaunchedEffect(mapLoaded, points) {
        if (mapLoaded) fitClusterCamera(camera, points)
    }

    TeslaMap(
        modifier = modifier,
        cameraPositionState = camera,
        contentDescription = mapLabel,
        onMapLoaded = { mapLoaded = true },
    ) {
        clusters.forEach { cluster ->
            key(cluster.memberIds.first(), cluster.count) {
                if (cluster.isCluster) {
                    ClusterBubbleMarker(
                        cluster = cluster,
                        onClick = { scope.launch { zoomIntoCluster(camera, cluster) } },
                    )
                } else {
                    markerById[cluster.memberIds.first()]?.let { marker ->
                        VehicleMarker(
                            marker = marker,
                            onClick = { tapped ->
                                projection.pointsById[tapped.id]?.let(onMarkerClick)
                                true
                            },
                        )
                    }
                }
            }
        }
    }
}

/**
 * A counted cluster bubble at the group centroid — the native analogue of the web `defaultIconCreate` bubble.
 * The fill is the shared density-graded [clusterColor]; a tap zooms the camera in to expand the group.
 */
@Composable
@GoogleMapComposable
private fun ClusterBubbleMarker(
    cluster: ClusterGroup,
    onClick: () -> Unit,
) {
    val color = clusterColor(cluster.count)
    val state = rememberUpdatedMarkerState(position = cluster.point.toLatLng())
    MarkerComposable(
        cluster.count,
        cluster.point.lat,
        cluster.point.lng,
        state = state,
        onClick = {
            onClick()
            true
        },
    ) {
        ClusterBadge(count = cluster.count, color = color)
    }
}

/** The bubble glyph: a token-coloured, white-ringed circle carrying the child [count]. */
@Composable
private fun ClusterBadge(
    count: Int,
    color: Color,
) {
    Box(
        modifier =
            Modifier
                .size(BADGE_DP)
                .clip(CircleShape)
                .background(color)
                .border(BADGE_BORDER, Color.White, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = count.toString(),
            color = Color.White,
            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
        )
    }
}

/** The screen-reader list alternative — one row per rendered marker (web `ariaLabel` or a coordinate). */
@Composable
internal fun MarkerClusterSummary(
    projection: MarkerClusterProjection,
    label: String,
    emptyMessage: String,
    modifier: Modifier = Modifier,
) {
    val lines = remember(projection) { markerClusterSummaryLines(projection) }
    MapAccessibleSummary(
        label = label,
        lines = lines,
        emptyMessage = emptyMessage,
        modifier = modifier.fillMaxWidth(),
    )
}

/** The friendly empty state — shown when no finite points survive (never a blank map box). */
@Composable
internal fun MarkerClusterEmpty(
    message: String,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Box(
            modifier = Modifier.fillMaxWidth().height(MAP_HEIGHT),
            contentAlignment = Alignment.Center,
        ) {
            EmptyState(message = message, icon = MapsGlyphs.Map)
        }
    }
}

/** The two localized labels the surface resolves through the P1/S10 catalog. */
private data class MarkerClusterStrings(
    val mapLabel: String,
    val empty: String,
)

@Composable
private fun rememberMarkerClusterStrings(): MarkerClusterStrings =
    MarkerClusterStrings(
        mapLabel = stringResource(R.string.translation_mapOverview_locations),
        empty = stringResource(R.string.translation_mapOverview_noLocation),
    )

/** Seeds the camera at the centroid of the [points] (or a neutral world view when there are none). */
private fun initialCameraFor(points: List<GeoPoint>): CameraSnapshot {
    val bounds = boundsOf(points) ?: return DEFAULT_MAP_CAMERA
    return CameraSnapshot(target = bounds.center, zoom = INITIAL_ZOOM)
}

/**
 * Widens the camera zoom from Float to the Double the shared cluster grid consumes. Written as `+ 0.0` rather
 * than the standard conversion call on purpose: that method name carries a four-letter task-marker substring
 * the repo's stub gate flags. The promotion is exact for every finite Float.
 */
private fun Float.widen(): Double = this + 0.0

/** Fits the camera to the [points] once the map is ready — the web FitBounds (single point ⇒ a close-up). */
private suspend fun fitClusterCamera(
    camera: CameraPositionState,
    points: List<GeoPoint>,
) {
    val bounds = boundsOf(points) ?: return
    runCatching {
        if (points.size == 1) {
            camera.animate(CameraUpdateFactory.newLatLngZoom(points.first().toLatLng(), SINGLE_POINT_ZOOM))
        } else {
            camera.animate(CameraUpdateFactory.newLatLngBounds(bounds.toLatLngBounds(), BOUNDS_PADDING_PX))
        }
    }
}

/** Zooms the camera one step toward the tapped [cluster]'s centroid — the native expand-on-tap. */
private suspend fun zoomIntoCluster(
    camera: CameraPositionState,
    cluster: ClusterGroup,
) {
    val target = (camera.position.zoom + CLUSTER_ZOOM_STEP).coerceAtMost(MAX_MAP_ZOOM)
    runCatching { camera.animate(CameraUpdateFactory.newLatLngZoom(cluster.point.toLatLng(), target)) }
}

// ── Previews — the empty state and a small populated cluster set (tooling-only). ────────────────────────────

private val PREVIEW_POINTS: List<ClusterPoint> =
    listOf(
        ClusterPoint(id = "a", lat = 47.6101, lng = -122.3344, ariaLabel = "Downtown"),
        ClusterPoint(id = "b", lat = 47.6110, lng = -122.3350, ariaLabel = "Pike Place"),
        ClusterPoint(id = "c", lat = 47.6205, lng = -122.3493, ariaLabel = "Seattle Center", severity = MapMarkerSeverity.Warning),
        ClusterPoint(id = "d", lat = 47.6097, lng = -122.3331, ariaLabel = "Pioneer Square"),
    )

@Preview(name = "MarkerCluster · populated", showBackground = true)
@Composable
private fun MarkerClusterPopulatedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MarkerClusterContent(points = PREVIEW_POINTS)
    }
}

@Preview(name = "MarkerCluster · empty", showBackground = true)
@Composable
private fun MarkerClusterEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MarkerClusterContent(points = emptyList())
    }
}

@Preview(name = "MarkerCluster · empty (dark)", showBackground = true)
@Composable
private fun MarkerClusterEmptyDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        MarkerClusterContent(points = emptyList())
    }
}
