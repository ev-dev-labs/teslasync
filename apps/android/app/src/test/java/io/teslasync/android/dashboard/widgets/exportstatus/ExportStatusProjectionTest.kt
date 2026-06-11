package io.teslasync.android.dashboard.widgets.exportstatus

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.shared.core.presentation.exports.ExportJob
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of [ExportStatusProjection] + the [ExportStatusJob] parsers — the pure
 * data the web component computes before returning JSX (status normalisation, the dedupe-by-id /
 * admin-wins / status-then-recency merge, byte + filename formatting, the compact hero counts, and
 * the standard rows with their download/progress gating). Runs in the :android:testReleaseUnitTest
 * gate. Time + locale are injected so every assertion is deterministic.
 */
class ExportStatusProjectionTest {
    private val now = 1_780_000_000_000L

    private fun strings() =
        ExportStatusStrings(
            title = "Export Status",
            activeJobsLabel = "Active Exports",
            runningBadge = "Running",
            idleBadge = "Idle",
            emptyMessage = "No export jobs",
            queuedLabel = "Queued",
            runningLabel = "Running",
            doneLabel = "Done",
            failedLabel = "Failed",
            downloadLabel = "Download",
            refreshLabel = "Refresh",
            refreshingLabel = "Loading",
            offlineLabel = "Offline",
            formatRelative = { age ->
                when (age) {
                    FreshnessAge.Unknown -> "—"
                    FreshnessAge.JustNow -> "just now"
                    is FreshnessAge.Seconds -> "${age.value}s ago"
                    is FreshnessAge.Minutes -> "${age.value}m ago"
                    is FreshnessAge.Hours -> "${age.value}h ago"
                    is FreshnessAge.Days -> "${age.value}d ago"
                    is FreshnessAge.Weeks -> "${age.value}w ago"
                }
            },
        )

    private fun job(
        id: String,
        status: JobStatus,
        createdAt: String? = "2026-06-06T12:00:00Z",
        filePath: String? = null,
    ) = ExportStatusJob(
        id = id,
        format = "csv",
        filePath = filePath,
        fileSizeBytes = 0,
        createdAt = createdAt,
        status = status,
    )

    // ── Status normalisation (web normaliseStatusFromExport / normaliseStatusFromAdmin) ──────────

    @Test
    fun normalisesEveryStatusFamilyCaseInsensitively() {
        assertEquals(JobStatus.Processing, normaliseStatusFromExport("processing"))
        assertEquals(JobStatus.Processing, normaliseStatusFromExport("RUNNING"))
        assertEquals(JobStatus.Ready, normaliseStatusFromAdmin("ready"))
        assertEquals(JobStatus.Ready, normaliseStatusFromAdmin("Done"))
        assertEquals(JobStatus.Ready, normaliseStatusFromAdmin("completed"))
        assertEquals(JobStatus.Failed, normaliseStatusFromExport("failed"))
        assertEquals(JobStatus.Failed, normaliseStatusFromExport("ERROR"))
        assertEquals(JobStatus.Queued, normaliseStatusFromAdmin("queued"))
        assertEquals(JobStatus.Queued, normaliseStatusFromAdmin(null))
        assertEquals(JobStatus.Queued, normaliseStatusFromAdmin("anything-else"))
    }

    @Test
    fun badgeToneMapsEachStatus() {
        assertEquals(ExportBadgeTone.Neutral, JobStatus.Queued.badgeTone())
        assertEquals(ExportBadgeTone.Info, JobStatus.Processing.badgeTone())
        assertEquals(ExportBadgeTone.Success, JobStatus.Ready.badgeTone())
        assertEquals(ExportBadgeTone.Danger, JobStatus.Failed.badgeTone())
    }

    // ── Byte + filename formatting (web fmtBytes / truncateFilename) ─────────────────────────────

    @Test
    fun formatBytesMatchesWebTiers() {
        assertEquals("—", ExportStatusProjection.formatBytes(0, Locale.US))
        assertEquals("—", ExportStatusProjection.formatBytes(-10, Locale.US))
        assertEquals("512 B", ExportStatusProjection.formatBytes(512, Locale.US))
        assertEquals("1023 B", ExportStatusProjection.formatBytes(1023, Locale.US))
        assertEquals("1.0 KB", ExportStatusProjection.formatBytes(1024, Locale.US))
        assertEquals("1.5 KB", ExportStatusProjection.formatBytes(1536, Locale.US))
        assertEquals("1.0 MB", ExportStatusProjection.formatBytes(1024L * 1024, Locale.US))
        assertEquals("2.5 MB", ExportStatusProjection.formatBytes((2.5 * 1024 * 1024).toLong(), Locale.US))
        assertEquals("1.0 GB", ExportStatusProjection.formatBytes(1024L * 1024 * 1024, Locale.US))
    }

    @Test
    fun truncateFilenameTakesBaseNameAndEllipsizes() {
        assertEquals("—", ExportStatusProjection.truncateFilename(null))
        assertEquals("—", ExportStatusProjection.truncateFilename(""))
        assertEquals("report.csv", ExportStatusProjection.truncateFilename("/exports/2026/report.csv"))
        assertEquals("noslash.json", ExportStatusProjection.truncateFilename("noslash.json"))
        val long = "/exports/a-very-long-export-filename-that-exceeds-the-cap.csv"
        val result = ExportStatusProjection.truncateFilename(long)
        assertEquals(28, result.length)
        assertTrue(result.endsWith("\u2026"))
    }

    // ── Parsing (web fromExportHook / fromAdminHook) ─────────────────────────────────────────────

    @Test
    fun fromExportProjectsFieldsAndFsmStatus() {
        val parsed =
            ExportStatusJob.fromExport(
                ExportJob(
                    id = "e1",
                    format = "json",
                    fsmState = "processing",
                    filePath = "/exports/e1.json",
                    fileSize = 2048,
                    createdAt = "2026-06-06T12:00:00Z",
                ),
            )
        assertEquals("e1", parsed.id)
        assertEquals("json", parsed.format)
        assertEquals("/exports/e1.json", parsed.filePath)
        assertEquals(2048L, parsed.fileSizeBytes)
        assertEquals(JobStatus.Processing, parsed.status)
    }

    @Test
    fun fromExportDefaultsMissingFields() {
        val parsed = ExportStatusJob.fromExport(ExportJob(id = "e2"))
        assertEquals("", parsed.format)
        assertNull(parsed.filePath)
        assertEquals(0L, parsed.fileSizeBytes)
        assertEquals(JobStatus.Queued, parsed.status)
    }

    @Test
    fun parseAdminListReadsSnakeCaseAndDropsInvalidRows() {
        val array: JsonArray =
            buildJsonArray {
                add(
                    buildJsonObject {
                        put("id", "a1")
                        put("format", "csv")
                        put("file_size", 4096L)
                        put("status", "ready")
                        put("created_at", "2026-06-06T10:00:00Z")
                    },
                )
                add(JsonPrimitive("not-an-object"))
                add(buildJsonObject { put("format", "csv") }) // missing id → dropped
                add(JsonNull)
            }
        val jobs = ExportStatusJob.parseAdminList(array)
        assertEquals(1, jobs.size)
        val a1 = jobs.single()
        assertEquals("a1", a1.id)
        assertEquals(4096L, a1.fileSizeBytes)
        assertNull(a1.filePath)
        assertEquals(JobStatus.Ready, a1.status)
    }

    @Test
    fun parseAdminListToleratesNonArray() {
        assertTrue(ExportStatusJob.parseAdminList(null).isEmpty())
        assertTrue(ExportStatusJob.parseAdminList(JsonPrimitive("x")).isEmpty())
        assertTrue(ExportStatusJob.parseAdminList(JsonObject(emptyMap())).isEmpty())
    }

    // ── Merge (web sortedJobs memo) ──────────────────────────────────────────────────────────────

    @Test
    fun mergeAdminWinsByIdAndKeepsExportOnlyRows() {
        val exports =
            listOf(
                job("shared", JobStatus.Queued, filePath = "/exports/old.csv"),
                job("export-only", JobStatus.Ready),
            )
        val admin = listOf(job("shared", JobStatus.Failed))
        val merged = ExportStatusProjection.merge(exports, admin)
        assertEquals(2, merged.size)
        // The shared id takes the admin row (status Failed, no file path).
        val shared = merged.single { it.id == "shared" }
        assertEquals(JobStatus.Failed, shared.status)
        assertNull(shared.filePath)
        assertTrue(merged.any { it.id == "export-only" })
    }

    @Test
    fun mergeSortsByStatusOrderThenNewestFirst() {
        val merged =
            ExportStatusProjection.merge(
                exportJobs = emptyList(),
                adminJobs =
                    listOf(
                        job("ready-old", JobStatus.Ready, createdAt = "2026-01-01T00:00:00Z"),
                        job("failed", JobStatus.Failed),
                        job("processing", JobStatus.Processing),
                        job("queued", JobStatus.Queued),
                        job("ready-new", JobStatus.Ready, createdAt = "2026-06-01T00:00:00Z"),
                    ),
            )
        assertEquals(
            listOf("processing", "queued", "ready-new", "ready-old", "failed"),
            merged.map { it.id },
        )
    }

    // ── Projection: compact hero (web CompactView) ───────────────────────────────────────────────

    @Test
    fun projectCompactCountsActiveJobsAndRunningBadge() {
        val jobs =
            listOf(
                job("p", JobStatus.Processing),
                job("q", JobStatus.Queued),
                job("r", JobStatus.Ready),
                job("f", JobStatus.Failed),
            )
        val display = ExportStatusProjection.project(jobs, ExportStatusSize(1, 2), strings(), now)
        assertTrue(display.isCompact)
        assertTrue(display.hasJobs)
        assertEquals(2, display.activeCount) // processing + queued
        assertTrue(display.hasRunning)
        assertEquals("Running", display.compactBadgeLabel)
        assertEquals(ExportBadgeTone.Success, display.compactBadgeTone)
        assertEquals("Active Exports", display.activeJobsLabel)
    }

    @Test
    fun projectCompactShowsIdleWhenNothingRunning() {
        val jobs = listOf(job("q", JobStatus.Queued), job("r", JobStatus.Ready))
        val display = ExportStatusProjection.project(jobs, ExportStatusSize(1, 2), strings(), now)
        assertFalse(display.hasRunning)
        assertEquals(1, display.activeCount) // only the queued job is active
        assertEquals("Idle", display.compactBadgeLabel)
        assertEquals(ExportBadgeTone.Neutral, display.compactBadgeTone)
    }

    // ── Projection: standard rows (web StandardView / JobRow) ────────────────────────────────────

    @Test
    fun projectStandardRowFormatsCells() {
        val jobs = listOf(job("r", JobStatus.Ready, filePath = "/exports/done.csv").copy(fileSizeBytes = 1536))
        val display = ExportStatusProjection.project(jobs, ExportStatusSize(4, 4), strings(), now)
        val row = display.rows.single()
        assertEquals("done.csv", row.fileName)
        assertEquals("CSV", row.formatLabel)
        assertEquals("1.5 KB", row.sizeLabel)
        assertEquals("Done", row.statusLabel)
        assertEquals(ExportBadgeTone.Success, row.statusTone)
        assertFalse(row.showProgress)
        assertTrue(row.downloadable) // wide + filePath + ready
        assertTrue(row.contentDescription.contains("done.csv"))
        assertTrue(row.contentDescription.contains("Done"))
    }

    @Test
    fun processingRowFlagsProgressBar() {
        val jobs = listOf(job("p", JobStatus.Processing, filePath = "/exports/p.csv"))
        val row = ExportStatusProjection.project(jobs, ExportStatusSize(4, 4), strings(), now).rows.single()
        assertTrue(row.showProgress)
        assertEquals("Running", row.statusLabel)
        assertFalse(row.downloadable) // not ready
    }

    @Test
    fun downloadRequiresWideReadyAndFilePath() {
        val ready = job("r", JobStatus.Ready, filePath = "/exports/r.csv")
        val narrow = ExportStatusProjection.project(listOf(ready), ExportStatusSize(2, 4), strings(), now)
        assertFalse(narrow.rows.single().downloadable) // not wide
        val noPath =
            ExportStatusProjection.project(
                listOf(job("r", JobStatus.Ready, filePath = null)),
                ExportStatusSize(4, 4),
                strings(),
                now,
            )
        assertFalse(noPath.rows.single().downloadable) // no file path
    }

    @Test
    fun emptyFormatRendersEmDash() {
        val jobs = listOf(job("x", JobStatus.Queued, filePath = null).copy(format = ""))
        val row = ExportStatusProjection.project(jobs, ExportStatusSize(2, 4), strings(), now).rows.single()
        assertEquals("—", row.fileName)
        assertEquals("—", row.formatLabel)
        assertEquals("—", row.sizeLabel)
    }

    @Test
    fun projectCapsRowsAtStandardMax() {
        val jobs = (1..30).map { job("j$it", JobStatus.Ready, createdAt = "2026-06-%02dT00:00:00Z".format(it % 28 + 1)) }
        val display = ExportStatusProjection.project(jobs, ExportStatusSize(4, 40), strings(), now)
        assertEquals(ExportStatusSize.STANDARD_MAX_ITEMS, display.rows.size)
    }

    @Test
    fun projectEmptyHasNoJobs() {
        val display = ExportStatusProjection.project(emptyList(), ExportStatusSize(2, 4), strings(), now)
        assertFalse(display.hasJobs)
        assertTrue(display.rows.isEmpty())
        assertEquals(0, display.activeCount)
    }

    // ── Registration metadata (web registry/system.ts export-status) ─────────────────────────────

    @Test
    fun registrationMatchesWebRegistry() {
        assertEquals("export-status", ExportStatusRegistration.ID)
        assertEquals("system", ExportStatusRegistration.CATEGORY)
        assertEquals("ExportStatusWidget", ExportStatusRegistration.SLUG)
        assertEquals(ExportStatusSize(2, 4), ExportStatusRegistration.defaultSize)
        assertEquals(ExportStatusSize(1, 2), ExportStatusRegistration.minSize)
        assertEquals(ExportStatusSize(4, 40), ExportStatusRegistration.maxSize)
        assertTrue(ExportStatusRegistration.isWithinBounds(ExportStatusSize(2, 4)))
        assertFalse(ExportStatusRegistration.isWithinBounds(ExportStatusSize(5, 4)))
        assertEquals(ExportStatusSize(4, 40), ExportStatusRegistration.clamp(ExportStatusSize(9, 99)))
        assertEquals(ExportStatusSize(1, 2), ExportStatusRegistration.clamp(ExportStatusSize(0, 0)))
    }
}
