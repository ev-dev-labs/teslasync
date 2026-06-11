package io.teslasync.android.dashboard.widgets.energyflow

import androidx.compose.foundation.layout.size
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
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
 * On-device Compose UI + accessibility verification of [EnergyFlowWidgetContent] across every state the
 * web component renders (loading skeleton, empty "No energy data available", hard error surfaced through
 * the header + empty body, the consuming/regenerating/charging flow diagram, and stale/offline cached).
 * Asserts the rendered i18n strings and the folded TalkBack node descriptions are present. Reduced motion
 * is forced so the animated flow arrows are deterministic. Runs under `connectedAndroidTest`; the offline
 * gate's `testReleaseUnitTest` covers the pure logic, this covers the render.
 */
class EnergyFlowWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    @Suppress("LongParameterList")
    private fun vehicleState(
        power: Double = 0.0,
        isCharging: Boolean = false,
        chargerPower: Double = 0.0,
        batteryLevel: Long = 72,
    ): VehicleState =
        VehicleState(
            batteryLevel = batteryLevel,
            chargeRate = 0.0,
            chargerPower = chargerPower,
            idealRange = 300_000.0,
            insideTemp = 21.0,
            isCharging = isCharging,
            isClimateOn = false,
            isLocked = true,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 0.0,
            outsideTemp = 10.0,
            power = power,
            ratedRange = 300_000.0,
            sentryMode = false,
            softwareVersion = "2026.4",
            speed = 0.0,
            state = "online",
            timeToFullCharge = 0.0,
            vehicleId = 1L,
        )

    private fun envelope(state: VehicleState?): VehicleStateEnvelope = VehicleStateEnvelope(state = state, live = state != null)

    private fun setContent(
        state: UiState<VehicleStateEnvelope>,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            CompositionLocalProvider(LocalReducedMotion provides true) {
                TeslaSyncTheme(dynamicColor = false) {
                    EnergyFlowWidgetContent(
                        state = state,
                        modifier = Modifier.size(width = 260.dp, height = 340.dp),
                        onRefresh = onRefresh,
                    )
                }
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoEnergyDataMessage() {
        setContent(UiState(UiPhase.Empty, data = envelope(null), fetchedAt = 1L))
        compose.onNodeWithText("No energy data available").assertIsDisplayed()
    }

    @Test
    fun consumingShowsTitleBatteryAndMotorNodes() {
        setContent(
            UiState(UiPhase.Content, data = envelope(vehicleState(power = 24.6, batteryLevel = 72)), fetchedAt = 1L),
        )
        compose.onNodeWithText("Energy Flow").assertIsDisplayed()
        compose.onNodeWithContentDescription("Battery, 72%").assertIsDisplayed()
        compose.onNodeWithContentDescription("Consuming, 24.6 kW").assertIsDisplayed()
    }

    @Test
    fun regeneratingShowsRegenMotorNode() {
        setContent(
            UiState(UiPhase.Content, data = envelope(vehicleState(power = -8.0, batteryLevel = 80)), fetchedAt = 1L),
        )
        compose.onNodeWithContentDescription("Regenerating, 8.0 kW").assertIsDisplayed()
    }

    @Test
    fun standbyShowsEmDashMotorNode() {
        setContent(
            UiState(UiPhase.Content, data = envelope(vehicleState(power = 0.0, batteryLevel = 90)), fetchedAt = 1L),
        )
        compose.onNodeWithContentDescription("Standby, \u2014").assertIsDisplayed()
    }

    @Test
    fun chargingShowsChargerNode() {
        setContent(
            UiState(
                UiPhase.Content,
                data = envelope(vehicleState(power = -4.0, isCharging = true, chargerPower = 11.0, batteryLevel = 64)),
                fetchedAt = 1L,
            ),
        )
        compose.onNodeWithContentDescription("Charger, 11.0 kW").assertIsDisplayed()
        compose.onNodeWithContentDescription("Battery, 64%").assertIsDisplayed()
    }

    @Test
    fun errorSurfacesEmptyBodyAndRefreshAffordance() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Empty, data = envelope(null), errorKind = ErrorKind.Network),
            onRefresh = { retried = true },
        )
        // Web does not pass WidgetShell.error here, so a hard failure keeps the header + empty body,
        // surfacing the failure through the freshness chip and the retry affordance (never a blank panel).
        compose.onNodeWithText("No energy data available").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed().performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineKeepsCachedDiagramVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = envelope(vehicleState(power = 18.0, batteryLevel = 58)),
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached flow nodes stay visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("Battery, 58%").assertIsDisplayed()
        compose.onNodeWithContentDescription("Consuming, 18.0 kW").assertIsDisplayed()
    }

    @Test
    fun contentHeaderExposesRefreshAction() {
        setContent(UiState(UiPhase.Content, data = envelope(vehicleState(power = 5.0)), fetchedAt = 1L))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }
}
