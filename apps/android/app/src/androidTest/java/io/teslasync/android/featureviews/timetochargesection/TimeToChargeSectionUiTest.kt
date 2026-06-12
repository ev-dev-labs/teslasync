package io.teslasync.android.featureviews.timetochargesection

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
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
 * Instrumented Compose UI + accessibility verification of [TimeToChargeSectionContent] across every branch
 * the web component renders (content: title + description + four metric cards with values, units, and
 * "Session #{{id}}" subtitles; the "—" empty fallback; loading skeletons), plus the lifecycle chrome the
 * host's feed implies (a hard error with an accessible retry, and the stale/offline freshness chip over
 * cached content). Asserts the rendered title/description/labels/values are exposed to TalkBack and that the
 * retry affordance carries an accessible click action driving the host's refetch. Runs under
 * `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure projection.
 */
class TimeToChargeSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        TimeToChargeSectionStrings(
            title = "Time-to-Charge Analysis",
            description = "How long DC sessions take to reach key SOC thresholds",
            avg10to80Label = "10% \u2192 80%",
            avg20to80Label = "20% \u2192 80%",
            avgDurationLabel = "Avg duration",
            fastestLabel = "Fastest Session",
            slowestLabel = "Slowest Session",
            sessionIdTemplate = "Session #%1\$s",
        )

    // Rates are exact in IEEE-754: dcS1 60, dcS2 90, dcS3 30 kWh/h → distinct two-decimal values.
    private val sessions =
        listOf(
            TimeToChargeSession(1, "Tesla", 150_000.0, 60_000.0, 8.0, 82.0, "2025-01-01T10:00:00Z", "2025-01-01T11:00:00Z"),
            TimeToChargeSession(2, "Tesla", 120_000.0, 45_000.0, 18.0, 84.0, "2025-02-01T10:00:00Z", "2025-02-01T10:30:00Z"),
            TimeToChargeSession(3, "ChargePoint", 50_000.0, 30_000.0, 5.0, 90.0, "2024-06-01T10:00:00Z", "2024-06-01T11:00:00Z"),
        )

    private fun setContent(
        state: UiState<List<TimeToChargeSession>>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    TimeToChargeSectionContent(
                        state = state,
                        onRetry = onRetry,
                        locale = Locale.US,
                        strings = strings,
                    )
                }
            }
        }
    }

    @Test
    fun contentShowsTitleDescriptionLabelsValuesAndSubtitles() {
        setContent(UiState(phase = UiPhase.Content, data = sessions))
        // Title, description, and every card label are rendered (TalkBack reads each) — accessibility coverage.
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText(strings.description).assertIsDisplayed()
        compose.onNodeWithText(strings.avg10to80Label).assertIsDisplayed()
        compose.onNodeWithText(strings.avg20to80Label).assertIsDisplayed()
        compose.onNodeWithText(strings.fastestLabel).assertIsDisplayed()
        compose.onNodeWithText(strings.slowestLabel).assertIsDisplayed()
        // Projected values (two decimals), the extreme-session subtitles, and the two unit symbols.
        compose.onNodeWithText("60.00").assertIsDisplayed()
        compose.onNodeWithText("50.00").assertIsDisplayed()
        compose.onNodeWithText("90.00").assertIsDisplayed()
        compose.onNodeWithText("30.00").assertIsDisplayed()
        compose.onNodeWithText("Session #2").assertIsDisplayed()
        compose.onNodeWithText("Session #3").assertIsDisplayed()
        compose.onAllNodesWithText("min").assertCountEquals(2)
        compose.onAllNodesWithText("kWh/h").assertCountEquals(2)
    }

    @Test
    fun emptyShowsDashFallbackAndKeepsLabels() {
        setContent(UiState(phase = UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        // The four cards keep their labels and render the "—" fallback — a friendly, never-blank empty state.
        compose.onNodeWithText(strings.avg10to80Label).assertIsDisplayed()
        compose.onNodeWithText(strings.fastestLabel).assertIsDisplayed()
        compose.onAllNodesWithText("\u2014").assertCountEquals(4)
    }

    @Test
    fun loadingShowsTitleButNoCardLabels() {
        setContent(UiState.loading())
        // The title chrome stays visible; the skeleton body carries no card labels.
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText(strings.avg10to80Label).assertDoesNotExist()
    }

    @Test
    fun errorShowsAccessibleRetryAndInvokesIt() {
        var retried = false
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        val retry = compose.onNodeWithText("Retry")
        retry.assertIsDisplayed().assertHasClickAction()
        retry.performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineStaleStillShowsCards() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = sessions,
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        // Stale/offline keeps the cached cards visible (never blanks) — the "last known" contract.
        compose.onNodeWithText(strings.avg10to80Label).assertIsDisplayed()
        compose.onNodeWithText("60.00").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 400.dp
        val HOST_HEIGHT = 900.dp
    }
}
