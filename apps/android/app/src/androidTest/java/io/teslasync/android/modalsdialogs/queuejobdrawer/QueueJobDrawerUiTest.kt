package io.teslasync.android.modalsdialogs.queuejobdrawer

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.systemqueues.QueueJobView
import io.teslasync.shared.core.presentation.systemqueues.QueueJobsResponse
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [QueueJobDrawerContent] across every branch
 * the web component renders (loading / error / empty / content + the stale-offline freshness surface).
 * Asserts the drawer chrome (title + accessible close), the per-state body strings, that the close +
 * retry controls expose accessible click actions, that the failed row surfaces its error block, and
 * that activating close / retry routes to the host callbacks. Runs under `connectedAndroidTest`; the
 * offline gate's `testReleaseUnitTest` covers the pure projection + view-model.
 */
class QueueJobDrawerUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val title = "Recent Notification worker jobs"

    private val strings =
        QueueJobDrawerStrings(
            title = "Recent jobs",
            close = "Close",
            loading = "Loading recent jobs",
            error = "Could not load recent jobs. Check API logs and try again.",
            empty = "No recent jobs to show.",
            retry = "Retry",
        )

    private val jobs =
        listOf(
            QueueJobView(
                id = "job-1",
                worker = "notification",
                status = "sent",
                title = "Charge complete push",
                startedAt = "2026-06-11T12:00:00Z",
                finishedAt = "2026-06-11T12:00:01Z",
                durationMs = 1240L,
                error = "",
            ),
            QueueJobView(
                id = "job-3",
                worker = "notification",
                status = "failed",
                title = "Weekly summary email",
                startedAt = "2026-06-11T11:58:00Z",
                finishedAt = "2026-06-11T11:58:02Z",
                durationMs = 2010L,
                error = "SMTP timeout after 30s",
            ),
        )

    private fun contentState(stale: Boolean = false): UiState<QueueJobsResponse> =
        UiState(
            phase = UiPhase.Content,
            data = QueueJobsResponse(worker = "notification", jobs = jobs),
            fetchedAt = QueueJobDrawerProjection.parseIsoMillis("2026-06-11T12:00:00Z"),
            stale = stale,
            // Pairing stale with an error keeps the auto-refresh effect from firing in the test.
            errorKind = if (stale) ErrorKind.Network else null,
        )

    private fun setContent(
        state: UiState<QueueJobsResponse>,
        onRetry: () -> Unit = {},
        onClose: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    QueueJobDrawerContent(
                        title = title,
                        state = state,
                        onRetry = onRetry,
                        onClose = onClose,
                        strings = strings,
                    )
                }
            }
        }
    }

    @Test
    fun headerShowsTitleAndAccessibleClose() {
        setContent(contentState())
        compose.onNodeWithText(title).assertIsDisplayed()
        // The close affordance carries an accessible name (web Drawer close) and is actionable.
        compose.onNodeWithContentDescription(strings.close).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun loadingShowsLoadingMessage() {
        setContent(UiState.loading())
        compose.onNodeWithText(strings.loading).assertIsDisplayed()
        compose.onNodeWithText(title).assertIsDisplayed()
    }

    @Test
    fun errorShowsErrorMessageAndRetryableAffordance() {
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Unknown))
        compose.onNodeWithText(strings.error).assertIsDisplayed()
        compose.onNodeWithText(strings.retry).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun emptyShowsEmptyMessage() {
        setContent(UiState(phase = UiPhase.Empty, data = QueueJobsResponse(worker = "notification", jobs = emptyList())))
        compose.onNodeWithText(strings.empty).assertIsDisplayed()
    }

    @Test
    fun contentShowsRowTitlesAndStatuses() {
        setContent(contentState())
        compose.onNodeWithText("Charge complete push").assertIsDisplayed()
        compose.onNodeWithText("Weekly summary email").assertIsDisplayed()
        // Localized status words resolve from the real catalog (sent -> "Sent", failed -> "Failed").
        compose.onNodeWithText("Sent").assertIsDisplayed()
        compose.onNodeWithText("Failed").assertIsDisplayed()
    }

    @Test
    fun failedRowShowsErrorBlock() {
        setContent(contentState())
        compose.onNodeWithTag(queueJobRowTestTag("job-3")).assertIsDisplayed()
        compose.onNodeWithText("SMTP timeout after 30s").assertIsDisplayed()
    }

    @Test
    fun closeButtonInvokesOnClose() {
        var closed = false
        setContent(contentState(), onClose = { closed = true })
        compose.onNodeWithContentDescription(strings.close).performClick()
        assertEquals(true, closed)
    }

    @Test
    fun retryButtonInvokesOnRetry() {
        var retried = false
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Unknown), onRetry = { retried = true })
        compose.onNodeWithText(strings.retry).performClick()
        assertEquals(true, retried)
    }

    @Test
    fun offlineStaleStillRendersContent() {
        setContent(contentState(stale = true))
        // Cached "last known" rows stay visible rather than blanking when stale/offline.
        compose.onNodeWithText("Charge complete push").assertIsDisplayed()
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
