package io.teslasync.shared.core.presentation.driving

import io.teslasync.shared.core.data.repo.DRIVES_FAMILY
import io.teslasync.shared.core.data.repo.DRIVE_FAMILY
import io.teslasync.shared.core.data.repo.accelerationDistributionKey
import io.teslasync.shared.core.data.repo.driveAnalyticsRangeQuery
import io.teslasync.shared.core.data.repo.driveDetailKey
import io.teslasync.shared.core.data.repo.drivePositionsKey
import io.teslasync.shared.core.data.repo.driveScoreKey
import io.teslasync.shared.core.data.repo.driveTelemetryKey
import io.teslasync.shared.core.data.repo.driveVehicleIdQuery
import io.teslasync.shared.core.data.repo.driveWhyEndedKey
import io.teslasync.shared.core.data.repo.driveWhyEndedQuery
import io.teslasync.shared.core.data.repo.drivesKey
import io.teslasync.shared.core.data.repo.drivetrainHealthKey
import io.teslasync.shared.core.data.repo.drivingCoachKey
import io.teslasync.shared.core.data.repo.drivingCoachQuery
import io.teslasync.shared.core.data.repo.drivingKeyInFamily
import io.teslasync.shared.core.data.repo.geocodeSearchKey
import io.teslasync.shared.core.data.repo.geocodeSearchQuery
import io.teslasync.shared.core.data.repo.regenEfficiencyKey
import io.teslasync.shared.core.data.repo.routeEfficiencyKey
import io.teslasync.shared.core.data.repo.speedProfileKey
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Golden vectors locking the client-side derivations ported from the web `useDriving` domain:
 *
 *  1. The snake_case query builders (the single-`vehicle_id` truthy guard, the analytics
 *     start/end truthy-range guard, the coach `vehicle_id`+`days` pair, the geocode `q`+fixed
 *     `limit=5`, and the why-ended `window`).
 *  2. The cache/feed key builders mirroring the web TanStack query keys (the plural `['drives']`
 *     lists vs the singular `['drive']` detail, the why-ended tuple nested under `['drive']`, the
 *     analytics-range tuples, etc.).
 *  3. [drivingKeyInFamily] — the TanStack prefix-invalidation semantics, including the
 *     singular/plural and `drive`/`drive-*` sibling boundaries that decide exactly which feeds a
 *     bulk-delete (`['drives']` + `['drive']`) refreshes.
 *
 * The vectors are language-neutral (raw JSON in / fixed expectations out) so the Windows C# port
 * and the KMP core load the identical set and cannot drift (ADR-004). The fixtures are inlined to
 * stay within this slice's allowed file scope; the C# port mirrors these exact rows.
 */
class DrivingGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    // ---- vehicle_id truthy guard --------------------------------------------------

    @Serializable
    private data class VehicleRow(
        val name: String,
        @SerialName("vehicle_id") val vehicleId: String? = null,
        val expected: Map<String, String>,
    )

    @Test
    fun vehicleIdQueryMatchesGolden() {
        val rows: List<VehicleRow> = json.decodeFromString(VEHICLE_GOLDEN)
        val names = rows.map { it.name }.toSet()
        listOf("absent", "blank_dropped", "present").forEach { assertTrue(it in names, "vehicle golden missing '$it'") }
        for (row in rows) {
            assertEquals(row.expected, driveVehicleIdQuery(row.vehicleId), "driveVehicleIdQuery('${row.name}')")
        }
    }

    // ---- analytics start/end truthy-range guard -----------------------------------

    @Serializable
    private data class RangeRow(
        val name: String,
        @SerialName("vehicle_id") val vehicleId: String,
        val start: String? = null,
        val end: String? = null,
        val expected: Map<String, String>,
    )

    @Test
    fun analyticsRangeQueryMatchesGolden() {
        val rows: List<RangeRow> = json.decodeFromString(RANGE_GOLDEN)
        val names = rows.map { it.name }.toSet()
        listOf("no_range", "full_range", "blank_range_dropped").forEach {
            assertTrue(it in names, "range golden missing '$it'")
        }
        for (row in rows) {
            assertEquals(
                row.expected,
                driveAnalyticsRangeQuery(row.vehicleId, row.start, row.end),
                "driveAnalyticsRangeQuery('${row.name}')",
            )
        }
    }

    @Test
    fun coachAndGeocodeAndWhyEndedQueriesAreUnconditional() {
        assertEquals(mapOf("vehicle_id" to "7", "days" to "30"), drivingCoachQuery("7", 30))
        assertEquals(mapOf("vehicle_id" to "9", "days" to "7"), drivingCoachQuery("9", 7))
        assertEquals(mapOf("q" to "SFO", "limit" to "5"), geocodeSearchQuery("SFO"))
        assertEquals(mapOf("window" to "60s"), driveWhyEndedQuery("60s"))
        assertEquals(mapOf("window" to "15m"), driveWhyEndedQuery("15m"))
    }

    // ---- Cache/feed keys ----------------------------------------------------------

    @Test
    fun cacheKeysMirrorTheWebQueryKeys() {
        assertEquals("drives|7", drivesKey("7"))
        assertEquals("drive|5", driveDetailKey("5"))
        assertEquals("drive-score|7", driveScoreKey("7"))
        assertEquals("drive-positions|5", drivePositionsKey("5"))
        assertEquals("drive-telemetry|5", driveTelemetryKey("5"))
        assertEquals("drivetrain-health|7", drivetrainHealthKey("7"))
        assertEquals("acceleration-distribution|7", accelerationDistributionKey("7"))
        assertEquals("speed-profile|7|2026-01-01|2026-02-01", speedProfileKey("7", "2026-01-01", "2026-02-01"))
        assertEquals("speed-profile|7||", speedProfileKey("7", null, null))
        assertEquals("regen-efficiency|7||", regenEfficiencyKey("7", null, null))
        assertEquals("route-efficiency|7||", routeEfficiencyKey("7", null, null))
        assertEquals("driving-coach|7|30", drivingCoachKey("7", 30))
        assertEquals("geocode-search|SFO", geocodeSearchKey("SFO"))
        assertEquals("drive|5|why-ended|60s", driveWhyEndedKey("5", "60s"))
    }

    // ---- Family (prefix) invalidation semantics -----------------------------------

    @Test
    fun drivesFamilyMatchesPerVehicleListsOnly() {
        assertTrue(drivingKeyInFamily(drivesKey("7"), DRIVES_FAMILY))
        assertTrue(drivingKeyInFamily(DRIVES_FAMILY, DRIVES_FAMILY))
        // The singular detail and the drive-* siblings are NOT descendants of ['drives'].
        assertFalse(drivingKeyInFamily(driveDetailKey("5"), DRIVES_FAMILY))
        assertFalse(drivingKeyInFamily(driveScoreKey("7"), DRIVES_FAMILY))
        assertFalse(drivingKeyInFamily(drivePositionsKey("5"), DRIVES_FAMILY))
    }

    @Test
    fun driveFamilyMatchesDetailAndWhyEndedButNotPluralOrDriveSiblings() {
        // ['drive'] prefix matches the detail AND the nested why-ended diagnostic …
        assertTrue(drivingKeyInFamily(driveDetailKey("5"), DRIVE_FAMILY))
        assertTrue(drivingKeyInFamily(driveWhyEndedKey("5", "60s"), DRIVE_FAMILY))
        assertTrue(drivingKeyInFamily(DRIVE_FAMILY, DRIVE_FAMILY))
        // … but NOT the plural lists, nor the drive-score/positions/telemetry siblings (the '|'
        // separator boundary keeps 'drive' from matching 'drives' / 'drive-…').
        assertFalse(drivingKeyInFamily(drivesKey("7"), DRIVE_FAMILY))
        assertFalse(drivingKeyInFamily(driveScoreKey("7"), DRIVE_FAMILY))
        assertFalse(drivingKeyInFamily(drivePositionsKey("5"), DRIVE_FAMILY))
        assertFalse(drivingKeyInFamily(driveTelemetryKey("5"), DRIVE_FAMILY))
    }

    private companion object {
        val VEHICLE_GOLDEN =
            """
            [
              { "name": "absent",        "expected": {} },
              { "name": "blank_dropped", "vehicle_id": "", "expected": {} },
              { "name": "present",       "vehicle_id": "7", "expected": { "vehicle_id": "7" } }
            ]
            """.trimIndent()

        val RANGE_GOLDEN =
            """
            [
              { "name": "no_range", "vehicle_id": "7",
                "expected": { "vehicle_id": "7" } },
              { "name": "full_range", "vehicle_id": "7", "start": "2026-01-01", "end": "2026-02-01",
                "expected": { "vehicle_id": "7", "start": "2026-01-01", "end": "2026-02-01" } },
              { "name": "blank_range_dropped", "vehicle_id": "7", "start": "", "end": "",
                "expected": { "vehicle_id": "7" } }
            ]
            """.trimIndent()
    }
}
