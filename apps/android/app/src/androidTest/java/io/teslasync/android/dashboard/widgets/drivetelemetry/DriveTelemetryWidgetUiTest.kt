package io.teslasync.android.dashboard.widgets.drivetelemetry

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.api.generated.DriveTelemetryReading
import io.teslasync.shared.core.units.UnitPref
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.ZoneId
import kotlin.time.Instant

/**
 * Instrumented Compose UI + accessibility verification of [DriveTelemetryWidgetContent] across every
 * state the web component renders (loading skeleton, no-recent-drives empty, no-telemetry empty, hard
 * error + retry, the standard stats + chart + legend body, the wide elevation + address badge, the
 * compact summary, and the stale/offline cached path). Asserts the rendered i18n strings and the
 * TalkBack content descriptions are present. Runs under `connectedAndroidTest`; the offline gate's
 * `testReleaseUnitTest` covers the pure logic, this covers the render.
 */
class DriveTelemetryWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val prefs: UnitPref = UnitPreferences.fromSettings(null)
    private val utc = ZoneId.of("UTC")

    private fun drive(startAddress: String? = "123 Main St"): Drive =
        Drive(
            createdAt = Instant.parse("2024-01-01T09:00:00Z"),
            distanceM = 16_093.44,
            durationS = 1_800,
            id = 1,
            startTs = Instant.parse("2024-01-01T09:00:00Z"),
            updatedAt = Instant.parse("2024-01-01T09:00:00Z"),
            vehicleId = 7,
            energyUsedWh = 4_000.0,
            startAddress = startAddress,
        )

    private fun telemetry(): List<DriveTelemetryReading> =
        listOf(
            reading(ts = "2024-01-01T09:05:00Z", speed = 0.0, power = 10.0, batteryLevel = 80, elevation = 100.0),
            reading(ts = "2024-01-01T09:10:00Z", speed = 20.0, power = 40.0, batteryLevel = 70, elevation = 160.0),
        )

    @Suppress("LongParameterList")
    private fun reading(
        ts: String,
        speed: Double?,
        power: Double?,
        batteryLevel: Long?,
        elevation: Double?,
    ): DriveTelemetryReading =
        DriveTelemetryReading(
            createdAt = Instant.parse(ts),
            driveId = 1,
            id = 1,
            vehicleId = 7,
            speed = speed,
            power = power,
            batteryLevel = batteryLevel,
            elevation = elevation,
        )

    private fun setContent(
        state: UiState<DriveTelemetrySnapshot>,
        size: DriveTelemetrySize = DriveTelemetryRegistration.defaultSize,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    DriveTelemetryWidgetContent(
                        state = state,
                        prefs = prefs,
                        size = size,
                        onRetry = onRetry,
                        zone = utc,
                    )
                }
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Drive Telemetry").assertIsDisplayed()
    }

    @Test
    fun noRecentDrivesShowsFriendlyEmptyMessage() {
        setContent(UiState(UiPhase.Empty, data = DriveTelemetrySnapshot(drive = null), fetchedAt = NOW))
        compose.onNodeWithText("No recent drives").assertIsDisplayed()
    }

    @Test
    fun driveWithoutTelemetryShowsNoTelemetryMessage() {
        setContent(UiState(UiPhase.Content, data = DriveTelemetrySnapshot(drive(), emptyList()), fetchedAt = NOW))
        compose.onNodeWithText("No telemetry for this drive").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = { retried = true },
        )
        compose.onNodeWithText("Can't reach server").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun standardShowsTitleStatsChartLegendAndRefresh() {
        setContent(UiState(UiPhase.Content, data = DriveTelemetrySnapshot(drive(), telemetry()), fetchedAt = NOW))
        compose.onNodeWithText("Drive Telemetry").assertIsDisplayed()
        compose.onNodeWithText("Distance").assertIsDisplayed()
        // Legend series labels render below the chart.
        compose.onNodeWithText("Speed").assertIsDisplayed()
        compose.onNodeWithText("Battery %").assertIsDisplayed()
        // The header refresh control exposes an accessible name (TalkBack).
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun wideShowsElevationLegendAndAddressBadge() {
        setContent(
            state = UiState(UiPhase.Content, data = DriveTelemetrySnapshot(drive(), telemetry()), fetchedAt = NOW),
            size = DriveTelemetrySize(cols = 4, rows = 4),
        )
        compose.onNodeWithText("Elevation").assertIsDisplayed()
        compose.onNodeWithContentDescription("123 Main St").assertIsDisplayed()
    }

    @Test
    fun compactShowsSummaryStats() {
        setContent(
            state = UiState(UiPhase.Content, data = DriveTelemetrySnapshot(drive(), telemetry()), fetchedAt = NOW),
            size = DriveTelemetrySize(cols = 1, rows = 4),
        )
        compose.onNodeWithText("Distance").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = DriveTelemetrySnapshot(drive(), telemetry()),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached stats stay visible (never blanked) when offline/stale.
        compose.onNodeWithText("Distance").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
        val HOST_WIDTH = 360.dp
        val HOST_HEIGHT = 560.dp
    }
}
