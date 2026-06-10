package io.teslasync.shared.core.presentation.settingsbackup

import io.teslasync.shared.core.data.repo.SETTINGS_BACKUP_PREFIX
import io.teslasync.shared.core.data.repo.SettingsBackupRepository
import io.teslasync.shared.core.data.repo.defaultExportFilename
import io.teslasync.shared.core.data.repo.settingsLastExportKey
import io.teslasync.shared.core.data.repo.settingsLastImportKey
import io.teslasync.shared.core.data.repo.summariseImportResult
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Golden vectors locking the non-trivial client-side derivations ported from the web
 * `useSettingsBackup` domain (web/src/api/hooks/useSettingsBackup.ts + its
 * web/src/lib/settingsImportSchema.ts helpers):
 *
 *  1. [defaultExportFilename] — the `teslasync-settings-YYYYMMDD.json` builder (web
 *     `defaultExportFilename`): UTC calendar date, month/day zero-padded to two digits, hour
 *     deliberately omitted. Edge rows cover single-digit month/day padding, a year rollover across
 *     the UTC midnight boundary, and a leap day.
 *  2. [summariseImportResult] — the per-section fold (web `summariseImportResult`): `total` is
 *     `added + updated` (skipped summed separately, NOT in total); an empty/absent section
 *     contributes nothing.
 *  3. The settings-backup cache keys ([settingsLastExportKey]/[settingsLastImportKey]) mirroring
 *     `settingsBackupKeys.lastExport`/`.lastImport`.
 *
 * The vectors are language-neutral (fixed inputs in / fixed expectations out) so the Windows C#
 * port and the KMP core load the identical set and cannot drift (ADR-004). The fixtures are inlined
 * to stay within this slice's allowed file scope; the C# port mirrors these exact rows.
 */
class SettingsBackupGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    // ---- defaultExportFilename ----------------------------------------------------

    @Serializable
    private data class FilenameRow(
        val name: String,
        val epochMillis: Long,
        val expected: String,
    )

    private fun filenameRows(): List<FilenameRow> = json.decodeFromString(FILENAME_GOLDEN)

    @Test
    fun filenameGoldenCoversPaddingRolloverAndLeapDay() {
        val names = filenameRows().map { it.name }.toSet()
        listOf("epoch_zero", "two_digit_padding", "year_rollover_eve", "year_rollover_day", "leap_day")
            .forEach { assertTrue(it in names, "filename golden missing the '$it' case") }
    }

    @Test
    fun everyFilenameRowMatchesDefaultExportFilename() {
        for (row in filenameRows()) {
            assertEquals(row.expected, defaultExportFilename(row.epochMillis), "defaultExportFilename('${row.name}')")
        }
    }

    // ---- summariseImportResult ----------------------------------------------------

    @Serializable
    private data class SummaryRow(
        val name: String,
        val sections: Map<String, SettingsImportSectionResult>,
        val added: Int,
        val updated: Int,
        val skipped: Int,
        val total: Int,
    )

    private fun summaryRows(): List<SummaryRow> = json.decodeFromString(SUMMARY_GOLDEN)

    @Test
    fun summaryGoldenCoversEmptyMultiSectionAndSkippedExcludedFromTotal() {
        val names = summaryRows().map { it.name }.toSet()
        listOf("empty", "single_section", "multi_section", "skipped_excluded_from_total")
            .forEach { assertTrue(it in names, "summary golden missing the '$it' case") }
    }

    @Test
    fun everySummaryRowMatchesSummariseImportResult() {
        for (row in summaryRows()) {
            val summary = summariseImportResult(SettingsImportResult(dryRun = true, sections = row.sections))
            assertEquals(row.added, summary.added, "added('${row.name}')")
            assertEquals(row.updated, summary.updated, "updated('${row.name}')")
            assertEquals(row.skipped, summary.skipped, "skipped('${row.name}')")
            assertEquals(row.total, summary.total, "total('${row.name}')")
        }
    }

    // ---- cache keys ---------------------------------------------------------------

    @Test
    fun cacheKeysMatchTheWebSettingsBackupKeys() {
        assertEquals("settings:backup", SETTINGS_BACKUP_PREFIX)
        assertEquals("settings:backup:last-export", settingsLastExportKey())
        assertEquals("settings:backup:last-import", settingsLastImportKey())
    }

    @Test
    fun parityHelpersAreReferencedFromTheDataPort() {
        // Compile-time anchor: the derivations under test are the ones the S7 port exposes.
        assertTrue(SettingsBackupRepository::class.simpleName == "SettingsBackupRepository")
    }

    private companion object {
        val FILENAME_GOLDEN =
            """
            [
              { "name": "epoch_zero",          "epochMillis": 0,             "expected": "teslasync-settings-19700101.json" },
              { "name": "two_digit_padding",   "epochMillis": 1704844799000, "expected": "teslasync-settings-20240109.json" },
              { "name": "year_rollover_eve",   "epochMillis": 1767225599000, "expected": "teslasync-settings-20251231.json" },
              { "name": "year_rollover_day",   "epochMillis": 1767225600000, "expected": "teslasync-settings-20260101.json" },
              { "name": "leap_day",            "epochMillis": 1709208000000, "expected": "teslasync-settings-20240229.json" },
              { "name": "fixed_now",           "epochMillis": 1780658038000, "expected": "teslasync-settings-20260605.json" }
            ]
            """.trimIndent()

        val SUMMARY_GOLDEN =
            """
            [
              { "name": "empty", "sections": {}, "added": 0, "updated": 0, "skipped": 0, "total": 0 },
              { "name": "single_section",
                "sections": { "settings": { "added": 2, "updated": 1, "skipped": 0 } },
                "added": 2, "updated": 1, "skipped": 0, "total": 3 },
              { "name": "multi_section",
                "sections": { "settings": { "added": 2, "updated": 1, "skipped": 0 },
                              "alert_rules": { "added": 3, "updated": 4, "skipped": 0 },
                              "geofences": { "added": 0, "updated": 0, "skipped": 0 } },
                "added": 5, "updated": 5, "skipped": 0, "total": 10 },
              { "name": "skipped_excluded_from_total",
                "sections": { "settings": { "added": 1, "updated": 2, "skipped": 7 },
                              "quiet_hours": { "added": 0, "updated": 0, "skipped": 3 } },
                "added": 1, "updated": 2, "skipped": 10, "total": 3 }
            ]
            """.trimIndent()
    }
}
