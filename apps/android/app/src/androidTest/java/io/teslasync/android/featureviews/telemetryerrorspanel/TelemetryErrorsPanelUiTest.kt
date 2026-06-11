package io.teslasync.android.featureviews.telemetryerrorspanel

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [TelemetryErrorsPanelContent] across every
 * branch the web component renders (idle / loading / error / data + export / empty-healthy /
 * empty-unknown-shape with the raw-response disclosure). Asserts the rendered strings, that the export
 * button + raw disclosure expose accessible click actions and labels, and that the disclosure expands
 * to the raw JSON. Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers
 * the pure projection.
 */
class TelemetryErrorsPanelUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val errors =
        listOf(
            TelemetryError(rowKey = "0", timestamp = "2026-06-11T12:00:00Z", code = "STREAM_DISCONNECTED", message = "Stream dropped"),
        )

    private val labels =
        TelemetryErrorsPanelLabels(
            title = "Fleet API errors",
            idleMessage = "Press View Errors to query Tesla.",
            emptyMessage = "No telemetry errors reported.",
            rawDisclosureLabel = "Show raw response",
            downloadLabel = "Download JSON",
        )

    private val columns: List<TableColumn<TelemetryError>> = telemetryErrorColumns("Time", "Code", "Message")

    private fun setContent(
        state: TelemetryErrorsPanelState,
        onDownload: (TelemetryErrorsDownload) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    TelemetryErrorsPanelContent(state = state, labels = labels, columns = columns, onDownload = onDownload)
                }
            }
        }
    }

    @Test
    fun idleShowsIdleMessage() {
        setContent(TelemetryErrorsPanelState.Idle)
        compose.onNodeWithText(labels.idleMessage).assertIsDisplayed()
        compose.onNodeWithText(labels.title).assertIsDisplayed()
    }

    @Test
    fun loadingShowsTitleChrome() {
        setContent(TelemetryErrorsPanelState.Loading)
        compose.onNodeWithText(labels.title).assertIsDisplayed()
    }

    @Test
    fun errorShowsMessage() {
        setContent(TelemetryErrorsPanelState.Failure("Request failed: 502"))
        compose.onNodeWithText("Request failed: 502").assertIsDisplayed()
        compose.onNodeWithText(labels.title).assertIsDisplayed()
    }

    @Test
    fun dataShowsRowAndAccessibleExportButton() {
        var downloaded: TelemetryErrorsDownload? = null
        setContent(
            TelemetryErrorsPanelState.Data(errors, TelemetryErrorsPanelProjection.downloadOf("VIN", errors)),
            onDownload = { downloaded = it },
        )
        compose.onNodeWithText("STREAM_DISCONNECTED").assertIsDisplayed()
        // The export affordance carries its label and a click action (accessibility).
        compose.onNodeWithText(labels.downloadLabel).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(labels.downloadLabel).performClick()
        assertTrue(downloaded != null)
        assertEquals("telemetry-errors-VIN.json", downloaded?.fileName)
    }

    @Test
    fun emptyHealthyShowsMessageAndZeroBadge() {
        setContent(TelemetryErrorsPanelState.Empty(TelemetryErrorsEmptyBadge.Healthy, rawJson = null))
        compose.onNodeWithText(labels.emptyMessage).assertIsDisplayed()
        compose.onNodeWithText("0").assertIsDisplayed()
    }

    @Test
    fun emptyUnknownExpandsRawDisclosure() {
        setContent(TelemetryErrorsPanelState.Empty(TelemetryErrorsEmptyBadge.Unknown, rawJson = "{\n  \"response\": {}\n}"))
        // Unknown-shape badge + the accessible disclosure label.
        compose.onNodeWithText("?").assertIsDisplayed()
        compose.onNodeWithText(labels.rawDisclosureLabel).assertIsDisplayed().assertHasClickAction()
        // Expanding reveals the raw response JSON.
        compose.onNodeWithText(labels.rawDisclosureLabel).performClick()
        compose.onNodeWithText("response", substring = true).assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 360.dp
        val HOST_HEIGHT = 640.dp
    }
}
