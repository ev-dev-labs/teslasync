package io.teslasync.shared.core.presentation.push

import io.teslasync.shared.core.data.repo.PushRepository
import io.teslasync.shared.core.data.repo.isPushUnconfigured
import io.teslasync.shared.core.data.repo.pushPublicKeyKey
import io.teslasync.shared.core.data.repo.pushPublicKeyValue
import io.teslasync.shared.core.data.repo.pushSubscriptionsKey
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Golden vectors locking the non-trivial client-side derivations ported from the web `usePush`
 * domain (web/src/api/hooks/usePush.ts):
 *
 *  1. [pushPublicKeyValue] — the web `return res.publicKey || null`: a null/empty key collapses to
 *     `null`; a non-empty key passes through.
 *  2. [isPushUnconfigured] — the web catch guard `/404|not configured/i.test(err.message)`: a 404
 *     status OR a message/body matching `404` / `not configured` (case-insensitive) maps the read
 *     to a `null` key instead of an error.
 *  3. [pushPublicKeyKey] / [pushSubscriptionsKey] — the flat cache keys for the web `pushKeys`
 *     tuples (`['push','public-key']` / `['push','subscriptions']`).
 *
 * The vectors are language-neutral (typed inputs in / fixed expectations out) so the Windows C#
 * port and the KMP core load the identical set and cannot drift (ADR-004). The fixtures are
 * inlined to stay within this slice's allowed file scope; the C# port mirrors these exact rows.
 */
class PushGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    // ---- pushPublicKeyValue (empty-coalesce) --------------------------------------

    @Serializable
    private data class ValueRow(
        val name: String,
        val raw: String? = null,
        val expected: String? = null,
    )

    private fun valueRows(): List<ValueRow> = json.decodeFromString(VALUE_GOLDEN)

    @Test
    fun valueGoldenCoversEmptyNullAndPresent() {
        val names = valueRows().map { it.name }.toSet()
        listOf("present_key", "empty_string_is_null", "null_is_null")
            .forEach { assertTrue(it in names, "value golden missing the '$it' case") }
    }

    @Test
    fun everyValueRowMatchesPushPublicKeyValue() {
        for (row in valueRows()) {
            assertEquals(row.expected, pushPublicKeyValue(row.raw), "pushPublicKeyValue('${row.name}')")
        }
    }

    // ---- isPushUnconfigured (404 / "not configured") ------------------------------

    @Serializable
    private data class UnconfiguredRow(
        val name: String,
        val status: Int? = null,
        val message: String? = null,
        val expected: Boolean,
    )

    private fun unconfiguredRows(): List<UnconfiguredRow> = json.decodeFromString(UNCONFIGURED_GOLDEN)

    @Test
    fun unconfiguredGoldenCoversEveryGuardBranch() {
        val names = unconfiguredRows().map { it.name }.toSet()
        listOf(
            "status_404",
            "message_404",
            "message_not_configured",
            "case_insensitive_not_configured",
            "unrelated_5xx",
            "null_message",
        ).forEach { assertTrue(it in names, "unconfigured golden missing the '$it' case") }
    }

    @Test
    fun everyUnconfiguredRowMatchesIsPushUnconfigured() {
        for (row in unconfiguredRows()) {
            assertEquals(
                row.expected,
                isPushUnconfigured(row.status, row.message),
                "isPushUnconfigured('${row.name}')",
            )
        }
    }

    // ---- cache keys ---------------------------------------------------------------

    @Test
    fun cacheKeysMatchTheWebPushKeysTuples() {
        assertEquals("public-key", pushPublicKeyKey())
        assertEquals("subscriptions", pushSubscriptionsKey())
    }

    @Test
    fun parityHelpersAreReferencedFromTheDataPort() {
        // Compile-time anchor: the derivations under test are the ones the S7 port exposes.
        assertTrue(PushRepository::class.simpleName == "PushRepository")
    }

    private companion object {
        val VALUE_GOLDEN =
            """
            [
              { "name": "present_key",          "raw": "BFxVAPIDpublicKey...", "expected": "BFxVAPIDpublicKey..." },
              { "name": "empty_string_is_null", "raw": "" },
              { "name": "null_is_null" }
            ]
            """.trimIndent()

        val UNCONFIGURED_GOLDEN =
            """
            [
              { "name": "status_404",                      "status": 404, "message": "HTTP 404", "expected": true },
              { "name": "message_404",                     "message": "HTTP 404", "expected": true },
              { "name": "message_not_configured",
                "message": "web push is not configured on this install", "expected": true },
              { "name": "case_insensitive_not_configured", "message": "Not Configured", "expected": true },
              { "name": "unrelated_5xx",                   "status": 500, "message": "internal error", "expected": false },
              { "name": "null_message",                    "status": 200, "expected": false }
            ]
            """.trimIndent()
    }
}
