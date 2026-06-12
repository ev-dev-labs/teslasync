package io.teslasync.android.featureviews.powerprofilechart

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the Power Profile chart's pure logic — the native analogue of the web
 * component's data derivations (web/src/features/driving/components/drive-detail/PowerProfileChart.tsx +
 * the useDriveDetailData stats it consumes): the `powerMax`/`powerMin`/`avgPower` derivation (non-zero
 * filter, `Math.max`/`Math.min`, the `avgPowerW / 1000` average with chart-mean fallback, and the
 * all-zero/empty fallbacks), the `chartData.length > 1` content/empty boundary with its footer-presence
 * coupling, the footer's exact per-figure formatter wiring (Max Power / Max Regen via `fmtInt`, Avg via
 * `fmtNumber`), the `numberFormat` helpers, the `t(key, default)` resolve-or-fallback, and the PII-safe
 * `view.opened` diagnostic. Runs in the :app:testReleaseUnitTest gate.
 */
class PowerProfileChartProjectionTest {
    private companion object {
        const val EPS: Double = 1e-9
    }

    // Stub formatters tag each value so the test pins which formatter + unit each footer cell uses.
    private fun stubFormatters(): PowerProfileFormatters =
        PowerProfileFormatters(
            integer = { "I($it)" },
            number = { "N($it)" },
            powerUnit = "kW",
        )

    private val fullTrace =
        listOf(
            PowerProfilePoint(time = "09:00", power = 0.0),
            PowerProfilePoint(time = "09:05", power = 80.0),
            PowerProfilePoint(time = "09:10", power = -30.0),
            PowerProfilePoint(time = "09:15", power = 10.0),
        )

    // ── PowerProfileStats.from (web useDriveDetailData L144-151 parity) ────────────

    @Test
    fun statsComputeMaxMinOverNonZeroAndMeanOverAllWhenNoDriveAvg() {
        val stats = PowerProfileStats.from(fullTrace, avgPowerW = null)

        // Max/min over the non-zero samples (web `filter(p => p !== 0)`).
        assertEquals(80.0, stats.powerMax, EPS)
        assertEquals(-30.0, stats.powerMin, EPS)
        // avgPowerW null → mean over ALL samples incl. the zero: (0 + 80 - 30 + 10) / 4 = 15.
        assertEquals(15.0, stats.avgPower, EPS)
    }

    @Test
    fun statsUseDriveAvgPowerWConvertedToKwWhenPresent() {
        val stats = PowerProfileStats.from(fullTrace, avgPowerW = 20_000.0)

        // Extremes still come from the samples; only the average switches to drive.avgPowerW / 1000.
        assertEquals(80.0, stats.powerMax, EPS)
        assertEquals(-30.0, stats.powerMin, EPS)
        assertEquals(20.0, stats.avgPower, EPS)
    }

    @Test
    fun statsFallBackToDriveAvgForMaxAndZeroForMinWhenAllSamplesZero() {
        val allZero = listOf(PowerProfilePoint("a", 0.0), PowerProfilePoint("b", 0.0))

        val withDrive = PowerProfileStats.from(allZero, avgPowerW = 20_000.0)
        // No non-zero sample → powerMax = (avgPowerW ?? 0) / 1000, powerMin = 0.
        assertEquals(20.0, withDrive.powerMax, EPS)
        assertEquals(0.0, withDrive.powerMin, EPS)
        assertEquals(20.0, withDrive.avgPower, EPS)

        val withoutDrive = PowerProfileStats.from(allZero, avgPowerW = null)
        // No non-zero sample and no drive avg → powerMax falls back to 0.
        assertEquals(0.0, withoutDrive.powerMax, EPS)
        assertEquals(0.0, withoutDrive.powerMin, EPS)
        assertEquals(0.0, withoutDrive.avgPower, EPS)
    }

    @Test
    fun statsFromEmptyTraceUseDriveAvgOrZero() {
        val empty = PowerProfileStats.from(emptyList(), avgPowerW = 50_000.0)
        assertEquals(50.0, empty.powerMax, EPS)
        assertEquals(0.0, empty.powerMin, EPS)
        assertEquals(50.0, empty.avgPower, EPS)

        val emptyNoDrive = PowerProfileStats.from(emptyList(), avgPowerW = null)
        assertEquals(PowerProfileStats(0.0, 0.0, 0.0), emptyNoDrive)
    }

    @Test
    fun dataFromDerivesStatsFromTrace() {
        val data = PowerProfileData.from(fullTrace, avgPowerW = 20_000.0)

        assertEquals(fullTrace, data.points)
        assertEquals(PowerProfileStats(powerMax = 80.0, powerMin = -30.0, avgPower = 20.0), data.stats)
    }

    // ── Projection: value columns + content/empty boundary (web chartData.length > 1) ──

    @Test
    fun projectPreservesOrderBuildsPowerColumnAndIsContentForTwoPlus() {
        val result = PowerProfileChartProjection.project(PowerProfileData.from(fullTrace), stubFormatters())

        assertEquals(listOf("09:00", "09:05", "09:10", "09:15"), result.xLabels)
        assertEquals(listOf(0.0, 80.0, -30.0, 10.0), result.powerValues)
        assertFalse(result.isEmpty)
    }

    @Test
    fun projectIsEmptyForZeroOrOneSampleAndOmitsFooter() {
        val zero = PowerProfileChartProjection.project(PowerProfileData.from(emptyList()), stubFormatters())
        assertTrue(zero.isEmpty)
        assertNull(zero.footer)

        val one =
            PowerProfileChartProjection.project(
                PowerProfileData.from(listOf(fullTrace.first())),
                stubFormatters(),
            )
        assertTrue(one.isEmpty)
        assertNull(one.footer)
    }

    // ── Projection: footer formatter + unit wiring (web summary row) ───────────────

    @Test
    fun projectBuildsFooterWithIntegerExtremesAndNumberAverage() {
        // avgPowerW null → avg is the chart mean (15.0); extremes from the non-zero samples.
        val footer =
            PowerProfileChartProjection.project(PowerProfileData.from(fullTrace), stubFormatters()).footer

        assertNotNull(footer)
        // Max Power + Max Regen use the integer formatter; Avg uses the number formatter; all suffixed kW.
        assertEquals("I(80.0) kW", footer?.maxPower)
        assertEquals("I(-30.0) kW", footer?.maxRegen)
        assertEquals("N(15.0) kW", footer?.avg)
    }

    // ── numberFormat helpers (web fmtNumber / fmtInt parity) ───────────────────────

    @Test
    fun numberGroupsThousandsAtRequestedPrecision() {
        assertEquals("85.43", PowerProfileFormat.number(85.432, 2, Locale.US))
        assertEquals("1,234.50", PowerProfileFormat.number(1234.5, 2, Locale.US))
        assertEquals("40", PowerProfileFormat.number(40.0, 0, Locale.US))
    }

    @Test
    fun numberCoercesNonFiniteToZeroLikeSafeNumber() {
        assertEquals("0.00", PowerProfileFormat.number(Double.NaN, 2, Locale.US))
        assertEquals("0.00", PowerProfileFormat.number(Double.POSITIVE_INFINITY, 2, Locale.US))
    }

    @Test
    fun integerRoundsHalfUpAndKeepsSign() {
        assertEquals("12,346", PowerProfileFormat.integer(12345.6, Locale.US))
        assertEquals("12,345", PowerProfileFormat.integer(12345.4, Locale.US))
        assertEquals("-42", PowerProfileFormat.integer(-42.4, Locale.US))
    }

    // ── i18n resolve-or-fallback (web t(key, default) parity) ──────────────────────

    @Test
    fun resolveOptionalReturnsCatalogValueWhenPresent() {
        val resolved = resolveOptional({ mapOf(KEY_ARIA to "Catalog aria")[it] }, KEY_ARIA, PowerProfileChartDefaults.ARIA_LABEL)
        assertEquals("Catalog aria", resolved)
    }

    @Test
    fun resolveOptionalFallsBackWhenKeyAbsentOrBlank() {
        assertEquals(PowerProfileChartDefaults.ARIA_LABEL, resolveOptional({ null }, KEY_ARIA, PowerProfileChartDefaults.ARIA_LABEL))
        assertEquals(PowerProfileChartDefaults.ARIA_LABEL, resolveOptional({ "   " }, KEY_ARIA, PowerProfileChartDefaults.ARIA_LABEL))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordPowerProfileChartOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "PowerProfileChart"), fields)
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
