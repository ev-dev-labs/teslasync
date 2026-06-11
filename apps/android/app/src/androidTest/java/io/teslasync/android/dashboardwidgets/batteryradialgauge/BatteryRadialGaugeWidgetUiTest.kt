package io.teslasync.android.dashboardwidgets.batteryradialgauge

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
 * Instrumented Compose tests for [BatteryRadialGaugeWidgetContent] — the loading / empty / content /
 * large-with-stats-and-charging / error surfaces the widget must render, asserting the localized copy,
 * the gauge + charging + refresh accessibility labels, and that the retry action fires. The pure
 * projection / adapter logic is covered by the no-device unit tests; these assert the surfaces on a
 * device. Reduced motion is forced so the charging pulse never blocks the test clock from idling.
 */
class BatteryRadialGaugeWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private val default = BatteryRadialGaugeRegistration.DEFAULT_SIZE
    private val large = BatteryRadialGaugeSize(cols = 2, rows = 2)

    @Test
    fun loadingShowsSkeletonNotContent() {
        setWidget(state = UiState.loading(), size = default)
        rule.onNodeWithContentDescription("Loading").assertIsDisplayed()
        rule.onNodeWithText("No battery data").assertDoesNotExist()
        rule.onNodeWithText("Level").assertDoesNotExist()
    }

    @Test
    fun emptyShowsNoBatteryData() {
        setWidget(
            state = UiState(phase = UiPhase.Empty, data = VehicleStateEnvelope(state = null, live = false), fetchedAt = 1L),
            size = default,
        )
        rule.onNodeWithText("No battery data").assertIsDisplayed()
    }

    @Test
    fun defaultContentShowsGaugeWithoutStats() {
        setWidget(
            state = contentState(72, charging = false),
            size = default,
        )
        rule.onNodeWithContentDescription("Battery", substring = true).assertIsDisplayed()
        rule.onNodeWithText("Level").assertDoesNotExist()
    }

    @Test
    fun largeContentShowsBothStatsAndChargingIndicator() {
        setWidget(
            state = contentState(18, charging = true),
            size = large,
            chargeLimitSoc = 80.0,
        )
        rule.onNodeWithText("Level").assertIsDisplayed()
        rule.onNodeWithText("Limit").assertIsDisplayed()
        rule.onNodeWithContentDescription("Charging").assertIsDisplayed()
    }

    @Test
    fun refreshAndGaugeExposeAccessibilityLabels() {
        setWidget(state = contentState(55, charging = false), size = default)
        rule.onNodeWithContentDescription("Refresh").assertIsDisplayed()
        rule.onNodeWithContentDescription("Battery", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAndFiresIt() {
        var retried = false
        rule.setContent {
            CompositionLocalProvider(LocalReducedMotion provides true) {
                TeslaSyncTheme {
                    BatteryRadialGaugeWidgetContent(
                        state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
                        size = default,
                        onRetry = { retried = true },
                    )
                }
            }
        }
        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    private fun setWidget(
        state: UiState<VehicleStateEnvelope>,
        size: BatteryRadialGaugeSize,
        chargeLimitSoc: Double? = null,
    ) {
        rule.setContent {
            CompositionLocalProvider(LocalReducedMotion provides true) {
                TeslaSyncTheme {
                    BatteryRadialGaugeWidgetContent(state = state, size = size, chargeLimitSoc = chargeLimitSoc)
                }
            }
        }
    }

    private fun contentState(
        level: Long,
        charging: Boolean,
    ): UiState<VehicleStateEnvelope> =
        UiState(
            phase = UiPhase.Content,
            data = VehicleStateEnvelope(state = vehicleState(level, charging), live = true),
            fetchedAt = 1L,
        )

    private fun vehicleState(
        level: Long,
        charging: Boolean,
    ): VehicleState =
        VehicleState(
            batteryLevel = level,
            chargeRate = 0.0,
            chargerPower = 0.0,
            idealRange = 0.0,
            insideTemp = 21.0,
            isCharging = charging,
            isClimateOn = false,
            isLocked = true,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 0.0,
            outsideTemp = 15.0,
            power = 0.0,
            ratedRange = 350.0,
            sentryMode = false,
            softwareVersion = "2024.0",
            speed = 0.0,
            state = "online",
            timeToFullCharge = 0.0,
            vehicleId = 1L,
        )
}
