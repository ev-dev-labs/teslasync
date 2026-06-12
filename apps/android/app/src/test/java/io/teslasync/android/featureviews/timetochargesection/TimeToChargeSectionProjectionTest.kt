package io.teslasync.android.featureviews.timetochargesection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the TimeToChargeSection's pure logic — the native analogue of the web
 * component's derivations (web/src/features/charging/components/charging-curve/TimeToChargeSection.tsx and
 * its `helpers.ts`): the `isDcSession` classification, the `durationMinutes` guard, the `avg` helper, the
 * `timeToCharge` memo (10/20→80 SOC crossings, the `(kWh / minutes) * 60` charge rate with JS-reduce
 * tie-breaking, and the per-year aggregation), and the render-ready four-card projection. Runs in the
 * :android:testReleaseUnitTest gate; no Compose, no device.
 */
class TimeToChargeSectionProjectionTest {
    // Three DC sessions (charged via charger_type or high power) plus one non-DC home session that the DC
    // filter must drop. Rates are exact in IEEE-754 (60 / 90 / 30 kWh/h) so the projected values are stable.
    private val dcS1 =
        TimeToChargeSession(1, "Tesla", 150_000.0, 60_000.0, 8.0, 82.0, "2025-01-01T10:00:00Z", "2025-01-01T11:00:00Z")
    private val dcS2 =
        TimeToChargeSession(2, "Tesla", 120_000.0, 45_000.0, 18.0, 84.0, "2025-02-01T10:00:00Z", "2025-02-01T10:30:00Z")
    private val dcS3 =
        TimeToChargeSession(3, "ChargePoint", 50_000.0, 30_000.0, 5.0, 90.0, "2024-06-01T10:00:00Z", "2024-06-01T11:00:00Z")
    private val homeS4 =
        TimeToChargeSession(4, null, 11_000.0, 40_000.0, 5.0, 95.0, "2025-03-01T10:00:00Z", "2025-03-01T11:00:00Z")

    private val sessions = listOf(dcS1, dcS2, dcS3, homeS4)

    private val formatters =
        TimeToChargeFormatters(
            number = { "#$it" },
            sessionId = { "id=$it" },
            avgDurationLabel = "DUR",
        )

    // ── isDcSession (web isDcSession parity) ───────────────────────────────────────

    @Test
    fun isDcSessionTreatsAnyNonEmptyChargerTypeAsDc() {
        assertTrue(TimeToChargeProjection.isDcSession(session(chargerType = "Tesla", peakPowerW = null)))
        assertTrue(TimeToChargeProjection.isDcSession(session(chargerType = "ChargePoint", peakPowerW = 5_000.0)))
    }

    @Test
    fun isDcSessionUsesPeakPowerHeuristicWhenTypeIsAbsent() {
        assertTrue(TimeToChargeProjection.isDcSession(session(chargerType = null, peakPowerW = 50_000.0)))
        assertTrue(TimeToChargeProjection.isDcSession(session(chargerType = "", peakPowerW = 20_000.1)))
        // The 20 kW threshold is strict (web `> 20_000`), so exactly 20 kW with no type is not DC.
        assertFalse(TimeToChargeProjection.isDcSession(session(chargerType = "", peakPowerW = 20_000.0)))
        assertFalse(TimeToChargeProjection.isDcSession(session(chargerType = null, peakPowerW = 11_000.0)))
        assertFalse(TimeToChargeProjection.isDcSession(session(chargerType = null, peakPowerW = null)))
    }

    // ── durationMinutes (web durationMinutes parity + guards) ──────────────────────

    @Test
    fun durationMinutesRoundsToWholeMinutes() {
        assertEquals(30L, TimeToChargeProjection.durationMinutes("2026-04-04T10:00:00Z", "2026-04-04T10:30:00Z"))
        assertEquals(1L, TimeToChargeProjection.durationMinutes("2026-04-04T10:00:00Z", "2026-04-04T10:00:40Z"))
    }

    @Test
    fun durationMinutesAcceptsOffsetAndZonelessTimestamps() {
        assertEquals(30L, TimeToChargeProjection.durationMinutes("2026-04-04T10:00:00+00:00", "2026-04-04T10:30:00+00:00"))
        assertEquals(30L, TimeToChargeProjection.durationMinutes("2026-04-04T10:00:00", "2026-04-04T10:30:00"))
    }

    @Test
    fun durationMinutesReturnsZeroForOpenInvalidOrNonPositiveRanges() {
        assertEquals(0L, TimeToChargeProjection.durationMinutes("2026-04-04T10:00:00Z", null))
        assertEquals(0L, TimeToChargeProjection.durationMinutes("2026-04-04T10:30:00Z", "2026-04-04T10:00:00Z"))
        assertEquals(0L, TimeToChargeProjection.durationMinutes("2026-04-04T10:00:00Z", "2026-04-04T10:00:00Z"))
        assertEquals(0L, TimeToChargeProjection.durationMinutes("not-a-date", "2026-04-04T10:30:00Z"))
        assertEquals(0L, TimeToChargeProjection.durationMinutes("2026-04-04T10:00:00Z", "   "))
    }

    // ── avg (web avg parity) ───────────────────────────────────────────────────────

    @Test
    fun avgComputesMeanAndZeroForEmpty() {
        assertEquals(0.0, TimeToChargeProjection.avg(emptyList()), 0.0)
        assertEquals(4.0, TimeToChargeProjection.avg(listOf(2.0, 4.0, 6.0)), 0.0)
        assertEquals(5.0, TimeToChargeProjection.avg(listOf(5.0)), 0.0)
    }

    // ── compute (web timeToCharge memo parity) ─────────────────────────────────────

    @Test
    fun computeDerivesAveragesExtremesAndTrendFromDcSessionsOnly() {
        val metrics = TimeToChargeProjection.compute(sessions)

        // 10→80 crossings: dcS1 (60 min) + dcS3 (60 min) → 60.0; the home session is excluded by the DC filter.
        assertEquals(60.0, metrics.avg10to80!!, 0.0)
        // 20→80 crossings: dcS1 (60) + dcS2 (30) + dcS3 (60) → 50.0.
        assertEquals(50.0, metrics.avg20to80!!, 0.0)

        // Fastest = highest kWh/h (dcS2, 90), slowest = lowest (dcS3, 30).
        assertEquals(TimeToChargeSessionRate(2, 90.0), metrics.fastest)
        assertEquals(TimeToChargeSessionRate(3, 30.0), metrics.slowest)

        // Yearly trend sorted ascending: 2024 (dcS3) then 2025 (dcS1, dcS2).
        assertEquals(
            listOf(
                TimeToChargeYearPoint("2024", 60.0, 60.0, 1),
                TimeToChargeYearPoint("2025", 60.0, 45.0, 2),
            ),
            metrics.yearlyTrend,
        )
    }

    @Test
    fun computeReturnsEmptyMetricsForNoSessions() {
        val metrics = TimeToChargeProjection.compute(emptyList())
        assertNull(metrics.avg10to80)
        assertNull(metrics.avg20to80)
        assertNull(metrics.fastest)
        assertNull(metrics.slowest)
        assertTrue(metrics.yearlyTrend.isEmpty())
    }

    @Test
    fun computeReturnsEmptyMetricsWhenNoSessionIsDc() {
        val metrics = TimeToChargeProjection.compute(listOf(homeS4))
        assertNull(metrics.avg10to80)
        assertNull(metrics.fastest)
        assertTrue(metrics.yearlyTrend.isEmpty())
    }

    @Test
    fun computeBreaksRateTiesByKeepingTheLaterSessionLikeJsReduce() {
        val tieA = session(id = 10, chargerType = "Tesla", energyWh = 30_000.0)
        val tieB = session(id = 11, chargerType = "Tesla", energyWh = 30_000.0)
        val metrics = TimeToChargeProjection.compute(listOf(tieA, tieB))
        // Both sessions share the same 30 kWh/h rate; JS `reduce` keeps the later element on a tie.
        assertEquals(11L, metrics.fastest!!.id)
        assertEquals(11L, metrics.slowest!!.id)
    }

    @Test
    fun computeCountsOpenSessionsInTheTrendButExcludesThemFromRates() {
        val open =
            TimeToChargeSession(7, "Tesla", null, 0.0, 50.0, null, "2025-07-01T10:00:00Z", null)
        val metrics = TimeToChargeProjection.compute(listOf(open))
        // An open/zero-energy DC session has no rate and crosses nothing, but still counts toward its year.
        assertNull(metrics.fastest)
        assertNull(metrics.slowest)
        assertEquals(listOf(TimeToChargeYearPoint("2025", 0.0, 0.0, 1)), metrics.yearlyTrend)
    }

    // ── project (web four TimeToChargeCard parity) ─────────────────────────────────

    @Test
    fun projectBuildsFourCardsInOrderWithValuesUnitsAndSubtitles() {
        val cards = TimeToChargeProjection.projectCards(sessions, formatters)

        assertEquals(
            listOf(
                TimeToChargeCard(TimeToChargeCardKind.Avg10To80, "#60.0", MIN_UNIT, "DUR"),
                TimeToChargeCard(TimeToChargeCardKind.Avg20To80, "#50.0", MIN_UNIT, "DUR"),
                TimeToChargeCard(TimeToChargeCardKind.Fastest, "#90.0", RATE_UNIT, "id=2"),
                TimeToChargeCard(TimeToChargeCardKind.Slowest, "#30.0", RATE_UNIT, "id=3"),
            ),
            cards,
        )
    }

    @Test
    fun projectRendersDashFallbackAndKeepsAverageSubtitlesWhenEmpty() {
        val cards = TimeToChargeProjection.projectCards(emptyList(), formatters)

        // Every value is null (the composable renders "—"); the average cards keep the "Avg duration"
        // subtitle (web renders it unconditionally) while the extreme cards have no session to attribute.
        assertEquals(listOf(null, null, null, null), cards.map { it.value })
        assertEquals(listOf("DUR", "DUR", null, null), cards.map { it.subtitle })
        assertEquals(listOf(MIN_UNIT, MIN_UNIT, RATE_UNIT, RATE_UNIT), cards.map { it.unit })
    }

    private fun session(
        id: Long = 1,
        chargerType: String?,
        peakPowerW: Double? = null,
        energyWh: Double = 10_000.0,
    ): TimeToChargeSession =
        TimeToChargeSession(
            id = id,
            chargerType = chargerType,
            peakPowerW = peakPowerW,
            totalEnergyAddedWh = energyWh,
            startSocPct = 5.0,
            endSocPct = 85.0,
            startedAt = "2025-01-01T10:00:00Z",
            endedAt = "2025-01-01T11:00:00Z",
        )
}
