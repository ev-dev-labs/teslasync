package io.teslasync.android.dashboard.widgets.geofence

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
import io.teslasync.shared.core.presentation.locations.Geofence
import io.teslasync.shared.core.units.UnitPref
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [GeofenceWidgetContent] across every state the
 * web component renders (loading skeleton, "No geofences configured" empty, the standard fence list with
 * Inside / Outside / Disabled badges + refresh, the compact current-zone badge, the compact "No zone"
 * badge, and the stale/offline cached path). Asserts the rendered i18n strings and the TalkBack content
 * descriptions are present. The map-bearing footprint (rows >= 3 with coordinates) needs Play Services,
 * so these render tests pin the deterministic map-free footprints; the offline gate's
 * `testReleaseUnitTest` covers the projection + combine logic, this covers the render.
 */
class GeofenceWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val units: UnitPref = UnitFormatter.default().prefs

    @Suppress("LongParameterList")
    private fun geofence(
        id: Long,
        name: String,
        latitude: Double,
        longitude: Double,
        radius: Double,
        enabled: Boolean = true,
    ): Geofence =
        Geofence(
            id = id,
            name = name,
            polygonWkt = "",
            createdAt = "2024-01-01T00:00:00Z",
            updatedAt = "2024-01-01T00:00:00Z",
            latitude = latitude,
            longitude = longitude,
            radius = radius,
            enabled = enabled,
        )

    private fun mixedFeed(): GeofenceFeed =
        GeofenceFeed(
            coords = GeoCoordinate(37.0, -122.0),
            fences =
                listOf(
                    geofence(1, "Home", 37.0, -122.0, 1_000.0),
                    geofence(2, "Office", 40.0, -100.0, 100.0),
                    geofence(3, "Cabin", 37.0, -122.0, 1_000.0, enabled = false),
                ),
        )

    private fun setContent(
        state: UiState<GeofenceFeed>,
        size: GeofenceSize = GeofenceSize(cols = 2, rows = 2),
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    GeofenceWidgetContent(
                        state = state,
                        size = size,
                        units = units,
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
    fun emptyShowsNoGeofencesMessage() {
        setContent(UiState(UiPhase.Empty, data = GeofenceFeed.EMPTY, fetchedAt = 0L))
        compose.onNodeWithText("No geofences configured").assertIsDisplayed()
    }

    @Test
    fun standardShowsTitleFencesStatusesRadiusAndRefresh() {
        setContent(UiState(UiPhase.Content, data = mixedFeed(), fetchedAt = NOW))
        compose.onNodeWithText("Geofence Status").assertIsDisplayed()
        compose.onNodeWithText("Home").assertIsDisplayed()
        compose.onNodeWithText("Office").assertIsDisplayed()
        compose.onNodeWithText("Cabin").assertIsDisplayed()
        // Inside (Home, at the vehicle), Outside (Office, far away), Disabled (Cabin) badges.
        compose.onNodeWithText("Inside").assertIsDisplayed()
        compose.onNodeWithText("Outside").assertIsDisplayed()
        compose.onNodeWithText("Disabled").assertIsDisplayed()
        // The unit-converted radius label renders (Office radius 100 m -> "0.1 km").
        compose.onNodeWithText("Radius: 0.1 km").assertIsDisplayed()
        // The header refresh control exposes an accessible name (TalkBack).
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun refreshAffordanceInvokesCallback() {
        var refreshed = false
        setContent(
            state = UiState(UiPhase.Content, data = mixedFeed(), fetchedAt = NOW),
            onRefresh = { refreshed = true },
        )
        compose.onNodeWithContentDescription("Refresh").performClick()
        assertTrue(refreshed)
    }

    @Test
    fun compactShowsCurrentZoneBadge() {
        setContent(
            state = UiState(UiPhase.Content, data = mixedFeed(), fetchedAt = NOW),
            size = GeofenceSize(cols = 1, rows = 2),
        )
        // The vehicle is inside the enabled "Home" fence -> the compact body shows its name.
        compose.onNodeWithText("Home").assertIsDisplayed()
    }

    @Test
    fun compactShowsNoZoneWhenOutsideEveryFence() {
        val noZone =
            GeofenceFeed(
                coords = null,
                fences = listOf(geofence(1, "Home", 37.0, -122.0, 1_000.0)),
            )
        setContent(
            state = UiState(UiPhase.Content, data = noZone, fetchedAt = NOW),
            size = GeofenceSize(cols = 1, rows = 2),
        )
        compose.onNodeWithText("No zone").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedFenceListVisible() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = mixedFeed(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached fences stay visible (never blanked) when offline/stale.
        compose.onNodeWithText("Home").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
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
