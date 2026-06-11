package io.teslasync.android.dashboard.widgets.energystats

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
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * Instrumented Compose UI + accessibility verification of [EnergyStatsWidgetContent] across every state
 * the web component renders (loading skeleton, hard error + retry, the Energy Stats title + daily chart +
 * stat grid, the friendly empty state, the wide footprint's Total Cost + Net Energy tiles, the compact
 * total-energy hero, and the stale/offline cached path). Asserts the rendered i18n strings and the
 * TalkBack content descriptions are present. Runs under `connectedAndroidTest`; the offline gate's
 * `testReleaseUnitTest` covers the pure logic, this covers the render + a11y.
 */
class EnergyStatsWidgetUiTest {
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
        size: EnergyStatsSize = EnergyStatsRegistration.defaultSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    EnergyStatsWidgetContent(
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
        compose.onNodeWithText("No energy data available").assertIsDisplayed()
    }

    @Test
    fun contentShowsTitleStatsAndRefresh() {
        setContent(UiState(UiPhase.Content, data = energyPayload(), fetchedAt = NOW))
        compose.onNodeWithText("Energy Stats").assertIsDisplayed()
        compose.onNodeWithText("Total Used").assertIsDisplayed()
        compose.onNodeWithText("Total Charged").assertIsDisplayed()
        compose.onNodeWithText("Avg Efficiency").assertIsDisplayed()
        compose.onNodeWithText("CO\u2082 Saved").assertIsDisplayed()
        // The header refresh control exposes an accessible name (TalkBack).
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun wideFootprintShowsCostAndNetEnergy() {
        setContent(
            state = UiState(UiPhase.Content, data = energyPayload(), fetchedAt = NOW),
            size = EnergyStatsSize(cols = 3, rows = 4),
        )
        compose.onNodeWithText("Total Cost").assertIsDisplayed()
        compose.onNodeWithText("Net Energy").assertIsDisplayed()
    }

    @Test
    fun compactFootprintShowsHeroWithoutTitle() {
        setContent(
            state = UiState(UiPhase.Content, data = energyPayload(), fetchedAt = NOW),
            size = EnergyStatsRegistration.minSize,
        )
        // total_wh = 32000 → 32 kWh, surfaced as the hero's TalkBack description.
        compose.onNodeWithContentDescription("32 kWh").assertIsDisplayed()
        // The compact branch hides the title (web `WidgetShell` compact title omission).
        compose.onNodeWithText("Energy Stats").assertDoesNotExist()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = energyPayload(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached stats stay visible (never blanked) when offline/stale.
        compose.onNodeWithText("Total Used").assertIsDisplayed()
    }

    private fun energyPayload(): JsonElement =
        buildJsonObject {
            put("total_energy_used_wh", 12_300.0)
            put("total_energy_charged_wh", 20_000.0)
            put("total_wh", 32_000.0)
            put("total_cost", 45.5)
            put("avg_efficiency_wh_per_m", 0.15)
            put("co2_saved_kg", 8.5)
            put(
                "daily_breakdown",
                buildJsonArray {
                    add(day("2025-01-15", 5_000.0))
                    add(day("2025-01-16", 7_500.0))
                },
            )
        }

    private fun day(
        date: String,
        energyWh: Double,
    ) = buildJsonObject {
        put("date", date)
        put("energy_wh", energyWh)
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
