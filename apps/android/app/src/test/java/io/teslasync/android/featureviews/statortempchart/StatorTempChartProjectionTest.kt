package io.teslasync.android.featureviews.statortempchart

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.TemperatureUnitPref
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the Stator Temperature History chart's pure logic — the native analogue of the
 * web component's `data.map` series build + `toTemperatureDisplay` reference-line conversion
 * (web/src/features/driving/components/drivetrain-health/StatorTempChart.tsx): the SI Celsius → display-unit
 * conversion of the three series, the 60 °C / 80 °C threshold conversion, the accessible-table projection
 * with `null`-gap em dashes, the order-preserving + insufficient-sample (`data.length <= 1`) contract, the
 * locale-aware one-decimal formatting, and the PII-safe `view.opened` diagnostic. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class StatorTempChartProjectionTest {
    private companion object {
        const val EPS: Double = 1e-9
        val LOCALE: Locale = Locale.US
    }

    private fun fmt(value: Double?): String = StatorTempChartProjection.formatTemp(value, LOCALE)

    private fun project(
        points: List<MotorTempPoint>,
        unit: TemperatureUnitPref = TemperatureUnitPref.CELSIUS,
    ): StatorTempChartProjectionResult = StatorTempChartProjection.project(points, unit, ::fmt)

    // ── Celsius (SI identity) ─────────────────────────────────────────────────────

    @Test
    fun projectKeepsCelsiusValuesAndOrderAndBuildsTableRows() {
        val points =
            listOf(
                MotorTempPoint(time = "10:00", statorC = 45.0, statorRelC = 42.0, statorRerC = 38.0),
                MotorTempPoint(time = "10:05", statorC = 72.0, statorRelC = 68.0, statorRerC = 61.0),
            )

        val result = project(points, TemperatureUnitPref.CELSIUS)

        assertFalse(result.isInsufficient)
        // Order is preserved (web maps `data` straight through — no sort).
        assertEquals(listOf("10:00", "10:05"), result.times)
        assertEquals(listOf<Double?>(45.0, 72.0), result.statorValues)
        assertEquals(listOf<Double?>(42.0, 68.0), result.statorRelValues)
        assertEquals(listOf<Double?>(38.0, 61.0), result.statorRerValues)
        assertEquals(
            listOf(
                listOf("10:00", "45.0", "42.0", "38.0"),
                listOf("10:05", "72.0", "68.0", "61.0"),
            ),
            result.tableRows,
        )
    }

    @Test
    fun projectConvertsThresholdsToCelsiusUnchanged() {
        val result = project(twoPoints(), TemperatureUnitPref.CELSIUS)

        assertEquals(NORMAL_TEMP_C, result.normalThreshold, EPS)
        assertEquals(WARM_TEMP_C, result.warmThreshold, EPS)
    }

    // ── Fahrenheit (SI → display conversion) ──────────────────────────────────────

    @Test
    fun projectConvertsSeriesToFahrenheit() {
        val points =
            listOf(
                MotorTempPoint(time = "a", statorC = 0.0, statorRelC = 100.0, statorRerC = 37.0),
                MotorTempPoint(time = "b", statorC = 60.0, statorRelC = 80.0, statorRerC = 20.0),
            )

        val result = project(points, TemperatureUnitPref.FAHRENHEIT)

        // 0°C→32, 100°C→212, 37°C→98.6 ; 60°C→140, 80°C→176, 20°C→68
        assertEquals(listOf<Double?>(32.0, 140.0), result.statorValues)
        assertEquals(listOf<Double?>(212.0, 176.0), result.statorRelValues)
        assertEquals(listOf<Double?>(98.6, 68.0), result.statorRerValues)
    }

    @Test
    fun projectConvertsThresholdsToFahrenheit() {
        val result = project(twoPoints(), TemperatureUnitPref.FAHRENHEIT)

        // 60°C → 140°F, 80°C → 176°F (the web `toTemperatureDisplay(60)` / `(80)`).
        assertEquals(140.0, result.normalThreshold, EPS)
        assertEquals(176.0, result.warmThreshold, EPS)
    }

    // ── Null gaps (web `connectNulls`) ────────────────────────────────────────────

    @Test
    fun projectPropagatesNullGapsAsNullValuesAndEmDashCells() {
        val points =
            listOf(
                MotorTempPoint(time = "10:00", statorC = 50.0, statorRelC = null, statorRerC = 40.0),
                MotorTempPoint(time = "10:05", statorC = null, statorRelC = 60.0, statorRerC = null),
            )

        val result = project(points, TemperatureUnitPref.CELSIUS)

        assertEquals(listOf<Double?>(50.0, null), result.statorValues)
        assertEquals(listOf<Double?>(null, 60.0), result.statorRelValues)
        assertEquals(listOf<Double?>(40.0, null), result.statorRerValues)
        // A missing reading renders as the em dash in the accessible table.
        assertEquals(listOf("10:00", "50.0", EM_DASH, "40.0"), result.tableRows[0])
        assertEquals(listOf("10:05", EM_DASH, "60.0", EM_DASH), result.tableRows[1])
    }

    // ── Insufficient samples (web `data.length <= 1` → renders empty) ─────────────

    @Test
    fun projectFlagsZeroOrOneSampleAsInsufficient() {
        assertTrue(project(emptyList()).isInsufficient)
        assertTrue(project(listOf(point("only"))).isInsufficient)
        assertFalse(project(twoPoints()).isInsufficient)
    }

    @Test
    fun projectEmptyHasNoRowsButStillCarriesThresholds() {
        val result = project(emptyList(), TemperatureUnitPref.CELSIUS)

        assertTrue(result.times.isEmpty())
        assertTrue(result.statorValues.isEmpty())
        assertTrue(result.tableRows.isEmpty())
        assertEquals(NORMAL_TEMP_C, result.normalThreshold, EPS)
        assertEquals(WARM_TEMP_C, result.warmThreshold, EPS)
    }

    // ── formatTemp (locale-aware one-decimal) ─────────────────────────────────────

    @Test
    fun formatTempRendersOneDecimalInGivenLocaleAndEmDashForMissing() {
        assertEquals("72.5", StatorTempChartProjection.formatTemp(72.5, Locale.US))
        assertEquals("140.0", StatorTempChartProjection.formatTemp(140.0, Locale.US))
        assertEquals("1,234.6", StatorTempChartProjection.formatTemp(1_234.56, Locale.US))
        assertEquals(EM_DASH, StatorTempChartProjection.formatTemp(null, Locale.US))
        assertEquals(EM_DASH, StatorTempChartProjection.formatTemp(Double.NaN, Locale.US))
        assertEquals(EM_DASH, StatorTempChartProjection.formatTemp(Double.POSITIVE_INFINITY, Locale.US))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordStatorTempChartOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "StatorTempChart"), fields)
        assertNull(fields["temperature"])
    }

    private fun point(time: String): MotorTempPoint = MotorTempPoint(time = time, statorC = 50.0, statorRelC = 48.0, statorRerC = 44.0)

    private fun twoPoints(): List<MotorTempPoint> = listOf(point("a"), point("b"))

    private class RecordingLogger : Logger {
        val records = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += event to fields
        }
    }
}
