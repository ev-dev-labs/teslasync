package io.teslasync.android.featureviews.batteryrangecharts

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
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [BatteryRangeChartsContent] across every state the
 * surface renders: the loading skeleton chrome, the hard-error retry surface, the whole-surface empty state,
 * the populated two-panel content, the no-drives internal empty state, and the stale/offline cached view.
 * Asserts the rendered i18n strings (both panel titles, the empty-trend message), the opaque charts'
 * accessible descriptions (the gauge + the Current/Remaining bar split), the retry affordance, and the
 * freshness chip's TalkBack label. The offline gate's `testReleaseUnitTest` covers the pure logic; this
 * covers render + a11y. Mirrors the web spec
 * (web/src/features/vehicles/components/vehicle-detail/BatteryRangeCharts.tsx).
 */
class BatteryRangeChartsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val batteryTitle = "Battery Overview"
    private val driveTitle = "Drive Distance Trend"

    private fun data(drives: List<DriveSample> = sampleDrives()): BatteryRangeData =
        BatteryRangeData(
            battery = VehicleBatteryState(batteryLevelPct = 72.0, ratedRangeMeters = 412_000.0),
            drives = drives,
        )

    private fun sampleDrives(): List<DriveSample> =
        listOf(
            DriveSample(startTs = "2026-03-18T08:00:00Z", distanceMeters = 42_000.0, durationSeconds = 2_700.0),
            DriveSample(startTs = "2026-03-16T18:15:00Z", distanceMeters = 18_500.0, durationSeconds = 1_500.0),
        )

    private fun setContent(
        state: UiState<BatteryRangeData>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                BatteryRangeChartsContent(
                    state = state,
                    onRetry = onRetry,
                    distanceUnit = DistanceUnitPref.KM,
                    locale = Locale.US,
                    zone = ZoneId.of("UTC"),
                )
            }
        }
    }

    @Test
    fun loadingShowsSkeletonChromeNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading").assertExists()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Something went wrong on our end. Please try again.").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptySurfaceShowsTheNoDataMessage() {
        setContent(UiState(UiPhase.Empty, data = null))
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun contentRendersBothPanelTitlesAndAccessibleChartDescriptions() {
        setContent(UiState(UiPhase.Content, data = data()))
        compose.onNodeWithText(batteryTitle).assertIsDisplayed()
        compose.onNodeWithText(driveTitle).assertIsDisplayed()
        // The radial gauge's screen-reader description (web RadialGauge label + value).
        compose.onNodeWithContentDescription("Battery: 72 %").assertExists()
        // The opaque battery bar canvas exposes the Current/Remaining split for TalkBack.
        compose.onNodeWithContentDescription("Battery Overview: Current 72%, Remaining 28%").assertExists()
    }

    @Test
    fun contentWithNoDrivesShowsTheTrendEmptyStateNotABlankPanel() {
        setContent(UiState(UiPhase.Content, data = data(drives = emptyList())))
        // The battery panel still renders…
        compose.onNodeWithText(batteryTitle).assertIsDisplayed()
        // …and the trend panel shows its internal empty state, never a blank box.
        compose.onNodeWithText(driveTitle).assertIsDisplayed()
        compose.onNodeWithText("No drive data for chart").assertIsDisplayed()
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = data(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText(batteryTitle).assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = data(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText(batteryTitle).assertIsDisplayed()
        assertTrue(refreshed)
    }
}
