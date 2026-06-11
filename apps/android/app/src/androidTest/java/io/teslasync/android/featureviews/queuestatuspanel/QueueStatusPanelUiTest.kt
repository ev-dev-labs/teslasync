package io.teslasync.android.featureviews.queuestatuspanel

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.systemqueues.QueueStat
import io.teslasync.shared.core.presentation.systemqueues.QueueStatusResponse
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [QueueStatusPanelContent] across every branch the
 * web component renders (loading / error / empty / content + the stale-offline freshness surface). Asserts
 * the always-present header (title + Refresh), the per-state body strings, that the Refresh control and each
 * worker card expose accessible click actions, and that activating a card routes its worker id to
 * `onOpenWorker`. Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure
 * projection.
 */
class QueueStatusPanelUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        QueueStatusStrings(
            title = "Background workers",
            subtitle = "Live view of the notification, export, and automation worker queues.",
            refresh = "Refresh",
            loading = "Loading worker status",
            error = "Could not load worker status. Check API logs and try again.",
            empty = "No workers are currently registered.",
            queueDepth = "Queue depth",
            succeeded24h = "Succeeded 24h",
            failed24h = "Failed 24h",
            heartbeatNever = "No heartbeat recorded",
            hostUnknown = "No host reported",
            versionUnknown = "unknown",
            severityOk = "Healthy",
            severityWarn = "Lagging",
            severityCritical = "Stale",
            severityDown = "Down",
        )

    private val workers =
        listOf(
            QueueStat(
                worker = "notification",
                displayName = "Notification worker",
                pending = 3,
                inProgress = 1,
                succeeded24h = 1284,
                failed24h = 0,
                oldestPendingAgeSeconds = 0,
                heartbeatSeverity = "ok",
                heartbeatDetail = "",
                lastHeartbeatAt = "2026-06-11T12:00:00Z",
                host = "worker-01",
                version = "v1.8.0",
            ),
            QueueStat(
                worker = "export",
                displayName = "Export worker",
                pending = 12,
                inProgress = 2,
                succeeded24h = 96,
                failed24h = 4,
                oldestPendingAgeSeconds = 90,
                heartbeatSeverity = "warn",
                heartbeatDetail = "",
                lastHeartbeatAt = "2026-06-11T11:58:00Z",
                host = "worker-02",
                version = "",
            ),
        )

    private fun contentState(stale: Boolean = false): UiState<QueueStatusResponse> =
        UiState(
            phase = UiPhase.Content,
            data = QueueStatusResponse("2026-06-11T12:00:00Z", workers),
            fetchedAt = QueueStatusPanelProjection.parseIsoMillis("2026-06-11T12:00:00Z"),
            stale = stale,
            errorKind = if (stale) ErrorKind.Network else null,
        )

    private fun setContent(
        state: UiState<QueueStatusResponse>,
        onRefresh: () -> Unit = {},
        onOpenWorker: (String) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    QueueStatusPanelContent(
                        state = state,
                        onRefresh = onRefresh,
                        onOpenWorker = onOpenWorker,
                        strings = strings,
                    )
                }
            }
        }
    }

    @Test
    fun headerAlwaysShowsTitleAndRefresh() {
        setContent(contentState())
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText(strings.refresh).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun loadingShowsLoadingMessageAndTitle() {
        setContent(UiState.loading())
        compose.onNodeWithText(strings.loading).assertIsDisplayed()
        compose.onNodeWithText(strings.title).assertIsDisplayed()
    }

    @Test
    fun errorShowsErrorMessageAndRetryableRefresh() {
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Unknown))
        compose.onNodeWithText(strings.error).assertIsDisplayed()
        // The always-present header Refresh is the error-state retry affordance.
        compose.onNodeWithText(strings.refresh).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun emptyShowsEmptyMessage() {
        setContent(UiState(phase = UiPhase.Empty, data = QueueStatusResponse("2026-06-11T12:00:00Z", emptyList())))
        compose.onNodeWithText(strings.empty).assertIsDisplayed()
    }

    @Test
    fun contentShowsWorkerNameSeverityAndCounts() {
        setContent(contentState())
        compose.onNodeWithText("Notification worker").assertIsDisplayed()
        compose.onNodeWithText("Export worker").assertIsDisplayed()
        compose.onNodeWithText(strings.severityOk).assertIsDisplayed()
        compose.onNodeWithText(strings.severityWarn).assertIsDisplayed()
        compose.onNodeWithText(strings.queueDepth, substring = true).assertIsDisplayed()
        compose.onNodeWithText(strings.succeeded24h, substring = true).assertIsDisplayed()
    }

    @Test
    fun cardActivationRoutesWorkerIdToOnOpenWorker() {
        var opened: String? = null
        setContent(contentState(), onOpenWorker = { opened = it })
        // The whole card is one accessible activatable target (web <button> aria-label "Show recent … jobs").
        compose.onNodeWithTag(queueWorkerCardTestTag("export")).assertHasClickAction().performClick()
        assertEquals("export", opened)
    }

    @Test
    fun refreshButtonInvokesOnRefresh() {
        var refreshed = false
        setContent(contentState(), onRefresh = { refreshed = true })
        compose.onNodeWithText(strings.refresh).performClick()
        assertEquals(true, refreshed)
    }

    @Test
    fun offlineStaleStillRendersContent() {
        setContent(contentState(stale = true))
        // Cached "last known" content stays visible rather than blanking when stale/offline.
        compose.onNodeWithText("Notification worker").assertIsDisplayed()
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
