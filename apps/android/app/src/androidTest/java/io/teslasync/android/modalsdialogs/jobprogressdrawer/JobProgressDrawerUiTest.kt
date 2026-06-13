package io.teslasync.android.modalsdialogs.jobprogressdrawer

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.exports.ExportJobSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.Instant

/**
 * On-device Compose UI + accessibility verification of the JobProgressDrawer surface across every
 * state it renders: the minimized "Exports" chip + its expand a11y label, the minimized active-count
 * chip, the open panel header + "In progress"/"Recent" sections with the populated row + download
 * affordance, the loading line, the hard-error retry surface, the per-section empty states, the
 * stale/offline cached view + offline chip, and the auto-hidden (dismissed) surface. The offline gate's
 * `testReleaseUnitTest` covers the pure projection + view-model; this covers render + a11y. Mirrors the
 * web spec (web/src/components/feedback/JobProgressDrawer.tsx).
 */
class JobProgressDrawerUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun job(
        id: String,
        status: String,
        type: String = "drives",
        format: String = "csv",
        fileSize: Long? = null,
        errorMessage: String? = null,
    ): ExportJobSummary =
        ExportJobSummary(
            id = id,
            type = type,
            format = format,
            status = status,
            fileSize = fileSize,
            errorMessage = errorMessage,
            createdAt = "2026-06-12T18:55:00Z",
            completedAt = "2026-06-12T18:58:00Z",
        )

    private fun projection(
        jobs: List<ExportJobSummary>,
        presentation: DrawerPresentation,
        isLoading: Boolean = false,
        isError: Boolean = false,
    ): JobProgressProjection = projectJobProgress(JobFeedState(jobs, isLoading, isError), presentation, DEFAULT_MAX_RECENT, NOW)

    private fun setContent(
        projection: JobProgressProjection,
        state: UiState<List<ExportJobSummary>>,
        onOpen: () -> Unit = {},
        onMinimize: () -> Unit = {},
        onDismiss: () -> Unit = {},
        onDownload: (String) -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                JobProgressDrawerContent(
                    projection = projection,
                    state = state,
                    onOpen = onOpen,
                    onMinimize = onMinimize,
                    onDismiss = onDismiss,
                    onDownload = onDownload,
                    onRetry = onRetry,
                )
            }
        }
    }

    @Test
    fun minimizedIdleChipShowsExportsAndAccessibleExpandLabel() {
        val jobs = listOf(job("r1", "ready", fileSize = 1024L))
        setContent(projection(jobs, DrawerPresentation.Minimized), UiState(UiPhase.Content, jobs))
        compose.onNodeWithText("Exports").assertIsDisplayed()
        compose.onNodeWithContentDescription("Show export jobs (0 active)").assertIsDisplayed()
    }

    @Test
    fun minimizedActiveChipShowsRunningCount() {
        val jobs = listOf(job("a1", "processing"))
        setContent(projection(jobs, DrawerPresentation.Minimized), UiState(UiPhase.Content, jobs))
        compose.onNodeWithText("1 export running").assertIsDisplayed()
        compose.onNodeWithContentDescription("Show export jobs (1 active)").assertIsDisplayed()
    }

    @Test
    fun openDrawerShowsHeaderSectionsRowAndAccessibleControls() {
        val jobs = listOf(job("a1", "processing"), job("r1", "ready", fileSize = 2_400_000L))
        setContent(projection(jobs, DrawerPresentation.Open), UiState(UiPhase.Content, jobs))
        compose.onNodeWithText("Export jobs").assertIsDisplayed()
        compose.onNodeWithText("In progress").assertIsDisplayed()
        compose.onNodeWithText("Recent").assertIsDisplayed()
        // Row content (merged into the row's accessible description).
        compose.onNodeWithText("Drives", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Download").assertIsDisplayed()
        // Accessible, labelled header controls.
        compose.onNodeWithContentDescription("Minimize").assertIsDisplayed()
        compose.onNodeWithContentDescription("Dismiss").assertIsDisplayed()
    }

    @Test
    fun loadingShowsLoadingLineNotABlankPanel() {
        setContent(
            projection(emptyList(), DrawerPresentation.Open, isLoading = true),
            UiState(UiPhase.Loading),
        )
        compose.onNodeWithText("Loading export jobs\u2026").assertIsDisplayed()
    }

    @Test
    fun hardErrorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(
            projection = projection(emptyList(), DrawerPresentation.Open, isError = true),
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = { retried = true },
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyActiveSectionShowsFriendlyLabel() {
        val jobs = listOf(job("r1", "ready", fileSize = 1024L))
        setContent(projection(jobs, DrawerPresentation.Open), UiState(UiPhase.Content, jobs))
        compose.onNodeWithText("No active exports").assertIsDisplayed()
    }

    @Test
    fun offlineShowsCachedRowsWithOfflineChip() {
        val jobs = listOf(job("a1", "processing"))
        setContent(
            projection = projection(jobs, DrawerPresentation.Open),
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = jobs,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
        )
        compose.onNodeWithText("In progress").assertIsDisplayed()
        compose.onAllNodesWithContentDescription("Offline").onFirst().assertIsDisplayed()
    }

    @Test
    fun dismissedWithNoActiveRendersNothing() {
        setContent(
            projection(listOf(job("r1", "ready", fileSize = 1024L)), DrawerPresentation.Dismissed),
            UiState(UiPhase.Content, listOf(job("r1", "ready", fileSize = 1024L))),
        )
        compose.onAllNodesWithContentDescription("Show export jobs (0 active)").assertCountEquals(0)
        compose.onAllNodesWithText("Export jobs").assertCountEquals(0)
    }

    @Test
    fun downloadAffordanceInvokesCallbackWithJobUrl() {
        var url: String? = null
        val jobs = listOf(job("xyz", "ready", fileSize = 2_400_000L))
        setContent(
            projection = projection(jobs, DrawerPresentation.Open),
            state = UiState(UiPhase.Content, jobs),
            onDownload = { url = it },
        )
        compose.onNodeWithText("Download").performClick()
        assertEquals("/api/v1/export/jobs/xyz/download", url)
    }

    @Test
    fun minimizeAndDismissControlsInvokeCallbacks() {
        var minimized = false
        var dismissed = false
        val jobs = listOf(job("a1", "processing"))
        setContent(
            projection = projection(jobs, DrawerPresentation.Open),
            state = UiState(UiPhase.Content, jobs),
            onMinimize = { minimized = true },
            onDismiss = { dismissed = true },
        )
        compose.onNodeWithContentDescription("Minimize").performClick()
        compose.onNodeWithContentDescription("Dismiss").performClick()
        assertTrue(minimized && dismissed)
    }

    private companion object {
        val NOW: Long = Instant.parse("2026-06-12T19:00:00Z").toEpochMilli()
    }
}
