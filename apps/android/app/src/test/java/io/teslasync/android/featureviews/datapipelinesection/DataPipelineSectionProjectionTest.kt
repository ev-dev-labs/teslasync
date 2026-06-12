package io.teslasync.android.featureviews.datapipelinesection

import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.shared.core.presentation.exports.ExportJobSummary
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Off-device coverage of the pure [DataPipelineProjection] — the native analogue of everything the web
 * `DataPipelineSection` derives before rendering: the compression-stats JSON parse, the per-status counts,
 * the int/percent/byte/date formatters (web `fmtInt`/`fmtPercent`/`formatBytes`/`formatDateTime`), the
 * status → tone/icon classification (web `statusTextClass`/`getStatusIcon`), the `record_count` sort, the
 * file-name truncation, the row projection, and the surface emptiness predicate. Runs in the
 * `:app:testReleaseUnitTest` gate, keeping the composable a thin render layer.
 */
class DataPipelineSectionProjectionTest {
    private val locale = Locale.US

    // Deterministic UTC formatter so the "Created" assertions do not depend on the host CLDR data.
    private val formatter: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm").withZone(ZoneOffset.UTC)

    private fun job(
        id: String,
        status: String = "ready",
        recordCount: Long? = 100L,
    ) = ExportJobSummary(
        id = id,
        type = "drives",
        format = "csv",
        status = status,
        fileName = "drives-$id.csv",
        recordCount = recordCount,
        createdAt = "2026-06-11T12:00:00Z",
    )

    @Test
    fun parseCompressionReadsEveryField() {
        val element =
            buildJsonObject {
                put("total", 1000L)
                put("compressed", 720L)
                put("savings_percent", 72.4)
                put("total_positions", 4_820_000L)
                put("compressed_positions", 3_490_000L)
                put("estimated_saved_rows", 1_330_000L)
                put("estimated_saved_bytes", 268_435_456L)
            }
        val stats = DataPipelineProjection.parseCompression(element)
        assertEquals(
            CompressionStats(
                total = 1000L,
                compressed = 720L,
                savingsPercent = 72.4,
                totalPositions = 4_820_000L,
                compressedPositions = 3_490_000L,
                estimatedSavedRows = 1_330_000L,
                estimatedSavedBytes = 268_435_456L,
            ),
            stats,
        )
    }

    @Test
    fun parseCompressionDefaultsMissingFieldsToZero() {
        val stats = DataPipelineProjection.parseCompression(buildJsonObject { put("savings_percent", 10.0) })
        assertEquals(10.0, stats?.savingsPercent ?: -1.0, 0.0001)
        assertEquals(0L, stats?.totalPositions)
        assertEquals(0L, stats?.estimatedSavedBytes)
    }

    @Test
    fun parseCompressionReturnsNullForNullOrNonObject() {
        assertNull(DataPipelineProjection.parseCompression(null))
        assertNull(DataPipelineProjection.parseCompression(JsonNull))
        assertNull(DataPipelineProjection.parseCompression(JsonPrimitive("nope")))
    }

    @Test
    fun countsTallyEachStatus() {
        val jobs =
            listOf(
                job("a", "queued"),
                job("b", "processing"),
                job("c", "processing"),
                job("d", "ready"),
                job("e", "failed"),
                job("f", "expired"),
            )
        val counts = DataPipelineProjection.counts(jobs)
        assertEquals(1, counts.pending)
        assertEquals(2, counts.processing)
        assertEquals(1, counts.completed)
        assertEquals(1, counts.failed)
        assertEquals(3, counts.active) // pending + processing
    }

    @Test
    fun fmtIntGroupsThousands() {
        assertEquals("4,820,000", DataPipelineProjection.fmtInt(4_820_000L, locale))
        assertEquals("0", DataPipelineProjection.fmtInt(0L, locale))
    }

    @Test
    fun fmtPercentUsesTwoDecimalsAndSuffix() {
        assertEquals("72.40%", DataPipelineProjection.fmtPercent(72.4, locale))
        assertEquals("0.00%", DataPipelineProjection.fmtPercent(Double.NaN, locale))
    }

    @Test
    fun formatBytesPicksBinaryUnit() {
        assertEquals("0 B", DataPipelineProjection.formatBytes(0L, locale))
        assertEquals("512.0 B", DataPipelineProjection.formatBytes(512L, locale))
        assertEquals("1.0 KB", DataPipelineProjection.formatBytes(1024L, locale))
        assertEquals("256.0 MB", DataPipelineProjection.formatBytes(268_435_456L, locale))
    }

    @Test
    fun formatDateTimeRendersAbsoluteUtcAndDashesOnFailure() {
        assertEquals("2026-06-11 12:00", DataPipelineProjection.formatDateTime("2026-06-11T12:00:00Z", formatter))
        assertEquals(EM_DASH, DataPipelineProjection.formatDateTime("", formatter))
        assertEquals(EM_DASH, DataPipelineProjection.formatDateTime("not-a-date", formatter))
        assertEquals(EM_DASH, DataPipelineProjection.formatDateTime(null, formatter))
    }

    @Test
    fun statusToneMatchesWebStatusTextClass() {
        assertEquals(ExportStatusTone.Success, DataPipelineProjection.statusTone("ready"))
        assertEquals(ExportStatusTone.Warning, DataPipelineProjection.statusTone("queued"))
        assertEquals(ExportStatusTone.Warning, DataPipelineProjection.statusTone("processing"))
        assertEquals(ExportStatusTone.Danger, DataPipelineProjection.statusTone("failed"))
        assertEquals(ExportStatusTone.Neutral, DataPipelineProjection.statusTone("something-else"))
    }

    @Test
    fun statusGlyphMatchesWebGetStatusIcon() {
        assertEquals(ExportStatusGlyph.Check, DataPipelineProjection.statusGlyph("ready"))
        assertEquals(ExportStatusGlyph.Cross, DataPipelineProjection.statusGlyph("failed"))
        assertEquals(ExportStatusGlyph.Alert, DataPipelineProjection.statusGlyph("queued"))
        assertEquals(ExportStatusGlyph.Alert, DataPipelineProjection.statusGlyph("unknown"))
    }

    @Test
    fun sortJobsSortsByRecordCountOnlyForTheRecordsColumn() {
        val jobs = listOf(job("a", recordCount = 3L), job("b", recordCount = 1L), job("c", recordCount = 2L))

        val asc = DataPipelineProjection.sortJobs(jobs, SortState(EXPORT_COLUMN_RECORDS, SortDirection.Asc))
        assertEquals(listOf("b", "c", "a"), asc.map { it.id })

        val desc = DataPipelineProjection.sortJobs(jobs, SortState(EXPORT_COLUMN_RECORDS, SortDirection.Desc))
        assertEquals(listOf("a", "c", "b"), desc.map { it.id })

        // A non-records (or unset) sort leaves the incoming order intact.
        assertEquals(jobs, DataPipelineProjection.sortJobs(jobs, SortState()))
        assertEquals(jobs, DataPipelineProjection.sortJobs(jobs, SortState("type", SortDirection.Asc)))
    }

    @Test
    fun truncateFileNameDashesBlankAndEllipsizesLong() {
        assertEquals(EM_DASH, DataPipelineProjection.truncateFileName(null))
        assertEquals(EM_DASH, DataPipelineProjection.truncateFileName("  "))
        assertEquals("short.csv", DataPipelineProjection.truncateFileName("short.csv"))
        val long = "a-very-long-export-file-name-that-overflows.csv"
        val truncated = DataPipelineProjection.truncateFileName(long)
        assertEquals(24, truncated.length)
        assertEquals('\u2026', truncated.last())
    }

    @Test
    fun rowsProjectStatusFormatRecordsAndCreated() {
        val rows = DataPipelineProjection.rows(listOf(job("a", status = "ready", recordCount = 12_840L)), locale, formatter)
        val row = rows.single()
        assertEquals("a", row.id)
        assertEquals("ready", row.statusRaw)
        assertEquals(ExportStatusTone.Success, row.statusTone)
        assertEquals(ExportStatusGlyph.Check, row.statusGlyph)
        assertEquals("csv", row.format)
        assertEquals("drives-a.csv", row.fileName)
        assertEquals(12_840L, row.recordCount)
        assertEquals("12,840", row.recordsLabel)
        assertEquals("2026-06-11 12:00", row.createdLabel)
    }

    @Test
    fun isEmptyOnlyWhenNoCompressionAndNoJobs() {
        assertEquals(true, DataPipelineProjection.isEmpty(DataPipelineData(null, emptyList())))
        assertEquals(false, DataPipelineProjection.isEmpty(DataPipelineData(CompressionStats(), emptyList())))
        assertEquals(false, DataPipelineProjection.isEmpty(DataPipelineData(null, listOf(job("a")))))
    }
}
