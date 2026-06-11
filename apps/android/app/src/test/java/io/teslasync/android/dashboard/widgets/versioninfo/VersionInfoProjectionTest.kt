package io.teslasync.android.dashboard.widgets.versioninfo

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the VersionInfoWidget's pure logic — the snake-case JSON decode of both feeds
 * (the web's untyped `version.data` / `capture.data` reads), the five-row definition list (incl. the bold
 * version, the monospace 7-char SHA, and the em-dash null handling), the size-driven stat grid (two tiles
 * standard / four wide), the wide-only OS/Arch line, the binary `formatBytes` ladder, the compact
 * version/SHA, the folded TalkBack description, and the registry metadata. Mirrors the web spec
 * (web/src/features/dashboard/widgets/VersionInfoWidget.tsx).
 */
class VersionInfoProjectionTest {
    private val strings =
        VersionInfoStrings(
            title = "Version Info",
            version = "Version",
            buildDate = "Build Date",
            gitSha = "Git SHA",
            goVersion = "Go Version",
            uptime = "Uptime",
            signalsPerSec = "Signals/sec",
            messagesToday = "Messages Today",
            bytesProcessed = "Bytes Processed",
            avgLatency = "Avg Latency",
            os = "OS",
            arch = "Arch",
            noData = "No version data available",
        )

    private val standard = VersionInfoSize(cols = 2, rows = 2)
    private val wide = VersionInfoSize(cols = 4, rows = 4)
    private val compact = VersionInfoSize(cols = 1, rows = 2)

    private fun fullVersionJson() =
        buildJsonObject {
            put("chart_version", "1.4.2")
            put("build_date", "2026-01-15")
            put("git_commit", "abcdef1234567")
            put("go_version", "go1.25")
            put("uptime", "3h12m")
            put("os", "linux")
            put("arch", "amd64")
        }

    private fun fullCaptureJson() =
        buildJsonObject {
            put("signals_per_sec", 12.34)
            put("messages_today", 1234)
            put("bytes_processed", 1536)
            put("avg_processing_latency_ms", 5.67)
        }

    @Test
    fun parseVersionReadsSnakeCaseFieldsAndTruncatesSha() {
        val fields = VersionInfoProjection.parseVersion(fullVersionJson())!!
        assertEquals("1.4.2", fields.chartVersion)
        assertEquals("2026-01-15", fields.buildDate)
        assertEquals("abcdef1", fields.gitSha) // web `gitSha?.slice(0, 7)`
        assertEquals("go1.25", fields.goVersion)
        assertEquals("3h12m", fields.uptime)
        assertEquals("linux", fields.os)
        assertEquals("amd64", fields.arch)
    }

    @Test
    fun parseVersionIsNullWhenNotAnObject() {
        assertNull(VersionInfoProjection.parseVersion(null))
        assertNull(VersionInfoProjection.parseVersion(JsonNull))
        assertNull(VersionInfoProjection.parseVersion(JsonPrimitive("x")))
    }

    @Test
    fun parseVersionKeepsPresentEmptyObjectWithNullFields() {
        val fields = VersionInfoProjection.parseVersion(buildJsonObject {})!!
        assertNull(fields.chartVersion)
        assertNull(fields.buildDate)
        assertNull(fields.gitSha)
        assertNull(fields.goVersion)
        assertNull(fields.uptime)
        assertNull(fields.os)
        assertNull(fields.arch)
    }

    @Test
    fun parseCaptureReadsSnakeCaseFigures() {
        val capture = VersionInfoProjection.parseCapture(fullCaptureJson())
        assertEquals(12.34, capture.signalsPerSec, 0.0001)
        assertEquals(1234L, capture.messagesToday)
        assertEquals(1536L, capture.bytesProcessed)
        assertEquals(5.67, capture.avgLatencyMs, 0.0001)
    }

    @Test
    fun parseCaptureZeroesAbsentFiguresAndNonObjects() {
        assertEquals(CaptureFields.ZERO, VersionInfoProjection.parseCapture(null))
        assertEquals(CaptureFields.ZERO, VersionInfoProjection.parseCapture(JsonNull))
        assertEquals(CaptureFields.ZERO, VersionInfoProjection.parseCapture(buildJsonObject {}))
    }

    @Test
    fun projectBuildsFiveDefinitionRowsInWebOrderWithEmphasis() {
        val version = VersionInfoProjection.parseVersion(fullVersionJson())!!
        val display = VersionInfoProjection.project(version, CaptureFields.ZERO, strings, standard, Locale.US)
        assertEquals(5, display.kvItems.size)
        assertEquals(VersionKvRow("Version", "1.4.2", ValueEmphasis.Bold), display.kvItems[0])
        assertEquals(VersionKvRow("Build Date", "2026-01-15", ValueEmphasis.Normal), display.kvItems[1])
        assertEquals(VersionKvRow("Git SHA", "abcdef1", ValueEmphasis.Mono), display.kvItems[2])
        assertEquals(VersionKvRow("Go Version", "go1.25", ValueEmphasis.Normal), display.kvItems[3])
        assertEquals(VersionKvRow("Uptime", "3h12m", ValueEmphasis.Normal), display.kvItems[4])
    }

    @Test
    fun projectEmDashesEachAbsentFieldButKeepsRows() {
        val version = VersionInfoProjection.parseVersion(buildJsonObject {})!!
        val display = VersionInfoProjection.project(version, CaptureFields.ZERO, strings, standard, Locale.US)
        assertEquals(5, display.kvItems.size)
        display.kvItems.forEach { assertEquals("\u2014", it.value) }
        assertEquals("\u2014", display.compactVersion)
        assertEquals("\u2014", display.compactSha)
    }

    @Test
    fun projectStandardShowsTwoStatTilesAndNoOsArchLine() {
        val version = VersionInfoProjection.parseVersion(fullVersionJson())!!
        val capture = VersionInfoProjection.parseCapture(fullCaptureJson())
        val display = VersionInfoProjection.project(version, capture, strings, standard, Locale.US)
        assertEquals(2, display.statItems.size)
        assertEquals(VersionStat("Signals/sec", "12.3"), display.statItems[0])
        assertEquals(VersionStat("Messages Today", "1,234"), display.statItems[1])
        assertNull(display.osText)
        assertNull(display.archText)
    }

    @Test
    fun projectWideAddsBytesLatencyTilesAndOsArchLine() {
        val version = VersionInfoProjection.parseVersion(fullVersionJson())!!
        val capture = VersionInfoProjection.parseCapture(fullCaptureJson())
        val display = VersionInfoProjection.project(version, capture, strings, wide, Locale.US)
        assertEquals(4, display.statItems.size)
        assertEquals(VersionStat("Bytes Processed", "1.5 KB"), display.statItems[2])
        assertEquals(VersionStat("Avg Latency", "5.7 ms"), display.statItems[3])
        assertEquals("OS: linux", display.osText)
        assertEquals("Arch: amd64", display.archText)
    }

    @Test
    fun projectCompactSurfacesVersionAndTruncatedSha() {
        val version = VersionInfoProjection.parseVersion(fullVersionJson())!!
        val display = VersionInfoProjection.project(version, CaptureFields.ZERO, strings, compact, Locale.US)
        assertEquals("1.4.2", display.compactVersion)
        assertEquals("abcdef1", display.compactSha)
    }

    @Test
    fun projectFoldsContentDescriptionForTalkBack() {
        val version = VersionInfoProjection.parseVersion(fullVersionJson())!!
        val capture = VersionInfoProjection.parseCapture(fullCaptureJson())
        val description = VersionInfoProjection.project(version, capture, strings, wide, Locale.US).contentDescription
        assertTrue(description.contains("Version 1.4.2"))
        assertTrue(description.contains("Git SHA abcdef1"))
        assertTrue(description.contains("Signals/sec 12.3"))
        assertTrue(description.contains("Bytes Processed 1.5 KB"))
        assertTrue(description.contains("OS: linux"))
        assertTrue(description.contains("Arch: amd64"))
    }

    @Test
    fun formatBytesScalesAcrossBinaryUnits() {
        assertEquals("0 B", VersionInfoProjection.formatBytes(0L, Locale.US))
        assertEquals("512 B", VersionInfoProjection.formatBytes(512L, Locale.US))
        assertEquals("1.0 KB", VersionInfoProjection.formatBytes(1024L, Locale.US))
        assertEquals("1.5 KB", VersionInfoProjection.formatBytes(1536L, Locale.US))
        assertEquals("5.0 MB", VersionInfoProjection.formatBytes(5L * 1024 * 1024, Locale.US))
        assertEquals("2.00 GB", VersionInfoProjection.formatBytes(2L * 1024 * 1024 * 1024, Locale.US))
    }

    @Test
    fun registrationMirrorsWebRegistry() {
        assertEquals("version-info", VersionInfoRegistration.ID)
        assertEquals("system", VersionInfoRegistration.CATEGORY)
        assertEquals("VersionInfoWidget", VersionInfoRegistration.SLUG)
        assertEquals(VersionInfoSize(cols = 2, rows = 2), VersionInfoRegistration.defaultSize)
        assertEquals(VersionInfoSize(cols = 1, rows = 2), VersionInfoRegistration.minSize)
        assertEquals(VersionInfoSize(cols = 4, rows = 40), VersionInfoRegistration.maxSize)
    }

    @Test
    fun registrationClampsAndChecksBounds() {
        assertEquals(VersionInfoSize(cols = 4, rows = 40), VersionInfoRegistration.clamp(VersionInfoSize(9, 99)))
        assertEquals(VersionInfoSize(cols = 1, rows = 2), VersionInfoRegistration.clamp(VersionInfoSize(0, 0)))
        assertTrue(VersionInfoRegistration.isWithinBounds(VersionInfoSize(2, 2)))
        assertFalse(VersionInfoRegistration.isWithinBounds(VersionInfoSize(5, 2)))
    }

    @Test
    fun sizeBranchesFollowColumnCount() {
        assertTrue(VersionInfoSize(cols = 1, rows = 2).isCompact)
        assertFalse(VersionInfoSize(cols = 2, rows = 2).isCompact)
        assertFalse(VersionInfoSize(cols = 3, rows = 2).isWide)
        assertTrue(VersionInfoSize(cols = 4, rows = 2).isWide)
    }
}
