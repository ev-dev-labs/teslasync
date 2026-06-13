package io.teslasync.android.modalsdialogs.jobprogressdrawer

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.exports.ExportJobSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * Off-device coverage of the pure JobProgressDrawer projection — the parity-critical derivations the
 * web component performs before render (web/src/components/feedback/JobProgressDrawer.tsx): the status
 * taxonomy + tone (`statusIcon`), the active/recent split + `maxRecent` slice (`isActive` /
 * `activeJobs` / `recentJobs`), the open/minimized/dismissed machine with the dismissed -> minimized
 * promotion and the two auto-hide guards (`useEffect` + `return null`), the byte label
 * (`formatBytes`), the relative-age bucketing (`formatRelative`), the per-job download URL
 * (`exportDownloadUrl`), and the PII-safe `view.opened` diagnostic. Run by the
 * `:app:testReleaseUnitTest` gate.
 */
class JobProgressDrawerModelTest {
    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    private fun job(
        id: String,
        status: String,
        fileSize: Long? = null,
        errorMessage: String? = null,
    ): ExportJobSummary =
        ExportJobSummary(
            id = id,
            type = "drives",
            format = "csv",
            status = status,
            fileSize = fileSize,
            errorMessage = errorMessage,
            createdAt = "2026-06-12T18:00:00Z",
        )

    private fun project(
        jobs: List<ExportJobSummary>,
        presentation: DrawerPresentation = DrawerPresentation.Open,
        isLoading: Boolean = false,
        isError: Boolean = false,
        now: Long = NOW,
    ): JobProgressProjection =
        projectJobProgress(
            feed = JobFeedState(jobs, isLoading, isError),
            presentation = presentation,
            maxRecent = DEFAULT_MAX_RECENT,
            nowMillis = now,
        )

    @Test
    fun parsesKnownStatusesAndLeavesUnknownNull() {
        assertEquals(JobStatus.Queued, JobStatus.parse("queued"))
        assertEquals(JobStatus.Processing, JobStatus.parse("PROCESSING"))
        assertEquals(JobStatus.Ready, JobStatus.parse("ready"))
        assertEquals(JobStatus.Failed, JobStatus.parse("failed"))
        assertEquals(JobStatus.Expired, JobStatus.parse("expired"))
        assertNull(JobStatus.parse("something-else"))
    }

    @Test
    fun activeStatusMatchesWebIsActive() {
        assertTrue(isActiveStatus("queued"))
        assertTrue(isActiveStatus("processing"))
        assertFalse(isActiveStatus("ready"))
        assertFalse(isActiveStatus("failed"))
        assertFalse(isActiveStatus("expired"))
        assertFalse(isActiveStatus("unknown"))
    }

    @Test
    fun toneMatchesWebStatusColours() {
        assertEquals(JobStatusTone.Muted, statusTone(JobStatus.Queued))
        assertEquals(JobStatusTone.Info, statusTone(JobStatus.Processing))
        assertEquals(JobStatusTone.Success, statusTone(JobStatus.Ready))
        assertEquals(JobStatusTone.Danger, statusTone(JobStatus.Failed))
        assertEquals(JobStatusTone.Warning, statusTone(JobStatus.Expired))
        assertEquals(JobStatusTone.Muted, statusTone(null))
    }

    @Test
    fun effectivePresentationPromotesDismissedOnlyWhenActive() {
        assertEquals(DrawerPresentation.Minimized, effectivePresentation(DrawerPresentation.Dismissed, 1))
        assertEquals(DrawerPresentation.Dismissed, effectivePresentation(DrawerPresentation.Dismissed, 0))
        assertEquals(DrawerPresentation.Open, effectivePresentation(DrawerPresentation.Open, 3))
        assertEquals(DrawerPresentation.Minimized, effectivePresentation(DrawerPresentation.Minimized, 0))
    }

    @Test
    fun visibilityReproducesWebReturnNullGuards() {
        // Dismissed with no active work stays hidden (web first `return null`).
        assertFalse(jobProgressVisible(DrawerPresentation.Dismissed, 0, 4, isLoading = false, isError = false))
        // Empty + not loading + no error stays hidden (web second `return null`).
        assertFalse(jobProgressVisible(DrawerPresentation.Minimized, 0, 0, isLoading = false, isError = false))
        // Empty but still loading shows (the loading body).
        assertTrue(jobProgressVisible(DrawerPresentation.Minimized, 0, 0, isLoading = true, isError = false))
        // Empty hard error shows so the retry affordance surfaces.
        assertTrue(jobProgressVisible(DrawerPresentation.Open, 0, 0, isLoading = false, isError = true))
        // Populated content shows.
        assertTrue(jobProgressVisible(DrawerPresentation.Open, 1, 4, isLoading = false, isError = false))
    }

    @Test
    fun projectionSplitsActiveAndRecentAndCapsRecent() {
        val jobs =
            listOf(job("a1", "queued"), job("a2", "processing")) +
                (1..8).map { job("r$it", "ready", fileSize = 1024L) }

        val projection = project(jobs)

        assertEquals(2, projection.activeCount)
        assertEquals(2, projection.activeRows.size)
        assertEquals(DEFAULT_MAX_RECENT, projection.recentRows.size)
        assertEquals(DrawerMode.Open, projection.mode)
        assertTrue(projection.visible)
        assertFalse(projection.isLoadingBody)
        assertTrue(projection.minimizedShowsActive)
        assertEquals(JobBucket.Active, projection.activeRows.first().bucket)
        assertEquals(JobBucket.Recent, projection.recentRows.first().bucket)
    }

    @Test
    fun dismissedDrawerWithActiveJobPromotesToMinimized() {
        val projection = project(listOf(job("a1", "processing")), presentation = DrawerPresentation.Dismissed)
        assertTrue(projection.visible)
        assertEquals(DrawerMode.Minimized, projection.mode)
    }

    @Test
    fun loadingBodyOnlyWhenLoadingAndEmpty() {
        assertTrue(project(emptyList(), isLoading = true).isLoadingBody)
        assertFalse(project(listOf(job("a1", "processing")), isLoading = true).isLoadingBody)
    }

    @Test
    fun readyRowExposesDownloadUrlMatchingWebHelper() {
        val row = project(listOf(job("xyz", "ready", fileSize = 2_400_000L))).recentRows.single()
        assertEquals("/api/v1/export/jobs/xyz/download", row.downloadUrl)
        assertTrue(row.downloadable)
        assertFalse(row.showFailedAffordance)
        assertEquals(JobStatusTone.Success, row.tone)
        assertEquals("2.3 MB", row.sizeLabel)
    }

    @Test
    fun failedRowKeepsErrorAndAffordanceAndDropsBlankError() {
        val row = project(listOf(job("f1", "failed", errorMessage = "boom"))).recentRows.single()
        assertNull(row.downloadUrl)
        assertTrue(row.showFailedAffordance)
        assertEquals(JobStatusTone.Danger, row.tone)
        assertEquals("boom", row.errorMessage)

        val blankRow = project(listOf(job("f2", "failed", errorMessage = "   "))).recentRows.single()
        assertNull(blankRow.errorMessage)
    }

    @Test
    fun unknownStatusFallsToRecentMutedAndKeepsWire() {
        val row = project(listOf(job("u1", "weird"))).recentRows.single()
        assertNull(row.status)
        assertEquals("weird", row.statusWire)
        assertEquals(JobStatusTone.Muted, row.tone)
        assertEquals(JobBucket.Recent, row.bucket)
    }

    @Test
    fun activeRowUsesCreatedAtAgeRecentRowUsesCompletedAtAge() {
        val created = "2026-06-12T18:00:00Z"
        val completed = "2026-06-12T18:55:00Z"
        val now = Instant.parse("2026-06-12T19:00:00Z").toEpochMilli()

        val activeJob = ExportJobSummary(id = "a", type = "drives", format = "csv", status = "processing", createdAt = created)
        val activeRow = project(listOf(activeJob), now = now).activeRows.single()
        // 60 minutes after creation -> Hours(1) (web `formatRelative` -> "1h ago").
        assertEquals(FreshnessAge.Hours(1), activeRow.createdAtAge)

        val recentJob =
            ExportJobSummary(id = "r", type = "drives", format = "csv", status = "ready", createdAt = created, completedAt = completed)
        val recentRow = project(listOf(recentJob), now = now).recentRows.single()
        // 5 minutes after completion -> Minutes(5) (web uses completed_at for finished rows).
        assertEquals(FreshnessAge.Minutes(5), recentRow.finishedAtAge)
    }

    @Test
    fun formatBytesMatchesWebZeroAsEmptyAndGbDecimals() {
        assertEquals(EXPORT_EM_DASH, formatExportBytes(null))
        assertEquals(EXPORT_EM_DASH, formatExportBytes(0L))
        assertEquals("512 B", formatExportBytes(512L))
        assertEquals("1.5 KB", formatExportBytes(1_536L))
        assertEquals("2.3 MB", formatExportBytes(2_400_000L))
        assertEquals("4.66 GB", formatExportBytes(5_000_000_000L))
        assertEquals("1.40 GB", formatExportBytes(1_503_238_553L))
    }

    @Test
    fun parseEpochMillisToleratesOffsetInstantAndGarbage() {
        val utc = Instant.parse("2026-06-12T18:00:00Z").toEpochMilli()
        assertEquals(utc, parseEpochMillis("2026-06-12T18:00:00Z"))
        assertEquals(utc, parseEpochMillis("2026-06-12T20:00:00+02:00"))
        assertNull(parseEpochMillis(null))
        assertNull(parseEpochMillis(""))
        assertNull(parseEpochMillis("not-a-date"))
    }

    @Test
    fun recordViewOpenedEmitsPiiSafeSlug() {
        val logger = RecordingLogger()
        recordJobProgressDrawerViewOpened(logger)
        val opened = logger.events.single { it.first == "view.opened" }
        assertEquals(mapOf("surface" to "JobProgressDrawer"), opened.second)
    }

    private companion object {
        val NOW: Long = Instant.parse("2026-06-12T19:00:00Z").toEpochMilli()
    }
}
