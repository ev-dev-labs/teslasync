package io.teslasync.android.components.maps

import java.time.Instant
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.roundToLong
import kotlin.math.sin
import kotlin.math.sqrt

/*
 * Framework-free maps math + state machines shared by every wrapper in this package.
 * Extracted so the behavior (bounds fitting, grid clustering, bearing/distance, the
 * route-playback clock, geofence description, and the accessible map summaries) is
 * covered by fast JVM unit tests in the `:android:testDebugUnitTest` gate, independent
 * of the Google Maps Compose render layer.
 */

/** Replay rates offered by the playback controls (matches the web `SPEEDS`). */
val PLAYBACK_SPEEDS: List<Int> = listOf(1, 10, 25, 50, 100)

private const val EARTH_RADIUS_M = 6_371_000.0
private const val DEG_TO_RAD = Math.PI / 180.0
private const val RAD_TO_DEG = 180.0 / Math.PI
private const val FULL_CIRCLE_DEG = 360.0
private const val TILE_SIZE_PX = 256.0
private const val MIN_CLUSTER_ZOOM = 1.0
private const val MAX_CLUSTER_ZOOM = 22.0
private const val MS_PER_SECOND = 1000L
private const val SECONDS_PER_MINUTE = 60
private const val SECONDS_PER_HOUR = 3600

// ── Geometry — distance, bearing, bounds ─────────────────────────────────────

/** Great-circle distance in meters between [a] and [b] (haversine). */
fun haversineMeters(
    a: GeoPoint,
    b: GeoPoint,
): Double {
    val dLat = (b.lat - a.lat) * DEG_TO_RAD
    val dLng = (b.lng - a.lng) * DEG_TO_RAD
    val lat1 = a.lat * DEG_TO_RAD
    val lat2 = b.lat * DEG_TO_RAD
    val h = sin(dLat / 2).let { it * it } + cos(lat1) * cos(lat2) * sin(dLng / 2).let { it * it }
    return 2 * EARTH_RADIUS_M * atan2(sqrt(h), sqrt(1 - h))
}

/**
 * Initial compass bearing from [a] to [b] in degrees (0 = north, clockwise). Used to
 * rotate the animated vehicle glyph. Mirrors the web `computeHeading`.
 */
fun headingBetween(
    a: GeoPoint,
    b: GeoPoint,
): Double {
    val dLng = (b.lng - a.lng) * DEG_TO_RAD
    val lat1 = a.lat * DEG_TO_RAD
    val lat2 = b.lat * DEG_TO_RAD
    val y = sin(dLng) * cos(lat2)
    val x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLng)
    return (atan2(y, x) * RAD_TO_DEG + FULL_CIRCLE_DEG) % FULL_CIRCLE_DEG
}

/** Tight lat/lng box around the valid [points], or `null` when none are valid. */
fun boundsOf(points: List<GeoPoint>): MapBounds? {
    val valid = points.filter { it.isValid() }
    if (valid.isEmpty()) return null
    return MapBounds(
        south = valid.minOf { it.lat },
        west = valid.minOf { it.lng },
        north = valid.maxOf { it.lat },
        east = valid.maxOf { it.lng },
    )
}

/** Grows [bounds] outward by [fraction] of its span so fitted markers are not clipped at the edge. */
fun padBounds(
    bounds: MapBounds,
    fraction: Double = 0.15,
): MapBounds {
    val latPad = ((bounds.north - bounds.south) * fraction).coerceAtLeast(MIN_PAD_DEG)
    val lngPad = ((bounds.east - bounds.west) * fraction).coerceAtLeast(MIN_PAD_DEG)
    return MapBounds(
        south = (bounds.south - latPad).coerceAtLeast(GeoPoint.MIN_LAT),
        west = (bounds.west - lngPad).coerceAtLeast(GeoPoint.MIN_LNG),
        north = (bounds.north + latPad).coerceAtMost(GeoPoint.MAX_LAT),
        east = (bounds.east + lngPad).coerceAtMost(GeoPoint.MAX_LNG),
    )
}

/** Linear interpolation between [a] and [b] at fraction [t] (clamped to `0..1`). */
fun lerpDouble(
    a: Double,
    b: Double,
    t: Float,
): Double = a + (b - a) * t.coerceIn(0f, 1f)

/** Axis-aligned rectangle ring (SW, SE, NE, NW) spanning the two diagonal corners [a] and [b]. */
fun rectangleRing(
    a: GeoPoint,
    b: GeoPoint,
): List<GeoPoint> {
    val south = minOf(a.lat, b.lat)
    val north = maxOf(a.lat, b.lat)
    val west = minOf(a.lng, b.lng)
    val east = maxOf(a.lng, b.lng)
    return listOf(
        GeoPoint(south, west),
        GeoPoint(south, east),
        GeoPoint(north, east),
        GeoPoint(north, west),
    )
}

/**
 * Assembles the draft geometry the geofence drawer is currently building for [mode] from the
 * accumulated input, or `null` while it is still incomplete (so the Save action can disable).
 */
fun draftGeofence(
    mode: GeofenceShape,
    center: GeoPoint?,
    radiusMeters: Double,
    vertices: List<GeoPoint>,
): DraftGeofence? =
    when (mode) {
        GeofenceShape.Circle ->
            center?.let { DraftGeofence(GeofenceShape.Circle, center = it, radiusMeters = radiusMeters) }
        GeofenceShape.Rectangle ->
            if (vertices.size == RECTANGLE_VERTICES) DraftGeofence(GeofenceShape.Rectangle, polygon = vertices) else null
        GeofenceShape.Polygon ->
            if (vertices.size >= MIN_POLYGON_VERTICES) DraftGeofence(GeofenceShape.Polygon, polygon = vertices) else null
    }

// ── Clustering ───────────────────────────────────────────────────────────────

/** Web-Mercator degrees spanned by [radiusPx] screen pixels at [zoom]. */
fun clusterCellDegrees(
    zoom: Double,
    radiusPx: Int,
): Double {
    val z = zoom.coerceIn(MIN_CLUSTER_ZOOM, MAX_CLUSTER_ZOOM)
    val worldPx = TILE_SIZE_PX * Math.pow(2.0, z)
    return radiusPx.coerceAtLeast(1) * FULL_CIRCLE_DEG / worldPx
}

/**
 * Grid-clusters [markers] for the given [zoom]: points whose centers fall in the same
 * [radiusPx]-sized cell collapse into one [MarkerCluster] at their centroid. At or above
 * [disableAtZoom] every marker stays separate (count 1). Deterministic + pure so the
 * grouping is unit-tested; the composable renders the result as bubbles / dots.
 */
fun clusterMarkers(
    markers: List<MapMarker>,
    zoom: Double,
    radiusPx: Int = 60,
    disableAtZoom: Double = 16.0,
): List<MarkerCluster> {
    val valid = markers.filter { it.point.isValid() }
    return when {
        valid.isEmpty() -> emptyList()
        zoom >= disableAtZoom -> valid.map { MarkerCluster(it.point, 1, listOf(it.id)) }
        else -> bucketIntoClusters(valid, clusterCellDegrees(zoom, radiusPx))
    }
}

private fun bucketIntoClusters(
    markers: List<MapMarker>,
    cell: Double,
): List<MarkerCluster> {
    val buckets = LinkedHashMap<Pair<Long, Long>, MutableList<MapMarker>>()
    for (m in markers) {
        val key = Math.floor(m.point.lat / cell).toLong() to Math.floor(m.point.lng / cell).toLong()
        buckets.getOrPut(key) { mutableListOf() }.add(m)
    }
    return buckets.values.map { members ->
        MarkerCluster(
            point = GeoPoint(members.map { it.point.lat }.average(), members.map { it.point.lng }.average()),
            count = members.size,
            memberIds = members.map { it.id },
        )
    }
}

// ── Route playback clock ─────────────────────────────────────────────────────

/** Per-sample elapsed offsets (ms) from the first sample. Non-finite stamps clamp to 0. */
fun routeOffsetsMs(samples: List<RouteSample>): List<Long> {
    if (samples.isEmpty()) return emptyList()
    val t0 = samples.first().timestampMs
    return samples.map { (it.timestampMs - t0).coerceAtLeast(0L) }
}

/** Total replay span in ms (last offset), or 0 for an empty / single-point route. */
fun playbackTotalMs(offsets: List<Long>): Long = if (offsets.isEmpty()) 0L else offsets.last()

/** Nearest sample index for an elapsed [targetMs] across sorted [offsets] (binary search). */
fun indexAtElapsed(
    offsets: List<Long>,
    targetMs: Long,
): Int {
    if (offsets.isEmpty()) return 0
    var lo = 0
    var hi = offsets.lastIndex
    while (lo < hi) {
        val mid = (lo + hi) ushr 1
        if (offsets[mid] < targetMs) lo = mid + 1 else hi = mid
    }
    return if (lo > 0 && targetMs - offsets[lo - 1] < offsets[lo] - targetMs) lo - 1 else lo
}

/** Travel bearing at sample [index] (uses the segment ending at [index]). */
fun headingAtIndex(
    samples: List<RouteSample>,
    index: Int,
): Double {
    if (samples.size < 2) return 0.0
    val next = index.coerceIn(0, samples.lastIndex).coerceAtLeast(1)
    return headingBetween(samples[next - 1].point, samples[next].point)
}

/** Clamps [speed] to the nearest supported rate, defaulting to 1×. */
fun normalizePlaybackSpeed(speed: Int): Int = if (speed in PLAYBACK_SPEEDS) speed else 1

/** Advances the clock by one [tickMs] frame at the current speed; stops at the end. */
fun playbackTick(
    state: PlaybackState,
    offsets: List<Long>,
    tickMs: Int,
): PlaybackState {
    if (!state.playing) return state
    val total = playbackTotalMs(offsets)
    return when {
        offsets.size < 2 || total <= 0L -> state.copy(playing = false)
        else -> {
            val next = state.elapsedMs + tickMs.toLong() * state.speed
            if (next >= total) {
                state.copy(elapsedMs = total, index = offsets.lastIndex, playing = false)
            } else {
                state.copy(elapsedMs = next, index = indexAtElapsed(offsets, next))
            }
        }
    }
}

/** Jumps the cursor to a `[0,1]` [progress] of the total span. */
fun playbackSeek(
    state: PlaybackState,
    offsets: List<Long>,
    progress: Float,
): PlaybackState {
    val total = playbackTotalMs(offsets)
    val target = (progress.coerceIn(0f, 1f) * total).roundToLong()
    return state.copy(elapsedMs = target, index = indexAtElapsed(offsets, target))
}

/** Starts playback; if the cursor is at the end it rewinds first. No-op for < 2 samples. */
fun playbackPlay(
    state: PlaybackState,
    offsets: List<Long>,
): PlaybackState {
    val total = playbackTotalMs(offsets)
    if (offsets.size < 2 || total <= 0L) return state.copy(playing = false)
    val atEnd = state.elapsedMs >= total
    return state.copy(playing = true, elapsedMs = if (atEnd) 0L else state.elapsedMs, index = if (atEnd) 0 else state.index)
}

/** Pauses without moving the cursor. */
fun playbackPause(state: PlaybackState): PlaybackState = state.copy(playing = false)

/** Stops and rewinds the cursor to the start. */
fun playbackStop(state: PlaybackState): PlaybackState = state.copy(playing = false, elapsedMs = 0L, index = 0)

/** Sets the replay rate, clamped to a supported value. */
fun playbackSetSpeed(
    state: PlaybackState,
    speed: Int,
): PlaybackState = state.copy(speed = normalizePlaybackSpeed(speed))

/** Current `[0,1]` progress of the clock across the total span. */
fun playbackProgress(
    state: PlaybackState,
    offsets: List<Long>,
): Float {
    val total = playbackTotalMs(offsets)
    return if (total <= 0L) 0f else (state.elapsedMs.toFloat() / total).coerceIn(0f, 1f)
}

// ── Formatting + parsing ─────────────────────────────────────────────────────

/** `mm:ss`, or `h:mm:ss` past an hour. Mirrors the web `fmtDuration`. */
fun formatElapsed(ms: Long): String {
    val totalSec = (max(0L, ms) / MS_PER_SECOND).toInt()
    val h = totalSec / SECONDS_PER_HOUR
    val m = (totalSec % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE
    val s = totalSec % SECONDS_PER_MINUTE
    val mm = m.toString().padStart(2, '0')
    val ss = s.toString().padStart(2, '0')
    return if (h > 0) "$h:$mm:$ss" else "$mm:$ss"
}

/** Parses an ISO-8601 instant to epoch ms (API 26+ `java.time`), or `null` when unparseable. */
fun parseIsoTimestampMs(iso: String): Long? = runCatching { Instant.parse(iso).toEpochMilli() }.getOrNull()

// ── Layer selection ──────────────────────────────────────────────────────────

/** The next style in the fixed cycle — backs keyboard / single-button layer toggling. */
fun nextMapStyle(current: MapStyleId): MapStyleId {
    val values = MapStyleId.entries
    return values[(current.ordinal + 1) % values.size]
}

// ── Accessible summaries (the screen-reader list alternative) ────────────────

/** One screen-reader line per marker: title (or id), coordinates, and severity. */
fun markerSummaryLines(markers: List<MapMarker>): List<String> =
    markers.map { m ->
        "${m.title ?: m.id} \u2014 ${formatLatLng(m.point)} (${m.severity.name.lowercase()})"
    }

/** One line per cluster / marker: a grouped count or a single point, with coordinates. */
fun clusterSummaryLines(clusters: List<MarkerCluster>): List<String> =
    clusters.map { c ->
        if (c.isCluster) {
            "${c.count} markers near ${formatLatLng(c.point)}"
        } else {
            "1 marker at ${formatLatLng(c.point)}"
        }
    }

/** A single-sentence overview of a replay route: sample count, distance, and duration. */
fun routeSummaryLine(samples: List<RouteSample>): String {
    if (samples.isEmpty()) return "Route with no GPS points."
    val pts = samples.map { it.point }
    val meters = (1 until pts.size).sumOf { haversineMeters(pts[it - 1], pts[it]) }
    val km = meters / 1000.0
    val durationMs = playbackTotalMs(routeOffsetsMs(samples))
    return "Route of ${samples.size} points, ${formatOneDecimal(km)} km over ${formatElapsed(durationMs)}."
}

/** One human-readable line per geofence (the web `describeFence`). */
fun describeGeofence(fence: MapGeofence): String {
    val name = fence.name ?: "Geofence"
    return when (fence.shape()) {
        GeofenceShape.Circle ->
            "$name \u2014 ${formatMeters(fence.radiusMeters ?: 0.0)} circle around ${formatLatLng(fence.center!!)}"
        GeofenceShape.Rectangle -> "$name \u2014 rectangle of ${fence.polygon.size} corners"
        GeofenceShape.Polygon -> "$name \u2014 ${fence.polygon.size}-vertex polygon"
    }
}

/** One descriptive line per geofence for the accessible list. */
fun geofenceSummaryLines(fences: List<MapGeofence>): List<String> = fences.map { describeGeofence(it) }

// ── Small formatting helpers ─────────────────────────────────────────────────

internal fun formatLatLng(point: GeoPoint): String = "${formatCoord(point.lat)}, ${formatCoord(point.lng)}"

private fun formatCoord(value: Double): String = (((value * COORD_SCALE).roundToInt()) / COORD_SCALE).toString()

private fun formatOneDecimal(value: Double): String = ((value * 10).roundToInt() / 10.0).toString()

private fun formatMeters(meters: Double): String = "${meters.roundToInt()}m"

private const val COORD_SCALE = 10_000.0
private const val MIN_PAD_DEG = 0.0005
private const val MIN_POLYGON_VERTICES = 3
