package io.teslasync.android.featureviews.socroutechart

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the "Battery Along Route" chart's pure logic — the native analogue of the web
 * component's data derivations (web/src/features/driving/components/SOCRouteChart.tsx): the curve →
 * (xLabels, soc area values, constant threshold values, accessible-table rows) projection with its empty
 * guard and preserved order, the charge-stop matching walk (web `stopDistances`: tolerance, cumulative
 * cursor, matched-only numbering), the one-decimal value formatting (web `Math.round(x * 10) / 10`), the
 * dynamic `Min N%` / `⚡ Stop N` label formatting (web inline template literals), the `t(key, default)`
 * resolve-or-fallback, and the PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest
 * gate.
 */
class SOCRouteChartProjectionTest {
    // ── Projection ──────────────────────────────────────────────────────────────

    @Test
    fun projectMapsCurvePreservingOrderWithLabelsRoundedValuesThresholdAndTableRows() {
        val data =
            SOCRouteData(
                socCurve =
                    listOf(
                        TripSOCPoint(distanceM = 0.0, soc = 90.0),
                        TripSOCPoint(distanceM = 40_000.0, soc = 58.46),
                        TripSOCPoint(distanceM = 80_000.0, soc = 12.04),
                    ),
                chargeStops = emptyList(),
                minArrivalSoc = 10.0,
            )

        val result =
            SOCRouteChartProjection.project(
                data = data,
                formatDistance = { distanceM -> "D($distanceM)" },
                formatSoc = { soc -> "S($soc)" },
            )

        assertFalse(result.isEmpty)
        assertEquals(listOf("D(0.0)", "D(40000.0)", "D(80000.0)"), result.xLabels)
        // Area values are rounded to one decimal — the web `Math.round(p.soc * 10) / 10`.
        assertEquals(listOf(90.0, 58.5, 12.0), result.socValues)
        // The horizontal min-arrival reference line is a constant series across every sample.
        assertEquals(listOf(10.0, 10.0, 10.0), result.thresholdValues)
        // The accessible table feeds the RAW soc to the formatter (the real formatter rounds for display).
        assertEquals(
            listOf(
                listOf("D(0.0)", "S(90.0)"),
                listOf("D(40000.0)", "S(58.46)"),
                listOf("D(80000.0)", "S(12.04)"),
            ),
            result.tableRows,
        )
        assertTrue(result.stops.isEmpty())
    }

    @Test
    fun projectReturnsEmptyResultForNoCurve() {
        val result =
            SOCRouteChartProjection.project(
                data = SOCRouteData(socCurve = emptyList(), chargeStops = emptyList(), minArrivalSoc = 10.0),
                formatDistance = { it.toString() },
                formatSoc = { it.toString() },
            )

        assertTrue(result.isEmpty)
        assertTrue(result.xLabels.isEmpty())
        assertTrue(result.socValues.isEmpty())
        assertTrue(result.thresholdValues.isEmpty())
        assertTrue(result.tableRows.isEmpty())
        assertTrue(result.stops.isEmpty())
    }

    @Test
    fun projectPopulatesStopsFromTheCurve() {
        val data =
            SOCRouteData(
                socCurve =
                    listOf(
                        TripSOCPoint(distanceM = 0.0, soc = 90.0),
                        TripSOCPoint(distanceM = 40_000.0, soc = 60.0),
                        TripSOCPoint(distanceM = 80_000.0, soc = 28.0),
                        TripSOCPoint(distanceM = 120_000.0, soc = 12.0),
                    ),
                chargeStops = listOf(RouteChargeStop(chargeFromSoc = 30.0), RouteChargeStop(chargeFromSoc = 12.0)),
                minArrivalSoc = 10.0,
            )

        val result =
            SOCRouteChartProjection.project(
                data = data,
                formatDistance = { it.toString() },
                formatSoc = { it.toString() },
            )

        assertEquals(listOf(StopMarker(index = 2, ordinal = 1), StopMarker(index = 3, ordinal = 2)), result.stops)
    }

    // ── Charge-stop matching (web stopDistances walk) ─────────────────────────────

    @Test
    fun computeStopMarkersMatchesNearestSocPastTheCumulativeCursorAndAdvances() {
        val points =
            listOf(
                TripSOCPoint(distanceM = 0.0, soc = 90.0),
                TripSOCPoint(distanceM = 40_000.0, soc = 60.0),
                TripSOCPoint(distanceM = 80_000.0, soc = 28.0),
                TripSOCPoint(distanceM = 120_000.0, soc = 12.0),
                TripSOCPoint(distanceM = 160_000.0, soc = 65.0),
            )
        val stops = listOf(RouteChargeStop(chargeFromSoc = 30.0), RouteChargeStop(chargeFromSoc = 12.0))

        val markers = SOCRouteChartProjection.computeStopMarkers(points, stops)

        assertEquals(listOf(StopMarker(index = 2, ordinal = 1), StopMarker(index = 3, ordinal = 2)), markers)
    }

    @Test
    fun computeStopMarkersSkipsUnmatchedStopsWithoutConsumingAnOrdinal() {
        val points =
            listOf(
                TripSOCPoint(distanceM = 0.0, soc = 90.0),
                TripSOCPoint(distanceM = 40_000.0, soc = 28.0),
                TripSOCPoint(distanceM = 80_000.0, soc = 12.0),
            )
        // The middle stop (99 %) matches no sample; the matched ordinals must stay 1, 2 (web numbers the
        // matched list, not the input list).
        val stops =
            listOf(
                RouteChargeStop(chargeFromSoc = 30.0),
                RouteChargeStop(chargeFromSoc = 99.0),
                RouteChargeStop(chargeFromSoc = 12.0),
            )

        val markers = SOCRouteChartProjection.computeStopMarkers(points, stops)

        assertEquals(listOf(StopMarker(index = 1, ordinal = 1), StopMarker(index = 2, ordinal = 2)), markers)
    }

    @Test
    fun computeStopMarkersTreatsAFivePercentDifferenceAsOutsideTheTolerance() {
        // |25 - 30| == 5 is NOT < 5, so the sample is rejected (the web strict `< 5`).
        val points = listOf(TripSOCPoint(distanceM = 40_000.0, soc = 25.0))
        val stops = listOf(RouteChargeStop(chargeFromSoc = 30.0))

        assertTrue(SOCRouteChartProjection.computeStopMarkers(points, stops).isEmpty())
    }

    @Test
    fun computeStopMarkersRequiresStrictlyIncreasingDistancePerStop() {
        val points =
            listOf(
                TripSOCPoint(distanceM = 0.0, soc = 50.0),
                TripSOCPoint(distanceM = 10_000.0, soc = 20.0),
                TripSOCPoint(distanceM = 20_000.0, soc = 20.0),
                TripSOCPoint(distanceM = 30_000.0, soc = 20.0),
            )
        val stops =
            listOf(
                RouteChargeStop(chargeFromSoc = 20.0),
                RouteChargeStop(chargeFromSoc = 20.0),
                RouteChargeStop(chargeFromSoc = 20.0),
            )

        val markers = SOCRouteChartProjection.computeStopMarkers(points, stops)

        assertEquals(
            listOf(
                StopMarker(index = 1, ordinal = 1),
                StopMarker(index = 2, ordinal = 2),
                StopMarker(index = 3, ordinal = 3),
            ),
            markers,
        )
    }

    @Test
    fun computeStopMarkersReturnsEmptyForNoStopsOrNoPoints() {
        val points = listOf(TripSOCPoint(distanceM = 40_000.0, soc = 30.0))
        assertTrue(SOCRouteChartProjection.computeStopMarkers(points, emptyList()).isEmpty())
        assertTrue(
            SOCRouteChartProjection.computeStopMarkers(emptyList(), listOf(RouteChargeStop(chargeFromSoc = 30.0))).isEmpty(),
        )
    }

    @Test
    fun computeStopMarkersIgnoresTheZeroDistanceOriginSample() {
        // cumDist starts at 0 and the comparison is strict, so a 0 m sample never matches (web `> cumDist`).
        val points =
            listOf(
                TripSOCPoint(distanceM = 0.0, soc = 30.0),
                TripSOCPoint(distanceM = 50_000.0, soc = 30.0),
            )
        val stops = listOf(RouteChargeStop(chargeFromSoc = 30.0))

        assertEquals(listOf(StopMarker(index = 1, ordinal = 1)), SOCRouteChartProjection.computeStopMarkers(points, stops))
    }

    // ── Value formatting (web Math.round(x * 10) / 10 parity) ─────────────────────

    @Test
    fun formatValueShowsWholeNumbersWithoutDecimalAndGroupsThousands() {
        assertEquals("50,000", SOCRouteChartProjection.formatValue(50_000.0, Locale.US))
        assertEquals("0", SOCRouteChartProjection.formatValue(0.0, Locale.US))
        assertEquals("20", SOCRouteChartProjection.formatValue(20.0, Locale.US))
    }

    @Test
    fun formatValueKeepsOneDecimalForFractionalValues() {
        assertEquals("22.5", SOCRouteChartProjection.formatValue(22.5, Locale.US))
        assertEquals("58.5", SOCRouteChartProjection.formatValue(58.46, Locale.US))
    }

    @Test
    fun formatValueReturnsEmDashForNonFiniteInput() {
        assertEquals(EM_DASH, SOCRouteChartProjection.formatValue(Double.NaN, Locale.US))
        assertEquals(EM_DASH, SOCRouteChartProjection.formatValue(Double.POSITIVE_INFINITY, Locale.US))
    }

    // ── Reference-line label formatting (web inline template literals) ────────────

    @Test
    fun formatMinLineLabelRendersTheWebMinThresholdLiteral() {
        assertEquals(
            "Min 10%",
            SOCRouteChartProjection.formatMinLineLabel(SOCRouteChartDefaults.MIN_LINE, 10.0, Locale.US),
        )
        assertEquals(
            "Min 12.5%",
            SOCRouteChartProjection.formatMinLineLabel(SOCRouteChartDefaults.MIN_LINE, 12.5, Locale.US),
        )
    }

    @Test
    fun formatStopLabelRendersTheWebChargeStopLiteral() {
        assertEquals(
            "\u26A1 Stop 1",
            SOCRouteChartProjection.formatStopLabel(SOCRouteChartDefaults.CHARGE_STOP, 1, Locale.US),
        )
        assertEquals(
            "\u26A1 Stop 3",
            SOCRouteChartProjection.formatStopLabel(SOCRouteChartDefaults.CHARGE_STOP, 3, Locale.US),
        )
    }

    // ── i18n resolve-or-fallback (web t(key, default) parity) ──────────────────────

    @Test
    fun resolveOptionalReturnsCatalogValueWhenPresent() {
        val resolved =
            resolveOptional(
                lookup = { mapOf(KEY_MIN_LINE to "Floor %1\$s%%")[it] },
                resourceName = KEY_MIN_LINE,
                fallback = SOCRouteChartDefaults.MIN_LINE,
            )
        assertEquals("Floor %1\$s%%", resolved)
    }

    @Test
    fun resolveOptionalFallsBackWhenKeyAbsentOrBlank() {
        assertEquals(
            SOCRouteChartDefaults.MIN_LINE,
            resolveOptional({ null }, KEY_MIN_LINE, SOCRouteChartDefaults.MIN_LINE),
        )
        assertEquals(
            SOCRouteChartDefaults.CHARGE_STOP,
            resolveOptional({ "   " }, KEY_CHARGE_STOP, SOCRouteChartDefaults.CHARGE_STOP),
        )
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordSOCRouteChartOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "SOCRouteChart"), fields)
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
