package io.teslasync.android.dashboard.widgets.tirepressurevisual

import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.api.generated.Vehicle
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * JVM unit tests for the framework-free Tire Pressure Visual surface logic: the snapshot → display
 * projection (the "data adapter"), the verbatim-from-web pressure status thresholds, the SI→display
 * pressure boundary (bar + psi), the null/non-number field guards, the latest-reading-time bucketing, the
 * empty-snapshot predicate, the active-vehicle resolution, and the registry footprint constraints. These
 * run in the `:android:testReleaseUnitTest` gate with no device.
 */
class TirePressureVisualProjectionTest {
    private val bar = UnitFormatter.default()
    private val psi = UnitFormatter(UnitPreferences.fromSettings(buildJsonObject { put("unit_of_pressure", "psi") }))

    // base reading instant used by the relative-time tests
    private val baseMillis = Instant.parse("2026-06-06T12:00:00Z").toEpochMilliseconds()

    // ── empty / no-snapshot ─────────────────────────────────────────────────────
    @Test
    fun nullSnapshotIsEmpty() {
        val display = TirePressureVisualProjection.project(null, bar, baseMillis)
        assertFalse(display.hasData)
        assertTrue(display.tires.isEmpty())
        assertEquals(TireReadingAge.NoReading, display.readingAge)
    }

    @Test
    fun jsonNullSnapshotIsEmpty() {
        assertFalse(TirePressureVisualProjection.project(JsonNull, bar, baseMillis).hasData)
        assertTrue(TirePressureVisualProjection.isEmptySnapshot(JsonNull))
    }

    @Test
    fun nonObjectSnapshotIsEmpty() {
        assertTrue(TirePressureVisualProjection.isEmptySnapshot(JsonPrimitive(5)))
        assertTrue(TirePressureVisualProjection.isEmptySnapshot(null))
    }

    @Test
    fun emptyObjectIsContentNotEmpty() {
        // The backend serves `{}` (not null) when no TPMS signals are present; the web treats the truthy
        // object as content (four null corners → all red, all em-dash), never the empty state.
        val display = TirePressureVisualProjection.project(buildJsonObject { }, bar, baseMillis)
        assertFalse(TirePressureVisualProjection.isEmptySnapshot(buildJsonObject { }))
        assertTrue(display.hasData)
        assertEquals(4, display.tires.size)
        assertTrue(display.tires.all { it.status == TireStatus.Red })
        assertTrue(display.tires.all { it.valueText == EM_DASH })
        assertFalse(display.allNormal)
        assertTrue(display.hasWarning)
    }

    // ── status thresholds (verbatim web getPressureStatus) ───────────────────────
    @Test
    fun statusClassifiesByRawThresholds() {
        // null → red (web `bar == null`)
        assertEquals(TireStatus.Red, TirePressureVisualProjection.getPressureStatus(null))
        // below danger-low / above danger-high → red
        assertEquals(TireStatus.Red, TirePressureVisualProjection.getPressureStatus(2.0))
        assertEquals(TireStatus.Red, TirePressureVisualProjection.getPressureStatus(3.2))
        // inside danger band but outside warn band → amber
        assertEquals(TireStatus.Amber, TirePressureVisualProjection.getPressureStatus(2.068))
        assertEquals(TireStatus.Amber, TirePressureVisualProjection.getPressureStatus(3.0))
        // inside warn band → green (boundaries inclusive)
        assertEquals(TireStatus.Green, TirePressureVisualProjection.getPressureStatus(2.275))
        assertEquals(TireStatus.Green, TirePressureVisualProjection.getPressureStatus(2.5))
        assertEquals(TireStatus.Green, TirePressureVisualProjection.getPressureStatus(2.896))
    }

    // ── content / formatting ─────────────────────────────────────────────────────
    @Test
    fun projectsFourCornersInWebOrder() {
        val snapshot =
            buildJsonObject {
                put("front_left", 250.0)
                put("front_right", 250.0)
                put("rear_left", 250.0)
                put("rear_right", 250.0)
            }
        val display = TirePressureVisualProjection.project(snapshot, bar, baseMillis)
        assertEquals(
            listOf(TireCorner.FrontLeft, TireCorner.FrontRight, TireCorner.RearLeft, TireCorner.RearRight),
            display.tires.map { it.corner },
        )
    }

    @Test
    fun formatsPressureInBarAtDisplayBoundary() {
        // 250 kPa → 2.5 bar (web convertPressureFromSI(_, 'bar')), one fixed fraction digit, no unit suffix.
        val snapshot = buildJsonObject { put("front_left", 250.0) }
        val display = TirePressureVisualProjection.project(snapshot, bar, baseMillis)
        assertEquals("2.5", display.tire(TireCorner.FrontLeft)?.valueText)
        assertEquals("bar", display.unitLabel)
    }

    @Test
    fun formatsPressureInPsiAtDisplayBoundary() {
        // 250 kPa → 36.3 psi (250 / 6.894757), one fixed fraction digit.
        val snapshot = buildJsonObject { put("front_left", 250.0) }
        val display = TirePressureVisualProjection.project(snapshot, psi, baseMillis)
        assertEquals("36.3", display.tire(TireCorner.FrontLeft)?.valueText)
        assertEquals("psi", display.unitLabel)
    }

    @Test
    fun missingOrNonNumberCornerIsRedEmDash() {
        val snapshot =
            buildJsonObject {
                put("front_left", JsonNull)
                put("front_right", true)
                // rear_left / rear_right absent entirely
            }
        val display = TirePressureVisualProjection.project(snapshot, bar, baseMillis)
        assertTrue(display.hasData)
        assertTrue(display.tires.all { it.valueText == EM_DASH })
        assertTrue(display.tires.all { it.status == TireStatus.Red })
    }

    @Test
    fun allNormalWhenEveryCornerInBand() {
        val snapshot =
            buildJsonObject {
                put("front_left", 2.5)
                put("front_right", 2.6)
                put("rear_left", 2.7)
                put("rear_right", 2.8)
            }
        val display = TirePressureVisualProjection.project(snapshot, bar, baseMillis)
        assertTrue(display.allNormal)
        assertFalse(display.hasWarning)
    }

    @Test
    fun hasWarningWhenAnyCornerOutOfBand() {
        val snapshot =
            buildJsonObject {
                put("front_left", 2.5)
                put("front_right", 2.1) // amber
                put("rear_left", 2.7)
                put("rear_right", 3.2) // red
            }
        val display = TirePressureVisualProjection.project(snapshot, bar, baseMillis)
        assertFalse(display.allNormal)
        assertTrue(display.hasWarning)
        assertEquals(TireStatus.Amber, display.tire(TireCorner.FrontRight)?.status)
        assertEquals(TireStatus.Red, display.tire(TireCorner.RearRight)?.status)
    }

    // ── reading-age bucketing (web formatTimestamp) ──────────────────────────────
    @Test
    fun blankOrMissingTimestampIsNoReading() {
        assertEquals(TireReadingAge.NoReading, TirePressureVisualProjection.computeReadingAge(null, baseMillis))
        assertEquals(TireReadingAge.NoReading, TirePressureVisualProjection.computeReadingAge("", baseMillis))
        assertEquals(TireReadingAge.NoReading, TirePressureVisualProjection.computeReadingAge("   ", baseMillis))
    }

    @Test
    fun unparseableTimestampIsInvalid() {
        assertEquals(TireReadingAge.Invalid, TirePressureVisualProjection.computeReadingAge("not-a-date", baseMillis))
    }

    @Test
    fun recentTimestampBuckets() {
        val iso = "2026-06-06T12:00:00Z"
        val base = Instant.parse(iso).toEpochMilliseconds()
        assertEquals(TireReadingAge.JustNow, TirePressureVisualProjection.computeReadingAge(iso, base + 10_000L))
        assertEquals(TireReadingAge.Minutes(5), TirePressureVisualProjection.computeReadingAge(iso, base + 5 * 60_000L))
        assertEquals(TireReadingAge.Hours(3), TirePressureVisualProjection.computeReadingAge(iso, base + 3 * 3_600_000L))
        assertEquals(TireReadingAge.Days(2), TirePressureVisualProjection.computeReadingAge(iso, base + 2 * 86_400_000L))
    }

    @Test
    fun latestReadingPicksMostRecentCorner() {
        val snapshot =
            buildJsonObject {
                put("front_left", 2.5)
                put("last_seen_time_fl", "2026-06-06T11:00:00Z")
                put("last_seen_time_fr", "2026-06-06T11:30:00Z")
                put("last_seen_time_rl", "2026-06-06T10:00:00Z")
                put("last_seen_time_rr", "2026-06-06T11:45:00Z")
            }
        // now = 12:00; most-recent corner = rr @ 11:45 → 15 minutes ago.
        val display = TirePressureVisualProjection.project(snapshot, bar, baseMillis)
        assertEquals(TireReadingAge.Minutes(15), display.readingAge)
    }

    @Test
    fun contentWithoutTimestampsIsNoReading() {
        val snapshot = buildJsonObject { put("front_left", 2.5) }
        assertEquals(TireReadingAge.NoReading, TirePressureVisualProjection.project(snapshot, bar, baseMillis).readingAge)
    }

    // ── registry / footprint ─────────────────────────────────────────────────────
    @Test
    fun registrationMatchesWebRegistry() {
        assertEquals("tire-pressure-visual", TirePressureVisualRegistration.ID)
        assertEquals("tires", TirePressureVisualRegistration.CATEGORY)
        assertEquals("TirePressureVisualWidget", TirePressureVisualRegistration.SLUG)
        assertEquals(TirePressureSize(2, 4), TirePressureVisualRegistration.DEFAULT_SIZE)
        assertEquals(TirePressureSize(2, 4), TirePressureVisualRegistration.MIN_SIZE)
        assertEquals(TirePressureSize(4, 40), TirePressureVisualRegistration.MAX_SIZE)
    }

    @Test
    fun footprintBoundsClampAndCompact() {
        assertTrue(TirePressureVisualRegistration.isWithinBounds(TirePressureSize(2, 4)))
        assertTrue(TirePressureVisualRegistration.isWithinBounds(TirePressureSize(4, 40)))
        assertFalse(TirePressureVisualRegistration.isWithinBounds(TirePressureSize(1, 4)))
        assertFalse(TirePressureVisualRegistration.isWithinBounds(TirePressureSize(2, 3)))
        assertEquals(TirePressureSize(4, 40), TirePressureVisualRegistration.clamp(TirePressureSize(9, 99)))
        assertEquals(TirePressureSize(2, 4), TirePressureVisualRegistration.clamp(TirePressureSize(0, 0)))
        // The registry min is 2 cols, so the compact (titleless) branch is only reachable below bounds.
        assertFalse(TirePressureVisualRegistration.isCompact(TirePressureSize(2, 4)))
        assertTrue(TirePressureVisualRegistration.isCompact(TirePressureSize(1, 2)))
    }

    // ── active-vehicle resolution ────────────────────────────────────────────────
    @Test
    fun resolvesPreferredThenFirstThenNull() {
        assertEquals(7L, resolveVehicleId(7L, listOf(vehicle(3))))
        assertEquals(3L, resolveVehicleId(null, listOf(vehicle(3), vehicle(4))))
        assertEquals(3L, resolveVehicleId(0L, listOf(vehicle(3))))
        assertNull(resolveVehicleId(null, emptyList()))
        assertNull(resolveVehicleId(null, null))
    }

    private fun vehicle(id: Long): Vehicle =
        Vehicle(
            createdAt = Instant.parse("2026-01-01T00:00:00Z"),
            displayName = "Car $id",
            enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
            id = id,
            teslaId = 1000 + id,
            timezone = "UTC",
            updatedAt = Instant.parse("2026-01-01T00:10:00Z"),
            vin = "VIN$id",
        )
}
