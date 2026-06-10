package io.teslasync.shared.core.presentation.trips

import io.teslasync.shared.core.data.repo.TRIPS_FAMILY
import io.teslasync.shared.core.data.repo.tripDetailKey
import io.teslasync.shared.core.data.repo.tripsKeyInFamily
import io.teslasync.shared.core.data.repo.tripsListKey
import io.teslasync.shared.core.data.repo.tripsQuery
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Golden vectors locking the client-side derivations ported from the web `useTrips` domain:
 *
 *  1. [tripsQuery] — the per-field truthy projection of [TripsParams] onto the `/trips` query string
 *     (the web `if (params.vehicle_id)` / `if (params.limit)` / `if (offset != null && offset > 0)` /
 *     `if (params.start)` / `if (params.end)` guards, in `URLSearchParams` insertion order).
 *  2. The cache/feed key builders mirroring the web TanStack query keys: the list `['trips', params]`
 *     hash ([tripsListKey], `undefined` fields dropped, value-carrying fields kept in sorted-key
 *     order) and the detail `['trips', id]` tuple ([tripDetailKey]).
 *  3. [tripsKeyInFamily] — the TanStack `['trips']` prefix-invalidation semantics that decide which
 *     feeds [TripsStore.refresh] re-collects (BOTH the list and the detail).
 *
 * The vectors are language-neutral (raw JSON in / fixed expectations out) so the Windows C# port and
 * the KMP core load the identical set and cannot drift (ADR-004). The fixtures are inlined to stay
 * within this slice's allowed file scope; the C# port mirrors these exact rows.
 */
class TripsGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    // ---- tripsQuery per-field truthy guards ---------------------------------------

    @Serializable
    private data class QueryRow(
        val name: String,
        @SerialName("vehicle_id") val vehicleId: Long? = null,
        val limit: Int? = null,
        val offset: Int? = null,
        val start: String? = null,
        val end: String? = null,
        val expected: Map<String, String>,
    )

    @Test
    fun tripsQueryMatchesGolden() {
        val rows: List<QueryRow> = json.decodeFromString(QUERY_GOLDEN)
        val names = rows.map { it.name }.toSet()
        listOf(
            "all_absent",
            "zero_dropped",
            "offset_zero_dropped",
            "blank_range_dropped",
            "full",
        ).forEach { assertTrue(it in names, "trips query golden missing '$it'") }
        for (row in rows) {
            val params = TripsParams(row.vehicleId, row.limit, row.offset, row.start, row.end)
            assertEquals(row.expected, tripsQuery(params), "tripsQuery('${row.name}')")
        }
    }

    @Test
    fun tripsQueryPreservesWebInsertionOrder() {
        // URLSearchParams emits in insertion order: vehicle_id, limit, offset, start, end.
        val q = tripsQuery(TripsParams(vehicleId = 7, limit = 20, offset = 40, start = "2026-01-01", end = "2026-02-01"))
        assertEquals(listOf("vehicle_id", "limit", "offset", "start", "end"), q.keys.toList())
    }

    // ---- Cache/feed keys ----------------------------------------------------------

    @Test
    fun listKeyMirrorsTheWebParamsHash() {
        // All-null params (web useTrips() / params ?? {}) ⇒ the bare family key.
        assertEquals("trips", tripsListKey(TripsParams()))
        // Single present field.
        assertEquals("trips|vehicle_id=7", tripsListKey(TripsParams(vehicleId = 7)))
        // Sorted-key order (end, limit, offset, start, vehicle_id), undefined fields dropped …
        assertEquals(
            "trips|end=2026-02-01|limit=20|offset=40|start=2026-01-01|vehicle_id=7",
            tripsListKey(TripsParams(vehicleId = 7, limit = 20, offset = 40, start = "2026-01-01", end = "2026-02-01")),
        )
        // … but value-carrying zero / empty-string fields are KEPT (JSON.stringify keeps 0 and "").
        assertEquals("trips|limit=0|offset=0", tripsListKey(TripsParams(limit = 0, offset = 0)))
        assertEquals("trips|start=", tripsListKey(TripsParams(start = "")))
    }

    @Test
    fun detailKeyMirrorsTheWebTuple() {
        assertEquals("trips|5", tripDetailKey("5"))
        assertEquals("trips|abc", tripDetailKey("abc"))
    }

    @Test
    fun listAndDetailKeysNeverCollide() {
        // A detail id segment never carries '=', so it can never equal a list 'field=value' segment.
        assertTrue(tripDetailKey("5") != tripsListKey(TripsParams(vehicleId = 5)))
    }

    // ---- Family (prefix) invalidation semantics -----------------------------------

    @Test
    fun tripsFamilyMatchesBothListAndDetail() {
        assertTrue(tripsKeyInFamily(TRIPS_FAMILY, TRIPS_FAMILY))
        assertTrue(tripsKeyInFamily(tripsListKey(TripsParams(vehicleId = 7)), TRIPS_FAMILY))
        assertTrue(tripsKeyInFamily(tripsListKey(TripsParams()), TRIPS_FAMILY))
        assertTrue(tripsKeyInFamily(tripDetailKey("5"), TRIPS_FAMILY))
        // A foreign domain key is NOT a descendant of ['trips'].
        assertFalse(tripsKeyInFamily("drives|7", TRIPS_FAMILY))
        assertFalse(tripsKeyInFamily("trips-archive|1", TRIPS_FAMILY))
    }

    private companion object {
        val QUERY_GOLDEN =
            """
            [
              { "name": "all_absent", "expected": {} },
              { "name": "zero_dropped", "vehicle_id": 0, "limit": 0,
                "expected": {} },
              { "name": "offset_zero_dropped", "offset": 0,
                "expected": {} },
              { "name": "blank_range_dropped", "vehicle_id": 7, "start": "", "end": "",
                "expected": { "vehicle_id": "7" } },
              { "name": "offset_present", "offset": 40,
                "expected": { "offset": "40" } },
              { "name": "full", "vehicle_id": 7, "limit": 20, "offset": 40,
                "start": "2026-01-01", "end": "2026-02-01",
                "expected": { "vehicle_id": "7", "limit": "20", "offset": "40",
                              "start": "2026-01-01", "end": "2026-02-01" } }
            ]
            """.trimIndent()
    }
}
