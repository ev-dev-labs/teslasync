package io.teslasync.android.featureviews.gaspricesettings

import androidx.compose.runtime.remember
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.settings.GasPriceConfigResult
import io.teslasync.shared.core.presentation.settings.GasPricePollResult
import io.teslasync.shared.core.presentation.settings.GasPriceStatus
import io.teslasync.shared.core.presentation.settings.GasPriceToggleResult
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.serialization.json.JsonElement
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the GasPriceSettings surface across every state it
 * renders: the loading skeleton chrome, the hard-error retry surface, the populated controls (running/stopped
 * toggle, interval, the price + last-polled cards, Poll Now) with their TalkBack labels, and the stale/offline
 * cached view with auto-refresh. The offline gate's `testReleaseUnitTest` covers the pure logic + view-model;
 * this covers render + a11y. Mirrors the web spec
 * (web/src/features/settings/components/GasPriceSettings.tsx).
 */
class GasPriceSettingsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val prefs = GasDisplayPrefs(currencySymbol = "$", decimalPrecision = 2, gasUnit = "gallon")

    private fun status(
        enabled: Boolean,
        price: Double,
        interval: String = "7d",
        lastPoll: String = LastPolled.ZERO_SENTINEL,
    ): GasPriceStatus =
        GasPriceStatus(
            enabled = enabled,
            pollInterval = interval,
            lastPollTime = lastPoll,
            currentPrice = price,
            currentPriceKwhEq = 0.0,
        )

    private fun setContent(
        state: UiState<GasPriceStatus>,
        polling: Boolean = false,
        onToggle: (Boolean) -> Unit = {},
        onIntervalChange: (String) -> Unit = {},
        onPollNow: () -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                GasPriceSettingsContent(
                    status = state,
                    prefs = prefs,
                    polling = polling,
                    onToggle = onToggle,
                    onIntervalChange = onIntervalChange,
                    onPollNow = onPollNow,
                    onRetry = onRetry,
                )
            }
        }
    }

    @Test
    fun loadingShowsHeaderAndAccessibleSkeletonNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        // The header (title) always renders so the panel is never blank.
        compose.onNodeWithText("Gas Price Auto-Poll").assertIsDisplayed()
        compose.onAllNodesWithContentDescription("Loading").onFirst().assertExists()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = { retried = true },
        )
        compose.onNodeWithText("Gas Price Auto-Poll").assertIsDisplayed()
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun runningContentRendersControlsLabelsAndMetricCards() {
        setContent(UiState(UiPhase.Content, status(enabled = true, price = 3.45, lastPoll = "2026-04-04T02:30:00Z")))
        // Header + subtitle.
        compose.onNodeWithText("Gas Price Auto-Poll").assertIsDisplayed()
        compose.onNodeWithText("Automatically fetch US average gas prices from EIA").assertIsDisplayed()
        // Auto-poll control in the running state + its field label.
        compose.onNodeWithText("Auto-Poll").assertIsDisplayed()
        compose.onNodeWithText("Running").assertIsDisplayed()
        // Interval field + metric cards + action + source attribution.
        compose.onNodeWithText("Poll Interval").assertIsDisplayed()
        compose.onNodeWithText("Current Price").assertIsDisplayed()
        compose.onNodeWithText("Last Polled").assertIsDisplayed()
        compose.onNodeWithText("Poll Now").assertIsDisplayed()
        compose.onNodeWithText("Source: U.S. Energy Information Administration").assertIsDisplayed()
        // Accessibility: the inline help affordances are announced with their field labels.
        compose.onAllNodesWithContentDescription("Auto-Poll").onFirst().assertExists()
        compose.onAllNodesWithContentDescription("Poll Interval").onFirst().assertExists()
    }

    @Test
    fun stoppedContentShowsStoppedPlaceholderPriceAndNever() {
        setContent(UiState(UiPhase.Content, status(enabled = false, price = 0.0, interval = "daily")))
        compose.onNodeWithText("Stopped").assertIsDisplayed()
        // No price yet → the "—" placeholder, and a never-polled feed → the "Never" label.
        compose.onNodeWithText("\u2014").assertIsDisplayed()
        compose.onNodeWithText("Never").assertIsDisplayed()
    }

    @Test
    fun toggleInvokesCallbackWithCurrentState() {
        var toggledFrom: Boolean? = null
        setContent(
            state = UiState(UiPhase.Content, status(enabled = true, price = 3.45)),
            onToggle = { toggledFrom = it },
        )
        compose.onNodeWithText("Running").performClick()
        assertTrue(toggledFrom == true)
    }

    @Test
    fun pollNowInvokesCallback() {
        var polled = false
        setContent(
            state = UiState(UiPhase.Content, status(enabled = true, price = 3.45)),
            onPollNow = { polled = true },
        )
        compose.onNodeWithText("Poll Now").performClick()
        assertTrue(polled)
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = status(enabled = true, price = 3.59, lastPoll = "2026-04-04T02:30:00Z"),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Running").assertIsDisplayed()
        compose.onAllNodesWithContentDescription("Offline").onFirst().assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = status(enabled = true, price = 3.45),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Running").assertIsDisplayed()
        assertTrue(refreshed)
    }

    @Test
    fun stableEntryBindsViewModelAndRendersPanel() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                val vm =
                    remember {
                        GasPriceSettingsViewModel(
                            source = FakeUiSource(),
                            logger = SilentLogger,
                            scope = null,
                        )
                    }
                GasPriceSettings(viewModel = vm)
            }
        }
        compose.onNodeWithText("Gas Price Auto-Poll").assertIsDisplayed()
        compose.onNodeWithText("Poll Now").assertIsDisplayed()
    }

    private object SilentLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    private class FakeUiSource : GasPriceSettingsSource {
        override fun gasPriceStatus(): Flow<Resource<GasPriceStatus>> =
            flowOf(
                Resource.Success(
                    GasPriceStatus(
                        enabled = true,
                        pollInterval = "7d",
                        lastPollTime = "2026-04-04T02:30:00Z",
                        currentPrice = 3.45,
                        currentPriceKwhEq = 0.0,
                    ),
                    1L,
                    false,
                ),
            )

        override fun settings(): Flow<Resource<JsonElement>> = flowOf(Resource.Loading(null, null, false))

        override suspend fun pollGasPrice(): Result<GasPricePollResult> = Result.success(GasPricePollResult(status = "ok"))

        override suspend fun toggleGasPrice(enabled: Boolean): Result<GasPriceToggleResult> =
            Result.success(GasPriceToggleResult(enabled = enabled))

        override suspend fun updateGasPriceConfig(pollInterval: String): Result<GasPriceConfigResult> =
            Result.success(GasPriceConfigResult(pollInterval = pollInterval))
    }
}
