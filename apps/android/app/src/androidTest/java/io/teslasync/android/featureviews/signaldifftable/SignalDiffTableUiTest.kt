package io.teslasync.android.featureviews.signaldifftable

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.telemetry.SignalDiffRow
import io.teslasync.shared.core.presentation.telemetry.SignalDiffServerResponse
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [SignalDiffTableContent] across every branch the
 * web component renders (loading / empty / error / data / filtered-empty), the always-present filter field +
 * its TalkBack label, the column legend, and the per-row pin affordance's accessible label. Runs under
 * `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure projection + view-model
 * state matrix.
 */
class SignalDiffTableUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        SignalDiffTableStrings(
            colSignal = "Signal",
            colValueA = "Window A",
            colValueB = "Window B",
            colDelta = "\u0394",
            colSourceA = "Src A",
            colSourceB = "Src B",
            deltaChanged = "changed",
            legendDelta = "\u0394",
            legendDeltaHelp = "Numeric difference between Window A and Window B.",
            legendDeltaAria = "More info about the delta column",
            legendSource = "Src A / Src B",
            legendSourceHelp = "The layer that supplied this value.",
            legendSourceAria = "More info about the source-layer column",
            emptyMessage = "No differences between the two snapshots",
            noMatchesMessage = "No signals match the current filter",
            loadingText = "Loading\u2026",
            filterHint = "Filter signals\u2026",
            filterAria = "Filter signals",
            pinLabel = "Pin",
            pinnedLabel = "Pinned",
            selectAllLabel = "Select all rows",
            diffLabel = "Signal Diff",
        )

    private fun dataResponse(): SignalDiffServerResponse =
        SignalDiffServerResponse(
            vehicleId = 1L,
            atA = "2026-06-12T11:00:00Z",
            atB = "2026-06-12T12:00:00Z",
            count = 2L,
            data =
                listOf(
                    SignalDiffRow(
                        name = "VehicleSpeed",
                        valueA = JsonPrimitive(40),
                        valueB = JsonPrimitive(64),
                        sourceA = "l1",
                        sourceB = "l2",
                        ageMsA = 1_200L,
                        ageMsB = 800L,
                        changed = true,
                    ),
                    SignalDiffRow(
                        name = "Gear",
                        valueA = JsonPrimitive("P"),
                        valueB = JsonPrimitive("D"),
                        sourceA = "log",
                        sourceB = "l1",
                        changed = true,
                    ),
                ),
        )

    private fun state(
        response: SignalDiffServerResponse?,
        isFetching: Boolean = false,
        isError: Boolean = false,
        errorKind: QueryErrorKind? = null,
    ): SignalDiffTableState =
        SignalDiffTableState(
            response = response,
            updatedAtMillis = if (response != null || isError) 1L else null,
            isFetching = isFetching,
            isStale = false,
            isError = isError,
            errorKind = errorKind,
        )

    private fun setContent(
        state: SignalDiffTableState,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    SignalDiffTableContent(state = state, strings = strings, onRefresh = onRefresh)
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
    fun legendExposesSourceHelpLabel() {
        setContent(state(dataResponse()))
        compose.onNodeWithText(strings.legendSource).assertIsDisplayed()
    }

    @Test
    fun loadingShowsLoadingText() {
        setContent(state(response = null, isFetching = true))
        compose.onNodeWithText(strings.loadingText).assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoDifferencesState() {
        setContent(state(response = SignalDiffServerResponse(vehicleId = 1L, atA = "a", atB = "b", count = 0L)))
        compose.onNodeWithText(strings.emptyMessage).assertIsDisplayed()
    }

    @Test
    fun errorWithNoCacheShowsRetryAffordance() {
        var retried = false
        setContent(state(response = null, isError = true, errorKind = QueryErrorKind.Network), onRefresh = { retried = true })
        compose.onNodeWithText("Retry").assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun dataShowsDiffRows() {
        setContent(state(dataResponse()))
        compose.onNodeWithText("VehicleSpeed").assertIsDisplayed()
        compose.onNodeWithText("40.00").assertIsDisplayed()
        compose.onNodeWithText("64.00").assertIsDisplayed()
        compose.onNodeWithText("Gear").assertIsDisplayed()
    }

    @Test
    fun perRowPinExposesAccessibleLabel() {
        setContent(state(dataResponse()))
        compose
            .onAllNodesWithContentDescription(strings.pinLabel)
            .onFirst()
            .assertIsDisplayed()
            .assertHasClickAction()
    }

    @Test
    fun filteringToNoMatchShowsFilteredMessage() {
        setContent(state(dataResponse()))
        compose.onNode(hasSetTextAction()).performTextInput("zzz")
        compose.onNodeWithText(strings.noMatchesMessage).assertIsDisplayed()
        compose.onNodeWithText("VehicleSpeed").assertDoesNotExist()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 480.dp
        val HOST_HEIGHT = 900.dp
    }
}
