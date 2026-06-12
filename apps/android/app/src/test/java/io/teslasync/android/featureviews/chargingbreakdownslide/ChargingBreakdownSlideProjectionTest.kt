package io.teslasync.android.featureviews.chargingbreakdownslide

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the ChargingBreakdownSlide's pure logic — the native analogue of the web
 * component's data derivations (web/src/features/analytics/components/review/ChargingBreakdownSlide.tsx): the
 * `chartData` filter (drop shares whose value is not strictly positive) with its preserved Supercharger →
 * DC-fast → AC-other order, the rounded percentages and average start-SOC (web `Math.round`), the
 * proportional pie sweep fractions, the bare session-count rendering, the "{name} ({pct}%)" legend label, the
 * empty guard, the source → localized-label mapping, and the PII-safe `view.opened` diagnostic. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class ChargingBreakdownSlideProjectionTest {
    private val fullMix =
        ChargingBreakdownData(
            totalChargeSessions = 147,
            superchargerPct = 62.0,
            dcFastPct = 30.0,
            acOtherPct = 8.0,
            avgChargeStartSoc = 38.4,
        )

    // ── Projection: filter + order ────────────────────────────────────────────────

    @Test
    fun projectKeepsEveryPositiveShareInSourceOrder() {
        val display = ChargingBreakdownProjection.project(fullMix)

        assertFalse(display.isEmpty)
        assertEquals(
            listOf(ChargingSource.Supercharger, ChargingSource.DcFast, ChargingSource.AcOther),
            display.segments.map { it.source },
        )
        assertEquals(listOf(62, 30, 8), display.segments.map { it.percent })
        assertEquals(147L, display.totalChargeSessions)
    }

    @Test
    fun projectDropsZeroAndNegativeSharesPreservingRemainingOrder() {
        val display =
            ChargingBreakdownProjection.project(
                ChargingBreakdownData(
                    totalChargeSessions = 10,
                    superchargerPct = 0.0,
                    dcFastPct = 70.0,
                    acOtherPct = -5.0,
                    avgChargeStartSoc = 50.0,
                ),
            )

        // Only DC Fast survives the `value > 0` filter; it becomes the first (index 0) slice.
        assertEquals(listOf(ChargingSource.DcFast), display.segments.map { it.source })
        assertEquals(listOf(70), display.segments.map { it.percent })
    }

    @Test
    fun projectRoundsAverageStartSoc() {
        assertEquals(38, ChargingBreakdownProjection.project(fullMix).avgStartSocPercent)
        assertEquals(
            51,
            ChargingBreakdownProjection
                .project(fullMix.copy(avgChargeStartSoc = 50.5))
                .avgStartSocPercent,
        )
    }

    // ── isEmpty ────────────────────────────────────────────────────────────────────

    @Test
    fun isEmptyOnlyWhenNoSessionsAndNoPositiveShare() {
        val empty = ChargingBreakdownProjection.project(ChargingBreakdownData())
        assertTrue(empty.isEmpty)
        assertTrue(empty.segments.isEmpty())

        // Sessions but a blank breakdown is not "empty" — the headline still has a story.
        val sessionsOnly = ChargingBreakdownProjection.project(ChargingBreakdownData(totalChargeSessions = 3))
        assertFalse(sessionsOnly.isEmpty)

        // A breakdown with no recorded sessions still renders its slices.
        val shareOnly = ChargingBreakdownProjection.project(ChargingBreakdownData(superchargerPct = 100.0))
        assertFalse(shareOnly.isEmpty)
    }

    // ── roundPercent (web Math.round parity + non-finite guard) ────────────────────

    @Test
    fun roundPercentRoundsHalvesTowardsPositiveInfinityLikeMathRound() {
        assertEquals(63, ChargingBreakdownProjection.roundPercent(62.5))
        assertEquals(1, ChargingBreakdownProjection.roundPercent(0.5))
        assertEquals(8, ChargingBreakdownProjection.roundPercent(8.49))
    }

    @Test
    fun roundPercentFoldsNonFiniteToZero() {
        assertEquals(0, ChargingBreakdownProjection.roundPercent(Double.NaN))
        assertEquals(0, ChargingBreakdownProjection.roundPercent(Double.POSITIVE_INFINITY))
        assertEquals(0, ChargingBreakdownProjection.roundPercent(Double.NEGATIVE_INFINITY))
    }

    // ── sweepFractions (proportional pie sizing) ───────────────────────────────────

    @Test
    fun sweepFractionsAreProportionalAndSumToOne() {
        val segments = ChargingBreakdownProjection.project(fullMix).segments
        val fractions = ChargingBreakdownProjection.sweepFractions(segments)

        assertEquals(3, fractions.size)
        assertEquals(0.62, fractions[0], FRACTION_DELTA)
        assertEquals(0.30, fractions[1], FRACTION_DELTA)
        assertEquals(0.08, fractions[2], FRACTION_DELTA)
        assertEquals(1.0, fractions.sum(), FRACTION_DELTA)
    }

    @Test
    fun sweepFractionsGuardAgainstAnEmptyOrZeroTotal() {
        assertTrue(ChargingBreakdownProjection.sweepFractions(emptyList()).isEmpty())

        val zeroValued = listOf(ChargingSegment(ChargingSource.Supercharger, value = 0.0, percent = 0))
        assertEquals(listOf(0.0), ChargingBreakdownProjection.sweepFractions(zeroValued))
    }

    // ── Formatting (web bare numeric child + legend label) ─────────────────────────

    @Test
    fun formatSessionCountIsBareAndUngrouped() {
        assertEquals("0", ChargingBreakdownProjection.formatSessionCount(0))
        assertEquals("147", ChargingBreakdownProjection.formatSessionCount(147))
        assertEquals("1204", ChargingBreakdownProjection.formatSessionCount(1_204))
    }

    @Test
    fun legendLabelMatchesWebNameWithPercent() {
        assertEquals("Supercharger (62%)", ChargingBreakdownProjection.legendLabel("Supercharger", 62))
        assertEquals("AC / Other (8%)", ChargingBreakdownProjection.legendLabel("AC / Other", 8))
    }

    // ── Source → localized label mapping ───────────────────────────────────────────

    @Test
    fun stringsLabelMapsEverySource() {
        val strings =
            ChargingBreakdownStrings(
                supercharger = "Supercharger",
                dcFast = "DC Fast",
                acOther = "AC / Other",
                chargeSessions = "charge sessions",
            )

        assertEquals("Supercharger", strings.label(ChargingSource.Supercharger))
        assertEquals("DC Fast", strings.label(ChargingSource.DcFast))
        assertEquals("AC / Other", strings.label(ChargingSource.AcOther))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        ChargingBreakdownSlideDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "ChargingBreakdownSlide"), fields)
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

    private companion object {
        const val FRACTION_DELTA: Double = 1e-9
    }
}
