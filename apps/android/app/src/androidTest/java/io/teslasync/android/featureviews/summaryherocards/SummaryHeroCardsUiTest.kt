package io.teslasync.android.featureviews.summaryherocards

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
 * Instrumented Compose UI + accessibility verification of [SummaryHeroCardsContent] across every state the
 * surface renders — the resolved HighlightCard grid (with/without the Fun Fact card), the loading skeleton
 * grid, the friendly empty state, the hard error with an accessible retry, and the stale/offline "last known"
 * cached content. Asserts the rendered labels, values, and trend badges are exposed to TalkBack (every card
 * label + value is present in the semantics tree), the empty message is announced, and the retry affordance
 * carries an accessible click action that drives the host's refetch. Runs under `connectedAndroidTest`; the
 * offline gate's `testReleaseUnitTest` covers the pure projection.
 */
class SummaryHeroCardsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val prefs = SummaryHeroDisplayPrefs(currencySymbol = "$", precision = 2, locale = Locale.US)

    private val strings =
        SummaryHeroStrings(
            totalDistance = "Total Distance",
            totalDrives = "Total Drives",
            energyUsed = "Energy Used",
            chargingCost = "Charging Cost",
            co2Saved = "CO\u2082 Saved",
            funFact = "Fun Fact",
        )

    private val metrics =
        WeekSummaryMetrics(
            totalDistance = 312.6,
            prevDistance = 280.0,
            totalDrives = 14.0,
            prevDriveCount = 11.0,
            energyUsed = 78.4,
            prevEnergy = 70.0,
            chargingCost = 24.18,
            prevChargingCost = 30.0,
            co2Saved = 41.2,
            prevCo2 = 38.0,
        )

    private val funFact = FunFactSummary(from = "San Francisco", to = "Los Angeles", times = "0.8")

    private fun setContent(
        state: UiState<WeekSummarySnapshot>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    SummaryHeroCardsContent(state = state, onRetry = onRetry, prefs = prefs, strings = strings)
                }
            }
        }
    }

    @Test
    fun contentShowsLabelsValuesAndTrends() {
        setContent(UiState(phase = UiPhase.Content, data = WeekSummarySnapshot(metrics, funFact)))
        // The top card and panel title are on-screen; assert they render.
        compose.onNodeWithText(strings.totalDistance).assertIsDisplayed()
        compose.onNodeWithText("312.6 km").assertIsDisplayed()
        // Every other card label + value is present in the semantics tree (TalkBack reads each) — a11y coverage.
        compose.onNodeWithText(strings.totalDrives).assertExists()
        compose.onNodeWithText("14").assertExists()
        compose.onNodeWithText(strings.energyUsed).assertExists()
        compose.onNodeWithText("78.4 kWh").assertExists()
        compose.onNodeWithText(strings.chargingCost).assertExists()
        compose.onNodeWithText("$24.18").assertExists()
        compose.onNodeWithText(strings.co2Saved).assertExists()
        compose.onNodeWithText("41.2 kg").assertExists()
        // Trend badges (the web `trendFor` values) are rendered.
        compose.onNodeWithText("+11.6%").assertExists()
        compose.onNodeWithText("-19.4%").assertExists()
    }

    @Test
    fun contentShowsOptionalFunFactCard() {
        setContent(UiState(phase = UiPhase.Content, data = WeekSummarySnapshot(metrics, funFact)))
        compose.onNodeWithText(strings.funFact).assertExists()
        compose.onNodeWithText("0.8\u00D7").assertExists()
        compose.onNodeWithText("\u2248 0.8\u00D7 San Francisco \u2192 Los Angeles").assertExists()
    }

    @Test
    fun contentOmitsFunFactWhenAbsent() {
        setContent(UiState(phase = UiPhase.Content, data = WeekSummarySnapshot(metrics, funFact = null)))
        compose.onNodeWithText(strings.totalDistance).assertExists()
        compose.onNodeWithText(strings.funFact).assertDoesNotExist()
    }

    @Test
    fun loadingShowsNoCardLabels() {
        setContent(UiState.loading())
        // The skeleton grid carries no metric labels.
        compose.onNodeWithText(strings.totalDistance).assertDoesNotExist()
        compose.onNodeWithText(strings.funFact).assertDoesNotExist()
    }

    @Test
    fun emptyShowsAccessibleNoDataMessage() {
        setContent(UiState(phase = UiPhase.Empty))
        // The weekly-digest "No Data" message is rendered and exposed to TalkBack.
        compose.onNodeWithText("No Data").assertIsDisplayed()
        compose.onNodeWithText(strings.totalDistance).assertDoesNotExist()
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
    fun offlineStaleStillShowsContent() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = WeekSummarySnapshot(metrics, funFact),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        // Stale/offline keeps the cached cards visible (never blanks) — the "last known" contract.
        compose.onNodeWithText(strings.totalDistance).assertIsDisplayed()
        compose.onNodeWithText("312.6 km").assertExists()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 400.dp
        val HOST_HEIGHT = 1600.dp
    }
}
