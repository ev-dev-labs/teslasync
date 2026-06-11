package io.teslasync.android.components.maps

/*
 * Framework-free data model for the maps layer, mirroring the props the web
 * `components/maps` wrappers accept. Pages build these immutable values from
 * SI-domain data (meters, m/s) plus display-formatted labels and hand them to the
 * map wrappers; the wrappers own all Google Maps Compose rendering so pages never
 * import the maps SDK directly.
 *
 * Everything here is plain Kotlin (no Android / gms types) so the geometry, cluster,
 * route-playback, and accessible-summary logic in `MapsLogic.kt` is covered by fast
 * JVM unit tests in the `:android:testDebugUnitTest` gate. Composables convert these
 * to gms `LatLng`/`CameraPosition` only at the render boundary.
 */

/** A WGS-84 coordinate. Kept SDK-free so it round-trips through pure logic + tests. */
data class GeoPoint(
    val lat: Double,
    val lng: Double,
) {
    /** True when both components are finite and inside the valid lat/lng envelope. */
    fun isValid(): Boolean =
        lat.isFinite() &&
            lng.isFinite() &&
            lat in MIN_LAT..MAX_LAT &&
            lng in MIN_LNG..MAX_LNG

    companion object {
        const val MIN_LAT = -90.0
        const val MAX_LAT = 90.0
        const val MIN_LNG = -180.0
        const val MAX_LNG = 180.0
    }
}

/**
 * Selectable base-map styles, the Android counterpart of the web `MapStyle`. `Dark`
 * is the brand default (a token-tinted style JSON over the normal raster); the others
 * map onto Google's native map types — see `MapStyle.kt`.
 */
enum class MapStyleId { Dark, Streets, Satellite, Terrain }

/** Severity tint for a marker; resolved to the per-theme status palette in `MapsColors`. */
enum class MapMarkerSeverity { Info, Active, Success, Warning, Critical }

/**
 * One point of interest on the map. [headingDegrees] (0 = north, clockwise) rotates the
 * vehicle glyph; `null` renders an un-rotated dot. [severity] drives the token color when
 * no explicit color is supplied at render time.
 */
data class MapMarker(
    val id: String,
    val point: GeoPoint,
    val title: String? = null,
    val snippet: String? = null,
    val severity: MapMarkerSeverity = MapMarkerSeverity.Active,
    val headingDegrees: Double? = null,
)

/**
 * The output of [clusterMarkers]: either a single marker ([count] == 1, one member) or a
 * grouped bubble ([count] > 1) anchored at the member centroid. [memberIds] preserves the
 * source [MapMarker.id]s so callers can build the accessible list and expand-on-tap.
 */
data class MarkerCluster(
    val point: GeoPoint,
    val count: Int,
    val memberIds: List<String>,
) {
    val isCluster: Boolean get() = count > 1
}

/**
 * One time-stamped GPS sample for [RoutePlayback]. [timestampMs] is epoch milliseconds
 * (pages convert ISO-8601 via [parseIsoTimestampMs]); optional metrics are surfaced as the
 * scrub cursor moves. Values are SI (m/s, fraction, watts) and formatted at the boundary.
 */
data class RouteSample(
    val point: GeoPoint,
    val timestampMs: Long,
    val speed: Double? = null,
    val soc: Double? = null,
    val power: Double? = null,
)

/** An axis-aligned lat/lng box used for camera bounds fitting. */
data class MapBounds(
    val south: Double,
    val west: Double,
    val north: Double,
    val east: Double,
) {
    val center: GeoPoint get() = GeoPoint((south + north) / 2.0, (west + east) / 2.0)

    fun contains(point: GeoPoint): Boolean = point.lat in south..north && point.lng in west..east
}

/**
 * A restorable camera pose. Persisted via `rememberSaveable` so a config change / process
 * death returns the user to the same view (the camera-state-restoration requirement).
 */
data class CameraSnapshot(
    val target: GeoPoint,
    val zoom: Float,
    val bearing: Float = 0f,
    val tilt: Float = 0f,
)

/** The geometry kinds the geofence drawer can produce / render. */
enum class GeofenceShape { Circle, Polygon, Rectangle }

/**
 * A persisted geofence. A circle sets [center] + [radiusMeters]; a polygon / rectangle
 * sets [polygon] (a closed ring of vertices). [shape] is derived from which fields are set.
 */
data class MapGeofence(
    val id: String,
    val name: String? = null,
    val center: GeoPoint? = null,
    val radiusMeters: Double? = null,
    val polygon: List<GeoPoint> = emptyList(),
) {
    fun shape(): GeofenceShape =
        when {
            center != null && radiusMeters != null -> GeofenceShape.Circle
            polygon.size == RECTANGLE_VERTICES && isAxisAligned(polygon) -> GeofenceShape.Rectangle
            else -> GeofenceShape.Polygon
        }
}

/** New geometry emitted by the drawer before it is assigned an id by the caller. */
data class DraftGeofence(
    val shape: GeofenceShape,
    val center: GeoPoint? = null,
    val radiusMeters: Double? = null,
    val polygon: List<GeoPoint> = emptyList(),
)

/**
 * The deterministic route-playback clock. Pure transitions in `MapsLogic.kt`
 * (`playbackTick`, `playbackSeek`, `playbackPlay`/`Pause`/`Stop`, `playbackSetSpeed`) make
 * the replay engine fully unit-testable without a real animation loop.
 */
data class PlaybackState(
    val index: Int = 0,
    val elapsedMs: Long = 0L,
    val playing: Boolean = false,
    val speed: Int = 1,
)

internal const val RECTANGLE_VERTICES = 4

private fun isAxisAligned(ring: List<GeoPoint>): Boolean {
    if (ring.size != RECTANGLE_VERTICES) return false
    val lats = ring.map { it.lat }.toSet()
    val lngs = ring.map { it.lng }.toSet()
    return lats.size == 2 && lngs.size == 2
}
