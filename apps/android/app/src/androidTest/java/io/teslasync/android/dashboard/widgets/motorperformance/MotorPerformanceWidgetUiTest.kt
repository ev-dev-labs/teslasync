package io.teslasync.android.dashboard.widgets.motorperformance

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
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [MotorPerformanceWidgetContent] across every state
 * the web component renders (loading skeleton, hard error + retry, standard gauge + stat grid, compact
 * gear/torque read-outs, no-data empty, stale/offline cached). Asserts the rendered i18n strings and the
 * TalkBack content descriptions are present. Runs under `connectedAndroidTest`; the offline gate's
 * `testReleaseUnitTest` covers the projection/fold logic, this covers the render + a11y.
 */
class MotorPerformanceWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private val default = MotorPerformanceRegistration.defaultSize
    private val compact = MotorPerformanceSize(cols = 1, rows = 2)

    private val celsiusPrefs =
        UnitPref(
            distance = DistanceUnitPref.KM,
            speed = SpeedUnitPref.KMH,
            temperature = TemperatureUnitPref.CELSIUS,
            pressure = PressureUnitPref.KPA,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
        )

    @Test
    fun loadingShowsSkeletonNotContent() {
        setContent(UiState.loading())
        rule.onNodeWithContentDescription("Loading").assertIsDisplayed()
        rule.onNodeWithText("No motor data").assertDoesNotExist()
        rule.onNodeWithText("Motor Performance").assertDoesNotExist()
    }

    @Test
    fun emptyShowsNoMotorData() {
        setContent(UiState(phase = UiPhase.Empty, data = null, fetchedAt = NOW))
        rule.onNodeWithText("No motor data").assertIsDisplayed()
    }

    @Test
    fun standardContentShowsTitleGaugeAndStats() {
        setContent(UiState(phase = UiPhase.Content, data = snapshot(), fetchedAt = NOW))
        rule.onNodeWithText("Motor Performance").assertIsDisplayed()
        // The gauge folds its torque label + value/unit into one accessible description ("342: 342 Nm").
        rule.onNodeWithContentDescription("Nm", substring = true).assertIsDisplayed()
        rule.onNodeWithText("Stator Temp").assertIsDisplayed()
        rule.onNodeWithText("Gear State").assertIsDisplayed()
        rule.onNodeWithText("Lateral G").assertIsDisplayed()
        rule.onNodeWithText("Longitudinal G").assertIsDisplayed()
    }

    @Test
    fun compactHidesTitleButKeepsGearAndTorque() {
        setContent(UiState(phase = UiPhase.Content, data = snapshot(), fetchedAt = NOW), size = compact)
        rule.onNodeWithText("Motor Performance").assertDoesNotExist()
        rule.onNodeWithText("Gear").assertIsDisplayed()
        rule.onNodeWithText("Torque").assertIsDisplayed()
        rule.onNodeWithText("D").assertIsDisplayed()
    }

    @Test
    fun refreshExposesAccessibilityLabel() {
        setContent(UiState(phase = UiPhase.Content, data = snapshot(), fetchedAt = NOW))
        rule.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAndFiresIt() {
        var retried = false
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRefresh = { retried = true })
        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineKeepsCachedGaugeVisible() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = snapshot(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached gauge stays visible (never blanked) when offline/stale.
        rule.onNodeWithContentDescription("Nm", substring = true).assertIsDisplayed()
    }

    private fun setContent(
        state: UiState<MotorSnapshot?>,
        size: MotorPerformanceSize = default,
        onRefresh: () -> Unit = {},
    ) {
        rule.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                MotorPerformanceWidgetContent(
                    state = state,
                    prefs = celsiusPrefs,
                    size = size,
                    onRefresh = onRefresh,
                )
            }
        }
    }

    private fun snapshot(): MotorSnapshot =
        MotorSnapshot(torque = 342.0, statorTempC = 64.0, gear = "D", lateralG = 0.18, longitudinalG = 0.42)

    private companion object {
        const val NOW = 1_780_000_000_000L
    }
}
