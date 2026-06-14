package io.teslasync.android.dashboard.widgets.dashboardstats

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.data.repo.DashboardStats
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [DashboardStatsWidgetContent] across every state the
 * web component renders (loading skeleton, standard stat grid + status badge, wide recent transitions, compact
 * big number, no-data empty, stale/offline cached). Asserts the rendered i18n strings and the folded TalkBack
 * content descriptions are present. Runs under `connectedAndroidTest` (a device/emulator) — the offline gate's
 * `testReleaseUnitTest` covers the logic; this covers render + a11y.
 */
class DashboardStatsWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val standardSize = DashboardStatsRegistration.DEFAULT_SIZE
    private val compactSize = DashboardStatsSize(cols = 1, rows = 2)
    private val wideSize = DashboardStatsSize(cols = 4, rows = 4)

    private fun setContent(
        state: UiState<DashboardStatsSnapshot>,
        size: DashboardStatsSize = standardSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DashboardStatsWidgetContent(
                    state = state,
                    size = size,
                    onRefresh = onRefresh,
                    nowMillis = NOW,
                    locale = Locale.US,
                )
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun standardContentShowsTitleAndStatTiles() {
        setContent(UiState(UiPhase.Content, data = populatedSnapshot(), fetchedAt = NOW))
        compose.onNodeWithText("Dashboard Stats").assertIsDisplayed()
        compose.onNodeWithText("Vehicles").assertIsDisplayed()
        compose.onNodeWithText("Charge Sessions").assertIsDisplayed()
        // The status row folds the label + FSM state into a single TalkBack phrase.
        compose.onNodeWithContentDescription("Current State, driving").assertIsDisplayed()
    }

    @Test
    fun standardContentExposesRefreshAction() {
        var refreshed = false
        setContent(
            state = UiState(UiPhase.Content, data = populatedSnapshot(), fetchedAt = NOW),
            onRefresh = { refreshed = true },
        )
        compose.onNodeWithContentDescription("Refresh").performClick()
        assertTrue(refreshed)
    }

    @Test
    fun wideContentShowsRecentTransitions() {
        setContent(
            state = UiState(UiPhase.Content, data = populatedSnapshot(), fetchedAt = NOW),
            size = wideSize,
        )
        compose.onNodeWithText("Recent Transitions").assertIsDisplayed()
        // Each transition row folds the capitalized state + relative age into one phrase.
        compose.onNodeWithContentDescription("Charging, 5m ago").assertIsDisplayed()
    }

    @Test
    fun compactContentFoldsTripCountAndActiveLabel() {
        setContent(
            state = UiState(UiPhase.Content, data = populatedSnapshot(), fetchedAt = NOW),
            size = compactSize,
        )
        compose.onNodeWithContentDescription("1,286 active").assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoDataMessage() {
        setContent(UiState(UiPhase.Empty, data = emptySnapshot(), fetchedAt = NOW))
        compose.onNodeWithText("No dashboard stats available").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = populatedSnapshot(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        compose.onNodeWithText("Dashboard Stats").assertIsDisplayed()
        compose.onNodeWithText("Vehicles").assertIsDisplayed()
    }

    private companion object {
        const val NOW = 1_780_000_000_000L

        fun populatedSnapshot(): DashboardStatsSnapshot =
            DashboardStatsSnapshot(
                dashStats = DashboardStats(totalVehicles = 3, totalChargingSessions = 214, totalTrips = 1_286),
                fsmState = "driving",
                transitions = listOf(RawTransition("charging", NOW - 5 * 60_000L)),
            )

        fun emptySnapshot(): DashboardStatsSnapshot =
            DashboardStatsSnapshot(dashStats = null, fsmState = EM_DASH, transitions = emptyList())
    }
}
