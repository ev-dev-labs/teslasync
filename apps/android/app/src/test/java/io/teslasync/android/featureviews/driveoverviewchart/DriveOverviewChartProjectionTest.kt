package io.teslasync.android.featureviews.driveoverviewchart

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the Drive Overview chart's pure logic — the native analogue of the web
 * component's data derivations (web/src/features/driving/components/drive-detail/DriveOverviewChart.tsx):
 * the per-series presence guards + value columns, the est-vs-rated dataKey choice, the rich Mean/Max/Min
 * legend with its exact per-series formatter wiring (speed mean/max via `fmtNumber`, speed min via `fmtInt`,
 * ranges via `fmtInt`, SOC/usable-SOC via `fmtPercent`, power via `fmtWithUnit(_, 'kW')`), the `socS`
 * `battery > 0` filter and `estRangeS` `estRange ?? ratedRange` fallback, the `chartData.length > 1`
 * content/empty boundary, the `numberFormat` helpers, the `t(key, default)` resolve-or-fallback, and the
 * PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class DriveOverviewChartProjectionTest {
    // Stub formatters tag each value so the test pins which formatter + unit each legend cell uses.
    private fun stubFormatters(
        speedUnit: String = "mph",
        distanceUnit: String = "mi",
    ): DriveChartFormatters =
        DriveChartFormatters(
            number = { "N($it)" },
            integer = { "I($it)" },
            percent = { "P($it)" },
            powerKw = { "K($it)" },
            speedUnit = speedUnit,
            distanceUnit = distanceUnit,
        )

    private val fullTrace =
        listOf(
            DriveChartPoint(
                time = "09:00",
                speed = 0.0,
                battery = 80.0,
                power = 10.0,
                idealRange = 300.0,
                ratedRange = 290.0,
                estRange = 280.0,
                usableSoc = 78.0,
            ),
            DriveChartPoint(
                time = "09:05",
                speed = 40.0,
                battery = 78.0,
                power = 50.0,
                idealRange = 290.0,
                ratedRange = 280.0,
                estRange = 270.0,
                usableSoc = 76.0,
            ),
            DriveChartPoint(
                time = "09:10",
                speed = 80.0,
                battery = 0.0,
                power = -30.0,
                idealRange = null,
                ratedRange = null,
                estRange = null,
                usableSoc = null,
            ),
        )

    // ── DriveSeriesStat (web statFn parity) ───────────────────────────────────────

    @Test
    fun seriesStatComputesMeanMaxMinOverFiniteValues() {
        val stat = DriveSeriesStat.of(listOf(10.0, 50.0, -30.0))
        assertEquals(DriveSeriesStat(mean = 10.0, max = 50.0, min = -30.0), stat)
    }

    @Test
    fun seriesStatDropsNullAndNonFiniteSamples() {
        val stat = DriveSeriesStat.of(listOf(null, 4.0, Double.NaN, 8.0, Double.POSITIVE_INFINITY))
        assertEquals(DriveSeriesStat(mean = 6.0, max = 8.0, min = 4.0), stat)
    }

    @Test
    fun seriesStatReturnsNullWhenNoFiniteSample() {
        assertNull(DriveSeriesStat.of(emptyList()))
        assertNull(DriveSeriesStat.of(listOf(null, Double.NaN)))
    }

    // ── Projection: value columns + presence guards ───────────────────────────────

    @Test
    fun projectPreservesOrderAndBuildsPresentValueColumns() {
        val result = DriveOverviewChartProjection.project(fullTrace, stubFormatters())

        assertEquals(listOf("09:00", "09:05", "09:10"), result.xLabels)
        assertEquals(listOf(0.0, 40.0, 80.0), result.speedValues)
        assertEquals(listOf(300.0, 290.0, null), result.idealRangeValues)
        // any estRange present ⇒ the est column is used (web `chartData.some((d) => d.estRange !== null)`).
        assertEquals(listOf(280.0, 270.0, null), result.estRangeValues)
        // SOC line plots the raw battery, including the non-positive sample (only the legend filters > 0).
        assertEquals(listOf(80.0, 78.0, 0.0), result.socValues)
        assertEquals(listOf(78.0, 76.0, null), result.usableSocValues)
        assertEquals(listOf(10.0, 50.0, -30.0), result.powerValues)
        assertFalse(result.isEmpty)
    }

    @Test
    fun projectFallsBackToRatedRangeWhenNoEstRangePresent() {
        val trace =
            listOf(
                DriveChartPoint("a", speed = 10.0, battery = 50.0, power = 5.0, ratedRange = 200.0),
                DriveChartPoint("b", speed = 20.0, battery = 49.0, power = 6.0, ratedRange = 190.0),
            )

        val result = DriveOverviewChartProjection.project(trace, stubFormatters())

        // No estRange anywhere ⇒ the est column uses ratedRange (web ternary dataKey choice).
        assertEquals(listOf(200.0, 190.0), result.estRangeValues)
        assertNull(result.idealRangeValues)
        assertNull(result.usableSocValues)
    }

    @Test
    fun projectOmitsOptionalSeriesWhenAllNull() {
        val trace =
            listOf(
                DriveChartPoint("a", speed = 10.0, battery = 50.0, power = 5.0),
                DriveChartPoint("b", speed = 20.0, battery = 49.0, power = 6.0),
            )

        val result = DriveOverviewChartProjection.project(trace, stubFormatters())

        assertNull(result.idealRangeValues)
        assertNull(result.estRangeValues)
        assertNull(result.usableSocValues)
        // Speed, SOC, and Power remain — the three unconditional web series.
        assertEquals(listOf(DriveSeriesId.Speed, DriveSeriesId.Soc, DriveSeriesId.Power), result.legend.map { it.id })
    }

    // ── Projection: content/empty boundary (web chartData.length > 1) ──────────────

    @Test
    fun projectIsEmptyForZeroOrOneSampleAndContentForTwoPlus() {
        assertTrue(DriveOverviewChartProjection.project(emptyList(), stubFormatters()).isEmpty)
        assertTrue(DriveOverviewChartProjection.project(listOf(fullTrace.first()), stubFormatters()).isEmpty)
        assertFalse(DriveOverviewChartProjection.project(fullTrace.take(2), stubFormatters()).isEmpty)
    }

    // ── Projection: rich legend wiring (web ChartLegend items) ─────────────────────

    @Test
    fun projectBuildsLegendInOrderWithPerSeriesFormatterAndUnitWiring() {
        val legend = DriveOverviewChartProjection.project(fullTrace, stubFormatters()).legend

        val expected =
            listOf(
                // speed: mean/max via fmtNumber, min via fmtInt — the web's deliberate mixed formatting.
                DriveLegendEntryData(DriveSeriesId.Speed, false, mean = "N(40.0) mph", max = "N(80.0) mph", min = "I(0.0) mph"),
                DriveLegendEntryData(DriveSeriesId.IdealRange, true, mean = "I(295.0) mi", max = "I(300.0) mi", min = "I(290.0) mi"),
                DriveLegendEntryData(DriveSeriesId.EstRange, true, mean = "I(275.0) mi", max = "I(280.0) mi", min = "I(270.0) mi"),
                DriveLegendEntryData(DriveSeriesId.Soc, false, mean = "P(79.0)", max = "P(80.0)", min = "P(78.0)"),
                DriveLegendEntryData(DriveSeriesId.UsableSoc, false, mean = "P(77.0)", max = "P(78.0)", min = "P(76.0)"),
                DriveLegendEntryData(DriveSeriesId.Power, false, mean = "K(10.0)", max = "K(50.0)", min = "K(-30.0)"),
            )
        assertEquals(expected, legend)
    }

    @Test
    fun projectLegendSocUsesBatteryGreaterThanZeroFilter() {
        // p3 battery is 0 ⇒ excluded from the SOC stat (web `d.battery > 0 ? d.battery : null`),
        // so min is 78 (not 0) even though socValues still carries the raw 0.
        val socRow = DriveOverviewChartProjection.project(fullTrace, stubFormatters()).legend.first { it.id == DriveSeriesId.Soc }
        assertEquals("P(78.0)", socRow.min)
    }

    // ── numberFormat helpers (web fmtNumber/fmtInt/fmtPercent/fmtWithUnit parity) ───

    @Test
    fun numberGroupsThousandsAtRequestedPrecision() {
        assertEquals("85.43", DriveChartFormat.number(85.432, 2, Locale.US))
        assertEquals("1,234.50", DriveChartFormat.number(1234.5, 2, Locale.US))
        assertEquals("40", DriveChartFormat.number(40.0, 0, Locale.US))
    }

    @Test
    fun numberCoercesNonFiniteToZeroLikeSafeNumber() {
        assertEquals("0.00", DriveChartFormat.number(Double.NaN, 2, Locale.US))
        assertEquals("0.00", DriveChartFormat.number(Double.POSITIVE_INFINITY, 2, Locale.US))
    }

    @Test
    fun integerPercentAndWithUnitMatchWebHelpers() {
        assertEquals("12,346", DriveChartFormat.integer(12345.6, Locale.US))
        assertEquals("12,345", DriveChartFormat.integer(12345.4, Locale.US))
        assertEquals("85.43%", DriveChartFormat.percent(85.432, 2, Locale.US))
        assertEquals("42.57 kW", DriveChartFormat.withUnit(42.567, "kW", 2, Locale.US))
    }

    // ── i18n resolve-or-fallback (web t(key, default) parity) ──────────────────────

    @Test
    fun resolveOptionalReturnsCatalogValueWhenPresent() {
        val resolved = resolveOptional({ mapOf(KEY_ARIA to "Catalog aria")[it] }, KEY_ARIA, DriveOverviewChartDefaults.ARIA_LABEL)
        assertEquals("Catalog aria", resolved)
    }

    @Test
    fun resolveOptionalFallsBackWhenKeyAbsentOrBlank() {
        assertEquals(DriveOverviewChartDefaults.ARIA_LABEL, resolveOptional({ null }, KEY_ARIA, DriveOverviewChartDefaults.ARIA_LABEL))
        assertEquals(DriveOverviewChartDefaults.STAT_MEAN, resolveOptional({ "   " }, KEY_STAT_MEAN, DriveOverviewChartDefaults.STAT_MEAN))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordDriveOverviewChartOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "DriveOverviewChart"), fields)
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
