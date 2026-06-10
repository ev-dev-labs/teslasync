package io.teslasync.shared.core.presentation.charging

import io.teslasync.shared.core.data.repo.CHARGE_PLANS_FAMILY
import io.teslasync.shared.core.data.repo.CHARGING_SESSIONS_FAMILY
import io.teslasync.shared.core.data.repo.ChargingRepository
import io.teslasync.shared.core.data.repo.TESLA_CHARGING_HISTORY_FAMILY
import io.teslasync.shared.core.data.repo.TESLA_CHARGING_SESSIONS_FAMILY
import io.teslasync.shared.core.data.repo.chargePlansKey
import io.teslasync.shared.core.data.repo.chargeTelemetryKey
import io.teslasync.shared.core.data.repo.chargingKeyInFamily
import io.teslasync.shared.core.data.repo.chargingOptimizerKey
import io.teslasync.shared.core.data.repo.chargingPaginatedKey
import io.teslasync.shared.core.data.repo.chargingPaginatedQuery
import io.teslasync.shared.core.data.repo.chargingSessionByIdKey
import io.teslasync.shared.core.data.repo.chargingSessionDetailKey
import io.teslasync.shared.core.data.repo.chargingSessionsKey
import io.teslasync.shared.core.data.repo.costForecastKey
import io.teslasync.shared.core.data.repo.costForecastQuery
import io.teslasync.shared.core.data.repo.ratePlansKey
import io.teslasync.shared.core.data.repo.teslaChargingHistoryKey
import io.teslasync.shared.core.data.repo.teslaChargingSessionsKey
import io.teslasync.shared.core.data.repo.teslaHistoryRefreshQuery
import io.teslasync.shared.core.data.repo.teslaSessionsRefreshQuery
import io.teslasync.shared.core.data.repo.teslaVinQuery
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Golden vectors locking the client-side derivations ported from the web `useCharging` domain:
 *
 *  1. The snake_case query builders (paginated truthy-range guard, cost-forecast, the Tesla
 *     `vin`-only GET and the two refresh `URLSearchParams` truthy guards).
 *  2. The cache/feed key builders mirroring the web TanStack query keys (the `['charging-sessions']`
 *     plural family vs the singular `['charging-session']` detail, the paginated tuple, etc.).
 *  3. [chargingKeyInFamily] — the TanStack prefix-invalidation semantics, including the
 *     plural/singular boundary that keeps a bulk-delete from touching the numeric session detail.
 *
 * The vectors are language-neutral (raw JSON in / fixed expectations out) so the Windows C# port
 * and the KMP core load the identical set and cannot drift (ADR-004). The fixtures are inlined to
 * stay within this slice's allowed file scope; the C# port mirrors these exact rows.
 */
class ChargingGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    // ---- Paginated query ----------------------------------------------------------

    @Serializable
    private data class PaginatedRow(
        val name: String,
        @SerialName("vehicle_id") val vehicleId: Long,
        val limit: Int,
        val offset: Int,
        val start: String? = null,
        val end: String? = null,
        val expected: Map<String, String>,
    )

    @Test
    fun paginatedQueryMatchesGolden() {
        val rows: List<PaginatedRow> = json.decodeFromString(PAGINATED_GOLDEN)
        val names = rows.map { it.name }.toSet()
        listOf("no_range", "full_range", "blank_range_dropped").forEach {
            assertTrue(it in names, "paginated golden missing '$it'")
        }
        for (row in rows) {
            assertEquals(
                row.expected,
                chargingPaginatedQuery(row.vehicleId, row.limit, row.offset, row.start, row.end),
                "chargingPaginatedQuery('${row.name}')",
            )
        }
    }

    @Test
    fun costForecastQueryAlwaysSendsBothKeys() {
        assertEquals(mapOf("vehicle_id" to "7", "months" to "6"), costForecastQuery("7", 6))
        assertEquals(mapOf("vehicle_id" to "9", "months" to "12"), costForecastQuery("9", 12))
    }

    // ---- Tesla query guards -------------------------------------------------------

    @Serializable
    private data class VinRow(
        val name: String,
        val vin: String? = null,
        val expected: Map<String, String>,
    )

    @Test
    fun teslaVinQueryMatchesGolden() {
        val rows: List<VinRow> = json.decodeFromString(VIN_GOLDEN)
        val names = rows.map { it.name }.toSet()
        listOf("absent", "blank_dropped", "present").forEach { assertTrue(it in names, "vin golden missing '$it'") }
        for (row in rows) {
            assertEquals(row.expected, teslaVinQuery(row.vin), "teslaVinQuery('${row.name}')")
        }
    }

    @Serializable
    private data class RefreshRow(
        val name: String,
        val vin: String? = null,
        val a: String? = null,
        val b: String? = null,
        val expected: Map<String, String>,
    )

    @Test
    fun teslaHistoryRefreshQueryMatchesGolden() {
        val rows: List<RefreshRow> = json.decodeFromString(HISTORY_REFRESH_GOLDEN)
        val names = rows.map { it.name }.toSet()
        listOf("empty", "all", "vin_only", "blank_dropped").forEach {
            assertTrue(it in names, "history-refresh golden missing '$it'")
        }
        for (row in rows) {
            assertEquals(
                row.expected,
                teslaHistoryRefreshQuery(row.vin, row.a, row.b),
                "teslaHistoryRefreshQuery('${row.name}')",
            )
        }
    }

    @Test
    fun teslaSessionsRefreshQueryUsesDateFromDateTo() {
        assertEquals(emptyMap<String, String>(), teslaSessionsRefreshQuery(null, null, null))
        assertEquals(
            mapOf("vin" to "VIN1", "date_from" to "2026-02-01", "date_to" to "2026-03-01"),
            teslaSessionsRefreshQuery("VIN1", "2026-02-01", "2026-03-01"),
        )
        // Blank fields are dropped (truthy guard parity).
        assertEquals(mapOf("date_from" to "2026-02-01"), teslaSessionsRefreshQuery("", "2026-02-01", ""))
    }

    // ---- Cache/feed keys ----------------------------------------------------------

    @Test
    fun cacheKeysMirrorTheWebQueryKeys() {
        assertEquals("charging-sessions|vehicle|7", chargingSessionsKey(7))
        assertEquals("charging-sessions|5", chargingSessionDetailKey("5"))
        assertEquals("charging-session|5", chargingSessionByIdKey(5))
        assertEquals("charge-telemetry|5", chargeTelemetryKey(5))
        assertEquals(
            "charging|7|2026-01-01|2026-02-01|25|50",
            chargingPaginatedKey(7, "2026-01-01", "2026-02-01", 25, 50),
        )
        assertEquals("charging|7|||50|0", chargingPaginatedKey(7, null, null, ChargingRepository.DEFAULT_LIMIT, 0))
        assertEquals("cost-forecast|7|6", costForecastKey("7", 6))
        assertEquals("charging-optimizer|7", chargingOptimizerKey("7"))
        assertEquals("tesla-charging-history", teslaChargingHistoryKey(null))
        assertEquals("tesla-charging-history", teslaChargingHistoryKey(""))
        assertEquals("tesla-charging-history|VIN1", teslaChargingHistoryKey("VIN1"))
        assertEquals("tesla-charging-sessions", teslaChargingSessionsKey(null))
        assertEquals("tesla-charging-sessions|VIN1", teslaChargingSessionsKey("VIN1"))
        assertEquals("charge-plans|7", chargePlansKey(7))
        assertEquals("charge-planner-rate-plans", ratePlansKey())
    }

    // ---- Family (prefix) invalidation semantics -----------------------------------

    @Test
    fun chargingSessionsFamilyMatchesByVehicleAndStringDetailButNotSingularNumericDetail() {
        assertTrue(chargingKeyInFamily(chargingSessionsKey(7), CHARGING_SESSIONS_FAMILY))
        assertTrue(chargingKeyInFamily(chargingSessionDetailKey("5"), CHARGING_SESSIONS_FAMILY))
        assertTrue(chargingKeyInFamily(CHARGING_SESSIONS_FAMILY, CHARGING_SESSIONS_FAMILY))
        // Singular detail and paginated are NOT descendants of ['charging-sessions'].
        assertFalse(chargingKeyInFamily(chargingSessionByIdKey(9), CHARGING_SESSIONS_FAMILY))
        assertFalse(chargingKeyInFamily(chargingPaginatedKey(7, null, null, 50, 0), CHARGING_SESSIONS_FAMILY))
    }

    @Test
    fun chargePlansFamilyExcludesTheSiblingRatePlansKey() {
        assertTrue(chargingKeyInFamily(chargePlansKey(7), CHARGE_PLANS_FAMILY))
        // 'charge-planner-rate-plans' is a sibling, not a descendant of 'charge-plans'.
        assertFalse(chargingKeyInFamily(ratePlansKey(), CHARGE_PLANS_FAMILY))
    }

    @Test
    fun teslaFamiliesMatchAllAndByVinOnly() {
        assertTrue(chargingKeyInFamily(teslaChargingHistoryKey(null), TESLA_CHARGING_HISTORY_FAMILY))
        assertTrue(chargingKeyInFamily(teslaChargingHistoryKey("VIN1"), TESLA_CHARGING_HISTORY_FAMILY))
        assertFalse(chargingKeyInFamily(teslaChargingSessionsKey(null), TESLA_CHARGING_HISTORY_FAMILY))
        assertTrue(chargingKeyInFamily(teslaChargingSessionsKey("VIN1"), TESLA_CHARGING_SESSIONS_FAMILY))
    }

    private companion object {
        val PAGINATED_GOLDEN =
            """
            [
              { "name": "no_range", "vehicle_id": 7, "limit": 50, "offset": 0,
                "expected": { "vehicle_id": "7", "limit": "50", "offset": "0" } },
              { "name": "full_range", "vehicle_id": 7, "limit": 25, "offset": 50,
                "start": "2026-01-01", "end": "2026-02-01",
                "expected": { "vehicle_id": "7", "limit": "25", "offset": "50",
                              "start": "2026-01-01", "end": "2026-02-01" } },
              { "name": "blank_range_dropped", "vehicle_id": 7, "limit": 50, "offset": 0,
                "start": "", "end": "",
                "expected": { "vehicle_id": "7", "limit": "50", "offset": "0" } }
            ]
            """.trimIndent()

        val VIN_GOLDEN =
            """
            [
              { "name": "absent",        "expected": {} },
              { "name": "blank_dropped", "vin": "", "expected": {} },
              { "name": "present",       "vin": "VIN1", "expected": { "vin": "VIN1" } }
            ]
            """.trimIndent()

        val HISTORY_REFRESH_GOLDEN =
            """
            [
              { "name": "empty",         "expected": {} },
              { "name": "all",           "vin": "VIN1", "a": "2026-01-01", "b": "2026-02-01",
                "expected": { "vin": "VIN1", "start_time": "2026-01-01", "end_time": "2026-02-01" } },
              { "name": "vin_only",      "vin": "VIN1",
                "expected": { "vin": "VIN1" } },
              { "name": "blank_dropped", "vin": "", "a": "2026-01-01", "b": "",
                "expected": { "start_time": "2026-01-01" } }
            ]
            """.trimIndent()
    }
}
