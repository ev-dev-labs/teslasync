package io.teslasync.android.dashboard.widgets.locationfavorites

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
import io.teslasync.shared.core.presentation.locations.VisitedLocation
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.Instant

/**
 * On-device Compose UI + accessibility verification of [LocationFavoritesWidgetContent] across every
 * state the web component renders (loading skeleton, "No favorite locations" empty body, hard error +
 * retry, the full title + ranked list, the full idle badge body, the compact location badge, and the
 * stale/offline cached path). Asserts the rendered i18n strings and the TalkBack content descriptions
 * are present. Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the
 * logic, this covers the render.
 */
class LocationFavoritesWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val twoDaysAgoIso: String = Instant.ofEpochMilli(NOW - TWO_DAYS_MS).toString()

    private fun garage(): VisitedLocation =
        VisitedLocation(
            id = 1L,
            vehicleId = 1L,
            addressName = "Garage",
            visitCount = 5,
            lastVisited = twoDaysAgoIso,
            createdAt = "2026-01-01T00:00:00Z",
        )

    private fun homeSnapshot(): LocationStatusSnapshot =
        LocationStatusSnapshot(
            destinationName = null,
            locatedAtHome = true,
            locatedAtWork = false,
            locatedAtFavorite = false,
        )

    private fun withRows(): LocationFavoritesData = LocationFavoritesData(listOf(garage()), homeSnapshot())

    private fun badgeOnly(): LocationFavoritesData = LocationFavoritesData(emptyList(), homeSnapshot())

    private fun setContent(
        state: UiState<LocationFavoritesData>,
        size: LocationFavoritesSize = LocationFavoritesRegistration.defaultSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    LocationFavoritesWidgetContent(
                        state = state,
                        size = size,
                        onRefresh = onRefresh,
                        nowMillis = NOW,
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
    fun emptyShowsBadgeAndNoFavoritesMessage() {
        setContent(UiState(UiPhase.Empty, data = LocationFavoritesData.EMPTY, fetchedAt = 0L))
        // No snapshot resolves to the fallthrough "Other" badge, and the list body shows the empty state.
        compose.onNodeWithText("Other").assertIsDisplayed()
        compose.onNodeWithText("No favorite locations").assertIsDisplayed()
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
    fun fullWithRowsShowsTitleBadgeRowAndRefresh() {
        setContent(UiState(UiPhase.Content, data = withRows(), fetchedAt = NOW))
        compose.onNodeWithText("Favorite Locations").assertIsDisplayed()
        // The location badge renders its localized label.
        compose.onNodeWithText("Home").assertIsDisplayed()
        // The ranked row exposes a single merged TalkBack description (rank + place + visits + recency).
        compose.onNodeWithContentDescription("1. Garage, 5\u00D7 \u00B7 2d ago").assertIsDisplayed()
        // The header refresh control exposes an accessible name (TalkBack).
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun fullIdleBadgeOnlyShowsNoFavorites() {
        setContent(UiState(UiPhase.Content, data = badgeOnly(), fetchedAt = NOW))
        // The location emoji exposes the localized label as its accessible name (web role="img").
        compose.onNodeWithContentDescription("Home").assertIsDisplayed()
        compose.onNodeWithText("Home").assertIsDisplayed()
        compose.onNodeWithText("No favorite locations").assertIsDisplayed()
    }

    @Test
    fun compactShowsLocationBadge() {
        setContent(
            state = UiState(UiPhase.Content, data = badgeOnly(), fetchedAt = NOW),
            size = LocationFavoritesSize(cols = 1, rows = 2),
        )
        compose.onNodeWithText("Home").assertIsDisplayed()
        compose.onNodeWithContentDescription("Home").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedRowsVisible() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = withRows(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached row stays visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("1. Garage, 5\u00D7 \u00B7 2d ago").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
        const val TWO_DAYS_MS = 2 * 86_400_000L
        val HOST_WIDTH = 360.dp
        val HOST_HEIGHT = 520.dp
    }
}
