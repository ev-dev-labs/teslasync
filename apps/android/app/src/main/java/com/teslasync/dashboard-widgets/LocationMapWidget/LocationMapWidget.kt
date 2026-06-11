// The native Jetpack Compose + Material 3 Vehicle Location Map dashboard surface — a parity port of
// web/src/features/dashboard/widgets/LocationMapWidget.tsx. It mirrors the web `WidgetShell`
// (a skeleton while loading, a retry surface on hard failure, otherwise a freshness + refresh header —
// titled with a map-pin icon for the standard footprint, bare for the compact footprint) wrapping the
// web `WidgetMapView`: the "No location data available" empty surface when no fix resolved, otherwise a
// live `TeslaMap` centered on the vehicle with a heading-rotated `AnimatedVehicleMarker` and a
// bottom-start status overlay (the "Last known position" chip when the reading is not live, plus the
// "Heading: n°" and coordinate chips when the footprint is expanded). All data flows through the shared
// [LocationMapWidgetViewModel] (P1/S8); the view never performs HTTP, and it never imports the maps SDK
// directly (it composes the [TeslaMap] / [AnimatedVehicleMarker] wrappers). Every string resolves
// through the i18n catalog and every interactive element + the opaque map node carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/LocationMapWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.locationmap

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.maps.AnimatedVehicleMarker
import io.teslasync.android.components.maps.CameraSnapshot
import io.teslasync.android.components.maps.GeoPoint
import io.teslasync.android.components.maps.MapsGlyphs
import io.teslasync.android.components.maps.TeslaMap
import io.teslasync.android.components.maps.rememberMapCameraState
import io.teslasync.android.components.maps.toCameraPosition
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

private const val EM_DASH = "\u2014"
private const val LOADING_BAR_COUNT = 3
private const val OVERLAY_BACKGROUND_ALPHA = 0.78f
private val LOADING_BAR_HEIGHT = 14.dp

/**
 * Stateful entry point. Binds the cache-then-network latest-state feed via [source] into a
 * [LocationMapWidgetViewModel], records the one-shot `view.opened` diagnostic, and renders the surface
 * for the given [size]. A dashboard host supplies [source] (an adapter over the shared S8 Vehicles data
 * layer) and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network latest-state seam (a [VehiclesStoreLocationMapSource] adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun LocationMapWidget(
    source: LocationMapSource,
    modifier: Modifier = Modifier,
    size: LocationMapSize = LocationMapRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = LocationMapRegistration.ID,
) {
    val viewModel: LocationMapWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { LocationMapWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    LocationMapWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the freshness +
 * refresh header over the live map body, or the "No location data available" empty surface when no fix
 * resolved.
 */
@Composable
fun LocationMapWidgetContent(
    state: UiState<VehicleLocationData?>,
    size: LocationMapSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val strings = rememberLocationMapStrings()
    when {
        state.isLoading -> LoadingChrome(modifier)
        state.isError -> ErrorChrome(onRefresh, modifier)
        else -> {
            val data = state.data
            val display = remember(data, size, strings) { LocationMapProjection.project(data, size, strings) }
            LoadedChrome(state, size, display, onRefresh, strings, modifier)
        }
    }
}

@Composable
private fun LoadedChrome(
    state: UiState<VehicleLocationData?>,
    size: LocationMapSize,
    display: LocationMapDisplay,
    onRefresh: () -> Unit,
    strings: LocationMapStrings,
    modifier: Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        WidgetHeader(state = state, size = size, display = display, onRefresh = onRefresh, strings = strings)
        Box(modifier = Modifier.fillMaxSize()) {
            if (display.hasCoords) {
                LocationMapBody(display)
            } else {
                LocationMapEmpty(display)
            }
        }
    }
}

@Composable
private fun WidgetHeader(
    state: UiState<VehicleLocationData?>,
    size: LocationMapSize,
    display: LocationMapDisplay,
    onRefresh: () -> Unit,
    strings: LocationMapStrings,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.md, end = Spacing.sm, top = Spacing.sm, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (!size.isCompact) {
            Icon(
                DataDisplayGlyphs.MapPin,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.primary,
            )
            PanelTitle(display.title, modifier = Modifier.weight(1f).semantics { heading() })
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = strings.refreshingLabel,
            errorLabel = strings.offlineLabel,
            formatAge = strings.formatRelative,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = strings.refreshLabel,
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

// -- Empty: no location fix (web WidgetMapView isEmpty) --
@Composable
private fun LocationMapEmpty(display: LocationMapDisplay) {
    EmptyState(
        message = display.noDataText,
        icon = DataDisplayGlyphs.MapPin,
        modifier = Modifier.fillMaxWidth(),
    )
}

// -- Content: the live map with the heading-rotated marker + the status overlay --
@Composable
private fun LocationMapBody(display: LocationMapDisplay) {
    Box(modifier = Modifier.fillMaxSize()) {
        VehicleLocationMap(display, modifier = Modifier.fillMaxSize())
        if (display.showStatusOverlay) {
            LocationMapStatusOverlay(
                display = display,
                modifier =
                    Modifier
                        .align(Alignment.BottomStart)
                        .padding(Spacing.sm),
            )
        }
    }
}

/**
 * The live base map centered on the vehicle, carrying a heading-rotated [AnimatedVehicleMarker] — the
 * native analogue of the web `WidgetMapView` + `AnimatedMarker`. The camera is seeded at the fix and
 * re-centered whenever the position or zoom changes (the web `center` / `panTo` follow). The opaque map
 * node carries [LocationMapDisplay.mapContentDescription] so TalkBack announces the position even when
 * the visible chips are hidden (the compact footprint). The maps SDK is never imported here — only the
 * [TeslaMap] / [AnimatedVehicleMarker] wrappers and the SDK-free [GeoPoint] / [CameraSnapshot].
 */
@Composable
private fun VehicleLocationMap(
    display: LocationMapDisplay,
    modifier: Modifier = Modifier,
) {
    val cameraState = rememberMapCameraState(CameraSnapshot(GeoPoint(display.latitude, display.longitude), display.zoom))
    LaunchedEffect(display.latitude, display.longitude, display.zoom) {
        cameraState.position = CameraSnapshot(GeoPoint(display.latitude, display.longitude), display.zoom).toCameraPosition()
    }
    TeslaMap(
        modifier = modifier,
        cameraPositionState = cameraState,
        contentDescription = display.mapContentDescription,
    ) {
        AnimatedVehicleMarker(
            target = GeoPoint(display.latitude, display.longitude),
            headingDegrees = display.heading,
        )
    }
}

/**
 * The bottom-start status overlay — the native port of the web overlay chips. Rendered as map-free
 * Compose siblings (not part of the opaque `GoogleMap`), so the overlay's i18n strings + TalkBack
 * labels are asserted off the SDK in the UI test (the live map itself needs Play Services, per the
 * maps-layer testing contract). [Modifier] positions it within the parent map [Box].
 */
@Composable
internal fun LocationMapStatusOverlay(
    display: LocationMapDisplay,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (display.showLastKnownChip) {
            OverlayChip(
                icon = DataDisplayGlyphs.MapPin,
                text = display.lastKnownText,
                tint = TeslaTokens.status.warning,
            )
        }
        if (display.showHeadingChip) {
            OverlayChip(
                icon = MapsGlyphs.Navigation,
                text = display.headingChipText,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (display.showCoordsChip) {
            OverlayChip(
                icon = null,
                text = display.coordsText,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun OverlayChip(
    icon: ImageVector?,
    text: String,
    tint: Color,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(Radius.pill),
        color = MaterialTheme.colorScheme.surface.copy(alpha = OVERLAY_BACKGROUND_ALPHA),
        contentColor = tint,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            if (icon != null) {
                Icon(icon, contentDescription = null, size = IconSize.Xs, tint = tint)
            }
            Text(text, style = MaterialTheme.typography.labelSmall, color = tint)
        }
    }
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
    onRetry: () -> Unit,
    modifier: Modifier,
) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = modifier.fillMaxSize().padding(Spacing.md),
    )
}

/**
 * Builds the localized [LocationMapStrings] from the i18n catalog (P1/S10): the title + the
 * "No location data available" / "Last known position" / "Heading" widget labels, the header
 * refresh/refreshing/offline microcopy, and the `translation_freshness_*`-backed relative-time
 * formatter shared with the freshness chip.
 */
@Composable
private fun rememberLocationMapStrings(): LocationMapStrings {
    val title = stringResource(R.string.translation_widget_locationMap_title)
    val noData = stringResource(R.string.translation_widget_locationMap_noData)
    val lastKnown = stringResource(R.string.translation_widget_locationMap_lastKnown)
    val heading = stringResource(R.string.translation_widget_locationMap_heading)
    val refresh = stringResource(R.string.translation_common_refresh)
    val refreshing = stringResource(R.string.translation_common_loading)
    val offline = stringResource(R.string.translation_common_offline)
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(
        title,
        noData,
        lastKnown,
        heading,
        refresh,
        refreshing,
        offline,
        justNow,
        seconds,
        minutes,
        hours,
        days,
        weeks,
    ) {
        LocationMapStrings(
            title = title,
            noData = noData,
            lastKnown = lastKnown,
            heading = heading,
            refreshLabel = refresh,
            refreshingLabel = refreshing,
            offlineLabel = offline,
            formatRelative = { age ->
                when (age) {
                    FreshnessAge.Unknown -> EM_DASH
                    FreshnessAge.JustNow -> justNow
                    is FreshnessAge.Seconds -> seconds.format(age.value)
                    is FreshnessAge.Minutes -> minutes.format(age.value)
                    is FreshnessAge.Hours -> hours.format(age.value)
                    is FreshnessAge.Days -> days.format(age.value)
                    is FreshnessAge.Weeks -> weeks.format(age.value)
                }
            },
        )
    }
}
