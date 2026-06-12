package io.teslasync.android.featureviews.healthrecommendations

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the HealthRecommendations pure logic — the native mirror of the web component's
 * `useMemo` body (web/src/features/driving/components/drivetrain-health/HealthRecommendations.tsx): the
 * `overallHealth`-driven branch order, the priority of every tip, and the always-present low-priority
 * baseline. Because the surface is purely presentational, each projected list is exactly what the thin
 * composable renders, so these assertions double as the per-state "snapshot". Runs in the
 * :android:testReleaseUnitTest gate.
 */
class HealthRecommendationsProjectionTest {
    private val baseline =
        listOf(
            HealthRecommendation.RegularService,
            HealthRecommendation.GentleAccel,
            HealthRecommendation.Precondition,
            HealthRecommendation.MonitorTemps,
        )
    private val medium =
        listOf(
            HealthRecommendation.ReduceLoad,
            HealthRecommendation.CheckCoolant,
            HealthRecommendation.AvoidSupercharging,
        )
    private val high =
        listOf(
            HealthRecommendation.CriticalStop,
            HealthRecommendation.ServiceUrgent,
        )

    // ── HealthStatus.fromRaw (web typed union, no default; native folds unknown → Good) ─────────────

    @Test
    fun fromRawMapsEveryKnownStatusKey() {
        assertEquals(HealthStatus.Good, HealthStatus.fromRaw("good"))
        assertEquals(HealthStatus.Warning, HealthStatus.fromRaw("warning"))
        assertEquals(HealthStatus.Critical, HealthStatus.fromRaw("critical"))
    }

    @Test
    fun fromRawFoldsAbsentOrUnknownStatusToGood() {
        assertEquals(HealthStatus.Good, HealthStatus.fromRaw(null))
        assertEquals(HealthStatus.Good, HealthStatus.fromRaw(""))
        assertEquals(HealthStatus.Good, HealthStatus.fromRaw("CRITICAL"))
        assertEquals(HealthStatus.Good, HealthStatus.fromRaw("degraded"))
    }

    // ── recommendationsFor — exact lists per health state (web useMemo) ─────────────────────────────

    @Test
    fun goodShowsOnlyTheFourBaselineTips() {
        assertEquals(baseline, HealthRecommendationsProjection.recommendationsFor(HealthStatus.Good))
    }

    @Test
    fun warningPrependsTheThreeMediumTipsToTheBaseline() {
        assertEquals(medium + baseline, HealthRecommendationsProjection.recommendationsFor(HealthStatus.Warning))
    }

    @Test
    fun criticalPrependsTheHighThenMediumTipsToTheBaseline() {
        assertEquals(
            high + medium + baseline,
            HealthRecommendationsProjection.recommendationsFor(HealthStatus.Critical),
        )
    }

    // ── Branch invariants ───────────────────────────────────────────────────────────────────────────

    @Test
    fun listIsNeverEmptyForAnyHealthState() {
        HealthStatus.entries.forEach { status ->
            assertTrue(HealthRecommendationsProjection.recommendationsFor(status).isNotEmpty())
        }
    }

    @Test
    fun highPriorityTipsAppearOnlyWhenCritical() {
        assertTrue(HealthRecommendationsProjection.recommendationsFor(HealthStatus.Critical).containsAll(high))
        assertFalse(HealthRecommendationsProjection.recommendationsFor(HealthStatus.Warning).any { it in high })
        assertFalse(HealthRecommendationsProjection.recommendationsFor(HealthStatus.Good).any { it in high })
    }

    @Test
    fun mediumPriorityTipsAppearWhenWarningOrCritical() {
        assertTrue(HealthRecommendationsProjection.recommendationsFor(HealthStatus.Warning).containsAll(medium))
        assertTrue(HealthRecommendationsProjection.recommendationsFor(HealthStatus.Critical).containsAll(medium))
        assertFalse(HealthRecommendationsProjection.recommendationsFor(HealthStatus.Good).any { it in medium })
    }

    @Test
    fun baselineTipsAppearInEveryHealthState() {
        HealthStatus.entries.forEach { status ->
            assertTrue(HealthRecommendationsProjection.recommendationsFor(status).containsAll(baseline))
        }
    }

    @Test
    fun eachRecommendationCarriesTheExpectedPriority() {
        high.forEach { assertEquals(RecommendationPriority.High, it.priority) }
        medium.forEach { assertEquals(RecommendationPriority.Medium, it.priority) }
        baseline.forEach { assertEquals(RecommendationPriority.Low, it.priority) }
    }

    // ── Metadata integrity ──────────────────────────────────────────────────────────────────────────

    @Test
    fun everyRecommendationHasAStableListKeyAndTipsCatalogKey() {
        HealthRecommendation.entries.forEach { rec ->
            assertTrue("listKey blank for $rec", rec.listKey.isNotBlank())
            assertTrue("i18nKey for $rec", rec.i18nKey.startsWith("drivetrain.tips."))
        }
    }

    @Test
    fun listKeysAndI18nKeysAreUnique() {
        val listKeys = HealthRecommendation.entries.map { it.listKey }
        val i18nKeys = HealthRecommendation.entries.map { it.i18nKey }
        assertEquals(listKeys.size, listKeys.toSet().size)
        assertEquals(i18nKeys.size, i18nKeys.toSet().size)
    }
}
