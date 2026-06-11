package io.teslasync.android.dashboard.widgets.chargingsessiondetail

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.api.generated.ChargeTelemetryReading
import io.teslasync.shared.core.api.generated.ChargingSession
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.ZoneId
import kotlin.time.Instant

/**
 * On-device Compose UI + accessibility verification of [ChargingSessionDetailWidgetContent] across every
 * state the web component renders (loading skeleton, empty, hard error + retry, standard summary+curve
 * content, compact hero, stale/offline cached). Asserts the rendered i18n strings and the TalkBack content
 * descriptions are present. Runs under `connectedAndroidTest` (a device/emulator) — the offline gate's
 * `testReleaseUnitTest` covers the projection/holder logic; this covers the render.
 */
class ChargingSessionDetailWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val utc = ZoneId.of("UTC")

    private fun session(): ChargingSession =
        ChargingSession(
            id = 1,
            startedAt = Instant.parse("2024-01-01T10:00:00Z"),
            vehicleId = 7,
            chargerType = "Supercharger",
            endedAt = Instant.parse("2024-01-01T10:45:00Z"),
            totalEnergyAddedWh = 32_500.0,
            startSocPct = 20.0,
            endSocPct = 80.0,
        )

    private fun telemetry(): List<ChargeTelemetryReading> =
        listOf(
            ChargeTelemetryReading(ts = Instant.parse("2024-01-01T10:00:00Z"), vehicleId = 7, dcChargingPowerW = 110_000.0),
            ChargeTelemetryReading(ts = Instant.parse("2024-01-01T10:30:00Z"), vehicleId = 7, dcChargingPowerW = 70_000.0),
        )

    private fun snapshot(): ChargingSessionDetailSnapshot = ChargingSessionDetailSnapshot(detail = session(), telemetry = telemetry())

    private fun setContent(
        state: UiState<ChargingSessionDetailSnapshot>,
        size: ChargingSessionDetailSize = ChargingSessionDetailRegistration.defaultSize,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ChargingSessionDetailWidgetContent(
                    state = state,
                    size = size,
                    onRetry = onRetry,
                    zone = utc,
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
        setContent(UiState(UiPhase.Empty, data = ChargingSessionDetailSnapshot(detail = null), fetchedAt = 0L))
        compose.onNodeWithText("No charge sessions").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500),
            onRetry = { retried = true },
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun standardContentShowsTitleStatsAndRefresh() {
        setContent(UiState(UiPhase.Content, data = snapshot(), fetchedAt = NOW))
        compose.onNodeWithText("Charge Session Detail").assertIsDisplayed()
        // Each summary stat folds label + value (+ unit) into one TalkBack phrase.
        compose.onNodeWithContentDescription("Energy Added: 32.5 kWh", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Charger: Supercharger", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun compactHeroExposesEnergyAndChargerAccessibleName() {
        setContent(
            state = UiState(UiPhase.Content, data = snapshot(), fetchedAt = NOW),
            size = ChargingSessionDetailSize(cols = 1, rows = 2),
        )
        compose.onNodeWithContentDescription("kWh added", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Supercharger", substring = true).assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = snapshot(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )
        // Cached stats stay visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("Energy Added: 32.5 kWh", substring = true).assertIsDisplayed()
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
    }
}
