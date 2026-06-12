package io.teslasync.android.featureviews.fleetsummary

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * Instrumented Compose UI + accessibility verification of [FleetSummaryContent] across the states the
 * surface renders — the populated four-card grid, the empty (no-vehicles → zeros) grid, the skeleton
 * loading chrome, the hard-error retry surface, and the offline (cached + freshness chip + retry)
 * surface. Asserts every label, value, and subtext is exposed to TalkBack (present in the semantics
 * tree), the count cells render their static figures under reduced motion (the deterministic
 * accessibility path), that no card is ever hidden or blank (the empty grid still shows every labelled
 * zero), and that the one interactive control (retry / refresh) carries an accessibility label. Runs
 * under `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the pure projection +
 * view-model state matrix.
 */
class FleetSummaryUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val populated =
        FleetSummaryData(
            vehicleCount = 4,
            avgBatteryPercent = 73.0,
            totalRangeMeters = 1_200_000.0,
            chargingCount = 1,
            onlineCount = 3,
        )

    private fun setContent(state: UiState<FleetSummaryData>) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    FleetSummaryContent(
                        state = state,
                        prefs = FleetSummaryDisplayPrefs.METRIC_DEFAULT,
                        onRefresh = {},
                        locale = Locale.US,
                        reduceMotion = true,
                    )
                }
            }
        }
    }

    @Test
    fun populatedGridShowsEveryLabelValueAndSubtext() {
        setContent(UiState(phase = UiPhase.Content, data = populated, fetchedAt = 1L))

        // Vehicles: label + count.
        compose.onNodeWithText("Vehicles").assertIsDisplayed()
        compose.onNodeWithText("4").assertIsDisplayed()

        // Avg Battery: label + percent value.
        compose.onNodeWithText("Avg Battery").assertIsDisplayed()
        compose.onNodeWithText("73%").assertIsDisplayed()

        // Total Range: label carries the unit; value is grouped + converted (1,200,000 m → 1,200 km).
        compose.onNodeWithText("Total Range km").assertIsDisplayed()
        compose.onNodeWithText("1,200").assertIsDisplayed()

        // Charging / Online: label + charging count + "/ online" subscript.
        compose.onNodeWithText("Charging / Online").assertIsDisplayed()
        compose.onNodeWithText("1").assertIsDisplayed()
        compose.onNodeWithText("/ 3").assertIsDisplayed()
    }

    @Test
    fun emptyFleetStillRendersEveryCardWithZeros() {
        setContent(UiState(phase = UiPhase.Content, data = FleetSummaryData.EMPTY, fetchedAt = 1L))

        // Every card is present with a labelled zero — the friendly empty surface, never a blank box.
        compose.onNodeWithText("Vehicles").assertIsDisplayed()
        compose.onNodeWithText("Avg Battery").assertIsDisplayed()
        compose.onNodeWithText("0%").assertIsDisplayed()
        compose.onNodeWithText("Total Range km").assertIsDisplayed()
        compose.onNodeWithText("Charging / Online").assertIsDisplayed()
        compose.onNodeWithText("/ 0").assertIsDisplayed()
    }

    @Test
    fun loadingShowsSkeletonChromeWithAccessibilityLabel() {
        setContent(UiState.loading())

        // The skeleton grid carries the localized loading label for TalkBack; no card label is shown yet.
        compose.onNodeWithContentDescription("Loading...").assertIsDisplayed()
    }

    @Test
    fun hardErrorShowsRetryAffordance() {
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network))

        compose.onNodeWithText("Server error").assertIsDisplayed()
        // The retry button is labelled (its text is its TalkBack label).
        compose.onNodeWithText("Retry").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedGridWithLabelledRetry() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = populated,
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )

        // Cached cards stay visible (offline / last known)…
        compose.onNodeWithText("Vehicles").assertIsDisplayed()
        compose.onNodeWithText("Avg Battery").assertIsDisplayed()
        // …above a labelled refresh control (the retry affordance).
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 800.dp
        val HOST_HEIGHT = 700.dp
    }
}
