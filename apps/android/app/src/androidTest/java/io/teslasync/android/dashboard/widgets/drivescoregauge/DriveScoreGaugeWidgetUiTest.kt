package io.teslasync.android.dashboard.widgets.drivescoregauge

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [DriveScoreGaugeWidgetContent] across every
 * state the web component renders (loading skeleton, hard error + retry, the gauge hero with grade +
 * sub-score breakdown, the "No score yet" empty state, and the stale/offline cached path). Asserts the
 * rendered i18n strings and the TalkBack content descriptions are present. Runs under
 * `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure logic, this covers
 * the render + a11y.
 */
class DriveScoreGaugeWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun score(
        overall: Double = 85.0,
        grade: String = "A",
    ): DriveScoreSnapshot =
        DriveScoreSnapshot(
            overall = overall,
            efficiency = 82.0,
            smoothness = 88.0,
            speedDiscipline = 80.0,
            grade = grade,
        )

    private fun setContent(
        state: UiState<DriveScoreSnapshot?>,
        size: DriveScoreGaugeSize = DriveScoreGaugeRegistration.defaultSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    DriveScoreGaugeWidgetContent(
                        state = state,
                        size = size,
                        onRefresh = onRefresh,
                    )
                }
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Drive Score").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRefresh = { retried = true },
        )
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsNoScoreMessage() {
        setContent(UiState(UiPhase.Empty, data = null, fetchedAt = NOW))
        compose.onNodeWithText("No score yet").assertIsDisplayed()
    }

    @Test
    fun contentShowsTitleGaugeAndRefresh() {
        setContent(UiState(UiPhase.Content, data = score(), fetchedAt = NOW))
        compose.onNodeWithText("Drive Score").assertIsDisplayed()
        // The radial gauge folds its grade + weekly-score value into one accessible name.
        compose.onNodeWithContentDescription("A: 85 Weekly score").assertIsDisplayed()
        // The header refresh control exposes an accessible name (TalkBack).
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun contentShowsSubScoreBreakdownLabels() {
        setContent(UiState(UiPhase.Content, data = score(), fetchedAt = NOW))
        compose.onAllNodesWithText("Efficiency").onFirst().assertIsDisplayed()
        compose.onAllNodesWithText("Smoothness").onFirst().assertIsDisplayed()
        compose.onAllNodesWithText("Speed Discipline").onFirst().assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedGaugeVisible() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = score(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached gauge stays visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("A: 85 Weekly score").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
        val HOST_WIDTH = 360.dp
        val HOST_HEIGHT = 560.dp
    }
}
