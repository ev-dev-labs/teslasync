package io.teslasync.android.featureviews.livesignalstable

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

/**
 * Instrumented Compose UI + accessibility verification of [LiveSignalsTableContent] across every branch the
 * web component renders (loading / empty / error / data / filtered-empty), plus the always-present filter
 * field and its TalkBack label. Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest`
 * covers the pure projection + the view-model state matrix.
 */
class LiveSignalsTableUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        LiveSignalsTableStrings(
            colName = "Signal",
            colValue = "Value",
            colTimestamp = "Last update",
            emptyTitle = "No live signals cached",
            emptyMessage = "Redis has no live snapshot for this vehicle yet.",
            filterHint = "Filter signal names\u2026",
            filterAria = "Filter signals",
            loadingText = "Loading\u2026",
            filteredText = "No signals match this filter.",
            snapshotLabel = "Live snapshot",
        )

    private fun dataResponse(): VehicleLiveSignalsResponse =
        VehicleLiveSignalsResponse(
            vehicleId = 1L,
            signals =
                mapOf(
                    "VehicleSpeed" to
                        buildJsonObject {
                            put("value", 64)
                            put("timestamp", "2026-06-11T11:59:40Z")
                        },
                    "Gear" to JsonPrimitive("D"),
                ),
        )

    private fun state(
        response: VehicleLiveSignalsResponse?,
        isFetching: Boolean = false,
        isError: Boolean = false,
        errorKind: QueryErrorKind? = null,
    ): LiveSignalsTableState =
        LiveSignalsTableState(
            response = response,
            updatedAtMillis = if (response != null || isError) 1L else null,
            isFetching = isFetching,
            isStale = false,
            isError = isError,
            errorKind = errorKind,
        )

    private fun setContent(
        state: LiveSignalsTableState,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    LiveSignalsTableContent(state = state, strings = strings, onRefresh = onRefresh)
                }
            }
        }
    }

    @Test
    fun filterFieldExposesAccessibleLabel() {
        setContent(state(dataResponse()))
        compose.onNodeWithContentDescription(strings.filterAria).assertIsDisplayed()
    }

    @Test
    fun loadingShowsLoadingText() {
        setContent(state(response = null, isFetching = true))
        compose.onNodeWithText(strings.loadingText).assertIsDisplayed()
    }

    @Test
    fun emptyShowsCachedEmptyState() {
        setContent(state(response = VehicleLiveSignalsResponse(vehicleId = 1L)))
        compose.onNodeWithText(strings.emptyTitle).assertIsDisplayed()
        compose.onNodeWithText(strings.emptyMessage).assertIsDisplayed()
    }

    @Test
    fun errorWithNoCacheShowsRetryAffordance() {
        var retried = false
        setContent(state(response = null, isError = true, errorKind = QueryErrorKind.Network), onRefresh = { retried = true })
        // The Network QueryError exposes a retry action (accessibility).
        compose.onNodeWithText("Retry").assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun dataShowsSignalRows() {
        setContent(state(dataResponse()))
        compose.onNodeWithText("VehicleSpeed").assertIsDisplayed()
        compose.onNodeWithText("64").assertIsDisplayed()
        compose.onNodeWithText("Gear").assertIsDisplayed()
        compose.onNodeWithText("D").assertIsDisplayed()
    }

    @Test
    fun filteringToNoMatchShowsFilteredMessage() {
        setContent(state(dataResponse()))
        compose.onNode(hasSetTextAction()).performTextInput("zzz")
        compose.onNodeWithText(strings.filteredText).assertIsDisplayed()
        compose.onNodeWithText("VehicleSpeed").assertDoesNotExist()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 800.dp
    }
}
