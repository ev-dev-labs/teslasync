package io.teslasync.android.dashboard.widgets.chargingoptimizer

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [ChargingOptimizerWidgetContent] across every state
 * the web component renders (loading skeleton, empty, hard error + retry, standard metric body, compact
 * hero, wide 24h timeline, stale/offline cached). Asserts the rendered i18n strings and the TalkBack
 * content descriptions are present. Runs under `connectedAndroidTest` (a device/emulator) — the offline
 * gate's `testReleaseUnitTest` covers the logic; this covers the render.
 */
class ChargingOptimizerWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val fixedNow = 1_780_000_000_000L

    private fun fullReport(): ChargingOptimizerReport =
        ChargingOptimizerReport.fromJson(
            buildJsonObject {
                put(
                    "current_schedule",
                    buildJsonObject {
                        put("most_common_start_hour", 8)
                        put("avg_charge_to_pct", 80)
                    },
                )
                put(
                    "cost_analysis",
                    buildJsonObject {
                        put("potential_monthly_savings", 45)
                        put("sessions_during_peak_pct", 25)
                        put("peak_hours", hoursArray(17, 18))
                        put("offpeak_hours", hoursArray(2, 3))
                    },
                )
                put(
                    "recommendations",
                    buildJsonArray {
                        add(
                            buildJsonObject {
                                put("type", "schedule")
                                put("priority", "high")
                                put("title", "Shift to off-peak")
                                put("detail", "Save money overnight")
                            },
                        )
                    },
                )
            },
        )

    private fun hoursArray(vararg hours: Int): JsonArray = buildJsonArray { hours.forEach { add(it) } }

    private fun setContent(
        state: UiState<ChargingOptimizerReport>,
        size: ChargingOptimizerSize = ChargingOptimizerRegistration.defaultSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ChargingOptimizerWidgetContent(
                    state = state,
                    size = size,
                    onRefresh = onRefresh,
                )
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyShowsFriendlyMessage() {
        setContent(UiState(UiPhase.Empty, data = ChargingOptimizerReport.Empty, fetchedAt = fixedNow))
        compose.onNodeWithText("No optimizer data").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRefresh() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRefresh = { retried = true },
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun standardBodyShowsMetricsScheduleBadgeAndTip() {
        setContent(UiState(UiPhase.Content, data = fullReport(), fetchedAt = fixedNow))
        compose.onNodeWithContentDescription("Optimal start: 8 AM").assertIsDisplayed()
        compose.onNodeWithText("Peak charging: 25%").assertIsDisplayed()
        compose.onNodeWithText("Optimized").assertIsDisplayed()
        // Tip card folds its title/impact/detail into one TalkBack phrase.
        compose.onNodeWithContentDescription("Shift to off-peak", substring = true).assertIsDisplayed()
    }

    @Test
    fun compactHeroExposesFoldedAccessibleName() {
        setContent(
            state = UiState(UiPhase.Content, data = fullReport(), fetchedAt = fixedNow),
            size = ChargingOptimizerSize(cols = 1, rows = 2),
        )
        compose.onNodeWithContentDescription("Optimal start: 8 AM", substring = true).assertIsDisplayed()
    }

    @Test
    fun wideShowsRateTimelineAndPeakCell() {
        setContent(
            state = UiState(UiPhase.Content, data = fullReport(), fetchedAt = fixedNow),
            size = ChargingOptimizerSize(cols = 4, rows = 4),
        )
        compose.onNodeWithText("24h Rate Timeline").assertIsDisplayed()
        compose.onNodeWithContentDescription("5 PM \u2014 Peak").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = fullReport(),
                fetchedAt = fixedNow,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached metrics stay visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("Optimal start: 8 AM").assertIsDisplayed()
    }

    @Test
    fun contentHeaderExposesRefreshAction() {
        setContent(UiState(UiPhase.Content, data = fullReport(), fetchedAt = fixedNow))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }
}
