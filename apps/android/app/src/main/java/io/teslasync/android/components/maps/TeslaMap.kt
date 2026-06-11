package io.teslasync.android.components.maps

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import com.google.android.gms.maps.model.MapStyleOptions
import com.google.maps.android.compose.CameraPositionState
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.GoogleMapComposable
import com.google.maps.android.compose.MapProperties
import com.google.maps.android.compose.MapType
import com.google.maps.android.compose.MapUiSettings

// The map content slot — markers, polylines, and shapes — composed inside [TeslaMap]'s `GoogleMap`.
// ktlint's annotation rule cannot stably format a function type carrying two annotations, so it is
// suppressed for this single declaration; the @GoogleMapComposable target keeps callers' map
// content correctly typed (no applier-mismatch warnings).
@Suppress("ktlint:standard:annotation")
typealias GoogleMapContent = @Composable @GoogleMapComposable () -> Unit

/*
 * The central map surface — the Android counterpart of the web `MapContainer` + `MapTileLayer`.
 * Wraps Google Maps Compose's `GoogleMap`, applies the brand base-map style (token-tinted JSON
 * for the dark base, native map types for satellite / terrain), wires a SDK-free click callback,
 * and forwards an accessible content description to the map's own semantics. Pages place markers,
 * polylines, and shapes in the [content] slot and never import the maps SDK directly.
 */

/** Maps a [MapStyleId] to the underlying Google map type. */
fun gmsMapType(style: MapStyleId): MapType =
    when (style) {
        MapStyleId.Dark -> MapType.NORMAL
        MapStyleId.Streets -> MapType.NORMAL
        MapStyleId.Satellite -> MapType.SATELLITE
        MapStyleId.Terrain -> MapType.TERRAIN
    }

/** Token-tinted style options for the dark base map; `null` for the native map types. */
@Composable
fun rememberMapStyleOptions(style: MapStyleId): MapStyleOptions? {
    val colors =
        MapStyleColors(
            landHex = colorToHex(MaterialTheme.colorScheme.surface),
            waterHex = colorToHex(MaterialTheme.colorScheme.surfaceVariant),
            roadHex = colorToHex(MaterialTheme.colorScheme.outlineVariant),
            textHex = colorToHex(MaterialTheme.colorScheme.onSurfaceVariant),
            strokeHex = colorToHex(MaterialTheme.colorScheme.surface),
        )
    val json = darkMapStyleJson(colors)
    return remember(style, json) {
        if (style == MapStyleId.Dark) MapStyleOptions(json) else null
    }
}

/** Map gesture / control defaults: gestures on, redundant Google chrome off (we supply our own). */
fun defaultMapUiSettings(): MapUiSettings =
    MapUiSettings(
        compassEnabled = true,
        mapToolbarEnabled = false,
        myLocationButtonEnabled = false,
        zoomControlsEnabled = false,
    )

/**
 * The framing map surface for every map-bearing page. [contentDescription] is announced by the
 * map's own accessibility node; pair it with a `MapAccessibleSummary` for the marker / route /
 * geofence list alternative.
 */
@Composable
fun TeslaMap(
    modifier: Modifier = Modifier,
    cameraPositionState: CameraPositionState = rememberMapCameraState(),
    style: MapStyleId = MapStyleId.Dark,
    contentDescription: String? = null,
    trafficEnabled: Boolean = false,
    uiSettings: MapUiSettings = defaultMapUiSettings(),
    onMapClick: (GeoPoint) -> Unit = {},
    onMapLoaded: () -> Unit = {},
    content: GoogleMapContent = {},
) {
    val styleOptions = rememberMapStyleOptions(style)
    val properties =
        MapProperties(
            mapType = gmsMapType(style),
            mapStyleOptions = styleOptions,
            isTrafficEnabled = trafficEnabled,
        )
    GoogleMap(
        modifier = modifier,
        cameraPositionState = cameraPositionState,
        contentDescription = contentDescription,
        properties = properties,
        uiSettings = uiSettings,
        onMapClick = { onMapClick(it.toGeoPoint()) },
        onMapLoaded = onMapLoaded,
        content = content,
    )
}
