package io.teslasync.android.dashboard.widgets.driveefficiencychart

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.units.DistanceUnitPref
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import kotlin.time.Instant

/**
 * Instrumented Compose UI + accessibility verification of [DriveEfficiencyChartWidgetContent] across
 * every state the web component renders (loading skeleton, hard error + retry, the Avg/Best/Trend stat
 * row + chart + legend, the friendly empty state, the compact stats-only footprint, and the
 * stale/offline cached path). Asserts the rendered i18n strings and the TalkBack content descriptions
 * are present. Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the
 * pure logic, this covers the render + a11y.
 */
class DriveEfficiencyChartWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<List<Drive>>,
        size: DriveEfficiencySize = DriveEfficiencyRegistration.defaultSize,
        distanceUnit: DistanceUnitPref = DistanceUnitPref.KM,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    DriveEfficiencyChartWidgetContent(
                        state = state,
                        size = size,
                        onRetry = onRetry,
                        distanceUnit = distanceUnit,
                    )
                }
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
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
    fun emptyShowsFriendlyMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList(), fetchedAt = NOW))
        compose.onNodeWithText("No efficiency data yet").assertIsDisplayed()
    }

    @Test
    fun contentShowsTitleStatsLegendAndRefresh() {
        setContent(UiState(UiPhase.Content, data = recentDrives(), fetchedAt = NOW))
        compose.onNodeWithText("Drive Efficiency").assertIsDisplayed()
        compose.onNodeWithText("Avg").assertIsDisplayed()
        compose.onNodeWithText("Best day").assertIsDisplayed()
        compose.onNodeWithText("Trend").assertIsDisplayed()
        // The rolling-average legend entry (web `7-day avg`).
        compose.onNodeWithText("7-day avg").assertIsDisplayed()
        // The header refresh control exposes an accessible name (TalkBack).
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun compactFootprintShowsStatsOnlyWithoutTitle() {
        setContent(
            state = UiState(UiPhase.Content, data = recentDrives(), fetchedAt = NOW),
            size = DriveEfficiencySize(cols = 1, rows = 1),
        )
        compose.onNodeWithText("Avg").assertIsDisplayed()
        // The compact branch hides the title + chart (web `WidgetShell` compact title omission).
        compose.onNodeWithText("Drive Efficiency").assertDoesNotExist()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = recentDrives(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached stats stay visible (never blanked) when offline/stale.
        compose.onNodeWithText("Avg").assertIsDisplayed()
    }

    /** Four drives on distinct recent UTC days, each with a plausible measured efficiency. */
    private fun recentDrives(): List<Drive> {
        val base = System.currentTimeMillis()
        return listOf(
            drive(base - DAYS_4, energyUsedWh = 1_500.0),
            drive(base - DAYS_3, energyUsedWh = 1_600.0),
            drive(base - DAYS_2, energyUsedWh = 1_400.0),
            drive(base - DAYS_1, energyUsedWh = 1_550.0),
        )
    }

    private fun drive(
        startTsMillis: Long,
        energyUsedWh: Double,
    ): Drive =
        Drive(
            createdAt = Instant.fromEpochMilliseconds(startTsMillis),
            distanceM = 10_000.0,
            durationS = 600L,
            id = startTsMillis,
            startTs = Instant.fromEpochMilliseconds(startTsMillis),
            updatedAt = Instant.fromEpochMilliseconds(startTsMillis),
            vehicleId = 1L,
            energyUsedWh = energyUsedWh,
            startBatteryPct = 80,
            endBatteryPct = 70,
        )

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
        const val DAY_MS = 86_400_000L
        const val DAYS_1 = DAY_MS
        const val DAYS_2 = 2 * DAY_MS
        const val DAYS_3 = 3 * DAY_MS
        const val DAYS_4 = 4 * DAY_MS
        val HOST_WIDTH = 360.dp
        val HOST_HEIGHT = 520.dp
    }
}
