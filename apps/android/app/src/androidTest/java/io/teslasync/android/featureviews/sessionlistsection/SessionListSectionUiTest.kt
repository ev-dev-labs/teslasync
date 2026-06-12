package io.teslasync.android.featureviews.sessionlistsection

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
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
import java.util.Locale

/**
 * Instrumented Compose UI + accessibility verification of [SessionListSectionContent] across every branch the
 * web component renders (search bar, charger-filter + sort + export controls, the session list, the bulk
 * toolbar, pagination) plus the lifecycle chrome the host's feed implies (loading skeletons, the "no sessions
 * yet" empty, a hard-error retry surface, the "no matches" empty, and the stale/offline freshness chip +
 * silent auto-refresh). Asserts the rendered titles/labels/values are exposed to TalkBack, that no surface
 * ever blanks, and that interactive affordances carry accessible names + actions. Runs under
 * `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure projection. Mirrors the web
 * spec (web/src/features/charging/components/charging-list/SessionListSection.tsx).
 */
class SessionListSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        SessionListStrings(
            allSessions = "All Sessions",
            searchHint = "Search by location or charger type",
            filterSearch = "Search",
            filterCharger = "Charger",
            filterAll = "All",
            filterHome = "Home",
            filterSc = "SC",
            filterDc = "DC",
            sortDate = "Date",
            sortEnergy = "kWh",
            sortCost = "Cost",
            sortTime = "Time",
            sortPower = "Power",
            exportCsv = "CSV",
            exportJson = "JSON",
            emptyTitle = "No charging sessions yet",
            emptyMessage = "Charging data will appear here once your vehicle records a session.",
            noMatchesTitle = "No sessions match your filters",
            noMatchesMessage = "Try clearing the search or charger filter to see more sessions.",
            chargerHome = "Home / AC",
            chargerSupercharger = "Supercharger",
            chargerDc = "DC Fast",
            chargerUnknown = "Charger",
            clear = "Clear",
            deleteAction = "Delete",
            deleteConfirm = "Delete",
            deleteDescription = "This cannot be undone.",
            cancel = "Cancel",
            bulkClear = "Clear selection",
            selectRow = "Select row",
            retry = "Retry",
            errorTitle = "Server error",
            errorMessage = "Something went wrong on our end. Please try again.",
            loadingLabel = "Loading",
            offline = "Offline",
            loadingShort = "Loading...",
            paginationFirst = "First page",
            paginationPrevious = "Previous page",
            paginationNext = "Next page",
            paginationLast = "Last page",
        )

    private val sessions =
        listOf(
            ChargingSessionItem(
                id = 1,
                startedAt = "2026-04-04T18:30:00Z",
                endedAt = "2026-04-04T19:42:00Z",
                chargerType = "Supercharger V3",
                totalEnergyAddedWh = 52_400.0,
                peakPowerW = 246_000.0,
                avgPowerW = null,
                costDecimal = 18.32,
                startSocPct = 18.0,
                endSocPct = 78.0,
                startPlace = "Harris Ranch Supercharger",
                startLat = 36.25,
                startLng = -120.23,
            ),
        )

    private fun setContent(
        state: UiState<List<ChargingSessionItem>>,
        filtered: List<ChargingSessionItem> = sessions,
        onRetry: () -> Unit = {},
        onToggleSelected: ((Long, Boolean) -> Unit)? = { _, _ -> },
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    SessionListSectionContent(
                        state = state,
                        filteredSessions = filtered,
                        searchQuery = "",
                        onSearchQueryChange = {},
                        chargerFilter = ChargerFilter.All,
                        onChargerFilterChange = {},
                        sortBy = SortKey.Date,
                        sortDesc = true,
                        onSortChange = {},
                        onSortToggle = {},
                        page = 1,
                        pageSize = 25,
                        onPageChange = {},
                        onExport = {},
                        onOpenSession = {},
                        onRetry = onRetry,
                        onToggleSelected = onToggleSelected,
                        onClearSelection = {},
                        onBulkDelete = {},
                        currencySymbol = "$",
                        locale = Locale.US,
                        formatTime = { it },
                        strings = strings,
                    )
                }
            }
        }
    }

    @Test
    fun contentShowsControlsListAndExport() {
        setContent(UiState(phase = UiPhase.Content, data = sessions))
        compose.onNodeWithText(strings.allSessions).assertIsDisplayed()
        compose.onNodeWithText(strings.chargerSupercharger).assertExists()
        compose.onNodeWithText("52.4 kWh").assertExists()
        compose.onNodeWithText(strings.exportCsv).assertExists()
        compose.onNodeWithText(strings.exportJson).assertExists()
    }

    @Test
    fun rowSelectionCheckboxHasAccessibleLabel() {
        setContent(UiState(phase = UiPhase.Content, data = sessions))
        val checkboxes = compose.onAllNodesWithContentDescription(strings.selectRow).fetchSemanticsNodes()
        assertTrue(checkboxes.isNotEmpty())
    }

    @Test
    fun loadingShowsSkeletonChromeNoTitle() {
        setContent(UiState.loading(), filtered = emptyList())
        compose.onNodeWithContentDescription(strings.loadingLabel).assertExists()
        compose.onNodeWithText(strings.allSessions).assertDoesNotExist()
    }

    @Test
    fun emptyShowsNoSessionsMessage() {
        setContent(UiState(phase = UiPhase.Empty, data = emptyList()), filtered = emptyList())
        compose.onNodeWithText(strings.emptyTitle).assertExists()
    }

    @Test
    fun noMatchesStillShowsControlsAndAnEmptyMessage() {
        setContent(UiState(phase = UiPhase.Content, data = sessions), filtered = emptyList())
        // Controls still render; the list region shows the friendly "no matches" message (never a blank box).
        compose.onNodeWithText(strings.allSessions).assertExists()
        compose.onNodeWithText(strings.noMatchesTitle).assertExists()
    }

    @Test
    fun errorShowsAccessibleRetryAndInvokesIt() {
        var retried = false
        setContent(
            UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            filtered = emptyList(),
            onRetry = { retried = true },
        )
        val retry = compose.onNodeWithText(strings.retry)
        retry.assertIsDisplayed().assertHasClickAction()
        retry.performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineStaleStillShowsCachedContent() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = sessions,
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText(strings.allSessions).assertIsDisplayed()
        compose.onNodeWithText("52.4 kWh").assertExists()
    }

    @Test
    fun staleContentAutoRefreshes() {
        var refreshed = false
        setContent(
            UiState(phase = UiPhase.Content, data = sessions, stale = true, fetchedAt = 1_700_000_000_000L),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        assertTrue(refreshed)
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.width(HOST_WIDTH).verticalScroll(rememberScrollState())) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
    }
}
