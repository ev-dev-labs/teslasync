package io.teslasync.android.featureviews.tripplannermap

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
 * On-device Compose UI + accessibility verification of the TripPlannerMap across the states it renders WITHOUT a
 * live base map: the loading skeleton, the "Enter origin and destination to see the route" empty surface, the
 * hard error + retry surface, the route header chrome (the "{origin} → {destination}" title + refresh control),
 * and the accessible-summary list (the screen-reader origin / destination / charge-stop lines). The live
 * `TeslaMap` body needs Google Play Services on the device, so — following the maps-layer testing contract — the
 * opaque map body's derivations (polyline, markers, summary) are covered by the no-device
 * [TripPlannerMapProjectionTest], while these assert the SDK-free chrome + the screen-reader-visible labels.
 */
class TripPlannerMapUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<TripPlannerMapSnapshot>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    TripPlannerMapContent(state = state, onRetry = onRetry)
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
    fun emptyShowsThePromptToEnterEndpoints() {
        setContent(UiState(UiPhase.Empty))
        compose.onNodeWithText("Enter origin and destination to see the route").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun headerShowsTheRouteTitleAndRefreshLabel() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    TripPlannerMapHeader(
                        title = "Home \u2192 Work",
                        fetchedAtMillis = 1_000L,
                        isFetching = false,
                        isStale = false,
                        isError = false,
                        onRefresh = {},
                    )
                }
            }
        }
        compose.onNodeWithText("Home", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun accessibleSummaryListsOriginDestinationAndChargeStop() {
        val stop =
            TripChargeStop(
                name = "Supercharger",
                location = TripLocation(47.615, -122.338),
                chargeFromSoc = 30.0,
                chargeToSoc = 70.0,
                chargeDurationS = 1800.0,
            )
        val display =
            TripPlannerMapProjection.project(
                TripPlannerMapSnapshot(
                    origin = TripLocation(47.610, -122.330, name = "Home"),
                    destination = TripLocation(47.620, -122.345, name = "Work"),
                    chargeStops = listOf(stop),
                ),
                TripPlannerMapStrings(origin = "Origin", destination = "Destination", empty = "Enter endpoints"),
            )
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host { MapAccessibleSummary(label = display.routeLabel, lines = display.summaryLines) }
            }
        }
        compose.onNodeWithText("Home", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Work", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Supercharger", substring = true).assertIsDisplayed()
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
