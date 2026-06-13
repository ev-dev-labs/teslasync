// Off-device unit coverage for the ImportPreviewModal surface's pure model (P3 acceptance: adapter + per-branch +
// diagnostics tests). Exercises the JSON validation pipeline (web `validateImportData` — the parse guard, the
// required-field checks, the widget-registry split, the layout sanitisation + clamps, the name clamp, and the
// duplicate-id guard), the share-link decoder (web `handleUrlImport` / `fromUrlSafeBase64` — fragment/query
// extraction, precedence, and the invalid-URL / no-param branches), the validated-dashboard → thumbnail projection,
// and the PII-safe `view.opened` diagnostic. No Compose / Android / HTTP — runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.importpreviewmodal

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

class ImportPreviewModalModelTest {
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

    private class FixedClock(
        private val millis: Long,
        private val iso: String,
    ) : ImportClock {
        override fun epochMillis(): Long = millis

        override fun nowIso(): String = iso
    }

    private val clock = FixedClock(millis = 1_700_000_000_000L, iso = "2026-01-15T00:00:00Z")
    private val registry = setOf("battery-gauge", "charge-status", "drive-map")

    private fun validate(raw: String): ImportValidation = ImportValidator.validateImportData(raw, registry, clock)

    // ---- Parse guard (web `JSON.parse` + object check) ---------------------------

    @Test
    fun invalidJson_isReported() {
        val result = validate("{ not json")
        assertFalse(result.isValid)
        assertEquals(listOf(ImportPreviewMessages.INVALID_JSON), result.errors)
        assertNull(result.dashboard)
    }

    @Test
    fun nonObjectPayloads_areRejected() {
        assertEquals(listOf(ImportPreviewMessages.EXPECTED_OBJECT), validate("[1, 2, 3]").errors)
        assertEquals(listOf(ImportPreviewMessages.EXPECTED_OBJECT), validate("null").errors)
        assertEquals(listOf(ImportPreviewMessages.EXPECTED_OBJECT), validate("42").errors)
    }

    // ---- Required fields (web `name` / `widgets` / `layouts`) ---------------------

    @Test
    fun missingName_isReported() {
        val result = validate("""{ "widgets": [], "layouts": {} }""")
        assertTrue(ImportPreviewMessages.MISSING_NAME in result.errors)
    }

    @Test
    fun emptyOrNonStringName_isReported() {
        assertTrue(ImportPreviewMessages.MISSING_NAME in validate("""{ "name": "", "widgets": [], "layouts": {} }""").errors)
        assertTrue(ImportPreviewMessages.MISSING_NAME in validate("""{ "name": 7, "widgets": [], "layouts": {} }""").errors)
    }

    @Test
    fun missingWidgetsArray_isReported() {
        val result = validate("""{ "name": "X", "widgets": {}, "layouts": {} }""")
        assertTrue(ImportPreviewMessages.MISSING_WIDGETS in result.errors)
    }

    @Test
    fun missingLayoutsObject_isReported() {
        val result = validate("""{ "name": "X", "widgets": [], "layouts": 5 }""")
        assertTrue(ImportPreviewMessages.MISSING_LAYOUTS in result.errors)
    }

    @Test
    fun requiredFieldFailure_returnsAllErrorsAndNoDashboard() {
        val result = validate("""{ "foo": 1 }""")
        assertFalse(result.isValid)
        assertNull(result.dashboard)
        assertTrue(ImportPreviewMessages.MISSING_NAME in result.errors)
        assertTrue(ImportPreviewMessages.MISSING_WIDGETS in result.errors)
        assertTrue(ImportPreviewMessages.MISSING_LAYOUTS in result.errors)
    }

    // ---- Widget-registry split (web availability check) ---------------------------

    @Test
    fun noCompatibleWidgets_isInvalidWithNoDashboard() {
        val raw =
            """
            { "name": "X", "widgets": [{ "id": "a", "widgetId": "unknown-1" }], "layouts": {} }
            """.trimIndent()
        val result = validate(raw)
        assertFalse(result.isValid)
        assertEquals(listOf(ImportPreviewMessages.NO_COMPATIBLE), result.errors)
        assertNull(result.dashboard)
        assertEquals(listOf("unknown-1"), result.missingWidgets)
        assertTrue(result.availableWidgets.isEmpty())
    }

    @Test
    fun mixedWidgets_splitIntoAvailableAndMissingWithWarning() {
        val raw =
            """
            {
              "name": "Mixed",
              "widgets": [
                { "id": "a", "widgetId": "battery-gauge" },
                { "id": "b", "widgetId": "charge-status" },
                { "id": "c", "widgetId": "legacy-thing" }
              ],
              "layouts": {}
            }
            """.trimIndent()
        val result = validate(raw)
        assertTrue(result.isValid)
        assertEquals(listOf("battery-gauge", "charge-status"), result.availableWidgets)
        assertEquals(listOf("legacy-thing"), result.missingWidgets)
        assertEquals(listOf(ImportPreviewMessages.skipped(1)), result.warnings)
    }

    @Test
    fun allKnownWidgets_haveNoWarnings() {
        val raw =
            """
            { "name": "Clean", "widgets": [{ "id": "a", "widgetId": "drive-map" }], "layouts": {} }
            """.trimIndent()
        val result = validate(raw)
        assertTrue(result.isValid)
        assertTrue(result.warnings.isEmpty())
        assertEquals(listOf("drive-map"), result.availableWidgets)
    }

    // ---- Dashboard assembly (name clamp, ids, timestamps, config) ------------------

    @Test
    fun dashboard_stampsIdAndTimestampsFromClock() {
        val raw = """{ "name": "Trip", "widgets": [{ "id": "a", "widgetId": "battery-gauge" }], "layouts": {} }"""
        val dashboard = validate(raw).dashboard!!
        assertEquals("import-1700000000000", dashboard.id)
        assertEquals("2026-01-15T00:00:00Z", dashboard.createdAt)
        assertEquals("2026-01-15T00:00:00Z", dashboard.updatedAt)
        assertFalse(dashboard.isDefault)
    }

    @Test
    fun dashboardName_isClampedTo100Chars() {
        val longName = "n".repeat(250)
        val raw = """{ "name": "$longName", "widgets": [{ "id": "a", "widgetId": "drive-map" }], "layouts": {} }"""
        assertEquals(100, validate(raw).dashboard!!.name.length)
    }

    @Test
    fun widgetConfig_isPassedThrough() {
        val raw =
            """
            {
              "name": "Cfg",
              "widgets": [{ "id": "a", "widgetId": "battery-gauge", "config": { "unit": "km" } }],
              "layouts": {}
            }
            """.trimIndent()
        val dashboard = validate(raw).dashboard
        val widget = dashboard?.widgets?.single()
        val unit = widget?.config?.get("unit")?.toString()
        assertEquals("\"km\"", unit)
    }

    @Test
    fun widgetWithoutId_isStillImported() {
        val raw = """{ "name": "X", "widgets": [{ "widgetId": "battery-gauge" }], "layouts": {} }"""
        val result = validate(raw)
        assertEquals(listOf("battery-gauge"), result.availableWidgets)
        val widget = result.dashboard?.widgets?.single()
        assertTrue(widget != null && widget.id.isNotBlank())
    }

    @Test
    fun duplicateIds_areDisambiguated() {
        val raw =
            """
            {
              "name": "Dup",
              "widgets": [
                { "id": "x", "widgetId": "battery-gauge" },
                { "id": "x", "widgetId": "charge-status" }
              ],
              "layouts": {}
            }
            """.trimIndent()
        val ids = validate(raw).dashboard!!.widgets.map { it.id }
        assertEquals(2, ids.size)
        assertEquals(ids.size, ids.toSet().size)
    }

    // ---- Layout sanitisation (web `sanitizeLayoutItem`) ---------------------------

    @Test
    fun layoutCoordinates_areClampedToGridBounds() {
        val raw =
            """
            {
              "name": "Layout",
              "widgets": [{ "id": "a", "widgetId": "battery-gauge" }],
              "layouts": { "lg": [{ "i": "a", "x": 99, "y": 3, "w": 99, "h": 99 }] }
            }
            """.trimIndent()
        val dashboard = validate(raw).dashboard
        val item = dashboard?.layouts?.get("lg")?.single()
        assertEquals(3, item?.x) // clamped to cols(4) - 1
        assertEquals(3, item?.y) // y is preserved when finite/non-negative
        assertEquals(4, item?.w) // clamped to cols(4)
        assertEquals(8, item?.h) // clamped to MAX_ROW_SPAN
    }

    @Test
    fun negativeCoordinates_fallBackToDefaults() {
        val raw =
            """
            {
              "name": "Neg",
              "widgets": [{ "id": "a", "widgetId": "battery-gauge" }],
              "layouts": { "lg": [{ "i": "a", "x": -5, "y": -5, "w": -5, "h": -5 }] }
            }
            """.trimIndent()
        val dashboard = validate(raw).dashboard
        val item = dashboard?.layouts?.get("lg")?.single()
        assertEquals(0, item?.x)
        assertEquals(0, item?.y)
        assertEquals(1, item?.w)
        assertEquals(1, item?.h)
    }

    @Test
    fun layoutItemsForUnavailableWidgets_areDropped() {
        val raw =
            """
            {
              "name": "Drop",
              "widgets": [{ "id": "a", "widgetId": "battery-gauge" }],
              "layouts": { "lg": [{ "i": "a", "x": 0, "y": 0, "w": 1, "h": 1 }, { "i": "ghost", "x": 1, "y": 0, "w": 1, "h": 1 }] }
            }
            """.trimIndent()
        val items = validate(raw).dashboard!!.layouts.getValue("lg")
        assertEquals(1, items.size)
        assertEquals("a", items.single().i)
    }

    @Test
    fun nonArrayBreakpoint_isSkipped() {
        val raw =
            """
            {
              "name": "Skip",
              "widgets": [{ "id": "a", "widgetId": "battery-gauge" }],
              "layouts": { "lg": "nope" }
            }
            """.trimIndent()
        assertNull(validate(raw).dashboard!!.layouts["lg"])
    }

    // ---- Projection to the shared MiniGridPreview input ---------------------------

    @Test
    fun toMiniGridDashboard_mapsWidgetsAndLgLayoutOnly() {
        val dashboard =
            SavedDashboardImport(
                id = "import-1",
                name = "P",
                widgets = listOf(ImportWidgetInstance(id = "a", widgetId = "battery-gauge")),
                layouts =
                    mapOf(
                        "lg" to listOf(RglLayoutItem(i = "a", x = 1, y = 2, w = 3, h = 1)),
                        "sm" to listOf(RglLayoutItem(i = "a", x = 0, y = 0, w = 1, h = 1)),
                    ),
                createdAt = "t",
                updatedAt = "t",
            )
        val mini = dashboard.toMiniGridDashboard()
        assertEquals(1, mini.widgets.size)
        assertEquals("battery-gauge", mini.widgets.single().widgetId)
        assertEquals(1, mini.lgLayout.size)
        assertEquals(3, mini.lgLayout.single().w)
    }

    // ---- Share-link decode (web `fromUrlSafeBase64` / `handleUrlImport`) ----------

    @Test
    fun fromUrlSafeBase64_roundTripsUtf8() {
        val json = """{"name":"Über-Dash","widgets":[]}"""
        val encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(json.toByteArray(Charsets.UTF_8))
        assertEquals(json, ImportUrlCodec.fromUrlSafeBase64(encoded))
    }

    @Test
    fun parseImportUrl_decodesFragmentPayload() {
        val json = """{"name":"Frag"}"""
        val encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(json.toByteArray())
        val result = ImportUrlCodec.parseImportUrl("https://teslasync.example.com/d#import=$encoded")
        assertEquals(ImportUrlResult.Decoded(json), result)
    }

    @Test
    fun parseImportUrl_decodesQueryPayload() {
        val json = """{"name":"Query"}"""
        val encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(json.toByteArray())
        val result = ImportUrlCodec.parseImportUrl("https://teslasync.example.com/d?import=$encoded")
        assertEquals(ImportUrlResult.Decoded(json), result)
    }

    @Test
    fun parseImportUrl_prefersFragmentOverQuery() {
        val frag = Base64.getUrlEncoder().withoutPadding().encodeToString("""{"name":"F"}""".toByteArray())
        val query = Base64.getUrlEncoder().withoutPadding().encodeToString("""{"name":"Q"}""".toByteArray())
        val result = ImportUrlCodec.parseImportUrl("https://x.io/d?import=$query#import=$frag")
        assertEquals(ImportUrlResult.Decoded("""{"name":"F"}"""), result)
    }

    @Test
    fun parseImportUrl_withoutParam_isNoParam() {
        assertEquals(ImportUrlResult.NoParam, ImportUrlCodec.parseImportUrl("https://teslasync.example.com/dashboard"))
    }

    @Test
    fun parseImportUrl_relativeOrGarbage_isInvalid() {
        assertEquals(ImportUrlResult.InvalidUrl, ImportUrlCodec.parseImportUrl("not a url"))
        assertEquals(ImportUrlResult.InvalidUrl, ImportUrlCodec.parseImportUrl("/relative?import=abc"))
    }

    // ---- Diagnostics (P1/S11) -----------------------------------------------------

    @Test
    fun recordViewOpened_emitsPiiSafeSlugAtInfo() {
        val logger = RecordingLogger()
        ImportPreviewModalDiagnostics.recordViewOpened(logger)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "ImportPreviewModal"), fields)
        assertEquals("ImportPreviewModal", ImportPreviewModalRegistration.SLUG)
    }
}
