package io.teslasync.android.featureviews.chargertypebreakdown

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
 * On-device Compose UI + accessibility verification of [ChargerTypeBreakdownContent] across every state the
 * surface renders: the loading chrome, the hard-error retry surface, the "Not enough data" empty state, the
 * populated donut + legend + per-charger breakdown (with the combined per-row accessibility description and
 * the donut's accessible description), and the stale/offline cached views. Asserts the rendered i18n strings,
 * the freshness chip's "Offline" TalkBack label, and the stale auto-refresh. The offline gate's
 * `testReleaseUnitTest` covers the pure logic; this covers render + a11y. Mirrors the web spec
 * (web/src/features/charging/components/cost-analysis/ChargerTypeBreakdown.tsx).
 */
class ChargerTypeBreakdownUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<ChargerTypeBreakdownInput>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ChargerTypeBreakdownContent(
                    state = state,
                    onRetry = onRetry,
                    locale = Locale.US,
                )
            }
        }
    }

    private fun input(): ChargerTypeBreakdownInput =
        ChargerTypeBreakdownInput(
            data =
                listOf(
                    ChargerTypeDatum(name = "Supercharger", cost = 182.45, energyKwh = 612.3, sessions = 24),
                    ChargerTypeDatum(name = "Home", cost = 96.10, energyKwh = 740.0, sessions = 58),
                ),
            totalCost = 278.55,
        )

    @Test
    fun loadingShowsTitleChromeNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Cost by Charger Type").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500),
            onRetry = { retried = true },
        )
        compose.onNodeWithText("Retry").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsTitleAndNoDataMessage() {
        setContent(UiState(UiPhase.Empty, data = ChargerTypeBreakdownInput(emptyList(), 0.0)))
        compose.onNodeWithText("Cost by Charger Type").assertIsDisplayed()
        compose.onNodeWithText("Not enough data").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleAccessibleDonutAndBreakdownRow() {
        setContent(UiState(UiPhase.Content, data = input()))
        compose.onNodeWithText("Cost by Charger Type").assertIsDisplayed()
        // The donut exposes one combined accessible description (decorative arcs are cleared for TalkBack).
        compose.onNodeWithContentDescription("Cost by Charger Type", substring = true).assertExists()
        // Each breakdown row exposes one combined statistic; "24 sessions" is unique to the Supercharger row.
        compose.onNodeWithContentDescription("24 sessions", substring = true).assertExists()
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = input(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Cost by Charger Type").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = input(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Cost by Charger Type").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
