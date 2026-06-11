package io.teslasync.android.featureviews.ratelimitstatuspanel

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.system.RateLimitStatusResponse
import io.teslasync.shared.core.presentation.system.ScopeBudget
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.Instant
import java.util.Locale

/**
 * Instrumented Compose UI + accessibility verification of [RateLimitStatusPanelContent] across every
 * branch the web component renders (loading / error+retry / empty / content rows) plus the lifecycle
 * states the shared feed adds (offline "last known" + chip). Asserts the rendered strings, that the
 * header Refresh + the error Retry expose accessible click actions and invoke the callback, and that the
 * offline chip is announced. Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest`
 * covers the pure projection.
 */
class RateLimitStatusPanelUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val panelStrings =
        RateLimitStatusPanelStrings(
            title = "Rate-limit budgets",
            subtitle = "Live view of every server-side throttle.",
            refresh = "Refresh",
            loading = "Loading rate-limit status\u2026",
            empty = "No rate-limited resources observed.",
            lastUpdatedPattern = "Updated %1\$s",
        )

    private val rowStrings =
        RateLimitRowStrings(
            windowInstant = "Live snapshot",
            windowSecondsPattern = "Last %1\$ss window",
            usagePattern = "%1\$s / %2\$s",
            resetInPattern = "Refills in %1\$s",
            severityOk = "Healthy",
            severityWarn = "Warning",
            severityCritical = "Critical",
        )

    private val now = Instant.parse("2026-06-11T12:00:00Z").toEpochMilli()

    private val response =
        RateLimitStatusResponse(
            generatedAt = "2026-06-11T12:00:00Z",
            scopes =
                listOf(
                    ScopeBudget("tesla_fleet", "Tesla Fleet API", 820.0, 1000.0, 3600, null, "warn", "Shared across vehicles."),
                    ScopeBudget("command", "Vehicle commands", 12.0, 200.0, 0, "2026-06-11T12:05:00Z", "ok", ""),
                    ScopeBudget("telemetry", "Telemetry ingest", 49_500.0, 50_000.0, 60, null, "critical", "Near the cap."),
                ),
        )

    private fun setContent(
        state: UiState<RateLimitStatusResponse>,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    RateLimitStatusPanelContent(
                        state = state,
                        onRefresh = onRefresh,
                        locale = Locale.US,
                        nowMillis = now,
                        panelStrings = panelStrings,
                        rowStrings = rowStrings,
                    )
                }
            }
        }
    }

    @Test
    fun loadingShowsHeaderAndLoadingMessage() {
        setContent(UiState.loading())
        compose.onNodeWithText(panelStrings.title).assertIsDisplayed()
        compose.onNodeWithText(panelStrings.loading).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryWithAccessibleClickAction() {
        var retried = false
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRefresh = { retried = true })
        // ErrorDisplay resolves the real server-error copy + retry label from the catalog.
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsFriendlyMessage() {
        setContent(UiState(phase = UiPhase.Empty, data = RateLimitStatusResponse(), fetchedAt = now))
        compose.onNodeWithText(panelStrings.title).assertIsDisplayed()
        compose.onNodeWithText(panelStrings.empty).assertIsDisplayed()
    }

    @Test
    fun contentShowsRowsSeverityUsageAndWindows() {
        setContent(UiState(phase = UiPhase.Content, data = response, fetchedAt = now))
        compose.onNodeWithText("Tesla Fleet API").assertIsDisplayed()
        compose.onNodeWithText("Vehicle commands").assertIsDisplayed()
        compose.onNodeWithText("Telemetry ingest").assertIsDisplayed()
        // Severity labels (web SEVERITY_TONE_CLASS text).
        compose.onNodeWithText("Warning").assertIsDisplayed()
        compose.onNodeWithText("Healthy").assertIsDisplayed()
        compose.onNodeWithText("Critical").assertIsDisplayed()
        // Window labels: rolling vs instant snapshot.
        compose.onNodeWithText("Last 3600s window").assertIsDisplayed()
        compose.onNodeWithText("Live snapshot").assertIsDisplayed()
        // Locale-grouped usage (web fmtNumber, 2 fraction digits).
        compose.onNodeWithText("820.00 / 1,000.00").assertIsDisplayed()
        // Token-bucket reset countdown (12:05Z minus the fixed 12:00Z now).
        compose.onNodeWithText("Refills in 5m 0s").assertIsDisplayed()
        // Relative "updated" label (now == generated_at → just now).
        compose.onNodeWithText("Updated just now").assertIsDisplayed()
    }

    @Test
    fun contentRefreshButtonHasAccessibleClickActionAndRefetches() {
        var refreshed = false
        setContent(UiState(phase = UiPhase.Content, data = response, fetchedAt = now), onRefresh = { refreshed = true })
        compose.onNodeWithText(panelStrings.refresh).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(panelStrings.refresh).performClick()
        assertTrue(refreshed)
    }

    @Test
    fun offlineShowsCachedRowsAndOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = response,
                fetchedAt = now,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )
        // Cached "last known" value stays visible …
        compose.onNodeWithText("Tesla Fleet API").assertIsDisplayed()
        // … alongside the offline freshness chip (announced via its content description).
        compose.onNodeWithContentDescription("Offline").assertIsDisplayed()
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
