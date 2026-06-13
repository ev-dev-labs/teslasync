package io.teslasync.android.sharedsurfaces.drivescore

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the DriveScore surface's pure logic — the native analogue of the web
 * surface's scoring math (web/src/components/data-display/DriveScore.tsx): the `computeDriveScore` port
 * (including the `?? ` fallbacks, the clamp bounds, the unrounded-total/rounded-sub-score split, and the
 * `Math.round(NaN) === 0` guard), the `getScoreColor` tier thresholds, the render-ready breakdown bars
 * (the surface's accessible row content), the prop-driven lifecycle-state builder, the hard-error
 * classifier, and the PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class DriveScoreProjectionTest {
    private val strings =
        DriveScoreStrings(
            title = "Drive Score",
            scoreLabel = "Score",
            efficiency = "Efficiency",
            speedDiscipline = "Speed Discipline",
            rangePreservation = "Range Preservation",
            tripLength = "Trip Length",
        )

    // ── computeDriveScore parity ──────────────────────────────────────────────────

    @Test
    fun computeScoresAnEfficientDriveNearTheTop() {
        // 50 km in 50 min, peak 20 m/s, 10% used → optimal 150 Wh/km, smooth, low draw, long trip.
        val result =
            DriveScoreComputation.compute(
                DriveScoreInput(
                    distanceM = 50_000.0,
                    durationS = 3_000.0,
                    maxSpeedMps = 20.0,
                    startBatteryPct = 80.0,
                    endBatteryPct = 70.0,
                ),
            )

        assertEquals(94, result.total)
        assertEquals(40, result.efficiency)
        assertEquals(17, result.speed)
        assertEquals(18, result.range)
        assertEquals(20, result.trip)
    }

    @Test
    fun computeUsesTheUnroundedComponentSumForTheTotal() {
        // 40 km drive → components 10 / 15.15 / 14.44 / 16. Rounding-then-summing would give 55; the web
        // rounds the unrounded sum (55.6) to 56, so total=56 proves the split is reproduced.
        val result =
            DriveScoreComputation.compute(
                DriveScoreInput(
                    distanceM = 40_000.0,
                    durationS = 2_400.0,
                    maxSpeedMps = 22.0,
                    startBatteryPct = 80.0,
                    endBatteryPct = 66.0,
                ),
            )

        assertEquals(56, result.total)
        assertEquals(10, result.efficiency)
        assertEquals(15, result.speed)
        assertEquals(14, result.range)
        assertEquals(16, result.trip)
    }

    @Test
    fun computeAppliesTheWebFallbacksForAnEmptyDrive() {
        // All-null drive: distance 0 → 250 Wh/km, 0.5 speed ratio, 1%/km, 0 km trip. Mirrors the web `?? `.
        val result = DriveScoreComputation.compute(DriveScoreInput())

        assertEquals(23, result.total)
        assertEquals(13, result.efficiency)
        assertEquals(10, result.speed)
        assertEquals(0, result.range)
        assertEquals(0, result.trip)
    }

    @Test
    fun computeCollapsesANonFiniteSampleToZeroLikeTheWebMathRound() {
        // A corrupt (NaN) distance must never surface as `NaN` — the trip score and total collapse to 0.
        val result = DriveScoreComputation.compute(DriveScoreInput(distanceM = Double.NaN))

        assertEquals(0, result.total)
        assertEquals(13, result.efficiency)
        assertEquals(10, result.speed)
        assertEquals(0, result.range)
        assertEquals(0, result.trip)
    }

    @Test
    fun computeFallsBackMaxSpeedToTheAverageWhenAbsent() {
        // No max speed → avg/avg = ratio 1.0 → full 20 speed points (the web `?? avgSpeedMps`).
        val result =
            DriveScoreComputation.compute(
                DriveScoreInput(distanceM = 30_000.0, durationS = 1_800.0, startBatteryPct = 80.0, endBatteryPct = 74.0),
            )

        assertEquals(20, result.speed)
    }

    // ── roundHalfUp (web Math.round) ──────────────────────────────────────────────

    @Test
    fun roundHalfUpRoundsHalvesUpAndGuardsNonFinite() {
        assertEquals(3, DriveScoreComputation.roundHalfUp(2.5))
        assertEquals(2, DriveScoreComputation.roundHalfUp(2.4))
        assertEquals(13, DriveScoreComputation.roundHalfUp(13.4))
        assertEquals(0, DriveScoreComputation.roundHalfUp(0.0))
        assertEquals(0, DriveScoreComputation.roundHalfUp(Double.NaN))
        assertEquals(0, DriveScoreComputation.roundHalfUp(Double.POSITIVE_INFINITY))
    }

    // ── scoreTier (web getScoreColor thresholds) ──────────────────────────────────

    @Test
    fun scoreTierMatchesTheWebGetScoreColorThresholds() {
        assertEquals(ScoreTier.Bad, scoreTier(0))
        assertEquals(ScoreTier.Bad, scoreTier(39))
        assertEquals(ScoreTier.Warn, scoreTier(40))
        assertEquals(ScoreTier.Warn, scoreTier(69))
        assertEquals(ScoreTier.Good, scoreTier(70))
        assertEquals(ScoreTier.Good, scoreTier(100))
    }

    // ── driveScoreBars (accessible row content) ───────────────────────────────────

    @Test
    fun driveScoreBarsProjectsTheFourRowsInWebOrder() {
        val bars = driveScoreBars(DriveScoreBreakdown(total = 94, efficiency = 40, speed = 17, range = 18, trip = 20), strings)

        assertEquals(4, bars.size)
        assertEquals(
            listOf(
                DriveScoreMetric.Efficiency,
                DriveScoreMetric.SpeedDiscipline,
                DriveScoreMetric.RangePreservation,
                DriveScoreMetric.TripLength,
            ),
            bars.map { it.metric },
        )
        assertEquals(
            listOf("Efficiency", "Speed Discipline", "Range Preservation", "Trip Length"),
            bars.map { it.label },
        )
        assertEquals(listOf(40, 17, 18, 20), bars.map { it.value })
        assertEquals(listOf(40, 20, 20, 20), bars.map { it.max })
    }

    // ── driveScoreState (prop-driven lifecycle builder) ───────────────────────────

    @Test
    fun driveScoreStateIsEmptyForANullDrive() {
        val state = driveScoreState(null)

        assertEquals(UiPhase.Empty, state.phase)
        assertNull(state.data)
    }

    @Test
    fun driveScoreStateIsContentForAnyDrive() {
        val state = driveScoreState(DriveScoreInput(distanceM = 1_000.0))

        assertEquals(UiPhase.Content, state.phase)
        assertNotNull(state.data)
        assertEquals(1_000.0, requireNotNull(state.data?.distanceM), 0.0)
    }

    // ── driveScoreErrorKind (hard-error classification) ───────────────────────────

    @Test
    fun driveScoreErrorKindMapsTransportFailuresToRecoveryBuckets() {
        assertEquals(QueryErrorKind.Waiting, driveScoreErrorKind(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.NotFound, driveScoreErrorKind(ErrorKind.Http, 404))
        assertEquals(QueryErrorKind.Unauthorized, driveScoreErrorKind(ErrorKind.Http, 401))
        assertEquals(QueryErrorKind.Unauthorized, driveScoreErrorKind(ErrorKind.Http, 403))
        assertEquals(QueryErrorKind.ServerError, driveScoreErrorKind(ErrorKind.Http, 500))
        assertEquals(QueryErrorKind.ServerError, driveScoreErrorKind(ErrorKind.Http, 503))
        assertEquals(QueryErrorKind.Network, driveScoreErrorKind(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Network, driveScoreErrorKind(ErrorKind.Timeout, null))
        assertEquals(QueryErrorKind.Network, driveScoreErrorKind(ErrorKind.Decode, null))
        assertEquals(QueryErrorKind.Network, driveScoreErrorKind(ErrorKind.Unknown, null))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordDriveScoreOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "DriveScore"), fields)
    }

    @Test
    fun registrationSlugMatchesTheDiagnosticSurface() {
        assertEquals("DriveScore", DriveScoreRegistration.SLUG)
        assertEquals("drive-score", DriveScoreRegistration.ID)
    }

    // ── lifecycle field plumbing (sanity that UiState carries the freshness contract) ──

    @Test
    fun uiStateExposesTheFreshnessContractTheSurfaceReads() {
        val offline =
            driveScoreState(DriveScoreInput(distanceM = 1_000.0)).copy(
                fetchedAt = 1_700_000_000_000L,
                stale = true,
                errorKind = ErrorKind.Network,
            )

        assertTrue(offline.stale)
        assertTrue(offline.hasError)
        assertTrue(offline.isOffline)
        assertFalse(offline.isLoading)
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
