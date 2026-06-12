package io.teslasync.android.featureviews.settingsexportimport

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.settingsbackup.SettingsBundle
import io.teslasync.shared.core.presentation.settingsbackup.SettingsBundleSections
import io.teslasync.shared.core.presentation.settingsbackup.SettingsImportResult
import io.teslasync.shared.core.presentation.settingsbackup.SettingsImportSectionResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device coverage of the surface's pure logic — the local bundle validation (web `validateSettingsBundle`:
 * valid object, section allowlist, decodable shape, supported schema_version, non-empty exported_at), the
 * per-section diff projection + count formatting (web `SectionDiffList`), the summary fold (web
 * `summariseImportResult`), the export JSON encoding round-trip, and the PII-safe `view.opened` diagnostic.
 * Run by the `:android:testReleaseUnitTest` gate.
 */
class SettingsExportImportLogicTest {
    @Test
    fun parseBundleAcceptsAValidBundle() {
        val result = parseBundle(VALID_JSON)
        assertTrue(result is BundleParse.Valid)
        val bundle = (result as BundleParse.Valid).bundle
        assertEquals(1, bundle.schemaVersion)
        assertEquals("2026-06-12T00:00:00Z", bundle.exportedAt)
    }

    @Test
    fun parseBundleRejectsMalformedJsonSyntax() {
        val result = parseBundle("not json {")
        assertTrue(result is BundleParse.Invalid)
        assertTrue((result as BundleParse.Invalid).error is ImportError.InvalidJson)
    }

    @Test
    fun parseBundleRejectsANonObjectRoot() {
        val result = parseBundle("[1, 2, 3]")
        assertTrue(result is BundleParse.Invalid)
    }

    @Test
    fun parseBundleRejectsAnUnknownSectionWithItsKeyAsDetail() {
        val json = """{"schema_version":1,"exported_at":"t","sections":{"bogus":[]}}"""
        val result = parseBundle(json)
        assertEquals(ImportError.InvalidJson("bogus"), (result as BundleParse.Invalid).error)
    }

    @Test
    fun parseBundleRejectsASchemaVersionNewerThanSupported() {
        val json = """{"schema_version":2,"exported_at":"t","sections":{}}"""
        val result = parseBundle(json)
        assertEquals(ImportError.InvalidJson("2"), (result as BundleParse.Invalid).error)
    }

    @Test
    fun parseBundleRejectsABlankExportedAt() {
        val json = """{"schema_version":1,"exported_at":"","sections":{}}"""
        val result = parseBundle(json)
        assertEquals(ImportError.InvalidJson("exported_at"), (result as BundleParse.Invalid).error)
    }

    @Test
    fun parseBundleRejectsAMissingSchemaVersion() {
        val result = parseBundle("""{"exported_at":"t","sections":{}}""")
        assertTrue(result is BundleParse.Invalid)
        assertTrue((result as BundleParse.Invalid).error is ImportError.InvalidJson)
    }

    @Test
    fun sectionDiffRowsCoverEveryKeyInOrderWithAbsentSectionsNull() {
        val result =
            SettingsImportResult(
                dryRun = true,
                sections =
                    mapOf(
                        SECTION_KEY_SETTINGS to SettingsImportSectionResult(added = 0, updated = 3, skipped = 5),
                        SECTION_KEY_ALERT_RULES to SettingsImportSectionResult(added = 2, updated = 0, skipped = 1),
                    ),
            )
        val rows = sectionDiffRows(result)

        assertEquals(SETTINGS_BUNDLE_SECTION_KEYS, rows.map { it.key })
        assertEquals(3, rows[0].counts?.updated)
        assertEquals(2, rows[1].counts?.added)
        assertNull("geofences was absent from the result", rows[2].counts)
        assertNull("quiet_hours was absent from the result", rows[3].counts)
    }

    @Test
    fun formatSectionCountsMatchesTheWebChip() {
        assertEquals("+2 ~1 =3", formatSectionCounts(SettingsImportSectionResult(added = 2, updated = 1, skipped = 3)))
    }

    @Test
    fun summariseImportTotalsAddedPlusUpdatedExcludingSkipped() {
        val result =
            SettingsImportResult(
                dryRun = true,
                sections =
                    mapOf(
                        SECTION_KEY_SETTINGS to SettingsImportSectionResult(added = 0, updated = 3, skipped = 5),
                        SECTION_KEY_ALERT_RULES to SettingsImportSectionResult(added = 2, updated = 0, skipped = 1),
                    ),
            )
        val summary = summariseImport(result)

        assertEquals(2, summary.added)
        assertEquals(3, summary.updated)
        assertEquals(6, summary.skipped)
        assertEquals(5, summary.total)
    }

    @Test
    fun encodeBundleJsonRoundTripsThroughParse() {
        val bundle = SettingsBundle(schemaVersion = 1, exportedAt = "2026-06-12T00:00:00Z", sections = SettingsBundleSections())
        val json = encodeBundleJson(bundle)

        assertTrue(json.contains("schema_version"))
        assertTrue(json.contains("exported_at"))
        assertTrue(parseBundle(json) is BundleParse.Valid)
    }

    @Test
    fun recordViewOpenedEmitsThePiiSafeSlug() {
        val events = mutableListOf<Pair<String, Map<String, String>>>()
        val logger =
            object : Logger {
                override fun log(
                    level: LogLevel,
                    event: String,
                    fields: Map<String, String>,
                ) {
                    events += event to fields
                }
            }

        recordSettingsExportImportViewOpened(logger)

        assertEquals("view.opened", events.single().first)
        assertEquals(mapOf("surface" to "SettingsExportImport"), events.single().second)
        assertEquals("SettingsExportImport", SettingsExportImportViewRegistration.SLUG)
    }

    private companion object {
        const val VALID_JSON =
            """{"schema_version":1,"exported_at":"2026-06-12T00:00:00Z","sections":{"alert_rules":[{"id":1}]}}"""
    }
}
