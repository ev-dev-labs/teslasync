package io.teslasync.android.dashboard.widgets.costforecast

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
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
 * On-device Compose UI + accessibility verification of [CostForecastWidgetContent] across every state the
 * web component renders (loading skeleton, hard error + retry, standard stat row + bar chart, compact
 * stat-only, no-data empty, stale/offline cached). Asserts the rendered i18n strings and the TalkBack
 * content descriptions are present. Runs under `connectedAndroidTest` (a device/emulator) — the offline
 * gate's `testReleaseUnitTest` covers the logic; this covers render + a11y.
 */
class CostForecastWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val prefs = CostForecastDisplayPrefs("$")
    private val standardSize = CostForecastRegistration.defaultSize
    private val compactSize = CostForecastSize(cols = 1, rows = 4)

    private fun forecastJson(
        historical: List<Triple<String, Double, Double>>,
        forecast: List<Pair<String, Double>>,
    ): JsonElement =
        buildJsonObject {
            put(
                "historical",
                buildJsonArray {
                    historical.forEach { (month, cost, costPerKwh) ->
                        add(
                            buildJsonObject {
                                put("month", month)
                                put("cost", cost)
                                put("cost_per_kwh", costPerKwh)
                            },
                        )
                    }
                },
            )
            put(
                "forecast",
                buildJsonArray {
                    forecast.forEach { (month, cost) ->
                        add(
                            buildJsonObject {
                                put("month", month)
                                put("cost", cost)
                            },
                        )
                    }
                },
            )
        }

    private fun populatedJson(): JsonElement =
        forecastJson(
            historical =
                listOf(
                    Triple("2025-01", 30.0, 0.10),
                    Triple("2025-02", 40.0, 0.11),
                    Triple("2025-03", 50.0, 0.12),
                    Triple("2025-04", 45.0, 0.14),
                ),
            forecast =
                listOf(
                    "2025-05" to 55.0,
                    "2025-06" to 60.0,
                    "2025-07" to 58.0,
                    "2025-08" to 62.0,
                ),
        )

    private fun emptyForecastJson(): JsonElement = forecastJson(emptyList(), emptyList())

    private fun setContent(
        state: UiState<JsonElement>,
        size: CostForecastSize = standardSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CostForecastWidgetContent(
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
        compose.onNodeWithText("Can't reach server").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun standardContentShowsTitleStatsAndChartDescription() {
        setContent(UiState(UiPhase.Content, data = populatedJson(), fetchedAt = NOW))
        compose.onNodeWithText("Cost Forecast").assertIsDisplayed()
        compose.onNodeWithText("Next Month").assertIsDisplayed()
        compose.onNodeWithText("Avg \$/kWh").assertIsDisplayed()
        compose.onNodeWithText("Trend").assertIsDisplayed()
        // The first forecast month's cost (55) renders as the Next Month value.
        assertTrue(compose.onAllNodesWithText("$55").fetchSemanticsNodes().isNotEmpty())
        // The bar chart exposes an accessible month-range description.
        compose.onNodeWithContentDescription("Cost Forecast:", substring = true).assertIsDisplayed()
    }

    @Test
    fun standardContentExposesRefreshAction() {
        setContent(UiState(UiPhase.Content, data = populatedJson(), fetchedAt = NOW))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun compactContentShowsStatsWithoutTitle() {
        setContent(
            state = UiState(UiPhase.Content, data = populatedJson(), fetchedAt = NOW),
            size = compactSize,
        )
        compose.onNodeWithText("Next Month").assertIsDisplayed()
        // The compact footprint drops the titled header (web WidgetShell renders no title at 1 column).
        assertTrue(compose.onAllNodesWithText("Cost Forecast").fetchSemanticsNodes().isEmpty())
    }

    @Test
    fun emptyShowsNoForecastDataMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyForecastJson(), fetchedAt = NOW))
        compose.onNodeWithText("No forecast data").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = populatedJson(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached values stay visible (never blanked) when offline/stale.
        compose.onNodeWithText("Next Month").assertIsDisplayed()
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
    }
}
