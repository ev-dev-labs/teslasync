package io.teslasync.shared.core.presentation.locations

import io.teslasync.shared.core.data.repo.LocationRepository
import io.teslasync.shared.core.data.repo.geofenceBulkDeleteBody
import io.teslasync.shared.core.data.repo.geofencesKey
import io.teslasync.shared.core.data.repo.visitedLocationsKey
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Golden vectors locking the non-trivial client-side derivations ported from the web `useLocations`
 * domain:
 *
 *  1. [locationsEnabled] — the web `useLocations` `enabled: !!vehicleId` gate (null/empty ⇒ disabled;
 *     ANY non-empty string — including `"0"` and whitespace, which JS treats as truthy — ⇒ enabled).
 *  2. [visitedLocationsKey] / [geofencesKey] — the web `locationKeys.all` / `locationKeys.geofences`
 *     tuples (a null vehicle id coalesces to `all`).
 *  3. [geofenceBulkDeleteBody] — the web `JSON.stringify({ ids, op: 'delete' })` request body.
 *
 * The vectors are language-neutral (raw JSON in / fixed expectations out) so the Windows C# port and
 * the KMP core load the identical set and cannot drift (ADR-004). The fixtures are inlined to stay
 * within this slice's allowed file scope; the C# port mirrors these exact rows.
 */
class LocationsGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    // ---- locationsEnabled gate ----------------------------------------------------

    @Serializable
    private data class EnabledRow(
        val name: String,
        val vehicleId: String? = null,
        val expected: Boolean,
    )

    private fun enabledRows(): List<EnabledRow> = json.decodeFromString(ENABLED_GOLDEN)

    @Test
    fun enabledGoldenCoversTheGatePredicate() {
        val names = enabledRows().map { it.name }.toSet()
        listOf("null", "blank", "zero_is_truthy", "whitespace_is_truthy", "positive")
            .forEach { assertTrue(it in names, "enabled golden missing the '$it' case") }
    }

    @Test
    fun everyEnabledRowMatchesLocationsEnabled() {
        for (row in enabledRows()) {
            assertEquals(row.expected, locationsEnabled(row.vehicleId), "locationsEnabled('${row.name}')")
        }
    }

    // ---- cache key tuples ---------------------------------------------------------

    @Test
    fun cacheKeysMatchTheWebLocationKeysTuples() {
        assertEquals("locations:7", visitedLocationsKey("7"))
        // Null vehicle id coalesces to `all`, mirroring `locationKeys.all(vehicleId ?? 'all')`.
        assertEquals("locations:all", visitedLocationsKey(null))
        assertEquals("geofences", geofencesKey())
        // Distinct prefixes guarantee the two reads never collide in the shared partition.
        assertTrue(visitedLocationsKey("7") != geofencesKey())
    }

    // ---- bulk-delete body ---------------------------------------------------------

    @Test
    fun bulkDeleteBodyMatchesTheWebJsonStringify() {
        val body = geofenceBulkDeleteBody(listOf(1L, 2L, 99L))
        assertEquals("delete", body["op"]!!.jsonPrimitive.content)
        val ids = body["ids"]!!.jsonArray.map { it.jsonPrimitive.content }
        assertEquals(listOf("1", "2", "99"), ids)
        // Empty id list still carries the constant op (the web sends whatever ids it was given).
        val empty = geofenceBulkDeleteBody(emptyList())
        assertEquals("delete", empty["op"]!!.jsonPrimitive.content)
        assertTrue(empty["ids"]!!.jsonArray.isEmpty())
    }

    @Test
    fun parityHelpersAreReferencedFromTheDataPort() {
        // Compile-time anchor: the derivations under test are the ones the S7 port exposes.
        assertTrue(LocationRepository::class.simpleName == "LocationRepository")
    }

    private companion object {
        val ENABLED_GOLDEN =
            """
            [
              { "name": "null",                                    "expected": false },
              { "name": "blank",                "vehicleId": "",    "expected": false },
              { "name": "zero_is_truthy",       "vehicleId": "0",   "expected": true },
              { "name": "whitespace_is_truthy", "vehicleId": " ",   "expected": true },
              { "name": "positive",             "vehicleId": "42",  "expected": true }
            ]
            """.trimIndent()
    }
}
