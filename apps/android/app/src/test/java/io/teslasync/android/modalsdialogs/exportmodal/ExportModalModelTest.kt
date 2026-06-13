// Off-device unit coverage for the ExportModal modal/dialog's pure model (P3 acceptance: adapter + per-branch +
// diagnostics tests). Exercises the full-dashboard JSON copy payload (web `dashboardJson`), the Blob byte-size
// formatter (web `jsonSize`), the URL-safe base64 encoder (web `toUrlSafeBase64`), the minimal share export (web
// `buildMinimalExport`), the share-URL template + 2000-char ceiling (web `shareUrl` / `shareUrlTooLong`), the
// widget count, the tolerant `updatedAt` decode, the mini-grid geometry (web `MiniGridPreview` — including the
// empty-layout fallback), the aggregate `project` adapter, the registry identifiers, and the PII-safe
// `view.opened` diagnostic. No Compose / Android / HTTP — runs in :android:testReleaseUnitTest.
package io.teslasync.android.modalsdialogs.exportmodal

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.util.Base64

class ExportModalModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<Triple<LogLevel, String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Triple(level, event, fields)
        }
    }

    private fun dashboard(
        name: String = "Daily Driver",
        widgets: List<WidgetInstance> =
            listOf(
                WidgetInstance("w-1", "battery-health"),
                WidgetInstance("w-2", "range-estimate"),
            ),
        layout: List<LayoutItem> =
            listOf(
                LayoutItem("w-1", x = 0, y = 0, w = 2, h = 2),
                LayoutItem("w-2", x = 2, y = 2, w = 2, h = 1),
            ),
        updatedAt: String = "2026-06-12T09:30:00Z",
    ): SavedDashboard =
        SavedDashboard(
            id = "dash-1",
            name = name,
            widgets = widgets,
            layouts = mapOf("lg" to layout),
            createdAt = "2026-01-01T00:00:00Z",
            updatedAt = updatedAt,
        )

    // ---- Full-dashboard JSON copy payload (web `JSON.stringify(dashboard, null, 2)`) ----

    @Test
    fun dashboardJson_isPrettyPrintedAndCarriesTheDashboardFields() {
        val json = ExportModalProjection.dashboardJson(dashboard())
        assertTrue("pretty output is multi-line", json.contains("\n"))
        assertTrue("carries the name", json.contains("\"name\": \"Daily Driver\""))
        assertTrue("carries the widget id", json.contains("battery-health"))
    }

    // ---- Byte-size formatter (web `jsonSize`) ------------------------------------

    @Test
    fun jsonSize_usesBytesUnderOneKibAndKibAbove() {
        assertEquals("512 B", ExportModalProjection.jsonSize("a".repeat(512)))
        // Exactly 1 KiB crosses into the KB branch.
        assertEquals("1.0 KB", ExportModalProjection.jsonSize("a".repeat(1024)))
        assertEquals("1.5 KB", ExportModalProjection.jsonSize("a".repeat(1536)))
        assertEquals("2.0 KB", ExportModalProjection.jsonSize("a".repeat(2048)))
    }

    @Test
    fun jsonSize_countsUtf8BytesNotChars() {
        // '⚡' (U+26A1) is 3 UTF-8 bytes; 400 of them = 1200 bytes = 1.2 KB, not "400 B".
        assertEquals("1.2 KB", ExportModalProjection.jsonSize("⚡".repeat(400)))
    }

    // ---- URL-safe base64 (web `toUrlSafeBase64`) --------------------------------

    @Test
    fun toUrlSafeBase64_isUnpaddedUrlSafeAndRoundTrips() {
        val source = "TeslaSync dashboard ⚡ +/= payload"
        val encoded = ExportModalProjection.toUrlSafeBase64(source)
        assertFalse("no padding", encoded.contains("="))
        assertFalse("no '+'", encoded.contains("+"))
        assertFalse("no '/'", encoded.contains("/"))
        val decoded = String(Base64.getUrlDecoder().decode(encoded), Charsets.UTF_8)
        assertEquals(source, decoded)
    }

    @Test
    fun toUrlSafeBase64_emptyStringEncodesToEmpty() {
        assertEquals("", ExportModalProjection.toUrlSafeBase64(""))
    }

    // ---- Minimal share export (web `buildMinimalExport`) ------------------------

    @Test
    fun buildMinimalExport_keepsNameWidgetsLayoutsAndDropsTimestamps() {
        val json = ExportModalProjection.buildMinimalExport(dashboard())
        assertTrue(json.contains("\"name\":\"Daily Driver\""))
        assertTrue(json.contains("\"widgetId\":\"battery-health\""))
        assertTrue(json.contains("\"layouts\""))
        assertFalse("strips createdAt", json.contains("createdAt"))
        assertFalse("strips updatedAt", json.contains("updatedAt"))
        assertFalse("strips id", json.contains("\"id\":\"dash-1\""))
    }

    @Test
    fun buildMinimalExport_omitsAbsentWidgetConfigButKeepsPresentOne() {
        val withConfig =
            dashboard(
                widgets =
                    listOf(
                        WidgetInstance("w-1", "battery-health"),
                        WidgetInstance("w-2", "range-estimate", buildJsonObject { put("chartType", "line") }),
                    ),
            )
        val json = ExportModalProjection.buildMinimalExport(withConfig)
        assertTrue("present config is kept", json.contains("\"chartType\":\"line\""))
        // The first widget has no config; only the second `config` key should appear.
        assertEquals("exactly one config key", 1, Regex("\"config\"").findAll(json).count())
    }

    // ---- Share URL + ceiling (web `shareUrl` / `shareUrlTooLong`) ----------------

    @Test
    fun shareUrl_targetsTheOriginAndDecodesToTheMinimalExport() {
        val dash = dashboard()
        val url = ExportModalProjection.shareUrl("https://app.teslasync.io", dash)
        val prefix = "https://app.teslasync.io/dashboard#import="
        assertTrue("targets the origin deep link", url.startsWith(prefix))
        val encoded = url.removePrefix(prefix)
        val decoded = String(Base64.getUrlDecoder().decode(encoded), Charsets.UTF_8)
        assertEquals(ExportModalProjection.buildMinimalExport(dash), decoded)
    }

    @Test
    fun isShareUrlTooLong_triggersStrictlyAbove2000() {
        assertFalse(ExportModalProjection.isShareUrlTooLong("a".repeat(2000)))
        assertTrue(ExportModalProjection.isShareUrlTooLong("a".repeat(2001)))
    }

    // ---- Mini-grid geometry (web `MiniGridPreview`) ------------------------------

    @Test
    fun miniGrid_normalizesTilesAgainstColumnsAndSafeMaxY() {
        val grid = ExportModalProjection.miniGrid(dashboard())
        // maxY = max(0+2, 2+1) = 3 -> aspect 4/3; two tiles.
        assertEquals(4f / 3f, grid.aspectRatio, 1e-4f)
        assertEquals(2, grid.boxes.size)
        val first = grid.boxes.first()
        assertEquals(0f, first.xFraction, 1e-4f)
        assertEquals(0f, first.yFraction, 1e-4f)
        assertEquals(0.5f, first.wFraction, 1e-4f)
        assertEquals(2f / 3f, first.hFraction, 1e-4f)
    }

    @Test
    fun miniGrid_emptyLayoutHasNoTilesAndTheDefaultAspectRatio() {
        val grid = ExportModalProjection.miniGrid(SavedDashboard(id = "empty", name = "Empty"))
        assertTrue("no tiles for an empty layout", grid.boxes.isEmpty())
        // cols / DEFAULT_GRID_ROWS = 4 / 2 = 2.0.
        assertEquals(2f, grid.aspectRatio, 1e-4f)
    }

    // ---- Tolerant updatedAt decode (web `formatDate` input forms) ----------------

    @Test
    fun parseUpdatedAt_acceptsRfc3339OffsetAndLocalFormsAndRejectsJunk() {
        assertEquals(Instant.parse("2026-06-12T09:30:00Z"), ExportModalProjection.parseUpdatedAt("2026-06-12T09:30:00Z"))
        assertEquals(
            Instant.parse("2026-06-12T07:30:00Z"),
            ExportModalProjection.parseUpdatedAt("2026-06-12T09:30:00+02:00"),
        )
        assertNotNull("local date-time parses as UTC", ExportModalProjection.parseUpdatedAt("2026-06-12T09:30:00"))
        assertNull(ExportModalProjection.parseUpdatedAt(""))
        assertNull(ExportModalProjection.parseUpdatedAt("   "))
        assertNull(ExportModalProjection.parseUpdatedAt("not-a-date"))
    }

    // ---- Aggregate adapter (the bundle of web `useMemo` derivations) -------------

    @Test
    fun project_bundlesEveryRenderInput() {
        val dash = dashboard()
        val projection = ExportModalProjection.project(dash, "https://app.teslasync.io")
        assertEquals(2, projection.widgetCount)
        assertFalse("a small layout is well under the ceiling", projection.shareUrlTooLong)
        assertEquals(projection.shareUrl.length, projection.shareUrlLength)
        assertEquals(Instant.parse("2026-06-12T09:30:00Z"), projection.updatedAt)
        assertEquals("2026-06-12T09:30:00Z", projection.updatedAtRaw)
        assertTrue("json size is populated", projection.jsonSize.isNotBlank())
        assertEquals(2, projection.miniGrid.boxes.size)
    }

    @Test
    fun project_emptyDashboardReportsZeroWidgets() {
        val projection = ExportModalProjection.project(SavedDashboard(id = "e", name = "Empty"), "https://app.teslasync.io")
        assertEquals(0, projection.widgetCount)
        assertTrue(projection.miniGrid.boxes.isEmpty())
    }

    // ---- Registry + diagnostics --------------------------------------------------

    @Test
    fun registrationIdentifiersAreStable() {
        assertEquals("export-modal", ExportModalRegistration.ID)
        assertEquals("ExportModal", ExportModalRegistration.SLUG)
    }

    @Test
    fun recordViewOpened_emitsPiiSafeViewOpened() {
        val logger = RecordingLogger()
        ExportModalDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "ExportModal"), fields)
    }
}
