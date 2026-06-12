package io.teslasync.android.featureviews.signalcatalogpanel

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.telemetry.VehicleLiveSignalsResponse
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.Instant

/**
 * Instrumented Compose UI + accessibility verification of [SignalCatalogPanelContent] across every branch the
 * web component renders (loading / empty / error / data / filtered-empty), the always-present search field +
 * filter/sort pills, and the search field's TalkBack label. Runs under `connectedAndroidTest`; the offline
 * gate's `testReleaseUnitTest` covers the pure projection + the view-model state matrix.
 */
class SignalCatalogPanelUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        SignalCatalogStrings(
            statTotal = "Total Signals",
            statActive = "Active (<30s)",
            statStale = "Stale (>5min)",
            statNever = "Never Received",
            colStatus = "Status",
            colSignal = "Signal",
            colValue = "Last Value",
            colLastUpdated = "Last Updated",
            colTimeSince = "Time Since",
            filterHint = "Filter by signal name\u2026",
            filterAria = "Filter signals",
            filterAll = "All",
            filterStaleOnly = "Stale Only",
            filterActiveOnly = "Active Only",
            sortMostStale = "Most Stale",
            sortAlpha = "A-Z",
            sortCategory = "Category",
            refreshInterval = "Refreshes every 5s",
            lastRefreshed = "Last refreshed",
            noData = "No signal data available",
            noMatch = "No signals match current filters",
            badgeActive = "Active",
            badgeStale = "Stale",
            badgeNever = "Never Received",
            resourceName = "Signal Gaps",
        )

    private fun dataResponse(): VehicleLiveSignalsResponse {
        val now = Instant.now()
        return VehicleLiveSignalsResponse(
            vehicleId = 1L,
            signals =
                mapOf(
                    "VehicleSpeed" to
                        buildJsonObject {
                            put("value", 64)
                            put("timestamp", now.minusSeconds(5).toString())
                        },
                    "OdometerRaw" to
                        buildJsonObject {
                            put("value", 1234)
                            put("timestamp", now.minusSeconds(1_200).toString())
                        },
                    "Gear" to JsonPrimitive("D"),
                ),
        )
    }

    private fun state(
        response: VehicleLiveSignalsResponse?,
        isFetching: Boolean = false,
        isError: Boolean = false,
        errorKind: QueryErrorKind? = null,
    ): SignalCatalogPanelState =
        SignalCatalogPanelState(
            response = response,
            updatedAtMillis = if (response != null || isError) 1L else null,
            isFetching = isFetching,
            isStale = false,
            isError = isError,
            errorKind = errorKind,
        )

    private fun setContent(
        state: SignalCatalogPanelState,
        showSummary: Boolean = true,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    SignalCatalogPanelContent(
                        state = state,
                        strings = strings,
                        onRefresh = onRefresh,
                        showSummary = showSummary,
                    )
                }
            }
        }
    }

    @Test
    fun searchFieldExposesAccessibleLabel() {
        setContent(state(dataResponse()))
        compose.onNodeWithContentDescription(strings.filterAria).assertIsDisplayed()
    }

    @Test
    fun summaryAndControlsAlwaysRender() {
        setContent(state(dataResponse()))
        compose.onNodeWithText(strings.statTotal).assertExists()
        compose.onNodeWithText(strings.refreshInterval).assertExists()
        compose.onNodeWithText(strings.filterActiveOnly).assertExists()
        compose.onNodeWithText(strings.sortMostStale).assertExists()
    }

    @Test
    fun dataShowsSignalRowsAndColumns() {
        setContent(state(dataResponse()))
        compose.onNodeWithText("VehicleSpeed").assertExists()
        compose.onNodeWithText("64").assertExists()
        compose.onNodeWithText("Gear").assertExists()
        compose.onNodeWithText("D").assertExists()
        compose.onNodeWithText(strings.colTimeSince).assertExists()
        compose.onNodeWithText(strings.colStatus).assertExists()
    }

    @Test
    fun loadingShowsControlsButNoRows() {
        setContent(state(response = null, isFetching = true), showSummary = false)
        compose.onNodeWithContentDescription(strings.filterAria).assertIsDisplayed()
        compose.onNodeWithText("VehicleSpeed").assertDoesNotExist()
    }

    @Test
    fun emptyShowsNoDataMessage() {
        setContent(state(response = VehicleLiveSignalsResponse(vehicleId = 1L)), showSummary = false)
        compose.onNodeWithText(strings.noData).assertExists()
    }

    @Test
    fun errorWithNoCacheShowsRetryAffordance() {
        var retried = false
        setContent(
            state(response = null, isError = true, errorKind = QueryErrorKind.Network),
            showSummary = false,
            onRefresh = { retried = true },
        )
        compose.onNodeWithText("Retry").assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun searchingToNoMatchShowsNoMatchMessage() {
        setContent(state(dataResponse()), showSummary = false)
        compose.onNode(hasSetTextAction()).performTextInput("zzz")
        compose.onNodeWithText(strings.noMatch).assertExists()
        compose.onNodeWithText("VehicleSpeed").assertDoesNotExist()
    }

    @Test
    fun activeFilterHidesStaleAndNeverSignals() {
        setContent(state(dataResponse()), showSummary = false)
        compose.onNodeWithText(strings.filterActiveOnly).performClick()
        compose.onNodeWithText("VehicleSpeed").assertExists()
        compose.onNodeWithText("OdometerRaw").assertDoesNotExist()
        compose.onNodeWithText("Gear").assertDoesNotExist()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 900.dp
    }
}
