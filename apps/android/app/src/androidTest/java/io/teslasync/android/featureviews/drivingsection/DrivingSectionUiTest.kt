package io.teslasync.android.featureviews.drivingsection

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
 * On-device Compose UI + accessibility verification of [DrivingSectionContent] across every state the surface
 * renders: the first-load skeleton (its "Loading" a11y label), the hard-error retry surface (title + working
 * retry), the empty week (the four mini-stat labels + zeros and the two internal empty states, never a blank
 * box), and the populated content (title, labels, formatted metric values, and the Top-Drive card). Also
 * asserts the content renders under reduced motion (the FadeIn entrance collapses to its final state, so every
 * label is present immediately). Strings are resolved from the catalog via the host activity so the assertions
 * can never drift from the i18n wording; the surface is hosted in a vertical scroller so the tall section's
 * lower rows can be scrolled into view before asserting display. Runs under `connectedAndroidTest`; the
 * offline `testReleaseUnitTest` gate covers the pure projection, this covers render + a11y. Mirrors the web
 * spec (web/src/features/analytics/components/weekly-digest/DrivingSection.tsx).
 */
class DrivingSectionUiTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val data =
        DrivingSectionData(
            avgEfficiency = 168.4,
            prevAvgEfficiency = 175.0,
            totalDuration = 372.0,
            totalDrives = 14.0,
            topDrive =
                DrivingTopDrive(
                    startDate = "2026-03-14",
                    distance = 182.6,
                    durationMin = 145.0,
                    efficiencyWhKm = 158.2,
                ),
            dailyDistanceData =
                listOf(
                    DailyDistanceEntry("Mon", 42.0),
                    DailyDistanceEntry("Sat", 120.4),
                ),
        )

    private fun str(id: Int): String = compose.activity.getString(id)

    private fun setContent(
        state: UiState<DrivingSectionData>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                        DrivingSectionContent(
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
    fun emptyWeekRendersAllLabelsZerosAndBothInternalEmptyStates() {
        setContent(UiState(UiPhase.Empty))

        // The section title + every mini-stat label is present (never hidden).
        assertShown(str(R.string.translation_analytics_weeklyDigest_drivingSection))
        assertShown(str(R.string.translation_analytics_weeklyDigest_avgEfficiency))
        assertShown(str(R.string.translation_analytics_weeklyDigest_totalDrivingTime))
        assertShown(str(R.string.translation_analytics_weeklyDigest_efficiencyChange))
        assertShown(str(R.string.translation_analytics_weeklyDigest_drivesCount))

        // Zeroed values render rather than a blank tile.
        assertShown("0.0 Wh/km")
        assertShown("0h 0m")
        assertShown("0")

        // Both internal empty states render (chart + top drive), so the section is never a blank box.
        assertShown(str(R.string.translation_analytics_weeklyDigest_noDailyDistance))
        assertShown(str(R.string.translation_analytics_weeklyDigest_noTopDrive))
    }

    @Test
    fun populatedContentRendersTitleStatsAndTopDrive() {
        setContent(UiState(UiPhase.Content, data = data))

        assertShown(str(R.string.translation_analytics_weeklyDigest_drivingSection))
        // Mini-stat labels + their formatted values.
        assertShown(str(R.string.translation_analytics_weeklyDigest_avgEfficiency))
        assertShown("168.4 Wh/km")
        assertShown("6h 12m")
        assertShown("-3.8%")
        assertShown("14")
        // Top-Drive card: badge + the formatted fields.
        assertShown(str(R.string.translation_analytics_weeklyDigest_topDrive))
        assertShown("Mar 14, 2026")
        assertShown("182.6 km")
        assertShown("145 min")
    }

    @Test
    fun contentRendersUnderReducedMotion() {
        // With reduced motion the FadeIn entrance collapses to its final state, so the title (and stats) are
        // present immediately rather than mid-animation.
        setContent(UiState(UiPhase.Content, data = data))
        assertShown(str(R.string.translation_analytics_weeklyDigest_drivingSection))
        assertShown("168.4 Wh/km")
    }
}
