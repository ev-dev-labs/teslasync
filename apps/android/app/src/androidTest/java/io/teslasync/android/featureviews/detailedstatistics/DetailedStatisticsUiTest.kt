package io.teslasync.android.featureviews.detailedstatistics

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
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * Instrumented Compose UI + accessibility verification of [DetailedStatisticsContent] across every branch
 * the web component renders (loading skeleton grid / content six-cell grid / empty), plus the lifecycle
 * chrome the host's feed implies (a hard error with an accessible retry, and the stale/offline cached
 * surface). Asserts the rendered title, captions, and formatted values, that the empty message is exposed to
 * TalkBack, and that the retry affordance carries an accessible click action. Runs under
 * `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure projection.
 */
class DetailedStatisticsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        DetailedStatisticsStrings(
            title = "Detailed Statistics",
            totalSessions = "Total Sessions",
            avgDuration = "Avg Duration",
            avgPower = "Avg Power",
            topCharger = "Top Charger",
            totalCost = "Total Cost",
            avgCostPerKwh = "Avg \$/kWh",
            noData = "No data available",
        )

    private val snapshot =
        DetailedStatisticsSnapshot(
            stats = DetailedChargingStats(count = 1234, avgPower = 48.5, totalCost = 312.4, avgCostPerKwh = 0.182),
            enhanced = DetailedEnhancedStats(avgDurationMinutes = 125.0, topChargerName = "Supercharger", topChargerCount = 87),
        )

    private fun setContent(
        state: UiState<DetailedStatisticsSnapshot>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    DetailedStatisticsContent(
                        state = state,
                        onRetry = onRetry,
                        currency = DetailedStatisticsCurrencyPrefs("$"),
                        locale = Locale.US,
                        strings = strings,
                    )
                }
            }
        }
    }

    @Test
    fun contentShowsTitleCaptionsAndValues() {
        setContent(UiState(phase = UiPhase.Content, data = snapshot))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        // Every caption is rendered (TalkBack reads each cell's label) — accessibility coverage.
        compose.onNodeWithText(strings.totalSessions).assertIsDisplayed()
        compose.onNodeWithText(strings.avgPower).assertIsDisplayed()
        compose.onNodeWithText(strings.totalCost).assertIsDisplayed()
        compose.onNodeWithText(strings.avgCostPerKwh).assertIsDisplayed()
        // The top-charger caption carries the bare occurrence count (web `(${count}×)`).
        compose.onNodeWithText("Top Charger (87\u00D7)").assertIsDisplayed()
        // Formatted values: the animated count, the duration, the kW power, and both currency cells.
        compose.onNodeWithText("1,234").assertIsDisplayed()
        compose.onNodeWithText("2h 5m").assertIsDisplayed()
        compose.onNodeWithText("48.50 kW").assertIsDisplayed()
        compose.onNodeWithText("$312.40").assertIsDisplayed()
        compose.onNodeWithText("$0.182").assertIsDisplayed()
        compose.onNodeWithText("Supercharger").assertIsDisplayed()
    }

    @Test
    fun loadingShowsTitleAndNoCaptions() {
        setContent(UiState.loading())
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        // The skeleton grid carries no captions.
        compose.onNodeWithText(strings.totalSessions).assertDoesNotExist()
    }

    @Test
    fun emptyShowsAccessibleNoDataMessage() {
        setContent(UiState(phase = UiPhase.Empty))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText(strings.noData).assertIsDisplayed()
    }

    @Test
    fun errorShowsAccessibleRetryAndInvokesIt() {
        var retried = false
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText(strings.title).assertIsDisplayed()
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
        // Stale/offline keeps the cached cells visible (never blanks) — the "last known" contract.
        compose.onNodeWithText(strings.totalCost).assertIsDisplayed()
        compose.onNodeWithText("$312.40").assertIsDisplayed()
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
