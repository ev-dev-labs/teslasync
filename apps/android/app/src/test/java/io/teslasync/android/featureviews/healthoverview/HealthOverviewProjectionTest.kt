package io.teslasync.android.featureviews.healthoverview

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the HealthOverview's pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/driving/components/drivetrain-health/HealthOverview.tsx): the
 * `overallHealth !== 'good'` alert gate, the motor-state line, and the `${healthScore}%` value text
 * (locale-grouped, zero-fraction, non-finite guarded). Because the surface is purely presentational each
 * [HealthOverviewDisplay] is exactly what the thin composable renders, so these assertions double as the
 * per-state "snapshot". Runs in the :android:testReleaseUnitTest gate.
 */
class HealthOverviewProjectionTest {
    // ── Alert gate (web `overallHealth !== 'good'`) ──────────────────────────────────────────────────

    @Test
    fun projectShowsAlertForEveryBandExceptGood() {
        assertFalse(HealthOverviewProjection.project(HealthStatus.Good, GOOD_SCORE, MOTOR).showAlert)
        assertTrue(HealthOverviewProjection.project(HealthStatus.Warning, WARNING_SCORE, MOTOR).showAlert)
        assertTrue(HealthOverviewProjection.project(HealthStatus.Critical, CRITICAL_SCORE, MOTOR).showAlert)
    }

    @Test
    fun projectCarriesBandAndScoreVerbatim() {
        val display = HealthOverviewProjection.project(HealthStatus.Warning, WARNING_SCORE, MOTOR)
        assertEquals(HealthStatus.Warning, display.overallHealth)
        assertEquals(WARNING_SCORE, display.healthScore, 0.0)
    }

    // ── Motor-state line (web `Motor State: {motorStatus}`, em dash when blank) ───────────────────────

    @Test
    fun projectCarriesMotorStatusWhenPresent() {
        assertEquals(MOTOR, HealthOverviewProjection.project(HealthStatus.Good, GOOD_SCORE, MOTOR).motorStatusLabel)
    }

    @Test
    fun projectCollapsesBlankMotorStatusToEmDash() {
        assertEquals(EM_DASH, HealthOverviewProjection.project(HealthStatus.Good, GOOD_SCORE, "").motorStatusLabel)
        assertEquals(EM_DASH, HealthOverviewProjection.project(HealthStatus.Good, GOOD_SCORE, "   ").motorStatusLabel)
    }

    // ── Score text (web `${healthScore}%` via AnimatedNumber, zero decimals) ──────────────────────────

    @Test
    fun scorePercentLabelRendersAWholePercentWithTrailingSign() {
        assertEquals("0%", HealthOverviewProjection.scorePercentLabel(0.0, Locale.US))
        assertEquals("25%", HealthOverviewProjection.scorePercentLabel(CRITICAL_SCORE, Locale.US))
        assertEquals("60%", HealthOverviewProjection.scorePercentLabel(WARNING_SCORE, Locale.US))
        assertEquals("95%", HealthOverviewProjection.scorePercentLabel(GOOD_SCORE, Locale.US))
        assertEquals("100%", HealthOverviewProjection.scorePercentLabel(100.0, Locale.US))
    }

    @Test
    fun scorePercentLabelRoundsHalvesAwayFromZeroLikeToLocaleString() {
        // 72.5 -> 73 under HALF_UP (the JS `toLocaleString` default); the JVM default HALF_EVEN would give 72.
        assertEquals("73%", HealthOverviewProjection.scorePercentLabel(72.5, Locale.US))
        assertEquals("74%", HealthOverviewProjection.scorePercentLabel(73.5, Locale.US))
        assertEquals("73%", HealthOverviewProjection.scorePercentLabel(73.4, Locale.US))
    }

    @Test
    fun scorePercentLabelGuardsNonFiniteToZeroLikeSafeNumber() {
        assertEquals("0%", HealthOverviewProjection.scorePercentLabel(Double.NaN, Locale.US))
        assertEquals("0%", HealthOverviewProjection.scorePercentLabel(Double.POSITIVE_INFINITY, Locale.US))
        assertEquals("0%", HealthOverviewProjection.scorePercentLabel(Double.NEGATIVE_INFINITY, Locale.US))
    }

    @Test
    fun scorePercentLabelGroupsThousandsPerLocale() {
        assertEquals("1,234%", HealthOverviewProjection.scorePercentLabel(1234.0, Locale.US))
        assertEquals("1.234%", HealthOverviewProjection.scorePercentLabel(1234.0, Locale.GERMANY))
    }

    // ── Band token boundary (web `HealthStatus` string union + `overallHealth.toUpperCase()`) ─────────

    @Test
    fun fromTokenParsesEachBandCaseAndWhitespaceInsensitive() {
        assertEquals(HealthStatus.Good, HealthStatus.fromToken("good"))
        assertEquals(HealthStatus.Warning, HealthStatus.fromToken("  Warning "))
        assertEquals(HealthStatus.Critical, HealthStatus.fromToken("CRITICAL"))
    }

    @Test
    fun fromTokenFailsSafeToCriticalForUnknownValues() {
        assertEquals(HealthStatus.Critical, HealthStatus.fromToken("unknown"))
        assertEquals(HealthStatus.Critical, HealthStatus.fromToken(""))
    }

    @Test
    fun tokenRoundTripsThroughFromToken() {
        HealthStatus.entries.forEach { assertEquals(it, HealthStatus.fromToken(it.token)) }
    }

    private companion object {
        const val GOOD_SCORE: Double = 95.0
        const val WARNING_SCORE: Double = 60.0
        const val CRITICAL_SCORE: Double = 25.0
        const val MOTOR: String = "Drive"
        const val EM_DASH: String = "\u2014"
    }
}
