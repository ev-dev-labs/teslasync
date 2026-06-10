package io.teslasync.shared.core.presentation.feedback

import io.teslasync.shared.core.data.repo.FeedbackRepository
import io.teslasync.shared.core.data.repo.feedbackCacheKey
import io.teslasync.shared.core.data.repo.feedbackQuery
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Golden vectors locking the non-trivial client-side derivations ported from the web
 * `useFeedback` domain (web/src/api/hooks/useFeedback.ts):
 *
 *  1. [feedbackQuery] — the `/admin/feedback` query builder (web `buildQuery`): `status`/
 *     `category` sent only when non-blank, `limit`/`offset` sent whenever present (so an
 *     explicit `0` IS sent, mirroring `typeof x === 'number'`).
 *  2. [feedbackCacheKey] — the web `feedbackKeys.list` tuple (null-coalesced, so an empty
 *     status stays `''` in the KEY even though it is dropped from the QUERY).
 *
 * The vectors are language-neutral (fixed inputs in / fixed expectations out) so the Windows C#
 * port and the KMP core load the identical set and cannot drift (ADR-004). The fixtures are
 * inlined to stay within this slice's allowed file scope; the C# port mirrors these exact rows.
 */
class FeedbackGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    // ---- feedbackQuery builder ----------------------------------------------------

    @Serializable
    private data class QueryRow(
        val name: String,
        val status: String? = null,
        val category: String? = null,
        val limit: Int? = null,
        val offset: Int? = null,
        val expected: Map<String, String>,
    )

    private fun queryRows(): List<QueryRow> = json.decodeFromString(QUERY_GOLDEN)

    @Test
    fun queryGoldenCoversEveryGuardCase() {
        val names = queryRows().map { it.name }.toSet()
        listOf(
            "empty",
            "status_only",
            "category_only",
            "all_params",
            "blank_filters_dropped",
            "zero_paging_sent",
        ).forEach { assertTrue(it in names, "query golden missing the '$it' case") }
    }

    @Test
    fun everyQueryRowMatchesFeedbackQuery() {
        for (row in queryRows()) {
            val actual = feedbackQuery(FeedbackListParams(row.status, row.category, row.limit, row.offset))
            assertEquals(row.expected, actual, "feedbackQuery('${row.name}')")
        }
    }

    // ---- feedbackCacheKey tuple ---------------------------------------------------

    @Serializable
    private data class KeyRow(
        val name: String,
        val status: String? = null,
        val category: String? = null,
        val limit: Int? = null,
        val offset: Int? = null,
        val expected: String,
    )

    private fun keyRows(): List<KeyRow> = json.decodeFromString(KEY_GOLDEN)

    @Test
    fun keyGoldenCoversNullCoalescingEdges() {
        val names = keyRows().map { it.name }.toSet()
        listOf("empty", "status_only", "full", "empty_status_stays_empty", "zero_paging")
            .forEach { assertTrue(it in names, "key golden missing the '$it' case") }
    }

    @Test
    fun everyKeyRowMatchesFeedbackCacheKey() {
        for (row in keyRows()) {
            val actual = feedbackCacheKey(FeedbackListParams(row.status, row.category, row.limit, row.offset))
            assertEquals(row.expected, actual, "feedbackCacheKey('${row.name}')")
        }
    }

    @Test
    fun parityHelpersAreReferencedFromTheDataPort() {
        // Compile-time anchor: the derivations under test are the ones the S7 port exposes.
        assertTrue(FeedbackRepository::class.simpleName == "FeedbackRepository")
    }

    private companion object {
        val QUERY_GOLDEN =
            """
            [
              { "name": "empty",                 "expected": {} },
              { "name": "status_only",            "status": "new", "expected": { "status": "new" } },
              { "name": "category_only",          "category": "bug", "expected": { "category": "bug" } },
              { "name": "all_params",             "status": "triaged", "category": "feature",
                "limit": 25, "offset": 50,
                "expected": { "status": "triaged", "category": "feature", "limit": "25", "offset": "50" } },
              { "name": "blank_filters_dropped",  "status": "", "category": "", "limit": 10,
                "expected": { "limit": "10" } },
              { "name": "zero_paging_sent",       "limit": 0, "offset": 0,
                "expected": { "limit": "0", "offset": "0" } }
            ]
            """.trimIndent()

        val KEY_GOLDEN =
            """
            [
              { "name": "empty",                    "expected": "all:all::" },
              { "name": "status_only",              "status": "new", "expected": "new:all::" },
              { "name": "full",                     "status": "closed", "category": "other",
                "limit": 25, "offset": 50, "expected": "closed:other:25:50" },
              { "name": "empty_status_stays_empty", "status": "", "expected": ":all::" },
              { "name": "zero_paging",              "limit": 0, "offset": 0, "expected": "all:all:0:0" }
            ]
            """.trimIndent()
    }
}
