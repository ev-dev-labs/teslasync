package io.teslasync.android.featureviews.powertrainpanel

import androidx.compose.runtime.Composable
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
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [PowertrainPanelContent] across every state the web
 * component renders (loading skeletons, the full motor body, empty → friendly message, hard error with retry,
 * stale/offline cached). Asserts the rendered i18n labels + reading values and the per-reading merged TalkBack
 * content descriptions are present, and that the error-retry control fires. Runs under `connectedAndroidTest`
 * (a device/emulator) — the offline gate's `testReleaseUnitTest` covers the projection/state logic; this
 * covers the render + a11y.
 */
class PowertrainPanelUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun motorSnapshot(): JsonElement =
        buildJsonObject {
            put("shift_state", "D")
            put("power_kw", 150.5)
            put("motor_rpm_front", 4200.0)
            put("motor_rpm_rear", 4180.0)
            put("torque_nm_front", 220.0)
            put("torque_nm_rear", 235.5)
            put("motor_temp_c_front", 64.0)
            put("motor_temp_c_rear", 58.0)
            put("inverter_temp_c", 45.0)
            put("regen_kw", 18.0)
        }

    @Composable
    private fun panelStrings(): PowertrainPanelStrings = rememberPowertrainPanelStrings()

    private fun setPanel(
        state: UiState<JsonElement>,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                PowertrainPanelContent(
                    state = state,
                    formatter = UnitFormatter.default(),
                    strings = panelStrings(),
                    locale = Locale.US,
                    precision = DEFAULT_NUMBER_DECIMALS,
                    onRefresh = onRefresh,
                )
            }
        }
    }

    private fun contentState(): UiState<JsonElement> = UiState(phase = UiPhase.Content, data = motorSnapshot(), fetchedAt = 1L)

    @Test
    fun loadingShowsTitleAndSkeletonNotValues() {
        setPanel(UiState.loading())
        compose.onNodeWithText("Powertrain").assertIsDisplayed()
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
        compose.onNodeWithText("150.50 kW").assertDoesNotExist()
    }

    @Test
    fun contentShowsTitleLabelsAndValues() {
        setPanel(contentState())
        compose.onNodeWithText("Powertrain").assertIsDisplayed()
        compose.onNodeWithText("Power").assertIsDisplayed()
        compose.onNodeWithText("Front RPM").assertIsDisplayed()
        compose.onNodeWithText("Rear Torque").assertIsDisplayed()
        compose.onNodeWithText("Inverter Temp").assertIsDisplayed()
        compose.onNodeWithText("150.50 kW").assertIsDisplayed()
        compose.onNodeWithText("4,200").assertIsDisplayed()
        compose.onNodeWithText("235.50").assertIsDisplayed()
        compose.onNodeWithText("18.00 kW").assertIsDisplayed()
    }

    @Test
    fun readingsExposeMergedTalkBackLabels() {
        setPanel(contentState())
        compose.onNodeWithContentDescription("Shift State, D").assertIsDisplayed()
        compose.onNodeWithContentDescription("Power, 150.50 kW").assertIsDisplayed()
        compose.onNodeWithContentDescription("Front RPM, 4,200 RPM").assertIsDisplayed()
        compose.onNodeWithContentDescription("Front Torque, 220.00 Nm").assertIsDisplayed()
        compose.onNodeWithContentDescription("Motor Temp, 64.0\u00B0C").assertIsDisplayed()
        compose.onNodeWithContentDescription("Inverter Temp, 45.0\u00B0C").assertIsDisplayed()
        compose.onNodeWithContentDescription("Regen, 18.00 kW").assertIsDisplayed()
    }

    @Test
    fun emptyRendersFriendlyMessageNotReadings() {
        setPanel(UiState(phase = UiPhase.Empty, data = JsonNull, fetchedAt = 1L))
        compose.onNodeWithText("Powertrain").assertIsDisplayed()
        compose.onNodeWithText("No motor data available").assertIsDisplayed()
        compose.onNodeWithText("Front RPM").assertDoesNotExist()
    }

    @Test
    fun errorShowsQueryErrorWithRetry() {
        var refreshed = false
        setPanel(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRefresh = { refreshed = true })
        compose.onNodeWithText("Front RPM").assertDoesNotExist()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(refreshed)
    }

    @Test
    fun offlineKeepsCachedValuesVisible() {
        setPanel(
            UiState(
                phase = UiPhase.Content,
                data = motorSnapshot(),
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("150.50 kW").assertIsDisplayed()
        compose.onNodeWithText("4,200").assertIsDisplayed()
    }
}
