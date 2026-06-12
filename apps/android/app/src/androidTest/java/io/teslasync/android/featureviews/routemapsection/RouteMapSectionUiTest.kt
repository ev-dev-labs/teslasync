package io.teslasync.android.featureviews.routemapsection

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
import java.time.ZoneOffset
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of the RouteMapSection across the states it renders WITHOUT
 * a live base map: the loading skeleton, the "No route data available for this drive" empty surface (with its
 * "Route" header title + refresh control), the hard error + retry surface, the header chrome, and the
 * accessible-summary list (the screen-reader start/end + stationary lines). The live `TeslaMap` body needs
 * Google Play Services on the device, so — following the maps-layer testing contract — the opaque map body is
 * covered by the no-device [RouteMapSectionProjectionTest] (trail / segments / markers / summary), while these
 * assert the SDK-free chrome + the screen-reader-visible labels.
 */
class RouteMapSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val zone = ZoneOffset.UTC

    private fun strings(): RouteMapStrings =
        RouteMapStrings(
            route = "Route",
            start = "Start",
            end = "End",
            inProgress = "In progress",
            lastKnown = "Last known location",
            stationaryTitle = "Route can't be plotted",
            stationaryBody = "Only one GPS coordinate was recorded for this drive.",
            noRouteData = "No route data available for this drive",
        )

    private fun movingRoute(): RouteMapSnapshot =
        RouteMapSnapshot(
            routePoints =
                listOf(
                    RouteMapPoint(47.610, -122.330, 5.0),
                    RouteMapPoint(47.620, -122.345, 50.0),
                ),
            positions = listOf(RouteMapLatLng(47.610, -122.330), RouteMapLatLng(47.620, -122.345)),
            startTs = "2026-03-14T09:15:00Z",
            endTs = "2026-03-14T09:42:00Z",
        )

    private fun stationaryRoute(): RouteMapSnapshot =
        RouteMapSnapshot(
            routePoints = listOf(RouteMapPoint(47.610, -122.330, 0.0), RouteMapPoint(47.610, -122.330, 0.0)),
            positions = listOf(RouteMapLatLng(47.610, -122.330), RouteMapLatLng(47.6100001, -122.3300001)),
            startTs = "2026-03-14T09:15:00Z",
            endTs = null,
        )

    private fun setContent(
        state: UiState<RouteMapSnapshot>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    RouteMapSectionContent(
                        state = state,
                        prefs = RouteMapDisplayPrefs.DEFAULT,
                        onRetry = onRetry,
                        zone = zone,
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
    fun emptyShowsRouteTitleNoRouteDataAndRefresh() {
        setContent(UiState(UiPhase.Empty, fetchedAt = 0L))
        compose.onNodeWithText("Route").assertIsDisplayed()
        compose.onNodeWithText("No route data available for this drive").assertIsDisplayed()
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
                    RouteMapHeader(
                        title = "Route",
                        fetchedAtMillis = 1_000L,
                        isFetching = false,
                        isStale = false,
                        isError = false,
                        onRefresh = {},
                    )
                }
            }
        }
        compose.onNodeWithText("Route").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun accessibleSummaryListsStartAndEndForAMeaningfulRoute() {
        val display = RouteMapProjection.project(movingRoute(), RouteMapDisplayPrefs(speedUnit(), 0, Locale.US), strings(), zone)
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host { MapAccessibleSummary(label = strings().route, lines = display.summaryLines) }
            }
        }
        compose.onNodeWithText("Start", substring = true).assertIsDisplayed()
        compose.onNodeWithText("End", substring = true).assertIsDisplayed()
    }

    @Test
    fun accessibleSummaryListsTheStationaryBannerCopy() {
        val display = RouteMapProjection.project(stationaryRoute(), RouteMapDisplayPrefs.DEFAULT, strings(), zone)
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host { MapAccessibleSummary(label = strings().route, lines = display.summaryLines) }
            }
        }
        compose.onNodeWithText("Last known location", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Route can't be plotted", substring = true).assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private fun speedUnit() = RouteMapDisplayPrefs.DEFAULT.speed

    private companion object {
        val HOST_WIDTH = 360.dp
        val HOST_HEIGHT = 720.dp
    }
}
