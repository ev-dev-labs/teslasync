package io.teslasync.shared.core.presentation.pinned

import io.teslasync.shared.core.data.repo.PinnedRepository
import io.teslasync.shared.core.data.repo.pinnedCacheKey
import io.teslasync.shared.core.data.repo.pinnedQuery
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Golden vectors locking the non-trivial client-side derivations ported from the web `usePinned`
 * domain (web/src/api/hooks/usePinned.ts):
 *
 *  1. [pinnedQuery] — the `/pinned` query builder (web `buildQuery`): `type` always sent;
 *     `context` sent whenever `!= null` (so an explicit `""` IS on the wire, unlike the truthy
 *     guards other hooks use).
 *  2. [pinnedCacheKey] — the web `pinnedKeys.list` tuple `['pinned', type, context ?? null]`,
 *     where an ABSENT context (`null`) must stay distinct from a PRESENT one (a string, including
 *     `""` or the literal `"null"`); the `v:` prefix on present contexts preserves that
 *     distinction in the flat key.
 *
 * The vectors are language-neutral (typed inputs in / fixed expectations out) so the Windows C#
 * port and the KMP core load the identical set and cannot drift (ADR-004). The fixtures are
 * inlined to stay within this slice's allowed file scope; the C# port mirrors these exact rows.
 */
class PinnedGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    // ---- pinnedQuery builder ------------------------------------------------------

    @Serializable
    private data class QueryRow(
        val name: String,
        val type: PinnedItemType,
        val context: String? = null,
        val expected: Map<String, String>,
    )

    private fun queryRows(): List<QueryRow> = json.decodeFromString(QUERY_GOLDEN)

    @Test
    fun queryGoldenCoversEveryGuardCase() {
        val names = queryRows().map { it.name }.toSet()
        listOf("type_only", "with_context", "empty_context_is_sent", "compound_type_wire")
            .forEach { assertTrue(it in names, "query golden missing the '$it' case") }
    }

    @Test
    fun everyQueryRowMatchesPinnedQuery() {
        for (row in queryRows()) {
            val actual = pinnedQuery(row.type, row.context)
            assertEquals(row.expected, actual, "pinnedQuery('${row.name}')")
        }
    }

    // ---- pinnedCacheKey tuple -----------------------------------------------------

    @Serializable
    private data class KeyRow(
        val name: String,
        val type: PinnedItemType,
        val context: String? = null,
        val expected: String,
    )

    private fun keyRows(): List<KeyRow> = json.decodeFromString(KEY_GOLDEN)

    @Test
    fun keyGoldenCoversNullVsPresentEdges() {
        val names = keyRows().map { it.name }.toSet()
        listOf("null_context", "present_context", "empty_context", "literal_null_string", "compound_type_wire")
            .forEach { assertTrue(it in names, "key golden missing the '$it' case") }
    }

    @Test
    fun everyKeyRowMatchesPinnedCacheKey() {
        for (row in keyRows()) {
            val actual = pinnedCacheKey(row.type, row.context)
            assertEquals(row.expected, actual, "pinnedCacheKey('${row.name}')")
        }
    }

    @Test
    fun absentAndLiteralNullContextsAreDistinctKeys() {
        // The crux of the `v:` prefix: `null` and the string `"null"` must NOT collide, exactly as
        // the web tuples `['pinned','widget',null]` and `['pinned','widget','null']` differ.
        assertTrue(
            pinnedCacheKey(PinnedItemType.Widget, null) != pinnedCacheKey(PinnedItemType.Widget, "null"),
            "absent context must not collide with the literal string \"null\"",
        )
    }

    @Test
    fun parityHelpersAreReferencedFromTheDataPort() {
        // Compile-time anchor: the derivations under test are the ones the S7 port exposes.
        assertTrue(PinnedRepository::class.simpleName == "PinnedRepository")
    }

    private companion object {
        val QUERY_GOLDEN =
            """
            [
              { "name": "type_only",             "type": "widget",  "expected": { "type": "widget" } },
              { "name": "with_context",          "type": "widget",  "context": "glance",
                "expected": { "type": "widget", "context": "glance" } },
              { "name": "empty_context_is_sent", "type": "widget",  "context": "",
                "expected": { "type": "widget", "context": "" } },
              { "name": "compound_type_wire",    "type": "alert_rule",
                "expected": { "type": "alert_rule" } },
              { "name": "vehicle_type",          "type": "vehicle", "expected": { "type": "vehicle" } }
            ]
            """.trimIndent()

        val KEY_GOLDEN =
            """
            [
              { "name": "null_context",        "type": "widget",     "expected": "widget:null" },
              { "name": "present_context",     "type": "widget",     "context": "glance",
                "expected": "widget:v:glance" },
              { "name": "empty_context",       "type": "widget",     "context": "",
                "expected": "widget:v:" },
              { "name": "literal_null_string", "type": "widget",     "context": "null",
                "expected": "widget:v:null" },
              { "name": "compound_type_wire",  "type": "alert_rule", "expected": "alert_rule:null" }
            ]
            """.trimIndent()
    }
}
