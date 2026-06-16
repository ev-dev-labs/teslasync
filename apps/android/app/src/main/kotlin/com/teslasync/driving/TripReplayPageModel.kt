// Pure, framework-free model + projections for the TripReplayPage driving surface — the native analogue of everything
// the web page derives before composing its panels (web/src/features/trips/pages/TripReplayPage.tsx, re-exported from
// web/src/features/driving/pages/TripReplayPage.tsx). No Compose, no Android UI, no HTTP: every declaration here is plain
// Kotlin (it references only the shared-core SI converters, the framework-free ChartFormat helper, and the pure
// chart/scrubber data types), so the composable stays a thin render layer and all of this is exercised off-device by the
// :android:testDebugUnitTest gate.
//
// The web page reads a single source — `useDrive(id)` (`GET /drives/{id}/`, raw JSON) — and threads it through a long
// useMemo chain: it merges each GPS `position` with its nearest-by-timestamp `telemetry` row (so power/battery/elevation
// /range/temperature are filled), derives the speed+power timeline, the elevation profile, the timeline markers, the
// speed sparkline, and the drive-summary stats. This file ports every one of those derivations verbatim
// ([parseDriveReplay], [computeReplayMarkers], [nearestMarker], [buildTimeline], [buildElevation], [speedSparkData],
// [buildRouteSegments], the stat/summary formatters).
//
// SI boundary (unit-conversion.instructions): position-derived fields (speed, outsideTemp, ratedRange, cumulative
// haversine distance) are SI canonical; the only display conversion lives in the explicit formatter helpers used at the
// render boundary (`convertSpeedFromSI` / `convertDistanceFromSI` / `convertTempFromSI`), exactly as the web page
// converts only inside its `convertXFromSI` callbacks (Phase-48 SI-canonical rule; ADR-013 keeps the cache SI).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from the
// `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.driving.tripreplay

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ElevationPoint
import io.teslasync.android.components.datadisplay.TimelineMarker
import io.teslasync.android.components.datadisplay.TimelineMarkerKind
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.convertSpeedFromSI
import io.teslasync.shared.core.units.convertTempFromSI
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `TripReplayPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `hidden("tripReplay", "/drives/:id/replay", …, listOf("id"))`, so [io.teslasync.android.navigation.PageHosts] binds this
 * surface to that destination (and its `/drives/:id/replay` deep link) without the nav module depending on it.
 */
object TripReplayPageRegistration {
    /** The navigation destination id (Destinations.kt `hidden("tripReplay", "/drives/:id/replay", …)`). */
    const val ROUTE_ID: String = "tripReplay"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/drives/:id/replay"

    /** The path-argument key carrying the drive id (`{id}`). */
    const val ARG_ID: String = "id"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle/drive id. */
    const val SLUG: String = "TripReplayPage"

    /** Target sample count for the scrubber speed sparkline (web `target = 80`). */
    const val SPARK_TARGET: Int = 80
}

/* ------------------------------------------------------------------ */
/*  Merged replay point (position ⋈ nearest telemetry)                */
/* ------------------------------------------------------------------ */

/**
 * One sample along the trip — the native mirror of the web `DrivePosition` after the page merges each GPS position with
 * its nearest-by-timestamp telemetry row. Position-derived numeric fields are SI canonical (meters, m/s, °C); `power` is
 * already kW on the wire (the backend derives `pack_voltage × pack_current / 1000`), matching the web page which renders
 * it directly as "kW".
 */
data class ReplayPoint(
    val latitude: Double,
    val longitude: Double,
    /** Instantaneous speed in SI m/s, or `null` when unknown (web `p.speed`). */
    val speedMps: Double?,
    /** Instantaneous battery power in kW; negative is regen (web `p.power`). */
    val power: Double?,
    /** State-of-charge percentage (web `p.batteryLevel`). */
    val batteryLevel: Double,
    /** Epoch-millisecond timestamp of this sample. */
    val timestampMs: Long,
    /** Elevation in meters, or `null` (web `p.elevation`). */
    val elevation: Double?,
    /** Outside temperature in SI °C, or `null` (web `p.outsideTemp`). */
    val outsideTemp: Double?,
    /** Rated range remaining in SI meters, or `null` (web `p.ratedRange`). */
    val ratedRange: Double?,
)

/**
 * The decoded `GET /drives/{id}/` payload the page reads — the drive summary fields plus the merged [positions] list.
 * [present] mirrors the web `drive ?` truthiness; an absent / non-object body yields [ABSENT] so a still-empty load
 * routes to the friendly `replay.noGps` empty surface instead of a grid of zeros.
 */
data class DriveReplay(
    val present: Boolean,
    val driveId: Long,
    /** Drive start timestamp (epoch ms) for the header subtitle, or `null`. */
    val startTsMs: Long?,
    val startAddress: String?,
    val endAddress: String?,
    /** Total drive distance in SI meters (web `drive.distanceM`). */
    val distanceM: Double,
    /** Total drive duration in SI seconds (web `drive.durationS`). */
    val durationS: Double,
    /** Start state-of-charge percentage, or `null` (web `drive.startBatteryPct`). */
    val startBatteryPct: Double?,
    /** End state-of-charge percentage, or `null` (web `drive.endBatteryPct`). */
    val endBatteryPct: Double?,
    val positions: List<ReplayPoint>,
) {
    companion object {
        /** The "no payload" snapshot, surfaced for a null / non-object / empty body. */
        val ABSENT: DriveReplay =
            DriveReplay(false, 0L, null, null, null, 0.0, 0.0, null, null, emptyList())
    }
}

/**
 * Decodes the raw `GET /drives/{id}/` [json] into a [DriveReplay], merging each `positions` row with its nearest-by-
 * timestamp `telemetry` row (binary search) so power/battery/elevation/range/temperature are filled — the verbatim port
 * of the web page's `telemetryByTs` + `nearestTelemetry` + `positions` useMemo chain. A non-object input yields
 * [DriveReplay.ABSENT]; positions whose lat/lon are both 0 are dropped (web `.filter`).
 */
fun parseDriveReplay(json: JsonElement?): DriveReplay {
    val obj = json as? JsonObject ?: return DriveReplay.ABSENT
    if (obj.isEmpty()) return DriveReplay.ABSENT

    val telemetry = (obj["telemetry"] as? JsonArray)?.mapNotNull { it as? JsonObject } ?: emptyList()
    val telemetryByTs =
        telemetry
            .mapNotNull { row -> row.timestampMs()?.let { ts -> ts to row } }
            .sortedBy { it.first }

    val positions =
        (obj["positions"] as? JsonArray)
            ?.mapNotNull { it as? JsonObject }
            ?.mapNotNull { p ->
                val lat = p.double("latitude") ?: 0.0
                val lon = p.double("longitude") ?: 0.0
                val ts = p.timestampMs() ?: return@mapNotNull null
                val tel = nearestTelemetry(telemetryByTs, ts)
                ReplayPoint(
                    latitude = lat,
                    longitude = lon,
                    speedMps = p.double("speed") ?: tel?.double("speed"),
                    power = p.double("power") ?: tel?.double("power"),
                    batteryLevel = p.double("battery_level") ?: tel?.double("battery_level") ?: 0.0,
                    timestampMs = ts,
                    elevation = p.double("elevation") ?: tel?.double("elevation"),
                    outsideTemp = p.double("outside_temp") ?: tel?.double("outside_temp"),
                    ratedRange = p.double("rated_range") ?: tel?.double("rated_range"),
                )
            }
            ?.filter { it.latitude != 0.0 || it.longitude != 0.0 }
            ?: emptyList()

    return DriveReplay(
        present = true,
        driveId = obj.long("id") ?: 0L,
        startTsMs = obj.timestampMs("start_ts"),
        startAddress = obj.string("start_address"),
        endAddress = obj.string("end_address"),
        distanceM = obj.double("distance_m") ?: 0.0,
        durationS = obj.double("duration_s") ?: 0.0,
        startBatteryPct = obj.double("start_battery_pct"),
        endBatteryPct = obj.double("end_battery_pct"),
        positions = positions,
    )
}

/** Nearest telemetry row to [positionTs] across sorted [telemetryByTs] (web `nearestTelemetry` binary search). */
private fun nearestTelemetry(
    telemetryByTs: List<Pair<Long, JsonObject>>,
    positionTs: Long,
): JsonObject? {
    if (telemetryByTs.isEmpty()) return null
    var lo = 0
    var hi = telemetryByTs.lastIndex
    while (lo < hi) {
        val mid = (lo + hi) ushr 1
        if (telemetryByTs[mid].first < positionTs) lo = mid + 1 else hi = mid
    }
    if (lo > 0 &&
        abs(telemetryByTs[lo - 1].first - positionTs) < abs(telemetryByTs[lo].first - positionTs)
    ) {
        return telemetryByTs[lo - 1].second
    }
    return telemetryByTs[lo].second
}

/* ------------------------------------------------------------------ */
/*  Timeline markers (computeReplayMarkers / nearestMarker)           */
/* ------------------------------------------------------------------ */

/** Trip-replay marker family — the verbatim port of the web `ReplayMarkerKind` union. */
enum class ReplayMarkerKind { Start, Stop, ChargeStart, ChargeStop, FastSegment, RegenPeak, LowSoc, Event }

/** A notable moment along the replay timeline; [at] is normalized 0..1 over elapsed time (web `ReplayMarker`). */
data class ReplayMarker(
    val at: Float,
    val kind: ReplayMarkerKind,
    val label: String? = null,
    val count: Int? = null,
)

/** Adapts a [ReplayMarker] to the scrubber's [TimelineMarker] tick (1:1 kind mapping). */
fun ReplayMarker.toTimelineMarker(): TimelineMarker =
    TimelineMarker(
        at = at,
        kind =
            when (kind) {
                ReplayMarkerKind.Start -> TimelineMarkerKind.Start
                ReplayMarkerKind.Stop -> TimelineMarkerKind.Stop
                ReplayMarkerKind.ChargeStart -> TimelineMarkerKind.ChargeStart
                ReplayMarkerKind.ChargeStop -> TimelineMarkerKind.ChargeStop
                ReplayMarkerKind.FastSegment -> TimelineMarkerKind.FastSegment
                ReplayMarkerKind.RegenPeak -> TimelineMarkerKind.RegenPeak
                ReplayMarkerKind.LowSoc -> TimelineMarkerKind.LowSoc
                ReplayMarkerKind.Event -> TimelineMarkerKind.Event
            },
        label = label,
    )

private const val MIN_CHARGE_MS = 30_000L
private const val MIN_FAST_SEG_MS = 10_000L
private const val REGEN_THRESHOLD_KW = 0.0
private const val LOW_SOC_PCT = 20.0
private const val FAST_PERCENTILE = 0.95
private const val REGEN_PEAK_PERCENTILE = 0.95
private const val MAX_MARKERS = 25
private const val CLUSTER_DISTANCE = 0.04f

/**
 * Computes the replay timeline markers from [positions] — the verbatim port of the web `computeReplayMarkers`. Markers
 * are normalized over elapsed time (not index) so they line up with the playhead under uneven sampling. Handles the
 * empty / single-point / zero-duration / missing-field / clustering edge cases identically to the web.
 */
fun computeReplayMarkers(positions: List<ReplayPoint>): List<ReplayMarker> {
    if (positions.isEmpty()) return emptyList()
    val t0 = positions.first().timestampMs
    val totalMs = positions.last().timestampMs - t0

    if (positions.size < 2 || totalMs <= 0L) {
        val out = mutableListOf(ReplayMarker(0f, ReplayMarkerKind.Start, "Start"))
        if (positions.size > 1) out.add(ReplayMarker(1f, ReplayMarkerKind.Stop, "End"))
        return out
    }

    fun normalize(i: Int): Float {
        val t = 1.0 * (positions[i].timestampMs - t0)
        if (!t.isFinite()) return 0f
        return (t / totalMs).coerceIn(0.0, 1.0).toFloat()
    }

    val markers =
        mutableListOf(
            ReplayMarker(0f, ReplayMarkerKind.Start, "Start"),
            ReplayMarker(1f, ReplayMarkerKind.Stop, "End"),
        )

    // Charge segments: contiguous runs where power < threshold for >= 30s.
    var chargeStart: Int? = null
    for (i in positions.indices) {
        val charging = positions[i].power?.let { it < REGEN_THRESHOLD_KW } ?: false
        if (charging && chargeStart == null) {
            chargeStart = i
        } else if (!charging && chargeStart != null) {
            if (positions[i - 1].timestampMs - positions[chargeStart].timestampMs >= MIN_CHARGE_MS) {
                markers.add(ReplayMarker(normalize(chargeStart), ReplayMarkerKind.ChargeStart, "Charge start"))
                markers.add(ReplayMarker(normalize(i - 1), ReplayMarkerKind.ChargeStop, "Charge stop"))
            }
            chargeStart = null
        }
    }
    chargeStart?.let { start ->
        if (positions.last().timestampMs - positions[start].timestampMs >= MIN_CHARGE_MS) {
            markers.add(ReplayMarker(normalize(start), ReplayMarkerKind.ChargeStart, "Charge start"))
            markers.add(ReplayMarker(normalize(positions.lastIndex), ReplayMarkerKind.ChargeStop, "Charge stop"))
        }
    }

    // Fast segments: contiguous runs where speed > p95 for >= 10s.
    val speeds = positions.mapNotNull { it.speedMps }.filter { it > 0.0 }
    if (speeds.isNotEmpty()) {
        val fastThreshold = safePercentile(speeds, FAST_PERCENTILE)
        var fastStart: Int? = null
        val midpoints = mutableListOf<Float>()
        for (i in positions.indices) {
            val fast = (positions[i].speedMps ?: 0.0) > fastThreshold
            if (fast && fastStart == null) {
                fastStart = i
            } else if (!fast && fastStart != null) {
                if (positions[i - 1].timestampMs - positions[fastStart].timestampMs >= MIN_FAST_SEG_MS) {
                    midpoints.add((normalize(fastStart) + normalize(i - 1)) / 2f)
                }
                fastStart = null
            }
        }
        fastStart?.let { start ->
            if (positions.last().timestampMs - positions[start].timestampMs >= MIN_FAST_SEG_MS) {
                midpoints.add((normalize(start) + normalize(positions.lastIndex)) / 2f)
            }
        }
        midpoints.forEach { markers.add(ReplayMarker(it, ReplayMarkerKind.FastSegment, "Fast segment")) }
    }

    // Regen peaks: positions whose regen power exceeds p95.
    val regenPowers = positions.mapNotNull { it.power }.filter { it < REGEN_THRESHOLD_KW }.map { -it }
    if (regenPowers.isNotEmpty()) {
        val regenThreshold = safePercentile(regenPowers, REGEN_PEAK_PERCENTILE)
        for (i in positions.indices) {
            val pw = positions[i].power
            if (pw != null && -pw >= regenThreshold && pw < REGEN_THRESHOLD_KW) {
                markers.add(ReplayMarker(normalize(i), ReplayMarkerKind.RegenPeak, "Regen peak"))
            }
        }
    }

    // Low SoC: first time battery drops below threshold.
    for (i in positions.indices) {
        if (positions[i].batteryLevel < LOW_SOC_PCT) {
            markers.add(ReplayMarker(normalize(i), ReplayMarkerKind.LowSoc, "Battery <${LOW_SOC_PCT.toInt()}%"))
            break
        }
    }

    // Cluster adjacent same-kind markers when a clustered kind exceeds MAX_MARKERS.
    val clusterKinds = listOf(ReplayMarkerKind.FastSegment, ReplayMarkerKind.RegenPeak)
    val out = mutableListOf<ReplayMarker>()
    clusterKinds.forEach { out.addAll(clusterAdjacent(markers, it)) }
    markers.filter { it.kind !in clusterKinds }.forEach { out.add(it) }
    return out.sortedBy { it.at }
}

/**
 * The marker closest to a normalized playhead [at] within [tolerance], or `null` — the verbatim port of the web
 * `nearestMarker`. Used to highlight stat cards when the playhead is "over" a marker.
 */
fun nearestMarker(
    markers: List<ReplayMarker>,
    at: Float,
    tolerance: Float = 0.02f,
): ReplayMarker? {
    var best: ReplayMarker? = null
    var bestDist = Float.POSITIVE_INFINITY
    for (m in markers) {
        val d = abs(m.at - at)
        if (d <= tolerance && d < bestDist) {
            best = m
            bestDist = d
        }
    }
    return best
}

private fun clusterAdjacent(
    markers: List<ReplayMarker>,
    kind: ReplayMarkerKind,
): List<ReplayMarker> {
    val sameKind = markers.filter { it.kind == kind }.sortedBy { it.at }
    if (sameKind.size <= MAX_MARKERS) return sameKind
    val clustered = mutableListOf<ReplayMarker>()
    var bucket = mutableListOf<ReplayMarker>()
    for (m in sameKind) {
        if (bucket.isEmpty() || m.at - bucket.last().at <= CLUSTER_DISTANCE) {
            bucket.add(m)
        } else {
            clustered.add(collapseBucket(bucket, kind))
            bucket = mutableListOf(m)
        }
    }
    if (bucket.isNotEmpty()) clustered.add(collapseBucket(bucket, kind))
    return clustered
}

private fun collapseBucket(
    bucket: List<ReplayMarker>,
    kind: ReplayMarkerKind,
): ReplayMarker {
    if (bucket.size == 1) return bucket.first()
    val midAt = bucket.map { it.at }.sum() / bucket.size
    return ReplayMarker(midAt, kind, "${bucket.size} ${kindLabel(kind)}", bucket.size)
}

private fun kindLabel(kind: ReplayMarkerKind): String =
    when (kind) {
        ReplayMarkerKind.FastSegment -> "fast segments"
        ReplayMarkerKind.RegenPeak -> "regen peaks"
        ReplayMarkerKind.ChargeStart -> "charge starts"
        ReplayMarkerKind.ChargeStop -> "charge stops"
        ReplayMarkerKind.LowSoc -> "low SoC"
        else -> kind.name
    }

/** Linear-interpolation percentile (numpy default), tolerant of unsorted/duplicate input (web `safePercentile`). */
fun safePercentile(
    values: List<Double>,
    p: Double,
): Double {
    if (values.isEmpty()) return 0.0
    if (values.size == 1) return values.first()
    val sorted = values.sorted()
    val rank = p.coerceIn(0.0, 1.0) * (sorted.size - 1)
    val lower = floor(rank).toInt()
    val upper = kotlin.math.ceil(rank).toInt()
    if (lower == upper) return sorted[lower]
    return sorted[lower] + (rank - lower) * (sorted[upper] - sorted[lower])
}

/* ------------------------------------------------------------------ */
/*  Chart projections (timeline / elevation / sparkline / segments)   */
/* ------------------------------------------------------------------ */

/** One point in the speed + power timeline chart — the web `TripReplayChartPoint` row. */
data class TimelinePoint(
    /** Index into the parent positions array. */
    val index: Int,
    /** Minutes since trip start (web `time`). */
    val timeMin: Double,
    /** Speed in the user's display unit (web `speed`). */
    val speed: Double,
    /** Power in kW (web `power`). */
    val power: Double,
)

/**
 * Projects [positions] into the speed+power timeline in the user's [speedUnit] — the verbatim port of the web
 * `timelineData` useMemo (elapsed minutes on X; `convertSpeedFromSI` for speed; raw kW for power).
 */
fun buildTimeline(
    positions: List<ReplayPoint>,
    unit: UnitPref,
): List<TimelinePoint> {
    if (positions.isEmpty()) return emptyList()
    val t0 = positions.first().timestampMs
    return positions.mapIndexed { i, p ->
        TimelinePoint(
            index = i,
            timeMin = (p.timestampMs - t0) / 60_000.0,
            speed = p.speedMps?.let { convertSpeedFromSI(it, unit.speed) } ?: 0.0,
            power = p.power ?: 0.0,
        )
    }
}

/**
 * Projects [positions] into the elevation profile in the user's units — the verbatim port of the web `elevationData`
 * useMemo (cumulative haversine distance via `convertDistanceFromSI`; elevation in meters; speed via `convertSpeedFromSI`).
 */
fun buildElevation(
    positions: List<ReplayPoint>,
    unit: UnitPref,
): List<ElevationPoint> {
    var cumDistMeters = 0.0
    return positions.mapIndexed { i, p ->
        if (i > 0) {
            cumDistMeters +=
                haversineMeters(
                    positions[i - 1].latitude, positions[i - 1].longitude,
                    p.latitude, p.longitude,
                )
        }
        ElevationPoint(
            distance = round2(convertDistanceFromSI(cumDistMeters, unit.distance)),
            elevation = p.elevation ?: 0.0,
            speed = p.speedMps?.let { convertSpeedFromSI(it, unit.speed) } ?: 0.0,
        )
    }
}

/** Down-samples raw SI speeds to ~80 points for the scrubber sparkline (web `speedSparkData`). */
fun speedSparkData(positions: List<ReplayPoint>): List<Double?> {
    if (positions.isEmpty()) return emptyList()
    val target = TripReplayPageRegistration.SPARK_TARGET
    if (positions.size <= target) return positions.map { it.speedMps ?: 0.0 }
    val stride = 1.0 * positions.size / target
    return (0 until target).map { i ->
        val idx = min(positions.lastIndex, floor(i * stride).toInt())
        positions[idx].speedMps ?: 0.0
    }
}

/** A contiguous run of route points sharing one speed-color [bucket] (0..3), for a single merged map polyline. */
data class RouteSegment(
    val points: List<ReplayPoint>,
    val bucket: Int,
)

/**
 * The speed-color bucket for a raw position [speed] — the verbatim port of the web `speedColor` thresholds (applied to
 * the same SI value the web feeds it): 0 = slow … 3 = fast.
 */
fun speedBucket(speed: Double): Int =
    when {
        speed < 30.0 -> 0
        speed < 60.0 -> 1
        speed < 100.0 -> 2
        else -> 3
    }

/**
 * Groups [positions] into speed-colored polyline segments, merging consecutive same-bucket samples so the map emits a
 * handful of multi-point polylines instead of one per sample. Each segment shares the bucket of its trailing point (web
 * colors each segment by `curr.speed`). Returns empty for a < 2-point route.
 */
fun buildRouteSegments(positions: List<ReplayPoint>): List<RouteSegment> {
    if (positions.size < 2) return emptyList()
    val segments = mutableListOf<RouteSegment>()
    var run = mutableListOf(positions.first())
    var runBucket = speedBucket(positions[1].speedMps ?: 0.0)
    for (i in 1 until positions.size) {
        val bucket = speedBucket(positions[i].speedMps ?: 0.0)
        run.add(positions[i])
        if (bucket != runBucket) {
            segments.add(RouteSegment(run.toList(), runBucket))
            run = mutableListOf(positions[i])
            runBucket = bucket
        }
    }
    if (run.size >= 2) segments.add(RouteSegment(run.toList(), runBucket))
    return segments
}

/**
 * Whether [positions] describe a real route (some sample is > ~10 m from the first) rather than a stationary GPS fix —
 * the native mirror of the web `hasMeaningfulRoute`. A stationary drive renders a single anchor + the "can't plot" banner.
 */
fun hasMeaningfulRoute(positions: List<ReplayPoint>): Boolean {
    if (positions.size < 2) return false
    val first = positions.first()
    return positions.any { haversineMeters(first.latitude, first.longitude, it.latitude, it.longitude) > STATIONARY_RADIUS_M }
}

/** Linear scan for the position closest (by haversine) to [lat]/[lng] — the web `nearestSampleIndex` (map click → seek). */
fun nearestSampleIndex(
    positions: List<ReplayPoint>,
    lat: Double,
    lng: Double,
): Int {
    if (positions.isEmpty()) return 0
    var bestIdx = 0
    var bestDist = Double.POSITIVE_INFINITY
    for (i in positions.indices) {
        val d = haversineMeters(positions[i].latitude, positions[i].longitude, lat, lng)
        if (d < bestDist) {
            bestDist = d
            bestIdx = i
        }
    }
    return bestIdx
}

/** Per-sample elapsed offsets (ms) from the first sample, for the playback clock (mirrors MapsLogic `routeOffsetsMs`). */
fun routeOffsets(positions: List<ReplayPoint>): List<Long> {
    if (positions.isEmpty()) return emptyList()
    val t0 = positions.first().timestampMs
    return positions.map { (it.timestampMs - t0).coerceAtLeast(0L) }
}

/* ------------------------------------------------------------------ */
/*  Render-boundary formatters (current stats + drive summary)        */
/* ------------------------------------------------------------------ */

private const val EM_DASH = "\u2014"

/** Locale for grouped-number formatting derived from the user's [UnitPref] (web `_globalLocale`, en-US fallback). */
fun localeOf(unit: UnitPref): Locale =
    runCatching { Locale.forLanguageTag(unit.locale ?: "en-US") }.getOrDefault(Locale.US)

/** Current-position speed display, e.g. "42 mph" (web `convertSpeedFromSI` + unit), or the em dash. */
fun statSpeed(
    point: ReplayPoint?,
    unit: UnitPref,
    locale: Locale,
): String =
    point?.speedMps?.let { "${ChartFormat.number(convertSpeedFromSI(it, unit.speed), 1, locale)} ${unit.speed.label}" }
        ?: EM_DASH

/** Current-position power display, e.g. "12.4 kW" (web `fmtNumber(power, 1) kW`), or the em dash. */
fun statPower(
    point: ReplayPoint?,
    locale: Locale,
): String = point?.power?.let { "${ChartFormat.number(it, 1, locale)} kW" } ?: EM_DASH

/** Current-position battery display, e.g. "78%" (web `fmtInt(batteryLevel)%`), or the em dash. */
fun statBattery(
    point: ReplayPoint?,
    locale: Locale,
): String = point?.let { "${ChartFormat.number(it.batteryLevel, 0, locale)}%" } ?: EM_DASH

/** Current-position elevation display, e.g. "118 m" (web `fmtInt(elevation) m`), or the em dash. */
fun statElevation(
    point: ReplayPoint?,
    locale: Locale,
): String = point?.elevation?.let { "${ChartFormat.number(it, 0, locale)} m" } ?: EM_DASH

/** Current-position rated-range display, e.g. "214 mi" (web `convertDistanceFromSI(ratedRange) + unit`), or the em dash. */
fun statRange(
    point: ReplayPoint?,
    unit: UnitPref,
    locale: Locale,
): String =
    point?.ratedRange?.let {
        "${ChartFormat.number(convertDistanceFromSI(it, unit.distance), 0, locale)} ${unit.distance.label}"
    } ?: EM_DASH

/** Current-position outside-temperature display, e.g. "21°C" (web `convertTempFromSI(outsideTemp) + unit`), or em dash. */
fun statTemp(
    point: ReplayPoint?,
    unit: UnitPref,
    locale: Locale,
): String =
    point?.outsideTemp?.let {
        "${ChartFormat.number(convertTempFromSI(it, unit.temperature), 0, locale)} ${unit.temperature.label}"
    } ?: EM_DASH

/** Drive-summary distance number in the user's display unit (web `fmtNumber(distanceUserUnit)`). */
fun summaryDistanceValue(
    drive: DriveReplay,
    unit: UnitPref,
    locale: Locale,
): String = ChartFormat.number(convertDistanceFromSI(drive.distanceM, unit.distance), 1, locale)

/** Drive-summary duration as "Xh Ym" / "Ym" (web `fmtDriveTime(durationS / 60)`). */
fun summaryDurationValue(drive: DriveReplay): String = fmtDriveTime(drive.durationS / 60.0)

/**
 * Drive-summary efficiency in Wh/km, or `null` when inputs are missing — the verbatim port of the web `efficiency`
 * derivation `((startPct - endPct) / distanceUserUnit) * 1000`.
 */
fun summaryEfficiency(
    drive: DriveReplay,
    unit: UnitPref,
): Double? {
    val start = drive.startBatteryPct
    val end = drive.endBatteryPct
    if (drive.distanceM <= 0.0 || start == null || end == null) return null
    val distanceUserUnit = convertDistanceFromSI(drive.distanceM, unit.distance)
    if (distanceUserUnit == 0.0) return null
    return ((start - end) / distanceUserUnit) * 1000.0
}

/** Formats the efficiency value, or the em dash when absent (web `efficiency != null ? fmtNumber(efficiency) : '—'`). */
fun summaryEfficiencyValue(
    drive: DriveReplay,
    unit: UnitPref,
    locale: Locale,
): String = summaryEfficiency(drive, unit)?.let { ChartFormat.number(it, 1, locale) } ?: EM_DASH

/** Drive duration in minutes as "Xh Ym" / "Ym" (web `fmtDriveTime`). */
fun fmtDriveTime(minutes: Double): String {
    val h = floor(minutes / 60.0).toInt()
    val m = Math.round(minutes % 60.0).toInt()
    return if (h > 0) "${h}h ${m}m" else "${m}m"
}

/** The header subtitle date (medium, user locale) for [startTsMs], or `null` (web `formatDate(drive.startTs)`). */
fun summaryDate(
    startTsMs: Long?,
    locale: Locale,
): String? =
    startTsMs?.let {
        runCatching {
            Instant.ofEpochMilli(it)
                .atZone(java.time.ZoneId.systemDefault())
                .toLocalDate()
                .format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale))
        }.getOrNull()
    }

/* ------------------------------------------------------------------ */
/*  Diagnostics + Resource mapping                                    */
/* ------------------------------------------------------------------ */

/** Emits the one PII-safe `view.opened` diagnostic with the surface [TripReplayPageRegistration.SLUG] (P1/S11). */
fun recordTripReplayPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to TripReplayPageRegistration.SLUG))
}

/**
 * Maps the value inside a cache-then-network [Resource], preserving its lifecycle case + freshness flags so the
 * view-model's `JsonElement → DriveReplay` projection stays unit-testable off-device (mirrors RegenEfficiency `mapData`).
 */
fun <T, R> Resource<T>.mapResource(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

/* ------------------------------------------------------------------ */
/*  Small JSON + geo helpers                                          */
/* ------------------------------------------------------------------ */

private fun JsonObject.double(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

private fun JsonObject.long(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull

private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }

/** Parses an ISO-8601 (or epoch-millis) timestamp from `timestamp` / `created_at`, or `null` when unparseable. */
private fun JsonObject.timestampMs(): Long? =
    timestampMs("timestamp") ?: timestampMs("created_at")

private fun JsonObject.timestampMs(key: String): Long? {
    val prim = this[key] as? JsonPrimitive ?: return null
    prim.longOrNull?.let { return it }
    val text = prim.contentOrNull ?: return null
    return runCatching { Instant.parse(text).toEpochMilli() }.getOrNull()
}

private const val EARTH_RADIUS_M = 6_371_000.0
private const val DEG_TO_RAD = Math.PI / 180.0
private const val STATIONARY_RADIUS_M = 10.0

/** Great-circle distance in meters between two lat/lon pairs (haversine). */
fun haversineMeters(
    lat1: Double,
    lon1: Double,
    lat2: Double,
    lon2: Double,
): Double {
    val dLat = (lat2 - lat1) * DEG_TO_RAD
    val dLon = (lon2 - lon1) * DEG_TO_RAD
    val a =
        sin(dLat / 2).let { it * it } +
            cos(lat1 * DEG_TO_RAD) * cos(lat2 * DEG_TO_RAD) * sin(dLon / 2).let { it * it }
    return 2 * EARTH_RADIUS_M * atan2(sqrt(a), sqrt(max(0.0, 1 - a)))
}

private fun round2(value: Double): Double = if (value.isFinite()) Math.round(value * 100.0) / 100.0 else 0.0
