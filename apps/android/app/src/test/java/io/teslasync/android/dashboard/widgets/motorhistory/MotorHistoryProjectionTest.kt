package io.teslasync.android.dashboard.widgets.motorhistory

import io.teslasync.shared.core.units.TemperatureUnitPref
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the MotorHistoryWidget's pure logic — the `buildChartData` filter + sort,
 * the stator `di_stator_temp ?? motor_temp_c_front` fallback, the SI Celsius → display conversion, the
 * `latestTorque` / `latestStatorTemp` reverse scans, the 100 °C danger threshold + in-danger flags, the
 * Torque / Stator stat pair, the registry metadata and the footprint branches. Mirrors the web spec
 * (web/src/features/dashboard/widgets/MotorHistoryWidget.tsx). Runs in the `:android:testReleaseUnitTest`
 * gate.
 */
class MotorHistoryProjectionTest {
    private val strings =
        MotorHistoryStrings(
            torque = "Torque",
            statorTemp = "Stator",
            lateralG = "Lateral G",
            longG = "Long. G",
        )

    // ---- buildPoints (web `buildChartData`) ----------------------------------------

    @Test
    fun buildPointsFiltersTimelessRowsAndSortsAscending() {
        val points =
            MotorHistoryProjection.buildPoints(
                rows =
                    listOf(
                        row(ts = "2024-01-15T10:30:00Z", torque = 100.0, stator = 50.0),
                        row(ts = null), // no ts and no created_at -> dropped (web filter)
                        row(ts = "2024-01-15T10:10:00Z", torque = 200.0, stator = 40.0),
                    ),
                tempUnit = TemperatureUnitPref.CELSIUS,
                formatTime = { it },
            )

        assertEquals(2, points.size)
        // Sorted oldest -> newest by the raw ISO time (web `localeCompare`).
        assertEquals("2024-01-15T10:10:00Z", points[0].timeIso)
        assertEquals(200.0, points[0].torqueNm!!, EPSILON)
        assertEquals("2024-01-15T10:30:00Z", points[1].timeIso)
        // formatTime is identity here, so the label mirrors the raw time.
        assertEquals(points[1].timeIso, points[1].timeLabel)
    }

    @Test
    fun rowFallsBackToCreatedAtAndFrontMotorTemp() {
        val points =
            MotorHistoryProjection.buildPoints(
                rows = listOf(rowCreatedAt(createdAt = "2024-01-15T10:00:00Z", frontTemp = 33.0)),
                tempUnit = TemperatureUnitPref.CELSIUS,
                formatTime = { it },
            )

        assertEquals(1, points.size)
        assertEquals("2024-01-15T10:00:00Z", points[0].timeIso)
        // di_stator_temp absent -> motor_temp_c_front used (web `di_stator_temp ?? motor_temp_c_front`).
        assertEquals(33.0, points[0].statorTempDisplay!!, EPSILON)
    }

    // ---- project: latest scans, stats, conversion ----------------------------------

    @Test
    fun latestTorqueAndStatorScanFromEndSkippingNulls() {
        val display =
            project(
                snapshot(
                    row(ts = "2024-01-15T10:00:00Z", torque = 100.0, stator = 50.0),
                    row(ts = "2024-01-15T10:01:00Z", torque = null, stator = 60.0),
                    row(ts = "2024-01-15T10:02:00Z", torque = 300.0, stator = null),
                ),
            )

        assertTrue(display.hasData)
        // latestTorque -> last non-null torque (300); latestStator -> last non-null stator (60).
        assertEquals("300", display.stats[0].value)
        assertEquals("Torque", display.stats[0].label)
        assertEquals("Nm", display.stats[0].unit)
        assertEquals("60", display.stats[1].value)
        assertEquals("Stator", display.stats[1].label)
        assertEquals("\u00B0C", display.stats[1].unit)
    }

    @Test
    fun missingLatestValuesRenderEmDash() {
        val display = project(snapshot(row(ts = "2024-01-15T10:00:00Z", torque = null, stator = null)))
        assertTrue(display.hasData) // a timestamped row is still a chartable point (web `chartData.length > 0`)
        assertEquals("\u2014", display.stats[0].value)
        assertEquals("\u2014", display.stats[1].value)
    }

    @Test
    fun convertsStatorAndDangerThresholdToFahrenheit() {
        val display =
            project(
                snapshot(row(ts = "2024-01-15T10:00:00Z", torque = 100.0, stator = 50.0)),
                tempUnit = TemperatureUnitPref.FAHRENHEIT,
            )
        // 50 C -> 122 F; danger 100 C -> 212 F.
        assertEquals("122", display.stats[1].value)
        assertEquals("\u00B0F", display.stats[1].unit)
        assertEquals(212.0, display.dangerThresholdDisplay, EPSILON)
    }

    @Test
    fun dangerFlagsDistinguishPeakFromLatest() {
        val cooledDown =
            project(
                snapshot(
                    row(ts = "2024-01-15T10:00:00Z", torque = 80.0, stator = 80.0),
                    row(ts = "2024-01-15T10:01:00Z", torque = 90.0, stator = 108.0),
                    row(ts = "2024-01-15T10:02:00Z", torque = 70.0, stator = 90.0),
                ),
            )
        assertEquals(100.0, cooledDown.dangerThresholdDisplay, EPSILON)
        assertTrue("a 108C reading should mark the peak in danger", cooledDown.peakStatorInDanger)
        assertFalse("the latest reading (90C) is below the threshold", cooledDown.latestStatorInDanger)

        val stillHot =
            project(snapshot(row(ts = "2024-01-15T10:03:00Z", torque = 60.0, stator = 105.0)))
        assertTrue(stillHot.latestStatorInDanger)
        assertTrue(stillHot.peakStatorInDanger)
    }

    @Test
    fun readsGForceOverlayFields() {
        val display =
            project(snapshot(row(ts = "2024-01-15T10:00:00Z", lateralG = 0.42, longG = -0.31)))
        assertEquals(0.42, display.points[0].lateralG!!, EPSILON)
        assertEquals(-0.31, display.points[0].longitudinalG!!, EPSILON)
    }

    @Test
    fun emptySnapshotHasNoDataAndNoStats() {
        val display = project(MotorHistorySnapshot.EMPTY)
        assertFalse(display.hasData)
        assertTrue(display.points.isEmpty())
        assertTrue(display.stats.isEmpty())
        assertFalse(display.latestStatorInDanger)
        assertFalse(display.peakStatorInDanger)
    }

    // ---- registry + footprint metadata ---------------------------------------------

    @Test
    fun registrationMatchesWebRegistry() {
        assertEquals("motor-history", MotorHistoryRegistration.ID)
        assertEquals("vehicle", MotorHistoryRegistration.CATEGORY)
        assertEquals("MotorHistoryWidget", MotorHistoryRegistration.SLUG)
        assertEquals(200, MotorHistoryRegistration.HISTORY_LIMIT)
        assertEquals(MotorHistorySize(2, 4), MotorHistoryRegistration.defaultSize)
        assertEquals(MotorHistorySize(2, 4), MotorHistoryRegistration.minSize)
        assertEquals(MotorHistorySize(4, 40), MotorHistoryRegistration.maxSize)
    }

    @Test
    fun footprintCompactAndWideBranchesMatchWeb() {
        assertTrue(MotorHistorySize(1, 4).isCompact)
        assertFalse(MotorHistorySize(2, 4).isCompact)
        assertTrue(MotorHistorySize(3, 4).isWide)
        assertFalse(MotorHistorySize(2, 4).isWide)
    }

    @Test
    fun clampHonoursMinAndMaxFootprint() {
        assertEquals(MotorHistorySize(2, 4), MotorHistoryRegistration.clamp(MotorHistorySize(1, 2)))
        assertEquals(MotorHistorySize(4, 40), MotorHistoryRegistration.clamp(MotorHistorySize(9, 99)))
        assertFalse(MotorHistoryRegistration.withinBounds(MotorHistorySize(1, 4)))
        assertTrue(MotorHistoryRegistration.withinBounds(MotorHistorySize(2, 4)))
    }

    @Test
    fun wideFootprintIsCarriedIntoDisplay() {
        val display = project(snapshot(row(ts = "2024-01-15T10:00:00Z", torque = 10.0)), size = MotorHistorySize(4, 6))
        assertTrue(display.isWide)
        assertFalse(display.isCompact)
    }

    // ---- fixtures ------------------------------------------------------------------

    private fun project(
        snapshot: MotorHistorySnapshot,
        size: MotorHistorySize = MotorHistoryRegistration.defaultSize,
        tempUnit: TemperatureUnitPref = TemperatureUnitPref.CELSIUS,
    ): MotorHistoryDisplay =
        MotorHistoryProjection.project(
            snapshot = snapshot,
            size = size,
            tempUnit = tempUnit,
            strings = strings,
            formatTime = { it },
            locale = Locale.US,
        )

    private fun snapshot(vararg rows: JsonObject): MotorHistorySnapshot = MotorHistorySnapshot(rows.toList())

    @Suppress("LongParameterList")
    private fun row(
        ts: String?,
        torque: Double? = null,
        stator: Double? = null,
        lateralG: Double? = null,
        longG: Double? = null,
    ): JsonObject =
        buildJsonObject {
            if (ts != null) put("ts", ts)
            if (torque != null) put("di_torque", torque)
            if (stator != null) put("di_stator_temp", stator)
            if (lateralG != null) put("lateral_accel", lateralG)
            if (longG != null) put("longitudinal_accel", longG)
        }

    private fun rowCreatedAt(
        createdAt: String,
        frontTemp: Double,
    ): JsonObject =
        buildJsonObject {
            put("created_at", createdAt)
            put("motor_temp_c_front", frontTemp)
        }

    private companion object {
        const val EPSILON = 0.0001
    }
}
