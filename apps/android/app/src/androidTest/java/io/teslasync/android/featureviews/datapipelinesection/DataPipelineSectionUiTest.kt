package io.teslasync.android.featureviews.datapipelinesection

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.exports.ExportJobSummary
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/**
 * Instrumented Compose UI + accessibility verification of [DataPipelineSectionContent] across every branch
 * the web component renders (loading skeletons / content with compression + export blocks / empty / error +
 * retry) plus the lifecycle states the shared feed adds (offline "last known" + chip). Asserts the rendered
 * section headings, the savings/active header badges, that each export-row status is announced via its
 * content description (the merged icon + text), and that the error Retry exposes an accessible click action.
 * Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure projection +
 * the view-model state machine.
 */
class DataPipelineSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private object NoopLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    private val strings =
        DataPipelineStrings(
            title = "Data Pipeline",
            description = "Compression statistics and export job queue",
            compressionStatistics = "Compression Statistics",
            exportJobQueue = "Export Job Queue",
            compressionRatio = "Compression Ratio",
            estimatedSavings = "Estimated Savings",
            totalPositions = "Total Positions",
            compressed = "Compressed",
            savings = "Savings",
            pending = "Pending",
            processing = "Processing",
            completed = "Completed",
            failed = "Failed",
            statusHeader = "Status",
            typeHeader = "Type",
            formatHeader = "Format",
            fileHeader = "File",
            recordsHeader = "Records",
            createdHeader = "Created",
            noExportJobs = "No export jobs",
            noExportJobsInQueue = "No export jobs in queue",
            savedSuffix = "saved",
            activeSuffix = "active",
        )

    private val compression =
        CompressionStats(
            savingsPercent = 72.4,
            totalPositions = 4_820_000,
            compressedPositions = 3_490_000,
            estimatedSavedBytes = 268_435_456,
        )

    private fun job(
        id: String,
        status: String,
    ) = ExportJobSummary(
        id = id,
        type = "drives",
        format = "csv",
        status = status,
        fileName = "drives-$id.csv",
        recordCount = 1_280L,
        createdAt = "2026-06-11T12:00:00Z",
    )

    private val jobs = listOf(job("e1", "ready"), job("e2", "processing"))

    private fun setContent(
        state: UiState<DataPipelineData>,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    DataPipelineSectionContent(
                        state = state,
                        onRefresh = onRefresh,
                        locale = Locale.US,
                        zoneId = ZoneId.of("UTC"),
                        strings = strings,
                        defaultOpen = true,
                        logger = NoopLogger,
                    )
                }
            }
        }
    }

    @Test
    fun loadingShowsHeaderButNoSections() {
        setContent(UiState.loading())
        compose.onNodeWithText("Data Pipeline", substring = true).assertIsDisplayed()
        // The skeleton body carries no section subheads.
        compose.onAllNodesWithText("Export Job Queue").assertCountEquals(0)
    }

    @Test
    fun contentShowsCompressionAndExportSections() {
        setContent(UiState(phase = UiPhase.Content, data = DataPipelineData(compression, jobs), fetchedAt = 1_000L))
        compose.onNodeWithText("Compression Statistics").assertIsDisplayed()
        compose.onNodeWithText("Compression Ratio").assertIsDisplayed()
        compose.onNodeWithText("Estimated Savings").assertIsDisplayed()
        compose.onNodeWithText("Total Positions").assertIsDisplayed()
        compose.onNodeWithText("Savings").assertIsDisplayed() // RadialGauge label
        compose.onNodeWithText("Export Job Queue").assertIsDisplayed()
        compose.onNodeWithText("Pending").assertIsDisplayed()
        compose.onNodeWithText("Completed").assertIsDisplayed()
        compose.onNodeWithText("Failed").assertIsDisplayed()
    }

    @Test
    fun headerBadgesShowSavingsAndActive() {
        setContent(UiState(phase = UiPhase.Content, data = DataPipelineData(compression, jobs), fetchedAt = 1_000L))
        // savings% saved (web info badge) + the active-jobs count (1 processing → "1 active", web warning badge).
        compose.onNodeWithText("72.40% saved", substring = true).assertIsDisplayed()
        compose.onNodeWithText("1 active", substring = true).assertIsDisplayed()
    }

    @Test
    fun exportRowStatusIsAnnouncedForAccessibility() {
        setContent(UiState(phase = UiPhase.Content, data = DataPipelineData(compression, jobs), fetchedAt = 1_000L))
        // Each status cell merges its icon + text into one TalkBack label (the raw wire status).
        compose.onNodeWithContentDescription("ready").assertIsDisplayed()
        compose.onNodeWithContentDescription("processing").assertIsDisplayed()
    }

    @Test
    fun emptyShowsFriendlyNoJobsMessage() {
        setContent(UiState(phase = UiPhase.Empty, data = DataPipelineData(null, emptyList()), fetchedAt = 1_000L))
        compose.onNodeWithText("Export Job Queue").assertIsDisplayed()
        compose.onNodeWithText("No export jobs in queue").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryWithAccessibleClickAction() {
        var retried = false
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRefresh = { retried = true })
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineShowsCachedContentAndOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = DataPipelineData(compression, jobs),
                fetchedAt = 1_000L,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )
        // Cached "last known" content stays visible …
        compose.onNodeWithText("Export Job Queue").assertIsDisplayed()
        // … alongside the offline freshness chip (announced via its content description).
        compose.onNodeWithContentDescription("Offline").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 1200.dp
    }
}
