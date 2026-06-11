package io.teslasync.android.components.maps

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Visual gallery of the maps layer's previewable chrome — the layer switcher and the accessible
 * marker / route / geofence summaries that render without Google Play Services. The live map
 * surfaces (`TeslaMap`, `RoutePlayback`, `GeofenceDrawer`) need a device with Maps SDK, so they
 * compile here but are exercised on-device; their behavior is covered by `MapsLogicTest`.
 */
@Composable
private fun MapsGallery() {
    var style by remember { mutableStateOf(MapStyleId.Dark) }
    Surface(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.verticalScroll(rememberScrollState()).padding(Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            Section("Layer switcher") {
                MapLayerSwitcher(current = style, onChange = { style = it })
            }
            Section("Marker / cluster summary") {
                MapAccessibleSummary(
                    label = "Vehicles",
                    lines = clusterSummaryLines(clusterMarkers(sampleMarkers, zoom = 6.0)),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Section("Route summary") {
                MapAccessibleSummary(
                    label = "Route",
                    lines = listOf(routeSummaryLine(sampleRoute)),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Section("Geofence summary") {
                MapAccessibleSummary(
                    label = "Geofences",
                    lines = geofenceSummaryLines(sampleFences),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

private val sampleMarkers =
    listOf(
        MapMarker("v1", GeoPoint(37.7749, -122.4194), title = "Model 3", severity = MapMarkerSeverity.Active, headingDegrees = 45.0),
        MapMarker("v2", GeoPoint(37.7752, -122.4189), title = "Model Y", severity = MapMarkerSeverity.Success),
        MapMarker("v3", GeoPoint(37.8044, -122.2712), title = "Model S", severity = MapMarkerSeverity.Warning),
    )

private val sampleRoute =
    listOf(
        RouteSample(GeoPoint(37.7749, -122.4194), 0L, speed = 0.0),
        RouteSample(GeoPoint(37.7800, -122.4100), 120_000L, speed = 12.0),
        RouteSample(GeoPoint(37.8044, -122.2712), 600_000L, speed = 0.0),
    )

private val sampleFences =
    listOf(
        MapGeofence("g1", name = "Home", center = GeoPoint(37.7749, -122.4194), radiusMeters = 150.0),
        MapGeofence("g2", name = "Depot", polygon = rectangleRing(GeoPoint(37.80, -122.28), GeoPoint(37.81, -122.27))),
    )

@Composable
private fun Section(
    title: String,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        SectionTitle(title)
        content()
    }
}

@Preview(name = "Maps \u00b7 Light", showBackground = true, heightDp = 1000)
@Composable
private fun MapsGalleryLightPreview() {
    TeslaSyncTheme(darkTheme = false) { MapsGallery() }
}

@Preview(name = "Maps \u00b7 Dark", showBackground = true, heightDp = 1000)
@Composable
private fun MapsGalleryDarkPreview() {
    TeslaSyncTheme(darkTheme = true) { MapsGallery() }
}

@Preview(name = "Maps \u00b7 High contrast", showBackground = true, heightDp = 1000)
@Composable
private fun MapsGalleryHighContrastPreview() {
    TeslaSyncTheme(highContrast = true) { MapsGallery() }
}
