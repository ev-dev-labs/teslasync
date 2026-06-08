package io.teslasync.shared.core.presentation.energy

import io.teslasync.shared.core.data.repo.TESLA_BACKUP_HISTORY_FAMILY
import io.teslasync.shared.core.data.repo.TESLA_ENERGY_HISTORY_FAMILY
import io.teslasync.shared.core.data.repo.TESLA_ENERGY_SITES_FAMILY
import io.teslasync.shared.core.data.repo.TESLA_LIVE_STATUS_FAMILY
import io.teslasync.shared.core.data.repo.TESLA_LIVE_STATUS_HISTORY_FAMILY
import io.teslasync.shared.core.data.repo.TESLA_SITE_INFO_FAMILY
import io.teslasync.shared.core.data.repo.TESLA_WC_CHARGING_HISTORY_FAMILY
import io.teslasync.shared.core.data.repo.batteryHealthKey
import io.teslasync.shared.core.data.repo.batteryHealthQuery
import io.teslasync.shared.core.data.repo.energyKeyInFamily
import io.teslasync.shared.core.data.repo.energyStatsKey
import io.teslasync.shared.core.data.repo.energyStatsQuery
import io.teslasync.shared.core.data.repo.energyVehicleIdQuery
import io.teslasync.shared.core.data.repo.sleepEfficiencyKey
import io.teslasync.shared.core.data.repo.sleepEfficiencyQuery
import io.teslasync.shared.core.data.repo.teslaBackupHistoryKey
import io.teslasync.shared.core.data.repo.teslaEnergyHistoryKey
import io.teslasync.shared.core.data.repo.teslaEnergyHistoryQuery
import io.teslasync.shared.core.data.repo.teslaEnergySitesKey
import io.teslasync.shared.core.data.repo.teslaHistoryRefreshQuery
import io.teslasync.shared.core.data.repo.teslaLiveStatusHistoryKey
import io.teslasync.shared.core.data.repo.teslaLiveStatusHistoryQuery
import io.teslasync.shared.core.data.repo.teslaLiveStatusKey
import io.teslasync.shared.core.data.repo.teslaSiteInfoKey
import io.teslasync.shared.core.data.repo.teslaWcChargingHistoryKey
import io.teslasync.shared.core.data.repo.teslaWcChargingRefreshQuery
import io.teslasync.shared.core.data.repo.teslaWindowQuery
import io.teslasync.shared.core.data.repo.vampireDrainEventsKey
import io.teslasync.shared.core.data.repo.vampireDrainEventsQuery
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Golden vectors locking the client-side derivations ported from the web `useEnergy` domain:
 *
 *  1. The snake_case query builders (the battery-health `as_of` ternary guard, the sleep-efficiency
 *     paired start/end guard, the Tesla energy-history `since`/`until` truthy guards, the
 *     live-status-history `limit` `0`-is-falsy guard, and the two refresh `URLSearchParams` —
 *     energy/backup WITH `period`, Wall-Connector WITHOUT).
 *  2. The cache/feed key builders mirroring the web TanStack query keys (the live vs as-of
 *     battery-health key, the sleep-efficiency tuple, the Tesla site/history/live-status tuples).
 *  3. [energyKeyInFamily] — the TanStack prefix-invalidation semantics, including the boundary that
 *     keeps `tesla-live-status` from matching the `tesla-live-status-history` siblings and a
 *     per-site `tesla-site-info|{id}` refresh from touching another site.
 *
 * The vectors are language-neutral (raw JSON in / fixed expectations out) so the Windows C# port
 * and the KMP core load the identical set and cannot drift (ADR-004). The fixtures are inlined to
 * stay within this slice's allowed file scope; the C# port mirrors these exact rows.
 */
class EnergyGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    // ---- as_of ternary guard ------------------------------------------------------

    @Serializable
    private data class AsOfRow(
        val name: String,
        val asOf: String? = null,
        val expected: Map<String, String>,
    )

    @Test
    fun batteryHealthQueryMatchesGolden() {
        val rows: List<AsOfRow> = json.decodeFromString(AS_OF_GOLDEN)
        val names = rows.map { it.name }.toSet()
        listOf("absent", "blank_dropped", "present").forEach { assertTrue(it in names, "as_of golden missing '$it'") }
        for (row in rows) {
            assertEquals(row.expected, batteryHealthQuery(row.asOf), "batteryHealthQuery('${row.name}')")
        }
    }

    @Test
    fun energyStatsAndVehicleIdQueriesAlwaysSendTheirKeys() {
        assertEquals(mapOf("days" to "30"), energyStatsQuery(30))
        assertEquals(mapOf("days" to "7"), energyStatsQuery(7))
        assertEquals(mapOf("vehicle_id" to "7"), energyVehicleIdQuery("7"))
        assertEquals(mapOf("vehicle_id" to "7", "limit" to "50"), vampireDrainEventsQuery("7", 50))
    }

    // ---- sleep-efficiency paired range guard --------------------------------------

    @Serializable
    private data class SleepRow(
        val name: String,
        val days: Int,
        val start: String? = null,
        val end: String? = null,
        val expected: Map<String, String>,
    )

    @Test
    fun sleepEfficiencyQueryMatchesGolden() {
        val rows: List<SleepRow> = json.decodeFromString(SLEEP_GOLDEN)
        val names = rows.map { it.name }.toSet()
        listOf("no_range", "full_range", "half_range_dropped").forEach {
            assertTrue(it in names, "sleep golden missing '$it'")
        }
        for (row in rows) {
            assertEquals(
                row.expected,
                sleepEfficiencyQuery("7", row.days, row.start, row.end),
                "sleepEfficiencyQuery('${row.name}')",
            )
        }
    }

    // ---- Tesla read window guards -------------------------------------------------

    @Test
    fun teslaEnergyHistoryQueryAlwaysKeepsPeriodAndDropsBlankWindow() {
        assertEquals(mapOf("period" to "day"), teslaEnergyHistoryQuery("day", null, null))
        assertEquals(mapOf("period" to "day"), teslaEnergyHistoryQuery("day", "", ""))
        assertEquals(
            mapOf("period" to "week", "since" to "2026-01-01", "until" to "2026-02-01"),
            teslaEnergyHistoryQuery("week", "2026-01-01", "2026-02-01"),
        )
    }

    @Test
    fun teslaWindowQueryDropsBlanks() {
        assertEquals(emptyMap<String, String>(), teslaWindowQuery(null, null))
        assertEquals(mapOf("since" to "2026-01-01"), teslaWindowQuery("2026-01-01", ""))
        assertEquals(
            mapOf("since" to "2026-01-01", "until" to "2026-02-01"),
            teslaWindowQuery("2026-01-01", "2026-02-01"),
        )
    }

    @Test
    fun teslaLiveStatusHistoryQueryTreatsZeroLimitAsFalsy() {
        assertEquals(emptyMap<String, String>(), teslaLiveStatusHistoryQuery(null, null, null))
        // limit == 0 is falsy in the web `if (limit)` guard → dropped.
        assertEquals(emptyMap<String, String>(), teslaLiveStatusHistoryQuery(null, null, 0))
        assertEquals(mapOf("limit" to "100"), teslaLiveStatusHistoryQuery(null, null, 100))
        assertEquals(
            mapOf("since" to "2026-01-01", "until" to "2026-02-01", "limit" to "50"),
            teslaLiveStatusHistoryQuery("2026-01-01", "2026-02-01", 50),
        )
    }

    // ---- Tesla refresh query guards (period present vs absent) ---------------------

    @Serializable
    private data class RefreshRow(
        val name: String,
        val period: String? = null,
        val start: String? = null,
        val end: String? = null,
        val tz: String? = null,
        val expected: Map<String, String>,
    )

    @Test
    fun teslaHistoryRefreshQueryMatchesGolden() {
        val rows: List<RefreshRow> = json.decodeFromString(HISTORY_REFRESH_GOLDEN)
        val names = rows.map { it.name }.toSet()
        listOf("period_only", "all", "blank_dropped").forEach {
            assertTrue(it in names, "history-refresh golden missing '$it'")
        }
        for (row in rows) {
            assertEquals(
                row.expected,
                teslaHistoryRefreshQuery(row.period ?: "day", row.start, row.end, row.tz),
                "teslaHistoryRefreshQuery('${row.name}')",
            )
        }
    }

    @Test
    fun wcChargingRefreshQueryHasNoPeriod() {
        assertEquals(emptyMap<String, String>(), teslaWcChargingRefreshQuery(null, null, null))
        assertEquals(
            mapOf("start_date" to "2026-01-01", "end_date" to "2026-02-01", "time_zone" to "UTC"),
            teslaWcChargingRefreshQuery("2026-01-01", "2026-02-01", "UTC"),
        )
        // No `period` key is ever emitted (unlike the energy/backup refreshes).
        assertFalse("period" in teslaWcChargingRefreshQuery("2026-01-01", null, null))
    }

    // ---- Cache/feed keys ----------------------------------------------------------

    @Test
    fun cacheKeysMirrorTheWebQueryKeys() {
        assertEquals("energy-stats|7|30", energyStatsKey("7", 30))
        assertEquals("battery-health|7", batteryHealthKey("7", null))
        assertEquals("battery-health|7", batteryHealthKey("7", ""))
        assertEquals("battery-health|7|2026-01-01T00:00:00Z", batteryHealthKey("7", "2026-01-01T00:00:00Z"))
        assertEquals("vampire-drain-events|7|50", vampireDrainEventsKey("7", 50))
        assertEquals("sleep-efficiency|7|30||", sleepEfficiencyKey("7", 30, null, null))
        assertEquals("sleep-efficiency|7|30|2026-01-01|2026-02-01", sleepEfficiencyKey("7", 30, "2026-01-01", "2026-02-01"))
        assertEquals("tesla-energy-sites", teslaEnergySitesKey())
        assertEquals("tesla-site-info|5", teslaSiteInfoKey(5))
        assertEquals("tesla-energy-history|5|day||", teslaEnergyHistoryKey(5, "day", null, null))
        assertEquals("tesla-backup-history|5||", teslaBackupHistoryKey(5, null, null))
        assertEquals("tesla-wc-charging-history|5||", teslaWcChargingHistoryKey(5, null, null))
        assertEquals("tesla-live-status|5", teslaLiveStatusKey(5))
        assertEquals("tesla-live-status-history|5|||", teslaLiveStatusHistoryKey(5, null, null, null))
        assertEquals("tesla-live-status-history|5|2026-01-01||100", teslaLiveStatusHistoryKey(5, "2026-01-01", null, 100))
    }

    // ---- Family (prefix) invalidation semantics -----------------------------------

    @Test
    fun sitesFamilyExcludesSiblingSiteInfo() {
        assertTrue(energyKeyInFamily(teslaEnergySitesKey(), TESLA_ENERGY_SITES_FAMILY))
        // 'tesla-site-info|5' is a sibling, not a descendant of 'tesla-energy-sites'.
        assertFalse(energyKeyInFamily(teslaSiteInfoKey(5), TESLA_ENERGY_SITES_FAMILY))
    }

    @Test
    fun perSiteInfoRefreshMatchesOnlyThatSite() {
        assertTrue(energyKeyInFamily(teslaSiteInfoKey(5), teslaSiteInfoKey(5)))
        assertFalse(energyKeyInFamily(teslaSiteInfoKey(9), teslaSiteInfoKey(5)))
        // The whole-family head still matches every site (used by no mutation here, but proven safe).
        assertTrue(energyKeyInFamily(teslaSiteInfoKey(5), TESLA_SITE_INFO_FAMILY))
        assertTrue(energyKeyInFamily(teslaSiteInfoKey(9), TESLA_SITE_INFO_FAMILY))
    }

    @Test
    fun liveStatusFamilyDoesNotMatchTheHistorySiblings() {
        assertTrue(energyKeyInFamily(teslaLiveStatusKey(5), TESLA_LIVE_STATUS_FAMILY))
        // The crucial boundary: 'tesla-live-status' must NOT match 'tesla-live-status-history|…'.
        assertFalse(energyKeyInFamily(teslaLiveStatusHistoryKey(5, null, null, null), TESLA_LIVE_STATUS_FAMILY))
        assertTrue(energyKeyInFamily(teslaLiveStatusHistoryKey(5, null, null, null), TESLA_LIVE_STATUS_HISTORY_FAMILY))
        assertFalse(energyKeyInFamily(teslaLiveStatusKey(5), TESLA_LIVE_STATUS_HISTORY_FAMILY))
    }

    @Test
    fun historyFamiliesAreMutuallyExclusive() {
        assertTrue(energyKeyInFamily(teslaEnergyHistoryKey(5, "day", null, null), TESLA_ENERGY_HISTORY_FAMILY))
        assertTrue(energyKeyInFamily(teslaBackupHistoryKey(5, null, null), TESLA_BACKUP_HISTORY_FAMILY))
        assertTrue(energyKeyInFamily(teslaWcChargingHistoryKey(5, null, null), TESLA_WC_CHARGING_HISTORY_FAMILY))
        assertFalse(energyKeyInFamily(teslaBackupHistoryKey(5, null, null), TESLA_ENERGY_HISTORY_FAMILY))
        assertFalse(energyKeyInFamily(teslaWcChargingHistoryKey(5, null, null), TESLA_BACKUP_HISTORY_FAMILY))
    }

    private companion object {
        val AS_OF_GOLDEN =
            """
            [
              { "name": "absent",        "expected": {} },
              { "name": "blank_dropped", "asOf": "", "expected": {} },
              { "name": "present",       "asOf": "2026-01-01T00:00:00Z",
                "expected": { "as_of": "2026-01-01T00:00:00Z" } }
            ]
            """.trimIndent()

        val SLEEP_GOLDEN =
            """
            [
              { "name": "no_range", "days": 30,
                "expected": { "vehicle_id": "7", "days": "30" } },
              { "name": "full_range", "days": 30, "start": "2026-01-01", "end": "2026-02-01",
                "expected": { "vehicle_id": "7", "days": "30",
                              "start": "2026-01-01", "end": "2026-02-01" } },
              { "name": "half_range_dropped", "days": 14, "start": "2026-01-01",
                "expected": { "vehicle_id": "7", "days": "14" } }
            ]
            """.trimIndent()

        val HISTORY_REFRESH_GOLDEN =
            """
            [
              { "name": "period_only", "period": "day",
                "expected": { "period": "day" } },
              { "name": "all", "period": "week", "start": "2026-01-01", "end": "2026-02-01", "tz": "UTC",
                "expected": { "period": "week", "start_date": "2026-01-01",
                              "end_date": "2026-02-01", "time_zone": "UTC" } },
              { "name": "blank_dropped", "period": "day", "start": "", "end": "2026-02-01", "tz": "",
                "expected": { "period": "day", "end_date": "2026-02-01" } }
            ]
            """.trimIndent()
    }
}
