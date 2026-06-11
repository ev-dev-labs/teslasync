package io.teslasync.android.dashboard.widgets.positionheatmap

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
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the PositionHeatmapWidget across the states the
 * web component renders WITHOUT a live base map: the loading skeleton, the "No position data" empty
 * surface (with its header title + refresh control), the hard error + retry surface, and the
 * standard/wide header (the map icon title + the "{n} positions" count badge). The live `TeslaMap`
 * needs Google Play Services on the device, so — following the maps-layer testing contract — the opaque
 * density map body is covered by the no-device [PositionHeatmapProjectionTest] (clusters / centroid /
 * colour ramp / radius), while these assert the SDK-free chrome + the screen-reader-visible labels.
 */
class PositionHeatmapWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun strings(): PositionHeatmapStrings =
        PositionHeatmapStrings(
            title = "Position Heatmap",
            noData = "No position data",
            countLabel = { count -> "$count positions" },
        )

    private fun setContent(
        state: UiState<List<HeatPosition>>,
        size: PositionHeatmapSize = PositionHeatmapRegistration.defaultSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    PositionHeatmapWidgetContent(
                        state = state,
                        size = size,
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
    fun emptyShowsHeaderTitleNoDataAndRefresh() {
        setContent(UiState(UiPhase.Empty, data = emptyList(), fetchedAt = 0L))
        compose.onNodeWithText("Position Heatmap").assertIsDisplayed()
        compose.onNodeWithText("No position data").assertIsDisplayed()
        // The header refresh control exposes an accessible name (TalkBack).
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
    fun wideHeaderShowsTitleAndCountBadge() {
        val display =
            PositionHeatmapProjection.project(
                positions = List(42) { HeatPosition(37.5, -122.25) },
                size = PositionHeatmapSize(cols = 3, rows = 4),
                strings = strings(),
            )
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    PositionHeatmapHeader(
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
        compose.onNodeWithText("Position Heatmap").assertIsDisplayed()
        compose.onNodeWithText("42 positions").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 360.dp
        val HOST_HEIGHT = 520.dp
    }
}
