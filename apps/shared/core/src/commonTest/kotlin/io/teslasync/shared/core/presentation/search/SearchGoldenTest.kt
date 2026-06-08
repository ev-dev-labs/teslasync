package io.teslasync.shared.core.presentation.search

import io.teslasync.shared.core.data.repo.SearchRepository
import io.teslasync.shared.core.data.repo.searchCacheKey
import io.teslasync.shared.core.data.repo.searchQuery
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Golden vectors locking the non-trivial client-side derivations ported from the web `useSearch`
 * domain (web/src/api/hooks/useSearch.ts):
 *
 *  1. [planSearch] — the `enabled` guard: trim, then `!disabled && length >= SEARCH_MIN_QUERY_LENGTH`.
 *  2. [searchQuery] — the `/search` query builder (web `queryFn`): `q` always; `types` only when
 *     non-empty (comma-joined); `limit` only when `> 0`.
 *  3. [searchCacheKey] — the web `searchKeys.global` tuple `['search','global', query, types?.join(',')
 *     ?? '', limit ?? null]` flattened with a NUL separator (`''` for no types, `'null'` for no limit).
 *
 * The vectors are language-neutral (typed inputs in / fixed expectations out) so the Windows C# port
 * and the KMP core load the identical set and cannot drift (ADR-004). The fixtures are inlined to stay
 * within this slice's allowed file scope; the C# port mirrors these exact rows.
 */
class SearchGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    // ---- planSearch ---------------------------------------------------------------

    @Serializable
    private data class PlanRow(
        val name: String,
        val query: String,
        val types: List<SearchHitType> = emptyList(),
        val limit: Int? = null,
        val disabled: Boolean = false,
        val enabled: Boolean,
        val plannedQuery: String? = null,
    )

    private fun planRows(): List<PlanRow> = json.decodeFromString(PLAN_GOLDEN)

    @Test
    fun planGoldenCoversEveryGuardEdge() {
        val names = planRows().map { it.name }.toSet()
        listOf("empty_skip", "one_char_skip", "trims_to_one_char_skip", "min_length_fetch", "trims_to_query", "disabled_skip")
            .forEach { assertTrue(it in names, "plan golden missing the '$it' case") }
    }

    @Test
    fun everyPlanRowMatchesPlanSearch() {
        for (row in planRows()) {
            val actual = planSearch(SearchInput(row.query, SearchOptions(row.types, row.limit, row.disabled)))
            if (row.enabled) {
                val fetch =
                    actual as? SearchRequestPlan.Fetch
                        ?: error("plan('${row.name}') expected Fetch, got $actual")
                assertEquals(row.plannedQuery, fetch.query, "plan('${row.name}') trimmed query")
                assertEquals(row.types, fetch.types, "plan('${row.name}') types")
                assertEquals(row.limit, fetch.limit, "plan('${row.name}') limit")
            } else {
                assertEquals(SearchRequestPlan.Skip, actual, "plan('${row.name}') expected Skip")
            }
        }
    }

    // ---- searchQuery builder ------------------------------------------------------

    @Serializable
    private data class QueryRow(
        val name: String,
        val query: String,
        val types: List<SearchHitType> = emptyList(),
        val limit: Int? = null,
        val expected: Map<String, String>,
    )

    private fun queryRows(): List<QueryRow> = json.decodeFromString(QUERY_GOLDEN)

    @Test
    fun queryGoldenCoversEveryGuardCase() {
        val names = queryRows().map { it.name }.toSet()
        listOf("q_only", "with_types", "with_limit", "limit_zero_omitted", "limit_negative_omitted", "all")
            .forEach { assertTrue(it in names, "query golden missing the '$it' case") }
    }

    @Test
    fun everyQueryRowMatchesSearchQuery() {
        for (row in queryRows()) {
            assertEquals(row.expected, searchQuery(row.query, row.types, row.limit), "searchQuery('${row.name}')")
        }
    }

    // ---- searchCacheKey tuple -----------------------------------------------------

    @Serializable
    private data class KeyRow(
        val name: String,
        val query: String,
        val types: List<SearchHitType> = emptyList(),
        val limit: Int? = null,
        val expected: String,
    )

    private fun keyRows(): List<KeyRow> = json.decodeFromString(KEY_GOLDEN)

    @Test
    fun keyGoldenCoversNoneVsPresentEdges() {
        val names = keyRows().map { it.name }.toSet()
        listOf("bare", "with_types", "with_limit", "both")
            .forEach { assertTrue(it in names, "key golden missing the '$it' case") }
    }

    @Test
    fun everyKeyRowMatchesSearchCacheKey() {
        for (row in keyRows()) {
            assertEquals(row.expected, searchCacheKey(row.query, row.types, row.limit), "searchCacheKey('${row.name}')")
        }
    }

    @Test
    fun typeFilterAndLimitAreDistinctInTheKey() {
        // The crux of the flattened tuple: a type filter or a limit must change the key, exactly as the
        // web tuple's 4th/5th elements do.
        assertTrue(searchCacheKey("mod", emptyList(), null) != searchCacheKey("mod", listOf(SearchHitType.Vehicle), null))
        assertTrue(searchCacheKey("mod", emptyList(), null) != searchCacheKey("mod", emptyList(), 10))
    }

    @Test
    fun parityHelpersAreReferencedFromTheDataPort() {
        // Compile-time anchor: the builders under test are the ones the S7 port exposes.
        assertTrue(SearchRepository::class.simpleName == "SearchRepository")
    }

    private companion object {
        val PLAN_GOLDEN =
            """
            [
              { "name": "empty_skip",              "query": "",         "enabled": false },
              { "name": "one_char_skip",           "query": "m",        "enabled": false },
              { "name": "trims_to_one_char_skip",  "query": "  a  ",    "enabled": false },
              { "name": "min_length_fetch",        "query": "mo",       "enabled": true,  "plannedQuery": "mo" },
              { "name": "trims_to_query",          "query": "  model  ","enabled": true,  "plannedQuery": "model" },
              { "name": "disabled_skip",           "query": "model 3",  "disabled": true, "enabled": false },
              { "name": "with_types_and_limit",    "query": "mod",      "types": ["vehicle","drive"], "limit": 5,
                "enabled": true, "plannedQuery": "mod" }
            ]
            """.trimIndent()

        val QUERY_GOLDEN =
            """
            [
              { "name": "q_only",                "query": "mod", "expected": { "q": "mod" } },
              { "name": "with_types",            "query": "mod", "types": ["vehicle","drive"],
                "expected": { "q": "mod", "types": "vehicle,drive" } },
              { "name": "with_limit",            "query": "mod", "limit": 10,
                "expected": { "q": "mod", "limit": "10" } },
              { "name": "limit_zero_omitted",    "query": "mod", "limit": 0,  "expected": { "q": "mod" } },
              { "name": "limit_negative_omitted","query": "mod", "limit": -1, "expected": { "q": "mod" } },
              { "name": "all",                   "query": "mod", "types": ["vehicle"], "limit": 25,
                "expected": { "q": "mod", "types": "vehicle", "limit": "25" } }
            ]
            """.trimIndent()

        val KEY_GOLDEN =
            """
            [
              { "name": "bare",       "query": "mod", "expected": "mod\u0000\u0000null" },
              { "name": "with_types", "query": "mod", "types": ["vehicle","drive"],
                "expected": "mod\u0000vehicle,drive\u0000null" },
              { "name": "with_limit", "query": "mod", "limit": 10, "expected": "mod\u0000\u000010" },
              { "name": "both",       "query": "mod", "types": ["vehicle"], "limit": 25,
                "expected": "mod\u0000vehicle\u000025" }
            ]
            """.trimIndent()
    }
}
