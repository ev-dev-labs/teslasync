package io.teslasync.android.featureviews.chargertypechart

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the Charge-Rate-by-Charger-Type chart's pure logic — the native analogue of the
 * web component's derivations (web/src/features/charging/components/charging-curve/ChargerTypeChart.tsx and
 * its `helpers.ts`): the `getChargerLabel` classification, the `durationMinutes` helper with its
 * invalid-/negative-range guard, the `avg` helper, the `chargerTypeStats` aggregation (grouping, averaging,
 * preserved order), the render-ready projection (chart series + data table + breakdown footer), and the
 * PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class ChargerTypeChartProjectionTest {
    private val sessions =
        listOf(
            ChargerSession("Tesla", 150_000.0, 48_000.0, "2026-04-04T10:00:00Z", "2026-04-04T10:30:00Z"),
            ChargerSession("Tesla", 90_000.0, 30_000.0, "2026-04-05T09:00:00Z", "2026-04-05T09:50:00Z"),
            ChargerSession("ChargePoint", 50_000.0, 22_000.0, "2026-04-06T12:00:00Z", "2026-04-06T12:40:00Z"),
            ChargerSession(null, 11_000.0, 18_000.0, "2026-04-07T22:00:00Z", "2026-04-07T23:00:00Z"),
        )

    private val formatters =
        ChargerTypeChartFormatters(
            label = { it.name },
            decimal1 = { "kw($it)" },
            count = { "c($it)" },
            durationInt = { "d($it)" },
            breakdownSummary = { count, avgDurationMin -> "S[$count|$avgDurationMin]" },
        )

    // ── Classification (web getChargerLabel parity) ───────────────────────────────

    @Test
    fun classifyTreatsAnyTeslaChargerAsSupercharger() {
        assertEquals(ChargerCategory.Supercharger, ChargerTypeChartProjection.classify(session("Tesla")))
        assertEquals(ChargerCategory.Supercharger, ChargerTypeChartProjection.classify(session("TESLA")))
        assertEquals(ChargerCategory.Supercharger, ChargerTypeChartProjection.classify(session("tesla supercharger v3")))
    }

    @Test
    fun classifyTreatsOtherNonEmptyTypeAsDcFast() {
        assertEquals(ChargerCategory.DcFast, ChargerTypeChartProjection.classify(session("ChargePoint")))
        assertEquals(ChargerCategory.DcFast, ChargerTypeChartProjection.classify(session("EVgo")))
    }

    @Test
    fun classifyUsesPeakPowerHeuristicWhenTypeIsAbsent() {
        assertEquals(ChargerCategory.DcFast, ChargerTypeChartProjection.classify(session(null, 50_000.0)))
        assertEquals(ChargerCategory.DcFast, ChargerTypeChartProjection.classify(session("", 30_000.0)))
        // The 20 kW threshold is strict (web `> 20_000`), so exactly 20 kW is Home / AC.
        assertEquals(ChargerCategory.HomeAc, ChargerTypeChartProjection.classify(session(null, 20_000.0)))
        assertEquals(ChargerCategory.HomeAc, ChargerTypeChartProjection.classify(session("", 11_000.0)))
        assertEquals(ChargerCategory.HomeAc, ChargerTypeChartProjection.classify(session(null, null)))
    }

    // ── Duration (web durationMinutes parity + guards) ────────────────────────────

    @Test
    fun durationMinutesRoundsToWholeMinutes() {
        assertEquals(30L, ChargerTypeChartProjection.durationMinutes("2026-04-04T10:00:00Z", "2026-04-04T10:30:00Z"))
        assertEquals(1L, ChargerTypeChartProjection.durationMinutes("2026-04-04T10:00:00Z", "2026-04-04T10:00:40Z"))
    }

    @Test
    fun durationMinutesAcceptsOffsetAndZonelessTimestamps() {
        assertEquals(30L, ChargerTypeChartProjection.durationMinutes("2026-04-04T10:00:00+00:00", "2026-04-04T10:30:00+00:00"))
        assertEquals(30L, ChargerTypeChartProjection.durationMinutes("2026-04-04T10:00:00", "2026-04-04T10:30:00"))
    }

    @Test
    fun durationMinutesReturnsZeroForOpenInvalidOrNonPositiveRanges() {
        assertEquals(0L, ChargerTypeChartProjection.durationMinutes("2026-04-04T10:00:00Z", null))
        assertEquals(0L, ChargerTypeChartProjection.durationMinutes("2026-04-04T10:30:00Z", "2026-04-04T10:00:00Z"))
        assertEquals(0L, ChargerTypeChartProjection.durationMinutes("2026-04-04T10:00:00Z", "2026-04-04T10:00:00Z"))
        assertEquals(0L, ChargerTypeChartProjection.durationMinutes("not-a-date", "2026-04-04T10:30:00Z"))
        assertEquals(0L, ChargerTypeChartProjection.durationMinutes("2026-04-04T10:00:00Z", "   "))
    }

    // ── Mean (web avg parity) ──────────────────────────────────────────────────────

    @Test
    fun avgComputesMeanAndZeroForEmpty() {
        assertEquals(0.0, ChargerTypeChartProjection.avg(emptyList()), 0.0)
        assertEquals(4.0, ChargerTypeChartProjection.avg(listOf(2.0, 4.0, 6.0)), 0.0)
        assertEquals(5.0, ChargerTypeChartProjection.avg(listOf(5.0)), 0.0)
    }

    // ── Aggregation (web chargerTypeStats parity) ──────────────────────────────────

    @Test
    fun aggregateGroupsByCategoryPreservingOrderWithAverages() {
        val stats = ChargerTypeChartProjection.aggregate(sessions)

        assertEquals(
            listOf(ChargerCategory.Supercharger, ChargerCategory.DcFast, ChargerCategory.HomeAc),
            stats.map { it.category },
        )

        val supercharger = stats[0]
        assertEquals(2L, supercharger.count)
        assertEquals(120.0, supercharger.avgKw, 0.0)
        assertEquals(39.0, supercharger.avgKwh, 0.0)
        assertEquals(40.0, supercharger.avgDurationMin, 0.0)

        val dcFast = stats[1]
        assertEquals(1L, dcFast.count)
        assertEquals(50.0, dcFast.avgKw, 0.0)
        assertEquals(22.0, dcFast.avgKwh, 0.0)
        assertEquals(40.0, dcFast.avgDurationMin, 0.0)

        val homeAc = stats[2]
        assertEquals(1L, homeAc.count)
        assertEquals(11.0, homeAc.avgKw, 0.0)
        assertEquals(18.0, homeAc.avgKwh, 0.0)
        assertEquals(60.0, homeAc.avgDurationMin, 0.0)
    }

    @Test
    fun aggregateTreatsMissingPeakPowerAsZeroKw() {
        val stats =
            ChargerTypeChartProjection.aggregate(
                listOf(
                    ChargerSession("Tesla", null, 40_000.0, "2026-04-04T10:00:00Z", "2026-04-04T10:20:00Z"),
                    ChargerSession("Tesla", 100_000.0, 20_000.0, "2026-04-04T11:00:00Z", "2026-04-04T11:20:00Z"),
                ),
            )

        assertEquals(1, stats.size)
        // (0 + 100) / 2 = 50 kW — the absent peak power contributes 0, mirroring web `?? 0`.
        assertEquals(50.0, stats.single().avgKw, 0.0)
    }

    @Test
    fun aggregateReturnsEmptyForNoSessions() {
        assertTrue(ChargerTypeChartProjection.aggregate(emptyList()).isEmpty())
    }

    // ── Projection (web chart series + data table + breakdown footer) ──────────────

    @Test
    fun projectBuildsLabelsSeriesTableAndBreakdownInOrder() {
        val result = ChargerTypeChartProjection.project(sessions, formatters)

        assertFalse(result.isEmpty)
        assertEquals(listOf("Supercharger", "DcFast", "HomeAc"), result.xLabels)
        assertEquals(listOf(120.0, 50.0, 11.0), result.avgKwValues)
        assertEquals(listOf(39.0, 22.0, 18.0), result.avgKwhValues)

        assertEquals(
            listOf(
                listOf("Supercharger", "c(2)", "kw(120.0)", "kw(39.0)", "d(40.0)"),
                listOf("DcFast", "c(1)", "kw(50.0)", "kw(22.0)", "d(40.0)"),
                listOf("HomeAc", "c(1)", "kw(11.0)", "kw(18.0)", "d(60.0)"),
            ),
            result.tableRows,
        )

        assertEquals(
            listOf(
                ChargerBreakdownRow(ChargerCategory.Supercharger, "Supercharger", "S[2|40.0]"),
                ChargerBreakdownRow(ChargerCategory.DcFast, "DcFast", "S[1|40.0]"),
                ChargerBreakdownRow(ChargerCategory.HomeAc, "HomeAc", "S[1|60.0]"),
            ),
            result.breakdownRows,
        )
    }

    @Test
    fun projectReturnsEmptyResultForNoSessions() {
        val result = ChargerTypeChartProjection.project(emptyList(), formatters)

        assertTrue(result.isEmpty)
        assertTrue(result.xLabels.isEmpty())
        assertTrue(result.avgKwValues.isEmpty())
        assertTrue(result.avgKwhValues.isEmpty())
        assertTrue(result.tableRows.isEmpty())
        assertTrue(result.breakdownRows.isEmpty())
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordChargerTypeChartOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "ChargerTypeChart"), fields)
    }

    private fun session(
        chargerType: String?,
        peakPowerW: Double? = 11_000.0,
    ): ChargerSession =
        ChargerSession(
            chargerType = chargerType,
            peakPowerW = peakPowerW,
            totalEnergyAddedWh = 10_000.0,
            startedAt = "2026-04-04T10:00:00Z",
            endedAt = "2026-04-04T10:30:00Z",
        )

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
