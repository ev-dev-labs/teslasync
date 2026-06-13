package io.teslasync.android.sharedsurfaces.scorebadge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Off-device verification of the ScoreBadge's pure logic — the native mirror of every decision the web
 * component + its shared scale make (web/src/components/data-display/ScoreBadge.tsx,
 * web/src/lib/scoreScale.ts): the `numericToGrade` threshold mapping (including the null / non-finite "—"
 * guard and caller-supplied scales), the `gradeInfo` palette lookup (tone + numeric weight), and the
 * score- / grade-driven projection the composable renders. Because the composable is a thin render layer
 * over these pure functions, the per-branch assertions here double as the surface's per-state snapshot.
 * Runs in the :app:testReleaseUnitTest gate.
 */
class ScoreBadgeModelTest {
    // ── numericToGrade: default 0–100 thresholds (web DEFAULT_SCORE_THRESHOLDS, highest match wins) ────────

    @Test
    fun numericToGradeMapsTheDefaultBandsAtTheirInclusiveLowerBounds() {
        assertEquals(ScoreGrade.APlus, numericToGrade(95.0).grade)
        assertEquals(ScoreGrade.APlus, numericToGrade(90.0).grade)
        assertEquals(ScoreGrade.A, numericToGrade(89.0).grade)
        assertEquals(ScoreGrade.A, numericToGrade(80.0).grade)
        assertEquals(ScoreGrade.B, numericToGrade(79.0).grade)
        assertEquals(ScoreGrade.B, numericToGrade(65.0).grade)
        assertEquals(ScoreGrade.C, numericToGrade(64.0).grade)
        assertEquals(ScoreGrade.C, numericToGrade(50.0).grade)
        assertEquals(ScoreGrade.D, numericToGrade(49.0).grade)
        assertEquals(ScoreGrade.D, numericToGrade(35.0).grade)
        assertEquals(ScoreGrade.F, numericToGrade(34.0).grade)
        assertEquals(ScoreGrade.F, numericToGrade(0.0).grade)
    }

    @Test
    fun numericToGradeFallsThroughToFForOutOfRangeOrNegative() {
        // -1 matches no threshold (the lowest is min=0), so the web for-loop exhausts and returns F.
        assertEquals(ScoreGrade.F, numericToGrade(-1.0).grade)
    }

    @Test
    fun numericToGradeMapsMissingOrNonFiniteToTheDashSentinel() {
        assertEquals(ScoreGrade.Dash, numericToGrade(null).grade)
        assertEquals(ScoreGrade.Dash, numericToGrade(Double.NaN).grade)
        assertEquals(ScoreGrade.Dash, numericToGrade(Double.POSITIVE_INFINITY).grade)
        assertEquals(ScoreGrade.Dash, numericToGrade(Double.NEGATIVE_INFINITY).grade)
    }

    @Test
    fun numericToGradeHonoursACallerSuppliedScale() {
        // A non-default scale (web `thresholds` arg): only A (≥50) and F (≥0).
        val scale = listOf(ScoreThreshold(50.0, ScoreGrade.A), ScoreThreshold(0.0, ScoreGrade.F))
        assertEquals(ScoreGrade.A, numericToGrade(60.0, scale).grade)
        assertEquals(ScoreGrade.A, numericToGrade(50.0, scale).grade)
        assertEquals(ScoreGrade.F, numericToGrade(10.0, scale).grade)
    }

    @Test
    fun numericToGradeEvaluatesThresholdsHighestFirstRegardlessOfInputOrder() {
        // Deliberately unsorted input — the highest matching band must still win (web `sort((a,b)=>b.min-a.min)`).
        val scale =
            listOf(
                ScoreThreshold(0.0, ScoreGrade.F),
                ScoreThreshold(90.0, ScoreGrade.APlus),
                ScoreThreshold(50.0, ScoreGrade.C),
            )
        assertEquals(ScoreGrade.APlus, numericToGrade(95.0, scale).grade)
        assertEquals(ScoreGrade.C, numericToGrade(60.0, scale).grade)
        assertEquals(ScoreGrade.F, numericToGrade(10.0, scale).grade)
    }

    // ── gradeInfo: the shared palette (tone + numeric weight, web GRADE_PALETTE) ───────────────────────────

    @Test
    fun gradeInfoMapsEachGradeToItsToneAndNumericWeight() {
        assertEquals(ScoreGradeInfo(ScoreGrade.APlus, ScoreTone.Success, 4.5), gradeInfo(ScoreGrade.APlus))
        assertEquals(ScoreGradeInfo(ScoreGrade.A, ScoreTone.Success, 4.0), gradeInfo(ScoreGrade.A))
        assertEquals(ScoreGradeInfo(ScoreGrade.B, ScoreTone.Info, 3.0), gradeInfo(ScoreGrade.B))
        assertEquals(ScoreGradeInfo(ScoreGrade.C, ScoreTone.Warning, 2.0), gradeInfo(ScoreGrade.C))
        assertEquals(ScoreGradeInfo(ScoreGrade.D, ScoreTone.Danger, 1.0), gradeInfo(ScoreGrade.D))
        assertEquals(ScoreGradeInfo(ScoreGrade.F, ScoreTone.Danger, 0.5), gradeInfo(ScoreGrade.F))
    }

    @Test
    fun gradeInfoMapsTheDashSentinelToMutedWithNoNumericWeight() {
        val info = gradeInfo(ScoreGrade.Dash)
        assertEquals(ScoreTone.Muted, info.tone)
        assertNull("the no-data sentinel carries no averaging weight", info.numeric)
    }

    @Test
    fun theDashGradeRendersTheEmDashLabel() {
        assertEquals("\u2014", ScoreGrade.Dash.label)
        assertEquals(SCORE_BADGE_DASH, ScoreGrade.Dash.label)
    }

    // ── projectScore / projectGrade: the render-ready per-state snapshot ───────────────────────────────────

    @Test
    fun projectScoreReducesScoreToGradeToneAndVisibleLetter() {
        assertEquals(ScoreBadgeProjection(ScoreGrade.APlus, ScoreTone.Success), projectScore(95.0))
        assertEquals(ScoreBadgeProjection(ScoreGrade.B, ScoreTone.Info), projectScore(70.0))
        assertEquals(ScoreBadgeProjection(ScoreGrade.C, ScoreTone.Warning), projectScore(55.0))
        assertEquals(ScoreBadgeProjection(ScoreGrade.F, ScoreTone.Danger), projectScore(10.0))
        assertEquals(ScoreBadgeProjection(ScoreGrade.Dash, ScoreTone.Muted), projectScore(null))
    }

    @Test
    fun projectGradeReducesAPreComputedGradeDirectly() {
        assertEquals(ScoreBadgeProjection(ScoreGrade.D, ScoreTone.Danger), projectGrade(ScoreGrade.D))
        assertEquals("D", projectGrade(ScoreGrade.D).visibleLabel)
        assertEquals(SCORE_BADGE_DASH, projectGrade(ScoreGrade.Dash).visibleLabel)
    }

    @Test
    fun projectScoreHonoursACallerSuppliedScale() {
        val scale = listOf(ScoreThreshold(50.0, ScoreGrade.A), ScoreThreshold(0.0, ScoreGrade.F))
        assertEquals(ScoreBadgeProjection(ScoreGrade.A, ScoreTone.Success), projectScore(60.0, scale))
        assertEquals(ScoreBadgeProjection(ScoreGrade.F, ScoreTone.Danger), projectScore(10.0, scale))
    }
}
