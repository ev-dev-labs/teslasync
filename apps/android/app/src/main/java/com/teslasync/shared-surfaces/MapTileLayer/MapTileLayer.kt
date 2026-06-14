// The native Jetpack Compose + Material 3 MapTileLayer shared surface — a parity port of
// web/src/components/maps/MapTileLayer.tsx. The web component is a tile-source SELECTOR: it reads the deployment
// map-config and returns the `{ url, attribution }` for the requested base-map `style`, defaulting to dark,
// with a sibling fullscreen overlay control. This native surface keeps that contract end to end and renders
// every state the prompt's matrix mandates without ever hiding a region: loading (the first map-config fetch's
// skeleton), content (the live map + the resolved tile attribution, including the community-default provider), a
// hard error with Retry, and a stale / offline freshness chip over a cached configuration.
//
// It performs NO HTTP and binds the map-config document only through the shared seam ([MapTileLayerSource]) folded
// through [MapTileLayerViewModel] + the pure [projectMapTileLayer]; the composable resolves the i18n labels
// (P1/S10) and design tokens (P1/S9) and draws what the projection returns, using the shared component library
// (maps TeslaMap / MapAccessibleSummary, ui GlassPanel / StatusPill / FullscreenButton / typography, feedback
// QueryError / Skeleton, motion FadeIn). It never imports the maps SDK directly — it composes the `TeslaMap`
// wrapper (the same house rule the sibling LocationMapWidget surface follows), applying the resolved
// [MapStyleId] to the live base map while the resolved attribution + freshness + fullscreen are rendered as
// map-free overlay chrome so they stay TalkBack-labelled and screenshot-testable off the SDK (the live map
// itself needs Play Services, per the maps-layer testing contract). The one-shot PII-safe `view.opened`
// diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/MapTileLayer) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located stateless content + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.maptilelayer

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.maps.MapAccessibleSummary
import io.teslasync.android.components.maps.MapStyleId
import io.teslasync.android.components.maps.TeslaMap
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.FullscreenButton
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

/** Test tag on the surface root so on-device UI tests can locate the rendered surface in any state. */
const val MAP_TILE_LAYER_TEST_TAG: String = "map-tile-layer"

/** Default rendered height of the map body (a comfortable card map; hosts may override). */
val DEFAULT_MAP_TILE_LAYER_HEIGHT: Dp = 280.dp

private const val OVERLAY_BACKGROUND_ALPHA = 0.82f

/**
 * Stateful entry point — the parity port of the web `<MapTileLayer style={…} />` (composed with its parent
 * `<MapContainer>` + the sibling `MapFullscreenControl`). Records the one-shot `view.opened` diagnostic
 * (P1/S11) on first composition, collects the [UiState], auto-refreshes a stale cache, and renders.
 *
 * @param viewModel the state holder bound to the shared map-config seam.
 * @param style the base-map style to resolve tiles for (web `style` prop, default dark).
 * @param mapHeight the rendered height of the map body.
 */
@Composable
fun MapTileLayer(
    viewModel: MapTileLayerViewModel,
    modifier: Modifier = Modifier,
    style: MapStyleId = MapStyleId.Dark,
    mapHeight: Dp = DEFAULT_MAP_TILE_LAYER_HEIGHT,
) {
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    // Stale TTL → auto-refresh (prompt's stale-state contract). Keyed on the freshness stamp so it fires at
    // most once per distinct cached value, never in a loop.
    LaunchedEffect(state.stale, state.fetchedAt) {
        if (state.stale) viewModel.refresh()
    }

    FadeIn(modifier = modifier) {
        MapTileLayerContent(state = state, style = style, onRetry = viewModel::retry, mapHeight = mapHeight)
    }
}

/**
 * Stateless surface — renders every branch the web source resolves plus the map-config document's lifecycle: a
 * loading skeleton, the live map with its resolved tile attribution, the classified error with retry, and a
 * stale/offline freshness chip over a cached configuration. Hoisted out of the ViewModel so the non-map chrome
 * is preview- and screenshot-testable for each state.
 */
@Composable
fun MapTileLayerContent(
    state: UiState<MapConfig>,
    modifier: Modifier = Modifier,
    style: MapStyleId = MapStyleId.Dark,
    onRetry: () -> Unit = {},
    mapHeight: Dp = DEFAULT_MAP_TILE_LAYER_HEIGHT,
) {
    val strings = rememberMapTileLayerStrings()
    GlassPanel(
        modifier = modifier.fillMaxWidth().testTag(MAP_TILE_LAYER_TEST_TAG),
        padding = PanelPadding.None,
    ) {
        when {
            state.isLoading -> MapTileLayerLoading(strings = strings, mapHeight = mapHeight)
            state.isError ->
                QueryError(
                    kind = mapTileLayerErrorKind(state.errorKind, state.httpStatus),
                    resourceName = strings.mapLabel,
                    onRetry = onRetry,
                    modifier = Modifier.padding(Spacing.md),
                )
            else -> {
                val projection = remember(state.data, style) { projectMapTileLayer(state.data, style) }
                MapTileLayerLoaded(projection = projection, freshness = state.toMapFreshness(), strings = strings, mapHeight = mapHeight)
            }
        }
    }
}

/** The live map body + its overlay chrome, followed by the non-visual accessible summary alternative. */
@Composable
private fun MapTileLayerLoaded(
    projection: MapTileLayerProjection,
    freshness: MapTileLayerFreshness,
    strings: MapTileLayerStrings,
    mapHeight: Dp,
) {
    var isFullscreen by rememberSaveable { mutableStateOf(false) }
    Box(modifier = Modifier.fillMaxWidth().height(mapHeight)) {
        MapTileLayerMap(projection = projection, mapLabel = strings.mapLabel, modifier = Modifier.fillMaxSize())
        MapTileLayerOverlay(
            projection = projection,
            strings = strings,
            isFullscreen = isFullscreen,
            onToggleFullscreen = { isFullscreen = !isFullscreen },
            freshness = freshness,
            modifier = Modifier.fillMaxSize().padding(Spacing.sm),
        )
    }
    MapAccessibleSummary(
        label = strings.mapLabel,
        lines = listOf(projection.attribution),
        modifier = Modifier.padding(Spacing.sm),
    )
}

/**
 * The live base map, applying the resolved [MapTileLayerProjection.style] through the shared [TeslaMap] wrapper
 * (never the maps SDK directly). The opaque map node carries a content description folding the map label with
 * the active tile attribution, so TalkBack announces the tile source even when the visible chips are off-screen.
 */
@Composable
private fun MapTileLayerMap(
    projection: MapTileLayerProjection,
    mapLabel: String,
    modifier: Modifier = Modifier,
) {
    TeslaMap(
        modifier = modifier,
        style = projection.style,
        contentDescription = "$mapLabel \u00B7 ${projection.attribution}",
    )
}

/**
 * The map-free overlay chrome — the native port of the web tile attribution control + the `MapFullscreenControl`
 * fullscreen overlay, plus the cache-then-network freshness chip. Rendered as Compose siblings of the opaque
 * `GoogleMap` (not part of it), so the overlay's i18n strings + TalkBack labels are asserted off the SDK in the
 * UI test. [Modifier] positions it within the parent map [Box].
 */
@Composable
fun MapTileLayerOverlay(
    projection: MapTileLayerProjection,
    strings: MapTileLayerStrings,
    modifier: Modifier = Modifier,
    isFullscreen: Boolean = false,
    onToggleFullscreen: () -> Unit = {},
    freshness: MapTileLayerFreshness = MapTileLayerFreshness(),
) {
    Box(modifier = modifier.fillMaxSize()) {
        if (freshness.offline || freshness.stale) {
            StatusPill(
                text = if (freshness.offline) strings.offlineLabel else strings.staleLabel,
                tone = if (freshness.offline) StatusTone.Danger else StatusTone.Warning,
                modifier = Modifier.align(Alignment.TopStart),
            )
        }
        FullscreenButton(
            isFullscreen = isFullscreen,
            onToggle = onToggleFullscreen,
            enterLabel = strings.fullscreenEnter,
            exitLabel = strings.fullscreenExit,
            size = IconSize.Md,
            modifier = Modifier.align(Alignment.TopEnd),
        )
        MapAttributionChip(text = projection.attribution, modifier = Modifier.align(Alignment.BottomStart))
    }
}

/** The bottom-corner tile attribution chip — the native render of the web `attribution` (plain text). */
@Composable
private fun MapAttributionChip(
    text: String,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(Radius.pill),
        color = MaterialTheme.colorScheme.surface.copy(alpha = OVERLAY_BACKGROUND_ALPHA),
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
    ) {
        Caption(text, modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs))
    }
}

/** The loading skeleton sized to the map body, announced to TalkBack as a loading region. */
@Composable
private fun MapTileLayerLoading(
    strings: MapTileLayerStrings,
    mapHeight: Dp,
) {
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .height(mapHeight)
                .semantics { contentDescription = strings.loadingLabel },
    ) {
        Skeleton(modifier = Modifier.fillMaxSize(), height = mapHeight, rounded = true)
    }
}

/** Whether the cached configuration should be flagged stale (warning) or offline (danger) on the freshness chip. */
data class MapTileLayerFreshness(
    val stale: Boolean = false,
    val offline: Boolean = false,
)

/** Folds the [UiState] freshness flags into the chip model: a failed-refresh cache is offline, else stale. */
private fun UiState<MapConfig>.toMapFreshness(): MapTileLayerFreshness =
    MapTileLayerFreshness(
        stale = stale && !hasError,
        offline = stale && hasError,
    )

/** The localized labels the surface renders — built from the P1/S10 catalog; tests pass a deterministic instance. */
data class MapTileLayerStrings(
    val mapLabel: String,
    val loadingLabel: String,
    val staleLabel: String,
    val offlineLabel: String,
    val fullscreenEnter: String,
    val fullscreenExit: String,
)

/** Builds the localized [MapTileLayerStrings] from the i18n catalog (P1/S10); no English literal lives here. */
@Composable
private fun rememberMapTileLayerStrings(): MapTileLayerStrings =
    MapTileLayerStrings(
        mapLabel = stringResource(R.string.translation_mapOverview_title),
        loadingLabel = stringResource(R.string.translation_a11y_loading),
        staleLabel = stringResource(R.string.translation_mqtt_stale),
        offlineLabel = stringResource(R.string.translation_common_offline),
        fullscreenEnter = stringResource(R.string.translation_common_fullscreen_enter),
        fullscreenExit = stringResource(R.string.translation_common_fullscreen_exit),
    )

// ── Previews — the map-free chrome per state (the live map needs Play Services, per the maps testing
// contract): custom-provider content, the community-default attribution, stale, offline, loading, and error. ──

private fun previewStrings(): MapTileLayerStrings =
    MapTileLayerStrings(
        mapLabel = "Map",
        loadingLabel = "Loading",
        staleLabel = "Stale",
        offlineLabel = "Offline",
        fullscreenEnter = "Enter fullscreen",
        fullscreenExit = "Exit fullscreen",
    )

@Composable
private fun OverlayPreviewFrame(
    projection: MapTileLayerProjection,
    freshness: MapTileLayerFreshness,
) {
    Surface(color = MaterialTheme.colorScheme.surfaceVariant) {
        Box(modifier = Modifier.fillMaxWidth().height(DEFAULT_MAP_TILE_LAYER_HEIGHT)) {
            MapTileLayerOverlay(
                projection = projection,
                strings = previewStrings(),
                freshness = freshness,
                modifier = Modifier.fillMaxSize().padding(Spacing.sm),
            )
        }
    }
}

@Preview(name = "MapTileLayer · content (custom provider)", showBackground = true)
@Composable
private fun MapTileLayerContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OverlayPreviewFrame(
            projection = projectMapTileLayer(MapConfig(provider = PROVIDER_AZURE, apiKey = "k"), MapStyleId.Dark),
            freshness = MapTileLayerFreshness(),
        )
    }
}

@Preview(name = "MapTileLayer · community default", showBackground = true)
@Composable
private fun MapTileLayerDefaultPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OverlayPreviewFrame(
            projection = projectMapTileLayer(MapConfig.FREE, MapStyleId.Streets),
            freshness = MapTileLayerFreshness(),
        )
    }
}

@Preview(name = "MapTileLayer · stale", showBackground = true)
@Composable
private fun MapTileLayerStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OverlayPreviewFrame(
            projection = projectMapTileLayer(MapConfig.FREE, MapStyleId.Dark),
            freshness = MapTileLayerFreshness(stale = true),
        )
    }
}

@Preview(name = "MapTileLayer · offline", showBackground = true)
@Composable
private fun MapTileLayerOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OverlayPreviewFrame(
            projection = projectMapTileLayer(MapConfig(provider = PROVIDER_GOOGLE, apiKey = "k"), MapStyleId.Satellite),
            freshness = MapTileLayerFreshness(offline = true),
        )
    }
}

@Preview(name = "MapTileLayer · loading", showBackground = true)
@Composable
private fun MapTileLayerLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MapTileLayerContent(state = UiState.loading(), style = MapStyleId.Dark)
    }
}

@Preview(name = "MapTileLayer · error", showBackground = true)
@Composable
private fun MapTileLayerErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MapTileLayerContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = HTTP_SERVER_ERROR),
            style = MapStyleId.Dark,
        )
    }
}

private const val HTTP_SERVER_ERROR = 503
