// The native Jetpack Compose + Material 3 Position Heatmap dashboard surface — a parity port of
// web/src/features/dashboard/widgets/PositionHeatmapWidget.tsx. It mirrors the web `WidgetShell`
// (a skeleton while loading, a `QueryError` retry surface on hard failure, otherwise a freshness +
// refresh header — titled with a map icon for the standard / wide footprint, with the "{n} positions"
// count badge when wide, bare for the compact footprint) wrapping the web `WidgetMapView`: the
// "No position data" empty surface when no fix resolved, otherwise a live `TeslaMap` centered on the
// cluster centroid with one density `CircleMarker` per bucket — radius + cool→hot fill colour + opacity
// encoding the visit intensity (the web comment is explicit: a density visualization, NOT marker
// clustering, which would collapse the very signal this widget exists to show). All data flows through
// the shared [PositionHeatmapWidgetViewModel] (P1/S8); the view never performs HTTP. Every string
// resolves through the i18n catalog and the opaque map node + the refresh control carry a TalkBack label.
//
// The density blob is a screen-space pixel circle (Leaflet `CircleMarker`), so it is rendered as a
// `MarkerComposable` whose content is a token-coloured `Canvas` circle of the projected dp radius —
// the same primitive the shared `MapMarkers` `MapDotMarker` uses, but with a per-blob radius/colour the
// shared layer offers no wrapper for (and which is outside this surface's allowed files, exactly as the
// sibling `GeofenceWidget` composes maps-compose `Circle` directly for its fences). The base map is the
// shared `TeslaMap` wrapper; the SDK is touched only for this density-marker primitive.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/PositionHeatmapWidget) cannot form a valid Kotlin package.
@file:OptIn(MapsComposeExperimentalApi::class)
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.positionheatmap

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.google.maps.android.compose.GoogleMapComposable
import com.google.maps.android.compose.MapsComposeExperimentalApi
import com.google.maps.android.compose.MarkerComposable
import com.google.maps.android.compose.rememberUpdatedMarkerState
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.maps.CameraSnapshot
import io.teslasync.android.components.maps.GeoPoint
import io.teslasync.android.components.maps.MapsGlyphs
import io.teslasync.android.components.maps.TeslaMap
import io.teslasync.android.components.maps.rememberMapCameraState
import io.teslasync.android.components.maps.toCameraPosition
import io.teslasync.android.components.maps.toLatLng
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

private const val EM_DASH = "\u2014"
private const val LOADING_BAR_COUNT = 3
private const val DIAMETER_FACTOR = 2f
private val LOADING_BAR_HEIGHT = 14.dp
private val CIRCLE_ANCHOR = Offset(0.5f, 0.5f)

/**
 * Stateful entry point. Binds the cache-then-network positions feed via [source] into a
 * [PositionHeatmapWidgetViewModel], records the one-shot `view.opened` diagnostic, and renders the
 * surface for the given [size]. A dashboard host supplies [source] (an adapter over the shared S8
 * Vehicles data layer) and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network positions seam (a [VehiclesStorePositionHeatmapSource] adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun PositionHeatmapWidget(
    source: PositionHeatmapSource,
    modifier: Modifier = Modifier,
    size: PositionHeatmapSize = PositionHeatmapRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = PositionHeatmapRegistration.ID,
) {
    val viewModel: PositionHeatmapWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { PositionHeatmapWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    PositionHeatmapWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → `QueryError` retry) and otherwise the
 * freshness + refresh header over the density map body, or the "No position data" empty surface when no
 * fix resolved.
 */
@Composable
fun PositionHeatmapWidgetContent(
    state: UiState<List<HeatPosition>>,
    size: PositionHeatmapSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val strings = rememberPositionHeatmapStrings()
    when {
        state.isLoading -> LoadingChrome(modifier)
        state.isError -> ErrorChrome(kind = state.toQueryErrorKind(), onRetry = onRefresh, modifier = modifier)
        else -> {
            val positions = state.data ?: emptyList()
            val display = remember(positions, size, strings) { PositionHeatmapProjection.project(positions, size, strings) }
            LoadedChrome(state = state, display = display, onRefresh = onRefresh, modifier = modifier)
        }
    }
}

@Composable
private fun LoadedChrome(
    state: UiState<List<HeatPosition>>,
    display: PositionHeatmapDisplay,
    onRefresh: () -> Unit,
    modifier: Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        PositionHeatmapHeader(
            display = display,
            fetchedAtMillis = state.fetchedAt,
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            onRefresh = onRefresh,
        )
        PositionHeatmapBody(display = display, modifier = Modifier.fillMaxSize())
    }
}

/**
 * The freshness + refresh header — the native port of the web `WidgetShell` chrome. Shows the map icon
 * + "Position Heatmap" title and (when wide) the "{n} positions" badge for the standard / wide
 * footprint; for the compact footprint only the freshness chip + refresh control remain (web compact
 * `WidgetShell` passes no title). Split out as `internal` so the badge + title + TalkBack labels are
 * asserted in the UI test without a live base map (which needs Play Services).
 */
@Composable
internal fun PositionHeatmapHeader(
    display: PositionHeatmapDisplay,
    fetchedAtMillis: Long?,
    isFetching: Boolean,
    isStale: Boolean,
    isError: Boolean,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val formatAge = rememberFreshnessFormatter()
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .padding(start = Spacing.md, end = Spacing.sm, top = Spacing.sm, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (display.showTitle) {
            Icon(
                MapsGlyphs.Map,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.primary,
            )
            PanelTitle(display.title, modifier = Modifier.weight(1f).semantics { heading() })
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
        if (display.showBadge) {
            Badge(text = display.countText, variant = BadgeVariant.Neutral)
        }
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

// -- Body: the density map, or the "No position data" empty surface (web WidgetMapView isEmpty) --
@Composable
private fun PositionHeatmapBody(
    display: PositionHeatmapDisplay,
    modifier: Modifier = Modifier,
) {
    Box(modifier = modifier.fillMaxSize()) {
        if (display.hasData) {
            PositionHeatmapMap(display = display, modifier = Modifier.fillMaxSize())
        } else {
            PositionHeatmapEmpty(display = display)
        }
    }
}

/**
 * The live base map centered on the cluster centroid, carrying one density [HeatPointMarker] per
 * bucket — the native analogue of the web `WidgetMapView` + the `clusters.map(<CircleMarker/>)` loop.
 * The camera is seeded at the centroid and re-centered whenever it or the zoom changes (the web
 * `center` follow). The opaque map node carries [PositionHeatmapDisplay.mapContentDescription] so
 * TalkBack announces the surface + density summary. The maps SDK is touched only for the density-marker
 * primitive; the base map is the shared [TeslaMap] wrapper.
 */
@Composable
private fun PositionHeatmapMap(
    display: PositionHeatmapDisplay,
    modifier: Modifier = Modifier,
) {
    val cameraState = rememberMapCameraState(CameraSnapshot(display.center, display.zoom))
    LaunchedEffect(display.center, display.zoom) {
        cameraState.position = CameraSnapshot(display.center, display.zoom).toCameraPosition()
    }
    TeslaMap(
        modifier = modifier,
        cameraPositionState = cameraState,
        contentDescription = display.mapContentDescription,
    ) {
        display.clusters.forEachIndexed { index, cluster ->
            key(index) { HeatPointMarker(cluster) }
        }
    }
}

/**
 * One density blob — a screen-space pixel circle (Leaflet `CircleMarker`) reproduced as a
 * [MarkerComposable] whose content is a token-coloured [HeatCircleGlyph] of the projected dp radius,
 * center-anchored on the bucket centroid. The colour + radius + opacity are all pre-computed in the
 * pure projection; this composable only paints them.
 */
@Composable
@GoogleMapComposable
private fun HeatPointMarker(cluster: HeatCluster) {
    val markerState = rememberUpdatedMarkerState(position = GeoPoint(cluster.latitude, cluster.longitude).toLatLng())
    val color = Color(cluster.red, cluster.green, cluster.blue).copy(alpha = cluster.fillAlpha)
    MarkerComposable(
        cluster,
        state = markerState,
        anchor = CIRCLE_ANCHOR,
    ) {
        HeatCircleGlyph(radiusDp = cluster.radiusDp, color = color)
    }
}

@Composable
private fun HeatCircleGlyph(
    radiusDp: Float,
    color: Color,
) {
    Canvas(modifier = Modifier.size((radiusDp * DIAMETER_FACTOR).dp)) {
        drawCircle(color = color, radius = size.minDimension / 2f, center = center)
    }
}

// -- Empty: no renderable fix (web WidgetMapView isEmpty / clusters.length === 0) --
@Composable
private fun PositionHeatmapEmpty(
    display: PositionHeatmapDisplay,
    modifier: Modifier = Modifier,
) {
    EmptyState(
        message = display.noDataText,
        icon = MapsGlyphs.Map,
        modifier = modifier.fillMaxWidth(),
    )
}

@Composable
private fun LoadingChrome(modifier: Modifier) {
    val label = stringResource(R.string.translation_common_loading)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(LOADING_BAR_COUNT) {
            Skeleton(height = LOADING_BAR_HEIGHT, rounded = true)
        }
    }
}

@Composable
private fun ErrorChrome(
    kind: QueryErrorKind,
    onRetry: () -> Unit,
    modifier: Modifier,
) {
    QueryError(
        kind = kind,
        onRetry = onRetry,
        modifier = modifier.fillMaxSize().padding(Spacing.md),
    )
}

/**
 * Builds the localized [PositionHeatmapStrings] from the i18n catalog (P1/S10): the "Position Heatmap"
 * title, the "No position data" empty message, and the "{n} positions" count label — the three
 * `t('widget.positionHeatmap.*')` keys the web component uses.
 */
@Composable
private fun rememberPositionHeatmapStrings(): PositionHeatmapStrings {
    val title = stringResource(R.string.translation_widget_positionHeatmap_title)
    val noData = stringResource(R.string.translation_widget_positionHeatmap_noData)
    val countTemplate = stringResource(R.string.translation_widget_positionHeatmap_count)
    return remember(title, noData, countTemplate) {
        PositionHeatmapStrings(
            title = title,
            noData = noData,
            countLabel = { count -> countTemplate.format(count) },
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

/** Maps the [UiState] failure classification onto the shared [QueryErrorKind] recovery copy. */
private fun UiState<*>.toQueryErrorKind(): QueryErrorKind =
    when (errorKind) {
        ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
        ErrorKind.Http -> classifyQueryError(status = httpStatus, online = true, transientWaiting = false)
        ErrorKind.Decode -> QueryErrorKind.ServerError
        null, ErrorKind.Unknown -> QueryErrorKind.Network
    }
