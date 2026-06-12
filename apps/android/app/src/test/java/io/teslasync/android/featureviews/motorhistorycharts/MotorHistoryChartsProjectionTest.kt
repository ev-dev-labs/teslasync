package io.teslasync.android.featureviews.motorhistorycharts

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the Motor History charts' pure logic — the native analogue of the web
 * component's data derivations (web/src/features/driving/components/driving-dynamics/MotorHistoryCharts.tsx):
 * the three `motorHistory.map` builds that feed the Power / Torque / RPM series + accessible tables, the
 * `chartData.length > 0` content/empty boundary (web `… ? chart : noData`), the locale-aware kW / Nm / RPM
 * formatting (with the shared em-dash gap for missing samples), the `t(key, default)` resolve-or-fallback for
 * the three catalog-absent aria keys, and the PII-safe `view.opened` diagnostic. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class MotorHistoryChartsProjectionTest {
    // Stub formatters tag each value with their unit letter so the test pins which value lands in which
    // table column / chart, independent of the locale-aware production formatters (verified separately).
    private fun stubPower(): (Double?) -> String = { "P($it)" }

    private fun stubTorque(): (Double?) -> String = { "T($it)" }

    private fun stubRpm(): (Double?) -> String = { "R($it)" }

    // MotorHistorySample(time, powerKw, regenKw, torqueFront, torqueRear, rpmFront, rpmRear) — positional so
    // each fixture stays on one line; the asserts below pin which value lands in which series/column.
    private val samples =
        listOf(
            MotorHistorySample("10:00", 64.2, -12.0, 180.0, 210.0, 3200.0, 3400.0),
            MotorHistorySample("10:05", 120.5, -4.0, 240.0, 265.0, 5200.0, 5600.0),
            MotorHistorySample("10:10", null, null, null, null, null, null),
        )

    private fun project() = MotorHistoryChartsProjection.project(samples, stubPower(), stubTorque(), stubRpm())

    // ── Projection: series columns + order preservation (web data maps) ────────────

    @Test
    fun projectPreservesOrderAndSplitsEverySeries() {
        val result = project()

        assertEquals(listOf("10:00", "10:05", "10:10"), result.times)
        assertEquals(listOf(64.2, 120.5, null), result.powerValues)
        assertEquals(listOf(-12.0, -4.0, null), result.regenValues)
        assertEquals(listOf(180.0, 240.0, null), result.torqueFrontValues)
        assertEquals(listOf(210.0, 265.0, null), result.torqueRearValues)
        assertEquals(listOf(3200.0, 5200.0, null), result.rpmFrontValues)
        assertEquals(listOf(3400.0, 5600.0, null), result.rpmRearValues)
        assertFalse(result.isEmpty)
    }

    @Test
    fun projectBuildsOneAccessibleTableRowPerSamplePerChart() {
        val result = project()

        // Power table: [time, power, regen] — the web powerChartData order.
        assertEquals(listOf("10:00", "P(64.2)", "P(-12.0)"), result.powerTableRows[0])
        // Torque table: [time, front, rear].
        assertEquals(listOf("10:05", "T(240.0)", "T(265.0)"), result.torqueTableRows[1])
        // RPM table: [time, front, rear].
        assertEquals(listOf("10:00", "R(3200.0)", "R(3400.0)"), result.rpmTableRows[0])
        // A missing sample formats each gap via the injected formatter (null → "P(null)", etc.).
        assertEquals(listOf("10:10", "P(null)", "P(null)"), result.powerTableRows[2])
        assertEquals(samples.size, result.powerTableRows.size)
        assertEquals(samples.size, result.torqueTableRows.size)
        assertEquals(samples.size, result.rpmTableRows.size)
    }

    // ── Projection: content/empty boundary (web chartData.length > 0) ──────────────

    @Test
    fun projectIsEmptyOnlyForNoSamples() {
        assertTrue(MotorHistoryChartsProjection.project(emptyList(), stubPower(), stubTorque(), stubRpm()).isEmpty)

        val single = MotorHistoryChartsProjection.project(listOf(samples.first()), stubPower(), stubTorque(), stubRpm())
        // Web boundary is `length > 0`, so even a single sample is content (not empty).
        assertFalse(single.isEmpty)
        assertEquals(1, single.times.size)
    }

    @Test
    fun projectEmptyInputYieldsEmptyColumnsAndTables() {
        val result = MotorHistoryChartsProjection.project(emptyList(), stubPower(), stubTorque(), stubRpm())

        assertTrue(result.times.isEmpty())
        assertTrue(result.powerValues.isEmpty())
        assertTrue(result.regenValues.isEmpty())
        assertTrue(result.torqueFrontValues.isEmpty())
        assertTrue(result.rpmRearValues.isEmpty())
        assertTrue(result.powerTableRows.isEmpty())
        assertTrue(result.torqueTableRows.isEmpty())
        assertTrue(result.rpmTableRows.isEmpty())
        assertTrue(result.isEmpty)
    }

    // ── Formatters (locale-aware, unit-specific precision, em-dash gaps) ───────────

    @Test
    fun formatPowerRendersOneDecimalWithGroupingAndSign() {
        assertEquals("64.2", MotorHistoryChartsProjection.formatPower(64.2, Locale.US))
        assertEquals("1,234.5", MotorHistoryChartsProjection.formatPower(1234.5, Locale.US))
        assertEquals("-58.0", MotorHistoryChartsProjection.formatPower(-58.0, Locale.US))
    }

    @Test
    fun formatTorqueAndRpmRenderWholeNumbersWithGrouping() {
        assertEquals("180", MotorHistoryChartsProjection.formatTorque(180.0, Locale.US))
        assertEquals("1,234", MotorHistoryChartsProjection.formatTorque(1234.0, Locale.US))
        assertEquals("5,200", MotorHistoryChartsProjection.formatRpm(5200.0, Locale.US))
    }

    @Test
    fun formattersRenderMissingAndNonFiniteAsEmDashGap() {
        val dash = "\u2014"
        assertEquals(dash, MotorHistoryChartsProjection.formatPower(null, Locale.US))
        assertEquals(dash, MotorHistoryChartsProjection.formatTorque(null, Locale.US))
        assertEquals(dash, MotorHistoryChartsProjection.formatRpm(null, Locale.US))
        assertEquals(dash, MotorHistoryChartsProjection.formatPower(Double.NaN, Locale.US))
        assertEquals(dash, MotorHistoryChartsProjection.formatPower(Double.POSITIVE_INFINITY, Locale.US))
    }

    @Test
    fun formattersHonorLocaleSeparators() {
        // German uses '.' for grouping and ',' for the decimal — proves the formatters are locale-driven.
        assertEquals("1.234,5", MotorHistoryChartsProjection.formatPower(1234.5, Locale.GERMANY))
        assertEquals("5.200", MotorHistoryChartsProjection.formatRpm(5200.0, Locale.GERMANY))
    }

    // ── i18n resolve-or-fallback (web t(key, default) parity) ──────────────────────

    @Test
    fun resolveOptionalReturnsCatalogValueWhenPresent() {
        val catalog = mapOf(KEY_POWER_ARIA to "Catalog power aria")
        assertEquals("Catalog power aria", resolveOptional({ catalog[it] }, KEY_POWER_ARIA, MotorHistoryChartsDefaults.POWER_ARIA))
    }

    @Test
    fun resolveOptionalFallsBackForEachAriaKeyWhenAbsentOrBlank() {
        assertEquals(
            MotorHistoryChartsDefaults.POWER_ARIA,
            resolveOptional({ null }, KEY_POWER_ARIA, MotorHistoryChartsDefaults.POWER_ARIA),
        )
        assertEquals(
            MotorHistoryChartsDefaults.TORQUE_ARIA,
            resolveOptional({ "  " }, KEY_TORQUE_ARIA, MotorHistoryChartsDefaults.TORQUE_ARIA),
        )
        assertEquals(
            MotorHistoryChartsDefaults.RPM_ARIA,
            resolveOptional({ null }, KEY_RPM_ARIA, MotorHistoryChartsDefaults.RPM_ARIA),
        )
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordMotorHistoryChartsOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "MotorHistoryCharts"), fields)
    }

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
