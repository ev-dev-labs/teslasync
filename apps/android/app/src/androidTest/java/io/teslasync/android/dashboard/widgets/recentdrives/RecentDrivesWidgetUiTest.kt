package io.teslasync.android.dashboard.widgets.recentdrives

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
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.ZoneId
import java.util.Locale
import kotlin.time.Instant

/**
 * Instrumented Compose UI + accessibility verification of [RecentDrivesWidgetContent] across every state
 * the web component renders (loading skeleton, hard error + retry, the friendly empty state, the populated
 * drive list, and the stale/offline cached path). Asserts the rendered i18n strings, the per-row TalkBack
 * content descriptions, and that the navigation affordances fire. Runs under `connectedAndroidTest`; the
 * offline gate's `testReleaseUnitTest` covers the pure logic, this covers the render + a11y.
 */
class RecentDrivesWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun metricPrefs(): UnitPref =
        UnitPref(
            distance = DistanceUnitPref.KM,
            speed = SpeedUnitPref.KMH,
            temperature = TemperatureUnitPref.CELSIUS,
            pressure = PressureUnitPref.BAR,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
            locale = "en-US",
            precision = null,
        )

    private fun setContent(
        state: UiState<List<Drive>>,
        onRefresh: () -> Unit = {},
        onViewAll: () -> Unit = {},
        onOpenDrive: (Long) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    RecentDrivesWidgetContent(
                        state = state,
                        prefs = metricPrefs(),
                        size = RecentDrivesRegistration.defaultSize,
                        onRefresh = onRefresh,
                        onViewAll = onViewAll,
                        onOpenDrive = onOpenDrive,
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
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRefresh = { retried = true })
        compose.onNodeWithText("Can't reach server").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsFriendlyMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList(), fetchedAt = NOW))
        compose.onNodeWithText("No recent drives").assertIsDisplayed()
    }

    @Test
    fun contentShowsHeaderAndDriveRow() {
        setContent(UiState(UiPhase.Content, data = listOf(sampleDrive()), fetchedAt = NOW))
        compose.onNodeWithText("Recent Drives").assertIsDisplayed()
        // Header refresh + view-all affordances expose accessible names (TalkBack).
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
        compose.onNodeWithText("View all").assertIsDisplayed()
        // The drive row folds distance + duration + SoC + date into one TalkBack phrase.
        compose.onNodeWithContentDescription("20 min", substring = true).assertIsDisplayed()
    }

    @Test
    fun tappingDriveRowInvokesOpenCallback() {
        var openedId = -1L
        setContent(state = UiState(UiPhase.Content, data = listOf(sampleDrive()), fetchedAt = NOW), onOpenDrive = { openedId = it })
        compose.onNodeWithContentDescription("20 min", substring = true).performClick()
        assertEquals(1L, openedId)
    }

    @Test
    fun tappingViewAllInvokesCallback() {
        var viewedAll = false
        setContent(state = UiState(UiPhase.Content, data = listOf(sampleDrive()), fetchedAt = NOW), onViewAll = { viewedAll = true })
        compose.onNodeWithText("View all").performClick()
        assertTrue(viewedAll)
    }

    @Test
    fun offlineKeepsCachedDriveVisible() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = listOf(sampleDrive()),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        compose.onNodeWithContentDescription("12.0 km", substring = true).assertIsDisplayed()
    }

    private fun sampleDrive(): Drive =
        Drive(
            createdAt = Instant.fromEpochMilliseconds(0),
            distanceM = 12_000.0,
            durationS = 1_200,
            id = 1,
            startTs = Instant.parse("2024-04-04T10:00:00Z"),
            updatedAt = Instant.fromEpochMilliseconds(0),
            vehicleId = 1,
            startBatteryPct = 80,
            endBatteryPct = 65,
        )

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
