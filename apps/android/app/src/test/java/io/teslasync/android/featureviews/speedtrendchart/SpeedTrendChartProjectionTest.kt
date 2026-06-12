package io.teslasync.android.featureviews.speedtrendchart

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the Charging Speed Trend chart's pure logic — the native analogue of the web
 * component's `monthlyTrend` memo (web/src/features/charging/components/charging-curve/SpeedTrendChart.tsx
 * + helpers.ts): the DC/AC classification (`isDcSession`), the `avg` helper, the one-decimal `Math.round`
 * rounding, the W→kW grouping with ascending-month order, the chart/table projection, the locale-aware kW
 * formatting, and the PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class SpeedTrendChartProjectionTest {
    private companion object {
        const val EPS: Double = 1e-9
    }

    // ── isDcSession (web helpers.ts parity) ──────────────────────────────────────

    @Test
    fun isDcSessionClassifiesByChargerTypeThenPowerThreshold() {
        // Any non-empty charger type → DC, regardless of power.
        assertTrue(SpeedTrendChartProjection.isDcSession(session(power = 5_000.0, charger = "Tesla")))
        // No charger, power strictly above 20 kW → DC.
        assertTrue(SpeedTrendChartProjection.isDcSession(session(power = 50_000.0, charger = null)))
        // No charger, power exactly at the 20 kW threshold → AC (web uses strict `> 20_000`).
        assertFalse(SpeedTrendChartProjection.isDcSession(session(power = 20_000.0, charger = null)))
        // No charger, low power → AC.
        assertFalse(SpeedTrendChartProjection.isDcSession(session(power = 7_000.0, charger = null)))
        // Empty charger string is falsy (web truthiness) → falls through to the power check → AC.
        assertFalse(SpeedTrendChartProjection.isDcSession(session(power = 5_000.0, charger = "")))
        // Null power + null charger → AC.
        assertFalse(SpeedTrendChartProjection.isDcSession(session(power = null, charger = null)))
    }

    // ── avg + roundKw (web `avg` + `Math.round(x * 10) / 10`) ─────────────────────

    @Test
    fun avgReturnsMeanOrZeroForEmpty() {
        assertEquals(0.0, SpeedTrendChartProjection.avg(emptyList()), EPS)
        assertEquals(20.0, SpeedTrendChartProjection.avg(listOf(10.0, 20.0, 30.0)), EPS)
    }

    @Test
    fun roundKwRoundsHalfUpToOneDecimal() {
        assertEquals(50.0, SpeedTrendChartProjection.roundKw(50.0), EPS)
        assertEquals(12.3, SpeedTrendChartProjection.roundKw(12.34), EPS)
        assertEquals(12.4, SpeedTrendChartProjection.roundKw(12.36), EPS)
        assertEquals(12.3, SpeedTrendChartProjection.roundKw(12.25), EPS)
        assertEquals(0.0, SpeedTrendChartProjection.roundKw(0.0), EPS)
    }

    // ── monthlyTrend (web `monthlyTrend` memo) ────────────────────────────────────

    @Test
    fun monthlyTrendGroupsSortsAscendingAndSplitsDcAc() {
        val sessions =
            listOf(
                // 2026-03: one DC (charger), one AC (low power, no charger)
                session(started = "2026-03-10T08:00:00Z", power = 100_000.0, charger = "Tesla"),
                session(started = "2026-03-20T22:00:00Z", power = 7_000.0, charger = null),
                // 2026-01: one DC by power threshold (no charger)
                session(started = "2026-01-05T12:00:00Z", power = 50_000.0, charger = null),
            )

        val trend = SpeedTrendChartProjection.monthlyTrend(sessions)

        assertEquals(listOf("2026-01", "2026-03"), trend.map { it.month })
        // 2026-01: DC avg 50 kW, no AC → 0.
        assertEquals(50.0, trend[0].dcAvgKw, EPS)
        assertEquals(0.0, trend[0].acAvgKw, EPS)
        // 2026-03: DC avg 100 kW, AC avg 7 kW.
        assertEquals(100.0, trend[1].dcAvgKw, EPS)
        assertEquals(7.0, trend[1].acAvgKw, EPS)
    }

    @Test
    fun monthlyTrendAveragesMultipleSessionsConvertingWattsToKw() {
        val sessions =
            listOf(
                session(started = "2026-05-01T00:00:00Z", power = 100_000.0, charger = "CCS"),
                session(started = "2026-05-15T00:00:00Z", power = 80_000.0, charger = "CCS"),
            )

        val trend = SpeedTrendChartProjection.monthlyTrend(sessions)

        assertEquals(1, trend.size)
        // (100 kW + 80 kW) / 2 = 90 kW.
        assertEquals(90.0, trend.single().dcAvgKw, EPS)
        assertEquals(0.0, trend.single().acAvgKw, EPS)
    }

    @Test
    fun monthlyTrendReturnsEmptyForNoSessions() {
        assertTrue(SpeedTrendChartProjection.monthlyTrend(emptyList()).isEmpty())
    }

    @Test
    fun monthlyTrendBucketsNullStartedAtUnderEmptyMonthKey() {
        val trend = SpeedTrendChartProjection.monthlyTrend(listOf(session(started = null, power = 50_000.0)))

        assertEquals(listOf(""), trend.map { it.month })
        assertEquals(50.0, trend.single().dcAvgKw, EPS)
    }

    // ── project (web chart `data` + `dataColumns`) ────────────────────────────────

    @Test
    fun projectBuildsAxisLabelsSeriesAndTableRows() {
        val sessions =
            listOf(
                session(started = "2026-02-04T08:00:00Z", power = 120_000.0, charger = "Tesla"),
                session(started = "2026-03-21T23:10:00Z", power = 11_000.0, charger = null),
            )

        val result = SpeedTrendChartProjection.project(sessions, formatValue = { kw -> "kw:$kw" })

        assertFalse(result.isEmpty)
        assertEquals(listOf("2026-02", "2026-03"), result.months)
        assertEquals(listOf<Double?>(120.0, 0.0), result.dcValues)
        assertEquals(listOf<Double?>(0.0, 11.0), result.acValues)
        assertEquals(
            listOf(
                listOf("2026-02", "kw:120.0", "kw:0.0"),
                listOf("2026-03", "kw:0.0", "kw:11.0"),
            ),
            result.tableRows,
        )
    }

    @Test
    fun projectReturnsEmptyResultForNoSessions() {
        val result = SpeedTrendChartProjection.project(emptyList(), formatValue = { it.toString() })

        assertTrue(result.isEmpty)
        assertTrue(result.months.isEmpty())
        assertTrue(result.dcValues.isEmpty())
        assertTrue(result.acValues.isEmpty())
        assertTrue(result.tableRows.isEmpty())
    }

    // ── formatKw (locale-aware one-decimal kW) ────────────────────────────────────

    @Test
    fun formatKwRendersOneDecimalInGivenLocale() {
        assertEquals("11.5", SpeedTrendChartProjection.formatKw(11.5, Locale.US))
        assertEquals("0.0", SpeedTrendChartProjection.formatKw(0.0, Locale.US))
        assertEquals("120.0", SpeedTrendChartProjection.formatKw(120.0, Locale.US))
        assertEquals("1,234.5", SpeedTrendChartProjection.formatKw(1_234.5, Locale.US))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordSpeedTrendChartOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "SpeedTrendChart"), fields)
    }

    private fun session(
        started: String? = "2026-01-01T00:00:00Z",
        power: Double? = null,
        charger: String? = null,
    ): ChargingSpeedSession = ChargingSpeedSession(startedAt = started, peakPowerW = power, chargerType = charger)

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
