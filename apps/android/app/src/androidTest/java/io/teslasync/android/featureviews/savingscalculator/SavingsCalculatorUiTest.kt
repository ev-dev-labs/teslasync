package io.teslasync.android.featureviews.savingscalculator

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [SavingsCalculatorContent] across every state the
 * surface renders: the loading chrome (title + always-present assumption inputs, never a blank panel), the
 * hard-error retry surface, the friendly "not enough data" empty state, the populated comparison cards, the
 * interactive "Reset Defaults" behaviour, and the stale/offline cached view with its freshness chip. Asserts
 * the rendered i18n strings, the per-card TalkBack content descriptions, the field labels, the retry
 * affordance, and the offline chip's TalkBack label. The pure logic is covered by the off-device unit gate;
 * this covers render + a11y. Mirrors the web spec
 * (web/src/features/charging/components/cost-analysis/SavingsCalculator.tsx).
 */
class SavingsCalculatorUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        SavingsCalculatorStrings(
            title = "Gas vs Electric Savings Calculator",
            inputsTitle = "Your Assumptions",
            gasPriceLabel = "Gas Price (\$/gal)",
            mpgLabel = "Gas Car MPG",
            electricityRateLabel = "Electricity Rate (\$/kWh)",
            resetLabel = "Reset Defaults",
            comparisonTitle = "Comparison",
            gasCostLabel = "Gas Cost (equivalent)",
            evCostLabel = "EV Cost (actual)",
            totalSavingsLabel = "Total Savings",
            overPeriodLabel = "over selected period",
            monthlySavingsLabel = "Monthly Savings",
            perYearLabel = "/ year",
            noDataLabel = "Not enough data for comparison",
        )

    private val baseStats =
        SavingsBaseStats(totalEnergyKwh = 300.0, totalCost = 50.0, totalDistanceDisplay = 900.0, monthCount = 5)

    private val serverErrorMessage = "Something went wrong on our end. Please try again."

    private fun setContent(
        state: UiState<SavingsBaseStats>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SavingsCalculatorContent(
                    state = state,
                    onRetry = onRetry,
                    distanceUnit = "mi",
                    locale = Locale.US,
                    strings = strings,
                )
            }
        }
    }

    @Test
    fun loadingShowsTitleAndAssumptionsNotBlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText(strings.inputsTitle).assertIsDisplayed()
        compose.onNodeWithText(strings.comparisonTitle).assertIsDisplayed()
        compose.onNodeWithText(strings.resetLabel).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText(serverErrorMessage).assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsNoDataMessageAndKeepsAssumptions() {
        setContent(UiState(UiPhase.Empty, data = null))
        compose.onNodeWithText(strings.noDataLabel).assertIsDisplayed()
        compose.onNodeWithText(strings.inputsTitle).assertIsDisplayed()
        compose.onNodeWithText(strings.resetLabel).assertIsDisplayed()
    }

    @Test
    fun contentRendersAllFourComparisonCards() {
        setContent(UiState(UiPhase.Content, data = baseStats))
        compose.onNodeWithText(strings.comparisonTitle).assertIsDisplayed()
        compose.onNodeWithContentDescription(strings.gasCostLabel, substring = true).assertExists()
        compose.onNodeWithContentDescription(strings.evCostLabel, substring = true).assertExists()
        compose.onNodeWithContentDescription(strings.totalSavingsLabel, substring = true).assertExists()
        compose.onNodeWithContentDescription(strings.monthlySavingsLabel, substring = true).assertExists()
    }

    @Test
    fun resetRestoresDefaultGasPriceAfterEditing() {
        setContent(UiState(UiPhase.Content, data = baseStats))
        compose.onNodeWithTag(TAG_GAS_PRICE).performTextReplacement("7")
        compose.onNodeWithTag(TAG_GAS_PRICE).assertTextContains("7")
        compose.onNodeWithText(strings.resetLabel).performClick()
        compose.onNodeWithTag(TAG_GAS_PRICE).assertTextContains("3.5")
    }

    @Test
    fun assumptionInputsExposeAccessibleLabels() {
        setContent(UiState(UiPhase.Content, data = baseStats))
        compose.onNodeWithText(strings.gasPriceLabel).assertExists()
        compose.onNodeWithText(strings.mpgLabel).assertExists()
        compose.onNodeWithText(strings.electricityRateLabel).assertExists()
    }

    @Test
    fun offlineShowsCachedCardsWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = baseStats,
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithContentDescription(strings.totalSavingsLabel, substring = true).assertExists()
        compose.onAllNodesWithContentDescription("Offline").onFirst().assertExists()
    }
}
