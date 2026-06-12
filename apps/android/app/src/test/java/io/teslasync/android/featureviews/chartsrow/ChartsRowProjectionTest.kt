package io.teslasync.android.featureviews.chartsrow

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the charging `ChartsRow`'s pure logic — the native analogue of the data the web
 * component reads from its props (web/src/features/charging/components/charging-list/ChartsRow.tsx): the
 * donut share fractions + percents (the web `<Pie>` value→angle mapping), the render-ready trend series, the
 * formatted cost-by-type rows (web `fmtWithUnit` / `${cost} total` / `${perKwh}/kWh`), the merged donut
 * description, and the PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class ChartsRowProjectionTest {
    private val data =
        ChartsRowData(
            energyTrend =
                listOf(
                    EnergyTrendPoint("Apr 04", 48.0, 12.4),
                    EnergyTrendPoint("Apr 06", 22.0, 9.1),
                ),
            chargerBreakdown =
                listOf(
                    ChargerBreakdownEntry("Supercharger", 6.0),
                    ChargerBreakdownEntry("DC Fast", 2.0),
                ),
            costByType = listOf(CostByTypeEntry("Supercharger", 142.6, 38.2, 0.27)),
        )

    private val formatters =
        ChartsRowFormatters(
            trendValue = { "v($it)" },
            energyText = { "e($it)" },
            costText = { "c($it)" },
            perKwhText = { "p($it)" },
            percentText = { "$it%" },
        )

    // ── Donut share math (web <Pie> value→angle parity) ───────────────────────────

    @Test
    fun fractionsComputeSharesPreservingOrder() {
        assertEquals(
            listOf(0.75, 0.25),
            ChartsRowProjection.fractions(
                listOf(ChargerBreakdownEntry("a", 6.0), ChargerBreakdownEntry("b", 2.0)),
            ),
        )
    }

    @Test
    fun fractionsReturnZeroForNonPositiveTotalAndEmptyForNoEntries() {
        assertEquals(
            listOf(0.0, 0.0),
            ChartsRowProjection.fractions(
                listOf(ChargerBreakdownEntry("a", 0.0), ChargerBreakdownEntry("b", 0.0)),
            ),
        )
        assertTrue(ChartsRowProjection.fractions(emptyList()).isEmpty())
    }

    @Test
    fun percentComputesShareAndZeroForNonPositiveTotal() {
        assertEquals(75.0, ChartsRowProjection.percent(6.0, 8.0), 0.0)
        assertEquals(0.0, ChartsRowProjection.percent(1.0, 0.0), 0.0)
    }

    @Test
    fun segmentsBuildOrderedSlicesWithFractionAndPercent() {
        val segments = ChartsRowProjection.segments(data.chargerBreakdown)

        assertEquals(
            listOf(
                ChargerSegment(name = "Supercharger", value = 6.0, fraction = 0.75, percent = 75.0),
                ChargerSegment(name = "DC Fast", value = 2.0, fraction = 0.25, percent = 25.0),
            ),
            segments,
        )
    }

    @Test
    fun segmentsReturnEmptyForNoEntries() {
        assertTrue(ChartsRowProjection.segments(emptyList()).isEmpty())
    }

    // ── Projection (trend series + donut segments + cost rows) ─────────────────────

    @Test
    fun projectBuildsTrendSegmentsAndCostRowsInOrder() {
        val result = ChartsRowProjection.project(data, formatters)

        assertEquals(listOf("Apr 04", "Apr 06"), result.trend.labels)
        assertEquals(listOf(48.0, 22.0), result.trend.energy)
        assertEquals(listOf(12.4, 9.1), result.trend.cost)

        assertEquals(2, result.segments.size)
        assertEquals(0.75, result.segments[0].fraction, 0.0)

        assertEquals(
            listOf(CostRow(name = "Supercharger", energyText = "e(142.6)", costText = "c(38.2)", perKwhText = "p(0.27)")),
            result.costRows,
        )

        assertFalse(result.isTrendEmpty)
        assertFalse(result.isBreakdownEmpty)
        assertFalse(result.isEmpty)
    }

    @Test
    fun projectReturnsFullyEmptyForNullData() {
        val result = ChartsRowProjection.project(null, formatters)

        assertTrue(result.trend.labels.isEmpty())
        assertTrue(result.trend.energy.isEmpty())
        assertTrue(result.trend.cost.isEmpty())
        assertTrue(result.segments.isEmpty())
        assertTrue(result.costRows.isEmpty())
        assertTrue(result.isTrendEmpty)
        assertTrue(result.isBreakdownEmpty)
        assertTrue(result.isEmpty)
    }

    @Test
    fun projectFlagsPartialEmptinessWhenOnlyCostRowsPresent() {
        val result =
            ChartsRowProjection.project(
                ChartsRowData(costByType = listOf(CostByTypeEntry("Home / AC", 88.4, 11.9, 0.13))),
                formatters,
            )

        assertTrue(result.isTrendEmpty)
        assertTrue(result.isBreakdownEmpty)
        // The whole surface is NOT empty — the cost list still has a row to show.
        assertFalse(result.isEmpty)
        assertEquals(1, result.costRows.size)
    }

    @Test
    fun donutDescriptionJoinsNameAndPercent() {
        val segments = ChartsRowProjection.segments(data.chargerBreakdown)

        val description = ChartsRowProjection.donutDescription(segments) { "${it.toInt()}%" }

        assertEquals("Supercharger (75%), DC Fast (25%)", description)
    }

    // ── Diagnostics (P1/S11 view.opened contract) ──────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordChartsRowOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "ChartsRow"), fields)
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
