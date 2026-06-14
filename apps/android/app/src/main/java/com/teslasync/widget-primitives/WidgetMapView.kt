// The native Jetpack Compose + Material 3 WidgetMapView widget primitive — a parity port of
// web/src/features/dashboard/widgets/shared/WidgetMapView.tsx. The web surface is a presentational map "frame"
// shared by many dashboard widgets: a shared EmptyState when the caller flags the location as missing, or an
// overflow-clipped rounded box holding a dark-tile map centered at the caller's `center` / `zoom`, with the
// caller's markers / polylines layered on top. It fetches nothing and owns no text of its own beyond the
// empty-state default ("No location data available").
//
// This native surface keeps that contract end to end. It reproduces every branch the web source draws — the
// empty state (web `isEmpty`) and the map frame, whose pan + zoom interactions (web `dragging` /
// `scrollWheelZoom` / `zoomControl`) are each enabled only when NOT `compact`, so a compact widget is a static
// thumbnail and a wide one is fully interactive — each selected by the pure [widgetMapViewPlan] /
// [widgetMapInteraction] in WidgetMapViewModel.kt. The map content (web `children`) is the [GoogleMapContent]
// slot, so a caller drops `Marker` / `Polyline` content into the same frame the web does.
//
// It performs NO HTTP and binds NO data state holder (the web component fetches nothing; it has no hook). See
// WidgetMapViewModel.kt for the honesty rationale and why the generic loading/error/stale/offline states do not
// apply to a presentational frame. The empty copy and the map's accessibility label resolve through the i18n
// catalog (P1/S10, `translation_widget_locationMap_noData` / `translation_widget_locationMap_title`) so no
// English literal ships; the dark map comes from the shared `components/maps` `TeslaMap` wrapper (the Android
// counterpart of the web `MapContainer` + `MapTileLayer style="dark"`) over the generated design tokens (P1/S9)
// so it stays correct across light / dark / high-contrast and honours the system font scale. The map announces a
// localized description to TalkBack, the EmptyState announces its message, and a one-shot PII-safe `view.opened`
// diagnostic (P1/S11) fires on first composition carrying only the surface slug — never a coordinate.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/widget-primitives)
// cannot form a valid Kotlin package. `MatchingDeclarationName` is suppressed for the co-located stateless
// renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgetmapview

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.google.maps.android.compose.MapUiSettings
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.maps.CameraSnapshot
import io.teslasync.android.components.maps.GeoPoint
import io.teslasync.android.components.maps.GoogleMapContent
import io.teslasync.android.components.maps.MapStyleId
import io.teslasync.android.components.maps.TeslaMap
import io.teslasync.android.components.maps.rememberMapCameraState
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag on the surface root so on-device UI tests can locate the frame in either state (empty or map). */
const val WIDGET_MAP_VIEW_TEST_TAG: String = "widget-map-view"

/**
 * The faithful port of the web `WidgetMapView`. Renders the dark map centered at [center] / [zoom] with the
 * caller's [content] layered on top, or the shared EmptyState when [isEmpty]. Records the one-shot PII-safe
 * `view.opened` diagnostic on first composition, then delegates to the stateless [WidgetMapViewContent] so the
 * diagnostics live in exactly one place (the data-container-free renderer is the test / preview entry point).
 *
 * @param center the WGS-84 point the map frames (web `center: [lat, lng]`).
 * @param zoom the initial camera zoom (web `zoom`); defaults to [DEFAULT_WIDGET_MAP_ZOOM] (web `13`).
 * @param compact when true, the map is a static, non-interactive thumbnail (web `compact` → all interactions off).
 * @param emptyMessage the empty-state copy (web `emptyMessage`); falls back to the i18n "No location data available".
 * @param isEmpty when true, the shared EmptyState replaces the map (web `isEmpty`).
 * @param logger the sanctioned redacting logger; defaults to the app's data-container logger.
 * @param content the map overlay slot — markers / polylines (web `children`).
 */
@Composable
fun WidgetMapView(
    center: GeoPoint,
    modifier: Modifier = Modifier,
    zoom: Float = DEFAULT_WIDGET_MAP_ZOOM,
    compact: Boolean = false,
    emptyMessage: String? = null,
    isEmpty: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
    content: GoogleMapContent = {},
) {
    LaunchedEffect(Unit) { WidgetMapViewDiagnostics.recordViewOpened(logger) }
    WidgetMapViewContent(
        center = center,
        modifier = modifier,
        zoom = zoom,
        compact = compact,
        emptyMessage = emptyMessage,
        isEmpty = isEmpty,
        content = content,
    )
}

/**
 * Stateless renderer — the unit / UI-test + preview entry point (no diagnostics, no data container). Paints the
 * empty state (web `isEmpty`) or the map frame: an overflow-clipped, rounded box (web `rounded-lg overflow-hidden`)
 * over a token surface fill (the web `background: #1a1a2e` "no white flash" base), holding the shared dark
 * [TeslaMap] seeded at the resolved [center] / [zoom] with the caller's [content] on top. The empty copy falls
 * back to the localized "No location data available" when [emptyMessage] is null. Never blank: exactly one of the
 * two regions always renders.
 */
@Composable
fun WidgetMapViewContent(
    center: GeoPoint,
    modifier: Modifier = Modifier,
    zoom: Float = DEFAULT_WIDGET_MAP_ZOOM,
    compact: Boolean = false,
    emptyMessage: String? = null,
    isEmpty: Boolean = false,
    content: GoogleMapContent = {},
) {
    if (widgetMapViewPlan(isEmpty).showEmptyState) {
        EmptyState(
            message = emptyMessage ?: stringResource(R.string.translation_widget_locationMap_noData),
            modifier = modifier.testTag(WIDGET_MAP_VIEW_TEST_TAG),
        )
        return
    }

    val interaction = widgetMapInteraction(compact)
    val resolvedCenter = remember(center) { resolveWidgetMapCenter(center) }
    val resolvedZoom = remember(zoom) { resolveWidgetMapZoom(zoom) }
    val cameraState =
        rememberMapCameraState(
            CameraSnapshot(target = resolvedCenter, zoom = resolvedZoom),
        )

    Box(
        modifier =
            modifier
                .fillMaxSize()
                .clip(MaterialTheme.shapes.small)
                .background(MaterialTheme.colorScheme.surface)
                .testTag(WIDGET_MAP_VIEW_TEST_TAG),
    ) {
        TeslaMap(
            modifier = Modifier.matchParentSize(),
            cameraPositionState = cameraState,
            style = MapStyleId.Dark,
            contentDescription = stringResource(R.string.translation_widget_locationMap_title),
            uiSettings =
                MapUiSettings(
                    compassEnabled = interaction.interactive,
                    indoorLevelPickerEnabled = false,
                    mapToolbarEnabled = false,
                    myLocationButtonEnabled = false,
                    rotationGesturesEnabled = interaction.interactive,
                    scrollGesturesEnabled = interaction.dragging,
                    scrollGesturesEnabledDuringRotateOrZoom = interaction.interactive,
                    tiltGesturesEnabled = interaction.interactive,
                    zoomControlsEnabled = interaction.zoomControl,
                    zoomGesturesEnabled = interaction.scrollWheelZoom,
                ),
            content = content,
        )
    }
}

// ── Previews (tooling-only; the sample center is never shipped UI) ──────────────────────────────────────────

/** A representative downtown San Francisco center used only to frame the previews. */
private val PREVIEW_CENTER = GeoPoint(lat = 37.7749, lng = -122.4194)

/** A no-op logger so previews render without the app's [LocalDataContainer] (tooling has no data container). */
private val PreviewLogger =
    object : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

@Preview(name = "WidgetMapView · interactive (wide)", showBackground = true)
@Composable
private fun WidgetMapViewWidePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Box(
            modifier =
                Modifier
                    .width(360.dp)
                    .height(220.dp)
                    .padding(Spacing.md),
            content = { WidgetMapView(center = PREVIEW_CENTER, logger = PreviewLogger) },
        )
    }
}

@Preview(name = "WidgetMapView · compact (static thumbnail)", showBackground = true)
@Composable
private fun WidgetMapViewCompactPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Box(
            modifier =
                Modifier
                    .width(180.dp)
                    .height(120.dp)
                    .padding(Spacing.md),
            content = { WidgetMapView(center = PREVIEW_CENTER, zoom = 15f, compact = true, logger = PreviewLogger) },
        )
    }
}

@Preview(name = "WidgetMapView · empty", showBackground = true)
@Composable
private fun WidgetMapViewEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Box(
            modifier =
                Modifier
                    .width(320.dp)
                    .height(160.dp)
                    .padding(Spacing.md),
            content = { WidgetMapViewContent(center = PREVIEW_CENTER, isEmpty = true) },
        )
    }
}
