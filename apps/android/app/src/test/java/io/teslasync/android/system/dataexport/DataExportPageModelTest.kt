// Fast JVM unit tests for the framework-free DataExportPage model (DataExportPageModel.kt) — the stat-row
// reductions, the data-overview rollup, the active-job count, the column-selector allowlist arithmetic, and the
// two submit payload builders. These run in the `:android:testDebugUnitTest` gate with no Android/Compose on the
// classpath, matching the model's off-device contract.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.dataexport

import io.teslasync.shared.core.presentation.exports.ExportColumnInfo
import io.teslasync.shared.core.presentation.exports.ExportColumnsResponse
import io.teslasync.shared.core.presentation.exports.ExportJobSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DataExportPageModelTest {
    private fun job(
        id: String,
        type: String = "drives",
        status: String = "ready",
        fileSize: Long? = null,
        recordCount: Long? = null,
        durationMs: Long? = null,
        createdAt: String = "2025-01-01T00:00:00Z",
    ): ExportJobSummary =
        ExportJobSummary(
            id = id,
            type = type,
            format = "csv",
            status = status,
            fileSize = fileSize,
            recordCount = recordCount,
            durationMs = durationMs,
            createdAt = createdAt,
        )

    @Test
    fun `exportStats sums size and picks the most recent job`() {
        val jobs =
            listOf(
                job("1", type = "drives", fileSize = 100, createdAt = "2025-01-01T00:00:00Z"),
                job("2", type = "drives", fileSize = 250, createdAt = "2025-03-10T08:00:00Z"),
                job("3", type = "charging", fileSize = 50, createdAt = "2025-02-01T00:00:00Z"),
            )
        val stats = exportStats(jobs)
        assertEquals(3, stats.totalExports)
        assertEquals(400L, stats.totalSizeBytes)
        assertEquals("drives", stats.mostExportedType)
        assertEquals("2025-03-10T08:00:00Z", stats.mostRecentCreatedAt)
    }

    @Test
    fun `mostExportedType renders underscores as spaces and em-dashes when empty`() {
        assertEquals(EM_DASH, mostExportedType(emptyList()))
        assertEquals("full backup", mostExportedType(listOf(job("1", type = "full_backup"))))
    }

    @Test
    fun `dataOverview sums record counts per type`() {
        val jobs =
            listOf(
                job("1", type = "drives", recordCount = 10),
                job("2", type = "drives", recordCount = 5),
                job("3", type = "charging", recordCount = 7),
                job("4", type = "analytics", recordCount = 99),
            )
        val overview = dataOverview(jobs)
        assertEquals(15L, overview.drives)
        assertEquals(7L, overview.chargingSessions)
    }

    @Test
    fun `activeJobCount counts queued and processing`() {
        val jobs =
            listOf(
                job("1", status = "queued"),
                job("2", status = "processing"),
                job("3", status = "ready"),
                job("4", status = "failed"),
            )
        assertEquals(2, activeJobCount(jobs))
    }

    @Test
    fun `catalog gating only enables drives and charging`() {
        assertEquals("drives", catalogTypeFor(ExportType.Drives))
        assertEquals("charging", catalogTypeFor(ExportType.Charging))
        assertEquals("", catalogTypeFor(ExportType.Analytics))
        val catalog = ExportColumnsResponse(type = "drives", columns = listOf(ExportColumnInfo("a")), supportsSelection = true)
        assertTrue(supportsColumnPicker("drives", catalog))
        assertFalse(supportsColumnPicker("", catalog))
        assertFalse(supportsColumnPicker("drives", catalog.copy(supportsSelection = false)))
    }

    @Test
    fun `column toggle preserves order and collapses to null when all reselected`() {
        val all = listOf("a", "b", "c")
        val required = setOf("a")
        // Drop "b": explicit ordered allowlist without b.
        val afterDrop = toggleColumn(selected = null, all = all, required = required, name = "b")
        assertEquals(listOf("a", "c"), afterDrop)
        // Re-add "b": back to "all", collapses to null.
        val afterReadd = toggleColumn(selected = afterDrop, all = all, required = required, name = "b")
        assertNull(afterReadd)
        // Required column cannot be dropped.
        assertEquals(afterDrop, toggleColumn(selected = afterDrop, all = all, required = required, name = "a"))
    }

    @Test
    fun `clear keeps required columns and isAllColumnsSelected detects default`() {
        val all = listOf("a", "b", "c")
        val required = setOf("a")
        assertEquals(listOf("a"), clearedColumns(all, required))
        assertTrue(isAllColumnsSelected(selected = null, all = all))
        assertFalse(isAllColumnsSelected(selected = listOf("a"), all = all))
    }

    @Test
    fun `buildExportPayload uses preset range and omits untouched columns`() {
        val now = 1_700_000_000_000L // 2023-11-14T22:13:20Z
        val payload =
            buildExportPayload(
                type = ExportType.Charging,
                format = ExportFormat.Json,
                vehicleId = "42",
                useCustomRange = false,
                customStart = "",
                customEnd = "",
                presetDays = 7,
                selectedColumns = null,
                nowMillis = now,
            )
        assertEquals("charging", payload.type)
        assertEquals("json", payload.format)
        assertEquals(42L, payload.vehicleId)
        assertEquals("2023-11-07", payload.start)
        assertEquals("2023-11-14", payload.end)
        assertNull(payload.columns)
    }

    @Test
    fun `buildExportPayload honours custom range and explicit columns`() {
        val payload =
            buildExportPayload(
                type = ExportType.Drives,
                format = ExportFormat.Csv,
                vehicleId = "",
                useCustomRange = true,
                customStart = "2025-01-01",
                customEnd = "2025-01-31",
                presetDays = 30,
                selectedColumns = listOf("a", "c"),
                nowMillis = 0L,
            )
        assertNull(payload.vehicleId)
        assertEquals("2025-01-01", payload.start)
        assertEquals("2025-01-31", payload.end)
        assertEquals(listOf("a", "c"), payload.columns)
    }

    @Test
    fun `buildAccountPayload maps all to null and promotes dates to ISO instants`() {
        val all = buildAccountPayload(ACCOUNT_ALL_VEHICLES, "", "")
        assertNull(all.vehicleId)
        assertNull(all.start)

        val specific = buildAccountPayload("7", "2025-01-01", "")
        assertEquals(7L, specific.vehicleId)
        assertEquals("2025-01-01T00:00:00Z", specific.start)
        assertNull(specific.end)
    }
}
