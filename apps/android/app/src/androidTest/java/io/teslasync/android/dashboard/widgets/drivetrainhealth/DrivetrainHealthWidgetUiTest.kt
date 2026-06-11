package io.teslasync.android.dashboard.widgets.drivetrainhealth

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
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [DrivetrainHealthWidgetContent] across every state
 * the web component renders (loading skeleton, hard error + retry, standard gauge + stat grid, compact
 * gauge-only, no-data empty, stale/offline cached). Asserts the rendered i18n strings and the TalkBack
 * content descriptions are present. Runs under `connectedAndroidTest`; the offline gate's
 * `testReleaseUnitTest` covers the projection/fold logic, this covers the render + a11y.
 */
class DrivetrainHealthWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private val default = DrivetrainHealthRegistration.DEFAULT_SIZE
    private val compact = DrivetrainHealthSize(cols = 1, rows = 2)

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
        rule.onNodeWithText("No drivetrain data").assertDoesNotExist()
        rule.onNodeWithContentDescription("Motor Temp", substring = true).assertDoesNotExist()
    }

    @Test
    fun emptyShowsNoDrivetrainData() {
        setContent(UiState(phase = UiPhase.Empty, data = DrivetrainHealthSnapshot(null, null), fetchedAt = NOW))
        rule.onNodeWithText("No drivetrain data").assertIsDisplayed()
    }

    @Test
    fun standardContentShowsTitleGaugeAndStats() {
        setContent(UiState(phase = UiPhase.Content, data = snapshot(), fetchedAt = NOW))
        rule.onNodeWithText("Drivetrain Health").assertIsDisplayed()
        // The gauge folds its score + unit into one accessible description ("95: 95 health").
        rule.onNodeWithContentDescription("health", substring = true).assertIsDisplayed()
        rule.onNodeWithContentDescription("Motor Temp", substring = true).assertIsDisplayed()
        rule.onNodeWithContentDescription("Drive State", substring = true).assertIsDisplayed()
    }

    @Test
    fun compactHidesTitleButKeepsGauge() {
        setContent(UiState(phase = UiPhase.Content, data = snapshot(), fetchedAt = NOW), size = compact)
        rule.onNodeWithText("Drivetrain Health").assertDoesNotExist()
        rule.onNodeWithContentDescription("health", substring = true).assertIsDisplayed()
    }

    @Test
    fun statsAndRefreshExposeAccessibilityLabels() {
        setContent(UiState(phase = UiPhase.Content, data = snapshot(), fetchedAt = NOW))
        // Each stat folds its label + converted value into one TalkBack phrase.
        rule.onNodeWithContentDescription("Stator Temp", substring = true).assertIsDisplayed()
        rule.onNodeWithContentDescription("Inverter", substring = true).assertIsDisplayed()
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
        rule.onNodeWithContentDescription("health", substring = true).assertIsDisplayed()
    }

    private fun setContent(
        state: UiState<DrivetrainHealthSnapshot>,
        size: DrivetrainHealthSize = default,
        onRefresh: () -> Unit = {},
    ) {
        rule.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DrivetrainHealthWidgetContent(
                    state = state,
                    prefs = celsiusPrefs,
                    size = size,
                    onRefresh = onRefresh,
                )
            }
        }
    }

    private fun snapshot(): DrivetrainHealthSnapshot = DrivetrainHealthSnapshot(health = health(), motor = motor())

    private fun health(): JsonElement =
        buildJsonObject {
            put("front_motor_temp_c", 45.0)
            put("rear_motor_temp_c", 48.0)
            put("inverter_temp_c", 52.0)
            put("motor_status", "Normal")
            put("overall_health", "good")
        }

    private fun motor(): JsonElement =
        buildJsonObject {
            put("motor_temp_c_front", 46.0)
            put("di_stator_temp", 61.0)
            put("state_front", "Drive")
        }

    private companion object {
        const val NOW = 1_780_000_000_000L
    }
}
