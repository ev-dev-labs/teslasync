package io.teslasync.android.featureviews.tripreplaymap

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
import io.teslasync.android.components.maps.MapAccessibleSummary
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the TripReplayMap across the states it renders WITHOUT a
 * live base map: the loading skeleton, the "No position data available for this drive" empty surface (with its
 * "Trip Replay" header title + refresh control), the hard error + retry surface, the header chrome, and the
 * accessible-summary list (the screen-reader start/end + stationary lines). The live `TeslaMap` body needs Google
 * Play Services on the device, so — following the maps-layer testing contract — the opaque map body is covered by
 * the no-device [TripReplayMapProjectionTest] (trail / segments / markers / summary), while these assert the
 * SDK-free chrome + the screen-reader-visible labels.
 */
class TripReplayMapUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun strings(): TripReplayMapStrings =
        TripReplayMapStrings(
            routeLabel = "Trip Replay",
            start = "Start",
            end = "End",
            stationaryTitle = "Route can't be plotted",
            stationaryBody = "Only one GPS coordinate was recorded for this drive.",
            noPositions = "No position data available for this drive",
        )

    private fun movingRoute(): TripReplayMapSnapshot =
        TripReplayMapSnapshot(
            positions =
                listOf(
                    ReplayPosition(47.610, -122.330, 5.0),
                    ReplayPosition(47.620, -122.345, 50.0),
                ),
        )

    private fun stationaryRoute(): TripReplayMapSnapshot =
        TripReplayMapSnapshot(
            positions =
                listOf(
                    ReplayPosition(47.610, -122.330, 0.0),
                    ReplayPosition(47.6100001, -122.3300001, 0.0),
                ),
        )

    private fun setContent(
        state: UiState<TripReplayMapSnapshot>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    TripReplayMapContent(
                        state = state,
                        currentIndex = 0,
                        onSeekToIndex = {},
                        onRetry = onRetry,
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
    fun emptyShowsTripReplayTitleNoPositionsAndRefresh() {
        setContent(UiState(UiPhase.Empty, fetchedAt = 0L))
        compose.onNodeWithText("Trip Replay").assertIsDisplayed()
        compose.onNodeWithText("No position data available for this drive").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun headerShowsTitleAndRefreshLabel() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    TripReplayMapHeader(
                        title = "Trip Replay",
                        fetchedAtMillis = 1_000L,
                        isFetching = false,
                        isStale = false,
                        isError = false,
                        onRefresh = {},
                    )
                }
            }
        }
        compose.onNodeWithText("Trip Replay").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun accessibleSummaryListsStartAndEndForAMeaningfulRoute() {
        val display = TripReplayMapProjection.project(movingRoute(), strings())
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host { MapAccessibleSummary(label = strings().routeLabel, lines = display.summaryLines) }
            }
        }
        compose.onNodeWithText("Start", substring = true).assertIsDisplayed()
        compose.onNodeWithText("End", substring = true).assertIsDisplayed()
    }

    @Test
    fun accessibleSummaryListsTheStationaryBannerCopy() {
        val display = TripReplayMapProjection.project(stationaryRoute(), strings())
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host { MapAccessibleSummary(label = strings().routeLabel, lines = display.summaryLines) }
            }
        }
        compose.onNodeWithText("Route can't be plotted", substring = true).assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 360.dp
        val HOST_HEIGHT = 720.dp
    }
}
