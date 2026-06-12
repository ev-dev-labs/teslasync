package io.teslasync.android.featureviews.alertssection

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
 * On-device Compose UI + accessibility verification of [AlertsSectionContent] across every state the surface
 * renders: the loading skeleton chrome, the hard-error retry surface, the no-alerts empty state, the populated
 * severity list + distribution donut with its legend, and the stale/offline cached views. Asserts the rendered
 * i18n strings and the TalkBack content descriptions (the always-visible title, the legend swatch labels, the
 * donut read-out, the freshness chip). The offline gate's `testReleaseUnitTest` covers the pure logic; this
 * covers render + a11y. Mirrors the web spec
 * (web/src/features/analytics/components/weekly-digest/AlertsSection.tsx).
 */
class AlertsSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<List<AlertSeverityCount>>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AlertsSectionContent(state = state, onRetry = onRetry, locale = Locale.US)
            }
        }
    }

    private fun counts(): List<AlertSeverityCount> =
        listOf(
            AlertSeverityCount(severity = "critical", count = 2),
            AlertSeverityCount(severity = "warning", count = 5),
            AlertSeverityCount(severity = "info", count = 3),
        )

    @Test
    fun loadingShowsTitleChromeAndAccessibleSkeletonNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Alerts").assertIsDisplayed()
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsTitleAndFriendlyNoAlertsMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText("Alerts").assertIsDisplayed()
        compose.onNodeWithText("No alerts this week \u2014 everything looks great!").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleTotalSectionLabelsAndAccessibleLegend() {
        setContent(UiState(UiPhase.Content, data = counts()))
        compose.onNodeWithText("Alerts").assertIsDisplayed()
        compose.onNodeWithText("10").assertIsDisplayed()
        compose.onNodeWithText("Alerts by Severity").assertIsDisplayed()
        compose.onNodeWithText("Alert Distribution").assertIsDisplayed()
        compose.onNodeWithContentDescription("Critical").assertExists()
        compose.onNodeWithContentDescription("Warning").assertExists()
        compose.onNodeWithContentDescription("Info").assertExists()
        compose.onNodeWithContentDescription("Alert Distribution", substring = true).assertExists()
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = counts(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Alerts").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = counts(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Alerts").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
