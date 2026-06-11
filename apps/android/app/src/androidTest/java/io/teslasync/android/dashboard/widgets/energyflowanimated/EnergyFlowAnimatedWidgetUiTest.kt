package io.teslasync.android.dashboard.widgets.energyflowanimated

import androidx.compose.foundation.layout.Box
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
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [EnergyFlowAnimatedWidgetContent] across every
 * state the web component renders (loading skeleton, empty "No energy data available", hard error +
 * retry, the full animated flow diagram with per-node TalkBack labels, the compact battery hero, and the
 * stale/offline cached surface). Reduced motion is forced on so the infinite arrow-dash animation never
 * keeps the test frame busy and the count-up snaps to its final value. Runs under `connectedAndroidTest`;
 * the offline gate's `testReleaseUnitTest` covers the logic, this covers the render.
 */
class EnergyFlowAnimatedWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    @Suppress("LongParameterList")
    private fun vehicleState(
        batteryLevel: Long = 82,
        isCharging: Boolean = false,
        chargerPower: Double = 0.0,
        power: Double = 0.0,
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

    private fun setContent(
        state: UiState<EnergyFlowAnimatedSnapshot>,
        size: EnergyFlowAnimatedSize = EnergyFlowAnimatedRegistration.defaultSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    Box(modifier = Modifier.size(320.dp, 480.dp)) {
                        EnergyFlowAnimatedWidgetContent(
                            state = state,
                            size = size,
                            onRefresh = onRefresh,
                        )
                    }
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
        setContent(UiState(UiPhase.Empty, data = EnergyFlowAnimatedSnapshot(state = null), fetchedAt = 1L))
        compose.onNodeWithText("No energy data available").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRefresh() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRefresh = { retried = true },
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun fullDiagramExposesTitleAndPerNodeLabels() {
        setContent(
            UiState(
                UiPhase.Content,
                data = EnergyFlowAnimatedSnapshot(vehicleState(batteryLevel = 82, power = 11.0)),
                fetchedAt = 1L,
            ),
        )
        compose.onNodeWithText("Energy Flow").assertIsDisplayed()
        compose.onNodeWithContentDescription("Battery 82%").assertIsDisplayed()
        compose.onNodeWithContentDescription("Drive 11.0 kW").assertIsDisplayed()
        compose.onNodeWithContentDescription("Charger \u2014").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun chargingDiagramShowsChargerFlowLabel() {
        setContent(
            UiState(
                UiPhase.Content,
                data = EnergyFlowAnimatedSnapshot(vehicleState(isCharging = true, chargerPower = 7.0)),
                fetchedAt = 1L,
            ),
        )
        // The charger node rounds to whole kW (web fmtNumber(.., 0)).
        compose.onNodeWithContentDescription("Charger 7 kW").assertIsDisplayed()
    }

    @Test
    fun compactHeroExposesAccessibleName() {
        setContent(
            state = UiState(UiPhase.Content, data = EnergyFlowAnimatedSnapshot(vehicleState(power = 11.0)), fetchedAt = 1L),
            size = EnergyFlowAnimatedSize(cols = 1, rows = 4),
        )
        compose.onNodeWithContentDescription("82%, Drive 11.0 kW").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedDiagramVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = EnergyFlowAnimatedSnapshot(vehicleState(power = 11.0)),
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached drive flow stays visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("Drive 11.0 kW").assertIsDisplayed()
    }
}
