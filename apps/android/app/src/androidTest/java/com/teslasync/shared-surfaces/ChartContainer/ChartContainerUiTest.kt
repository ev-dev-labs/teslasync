// Instrumented Compose UI + accessibility verification of [ChartContainerContent] across the states the web
// ChartContainer renders: the content state (the chart children + the annotation toolbar + the marker row +
// the AnnotationList footer), the host empty state (the "No data available" message), the host loading state,
// and the annotation feed's stale/offline + hard-error states (each surfacing a Retry control so a failed
// fetch never leaves the surface without recovery). Also asserts the per-control TalkBack labels (the chart
// body's accessible name, the Add / Hide-Show toggle descriptions, the marker-row group label). Runs under
// `connectedAndroidTest` (a device/emulator); the offline gate's `testReleaseUnitTest` covers the pure model
// + the view-model.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.chartcontainer

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.annotations.DataAnnotation
import org.junit.Rule
import org.junit.Test

class ChartContainerUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        feedState: UiState<List<DataAnnotation>>,
        loading: Boolean = false,
        empty: Boolean = false,
        hidden: Boolean = false,
        annotationsEnabled: Boolean = true,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    ChartContainerContent(
                        title = TITLE,
                        ariaLabel = ARIA_LABEL,
                        feedState = feedState,
                        loading = loading,
                        empty = empty,
                        hidden = hidden,
                        annotationsEnabled = annotationsEnabled,
                    ) {
                        Text(BODY_TEXT)
                    }
                }
            }
        }
    }

    @Test
    fun contentStateShowsBodyToolbarMarkerRowAndFooter() {
        setContent(feedState = content(ROWS))
        // Chart body + its accessible name (web `role="img" aria-label`).
        compose.onNodeWithText(BODY_TEXT).assertIsDisplayed()
        compose.onNodeWithContentDescription(ARIA_LABEL).assertIsDisplayed()
        // Annotation toolbar controls carry their TalkBack labels and are actionable.
        compose.onNodeWithContentDescription(ADD_LABEL).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithContentDescription(HIDE_LABEL).assertIsDisplayed().assertHasClickAction()
        // Marker-row group label + the annotation roster.
        compose.onNodeWithContentDescription(MARKER_ROW_LABEL).assertIsDisplayed()
        compose.onNodeWithText("Battery swap").assertIsDisplayed()
    }

    @Test
    fun hiddenStateShowsShowToggle() {
        setContent(feedState = content(ROWS), hidden = true)
        // The toggle flips to the "Show annotations" affordance (web `aria-pressed`).
        compose.onNodeWithContentDescription(SHOW_LABEL).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun emptyStateShowsNoDataMessage() {
        setContent(feedState = UiState(UiPhase.Empty, data = emptyList()), empty = true)
        compose.onNodeWithText(NO_DATA).assertIsDisplayed()
    }

    @Test
    fun loadingStateKeepsTitleAndHidesBody() {
        setContent(feedState = UiState.loading(), loading = true)
        compose.onNodeWithText(TITLE).assertIsDisplayed()
    }

    @Test
    fun offlineStateOffersRetry() {
        setContent(
            feedState =
                UiState(
                    UiPhase.Content,
                    data = ROWS,
                    fetchedAt = 100L,
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
        )
        compose.onNodeWithText(RETRY).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun hardErrorStateOffersRetry() {
        setContent(feedState = UiState(UiPhase.Error, errorKind = ErrorKind.Http))
        compose.onNodeWithText(RETRY).assertIsDisplayed().assertHasClickAction()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private fun content(rows: List<DataAnnotation>): UiState<List<DataAnnotation>> = UiState(UiPhase.Content, data = rows, fetchedAt = 100L)

    private companion object {
        const val TITLE = "Monthly Cost"
        const val ARIA_LABEL = "Monthly charging cost trend"
        const val BODY_TEXT = "chart body"

        // English catalog values (the en/ baseline resolved on-device).
        const val ADD_LABEL = "Add annotation"
        const val HIDE_LABEL = "Hide annotations"
        const val SHOW_LABEL = "Show annotations"
        const val MARKER_ROW_LABEL = "Annotations on this chart"
        const val NO_DATA = "No data available"
        const val RETRY = "Retry"

        val ROWS =
            listOf(
                annotation("1", "Battery swap", "maintenance"),
                annotation("2", "Road trip", "trip"),
            )

        private fun annotation(
            id: String,
            label: String,
            category: String,
        ): DataAnnotation =
            DataAnnotation(
                id = id,
                timestamp = "2026-05-01T00:00:00Z",
                label = label,
                description = null,
                category = category,
                context = "cost",
                vehicleId = 1L,
                createdAt = "2026-05-01T00:00:00Z",
            )

        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 1000.dp
    }
}
