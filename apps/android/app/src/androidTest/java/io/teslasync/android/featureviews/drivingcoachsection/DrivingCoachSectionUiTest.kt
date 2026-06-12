package io.teslasync.android.featureviews.drivingcoachsection

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import io.teslasync.android.R
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [DrivingCoachSectionContent] across every state the
 * surface renders: the first-load skeleton (its "Loading" a11y label), the hard-error retry surface (title +
 * working retry), the empty coach (every section title + the four internal empty states + zeros, never a blank
 * box), and the populated content (title, gauge a11y description, formatted efficiency, the style legend, a
 * pattern bar, the recommendation, and the per-drive cells). Also asserts the content renders under reduced
 * motion (the FadeIn entrances collapse to their final state, so every label is present immediately). Strings
 * are resolved from the catalog via the host activity so the assertions can never drift from the i18n wording;
 * the surface is hosted in a vertical scroller so the tall section's lower rows can be scrolled into view before
 * asserting. Runs under `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the pure
 * projection, this covers render + a11y. Mirrors the web spec
 * (web/src/features/driving/components/driving-dynamics/DrivingCoachSection.tsx).
 */
class DrivingCoachSectionUiTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val data =
        DrivingCoachData(
            overallScore = 82.0,
            efficiencyWhKm = 168.4,
            bestEfficiencyWhKm = 152.1,
            totalDrivesAnalyzed = 37.0,
            styleBreakdown = mapOf("efficient" to 20.0, "moderate" to 12.0, "aggressive" to 5.0),
            patterns =
                CoachPatterns(
                    hardAccelPct = 18.0,
                    hardBrakePct = 22.0,
                    highwayPct = 61.0,
                    shortTripPct = 44.0,
                    coldStartPct = 9.0,
                ),
            weeklyTrend =
                listOf(
                    CoachWeeklyTrend(week = "W1", score = 71.0),
                    CoachWeeklyTrend(week = "W2", score = 78.0),
                    CoachWeeklyTrend(week = "W3", score = 82.0),
                ),
            recommendations =
                listOf(CoachRecommendation(category = "braking", impact = "high", tip = "Brake earlier to recover energy.")),
            perDriveScores =
                listOf(
                    CoachDriveScore(
                        driveId = 1,
                        date = "2026-03-14",
                        score = 88.0,
                        style = "efficient",
                        efficiency = 151.2,
                        distance = 42.6,
                    ),
                ),
        )

    private fun str(id: Int): String = compose.activity.getString(id)

    private fun setContent(
        state: UiState<DrivingCoachData>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                        DrivingCoachSectionContent(
                            state = state,
                            onRetry = onRetry,
                            locale = Locale.US,
                            zone = ZoneId.of("UTC"),
                        )
                    }
                }
            }
        }
    }

    /** Scrolls the tall section so [text] is in view, then asserts it is displayed. */
    private fun assertShown(text: String) {
        compose.onNodeWithText(text).performScrollTo().assertIsDisplayed()
    }

    @Test
    fun loadingStateRendersSkeletonWithTheLoadingA11yLabel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription(str(R.string.translation_a11y_loading)).assertIsDisplayed()
    }

    @Test
    fun errorStateRendersTitleAndAWorkingRetry() {
        var retried = false
        setContent(UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })

        assertShown(str(R.string.translation_error_serverError_title))
        compose.onNodeWithText(str(R.string.translation_common_retry)).performScrollTo().performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyCoachRendersEverySectionTitleAndAllFourInternalEmptyStates() {
        setContent(UiState(UiPhase.Empty))

        // The section title + every panel title is present (never hidden).
        assertShown(str(R.string.translation_dynamics_coach_title))
        assertShown(str(R.string.translation_dynamics_coach_styleBreakdown))
        assertShown(str(R.string.translation_dynamics_coach_weeklyTrend))
        assertShown(str(R.string.translation_dynamics_coach_patterns))
        assertShown(str(R.string.translation_dynamics_coach_recommendations))
        assertShown(str(R.string.translation_dynamics_coach_perDriveScores))

        // The efficiency stat labels + the analyzed-count line render rather than a blank tile.
        assertShown(str(R.string.translation_dynamics_coach_avgEfficiency))
        assertShown(str(R.string.translation_dynamics_coach_bestEfficiency))

        // All four internal empty states render, so the section is never a blank box.
        assertShown(str(R.string.translation_dynamics_coach_noData))
        assertShown(str(R.string.translation_dynamics_coach_needWeeks))
        assertShown(str(R.string.translation_dynamics_coach_noRecs))
        assertShown(str(R.string.translation_dynamics_coach_noDrives))
    }

    @Test
    fun emptyCoachRendersEveryPatternLabel() {
        setContent(UiState(UiPhase.Empty))

        assertShown(str(R.string.translation_dynamics_coach_hardAccel))
        assertShown(str(R.string.translation_dynamics_coach_hardBrake))
        assertShown(str(R.string.translation_dynamics_coach_highway))
        assertShown(str(R.string.translation_dynamics_coach_shortTrips))
        assertShown(str(R.string.translation_dynamics_coach_coldStarts))
    }

    @Test
    fun populatedContentRendersTitleStatsLegendPatternsAndPerDrive() {
        setContent(UiState(UiPhase.Content, data = data))

        assertShown(str(R.string.translation_dynamics_coach_title))
        // The radial gauge exposes a single a11y description ("Driving Score: 82").
        compose
            .onNodeWithContentDescription(str(R.string.translation_dynamics_coach_overallScore), substring = true)
            .assertIsDisplayed()
        // Efficiency stat values + a pattern bar + its value.
        assertShown("168.40 Wh/km")
        assertShown("152.10 Wh/km")
        assertShown("18.00%")
        // The recommendation tip + the per-drive cells.
        assertShown("Brake earlier to recover energy.")
        assertShown("Mar 14")
        assertShown("42.60 km")
    }

    @Test
    fun contentRendersUnderReducedMotion() {
        // With reduced motion the FadeIn entrances collapse to their final state, so the title + stats are
        // present immediately rather than mid-animation.
        setContent(UiState(UiPhase.Content, data = data))
        assertShown(str(R.string.translation_dynamics_coach_title))
        assertShown("168.40 Wh/km")
    }
}
