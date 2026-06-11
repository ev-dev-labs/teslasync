package io.teslasync.android.dashboard.widgets.maintenancetracker

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [MaintenanceTrackerWidgetContent] across every state
 * the web component renders (loading skeleton, hard error + retry, standard next-service card + recent
 * timeline, compact months-left hero, no-data empty, no-records line, stale/offline cached). Asserts the
 * rendered i18n strings and the TalkBack content descriptions are present. Runs under `connectedAndroidTest`;
 * the offline gate's `testReleaseUnitTest` covers the projection/fold logic, this covers the render + a11y.
 */
class MaintenanceTrackerWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private val default = MaintenanceTrackerRegistration.DEFAULT_SIZE
    private val compact = MaintenanceTrackerSize(cols = 1, rows = 2)
    private val prefs = MaintenanceTrackerDisplayPrefs.METRIC_DEFAULT

    @Test
    fun loadingShowsSkeletonNotContent() {
        setContent(UiState.loading())
        rule.onNodeWithContentDescription("Loading").assertIsDisplayed()
        rule.onNodeWithText("No maintenance data").assertDoesNotExist()
        rule.onNodeWithText("Maintenance").assertDoesNotExist()
    }

    @Test
    fun emptyShowsNoMaintenanceData() {
        setContent(UiState(phase = UiPhase.Empty, data = MaintenanceTrackerData.EMPTY, fetchedAt = NOW))
        rule.onNodeWithText("No maintenance data").assertIsDisplayed()
    }

    @Test
    fun standardContentShowsTitleAndNextServiceCard() {
        setContent(UiState(phase = UiPhase.Content, data = itemsOnly(), fetchedAt = NOW))
        rule.onNodeWithText("Maintenance").assertIsDisplayed()
        // The next-service card folds its label + name + urgency + interval into one TalkBack phrase.
        rule.onNodeWithContentDescription("Tire Rotation", substring = true).assertIsDisplayed()
        rule.onNodeWithContentDescription("Overdue", substring = true).assertIsDisplayed()
        // No service records on the deployed backend ⇒ the "no records" line is shown.
        rule.onNodeWithText("No service records yet").assertIsDisplayed()
    }

    @Test
    fun compactShowsMonthsHeroWithoutTitle() {
        setContent(UiState(phase = UiPhase.Content, data = itemsOnly(), fetchedAt = NOW), size = compact)
        rule.onNodeWithText("Maintenance").assertDoesNotExist()
        rule.onNodeWithContentDescription("Tire Rotation", substring = true).assertIsDisplayed()
    }

    @Test
    fun recentServiceTimelineRendersWhenRecordsPresent() {
        setContent(UiState(phase = UiPhase.Content, data = itemsAndRecords(), fetchedAt = NOW))
        rule.onNodeWithText("Recent Service").assertIsDisplayed()
        // Each timeline row folds its title + odometer + notes + date into one TalkBack phrase.
        rule.onNodeWithContentDescription("rotated", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAndFiresIt() {
        var retried = false
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRefresh = { retried = true })
        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = itemsOnly(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached next-service card stays visible (never blanked) when offline/stale.
        rule.onNodeWithContentDescription("Tire Rotation", substring = true).assertIsDisplayed()
    }

    @Test
    fun refreshControlExposesAccessibilityLabel() {
        setContent(UiState(phase = UiPhase.Content, data = itemsOnly(), fetchedAt = NOW))
        rule.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    private fun setContent(
        state: UiState<MaintenanceTrackerData>,
        size: MaintenanceTrackerSize = default,
        onRefresh: () -> Unit = {},
    ) {
        rule.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                MaintenanceTrackerWidgetContent(
                    state = state,
                    prefs = prefs,
                    size = size,
                    onRefresh = onRefresh,
                )
            }
        }
    }

    private fun itemsOnly(): MaintenanceTrackerData =
        MaintenanceTrackerData(
            items =
                listOf(
                    MaintenanceItem(id = "2", name = "Tire Rotation", intervalMonths = null, intervalKm = null, estimatedCostUsd = null),
                    MaintenanceItem(id = "6", name = "Wiper Blades", intervalMonths = 12.0, intervalKm = null, estimatedCostUsd = null),
                ),
            records = emptyList(),
        )

    private fun itemsAndRecords(): MaintenanceTrackerData =
        itemsOnly().copy(
            records = listOf(ServiceRecord(itemId = "2", date = "2024-05-10", odometerKm = 0.0, notes = "rotated")),
        )

    private companion object {
        const val NOW = 1_780_000_000_000L
    }
}
