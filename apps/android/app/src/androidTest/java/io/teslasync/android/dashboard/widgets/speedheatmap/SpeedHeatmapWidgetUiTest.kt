package io.teslasync.android.dashboard.widgets.speedheatmap

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
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.api.generated.Drive
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.ZoneId
import java.util.Locale
import kotlin.time.Instant

/**
 * On-device Compose UI + accessibility verification of the SpeedHeatmapWidget across the states the web
 * component renders: the loading skeleton, the "No drive data yet" empty surface (with its header title +
 * refresh control), the hard error + retry surface, the standard/wide content (summary + grid with its
 * TalkBack description), the compact peak metric, and the wide header (the grid-icon title + refresh
 * control). Asserts every interactive element exposes an accessible name.
 */
class SpeedHeatmapWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val prefs = UnitFormatter.default().prefs

    private fun strings(): SpeedHeatmapStrings =
        SpeedHeatmapStrings(
            title = "Speed Heatmap",
            peakLabel = "Peak",
            slow = "Slow",
            fast = "Fast",
            empty = "No drive data yet",
            drivesSummary = { count -> "$count drives" },
            peakSpeedSummary = { speed, unit -> "Peak avg $speed $unit" },
            formatSpeed = { value -> value.toInt().toString() },
        )

    private fun drive(
        id: Long,
        avgSpeedMps: Double? = 10.0,
    ): Drive =
        Drive(
            createdAt = EPOCH,
            distanceM = 1_000.0,
            durationS = 600,
            id = id,
            startTs = EPOCH,
            updatedAt = EPOCH,
            vehicleId = 1,
            avgSpeedMps = avgSpeedMps,
        )

    private fun setContent(
        state: UiState<List<Drive>>,
        size: SpeedHeatmapSize = SpeedHeatmapRegistration.defaultSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    SpeedHeatmapWidgetContent(
                        state = state,
                        prefs = prefs,
                        size = size,
                        onRefresh = onRefresh,
                        locale = Locale.US,
                        zone = ZoneId.of("UTC"),
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
    fun emptyShowsHeaderTitleNoDataAndRefresh() {
        setContent(UiState(UiPhase.Empty, data = emptyList(), fetchedAt = 0L))
        compose.onNodeWithText("Speed Heatmap").assertIsDisplayed()
        compose.onNodeWithText("No drive data yet").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRefresh() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRefresh = { retried = true },
        )
        compose.onNodeWithText("Can't reach server").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun contentShowsSummaryAndAccessibleGridDescription() {
        setContent(UiState(UiPhase.Content, data = listOf(drive(id = 1)), fetchedAt = 100L))
        compose.onNodeWithText("Speed Heatmap").assertIsDisplayed()
        compose.onNodeWithText("1 drives").assertIsDisplayed()
        // The opaque grid carries a single TalkBack summary (web parity for the SVG heatmap).
        compose.onNodeWithContentDescription("1 drives", substring = true).assertIsDisplayed()
    }

    @Test
    fun compactShowsPeakMetric() {
        setContent(
            state = UiState(UiPhase.Content, data = listOf(drive(id = 1)), fetchedAt = 100L),
            size = SpeedHeatmapSize(cols = 1, rows = 4),
        )
        // 10 m/s → 36 km/h with the default (metric) units.
        compose.onNodeWithText("36").assertIsDisplayed()
        compose.onNodeWithText("Peak km/h").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun wideHeaderShowsTitleAndRefresh() {
        val display =
            SpeedHeatmapProjection.project(
                drives = listOf(drive(id = 1)),
                prefs = prefs,
                strings = strings(),
                size = SpeedHeatmapSize(cols = 3, rows = 4),
                zone = ZoneId.of("UTC"),
            )
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    SpeedHeatmapHeader(
                        display = display,
                        fetchedAtMillis = 1_000L,
                        isFetching = false,
                        isStale = false,
                        isError = false,
                        onRefresh = {},
                    )
                }
            }
        }
        compose.onNodeWithText("Speed Heatmap").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val EPOCH: Instant = Instant.fromEpochMilliseconds(0)
        val HOST_WIDTH = 360.dp
        val HOST_HEIGHT = 520.dp
    }
}
