package io.teslasync.android.featureviews.chargingdetailsection

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
 * Instrumented Compose UI + accessibility verification of [ChargingDetailSectionContent] across every
 * branch the web component renders (the four content panels, each content-or-empty) plus the lifecycle
 * chrome the host's feed implies (loading skeletons, a hard-error retry surface, and the stale/offline
 * freshness chip). Asserts the rendered titles/labels/values are exposed to TalkBack, that each panel's
 * empty message is announced, and that the retry affordance carries an accessible click action. Runs under
 * `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure projection. Mirrors the
 * web spec (web/src/features/analytics/components/analytics/ChargingDetailSection.tsx).
 */
class ChargingDetailSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        ChargingDetailSectionStrings(
            chargerBrands = "Charger Brands",
            sessions = "sessions",
            noBrands = "No charger brand data",
            monthlyTrend = "Monthly Charging Trend",
            energyKwh = "Energy (kWh)",
            avgPowerKw = "Avg Power (kW)",
            sessionsSeries = "Sessions",
            noMonthly = "No monthly data",
            costAnalysis = "Cost Analysis",
            minCost = "Min Cost",
            avgCost = "Avg Cost",
            medianCost = "Median Cost",
            maxCost = "Max Cost",
            noCostStats = "No cost statistics",
            costByType = "Cost by Charger Type",
            noCostByType = "No charger type data",
        )

    private val data =
        ChargingAnalyticsData(
            brands = listOf(ChargerBrand("Tesla Supercharger", 1_204), ChargerBrand("Home", 877)),
            chargerTypes = listOf(ChargerType("DC Fast", 612), ChargerType("Level 2", 1_388)),
            monthlyTrend =
                listOf(
                    MonthlyChargingPoint("Jan", energy = 412.0, avgPower = 48.0, sessions = 22),
                    MonthlyChargingPoint("Feb", energy = 388.0, avgPower = 51.0, sessions = 19),
                ),
            costStats = CostStats(min = 1.24, avg = 8.97, median = 7.5, max = 42.1),
        )

    private fun setContent(
        state: UiState<ChargingAnalyticsData>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    ChargingDetailSectionContent(
                        state = state,
                        onRetry = onRetry,
                        currency = ChargingCurrencyPrefs("$"),
                        locale = Locale.US,
                        strings = strings,
                    )
                }
            }
        }
    }

    @Test
    fun contentShowsAllFourPanelTitlesAndValues() {
        setContent(UiState(phase = UiPhase.Content, data = data))
        compose.onNodeWithText(strings.chargerBrands).assertIsDisplayed()
        compose.onNodeWithText(strings.monthlyTrend).assertExists()
        compose.onNodeWithText(strings.costAnalysis).assertExists()
        compose.onNodeWithText(strings.costByType).assertExists()
        // Brand row label + grouped session count word, a cost card value, and the charger-type share label.
        compose.onNodeWithText("#1 Tesla Supercharger").assertExists()
        compose.onNodeWithText("1,204 sessions").assertExists()
        compose.onNodeWithText("$1.24").assertExists()
        compose.onNodeWithText("612 (28%)").assertExists()
    }

    @Test
    fun loadingShowsNoPanelTitles() {
        setContent(UiState.loading())
        // The skeleton chrome carries no section titles.
        compose.onNodeWithText(strings.chargerBrands).assertDoesNotExist()
        compose.onNodeWithText(strings.costAnalysis).assertDoesNotExist()
    }

    @Test
    fun emptyShowsEveryPanelWithItsAccessibleEmptyMessage() {
        setContent(UiState(phase = UiPhase.Empty))
        // The web `data?.charging_analytics` undefined outcome: all four panels render, each empty.
        compose.onNodeWithText(strings.chargerBrands).assertExists()
        compose.onNodeWithText(strings.noBrands).assertExists()
        compose.onNodeWithText(strings.noMonthly).assertExists()
        compose.onNodeWithText(strings.noCostStats).assertExists()
        compose.onNodeWithText(strings.noCostByType).assertExists()
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
    fun offlineStaleStillShowsCachedContent() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = data,
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        // Stale/offline keeps the cached panels visible (never blanks) — the "last known" contract.
        compose.onNodeWithText(strings.chargerBrands).assertIsDisplayed()
        compose.onNodeWithText("#1 Tesla Supercharger").assertExists()
    }

    @Test
    fun staleContentAutoRefreshes() {
        var refreshed = false
        setContent(
            UiState(phase = UiPhase.Content, data = data, stale = true, fetchedAt = 1_700_000_000_000L),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        assertTrue(refreshed)
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.width(HOST_WIDTH).verticalScroll(rememberScrollState())) { content() }
    }

    private companion object {
        val HOST_WIDTH = 400.dp
    }
}
