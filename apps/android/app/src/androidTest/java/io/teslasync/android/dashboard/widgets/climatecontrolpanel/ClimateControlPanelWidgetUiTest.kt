package io.teslasync.android.dashboard.widgets.climatecontrolpanel

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [ClimateControlPanelWidgetContent] across every state
 * the web component renders (loading skeleton, full content panel + chips, compact temperature hero, empty,
 * hard error with retry, stale/offline cached). Asserts the rendered i18n strings and the TalkBack content
 * descriptions are present, and that the refresh control fires. Runs under `connectedAndroidTest` (a
 * device/emulator) — the offline gate's `testReleaseUnitTest` covers the projection/state logic; this
 * covers the render.
 */
class ClimateControlPanelWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val formatter = UnitFormatter.default()

    private fun climate(): JsonElement =
        buildJsonObject {
            put("inside_temp", 21.0)
            put("outside_temp", 14.0)
            put("hvac_power", 2.4)
            put("hvac_ac_enabled", true)
            put("hvac_fan_speed", 4)
            put("hvac_steering_wheel_heat_level", 2)
            put("seat_heater_left", 3)
            put("defrost_mode", "Front")
            put("battery_heater_on", true)
        }

    private fun setWidget(
        state: UiState<JsonElement>,
        size: ClimateControlPanelSize = ClimateControlPanelRegistration.DEFAULT_SIZE,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ClimateControlPanelWidgetContent(state = state, formatter = formatter, size = size, onRefresh = onRefresh)
            }
        }
    }

    private fun contentState(): UiState<JsonElement> = UiState(phase = UiPhase.Content, data = climate(), fetchedAt = 1L)

    @Test
    fun loadingShowsSkeletonNotRows() {
        setWidget(UiState.loading())
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
        compose.onNodeWithText("Cabin").assertDoesNotExist()
        compose.onNodeWithText("No climate data").assertDoesNotExist()
    }

    @Test
    fun contentShowsTemperatureRowsAndValues() {
        setWidget(contentState())
        compose.onNodeWithText("Cabin").assertIsDisplayed()
        compose.onNodeWithText("Outside").assertIsDisplayed()
        compose.onNodeWithText("21\u00B0C").assertIsDisplayed()
        compose.onNodeWithText("14\u00B0C").assertIsDisplayed()
    }

    @Test
    fun contentShowsHvacFanAndWheelHeat() {
        setWidget(contentState())
        compose.onNodeWithText("HVAC On").assertIsDisplayed()
        compose.onNodeWithText("2.4 kW").assertIsDisplayed()
        compose.onNodeWithText("Fan Speed").assertIsDisplayed()
        compose.onNodeWithText("Wheel Heat").assertIsDisplayed()
        compose.onNodeWithText("2/3").assertIsDisplayed()
    }

    @Test
    fun contentShowsSeatHeaterAndStatusChips() {
        setWidget(contentState())
        compose.onNodeWithText("FL 3/3").assertIsDisplayed()
        compose.onNodeWithText("Defrost").assertIsDisplayed()
        compose.onNodeWithText("Bat Heater").assertIsDisplayed()
    }

    @Test
    fun headerExposesTitleAndRefreshAccessibility() {
        setWidget(contentState())
        compose.onNodeWithText("Climate Control").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun compactShowsSingleTemperatureHero() {
        setWidget(contentState(), size = ClimateControlPanelSize(cols = 1, rows = 1))
        compose.onNodeWithText("21\u00B0C").assertIsDisplayed()
        // The compact hero omits the section labels (web `title`/`icon` undefined at 1×1).
        compose.onNodeWithText("Fan Speed").assertDoesNotExist()
    }

    @Test
    fun emptyShowsNoClimateData() {
        setWidget(UiState(phase = UiPhase.Empty, data = JsonNull, fetchedAt = 1L))
        compose.onNodeWithText("No climate data").assertIsDisplayed()
        compose.onNodeWithText("Cabin").assertDoesNotExist()
    }

    @Test
    fun errorShowsEmptyBodyWithRefreshRetry() {
        var refreshed = false
        setWidget(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRefresh = { refreshed = true })
        compose.onNodeWithText("No climate data").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").performClick()
        assertTrue(refreshed)
    }

    @Test
    fun offlineKeepsCachedRowsVisible() {
        setWidget(
            UiState(
                phase = UiPhase.Content,
                data = climate(),
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Cabin").assertIsDisplayed()
        compose.onNodeWithText("21\u00B0C").assertIsDisplayed()
    }
}
