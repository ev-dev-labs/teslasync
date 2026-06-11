package io.teslasync.android.dashboard.widgets.automationhistory

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.automations.AutomationHistory
import io.teslasync.shared.core.presentation.automations.AutomationHistoryListResponse
import io.teslasync.shared.core.presentation.automations.AutomationHistoryStats
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [AutomationHistoryWidgetContent] across every state
 * the web component renders (loading skeleton, empty, hard error + retry, wide content feed, compact hero,
 * stale/offline cached). Asserts the rendered i18n strings and the TalkBack content descriptions are
 * present. Runs under `connectedAndroidTest` (a device/emulator) — the offline gate's
 * `testReleaseUnitTest` covers the logic; this covers the render.
 */
class AutomationHistoryWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val fixedNow = 1_780_000_000_000L

    private fun run(
        status: String = "success",
        name: String = "Morning Charge",
    ): AutomationHistory =
        AutomationHistory(
            id = 1,
            automationId = 7,
            automationName = name,
            triggeredAt = "2026-06-06T12:00:00Z",
            durationMs = 1_500,
            status = status,
        )

    private fun response(vararg runs: AutomationHistory): AutomationHistoryListResponse =
        AutomationHistoryListResponse(
            items = runs.toList(),
            summary = AutomationHistoryStats(totalExecutions = 120, successRate = 91.5),
        )

    private fun setContent(
        state: UiState<AutomationHistoryListResponse>,
        size: AutomationHistorySize = AutomationHistoryRegistration.defaultSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AutomationHistoryWidgetContent(
                    state = state,
                    size = size,
                    onRefresh = onRefresh,
                    nowMillis = fixedNow,
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
    fun emptyShowsFriendlyMessage() {
        setContent(UiState(UiPhase.Empty, data = response(), fetchedAt = fixedNow))
        compose.onNodeWithText("No automation runs yet").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRefresh() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRefresh = { retried = true },
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun wideContentShowsSuccessHeaderAndRunRow() {
        setContent(UiState(UiPhase.Content, data = response(run()), fetchedAt = fixedNow))
        compose.onNodeWithText("91.5% Success Rate").assertIsDisplayed()
        compose.onNodeWithText("120 runs").assertIsDisplayed()
        // Run row exposes a single TalkBack phrase folding name + status + relative time.
        compose.onNodeWithContentDescription("Morning Charge", substring = true).assertIsDisplayed()
    }

    @Test
    fun compactHeroExposesSuccessRateAndAccessibleName() {
        setContent(
            state = UiState(UiPhase.Content, data = response(run()), fetchedAt = fixedNow),
            size = AutomationHistorySize(cols = 1, rows = 2),
        )
        compose.onNodeWithText("91.5%").assertIsDisplayed()
        compose.onNodeWithContentDescription("Success Rate", substring = true).assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = response(run()),
                fetchedAt = fixedNow,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached rows stay visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("Morning Charge", substring = true).assertIsDisplayed()
    }

    @Test
    fun contentHeaderExposesRefreshAction() {
        setContent(UiState(UiPhase.Content, data = response(run()), fetchedAt = fixedNow))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }
}
