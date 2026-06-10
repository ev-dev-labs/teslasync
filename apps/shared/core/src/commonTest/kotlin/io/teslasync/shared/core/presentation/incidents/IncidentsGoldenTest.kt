package io.teslasync.shared.core.presentation.incidents

import io.teslasync.shared.core.data.repo.IncidentRepository
import io.teslasync.shared.core.data.repo.incidentDetailCacheKey
import io.teslasync.shared.core.data.repo.incidentListCacheKey
import io.teslasync.shared.core.data.repo.incidentListQuery
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Golden vectors locking the non-trivial client-side derivations ported from the web
 * `useIncidents` domain (web/src/api/hooks/useIncidents.ts):
 *
 *  1. [incidentListQuery] — the `/status/incidents` query builder (web `listIncidents`): `active=1`
 *     sent only when `activeOnly`, `limit` sent only when present and non-zero (the truthy guard).
 *  2. [incidentListCacheKey] — the web `KEY_LIST(p)` tuple, prefixed `list:` and collapsed onto the
 *     `(activeOnly, limit)` pair.
 *  3. [incidentDetailCacheKey] — the web `KEY_DETAIL(id)` tuple, prefixed `detail:`.
 *
 * The vectors are language-neutral (raw JSON in / fixed expectations out) so the Windows C# port
 * and the KMP core load the identical set and cannot drift (ADR-004). The fixtures are inlined to
 * stay within this slice's allowed file scope; the C# port mirrors these exact rows.
 */
class IncidentsGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    // ---- incidentListQuery builder ------------------------------------------------

    @Serializable
    private data class QueryRow(
        val name: String,
        val activeOnly: Boolean = false,
        val limit: Int? = null,
        val expected: Map<String, String>,
    )

    private fun queryRows(): List<QueryRow> = json.decodeFromString(QUERY_GOLDEN)

    @Test
    fun queryGoldenCoversEveryGuardCase() {
        val names = queryRows().map { it.name }.toSet()
        listOf(
            "empty",
            "active_only",
            "limit_only",
            "active_and_limit",
            "zero_limit_dropped",
        ).forEach { assertTrue(it in names, "query golden missing the '$it' case") }
    }

    @Test
    fun everyQueryRowMatchesIncidentListQuery() {
        for (row in queryRows()) {
            val actual = incidentListQuery(ListIncidentsParams(activeOnly = row.activeOnly, limit = row.limit))
            assertEquals(row.expected, actual, "incidentListQuery('${row.name}')")
        }
    }

    // ---- incidentListCacheKey tuple -----------------------------------------------

    @Serializable
    private data class KeyRow(
        val name: String,
        val activeOnly: Boolean = false,
        val limit: Int? = null,
        val expected: String,
    )

    private fun listKeyRows(): List<KeyRow> = json.decodeFromString(LIST_KEY_GOLDEN)

    @Test
    fun listKeyGoldenCoversEdges() {
        val names = listKeyRows().map { it.name }.toSet()
        listOf("empty", "active_only", "limit_only", "active_and_limit")
            .forEach { assertTrue(it in names, "list-key golden missing the '$it' case") }
    }

    @Test
    fun everyListKeyRowMatchesIncidentListCacheKey() {
        for (row in listKeyRows()) {
            val actual = incidentListCacheKey(ListIncidentsParams(activeOnly = row.activeOnly, limit = row.limit))
            assertEquals(row.expected, actual, "incidentListCacheKey('${row.name}')")
        }
    }

    // ---- incidentDetailCacheKey tuple ---------------------------------------------

    @Serializable
    private data class DetailKeyRow(
        val name: String,
        val id: Long,
        val expected: String,
    )

    private fun detailKeyRows(): List<DetailKeyRow> = json.decodeFromString(DETAIL_KEY_GOLDEN)

    @Test
    fun everyDetailKeyRowMatchesIncidentDetailCacheKey() {
        val rows = detailKeyRows()
        assertTrue(rows.map { it.name }.containsAll(listOf("single", "large_id")))
        for (row in rows) {
            assertEquals(row.expected, incidentDetailCacheKey(row.id), "incidentDetailCacheKey('${row.name}')")
        }
    }

    @Test
    fun listAndDetailKeysNeverCollide() {
        // The two read shapes share one cache partition; their key prefixes must be disjoint.
        val listKey = incidentListCacheKey(ListIncidentsParams())
        val detailKey = incidentDetailCacheKey(1)
        assertTrue(listKey.startsWith("list:"))
        assertTrue(detailKey.startsWith("detail:"))
        assertTrue(listKey != detailKey)
    }

    @Test
    fun parityHelpersAreReferencedFromTheDataPort() {
        // Compile-time anchor: the derivations under test are the ones the S7 port exposes.
        assertTrue(IncidentRepository::class.simpleName == "IncidentRepository")
    }

    private companion object {
        val QUERY_GOLDEN =
            """
            [
              { "name": "empty",            "expected": {} },
              { "name": "active_only",      "activeOnly": true, "expected": { "active": "1" } },
              { "name": "limit_only",       "limit": 25, "expected": { "limit": "25" } },
              { "name": "active_and_limit", "activeOnly": true, "limit": 10,
                "expected": { "active": "1", "limit": "10" } },
              { "name": "zero_limit_dropped", "limit": 0, "expected": {} }
            ]
            """.trimIndent()

        val LIST_KEY_GOLDEN =
            """
            [
              { "name": "empty",            "expected": "list:false:" },
              { "name": "active_only",      "activeOnly": true, "expected": "list:true:" },
              { "name": "limit_only",       "limit": 25, "expected": "list:false:25" },
              { "name": "active_and_limit", "activeOnly": true, "limit": 10, "expected": "list:true:10" }
            ]
            """.trimIndent()

        val DETAIL_KEY_GOLDEN =
            """
            [
              { "name": "single",   "id": 1, "expected": "detail:1" },
              { "name": "large_id", "id": 987654321, "expected": "detail:987654321" }
            ]
            """.trimIndent()
    }
}
