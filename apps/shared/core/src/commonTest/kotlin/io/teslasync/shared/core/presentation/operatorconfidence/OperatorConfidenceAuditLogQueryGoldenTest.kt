package io.teslasync.shared.core.presentation.operatorconfidence

import io.teslasync.shared.core.data.repo.auditLogQuery
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Golden vectors locking the one non-trivial derivation ported from the web `useOperatorConfidence`
 * domain — the `buildAuditLogQuery` query-string builder (web/src/api/hooks/useOperatorConfidence.ts).
 * The vectors are language-neutral (filter inputs in / resolved snake_case query map out) so the C#
 * Windows port and the KMP core load the identical set and cannot drift (ADR-004). The fixture is
 * inlined here (rather than a separate `apps/shared/core/spec` file) to match the lightweight
 * `AdminSafeArrayGoldenTest` precedent and stay within this slice's allowed file scope; the C# port
 * mirrors these exact rows.
 *
 * Web contract reproduced row-for-row:
 *  - `since`/`until`/`entity_type` are emitted only when present AND non-empty (the web truthiness);
 *  - `categories`/`actors`/`actions` are comma-joined and emitted only when non-empty;
 *  - `entity_id`/`limit`/`offset` are emitted whenever present (including 0);
 *  - emission order is since, until, categories, actors, actions, entity_type, entity_id, limit,
 *    offset (the web `URLSearchParams` insertion order).
 */
class OperatorConfidenceAuditLogQueryGoldenTest {
    @Serializable
    private data class GoldenInput(
        val since: String? = null,
        val until: String? = null,
        val categories: List<String> = emptyList(),
        val actors: List<String> = emptyList(),
        val actions: List<String> = emptyList(),
        val entityType: String? = null,
        val entityId: Long? = null,
        val limit: Int? = null,
        val offset: Int? = null,
    )

    @Serializable
    private data class GoldenRow(
        val name: String,
        val input: GoldenInput,
        val expected: Map<String, String>,
        val order: List<String> = emptyList(),
    )

    private val json = Json { ignoreUnknownKeys = true }

    private fun rows(): List<GoldenRow> = json.decodeFromString(GOLDEN)

    private fun GoldenInput.toParams(): AuditLogQueryParams =
        AuditLogQueryParams(
            since = since,
            until = until,
            categories = categories,
            actors = actors,
            actions = actions,
            entityType = entityType,
            entityId = entityId,
            limit = limit,
            offset = offset,
        )

    @Test
    fun goldenFileParsesAndIsComprehensive() {
        val names = rows().map { it.name }.toSet()
        assertTrue(rows().size >= 8, "audit-log query golden should be comprehensive, got ${rows().size}")
        listOf(
            "empty",
            "all_filters",
            "blank_strings_omitted",
            "multi_value_joined",
            "single_categories",
            "zero_entity_id_emitted",
            "offset_only",
            "limit_zero_emitted",
        ).forEach { assertTrue(it in names, "golden missing the '$it' case") }
    }

    @Test
    fun everyGoldenRowMatchesAuditLogQuery() {
        for (row in rows()) {
            val actual = auditLogQuery(row.input.toParams())
            assertEquals(row.expected, actual, "auditLogQuery('${row.name}') content mismatch")
            if (row.order.isNotEmpty()) {
                assertEquals(row.order, actual.keys.toList(), "auditLogQuery('${row.name}') key order mismatch")
            }
        }
    }

    private companion object {
        val GOLDEN =
            """
            [
              { "name": "empty",
                "input": {},
                "expected": {} },

              { "name": "all_filters",
                "input": { "since": "2026-01-01T00:00:00Z", "until": "2026-02-01T00:00:00Z",
                           "categories": ["auth"], "actors": ["root"], "actions": ["login"],
                           "entityType": "vehicle", "entityId": 7, "limit": 100, "offset": 20 },
                "expected": { "since": "2026-01-01T00:00:00Z", "until": "2026-02-01T00:00:00Z",
                              "categories": "auth", "actors": "root", "actions": "login",
                              "entity_type": "vehicle", "entity_id": "7", "limit": "100", "offset": "20" },
                "order": ["since","until","categories","actors","actions","entity_type","entity_id","limit","offset"] },

              { "name": "blank_strings_omitted",
                "input": { "since": "", "until": "", "entityType": "", "limit": 25 },
                "expected": { "limit": "25" } },

              { "name": "multi_value_joined",
                "input": { "categories": ["auth","admin"], "actors": ["a","b","c"], "actions": ["x","y"] },
                "expected": { "categories": "auth,admin", "actors": "a,b,c", "actions": "x,y" },
                "order": ["categories","actors","actions"] },

              { "name": "single_categories",
                "input": { "categories": ["billing"] },
                "expected": { "categories": "billing" } },

              { "name": "zero_entity_id_emitted",
                "input": { "entityId": 0 },
                "expected": { "entity_id": "0" } },

              { "name": "offset_only",
                "input": { "offset": 40 },
                "expected": { "offset": "40" } },

              { "name": "limit_zero_emitted",
                "input": { "limit": 0 },
                "expected": { "limit": "0" } }
            ]
            """.trimIndent()
    }
}
