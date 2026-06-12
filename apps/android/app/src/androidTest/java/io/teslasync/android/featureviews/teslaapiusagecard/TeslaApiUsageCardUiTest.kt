package io.teslasync.android.featureviews.teslaapiusagecard

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
import java.time.ZoneId
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [TeslaApiUsageCardContent] across every state the
 * operator TeslaApiUsageCard renders: the first-load placeholder + loading chip, the populated budget bar /
 * bands / details / top-lists / over-budget banner / footer links, the no-snapshot placeholder (never a blank
 * box), the hard-error retryable surface, and the offline "last known" cached figures + offline chip. Also
 * asserts the soft-stale auto-refresh, the retry affordance, and the accessibility labels (the budget-bar
 * content description, the freshness chip, the error-card content description). The :android:testReleaseUnitTest
 * gate covers the pure logic; this covers render + a11y. A fixed UTC instant + `Locale.US` formatting pin the
 * countdown + grouping so the figure assertions are deterministic. Mirrors the web spec
 * (web/src/features/system/components/status/TeslaApiUsageCard.tsx).
 */
class TeslaApiUsageCardUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val format = TeslaApiUsageFormatting(currencySymbol = "$", precision = 2, locale = Locale.US)

    private fun usage(): TeslaApiUsage =
        TeslaApiUsage(
            totalRequests = 39_436.0,
            skippedPolls = 0.0,
            estimatedCost = 87.55,
            costPerRequest = 0.00222,
            monthlyCredit = 10.0,
            estimatedRemaining = 0.0,
        )

    private fun logStats(): TeslaApiLogStats =
        TeslaApiLogStats(
            last24h = 2_800.0,
            errorRate = 1.2,
            errorCount = 470.0,
            avgDurationMs = 184.0,
            byMethod = linkedMapOf("GET" to 30_000.0, "POST" to 9_436.0),
            byService = linkedMapOf("tesla_fleet" to 28_000.0, "tesla_streaming" to 11_000.0),
        )

    private fun setContent(
        apiUsage: UiState<TeslaApiUsage>,
        logStats: UiState<TeslaApiLogStats> = UiState(UiPhase.Empty, data = TeslaApiLogStats.EMPTY),
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                TeslaApiUsageCardContent(
                    apiUsage = apiUsage,
                    logStats = logStats,
                    onRetry = onRetry,
                    now = NOW,
                    zone = ZONE,
                    formatting = format,
                )
            }
        }
    }

    @Test
    fun loadingShowsThePlaceholderNotABlankPanel() {
        setContent(UiState(UiPhase.Loading), logStats = UiState(UiPhase.Loading))
        compose.onNodeWithText("Tesla API usage data is not available yet.").assertIsDisplayed()
    }

    @Test
    fun contentRendersTheBudgetBandsDetailsAndTopLists() {
        setContent(
            apiUsage = UiState(UiPhase.Content, data = usage()),
            logStats = UiState(UiPhase.Content, data = logStats()),
        )
        compose.onNodeWithText("$87.55 of $10.00").assertExists()
        compose.onNodeWithText("875% of monthly credit").assertExists()
        compose.onNodeWithText("Day 15 of 31", substring = true).assertExists()
        compose.onNodeWithText("resets in 16 days", substring = true).assertExists()
        compose.onNodeWithText("This month").assertExists()
        compose.onNodeWithText("39,436 requests").assertExists()
        compose.onNodeWithText("Forecast EOM").assertExists()
        compose.onNodeWithText("Top services").assertExists()
        compose.onNodeWithText("tesla_fleet").assertExists()
        compose.onNodeWithText("By method").assertExists()
        compose.onNodeWithText("GET").assertExists()
        // The over-budget banner shows because 87.55 > 10.
        compose.onNodeWithText("Over monthly credit").assertExists()
        // Both footer links render.
        compose.onNodeWithText("Open API Logs").assertExists()
        compose.onNodeWithText("Tesla account").assertExists()
    }

    @Test
    fun contentExposesTheBudgetBarAccessibilityLabel() {
        setContent(
            apiUsage = UiState(UiPhase.Content, data = usage()),
            logStats = UiState(UiPhase.Content, data = logStats()),
        )
        compose.onNodeWithContentDescription("Tesla API budget used").assertExists()
    }

    @Test
    fun emptyShowsThePlaceholderInsteadOfFigures() {
        setContent(UiState(UiPhase.Empty))
        compose.onNodeWithText("Tesla API usage data is not available yet.").assertIsDisplayed()
    }

    @Test
    fun hardErrorShowsTheRetryableErrorSurface() {
        setContent(UiState(UiPhase.Error, errorKind = ErrorKind.Network))
        compose.onNodeWithText("Couldn\u2019t load Tesla API usage").assertIsDisplayed()
        compose.onNodeWithText("Retry").assertExists()
    }

    @Test
    fun offlineShowsCachedFiguresWithTheOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = usage(),
                stale = true,
                fetchedAt = NOW,
                errorKind = ErrorKind.Network,
            ),
            logStats = UiState(UiPhase.Content, data = logStats()),
        )
        // The cached "last known" figures stay visible (never blanked) …
        compose.onNodeWithText("$87.55 of $10.00").assertExists()
        // … behind the honest offline chip.
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsTheCachedFigures() {
        var refreshed = false
        setContent(
            apiUsage =
                UiState(
                    phase = UiPhase.Content,
                    data = usage(),
                    stale = true,
                    fetchedAt = NOW,
                ),
            logStats = UiState(UiPhase.Content, data = logStats()),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("$87.55 of $10.00").assertExists()
        assertTrue(refreshed)
    }

    @Test
    fun errorRetryButtonInvokesTheRetryCallback() {
        var retried = false
        setContent(UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun errorSurfaceExposesAnAccessibilityLabelForTalkBack() {
        setContent(UiState(UiPhase.Error, errorKind = ErrorKind.Network))
        compose.onNodeWithContentDescription("Couldn\u2019t load Tesla API usage").assertExists()
    }

    private companion object {
        const val NOW: Long = 1_736_942_400_000L // 2025-01-15T12:00:00Z
        val ZONE: ZoneId = ZoneId.of("UTC")
    }
}
