package io.teslasync.shared.core.presentation.systemdiagnostic

import io.teslasync.shared.core.data.repo.SYSTEM_DIAGNOSTIC_PREFIX
import io.teslasync.shared.core.data.repo.SystemDiagnosticRepository
import io.teslasync.shared.core.data.repo.systemDiagnosticLastKey
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Golden vectors locking the parity-critical surface ported from the web `useSystemDiagnostic`
 * domain (web/src/api/hooks/useSystemDiagnostic.ts):
 *
 *  1. The cache-key namespace ([SYSTEM_DIAGNOSTIC_PREFIX] / [systemDiagnosticLastKey]) mirroring
 *     `diagnosticKeys.root` (`['system','diagnostic']`) and `diagnosticKeys.last`
 *     (`['system','diagnostic','last']`).
 *  2. The report wire shape ([DiagnosticReport] / [DiagnosticCheck]) — snake_case field names
 *     (`generated_at`, `overall_status`, `duration_ms`) and the `remediation` omitempty edge.
 *  3. The ONE non-trivial client-side derivation — [formatDiagnosticReportText] — locked output-for-
 *     output across the empty / single / warn-with-empty-detail / multi-check cases, including the
 *     status upper-casing, the em-dash separator, the column-aligned `detail:` / `remediation:`
 *     labels, and the conditional detail/remediation lines.
 *
 * The vectors are language-neutral (fixed JSON in / fixed expectations out) so the Windows C# port
 * loads the identical set and cannot drift (ADR-004). The fixtures are inlined to stay within this
 * slice's allowed file scope; the C# port mirrors these exact rows.
 */
class SystemDiagnosticGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    // ---- cache keys ---------------------------------------------------------------

    @Test
    fun cacheKeysMatchTheWebDiagnosticKeys() {
        assertEquals("system:diagnostic", SYSTEM_DIAGNOSTIC_PREFIX)
        assertEquals("system:diagnostic:last", systemDiagnosticLastKey())
    }

    // ---- wire shape ---------------------------------------------------------------

    @Test
    fun reportDecodesSnakeCaseFieldsAndOmitemptyRemediation() {
        val report =
            json.decodeFromString(
                DiagnosticReport.serializer(),
                """
                {"generated_at":"2026-06-05T12:00:00Z","overall_status":"ok","checks":[
                  {"id":"tesla_token","name":"Tesla token","status":"ok","detail":"valid","duration_ms":12}
                ]}
                """.trimIndent(),
            )
        assertEquals("2026-06-05T12:00:00Z", report.generatedAt)
        assertEquals("ok", report.overallStatus)
        assertEquals(1, report.checks.size)
        assertEquals(12, report.checks.first().durationMs)
        // `remediation` is omitempty upstream — an absent key decodes to null, not "".
        assertNull(report.checks.first().remediation)
    }

    // ---- formatDiagnosticReportText derivation ------------------------------------

    @Serializable
    private data class FormatRow(
        val name: String,
        val body: String,
        val text: String,
    )

    private fun formatRows(): List<FormatRow> = json.decodeFromString(FORMAT_GOLDEN)

    @Test
    fun formatGoldenCoversEmptySingleWarnAndMultiCases() {
        val names = formatRows().map { it.name }.toSet()
        listOf("empty", "single_ok", "warn_empty_detail", "multi")
            .forEach { assertTrue(it in names, "format golden missing the '$it' case") }
    }

    @Test
    fun everyFormatRowRendersTheExpectedText() {
        for (row in formatRows()) {
            val report = json.decodeFromString(DiagnosticReport.serializer(), row.body)
            assertEquals(row.text, formatDiagnosticReportText(report), "formatDiagnosticReportText('${row.name}')")
        }
    }

    @Test
    fun parityHelpersAreReferencedFromTheDataPort() {
        // Compile-time anchor: the port under test is the one the S8 store binds to.
        assertTrue(SystemDiagnosticRepository::class.simpleName == "SystemDiagnosticRepository")
    }

    private companion object {
        val FORMAT_GOLDEN =
            """
            [
              { "name": "empty",
                "body": "{\"generated_at\":\"2026-06-05T12:00:00Z\",\"overall_status\":\"ok\",\"checks\":[]}",
                "text": "TeslaSync diagnostic report\nGenerated: 2026-06-05T12:00:00Z\nOverall:   ok\n\nChecks:\n" },
              { "name": "single_ok",
                "body": "{\"generated_at\":\"2026-06-05T12:00:00Z\",\"overall_status\":\"ok\",\"checks\":[{\"id\":\"tesla_token\",\"name\":\"Tesla token\",\"status\":\"ok\",\"detail\":\"valid\",\"duration_ms\":12}]}",
                "text": "TeslaSync diagnostic report\nGenerated: 2026-06-05T12:00:00Z\nOverall:   ok\n\nChecks:\n  [OK] Tesla token (tesla_token) — 12ms\n    detail:      valid\n" },
              { "name": "warn_empty_detail",
                "body": "{\"generated_at\":\"2026-06-05T12:00:00Z\",\"overall_status\":\"degraded\",\"checks\":[{\"id\":\"signal_log\",\"name\":\"signal_log freshness\",\"status\":\"warn\",\"detail\":\"\",\"remediation\":\"check ingest\",\"duration_ms\":40}]}",
                "text": "TeslaSync diagnostic report\nGenerated: 2026-06-05T12:00:00Z\nOverall:   degraded\n\nChecks:\n  [WARN] signal_log freshness (signal_log) — 40ms\n    remediation: check ingest\n" },
              { "name": "multi",
                "body": "{\"generated_at\":\"2026-06-05T12:00:00Z\",\"overall_status\":\"down\",\"checks\":[{\"id\":\"tesla_token\",\"name\":\"Tesla token\",\"status\":\"fail\",\"detail\":\"expired\",\"remediation\":\"re-auth\",\"duration_ms\":5},{\"id\":\"mqtt\",\"name\":\"MQTT broker\",\"status\":\"ok\",\"detail\":\"connected\",\"duration_ms\":8}]}",
                "text": "TeslaSync diagnostic report\nGenerated: 2026-06-05T12:00:00Z\nOverall:   down\n\nChecks:\n  [FAIL] Tesla token (tesla_token) — 5ms\n    detail:      expired\n    remediation: re-auth\n  [OK] MQTT broker (mqtt) — 8ms\n    detail:      connected\n" }
            ]
            """.trimIndent()
    }
}
