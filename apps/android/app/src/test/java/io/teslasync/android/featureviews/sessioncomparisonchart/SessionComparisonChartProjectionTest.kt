package io.teslasync.android.featureviews.sessioncomparisonchart

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneOffset
import java.util.Locale

/**
 * Off-device verification of the Session Comparison chart's pure logic — the native analogue of the web
 * component's `useMemo` derivations
 * (web/src/features/charging/components/charging-curve/SessionComparisonChart.tsx) plus the `helpers.ts`
 * charger/curve maths: the first-10 cap, the simulated power-vs-SOC curve (DC taper vs AC flat), the sorted
 * SOC union with each session's power aligned (gaps as `null`), the charger classification, the SOC + date
 * formatting with their fallbacks, and the PII-safe `view.opened` diagnostic. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class SessionComparisonChartProjectionTest {
    private val acA =
        ChargingCurveSession(
            id = 1,
            startedAt = "2026-04-02T18:00:00Z",
            chargerType = null,
            peakPowerW = 11_000.0,
            startSocPct = 10.0,
            endSocPct = 12.0,
        )
    private val acB =
        ChargingCurveSession(
            id = 2,
            startedAt = "2026-04-03T07:30:00Z",
            chargerType = null,
            peakPowerW = 11_000.0,
            startSocPct = 11.0,
            endSocPct = 13.0,
        )

    private fun project(sessions: List<ChargingCurveSession>): SessionComparisonChartProjectionResult =
        SessionComparisonChartProjection.project(
            sessions = sessions,
            chargerLabel = { kind -> kind.name },
            formatDate = { iso -> "D($iso)" },
            formatSoc = { soc -> soc.toInt().toString() },
        )

    // ── Projection (web comparisonData parity) ────────────────────────────────────

    @Test
    fun projectBuildsSortedSocUnionWithEachSessionPowerAlignedAndGapsAsNull() {
        val result = project(listOf(acA, acB))

        assertFalse(result.isEmpty)
        assertEquals(listOf("10", "11", "12", "13"), result.xLabels)
        assertEquals(2, result.series.size)

        val first = result.series[0]
        assertEquals("s0", first.key)
        assertEquals(0, first.colorIndex)
        assertEquals("D(2026-04-02T18:00:00Z)", first.legendLabel)
        assertEquals("D(2026-04-02T18:00:00Z) (HomeAc)", first.seriesLabel)
        assertEquals(listOf(11.0, 11.0, 11.0, null), first.values)

        val second = result.series[1]
        assertEquals("s1", second.key)
        assertEquals(1, second.colorIndex)
        assertEquals(listOf(null, 11.0, 11.0, 11.0), second.values)
    }

    @Test
    fun projectCapsOverlayAtTenSessionsPreservingOrder() {
        val many = (1..12).map { acA.copy(id = it.toLong()) }

        val result = project(many)

        assertEquals(SessionComparisonChartProjection.MAX_SESSIONS, result.series.size)
        assertEquals("s0", result.series.first().key)
        assertEquals("s9", result.series.last().key)
    }

    @Test
    fun projectReturnsEmptyResultForNoSessions() {
        val result = project(emptyList())

        assertTrue(result.isEmpty)
        assertTrue(result.xLabels.isEmpty())
        assertTrue(result.series.isEmpty())
    }

    @Test
    fun projectReturnsEmptyResultWhenEverySessionHasAnInvertedSocRange() {
        val inverted = acA.copy(startSocPct = 90.0, endSocPct = 10.0)

        val result = project(listOf(inverted))

        assertTrue(result.isEmpty)
    }

    // ── Curve generation (web generateChargingCurve parity) ───────────────────────

    @Test
    fun generateChargingCurveKeepsAcSessionsFlatAtPeakPower() {
        val curve =
            SessionComparisonChartProjection.generateChargingCurve(
                acA.copy(startSocPct = 0.0, endSocPct = 2.0),
            )

        assertEquals(listOf(0.0, 1.0, 2.0), curve.map { it.soc })
        assertEquals(listOf(11.0, 11.0, 11.0), curve.map { it.power })
    }

    @Test
    fun generateChargingCurveTapersDcSessionsAboveFiftyAndEightyPercent() {
        val dc =
            ChargingCurveSession(
                id = 9,
                startedAt = "2026-04-04T21:15:00Z",
                chargerType = "Tesla",
                peakPowerW = 100_000.0,
                startSocPct = 50.0,
                endSocPct = 90.0,
            )

        val curve = SessionComparisonChartProjection.generateChargingCurve(dc)

        assertEquals(100.0, powerAt(curve, 50.0), DELTA)
        assertEquals(50.0, powerAt(curve, 80.0), DELTA)
        assertEquals(32.5, powerAt(curve, 90.0), DELTA)
    }

    // ── Charger classification (web isDcSession / getChargerLabel parity) ─────────

    @Test
    fun isDcSessionTreatsNonEmptyTypeOrHighPeakAsDc() {
        assertTrue(SessionComparisonChartProjection.isDcSession(acA.copy(chargerType = "CCS")))
        assertTrue(SessionComparisonChartProjection.isDcSession(acA.copy(chargerType = null, peakPowerW = 25_000.0)))
        assertFalse(SessionComparisonChartProjection.isDcSession(acA.copy(chargerType = null, peakPowerW = 11_000.0)))
        assertFalse(SessionComparisonChartProjection.isDcSession(acA.copy(chargerType = "", peakPowerW = 11_000.0)))
    }

    @Test
    fun chargerKindClassifiesSuperchargerDcAndHome() {
        assertEquals(ChargerKind.Supercharger, SessionComparisonChartProjection.chargerKind(acA.copy(chargerType = "Tesla")))
        assertEquals(
            ChargerKind.Supercharger,
            SessionComparisonChartProjection.chargerKind(acA.copy(chargerType = "Tesla Supercharger")),
        )
        assertEquals(ChargerKind.DcFast, SessionComparisonChartProjection.chargerKind(acA.copy(chargerType = "CCS")))
        assertEquals(
            ChargerKind.DcFast,
            SessionComparisonChartProjection.chargerKind(acA.copy(chargerType = null, peakPowerW = 25_000.0)),
        )
        assertEquals(
            ChargerKind.HomeAc,
            SessionComparisonChartProjection.chargerKind(acA.copy(chargerType = null, peakPowerW = 11_000.0)),
        )
    }

    // ── SOC formatting ────────────────────────────────────────────────────────────

    @Test
    fun formatSocShowsIntegerWhenWholeAndOneFractionOtherwise() {
        assertEquals("50", SessionComparisonChartProjection.formatSoc(50.0, Locale.US))
        assertEquals("100", SessionComparisonChartProjection.formatSoc(100.0, Locale.US))
        assertEquals("23.5", SessionComparisonChartProjection.formatSoc(23.5, Locale.US))
    }

    // ── Date formatting (web formatDateShort parity + invalid-date guard) ─────────

    @Test
    fun formatRendersShortMonthAndDayInGivenLocale() {
        assertEquals("Apr 4", SessionDateFormatting.format("2026-04-04T21:15:00Z", ZoneOffset.UTC, Locale.US))
        assertEquals("Dec 25", SessionDateFormatting.format("2026-12-25", ZoneOffset.UTC, Locale.US))
    }

    @Test
    fun formatAcceptsOffsetZonelessAndInstantDateTimes() {
        assertEquals("Apr 4", SessionDateFormatting.format("2026-04-04T14:30:00+00:00", ZoneOffset.UTC, Locale.US))
        assertEquals("Apr 4", SessionDateFormatting.format("2026-04-04T14:30:00", ZoneOffset.UTC, Locale.US))
        assertEquals("Apr 4", SessionDateFormatting.format("2026-04-04T14:30:00Z", ZoneOffset.UTC, Locale.US))
    }

    @Test
    fun formatReturnsEmDashForBlankOrUnparseableInput() {
        assertEquals(EM_DASH, SessionDateFormatting.format("", ZoneOffset.UTC, Locale.US))
        assertEquals(EM_DASH, SessionDateFormatting.format("   ", ZoneOffset.UTC, Locale.US))
        assertEquals(EM_DASH, SessionDateFormatting.format("not-a-date", ZoneOffset.UTC, Locale.US))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordSessionComparisonChartOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "SessionComparisonChart"), fields)
    }

    private fun powerAt(
        curve: List<CurvePoint>,
        soc: Double,
    ): Double = curve.first { it.soc == soc }.power

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

    private companion object {
        private const val DELTA = 1e-9
    }
}
