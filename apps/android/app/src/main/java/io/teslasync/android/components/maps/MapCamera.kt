package io.teslasync.android.components.maps

import androidx.compose.runtime.Composable
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.LatLngBounds
import com.google.maps.android.compose.CameraPositionState
import com.google.maps.android.compose.rememberCameraPositionState

/*
 * Bridges the framework-free maps model (`GeoPoint`, `MapBounds`, `CameraSnapshot`) to the gms
 * types the Google Maps Compose layer consumes, and exposes the camera state. maps-compose's
 * `rememberCameraPositionState` already persists through `rememberSaveable`, so wrapping it here
 * gives the pages camera-state restoration (config change / process death) for free.
 */

/** gms coordinate for this point. */
fun GeoPoint.toLatLng(): LatLng = LatLng(lat, lng)

/** Framework-free point for a gms coordinate. */
fun LatLng.toGeoPoint(): GeoPoint = GeoPoint(latitude, longitude)

/** gms bounds for this box. */
fun MapBounds.toLatLngBounds(): LatLngBounds = LatLngBounds(LatLng(south, west), LatLng(north, east))

/** gms camera pose for this snapshot. */
fun CameraSnapshot.toCameraPosition(): CameraPosition =
    CameraPosition
        .Builder()
        .target(target.toLatLng())
        .zoom(zoom)
        .bearing(bearing)
        .tilt(tilt)
        .build()

/** Framework-free snapshot of the current camera pose (for summaries / persistence / tests). */
fun CameraPositionState.toSnapshot(): CameraSnapshot {
    val p = position
    return CameraSnapshot(p.target.toGeoPoint(), p.zoom, p.bearing, p.tilt)
}

/**
 * Camera state seeded at [initial] and restored across recomposition / config change. Pass the
 * returned state to [TeslaMap]; read [toSnapshot] to persist or describe the current view.
 */
@Composable
fun rememberMapCameraState(initial: CameraSnapshot = DEFAULT_MAP_CAMERA): CameraPositionState =
    rememberCameraPositionState { position = initial.toCameraPosition() }

/** A neutral world view used when a page has no initial focus yet. */
val DEFAULT_MAP_CAMERA: CameraSnapshot = CameraSnapshot(GeoPoint(20.0, 0.0), 1.5f)
