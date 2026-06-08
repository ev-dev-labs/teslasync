package io.teslasync.shared.core.presentation.dlq

import io.teslasync.shared.core.data.repo.dlqAuditPath
import io.teslasync.shared.core.data.repo.dlqAuditScoped
import io.teslasync.shared.core.data.repo.dlqEntryNumericId
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Golden vectors locking the two client-side derivations ported from the web `useDLQ` domain — the
 * entry-id guard (`useDLQEntry`'s `numericId = id > 0 ? id : 0`) and the audit scoping
 * (`useDLQAudit`'s `scoped = dlqId > 0` and the `scoped ? /system/dlq/{id}/audit : /system/dlq/audit`
 * path). The vectors are language-neutral (plain JSON in / JSON out) so the C# Windows port and the
 * KMP core can load the identical set and cannot drift (ADR-004). The fixture is inlined here
 * (rather than a separate `apps/shared/spec` file) to stay within this slice's allowed file scope;
 * the C# port mirrors these exact rows.
 *
 * Web contract reproduced row-for-row:
 *  - entry id: a positive id passes through; null/zero/negative collapses to 0 (query disabled);
 *  - audit scoping: a positive dlqId scopes to one entry; null/zero/negative selects the global feed.
 */
class DlqDerivationGoldenTest {
    @Serializable
    private data class EntryRow(
        val name: String,
        val input: Long?,
        val expected: Long,
    )

    @Serializable
    private data class AuditRow(
        val name: String,
        val input: Long?,
        val scoped: Boolean,
        val path: String,
    )

    private val json = Json

    @Test
    fun entryNumericIdGuardMatchesEveryGoldenRow() {
        val rows: List<EntryRow> = json.decodeFromString(ENTRY_GOLDEN)
        val names = rows.map { it.name }.toSet()
        listOf("null", "zero", "negative", "positive").forEach { assertTrue(it in names, "entry golden missing '$it'") }
        for (row in rows) {
            assertEquals(
                row.expected,
                dlqEntryNumericId(row.input),
                "dlqEntryNumericId('${row.name}') expected ${row.expected} but got ${dlqEntryNumericId(row.input)}",
            )
        }
    }

    @Test
    fun auditScopingAndPathMatchEveryGoldenRow() {
        val rows: List<AuditRow> = json.decodeFromString(AUDIT_GOLDEN)
        val names = rows.map { it.name }.toSet()
        listOf("null_global", "zero_global", "negative_global", "positive_scoped").forEach {
            assertTrue(it in names, "audit golden missing '$it'")
        }
        for (row in rows) {
            assertEquals(row.scoped, dlqAuditScoped(row.input), "dlqAuditScoped('${row.name}')")
            assertEquals(row.path, dlqAuditPath(row.input), "dlqAuditPath('${row.name}')")
        }
    }

    private companion object {
        val ENTRY_GOLDEN =
            """
            [
              { "name": "null",     "input": null, "expected": 0 },
              { "name": "zero",     "input": 0,    "expected": 0 },
              { "name": "negative", "input": -5,   "expected": 0 },
              { "name": "positive", "input": 42,   "expected": 42 }
            ]
            """.trimIndent()

        val AUDIT_GOLDEN =
            """
            [
              { "name": "null_global",     "input": null, "scoped": false, "path": "/system/dlq/audit" },
              { "name": "zero_global",     "input": 0,    "scoped": false, "path": "/system/dlq/audit" },
              { "name": "negative_global", "input": -3,   "scoped": false, "path": "/system/dlq/audit" },
              { "name": "positive_scoped", "input": 7,    "scoped": true,  "path": "/system/dlq/7/audit" }
            ]
            """.trimIndent()
    }
}
