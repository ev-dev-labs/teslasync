package io.teslasync.android.featureviews.aiusagecard

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [AIUsageCardContent] across every state the surface
 * renders: the first-load em-dash placeholders + loading chip, the populated live figures + "{n} Helix calls
 * today." caption, the zero-usage empty surface (zeros + the friendly placeholder caption, never a blank box),
 * the hard-error em-dash surface + offline chip, and the offline "last known" cached figures + offline chip.
 * Also asserts the soft-stale auto-refresh and the accessibility labels (the heading, the loading state
 * description, the freshness content description). The :android:testReleaseUnitTest gate covers the pure logic;
 * this covers render + a11y. Locale.US fixes the numeric formatting so the string assertions are deterministic.
 * Mirrors the web spec (web/src/features/settings/components/AIUsageCard.tsx).
 */
class AIUsageCardUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val format = AiUsageFormatting(currencySymbol = "$", precision = 2, locale = Locale.US)

    private fun liveUsage(): AiUsageToday =
        AiUsageToday(callCount = 80.0, inputTokens = 134_795.0, outputTokens = 8_512.0, costMicroCents = 12_500_000.0)

    private fun setContent(
        state: UiState<AiUsageToday>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AIUsageCardContent(state = state, onRetry = onRetry, formatting = format)
            }
        }
    }

    @Test
    fun loadingShowsTitlePlaceholdersAndLoadingChipNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        // The title still renders (never a blank box) …
        compose.onNodeWithText("Usage today").assertIsDisplayed()
        // … the figures degrade to the em-dash placeholder (web layout-stable design) …
        assertTrue(compose.onAllNodesWithText(AI_USAGE_EM_DASH).fetchSemanticsNodes().isNotEmpty())
        // … and the freshness chip announces the in-flight fetch.
        compose.onNodeWithContentDescription("Loading...").assertExists()
    }

    @Test
    fun contentRendersLiveFiguresAndTheLiveCaption() {
        setContent(UiState(UiPhase.Content, data = liveUsage()))
        compose.onNodeWithText("Usage today").assertIsDisplayed()
        compose.onNodeWithText("134,795").assertExists()
        compose.onNodeWithText("8,512").assertExists()
        compose.onNodeWithText("$12.50").assertExists()
        compose.onNodeWithText("80 Helix calls today.").assertExists()
    }

    @Test
    fun emptyShowsZerosAndTheFriendlyPlaceholderCaption() {
        setContent(UiState(UiPhase.Empty, data = AiUsageToday.EMPTY))
        compose.onNodeWithText("Usage today").assertIsDisplayed()
        compose.onNodeWithText("$0.00").assertExists()
        compose.onNodeWithText("Usage populates as features run. Live numbers arrive in a follow-up update.").assertExists()
    }

    @Test
    fun errorWithNoCacheShowsPlaceholdersAndTheOfflineChip() {
        setContent(UiState(UiPhase.Error, errorKind = ErrorKind.Network))
        compose.onNodeWithText("Usage today").assertIsDisplayed()
        assertTrue(compose.onAllNodesWithText(AI_USAGE_EM_DASH).fetchSemanticsNodes().isNotEmpty())
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun offlineShowsCachedFiguresWithTheOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = liveUsage(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        // The cached "last known" figures stay visible (never blanked) …
        compose.onNodeWithText("134,795").assertExists()
        // … behind the honest offline chip.
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsTheCachedFigures() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = liveUsage(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("134,795").assertExists()
        assertTrue(refreshed)
    }

    @Test
    fun titleIsExposedAsAHeadingForTalkBack() {
        setContent(UiState(UiPhase.Content, data = liveUsage()))
        val headings =
            compose
                .onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading))
                .fetchSemanticsNodes()
        assertTrue(headings.isNotEmpty())
    }

    @Test
    fun loadingFiguresCarryALoadingStateDescriptionForTalkBack() {
        setContent(UiState(UiPhase.Loading))
        val loading =
            compose
                .onAllNodes(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Loading"))
                .fetchSemanticsNodes()
        assertTrue(loading.isNotEmpty())
    }
}
