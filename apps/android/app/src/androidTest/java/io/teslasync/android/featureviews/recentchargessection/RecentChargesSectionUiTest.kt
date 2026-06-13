package io.teslasync.android.featureviews.recentchargessection

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [RecentChargesSectionContent] across every state the
 * surface renders: the loading skeleton chrome, the hard-error retry surface, the populated five-column table
 * with the formatted cells, the empty state, the stale/offline cached view, and the "View all" link. Asserts
 * the rendered i18n strings and the TalkBack content descriptions (the "View all" link, the offline chip), and
 * that the retry + view-all + auto-refresh callbacks fire. The offline gate's `testReleaseUnitTest` covers the
 * pure logic; this covers render + a11y. Mirrors the web spec
 * (web/src/features/vehicles/components/vehicle-detail/RecentChargesSection.tsx).
 */
class RecentChargesSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val first =
        ChargeSession(
            id = 1L,
            startTs = "2026-04-04T18:30:00Z",
            energyAddedWh = 42_300.0,
            durationMinutes = 95.0,
            cost = 8.45,
            startSocPct = 23.0,
            endSocPct = 82.0,
        )

    private val second =
        ChargeSession(
            id = 2L,
            startTs = "2026-04-01T08:00:00Z",
            energyAddedWh = 11_900.0,
            durationMinutes = 42.0,
            cost = null,
            startSocPct = 64.0,
            endSocPct = 88.0,
        )

    private fun data(sessions: List<ChargeSession> = listOf(first, second)) = RecentChargesData(sessions)

    private fun setContent(
        state: UiState<RecentChargesData>,
        onViewAll: () -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RecentChargesSectionContent(
                    state = state,
                    onViewAll = onViewAll,
                    onRetry = onRetry,
                    currencySymbol = "$",
                    decimals = 2,
                    locale = Locale.US,
                    formatTimestamp = { it ?: EM_DASH },
                )
            }
        }
    }

    @Test
    fun loadingShowsHeaderAndSkeletonChromeNotTheTable() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Recent Charges").assertIsDisplayed()
        compose.onNodeWithContentDescription("View all").assertExists()
        // The table body is replaced by skeletons, so the column headers are absent.
        compose.onNodeWithText("Energy").assertDoesNotExist()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Failed to load data").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun contentRendersHeaderColumnsAndFormattedCells() {
        setContent(UiState(UiPhase.Content, data = data()))
        compose.onNodeWithText("Recent Charges").assertIsDisplayed()
        compose.onNodeWithText("Date").assertExists()
        compose.onNodeWithText("Energy").assertExists()
        compose.onNodeWithText("Duration").assertExists()
        compose.onNodeWithText("Cost").assertExists()
        compose.onNodeWithText("Battery").assertExists()
        compose.onNodeWithText("42.30 kWh").assertExists()
        compose.onNodeWithText("1h 35m").assertExists()
        compose.onNodeWithText("$8.45").assertExists()
        compose.onNodeWithText("23% \u2192 82%").assertExists()
    }

    @Test
    fun emptyShowsFriendlyNoChargesMessage() {
        setContent(UiState(UiPhase.Empty, data = RecentChargesData()))
        compose.onNodeWithText("No charging sessions recorded yet").assertIsDisplayed()
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = data(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("42.30 kWh").assertExists()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = data(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("42.30 kWh").assertExists()
        assertTrue(refreshed)
    }

    @Test
    fun viewAllLinkUsesAccessibleLabelAndInvokesCallback() {
        var viewedAll = false
        setContent(state = UiState(UiPhase.Content, data = data()), onViewAll = { viewedAll = true })
        compose.onNodeWithContentDescription("View all").assertExists().performClick()
        assertTrue(viewedAll)
    }

    @Test
    fun accessibilityLabelPresentOnViewAllInteractiveElement() {
        setContent(UiState(UiPhase.Content, data = data()))
        compose.onNodeWithContentDescription("View all").assertExists()
    }
}
