package io.teslasync.android.dashboard.widgets.costbreakdown

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [CostBreakdownWidgetContent] across every state
 * the web component renders (loading skeleton, hard error + retry, standard donut + ranked list + stat
 * cards, compact monthly-total hero, no-data empty, stale/offline cached). Asserts the rendered i18n
 * strings and the TalkBack content descriptions are present. Runs under `connectedAndroidTest` (a
 * device/emulator) — the offline gate's `testReleaseUnitTest` covers the logic; this covers render + a11y.
 */
class CostBreakdownWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val prefs = CostBreakdownDisplayPrefs(DistanceUnitPref.KM, "$", 2)
    private val standardSize = CostBreakdownRegistration.defaultSize
    private val compactSize = CostBreakdownSize(cols = 1, rows = 4)

    private fun costJson(months: List<Pair<String, Double>>): JsonElement =
        buildJsonObject {
            put("total_charging_cost", 100.0)
            put("cost_per_km_ev", 0.05)
            put("total_savings", 40.0)
            put("monthly_savings", 5.0)
            put(
                "monthly_breakdown",
                buildJsonArray {
                    months.forEach { (label, cost) ->
                        add(
                            buildJsonObject {
                                put("month", label)
                                put("ev_cost", cost)
                            },
                        )
                    }
                },
            )
        }

    private fun emptyCostJson(): JsonElement = costJson(emptyList())

    private fun populatedCostJson(): JsonElement = costJson(listOf("2025-06" to 60.0, "2025-07" to 25.0))

    private fun setContent(
        state: UiState<JsonElement>,
        size: CostBreakdownSize = standardSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CostBreakdownWidgetContent(
                    state = state,
                    prefs = prefs,
                    size = size,
                    onRefresh = onRefresh,
                    locale = Locale.US,
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
    fun standardContentShowsStatCardsAndRankedRows() {
        setContent(UiState(UiPhase.Content, data = populatedCostJson(), fetchedAt = NOW))
        compose.onNodeWithText("Total Cost").assertIsDisplayed()
        compose.onNodeWithText("\$100.00").assertIsDisplayed()
        compose.onNodeWithText("Cost / km").assertIsDisplayed()
        // The ranked row folds rank + month + value into one TalkBack phrase (highest cost first).
        compose.onNodeWithContentDescription("1. 2025-06", substring = true).assertIsDisplayed()
    }

    @Test
    fun standardContentExposesRefreshAction() {
        setContent(UiState(UiPhase.Content, data = populatedCostJson(), fetchedAt = NOW))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun compactContentShowsMonthlyTotalHeroPhrase() {
        setContent(
            state = UiState(UiPhase.Content, data = populatedCostJson(), fetchedAt = NOW),
            size = compactSize,
        )
        // The hero folds the monthly total + savings subtitle + badge into one TalkBack phrase.
        compose.onNodeWithContentDescription("This Month", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoCostDataMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyCostJson(), fetchedAt = NOW))
        compose.onNodeWithText("No cost data").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = populatedCostJson(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached values stay visible (never blanked) when offline/stale.
        compose.onNodeWithText("\$100.00").assertIsDisplayed()
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
    }
}
