package io.teslasync.android.featureviews.recentactivity

import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [RecentActivityContent] across every state the surface
 * renders: the loading chrome, the hard-error retry surface, the no-data empty state (each panel keeps its
 * own friendly empty branch), the populated two-panel grid, and the stale/offline cached view. Asserts the
 * rendered i18n strings, the interactive affordances (each panel's "View all" link + the retry button), the
 * tappable rows (with the id reported to the callback), and that every interactive element exposes a click
 * action for TalkBack. The offline gate's `testReleaseUnitTest` covers the pure logic; this covers render +
 * a11y. Mirrors the web spec (web/src/features/vehicles/components/RecentActivity.tsx).
 */
class RecentActivityUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val now = 1_700_000_000_000L

    private fun sampleData(): RecentActivityData =
        RecentActivityData(
            drives =
                listOf(
                    RecentActivityDrive(
                        id = 1L,
                        distanceM = 42_000.0,
                        durationS = 3_900L,
                        startSocPct = 82.0,
                        endSocPct = 68.0,
                        startTsMillis = now - 600_000L,
                    ),
                    RecentActivityDrive(
                        id = 2L,
                        distanceM = 12_500.0,
                        durationS = 1_500L,
                        startSocPct = 68.0,
                        endSocPct = 61.0,
                        startTsMillis = now - 7_200_000L,
                    ),
                ),
            sessions =
                listOf(
                    RecentActivityCharge(
                        id = 7L,
                        totalEnergyAddedWh = 23_400.0,
                        durationMin = 72L,
                        startSocPct = 61.0,
                        endSocPct = 90.0,
                        startTsMillis = now - 3_600_000L,
                    ),
                ),
        )

    private fun setContent(
        state: UiState<RecentActivityData>,
        onRetry: () -> Unit = {},
        onViewAllDrives: () -> Unit = {},
        onViewAllCharges: () -> Unit = {},
        onDriveClick: (Long) -> Unit = {},
        onChargeClick: (Long) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RecentActivityContent(
                    state = state,
                    onRetry = onRetry,
                    onViewAllDrives = onViewAllDrives,
                    onViewAllCharges = onViewAllCharges,
                    onDriveClick = onDriveClick,
                    onChargeClick = onChargeClick,
                )
            }
        }
    }

    @Test
    fun loadingShowsSkeletonChromeNotContentOrError() {
        setContent(UiState(UiPhase.Loading))

        compose.onNodeWithText("Recent Drives").assertDoesNotExist()
        compose.onNodeWithText("Recent Charges").assertDoesNotExist()
        compose.onNodeWithText("Retry").assertDoesNotExist()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })

        compose.onNodeWithText("Something went wrong on our end. Please try again.").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyRendersBothPanelsWithTheirFriendlyEmptyStates() {
        setContent(UiState(UiPhase.Empty, data = RecentActivityData()))

        compose.onNodeWithText("Recent Drives").assertIsDisplayed()
        compose.onNodeWithText("No drives recorded yet").assertIsDisplayed()
        compose.onNodeWithText("Recent Charges").assertIsDisplayed()
        compose.onNodeWithText("No charging sessions recorded yet").assertIsDisplayed()
    }

    @Test
    fun contentRendersBothPanelsWithDurationsAndSocRanges() {
        setContent(UiState(UiPhase.Content, data = sampleData()))

        compose.onNodeWithText("Recent Drives").assertIsDisplayed()
        compose.onNodeWithText("Recent Charges").assertIsDisplayed()
        compose.onNodeWithText("1h 5m").assertIsDisplayed()
        compose.onNodeWithText("82% → 68%").assertIsDisplayed()
        compose.onNodeWithText("1h 12m").assertIsDisplayed()
        compose.onNodeWithText("61% → 90%").assertIsDisplayed()
    }

    @Test
    fun viewAllAffordancesInvokeTheirCallbacks() {
        var drivesViewed = false
        var chargesViewed = false
        setContent(
            state = UiState(UiPhase.Content, data = sampleData()),
            onViewAllDrives = { drivesViewed = true },
            onViewAllCharges = { chargesViewed = true },
        )

        val viewAll = compose.onAllNodesWithText("View all")
        viewAll[0].performClick()
        viewAll[1].performClick()
        assertTrue(drivesViewed)
        assertTrue(chargesViewed)
    }

    @Test
    fun rowsAreTappableAndReportTheirId() {
        var clickedDrive = -1L
        var clickedCharge = -1L
        setContent(
            state = UiState(UiPhase.Content, data = sampleData()),
            onDriveClick = { clickedDrive = it },
            onChargeClick = { clickedCharge = it },
        )

        compose.onNodeWithText("82% → 68%").performClick()
        compose.onNodeWithText("61% → 90%").performClick()
        assertEquals(1L, clickedDrive)
        assertEquals(7L, clickedCharge)
    }

    @Test
    fun everyInteractiveElementExposesAClickActionForA11y() {
        setContent(UiState(UiPhase.Content, data = sampleData()))

        val viewAll = compose.onAllNodesWithText("View all")
        viewAll[0].assertHasClickAction()
        viewAll[1].assertHasClickAction()
        compose.onNodeWithText("82% → 68%").assertHasClickAction()
        compose.onNodeWithText("61% → 90%").assertHasClickAction()
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = sampleData(),
                stale = true,
                fetchedAt = now,
                errorKind = ErrorKind.Network,
            ),
        )

        compose.onNodeWithText("Recent Drives").assertIsDisplayed()
        compose.onNodeWithText("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = sampleData(),
                    stale = true,
                    fetchedAt = now,
                ),
            onRetry = { refreshed = true },
        )

        compose.waitForIdle()
        compose.onNodeWithText("Recent Drives").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
