package io.teslasync.android.featureviews.chargingsection

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
 * Instrumented Compose UI + accessibility verification of [ChargingSectionContent] across every branch the
 * web component renders (title, daily-energy bar chart, four-tile stat row, week-over-week badge) plus the
 * lifecycle chrome the host's feed implies (loading skeletons, a hard-error retry surface, and the
 * stale/offline freshness chip). Asserts the rendered titles/labels/values are exposed to TalkBack, that the
 * empty state never blanks, and that the retry affordance carries an accessible click action. Runs under
 * `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure projection. Mirrors the
 * web spec (web/src/features/analytics/components/weekly-digest/ChargingSection.tsx).
 */
class ChargingSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        ChargingSectionStrings(
            title = "Charging",
            dailyEnergyAdded = "Daily Energy Added (kWh)",
            energyAdded = "Energy Added",
            sessions = "Sessions",
            totalEnergyAdded = "Total Energy Added",
            avgChargeRate = "Avg Charge Rate",
            totalCost = "Total Cost",
            energyVsLastWeek = "Energy vs. Last Week",
            noData = "No Data",
        )

    private val data =
        ChargingDigestData(
            metrics =
                ChargingDigestMetrics(
                    chargeEnergyAdded = 312.4,
                    prevChargeEnergy = 280.0,
                    avgChargeRate = 48.6,
                    chargingCost = 41.27,
                    chargingSessionCount = 12,
                ),
            dailyEnergy =
                listOf(
                    DailyEnergyPoint("Mon", 42.0),
                    DailyEnergyPoint("Tue", 0.0),
                    DailyEnergyPoint("Wed", 61.5),
                ),
        )

    private fun setContent(
        state: UiState<ChargingDigestData>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    ChargingSectionContent(
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
    fun contentShowsTitleChartStatsAndBadge() {
        setContent(UiState(phase = UiPhase.Content, data = data))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText(strings.dailyEnergyAdded).assertExists()
        // The four stat labels and a representative value from each region.
        compose.onNodeWithText(strings.sessions).assertExists()
        compose.onNodeWithText(strings.totalEnergyAdded).assertExists()
        compose.onNodeWithText(strings.avgChargeRate).assertExists()
        compose.onNodeWithText(strings.totalCost).assertExists()
        compose.onNodeWithText("12").assertExists()
        compose.onNodeWithText("312.4 kWh").assertExists()
        compose.onNodeWithText("48.6 kW").assertExists()
        compose.onNodeWithText("$41.27").assertExists()
        // Week-over-week badge: (312.4 - 280) / 280 * 100 → "11.6%".
        compose.onNodeWithText(strings.energyVsLastWeek).assertExists()
        compose.onNodeWithText("11.6%").assertExists()
    }

    @Test
    fun loadingShowsNoTitle() {
        setContent(UiState.loading())
        // The skeleton chrome carries no section title or labels.
        compose.onNodeWithText(strings.title).assertDoesNotExist()
        compose.onNodeWithText(strings.energyVsLastWeek).assertDoesNotExist()
    }

    @Test
    fun emptyStillRendersTitleZeroStatsAndAnEmptyChartMessage() {
        setContent(UiState(phase = UiPhase.Empty))
        // The empty-week outcome: the panel still renders, never a blank box.
        compose.onNodeWithText(strings.title).assertExists()
        compose.onNodeWithText(strings.noData).assertExists()
        compose.onNodeWithText(strings.energyVsLastWeek).assertExists()
        // Zeroed stats and the "—" delta keep every region populated.
        compose.onNodeWithText("0.0 kWh").assertExists()
        compose.onNodeWithText("$0.00").assertExists()
        compose.onNodeWithText("\u2014").assertExists()
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
        // Stale/offline keeps the cached panel visible (never blanks) — the "last known" contract.
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText("312.4 kWh").assertExists()
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
