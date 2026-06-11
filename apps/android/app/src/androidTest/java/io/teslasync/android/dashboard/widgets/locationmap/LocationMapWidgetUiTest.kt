package io.teslasync.android.dashboard.widgets.locationmap

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
 * On-device Compose UI + accessibility verification of the LocationMapWidget across the states the web
 * component renders WITHOUT a live base map: the loading skeleton, the "No location data available"
 * empty surface (with its header title + refresh), the hard error + retry surface, and the bottom-start
 * status overlay (the "Last known position" / "Heading: n°" / coordinate chips). The live `TeslaMap`
 * needs Google Play Services on the device, so — following the maps-layer testing contract established
 * by `MapsInteractionTest` — the opaque map body is covered by the no-device [LocationMapProjectionTest]
 * (center / zoom / marker heading / accessible description), while these assert the SDK-free chrome and
 * the screen-reader-visible overlay text + TalkBack labels.
 */
class LocationMapWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun strings(): LocationMapStrings =
        LocationMapStrings(
            title = "Vehicle Location Map",
            noData = "No location data available",
            lastKnown = "Last known position",
            heading = "Heading",
            refreshLabel = "Refresh",
            refreshingLabel = "Loading\u2026",
            offlineLabel = "Offline",
            formatRelative = { "" },
        )

    private fun located(
        heading: Double? = 270.0,
        isLive: Boolean = false,
    ): VehicleLocationData = VehicleLocationData(latitude = 37.4419, longitude = -122.143, heading = heading, isLive = isLive)

    private fun setContent(
        state: UiState<VehicleLocationData?>,
        size: LocationMapSize = LocationMapRegistration.defaultSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    LocationMapWidgetContent(
                        state = state,
                        size = size,
                        onRefresh = onRefresh,
                    )
                }
            }
        }
    }

    private fun setOverlay(
        data: VehicleLocationData,
        size: LocationMapSize = LocationMapRegistration.defaultSize,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    LocationMapStatusOverlay(display = LocationMapProjection.project(data, size, strings()))
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
        setContent(UiState(UiPhase.Empty, data = null, fetchedAt = 0L))
        compose.onNodeWithText("Vehicle Location Map").assertIsDisplayed()
        compose.onNodeWithText("No location data available").assertIsDisplayed()
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
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun statusOverlayShowsHeadingAndCoordinateChips() {
        setOverlay(located(heading = 270.0, isLive = false))
        compose.onNodeWithText("Heading: 270\u00B0").assertIsDisplayed()
        compose.onNodeWithText("37.4419, -122.1430").assertIsDisplayed()
    }

    @Test
    fun statusOverlayShowsLastKnownWhenNotLive() {
        setOverlay(located(isLive = false))
        compose.onNodeWithText("Last known position").assertIsDisplayed()
    }

    @Test
    fun statusOverlayHidesLastKnownWhenLive() {
        setOverlay(located(isLive = true))
        compose.onNodeWithText("Last known position").assertDoesNotExist()
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
