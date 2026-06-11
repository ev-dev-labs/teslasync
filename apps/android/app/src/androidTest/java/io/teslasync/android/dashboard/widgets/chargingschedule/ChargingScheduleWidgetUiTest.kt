package io.teslasync.android.dashboard.widgets.chargingschedule

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.presentation.signals.SignalEnvelope
import io.teslasync.shared.core.presentation.signals.SignalKind
import io.teslasync.shared.core.presentation.signals.SignalValue
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [ChargingScheduleWidgetContent] across every state
 * the web component renders (loading skeleton, empty, hard error + retry, wide content with mode badge +
 * timeline, tall current-level/status row, compact charge-limit hero, stale/offline cached). Asserts the
 * rendered i18n strings and the TalkBack content descriptions are present. Runs under
 * `connectedAndroidTest` (a device/emulator) — the offline gate's `testReleaseUnitTest` covers the logic;
 * this covers the render.
 */
class ChargingScheduleWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val tallSize = ChargingScheduleSize(cols = 2, rows = 2)

    private fun text(value: String) = SignalEnvelope(SignalKind.String, SignalValue.Text(value), TS)

    private fun bool(value: Boolean) = SignalEnvelope(SignalKind.Bool, SignalValue.Bool(value), TS)

    private fun num(value: Double) = SignalEnvelope(SignalKind.Float, SignalValue.Num(value), TS)

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
            softwareVersion = "2026.0",
            speed = 0.0,
            state = "online",
            timeToFullCharge = 0.0,
            vehicleId = 1,
        )

    private fun setContent(
        state: UiState<ChargingScheduleData>,
        size: ChargingScheduleSize = tallSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ChargingScheduleWidgetContent(
                    state = state,
                    size = size,
                    onRefresh = onRefresh,
                )
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyShowsFriendlyMessage() {
        setContent(UiState(UiPhase.Empty, data = ChargingScheduleData.EMPTY, fetchedAt = 1L))
        compose.onNodeWithText("No schedule data").assertIsDisplayed()
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
    fun wideContentShowsModeBadgeAndTimeline() {
        val data =
            ChargingScheduleData(
                signals =
                    mapOf(
                        ScheduleSignalKeys.MODE to text("StartAt"),
                        ScheduleSignalKeys.PENDING to bool(true),
                        ScheduleSignalKeys.START_TIME to text("2026-06-11T23:00:00Z"),
                    ),
                state = null,
            )
        setContent(UiState(UiPhase.Content, data = data, fetchedAt = 1L))
        compose.onNodeWithText("Start At").assertIsDisplayed()
        // Timeline row folds title + time (+ pending) into one TalkBack phrase.
        compose.onNodeWithContentDescription("Start Charging", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun tallContentShowsCurrentLevelAndStatus() {
        val data =
            ChargingScheduleData(
                signals = mapOf(ScheduleSignalKeys.MODE to text("StartAt")),
                state = vehicleState(batteryLevel = 58, isCharging = true),
            )
        setContent(UiState(UiPhase.Content, data = data, fetchedAt = 1L))
        compose.onNodeWithContentDescription("Current Level", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Status, Charging").assertIsDisplayed()
    }

    @Test
    fun compactHeroExposesChargeLimitAndAccessibleName() {
        val data = ChargingScheduleData(signals = mapOf(ScheduleSignalKeys.CHARGE_LIMIT to num(80.0)), state = null)
        setContent(
            state = UiState(UiPhase.Content, data = data, fetchedAt = 1L),
            size = ChargingScheduleSize(cols = 1, rows = 1),
        )
        compose.onNodeWithContentDescription("Charge Limit", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("80%", substring = true).assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        val data = ChargingScheduleData(signals = mapOf(ScheduleSignalKeys.MODE to text("StartAt")), state = null)
        setContent(
            UiState(
                UiPhase.Content,
                data = data,
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached schedule stays visible (never blanked) when offline/stale.
        compose.onNodeWithText("Start At").assertIsDisplayed()
    }

    private companion object {
        private const val TS = "2026-06-11T10:00:00Z"
    }
}
