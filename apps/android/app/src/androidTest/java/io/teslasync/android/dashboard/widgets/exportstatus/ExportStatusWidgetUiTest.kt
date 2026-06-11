package io.teslasync.android.dashboard.widgets.exportstatus

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
 * On-device Compose UI + accessibility verification of [ExportStatusWidgetContent] across every state
 * the web component renders (loading skeleton, empty, hard error + retry, compact active-jobs hero,
 * standard job list, wide-only download affordance, stale/offline cached). Asserts the rendered i18n
 * strings and the TalkBack content descriptions are present. Runs under `connectedAndroidTest` (a
 * device/emulator) — the offline gate's `testReleaseUnitTest` covers the logic; this covers the render.
 */
class ExportStatusWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val fixedNow = 1_780_000_000_000L

    private fun job(
        id: String = "e1",
        status: JobStatus = JobStatus.Ready,
        filePath: String? = "/exports/done.csv",
        format: String = "csv",
        size: Long = 1024,
    ) = ExportStatusJob(
        id = id,
        format = format,
        filePath = filePath,
        fileSizeBytes = size,
        createdAt = "2026-06-06T12:00:00Z",
        status = status,
    )

    private fun setContent(
        state: UiState<List<ExportStatusJob>>,
        size: ExportStatusSize = ExportStatusRegistration.defaultSize,
        onRefresh: () -> Unit = {},
        onDownload: (String) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ExportStatusWidgetContent(
                    state = state,
                    size = size,
                    onRefresh = onRefresh,
                    onDownload = onDownload,
                    nowMillis = fixedNow,
                )
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyShowsFriendlyMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList(), fetchedAt = fixedNow))
        compose.onNodeWithText("No export jobs").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRefresh() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRefresh = { retried = true },
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun compactHeroShowsActiveLabelAndRunningBadge() {
        setContent(
            state = UiState(UiPhase.Content, data = listOf(job(status = JobStatus.Processing)), fetchedAt = fixedNow),
            size = ExportStatusSize(cols = 1, rows = 2),
        )
        // The compact hero folds the "Active Exports" label + count + Running/Idle badge into one phrase.
        compose.onNodeWithContentDescription("Active Exports", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Running", substring = true).assertIsDisplayed()
    }

    @Test
    fun standardListShowsTitleAndJobRow() {
        setContent(UiState(UiPhase.Content, data = listOf(job(status = JobStatus.Ready)), fetchedAt = fixedNow))
        compose.onNodeWithText("Export Status").assertIsDisplayed()
        // The row exposes a single TalkBack phrase folding filename + format + size + status + time.
        compose.onNodeWithContentDescription("done.csv", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Done", substring = true).assertIsDisplayed()
    }

    @Test
    fun wideReadyRowExposesDownloadAction() {
        var downloadedId: String? = null
        setContent(
            state = UiState(UiPhase.Content, data = listOf(job(status = JobStatus.Ready)), fetchedAt = fixedNow),
            size = ExportStatusSize(cols = 4, rows = 4),
            onDownload = { downloadedId = it },
        )
        compose.onNodeWithContentDescription("Download").assertIsDisplayed()
        compose.onNodeWithContentDescription("Download").performClick()
        assertTrue(downloadedId == "e1")
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = listOf(job(status = JobStatus.Ready)),
                fetchedAt = fixedNow,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached rows stay visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("done.csv", substring = true).assertIsDisplayed()
    }

    @Test
    fun contentHeaderExposesRefreshAction() {
        setContent(UiState(UiPhase.Content, data = listOf(job()), fetchedAt = fixedNow))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }
}
