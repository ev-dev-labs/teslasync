package io.teslasync.android.dashboard.widgets.recentdriveslist

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
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.units.DistanceUnitPref
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import kotlin.time.Instant

/**
 * Instrumented Compose UI + accessibility verification of [RecentDrivesListWidgetContent] across every
 * state the web component renders (loading skeleton, hard error + retry, the title + freshness + "View
 * all" header over a drive row, the wide address column, the friendly empty state, and the stale/offline
 * cached path). Asserts the rendered i18n strings, the folded TalkBack content descriptions, and the
 * navigation callbacks. Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest`
 * covers the pure logic, this covers the render + a11y.
 */
class RecentDrivesListWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    @Suppress("LongParameterList")
    private fun setContent(
        state: UiState<List<Drive>>,
        size: RecentDrivesSize = RecentDrivesListRegistration.defaultSize,
        distanceUnit: DistanceUnitPref = DistanceUnitPref.KM,
        onRefresh: () -> Unit = {},
        onDriveClick: (Long) -> Unit = {},
        onViewAll: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    RecentDrivesListWidgetContent(
                        state = state,
                        size = size,
                        onRefresh = onRefresh,
                        distanceUnit = distanceUnit,
                        onDriveClick = onDriveClick,
                        onViewAll = onViewAll,
                    )
                }
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
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
    fun emptyShowsFriendlyMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList(), fetchedAt = NOW))
        compose.onNodeWithText("No recent drives recorded").assertIsDisplayed()
    }

    @Test
    fun contentShowsTitleRowAndActions() {
        setContent(UiState(UiPhase.Content, data = listOf(drive(id = 1)), fetchedAt = NOW))
        compose.onNodeWithText("Recent Drives").assertIsDisplayed()
        compose.onNodeWithText("View all").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
        // The drive row folds its values into one TalkBack phrase (distance is converted at the boundary).
        compose.onNodeWithContentDescription("12.3 km", substring = true).assertIsDisplayed()
    }

    @Test
    fun wideContentExposesAddressInRowDescription() {
        setContent(
            state = UiState(UiPhase.Content, data = listOf(drive(id = 1, startAddress = "Downtown Garage")), fetchedAt = NOW),
            size = RecentDrivesSize(cols = 3, rows = 4),
        )
        compose.onNodeWithContentDescription("Downtown Garage", substring = true).assertIsDisplayed()
    }

    @Test
    fun viewAllInvokesCallback() {
        var viewedAll = false
        setContent(
            state = UiState(UiPhase.Content, data = listOf(drive(id = 1)), fetchedAt = NOW),
            onViewAll = { viewedAll = true },
        )
        compose.onNodeWithText("View all").performClick()
        assertTrue(viewedAll)
    }

    @Test
    fun driveRowInvokesNavigation() {
        var clickedId = -1L
        setContent(
            state = UiState(UiPhase.Content, data = listOf(drive(id = 42)), fetchedAt = NOW),
            onDriveClick = { clickedId = it },
        )
        compose.onNodeWithContentDescription("12.3 km", substring = true).performClick()
        assertEquals(42L, clickedId)
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = listOf(drive(id = 1)),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached rows stay visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("12.3 km", substring = true).assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private fun drive(
        id: Long,
        startAddress: String? = "123 Main Street",
    ): Drive =
        Drive(
            createdAt = Instant.fromEpochMilliseconds(NOW),
            distanceM = 12_345.0,
            durationS = 600L,
            id = id,
            startTs = Instant.fromEpochMilliseconds(NOW),
            updatedAt = Instant.fromEpochMilliseconds(NOW),
            vehicleId = 1L,
            startAddress = startAddress,
            endAddress = "456 Oak Avenue",
            startBatteryPct = 80,
            endBatteryPct = 70,
        )

    private companion object {
        const val NOW = 1_780_000_000_000L
        val HOST_WIDTH = 360.dp
        val HOST_HEIGHT = 520.dp
    }
}
