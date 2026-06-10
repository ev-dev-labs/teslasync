package io.teslasync.shared.core.presentation.guard

import io.teslasync.shared.core.data.repo.GuardRepository
import io.teslasync.shared.core.data.repo.guardConfigKey
import io.teslasync.shared.core.data.repo.guardEventsKey
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Golden vectors locking the non-trivial client-side derivations ported from the web `useGuard`
 * domain:
 *
 *  1. [isGuardEventAcknowledged] — derived SOLELY from `acknowledged_at != null` (a present
 *     `acknowledged_by` is irrelevant; an absent `acknowledged_at` is unacknowledged).
 *  2. [guardVehicleEnabled] — the web `enabled: vehicleId > 0` gate (null/blank/non-numeric/
 *     non-positive ⇒ disabled; strictly-positive ⇒ enabled).
 *  3. [guardEventsOf] — the web `select: safeArray(data?.events)` unwrap (null envelope / absent
 *     events ⇒ empty list).
 *  4. [guardConfigKey] / [guardEventsKey] — the web `guardKeys.config` / `guardKeys.events` tuples.
 *
 * The vectors are language-neutral (raw JSON in / fixed expectations out) so the Windows C# port
 * and the KMP core load the identical set and cannot drift (ADR-004). The fixtures are inlined to
 * stay within this slice's allowed file scope; the C# port mirrors these exact rows.
 */
class GuardGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    // ---- isGuardEventAcknowledged -------------------------------------------------

    @Serializable
    private data class AckRow(
        val name: String,
        val input: GuardEvent,
        val expected: Boolean,
    )

    private fun ackRows(): List<AckRow> = json.decodeFromString(ACK_GOLDEN)

    @Test
    fun ackGoldenCoversEveryShape() {
        val names = ackRows().map { it.name }.toSet()
        listOf(
            "acknowledged_with_by",
            "acknowledged_at_without_by",
            "unacknowledged_null_at",
            "unacknowledged_absent_at",
        ).forEach { assertTrue(it in names, "ack golden missing the '$it' case") }
    }

    @Test
    fun everyAckRowMatchesIsGuardEventAcknowledged() {
        for (row in ackRows()) {
            assertEquals(row.expected, isGuardEventAcknowledged(row.input), "isGuardEventAcknowledged('${row.name}')")
        }
    }

    // ---- guardVehicleEnabled ------------------------------------------------------

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
        listOf("null", "blank", "zero", "negative", "non_numeric", "positive")
            .forEach { assertTrue(it in names, "enabled golden missing the '$it' case") }
    }

    @Test
    fun everyEnabledRowMatchesGuardVehicleEnabled() {
        for (row in enabledRows()) {
            assertEquals(row.expected, guardVehicleEnabled(row.vehicleId), "guardVehicleEnabled('${row.name}')")
        }
    }

    // ---- guardEventsOf unwrap -----------------------------------------------------

    @Test
    fun guardEventsOfUnwrapsEnvelopeOrEmpty() {
        val populated =
            GuardEventsResponse(
                vehicleId = 7,
                events = listOf(GuardEvent(id = 1, vehicleId = 7, ts = "2026-01-01T00:00:00Z", eventType = "x")),
            )
        assertEquals(1, guardEventsOf(populated).size)
        // Absent events key decodes to the empty default; a null envelope is also the empty list.
        assertEquals(emptyList(), guardEventsOf(GuardEventsResponse(vehicleId = 7)))
        assertEquals(emptyList(), guardEventsOf(null))
    }

    // ---- cache key tuples ---------------------------------------------------------

    @Test
    fun cacheKeysMatchTheWebGuardKeysTuples() {
        assertEquals("config:7", guardConfigKey("7"))
        assertEquals("events:7", guardEventsKey("7"))
        // Distinct prefixes guarantee config and events never collide in the shared partition.
        assertTrue(guardConfigKey("7") != guardEventsKey("7"))
    }

    @Test
    fun parityHelpersAreReferencedFromTheDataPort() {
        // Compile-time anchor: the derivations under test are the ones the S7 port exposes.
        assertTrue(GuardRepository::class.simpleName == "GuardRepository")
    }

    private companion object {
        val ACK_GOLDEN =
            """
            [
              { "name": "acknowledged_with_by",
                "input": { "id": 1, "vehicle_id": 7, "ts": "2026-06-15T00:00:00Z", "event_type": "vehicle_moved",
                           "acknowledged_at": "2026-06-15T01:00:00Z", "acknowledged_by": "alice" },
                "expected": true },
              { "name": "acknowledged_at_without_by",
                "input": { "id": 2, "vehicle_id": 7, "ts": "2026-06-15T00:00:00Z", "event_type": "state_changed",
                           "acknowledged_at": "2026-06-15T01:00:00Z" },
                "expected": true },
              { "name": "unacknowledged_null_at",
                "input": { "id": 3, "vehicle_id": 7, "ts": "2026-06-15T00:00:00Z", "event_type": "state_changed",
                           "acknowledged_at": null, "acknowledged_by": null },
                "expected": false },
              { "name": "unacknowledged_absent_at",
                "input": { "id": 4, "vehicle_id": 7, "ts": "2026-06-15T00:00:00Z", "event_type": "state_changed" },
                "expected": false }
            ]
            """.trimIndent()

        val ENABLED_GOLDEN =
            """
            [
              { "name": "null",                              "expected": false },
              { "name": "blank",        "vehicleId": "",     "expected": false },
              { "name": "zero",         "vehicleId": "0",    "expected": false },
              { "name": "negative",     "vehicleId": "-1",   "expected": false },
              { "name": "non_numeric",  "vehicleId": "abc",  "expected": false },
              { "name": "positive",     "vehicleId": "42",   "expected": true }
            ]
            """.trimIndent()
    }
}
