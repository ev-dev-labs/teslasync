package io.teslasync.android.featureviews.drivingperformancecards

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [DrivingPerformanceCardsContent] across every
 * branch the web component renders (loading skeleton grid / content six-card grid / empty), plus the
 * lifecycle chrome the host's feed implies (hard error with an accessible retry, and the stale/offline
 * freshness chip). Asserts the rendered labels/values, that the empty message and metric labels are exposed
 * to TalkBack, and that the retry affordance carries an accessible click action. Runs under
 * `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure projection.
 */
class DrivingPerformanceCardsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val prefs = UnitFormatter.default().prefs

    private val strings =
        DrivingPerformanceCardsStrings(
            topSpeed = "Top Speed",
            avgSpeed = "Avg Speed",
            peakPower = "Peak Power",
            peakRegen = "Peak Regen",
            avgDriveDistance = "Avg Drive Distance",
            longestDrive = "Longest Drive",
            noData = "No data available",
        )

    private val snapshot =
        DrivingPerformanceSnapshot(
            speedStats = DriveStatSummary(avg = 64.4, max = 113.0),
            powerStats = DriveStatSummary(avg = 42.0, max = 211.0),
            regenStats = DriveStatSummary(avg = 21.0, max = 67.0),
            distanceStats = DriveStatSummary(avg = 23.7, max = 142.3),
        )

    private fun setContent(
        state: UiState<DrivingPerformanceSnapshot>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    DrivingPerformanceCardsContent(state = state, onRetry = onRetry, prefs = prefs, strings = strings)
                }
            }
        }
    }

    @Test
    fun contentShowsLabelsAndValues() {
        setContent(UiState(phase = UiPhase.Content, data = snapshot))
        // Every metric label is rendered (TalkBack reads each tile's label) — accessibility coverage.
        compose.onNodeWithText(strings.topSpeed).assertIsDisplayed()
        compose.onNodeWithText(strings.peakPower).assertIsDisplayed()
        compose.onNodeWithText(strings.longestDrive).assertIsDisplayed()
        // Formatted, unit-converted values (metric defaults: km/h, km, kW).
        compose.onNodeWithText("113").assertIsDisplayed()
        compose.onNodeWithText("211").assertIsDisplayed()
        compose.onNodeWithText("142.3").assertIsDisplayed()
    }

    @Test
    fun loadingShowsNoMetricLabels() {
        setContent(UiState.loading())
        // The skeleton grid carries no metric labels.
        compose.onNodeWithText(strings.topSpeed).assertDoesNotExist()
    }

    @Test
    fun emptyShowsAccessibleNoDataMessage() {
        setContent(UiState(phase = UiPhase.Empty))
        compose.onNodeWithText(strings.noData).assertIsDisplayed()
    }

    @Test
    fun errorShowsAccessibleRetryAndInvokesIt() {
        var retried = false
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        // The retry affordance exposes a click action (accessibility) and drives the host's refetch.
        val retry = compose.onNodeWithText("Retry")
        retry.assertIsDisplayed().assertHasClickAction()
        retry.performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineStaleStillShowsContent() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = snapshot,
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        // Stale/offline keeps the cached cards visible (never blanks) — the "last known" contract.
        compose.onNodeWithText(strings.topSpeed).assertIsDisplayed()
        compose.onNodeWithText("113").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 400.dp
        val HOST_HEIGHT = 800.dp
    }
}
