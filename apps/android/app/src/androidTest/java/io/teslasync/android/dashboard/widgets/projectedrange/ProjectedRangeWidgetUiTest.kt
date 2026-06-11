package io.teslasync.android.dashboard.widgets.projectedrange

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertDoesNotExist
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
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * Instrumented Compose UI + accessibility verification of [ProjectedRangeWidgetContent] across every state
 * the web component renders (loading skeleton, hard error + retry, the Projected Range title + comparison +
 * badge, the friendly empty state, the wide range-factors list, the compact hero, and the stale/offline
 * cached path). Asserts the rendered i18n strings and the TalkBack content descriptions are present. Runs
 * under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure logic, this covers
 * the render + a11y.
 */
class ProjectedRangeWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun metricPrefs(): UnitPref =
        UnitPref(
            distance = DistanceUnitPref.KM,
            speed = SpeedUnitPref.KMH,
            temperature = TemperatureUnitPref.CELSIUS,
            pressure = PressureUnitPref.BAR,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
            locale = "en-US",
            precision = null,
        )

    private fun setContent(
        state: UiState<JsonElement>,
        size: ProjectedRangeSize = ProjectedRangeRegistration.defaultSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    ProjectedRangeWidgetContent(
                        state = state,
                        prefs = metricPrefs(),
                        size = size,
                        onRefresh = onRefresh,
                        locale = Locale.US,
                    )
                }
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
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
    fun emptyShowsFriendlyMessage() {
        setContent(UiState(UiPhase.Empty, data = buildJsonObject { }, fetchedAt = NOW))
        compose.onNodeWithText("No projected range data").assertIsDisplayed()
    }

    @Test
    fun standardShowsTitleComparisonBadgeAndRefresh() {
        setContent(UiState(UiPhase.Content, data = rangePayload(), fetchedAt = NOW))
        compose.onNodeWithText("Projected Range").assertIsDisplayed()
        compose.onNodeWithText("Good \u00B7 85%").assertIsDisplayed()
        compose.onNodeWithText("EPA: 400 km").assertIsDisplayed()
        compose.onNodeWithText("75% of EPA rated").assertIsDisplayed()
        // The header refresh control exposes an accessible name (TalkBack).
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun wideFootprintShowsRangeFactors() {
        setContent(
            state = UiState(UiPhase.Content, data = rangePayload(), fetchedAt = NOW),
            size = ProjectedRangeRegistration.maxSize,
        )
        compose.onNodeWithText("Range Factors").assertIsDisplayed()
        compose.onNodeWithText("Battery Degradation").assertIsDisplayed()
        compose.onNodeWithText("Avg Daily Usage").assertIsDisplayed()
        compose.onNodeWithText("Current Capacity").assertIsDisplayed()
        compose.onNodeWithText("Battery Cycles").assertIsDisplayed()
    }

    @Test
    fun compactFootprintShowsHeroWithoutTitle() {
        setContent(
            state = UiState(UiPhase.Content, data = rangePayload(), fetchedAt = NOW),
            size = ProjectedRangeRegistration.minSize,
        )
        // current_range_km = 300 → "300 km", health_score = 85 → "Good", surfaced as the hero's TalkBack text.
        compose.onNodeWithContentDescription("300 km, Projected, Good").assertIsDisplayed()
        // The compact branch hides the title (web `WidgetShell` compact title omission).
        compose.onNodeWithText("Projected Range").assertDoesNotExist()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = rangePayload(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached comparison stays visible (never blanked) when offline/stale.
        compose.onNodeWithText("EPA: 400 km").assertIsDisplayed()
    }

    private fun rangePayload(): JsonElement =
        buildJsonObject {
            put("current_range_km", 300.0)
            put("new_range_km", 400.0)
            put("avg_daily_km", 50.0)
            put("health_score", 85.0)
            put("degradation_pct", 8.5)
            put("current_capacity_pct", 91.5)
            put("total_cycles", 412.0)
        }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
        val HOST_WIDTH = 360.dp
        val HOST_HEIGHT = 720.dp
    }
}
