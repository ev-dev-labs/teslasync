package io.teslasync.android.components.datadisplay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * JVM unit tests for the framework-free data-display logic (freshness, severity, score scale,
 * metric semantics + delta math, avatar hashing, battery delta, replay speeds, route geometry,
 * drive score, source layer, polling, scrubber, saved-view ordering). These run in the
 * `:android:testDebugUnitTest` gate and cover the behavior the composables only render.
 */
class DataDisplayLogicTest {
    // ── Freshness ──────────────────────────────────────────────────────────────
    @Test
    fun computeAgeSecondsFloorsAtZeroAndHandlesNull() {
        assertNull(computeAgeSeconds(null, 1_000L))
        assertEquals(0L, computeAgeSeconds(2_000L, 1_000L)) // future timestamp clamps to 0
        assertEquals(5L, computeAgeSeconds(1_000L, 6_000L))
    }

    @Test
    fun freshnessStatusUsesStaleAndOfflineWindows() {
        assertEquals(FreshnessStatus.Unknown, freshnessStatus(null))
        assertEquals(FreshnessStatus.Fresh, freshnessStatus(119))
        assertEquals(FreshnessStatus.Stale, freshnessStatus(120))
        assertEquals(FreshnessStatus.Stale, freshnessStatus(599))
        assertEquals(FreshnessStatus.Offline, freshnessStatus(600))
    }

    @Test
    fun isStaleAndOfflineGuards() {
        assertFalse(isStale(null))
        assertFalse(isStale(119))
        assertTrue(isStale(120))
        assertFalse(isOffline(599))
        assertTrue(isOffline(600))
    }

    @Test
    fun freshnessAgeBucketsMatchWebCutoffs() {
        assertEquals(FreshnessAge.Unknown, freshnessAge(null))
        assertEquals(FreshnessAge.JustNow, freshnessAge(9))
        assertEquals(FreshnessAge.Seconds(45), freshnessAge(45))
        assertEquals(FreshnessAge.Minutes(5), freshnessAge(330))
        assertEquals(FreshnessAge.Hours(2), freshnessAge(7_200))
    }

    @Test
    fun relativeAgeAddsDayAndWeekFallThrough() {
        assertEquals(FreshnessAge.JustNow, relativeAge(30))
        assertEquals(FreshnessAge.Hours(3), relativeAge(10_800))
        assertEquals(FreshnessAge.Days(2), relativeAge(172_800))
        assertEquals(FreshnessAge.Weeks(2), relativeAge(1_209_600))
    }

    @Test
    fun formatFreshnessAgeRendersEnglishDefaults() {
        assertEquals("\u2014", formatFreshnessAge(FreshnessAge.Unknown))
        assertEquals("just now", formatFreshnessAge(FreshnessAge.JustNow))
        assertEquals("12s ago", formatFreshnessAge(FreshnessAge.Seconds(12)))
        assertEquals("5m ago", formatFreshnessAge(FreshnessAge.Minutes(5)))
        assertEquals("3d ago", formatFreshnessAge(FreshnessAge.Days(3)))
    }

    @Test
    fun queryFreshnessPriorityErrorThenFetchingThenStale() {
        assertEquals(QueryFreshness.Error, queryFreshness(isError = true, isFetching = true, isStale = true))
        assertEquals(QueryFreshness.Fetching, queryFreshness(isError = false, isFetching = true, isStale = true))
        assertEquals(QueryFreshness.Stale, queryFreshness(isError = false, isFetching = false, isStale = true))
        assertEquals(QueryFreshness.Fresh, queryFreshness(isError = false, isFetching = false, isStale = false))
    }

    // ── Severity ───────────────────────────────────────────────────────────────
    @Test
    fun normalizeSeverityMapsLegacyAliases() {
        assertEquals(Severity.Warn, normalizeSeverity("warning"))
        assertEquals(Severity.Warn, normalizeSeverity("warn"))
        assertEquals(Severity.Critical, normalizeSeverity("error"))
        assertEquals(Severity.Critical, normalizeSeverity("fatal"))
        assertEquals(Severity.Success, normalizeSeverity("ok"))
        assertEquals(Severity.Info, normalizeSeverity("info"))
        assertEquals(Severity.Info, normalizeSeverity(null))
        assertEquals(Severity.Info, normalizeSeverity("haunted"))
    }

    // ── Score scale ──────────────────────────────────────────────────────────────
    @Test
    fun numericToGradeMapsThresholds() {
        assertEquals(ScoreGrade.APlus, numericToGrade(95.0))
        assertEquals(ScoreGrade.A, numericToGrade(85.0))
        assertEquals(ScoreGrade.B, numericToGrade(70.0))
        assertEquals(ScoreGrade.C, numericToGrade(55.0))
        assertEquals(ScoreGrade.D, numericToGrade(40.0))
        assertEquals(ScoreGrade.F, numericToGrade(10.0))
        assertEquals(ScoreGrade.None, numericToGrade(null))
        assertEquals(ScoreGrade.None, numericToGrade(Double.NaN))
    }

    @Test
    fun averageGradeSkipsNullsAndMapsMean() {
        assertEquals(ScoreGrade.APlus, averageGrade(listOf(4.5, 4.0)))
        assertEquals(ScoreGrade.B, averageGrade(listOf(3.0, 3.0, null)))
        assertEquals(ScoreGrade.None, averageGrade(listOf(null, null)))
        assertEquals(ScoreGrade.None, averageGrade(emptyList()))
    }

    // ── Metric semantics + delta ───────────────────────────────────────────────
    @Test
    fun resolveSemanticKnownAndUnknown() {
        assertEquals(Direction.LowerBetter, resolveSemantic("cost").direction)
        assertEquals(Direction.HigherBetter, resolveSemantic("range").direction)
        assertEquals(Direction.Neutral, resolveSemantic("distance").direction)
        assertEquals(Direction.Neutral, resolveSemantic("totally_made_up").direction)
    }

    @Test
    fun deltaToneFollowsDirectionAndSign() {
        // lower_better: increase is bad, decrease is good.
        assertEquals(DeltaTone.Bad, deltaTone(Direction.LowerBetter, signedDelta(12.0, 10.0)))
        assertEquals(DeltaTone.Good, deltaTone(Direction.LowerBetter, signedDelta(8.0, 10.0)))
        // higher_better: increase is good, decrease is bad.
        assertEquals(DeltaTone.Good, deltaTone(Direction.HigherBetter, signedDelta(280.0, 250.0)))
        assertEquals(DeltaTone.Bad, deltaTone(Direction.HigherBetter, signedDelta(220.0, 250.0)))
        // neutral never good/bad; zero is muted.
        assertEquals(DeltaTone.Neutral, deltaTone(Direction.Neutral, signedDelta(200.0, 100.0)))
        assertEquals(DeltaTone.Muted, deltaTone(Direction.LowerBetter, signedDelta(10.0, 10.0)))
    }

    @Test
    fun deltaArrowAndPercent() {
        assertEquals(DeltaArrow.Up, deltaArrow(2.0))
        assertEquals(DeltaArrow.Down, deltaArrow(-2.0))
        assertEquals(DeltaArrow.Flat, deltaArrow(0.0))
        assertEquals(20.0, percentDelta(12.0, 10.0)!!, 1e-6)
        assertNull(percentDelta(12.0, 0.0))
    }

    // ── Avatar ─────────────────────────────────────────────────────────────────
    @Test
    fun avatarInitialsHandlesNamesAndBlanks() {
        assertEquals("JD", avatarInitials("John Doe"))
        assertEquals("CH", avatarInitials("Cher"))
        assertEquals("X", avatarInitials("x"))
        assertEquals("?", avatarInitials(null))
        assertEquals("?", avatarInitials("   "))
    }

    @Test
    fun avatarColorIndexIsDeterministicAndInRange() {
        val size = 8
        val a = avatarColorIndex("vehicle-42", size)
        val b = avatarColorIndex("vehicle-42", size)
        assertEquals(a, b)
        assertTrue(a in 0 until size)
        assertEquals(0, avatarColorIndex("anything", 0))
    }

    // ── Battery delta ────────────────────────────────────────────────────────────
    @Test
    fun batteryDeltaValueTrendAndLabel() {
        assertEquals(-1.0, batteryDeltaValue(79.0, 78.0)!!, 1e-6)
        assertEquals(BatteryTrend.Drain, batteryTrend(batteryDeltaValue(79.0, 78.0)))
        assertEquals("\u22121%", batteryDeltaLabel(-1.0))
        assertEquals(BatteryTrend.Charge, batteryTrend(batteryDeltaValue(20.0, 80.0)))
        assertEquals("+60%", batteryDeltaLabel(60.0))
        assertEquals(BatteryTrend.Flat, batteryTrend(0.0))
        assertEquals("\u2014", batteryDeltaLabel(0.0))
        assertFalse(hasBatteryData(null, 80.0))
        assertNull(batteryDeltaValue(null, 80.0))
    }

    // ── Replay speeds ────────────────────────────────────────────────────────────
    @Test
    fun shiftAndNextSpeedClampAndWrap() {
        assertEquals(10, shiftSpeed(1, 1))
        assertEquals(100, shiftSpeed(100, 1))
        assertEquals(1, shiftSpeed(1, -1))
        assertEquals(10, nextSpeed(1))
        assertEquals(1, nextSpeed(100))
    }

    // ── Route geometry ─────────────────────────────────────────────────────────
    @Test
    fun haversineZeroAndKnownArc() {
        assertEquals(0.0, haversineMeters(10.0, 20.0, 10.0, 20.0), 1e-6)
        // One degree of longitude at the equator ≈ 111.2 km.
        assertEquals(111_195.0, haversineMeters(0.0, 0.0, 0.0, 1.0), 500.0)
    }

    @Test
    fun endpointLabelPrefersAddressThenCoords() {
        assertEquals("Home", endpointLabel(RouteEndpoint(address = "  Home  "), Locale.US))
        assertEquals("12.34, 56.78", endpointLabel(RouteEndpoint(lat = 12.34, lon = 56.78), Locale.US))
        assertNull(endpointLabel(RouteEndpoint(), Locale.US))
    }

    @Test
    fun routeKindClassifiesTrips() {
        assertEquals(RouteKind.NoLocation, routeKind(RouteEndpoint()))
        assertEquals(RouteKind.RoundTrip, routeKind(RouteEndpoint(address = "A")))
        assertEquals(RouteKind.RoundTrip, routeKind(RouteEndpoint(address = "A"), RouteEndpoint(address = "A")))
        assertEquals(RouteKind.PointToPoint, routeKind(RouteEndpoint(address = "A"), RouteEndpoint(address = "B")))
        val near = RouteEndpoint(lat = 0.0, lon = 0.0)
        val nearby = RouteEndpoint(lat = 0.0, lon = 0.0005)
        assertEquals(RouteKind.RoundTrip, routeKind(near, nearby))
        val far = RouteEndpoint(lat = 0.0, lon = 1.0)
        assertEquals(RouteKind.PointToPoint, routeKind(near, far))
    }

    // ── Drive score ──────────────────────────────────────────────────────────────
    @Test
    fun computeDriveScoreProducesExpectedBreakdown() {
        val score =
            computeDriveScore(
                DriveInput(
                    distanceM = 50_000.0,
                    durationS = 3_600.0,
                    maxSpeedMps = 27.78,
                    startBatteryPct = 80.0,
                    endBatteryPct = 60.0,
                ),
            )
        assertEquals(0, score.efficiency)
        assertEquals(10, score.speed)
        assertEquals(13, score.range)
        assertEquals(20, score.trip)
        assertEquals(43, score.total)
        assertEquals(ScoreTone.Warn, scoreTone(score.total))
    }

    @Test
    fun computeDriveScoreHandlesZeroInputs() {
        val score = computeDriveScore(DriveInput(distanceM = 0.0, durationS = 0.0))
        assertTrue(score.total in 0..100)
        assertEquals(ScoreTone.Bad, scoreTone(10))
        assertEquals(ScoreTone.Good, scoreTone(85))
    }

    // ── Source layer ─────────────────────────────────────────────────────────────
    @Test
    fun parseSourceLayerAndAgeFormatting() {
        assertEquals(SignalSourceLayer.L1, parseSourceLayer("l1"))
        assertEquals(SignalSourceLayer.Stale, parseSourceLayer("STALE"))
        assertEquals(SignalSourceLayer.Unknown, parseSourceLayer("mystery"))
        assertEquals("500 ms", formatSourceAgeMs(500L, Locale.US))
        assertEquals("1.5 s", formatSourceAgeMs(1_500L, Locale.US))
        assertEquals("1 min", formatSourceAgeMs(90_000L, Locale.US))
        assertEquals("2.0 h", formatSourceAgeMs(7_200_000L, Locale.US))
        assertNull(formatSourceAgeMs(null, Locale.US))
    }

    // ── Polling ────────────────────────────────────────────────────────────────
    @Test
    fun pollingDurationAndProfileLabels() {
        assertEquals("now", formatPollingDurationMs(0L))
        assertEquals("5s", formatPollingDurationMs(5_000L))
        assertEquals("3m", formatPollingDurationMs(180_000L))
        assertEquals("2h 5m", formatPollingDurationMs(7_500_000L))
        assertEquals("Driving", pollingProfileLabel("driving"))
    }

    // ── Scrubber ───────────────────────────────────────────────────────────────
    @Test
    fun scrubberTimeLabelFormatsMinutesSeconds() {
        assertNull(scrubberTimeLabel(0, 0.5f))
        assertEquals("1:00", scrubberTimeLabel(120, 0.5f))
        assertEquals("0:30", scrubberTimeLabel(60, 0.5f))
    }

    // ── Saved views ──────────────────────────────────────────────────────────────
    @Test
    fun sortedSavedViewsPinnedFirstThenAlphabetical() {
        val views =
            listOf(
                SavedView("1", "Zulu", "q=1"),
                SavedView("2", "alpha", "q=2", isPinned = true),
                SavedView("3", "Bravo", "q=3"),
            )
        val sorted = sortedSavedViews(views)
        assertEquals("alpha", sorted[0].name)
        assertEquals("Bravo", sorted[1].name)
        assertEquals("Zulu", sorted[2].name)
        assertNotNull(sorted)
    }
}
