package io.teslasync.android.dashboardwidgets

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose tests for [BatteryGaugeWidgetContent] — the loading / content / charging /
 * empty / error surfaces the widget must render, asserting the localized copy, the gauge + charging
 * TalkBack labels, that the charging indicator is hidden in the compact footprint, and that the retry
 * action fires. The pure projection / adapter logic is covered by the no-device [BatteryGaugeWidgetTest];
 * these assert the surfaces on a device (connectedReleaseAndroidTest). Reduced motion is forced so the
 * charging pulse never keeps the Compose clock busy.
 */
class BatteryGaugeWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private val standard = BatteryGaugeRegistration.DEFAULT_SIZE
    private val compact = BatteryGaugeSize(1, 1)

    @Test
    fun loadingShowsNeitherGaugeNorEmpty() {
        setContent(UiState.loading(), standard)
        rule.onNodeWithContentDescription("Battery", substring = true).assertDoesNotExist()
        rule.onNodeWithText("No battery data").assertDoesNotExist()
    }

    @Test
    fun contentShowsGaugeWithAccessibleLabel() {
        setContent(contentState(72, isCharging = false), standard)
        rule.onNodeWithContentDescription("Battery", substring = true).assertIsDisplayed()
    }

    @Test
    fun chargingContentShowsChargingIndicator() {
        setContent(contentState(43, isCharging = true), standard)
        rule.onNodeWithContentDescription("Battery", substring = true).assertIsDisplayed()
        rule.onNodeWithContentDescription("Charging").assertIsDisplayed()
    }

    @Test
    fun notChargingContentHidesChargingIndicator() {
        setContent(contentState(43, isCharging = false), standard)
        rule.onNodeWithContentDescription("Charging").assertDoesNotExist()
    }

    @Test
    fun compactFootprintHidesChargingIndicator() {
        setContent(contentState(43, isCharging = true), compact)
        rule.onNodeWithContentDescription("Battery", substring = true).assertIsDisplayed()
        rule.onNodeWithContentDescription("Charging").assertDoesNotExist()
    }

    @Test
    fun emptyShowsNoBatteryState() {
        setContent(
            UiState(phase = UiPhase.Empty, data = VehicleStateEnvelope(state = null, live = false), fetchedAt = 1L),
            standard,
        )
        rule.onNodeWithText("No battery data").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAndFiresIt() {
        var retried = false
        rule.setContent {
            CompositionLocalProvider(LocalReducedMotion provides true) {
                TeslaSyncTheme {
                    BatteryGaugeWidgetContent(
                        state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
                        size = standard,
                        onRetry = { retried = true },
                    )
                }
            }
        }
        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    private fun setContent(
        state: UiState<VehicleStateEnvelope>,
        size: BatteryGaugeSize,
    ) {
        rule.setContent {
            CompositionLocalProvider(LocalReducedMotion provides true) {
                TeslaSyncTheme {
                    BatteryGaugeWidgetContent(state = state, size = size)
                }
            }
        }
    }

    private fun contentState(
        batteryLevel: Long,
        isCharging: Boolean,
    ): UiState<VehicleStateEnvelope> =
        UiState(
            phase = UiPhase.Content,
            data = VehicleStateEnvelope(state = vehicleState(batteryLevel, isCharging), live = true),
            fetchedAt = 1L,
        )

    private fun vehicleState(
        batteryLevel: Long,
        isCharging: Boolean,
    ): VehicleState =
        VehicleState(
            batteryLevel = batteryLevel,
            chargeRate = 0.0,
            chargerPower = 0.0,
            idealRange = 0.0,
            insideTemp = 21.0,
            isCharging = isCharging,
            isClimateOn = false,
            isLocked = true,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 0.0,
            outsideTemp = 18.0,
            power = 0.0,
            ratedRange = 0.0,
            sentryMode = false,
            softwareVersion = "2024.0",
            speed = 0.0,
            state = "online",
            timeToFullCharge = 0.0,
            vehicleId = 1,
        )
}
