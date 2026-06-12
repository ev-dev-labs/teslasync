package io.teslasync.android.featureviews.aiusagecardstatus

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
 * On-device Compose UI + accessibility verification of [AiUsageCardContent] across every state the operator
 * AiUsageCard renders: the first-load loading skeleton + loading chip, the populated bands / details / top-lists,
 * the zero-usage empty surface (the friendly caption, never a blank box), the hard-error retryable surface, and
 * the offline "last known" cached figures + offline chip. Also asserts the soft-stale auto-refresh, the retry
 * affordance, and the accessibility labels (the freshness content description, the error-card content
 * description). The :app:testReleaseUnitTest gate covers the pure logic; this covers render + a11y. Locale.US is
 * irrelevant to the on-device default formatter, so the figure assertions use the en-US grouped strings the
 * surface produces under the device default. Mirrors the web spec
 * (web/src/features/system/components/status/AiUsageCard.tsx).
 */
class AiUsageCardStatusUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val format = AiUsageStatusFormatting(currencySymbol = "$", precision = 2, locale = Locale.US)

    private fun today(): AiUsageToday =
        AiUsageToday(
            callCount = 312.0,
            inputTokens = 134_795.0,
            outputTokens = 48_512.0,
            costMicroCents = 12_500_000.0,
            errorCount = 4.0,
            avgLatencyMs = 287.0,
        )

    private fun features(): List<AiUsageFeatureRow> =
        listOf(
            AiUsageFeatureRow(featureId = "chatbot", callCount = 180.0),
            AiUsageFeatureRow(featureId = "route_summary", callCount = 92.0),
        )

    private fun recent(): List<AiUsageRecentRow> =
        listOf(
            AiUsageRecentRow(
                id = 1,
                featureId = "chatbot",
                model = "gpt-4o-mini",
                inputTokens = 50.0,
                outputTokens = 80.0,
                startedAt = "2025-01-01T00:00:00Z",
                isError = false,
            ),
        )

    private fun setContent(
        today: UiState<AiUsageToday>,
        byFeature: UiState<List<AiUsageFeatureRow>> = UiState(UiPhase.Empty, data = emptyList()),
        recent: UiState<List<AiUsageRecentRow>> = UiState(UiPhase.Empty, data = emptyList()),
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AiUsageCardContent(today = today, byFeature = byFeature, recent = recent, onRetry = onRetry, formatting = format)
            }
        }
    }

    @Test
    fun loadingShowsTheLoadingCaptionNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Loading Helix usage\u2026").assertIsDisplayed()
    }

    @Test
    fun contentRendersTheBandsDetailsAndTopLists() {
        setContent(
            today = UiState(UiPhase.Content, data = today()),
            byFeature = UiState(UiPhase.Content, data = features()),
            recent = UiState(UiPhase.Content, data = recent()),
        )
        compose.onNodeWithText("Today").assertExists()
        compose.onNodeWithText("Tokens").assertExists()
        compose.onNodeWithText("Cost / latency").assertExists()
        compose.onNodeWithText("312 calls").assertExists()
        compose.onNodeWithText("$12.50").assertExists()
        compose.onNodeWithText("By feature (7 days)").assertExists()
        compose.onNodeWithText("Recent calls").assertExists()
        compose.onNodeWithText("chatbot").assertExists()
    }

    @Test
    fun emptyShowsTheFriendlyCaptionInsteadOfFigures() {
        setContent(UiState(UiPhase.Empty, data = AiUsageToday.EMPTY))
        compose.onNodeWithText("No Helix calls yet \u2014 turn on a feature to start.").assertIsDisplayed()
    }

    @Test
    fun hardErrorShowsTheRetryableErrorSurface() {
        setContent(UiState(UiPhase.Error, errorKind = ErrorKind.Network))
        compose.onNodeWithText("Couldn\u2019t load AI usage").assertIsDisplayed()
        compose.onNodeWithText("Retry").assertExists()
    }

    @Test
    fun offlineShowsCachedFiguresWithTheOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = today(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
            byFeature = UiState(UiPhase.Content, data = features()),
            recent = UiState(UiPhase.Content, data = recent()),
        )
        // The cached "last known" figures stay visible (never blanked) …
        compose.onNodeWithText("312 calls").assertExists()
        // … behind the honest offline chip.
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsTheCachedFigures() {
        var refreshed = false
        setContent(
            today =
                UiState(
                    phase = UiPhase.Content,
                    data = today(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("312 calls").assertExists()
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
        compose.onNodeWithContentDescription("Couldn\u2019t load AI usage").assertExists()
    }
}
