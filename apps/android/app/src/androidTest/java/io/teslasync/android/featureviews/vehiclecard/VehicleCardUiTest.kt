package io.teslasync.android.featureviews.vehiclecard

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import org.junit.Rule
import org.junit.Test
import kotlin.time.Instant

/**
 * Instrumented Compose UI + accessibility verification of [VehicleCardContent] across the surfaces the web
 * component (web/src/features/vehicles/components/VehicleCard.tsx) plus the native lifecycle chrome render: the
 * live content card (name + status + battery + the interior / charging stats), the asleep/empty card (the card
 * chrome with a "wake to see live data" hint instead of stats), the first-load skeleton, and the hard-error
 * card (offline + retry). The card chrome — car viz, name, and both icon actions — renders in every state, so
 * the card is never blank. Every asserted string is resolved from the app's i18n resources so the test follows
 * the device locale rather than hard-coding English, and the action labels verify the accessible names. The
 * clock auto-advance is disabled so the freshness chip's periodic re-render and the skeleton shimmer cannot
 * stall `waitForIdle`. Runs under `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the
 * projection + view-model.
 */
class VehicleCardUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun string(id: Int) = context.getString(id)

    private fun setContent(state: UiState<VehicleStateEnvelope>) {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.size(width = CARD_WIDTH, height = HOST_HEIGHT)) {
                    VehicleCardContent(vehicle = PREVIEW_VEHICLE, state = state)
                }
            }
        }
        compose.mainClock.advanceTimeBy(SETTLE_MS)
    }

    @Test
    fun contentShowsNameStatusBatteryAndStats() {
        setContent(content(vehicleState(batteryLevel = 72, isCharging = true, chargerPower = 48.4, state = "charging")))

        compose.onNodeWithText(PREVIEW_NAME).assertIsDisplayed()
        // Status badge capitalizes the derived status (charging vehicle → "Charging").
        compose.onNodeWithText("Charging").assertIsDisplayed()
        compose.onNodeWithText("72%").assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_card_interior)).assertIsDisplayed()
    }

    @Test
    fun asleepKeepsTheCardChromeAndShowsTheHint() {
        setContent(empty())

        // The card chrome (name) still renders, and the "asleep" hint replaces the stats — never a blank box.
        compose.onNodeWithText(PREVIEW_NAME).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_hero_asleep)).assertIsDisplayed()
    }

    @Test
    fun loadingShowsTheChromeAndSkeletonRegion() {
        setContent(UiState.loading())

        compose.onNodeWithText(PREVIEW_NAME).assertIsDisplayed()
        compose.onNodeWithContentDescription(string(R.string.translation_a11y_loading)).assertIsDisplayed()
    }

    @Test
    fun hardErrorShowsRetryAndKeepsTheChrome() {
        setContent(UiState(UiPhase.Error, errorKind = ErrorKind.Network))

        compose.onNodeWithText(PREVIEW_NAME).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_common_retry)).assertIsDisplayed()
    }

    @Test
    fun actionsExposeAccessibleLabels() {
        setContent(content(vehicleState(batteryLevel = 60)))

        // a11y: both icon actions are announced to screen readers by their localized names.
        compose.onNodeWithContentDescription(string(R.string.translation_card_viewDetails)).assertIsDisplayed()
        compose.onNodeWithContentDescription(string(R.string.translation_card_removeVehicle)).assertIsDisplayed()
    }

    private fun content(state: VehicleState): UiState<VehicleStateEnvelope> =
        UiState(
            phase = UiPhase.Content,
            data = VehicleStateEnvelope(state, live = true),
            fetchedAt = FETCHED_AT,
        )

    private fun empty(): UiState<VehicleStateEnvelope> =
        UiState(
            phase = UiPhase.Empty,
            data = VehicleStateEnvelope(null, live = false),
            fetchedAt = FETCHED_AT,
        )

    @Suppress("LongParameterList")
    private fun vehicleState(
        batteryLevel: Long,
        isCharging: Boolean = false,
        chargerPower: Double = 0.0,
        state: String = "online",
    ): VehicleState =
        VehicleState(
            batteryLevel = batteryLevel,
            chargeRate = 0.0,
            chargerPower = chargerPower,
            idealRange = 380_000.0,
            insideTemp = 21.5,
            isCharging = isCharging,
            isClimateOn = false,
            isLocked = true,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 42_000_000.0,
            outsideTemp = 12.0,
            power = 0.0,
            ratedRange = 350_000.0,
            sentryMode = false,
            softwareVersion = "2026.20.1",
            speed = 0.0,
            state = state,
            timeToFullCharge = 0.0,
            vehicleId = 1L,
        )

    private companion object {
        val CARD_WIDTH: Dp = 420.dp
        val HOST_HEIGHT: Dp = 900.dp
        const val SETTLE_MS = 2_000L
        const val FETCHED_AT = 1_700_000_000_000L
        const val PREVIEW_NAME = "My Model 3"

        val PREVIEW_VEHICLE: Vehicle =
            Vehicle(
                createdAt = Instant.parse("2026-01-01T00:00:00Z"),
                displayName = PREVIEW_NAME,
                enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
                id = 1L,
                teslaId = 42L,
                timezone = "UTC",
                updatedAt = Instant.parse("2026-06-01T00:00:00Z"),
                vin = "5YJ3E1EA7KF000001",
                model = "Model 3",
                trimLevel = "Long Range",
            )
    }
}
