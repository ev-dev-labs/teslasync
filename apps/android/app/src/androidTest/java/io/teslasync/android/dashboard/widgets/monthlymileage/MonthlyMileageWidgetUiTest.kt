package io.teslasync.android.dashboard.widgets.monthlymileage

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
 * On-device Compose UI + accessibility verification of [MonthlyMileageWidgetContent] across every state
 * the web component renders (loading skeleton, hard error + retry, standard stat row + bar chart,
 * compact stat-only, no-data empty, stale/offline cached). Asserts the rendered i18n strings and the
 * TalkBack content descriptions are present. Runs under `connectedAndroidTest` (a device/emulator) —
 * the offline gate's `testReleaseUnitTest` covers the logic; this covers render + a11y.
 */
class MonthlyMileageWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val prefs = MonthlyMileageDisplayPrefs(DistanceUnitPref.KM)
    private val standardSize = MonthlyMileageRegistration.defaultSize
    private val compactSize = MonthlyMileageSize(cols = 1, rows = 4)
    private val currentMonth = "2025-07"

    private fun monthsJson(months: List<Pair<String, Double>>): JsonElement =
        buildJsonArray {
            months.forEach { (label, km) ->
                add(
                    buildJsonObject {
                        put("year_month", label)
                        put("total_km", km)
                    },
                )
            }
        }

    private fun populatedJson(): JsonElement = monthsJson(listOf("2025-06" to 100.0, "2025-07" to 250.0))

    private fun emptyMileageJson(): JsonElement = monthsJson(emptyList())

    private fun setContent(
        state: UiState<JsonElement>,
        size: MonthlyMileageSize = standardSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                MonthlyMileageWidgetContent(
                    state = state,
                    prefs = prefs,
                    size = size,
                    onRefresh = onRefresh,
                    locale = Locale.US,
                    currentMonth = currentMonth,
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
    fun standardContentShowsTitleAndStatRow() {
        setContent(UiState(UiPhase.Content, data = populatedJson(), fetchedAt = NOW))
        compose.onNodeWithText("Monthly Mileage").assertIsDisplayed()
        compose.onNodeWithText("This Month").assertIsDisplayed()
        compose.onNodeWithText("12-Mo Total").assertIsDisplayed()
        // The 12-month total (100 + 250 km = 350) renders as a grouped integer stat value.
        assertTrue(compose.onAllNodesWithText("350").fetchSemanticsNodes().isNotEmpty())
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
        compose.onNodeWithText("This Month").assertIsDisplayed()
        // The compact footprint drops the titled header (web WidgetShell renders no title at 1 column).
        assertTrue(compose.onAllNodesWithText("Monthly Mileage").fetchSemanticsNodes().isEmpty())
    }

    @Test
    fun emptyShowsNoMileageDataMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyMileageJson(), fetchedAt = NOW))
        compose.onNodeWithText("No mileage data").assertIsDisplayed()
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
        compose.onNodeWithText("12-Mo Total").assertIsDisplayed()
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
    }
}
