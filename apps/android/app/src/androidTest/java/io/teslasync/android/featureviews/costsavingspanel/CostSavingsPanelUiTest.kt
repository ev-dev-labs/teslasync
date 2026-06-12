package io.teslasync.android.featureviews.costsavingspanel

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
import io.teslasync.shared.core.units.DistanceUnitPref
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * Instrumented Compose UI + accessibility verification of [CostSavingsPanelContent] across every state the
 * surface renders — the resolved up-to-five cost-tile grid (with and without the gasoline trio), the loading
 * skeleton, the friendly empty state, the hard error with an accessible retry, and the stale/offline "last
 * known" cached content. Asserts the rendered labels, values, and subtitles are exposed to TalkBack (each
 * tile's text is present and each tile carries a merged content description), the empty message is announced,
 * and the retry affordance carries an accessible click action that drives the host's refetch. Runs under
 * `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure projection.
 */
class CostSavingsPanelUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val prefs =
        CostSavingsDisplayPrefs(
            currencySymbol = "$",
            precision = 2,
            locale = Locale.US,
            costPerKwh = 0.12,
            gasEfficiencyMpg = 25.0,
            gasPricePerUnit = 4.0,
            gasUnitIsLiter = false,
            distancePref = DistanceUnitPref.MI,
        )

    private val strings =
        CostSavingsStrings(
            title = "Cost & Savings",
            tripCost = "Trip Cost",
            atRateTemplate = "at %1\$s%2\$s/kWh",
            costPerUnitTemplate = "Cost / %1\$s",
            gasCostEquiv = "Gas Cost (equiv)",
            atMpgTemplate = "at %1\$s MPG",
            gasSavings = "vs Gas Savings",
            savingsPct = "Savings %",
        )

    private val snapshot =
        CostSavingsSnapshot(
            drive = DriveCostInputs(distanceM = 32_186.88),
            stats = DriveCostStats(energyWh = 6_000.0),
        )

    private fun setContent(
        state: UiState<CostSavingsSnapshot>,
        prefs: CostSavingsDisplayPrefs = this.prefs,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    CostSavingsPanelContent(state = state, onRetry = onRetry, prefs = prefs, strings = strings)
                }
            }
        }
    }

    @Test
    fun contentShowsAllFiveTilesValuesAndSubtitles() {
        setContent(UiState(phase = UiPhase.Content, data = snapshot))
        // The panel header is on-screen.
        compose.onNodeWithText("Cost & Savings").assertIsDisplayed()
        // Every tile's label, formatted value, and subtitle is present in the (unmerged) semantics tree.
        val expectedTexts =
            listOf(
                "Trip Cost",
                "$0.72",
                "at $0.12/kWh",
                "Cost / mi",
                "$0.036",
                "Gas Cost (equiv)",
                "$3.20",
                "at 25 MPG",
                "vs Gas Savings",
                "$2.48",
                "Savings %",
                "78%",
            )
        for (text in expectedTexts) {
            compose.onNodeWithText(text, useUnmergedTree = true).assertExists()
        }
    }

    @Test
    fun eachTileExposesMergedAccessibilityLabel() {
        setContent(UiState(phase = UiPhase.Content, data = snapshot))
        // The tiles merge their text into one focusable node so TalkBack reads "label: value[, detail]" as a unit.
        compose.onNodeWithContentDescription("Trip Cost: $0.72, at $0.12/kWh").assertExists()
        compose.onNodeWithContentDescription("Gas Cost (equiv): $3.20, at 25 MPG").assertExists()
        compose.onNodeWithContentDescription("Savings %: 78%").assertExists()
    }

    @Test
    fun tripCostOnlyWhenNoGasPriceConfigured() {
        setContent(UiState(phase = UiPhase.Content, data = snapshot), prefs = prefs.copy(gasPricePerUnit = 0.0))
        compose.onNodeWithText("Trip Cost", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("Cost / mi", useUnmergedTree = true).assertExists()
        // The gasoline trio is gated out when there is no gas price (web `savings > 0`).
        compose.onNodeWithText("Gas Cost (equiv)", useUnmergedTree = true).assertDoesNotExist()
        compose.onNodeWithText("vs Gas Savings", useUnmergedTree = true).assertDoesNotExist()
    }

    @Test
    fun loadingShowsSkeletonAndNoTileLabels() {
        setContent(UiState.loading())
        // The skeleton grid announces "Loading" and carries no metric labels.
        compose.onNodeWithContentDescription("Loading").assertExists()
        compose.onNodeWithText("Trip Cost", useUnmergedTree = true).assertDoesNotExist()
    }

    @Test
    fun emptyShowsAccessibleNoDataMessage() {
        setContent(UiState(phase = UiPhase.Empty))
        // The "no data" message is rendered and exposed to TalkBack; the panel header stays visible.
        compose.onNodeWithText("No data available").assertIsDisplayed()
        compose.onNodeWithText("Cost & Savings").assertExists()
        compose.onNodeWithText("Trip Cost", useUnmergedTree = true).assertDoesNotExist()
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
                data = snapshot,
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        // Stale/offline keeps the cached tiles visible (never blanks) — the "last known" contract.
        compose.onNodeWithText("Trip Cost", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("$0.72", useUnmergedTree = true).assertExists()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 1200.dp
    }
}
