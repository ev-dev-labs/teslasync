package io.teslasync.android.dashboard.widgets.mileagestats

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
 * Instrumented Compose UI + accessibility verification of [MileageStatsWidgetContent] across every state
 * the web component renders (loading skeleton, hard error + retry, the Mileage Stats title + four-tile
 * stat grid, the friendly empty state, the compact daily-average hero, and the stale/offline cached path).
 * Asserts the rendered i18n strings and the TalkBack content descriptions are present. Runs under
 * `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure logic, this covers the
 * render + a11y.
 */
class MileageStatsWidgetUiTest {
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
        size: MileageStatsSize = MileageStatsRegistration.defaultSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    MileageStatsWidgetContent(
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
        compose.onNodeWithText("No mileage data").assertIsDisplayed()
    }

    @Test
    fun contentShowsTitleStatsAndRefresh() {
        setContent(UiState(UiPhase.Content, data = mileagePayload(), fetchedAt = NOW))
        compose.onNodeWithText("Mileage Stats").assertIsDisplayed()
        compose.onNodeWithText("Daily Avg").assertIsDisplayed()
        compose.onNodeWithText("Weekly Avg").assertIsDisplayed()
        compose.onNodeWithText("Monthly Avg").assertIsDisplayed()
        compose.onNodeWithText("Next Milestone").assertIsDisplayed()
        // The header refresh control exposes an accessible name (TalkBack).
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun compactFootprintShowsHeroWithoutTitle() {
        setContent(
            state = UiState(UiPhase.Content, data = mileagePayload(), fetchedAt = NOW),
            size = MileageStatsRegistration.minSize,
        )
        // last_30d_km = 1500 → 50 km/day, surfaced as the hero's TalkBack description.
        compose.onNodeWithContentDescription("50 km/day").assertIsDisplayed()
        // The compact branch hides the title (web `WidgetShell` compact title omission).
        compose.onNodeWithText("Mileage Stats").assertDoesNotExist()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = mileagePayload(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached stats stay visible (never blanked) when offline/stale.
        compose.onNodeWithText("Daily Avg").assertIsDisplayed()
    }

    private fun mileagePayload(): JsonElement =
        buildJsonObject {
            put("vehicle_id", 5)
            put("lifetime_km", 50_000.0)
            put("last_7d_km", 350.0)
            put("last_30d_km", 1_500.0)
            put("last_365d_km", 18_000.0)
            put("drive_count_lifetime", 1_200)
            put("drive_count_30d", 40)
        }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
        val HOST_WIDTH = 360.dp
        val HOST_HEIGHT = 560.dp
    }
}
