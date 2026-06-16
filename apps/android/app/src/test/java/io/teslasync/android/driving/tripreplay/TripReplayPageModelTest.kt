package io.teslasync.android.driving.tripreplay

import io.teslasync.android.data.UnitPreferences
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device JVM unit tests for the framework-free [TripReplayPageModel] — the verbatim port of the web page's
 * derivations (drive-detail decode + position⋈telemetry merge, replay markers, the timeline / elevation / sparkline /
 * route-segment projections, the current-stat + drive-summary formatters). Exercised by the `:android:testDebugUnitTest`
 * gate so the page composable can stay a thin render layer.
 */
class TripReplayPageModelTest {
    private val metric = UnitPreferences.fromSettings(null)
    private val imperial =
        UnitPreferences.fromSettings(
            Json.parseToJsonElement("""{"unit_of_length":"mi","unit_of_temp":"F"}"""),
        )

    private fun pt(
        lat: Double,
        lon: Double,
        t: Long,
        speed: Double? = null,
        power: Double? = null,
        batt: Double = 50.0,
        elev: Double? = null,
        temp: Double? = null,
        range: Double? = null,
    ): ReplayPoint = ReplayPoint(lat, lon, speed, power, batt, t, elev, temp, range)

    /* ---- parseDriveReplay ---- */

    @Test
    fun parseDriveReplay_mergesNearestTelemetryIntoPositions() {
        val json =
            Json.parseToJsonElement(
                """
                {
                  "id": 7, "distance_m": 1000.0, "duration_s": 120.0,
                  "start_battery_pct": 80, "end_battery_pct": 70,
                  "start_address": "A", "end_address": "B", "start_ts": "2024-01-01T00:00:00Z",
                  "positions": [
                    {"latitude": 47.0, "longitude": -122.0, "speed": 10.0, "created_at": "2024-01-01T00:00:00Z"},
                    {"latitude": 47.1, "longitude": -122.1, "speed": 20.0, "created_at": "2024-01-01T00:01:00Z"}
                  ],
                  "telemetry": [
                    {"created_at": "2024-01-01T00:00:00Z", "power": 5.0, "battery_level": 80, "elevation": 100.0, "outside_temp": 15.0, "rated_range": 300000.0},
                    {"created_at": "2024-01-01T00:01:00Z", "power": -3.0, "battery_level": 78, "elevation": 110.0, "outside_temp": 14.0, "rated_range": 295000.0}
                  ]
                }
                """.trimIndent(),
            )
        val drive = parseDriveReplay(json)

        assertTrue(drive.present)
        assertEquals(7L, drive.driveId)
        assertEquals("A", drive.startAddress)
        assertEquals("B", drive.endAddress)
        assertEquals(1000.0, drive.distanceM, 1e-9)
        assertEquals(120.0, drive.durationS, 1e-9)
        assertEquals(80.0, drive.startBatteryPct!!, 1e-9)
        assertEquals(70.0, drive.endBatteryPct!!, 1e-9)
        assertNotNull(drive.startTsMs)
        assertEquals(2, drive.positions.size)

        val first = drive.positions[0]
        assertEquals(10.0, first.speedMps!!, 1e-9)
        assertEquals(5.0, first.power!!, 1e-9)
        assertEquals(80.0, first.batteryLevel, 1e-9)
        assertEquals(100.0, first.elevation!!, 1e-9)
        assertEquals(15.0, first.outsideTemp!!, 1e-9)
        assertEquals(300000.0, first.ratedRange!!, 1e-9)

        val second = drive.positions[1]
        assertEquals(-3.0, second.power!!, 1e-9)
        assertEquals(110.0, second.elevation!!, 1e-9)
    }

    @Test
    fun parseDriveReplay_absentForNonObjectOrEmpty() {
        assertFalse(parseDriveReplay(null).present)
        assertFalse(parseDriveReplay(Json.parseToJsonElement("[]")).present)
        assertFalse(parseDriveReplay(Json.parseToJsonElement("{}")).present)
        assertTrue(parseDriveReplay(null).positions.isEmpty())
    }

    @Test
    fun parseDriveReplay_dropsZeroCoordinatePositions() {
        val json =
            Json.parseToJsonElement(
                """
                {"id": 1, "positions": [
                  {"latitude": 0.0, "longitude": 0.0, "created_at": "2024-01-01T00:00:00Z"},
                  {"latitude": 47.0, "longitude": -122.0, "created_at": "2024-01-01T00:00:01Z"}
                ]}
                """.trimIndent(),
            )
        val drive = parseDriveReplay(json)
        assertEquals(1, drive.positions.size)
        assertEquals(47.0, drive.positions[0].latitude, 1e-9)
    }

    /* ---- markers ---- */

    @Test
    fun computeReplayMarkers_emptyAndSingle() {
        assertTrue(computeReplayMarkers(emptyList()).isEmpty())
        val single = computeReplayMarkers(listOf(pt(47.0, -122.0, 0L)))
        assertEquals(1, single.size)
        assertEquals(ReplayMarkerKind.Start, single[0].kind)
    }

    @Test
    fun computeReplayMarkers_emitsStartAndStopForMultiPoint() {
        val points =
            listOf(
                pt(47.0, -122.0, 0L, speed = 5.0),
                pt(47.1, -122.1, 60_000L, speed = 6.0),
            )
        val markers = computeReplayMarkers(points)
        assertTrue(markers.any { it.kind == ReplayMarkerKind.Start && it.at == 0f })
        assertTrue(markers.any { it.kind == ReplayMarkerKind.Stop && it.at == 1f })
    }

    @Test
    fun computeReplayMarkers_detectsLowSoc() {
        val points =
            listOf(
                pt(47.0, -122.0, 0L, speed = 5.0, batt = 50.0),
                pt(47.1, -122.1, 60_000L, speed = 6.0, batt = 10.0),
            )
        val markers = computeReplayMarkers(points)
        assertTrue(markers.any { it.kind == ReplayMarkerKind.LowSoc })
    }

    @Test
    fun computeReplayMarkers_detectsChargeSegment() {
        // A contiguous run of negative power (charging) lasting >= 30s yields charge-start/charge-stop.
        val points =
            (0..6).map { i ->
                pt(47.0 + i * 0.001, -122.0, i * 10_000L, speed = 1.0, power = -20.0)
            }
        val markers = computeReplayMarkers(points)
        assertTrue(markers.any { it.kind == ReplayMarkerKind.ChargeStart })
        assertTrue(markers.any { it.kind == ReplayMarkerKind.ChargeStop })
    }

    @Test
    fun nearestMarker_respectsTolerance() {
        val markers = listOf(ReplayMarker(0.5f, ReplayMarkerKind.FastSegment))
        assertNotNull(nearestMarker(markers, 0.51f, 0.02f))
        assertNull(nearestMarker(markers, 0.7f, 0.02f))
    }

    @Test
    fun toTimelineMarker_mapsKindOneToOne() {
        assertEquals(
            io.teslasync.android.components.datadisplay.TimelineMarkerKind.RegenPeak,
            ReplayMarker(0.3f, ReplayMarkerKind.RegenPeak, "x").toTimelineMarker().kind,
        )
    }

    /* ---- projections ---- */

    @Test
    fun buildTimeline_convertsSpeedAndKeepsPower() {
        val points =
            listOf(
                pt(47.0, -122.0, 0L, speed = 10.0, power = 4.0),
                pt(47.0, -122.0, 120_000L, speed = 20.0, power = -2.0),
            )
        val timeline = buildTimeline(points, metric)
        assertEquals(2, timeline.size)
        assertEquals(0.0, timeline[0].timeMin, 1e-9)
        assertEquals(2.0, timeline[1].timeMin, 1e-9)
        // 10 m/s -> 36 km/h.
        assertEquals(36.0, timeline[0].speed, 1e-6)
        assertEquals(4.0, timeline[0].power, 1e-9)
        assertEquals(-2.0, timeline[1].power, 1e-9)
    }

    @Test
    fun buildElevation_accumulatesDistanceFromZero() {
        val points =
            listOf(
                pt(47.0000, -122.0000, 0L, elev = 100.0),
                pt(47.0100, -122.0000, 1_000L, elev = 120.0),
            )
        val elevation = buildElevation(points, metric)
        assertEquals(2, elevation.size)
        assertEquals(0.0, elevation[0].distance, 1e-9)
        assertEquals(100.0, elevation[0].elevation, 1e-9)
        assertTrue("cumulative distance should grow", elevation[1].distance > 0.0)
    }

    @Test
    fun speedSparkData_downsamplesToTarget() {
        val many = (0 until 500).map { pt(47.0, -122.0, it.toLong(), speed = 1.0 * it) }
        assertEquals(TripReplayPageRegistration.SPARK_TARGET, speedSparkData(many).size)
        val few = (0 until 10).map { pt(47.0, -122.0, it.toLong(), speed = 1.0 * it) }
        assertEquals(10, speedSparkData(few).size)
    }

    @Test
    fun speedBucket_matchesWebThresholds() {
        assertEquals(0, speedBucket(29.9))
        assertEquals(1, speedBucket(30.0))
        assertEquals(1, speedBucket(59.9))
        assertEquals(2, speedBucket(60.0))
        assertEquals(2, speedBucket(99.9))
        assertEquals(3, speedBucket(100.0))
    }

    @Test
    fun buildRouteSegments_mergesContiguousSameBucket() {
        val points =
            listOf(
                pt(47.0, -122.0, 0L, speed = 5.0),
                pt(47.1, -122.0, 1L, speed = 6.0),
                pt(47.2, -122.0, 2L, speed = 70.0),
                pt(47.3, -122.0, 3L, speed = 80.0),
            )
        val segments = buildRouteSegments(points)
        // Two color runs: a slow (bucket 0) run then a fast (bucket 2) run.
        assertEquals(2, segments.size)
        assertEquals(0, segments[0].bucket)
        assertEquals(2, segments[1].bucket)
        assertTrue(segments.all { it.points.size >= 2 })
    }

    @Test
    fun hasMeaningfulRoute_distinguishesStationary() {
        val moving = listOf(pt(47.0, -122.0, 0L), pt(47.05, -122.0, 1L))
        val stationary = listOf(pt(47.0, -122.0, 0L), pt(47.00001, -122.0, 1L))
        assertTrue(hasMeaningfulRoute(moving))
        assertFalse(hasMeaningfulRoute(stationary))
        assertFalse(hasMeaningfulRoute(listOf(pt(47.0, -122.0, 0L))))
    }

    @Test
    fun nearestSampleIndex_findsClosest() {
        val points =
            listOf(
                pt(47.0, -122.0, 0L),
                pt(48.0, -122.0, 1L),
                pt(49.0, -122.0, 2L),
            )
        assertEquals(2, nearestSampleIndex(points, 49.01, -122.0))
        assertEquals(0, nearestSampleIndex(points, 46.9, -122.0))
    }

    @Test
    fun routeOffsets_areRelativeToFirstSample() {
        val points = listOf(pt(47.0, -122.0, 1_000L), pt(47.0, -122.0, 61_000L))
        assertEquals(listOf(0L, 60_000L), routeOffsets(points))
    }

    /* ---- formatters ---- */

    @Test
    fun statFormatters_handleNullAndUnits() {
        val locale = localeOf(metric)
        assertEquals("\u2014", statSpeed(null, metric, locale))
        assertEquals("\u2014", statPower(null, locale))
        // 10 m/s -> 36 km/h metric.
        assertTrue(statSpeed(pt(0.0, 0.0, 0L, speed = 10.0), metric, locale).contains("km/h"))
        // Imperial range label.
        val rangePoint = pt(0.0, 0.0, 0L, range = 160934.4)
        assertTrue(statRange(rangePoint, imperial, localeOf(imperial)).contains("mi"))
    }

    @Test
    fun summaryEfficiency_followsWebFormula() {
        // distance 1000 m = 1 km (metric); start 80% end 70% -> ((80-70)/1)*1000 = 10000 Wh/km.
        val drive = DriveReplay.ABSENT.copy(present = true, distanceM = 1000.0, startBatteryPct = 80.0, endBatteryPct = 70.0)
        assertEquals(10000.0, summaryEfficiency(drive, metric)!!, 1e-6)
        // Missing battery -> null.
        assertNull(summaryEfficiency(drive.copy(endBatteryPct = null), metric))
        // Zero distance -> null.
        assertNull(summaryEfficiency(drive.copy(distanceM = 0.0), metric))
    }

    @Test
    fun summaryDurationValue_formatsHoursAndMinutes() {
        assertEquals("1h 2m", summaryDurationValue(DriveReplay.ABSENT.copy(durationS = 3720.0)))
        assertEquals("5m", summaryDurationValue(DriveReplay.ABSENT.copy(durationS = 300.0)))
    }

    @Test
    fun safePercentile_interpolatesLinearly() {
        assertEquals(0.0, safePercentile(emptyList(), 0.5), 1e-9)
        assertEquals(3.0, safePercentile(listOf(1.0, 2.0, 3.0, 4.0, 5.0), 0.5), 1e-9)
        assertEquals(1.0, safePercentile(listOf(1.0), 0.95), 1e-9)
    }

    @Test
    fun haversineMeters_isZeroForSamePoint() {
        assertEquals(0.0, haversineMeters(47.0, -122.0, 47.0, -122.0), 1e-6)
        assertTrue(haversineMeters(47.0, -122.0, 47.0, -121.0) > 50_000.0)
    }
}
