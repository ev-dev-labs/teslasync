package io.teslasync.android.dashboard.widgets.destinationeta

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
import io.teslasync.shared.core.units.UnitPref
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [DestinationETAWidgetContent] across every state
 * the web component renders (loading skeleton, "No location data" empty, hard error + retry, full
 * navigating view, full idle location badge, the compact ETA hero, the compact location badge, and the
 * stale/offline cached path). Asserts the rendered i18n strings and the TalkBack content descriptions
 * are present. Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the
 * logic, this covers the render.
 */
class DestinationETAWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val units: UnitPref = UnitFormatter.default().prefs

    private fun navigating(minutes: Double = 90.0): LocationSnapshotData =
        LocationSnapshotData(
            destinationName = "Tesla HQ",
            distanceToArrivalMeters = 5_000.0,
            minutesToArrival = minutes,
            locatedAtHome = false,
            locatedAtWork = false,
            locatedAtFavorite = false,
        )

    private fun idleAtHome(): LocationSnapshotData =
        LocationSnapshotData(
            destinationName = null,
            distanceToArrivalMeters = 0.0,
            minutesToArrival = 0.0,
            locatedAtHome = true,
            locatedAtWork = false,
            locatedAtFavorite = false,
        )

    private fun setContent(
        state: UiState<LocationSnapshotData?>,
        size: DestinationETASize = DestinationETARegistration.defaultSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    DestinationETAWidgetContent(
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
    fun emptyShowsNoLocationDataMessage() {
        setContent(UiState(UiPhase.Empty, data = null, fetchedAt = 0L))
        compose.onNodeWithText("No location data").assertIsDisplayed()
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
    fun fullNavigatingShowsTitleDestinationCountdownAndRefresh() {
        setContent(UiState(UiPhase.Content, data = navigating(), fetchedAt = NOW))
        compose.onNodeWithText("Destination ETA").assertIsDisplayed()
        compose.onNodeWithText("Tesla HQ").assertIsDisplayed()
        compose.onNodeWithText("1h 30m").assertIsDisplayed()
        compose.onNodeWithText("Remaining").assertIsDisplayed()
        // The header refresh control exposes an accessible name (TalkBack).
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun fullIdleShowsLocationBadgeAndNoNav() {
        setContent(UiState(UiPhase.Content, data = idleAtHome(), fetchedAt = NOW))
        // The location emoji exposes the localized label as its accessible name (web role="img").
        compose.onNodeWithContentDescription("Home").assertIsDisplayed()
        compose.onNodeWithText("Home").assertIsDisplayed()
        compose.onNodeWithText("No active navigation").assertIsDisplayed()
    }

    @Test
    fun compactEtaHeroExposesAccessibleName() {
        setContent(
            state = UiState(UiPhase.Content, data = navigating(minutes = 30.0), fetchedAt = NOW),
            size = DestinationETASize(cols = 1, rows = 2),
        )
        compose.onNodeWithContentDescription("30 min, ETA").assertIsDisplayed()
    }

    @Test
    fun compactIdleShowsLocationBadge() {
        setContent(
            state = UiState(UiPhase.Content, data = idleAtHome(), fetchedAt = NOW),
            size = DestinationETASize(cols = 1, rows = 2),
        )
        compose.onNodeWithText("Home").assertIsDisplayed()
        compose.onNodeWithContentDescription("Home").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedNavigatingContentVisible() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = navigating(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached destination stays visible (never blanked) when offline/stale.
        compose.onNodeWithText("Tesla HQ").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
        val HOST_WIDTH = 360.dp
        val HOST_HEIGHT = 520.dp
    }
}
