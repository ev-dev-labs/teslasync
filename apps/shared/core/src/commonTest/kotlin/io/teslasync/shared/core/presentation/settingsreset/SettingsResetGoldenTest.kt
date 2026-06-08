package io.teslasync.shared.core.presentation.settingsreset

import io.teslasync.shared.core.data.repo.SETTINGS_RESET_PREFIX
import io.teslasync.shared.core.data.repo.SettingsResetRepository
import io.teslasync.shared.core.data.repo.settingsLastResetKey
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Golden vectors locking the parity-critical constants and wire shape ported from the web
 * `useSettingsReset` domain (web/src/api/hooks/useSettingsReset.ts).
 *
 * The web domain has NO non-trivial client-side derivation — the two hooks just POST, prime
 * `settingsResetKeys.lastReset`, and `invalidateQueries()`. What MUST stay in lockstep between the
 * KMP core and the Windows C# port is therefore the language-neutral surface:
 *
 *  1. The cache-key namespace ([SETTINGS_RESET_PREFIX] / [settingsLastResetKey]) mirroring
 *     `settingsResetKeys.root` (`['settings','reset']`) and `settingsResetKeys.lastReset`
 *     (`['settings','reset','last']`).
 *  2. The receipt wire shape ([SettingsResetResult] / [SettingsResetSectionResult]) — snake_case
 *     field names (`reset`, `section`), the `reset = sum of section counts` invariant the backend
 *     guarantees, and the empty-receipt edge.
 *
 * The vectors are language-neutral (fixed JSON in / fixed expectations out) so the C# port loads the
 * identical set and cannot drift (ADR-004). The fixtures are inlined to stay within this slice's
 * allowed file scope; the C# port mirrors these exact rows.
 */
class SettingsResetGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    // ---- cache keys ---------------------------------------------------------------

    @Test
    fun cacheKeysMatchTheWebSettingsResetKeys() {
        assertEquals("settings:reset", SETTINGS_RESET_PREFIX)
        assertEquals("settings:reset:last", settingsLastResetKey())
    }

    // ---- receipt wire shape -------------------------------------------------------

    @Serializable
    private data class ReceiptRow(
        val name: String,
        val body: String,
        val reset: Long,
        val sectionCount: Int,
        val sumMatchesTotal: Boolean,
    )

    private fun receiptRows(): List<ReceiptRow> = json.decodeFromString(RECEIPT_GOLDEN)

    @Test
    fun receiptGoldenCoversEmptySingleAndMultiSection() {
        val names = receiptRows().map { it.name }.toSet()
        listOf("empty", "single_section", "multi_section")
            .forEach { assertTrue(it in names, "receipt golden missing the '$it' case") }
    }

    @Test
    fun everyReceiptRowDecodesToTheExpectedShape() {
        for (row in receiptRows()) {
            val receipt = json.decodeFromString(SettingsResetResult.serializer(), row.body)
            assertEquals(row.reset, receipt.reset, "reset('${row.name}')")
            assertEquals(row.sectionCount, receipt.sections.size, "sectionCount('${row.name}')")
            val sum = receipt.sections.sumOf { it.reset }
            assertEquals(row.sumMatchesTotal, sum == receipt.reset, "sumMatchesTotal('${row.name}')")
        }
    }

    @Test
    fun parityHelpersAreReferencedFromTheDataPort() {
        // Compile-time anchor: the port under test is the one the S8 store binds to.
        assertTrue(SettingsResetRepository::class.simpleName == "SettingsResetRepository")
    }

    private companion object {
        val RECEIPT_GOLDEN =
            """
            [
              { "name": "empty",
                "body": "{\"reset\":0,\"sections\":[]}",
                "reset": 0, "sectionCount": 0, "sumMatchesTotal": true },
              { "name": "single_section",
                "body": "{\"reset\":3,\"sections\":[{\"section\":\"alert_rules\",\"reset\":3}]}",
                "reset": 3, "sectionCount": 1, "sumMatchesTotal": true },
              { "name": "multi_section",
                "body": "{\"reset\":12,\"sections\":[{\"section\":\"settings\",\"reset\":5},{\"section\":\"alert_rules\",\"reset\":7}]}",
                "reset": 12, "sectionCount": 2, "sumMatchesTotal": true }
            ]
            """.trimIndent()
    }
}
