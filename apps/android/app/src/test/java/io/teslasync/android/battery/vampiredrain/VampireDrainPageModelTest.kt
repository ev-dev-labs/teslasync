// JVM unit tests for the framework-free VampireDrainPage model (VampireDrainPageModel.kt) — the decode of the
// `/vampire-drain/stats` envelope, the drain-score / loss-% tier thresholds, the sessions sort, the display formatters,
// and the navigation/diagnostics identity. No Compose / Android types are touched, so this runs in the
// `:app:testDebugUnitTest` gate, mirroring the off-device coverage the sibling battery surfaces rely on.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.battery.vampiredrain

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class VampireDrainPageModelTest {
    private val prefs = VampireDisplayPrefs(locale = Locale.US)

    private val sampleJson =
        """
        {
          "avg_drain_rate": 1.234,
          "total_energy_lost": 12.5,
          "worst_drain_pct": 6.7,
          "drain_score": 82,
          "entries": [
            {
              "id": 1, "vehicle_id": 7, "date": "2026-01-02T10:00:00Z",
              "start_battery": 80, "end_battery": 74, "drain_pct": 6.0,
              "drain_rate_pct_hr": 0.5, "duration_hours": 12.0, "energy_lost_kwh": 3.2,
              "sentry_active": true
            },
            {
              "id": 2, "vehicle_id": 7, "date": "2026-01-01T10:00:00Z",
              "start_battery": 70, "end_battery": 68, "drain_pct": 2.0,
              "drain_rate_pct_hr": 0.1, "duration_hours": 8.0, "energy_lost_kwh": 1.1,
              "sentry_active": false
            }
          ],
          "daily": [
            { "date": "2026-01-01", "drain_pct": 2.0, "hours_parked": 8.0 },
            { "date": "2026-01-02", "drain_pct": 6.0, "hours_parked": 12.0 }
          ]
        }
        """.trimIndent()

    @Test
    fun parsesEveryScalarArrayAndScalarFallback() {
        val stats = parseVampireStats(Json.parseToJsonElement(sampleJson))
        assertEquals(1.234, stats.avgDrainRate, EPSILON)
        assertEquals(12.5, stats.totalEnergyLost, EPSILON)
        assertEquals(6.7, stats.worstDrainPct, EPSILON)
        assertEquals(82.0, stats.drainScore, EPSILON)
        assertEquals(2, stats.entries.size)
        assertEquals(2, stats.daily.size)
        assertEquals(1L, stats.entries.first().id)
        assertTrue(stats.entries.first().sentryActive)
        assertEquals(8.0, stats.daily.first().hoursParked, EPSILON)
        assertTrue(stats.hasData)
    }

    @Test
    fun nullOrNonObjectPayloadIsEmptyStats() {
        assertEquals(VampireDrainStats.EMPTY, parseVampireStats(null))
        assertEquals(VampireDrainStats.EMPTY, parseVampireStats(Json.parseToJsonElement("[]")))
        assertFalse(VampireDrainStats.EMPTY.hasData)
    }

    @Test
    fun entriesAndDailyMissingDateAreSkipped() {
        val json =
            """
            { "entries": [ { "id": 9, "drain_pct": 3.0 } ], "daily": [ { "drain_pct": 1.0 } ] }
            """.trimIndent()
        val stats = parseVampireStats(Json.parseToJsonElement(json))
        assertTrue(stats.entries.isEmpty())
        assertTrue(stats.daily.isEmpty())
    }

    @Test
    fun drainScoreTierMatchesWebThresholds() {
        assertEquals(DrainScoreTier.Good, drainScoreTier(80.0))
        assertEquals(DrainScoreTier.Good, drainScoreTier(99.0))
        assertEquals(DrainScoreTier.Fair, drainScoreTier(50.0))
        assertEquals(DrainScoreTier.Fair, drainScoreTier(79.9))
        assertEquals(DrainScoreTier.Poor, drainScoreTier(49.9))
        assertEquals(DrainScoreTier.Poor, drainScoreTier(0.0))
    }

    @Test
    fun drainLossTierMatchesWebThresholds() {
        assertEquals(DrainLossTier.High, drainLossTier(5.1))
        assertEquals(DrainLossTier.Medium, drainLossTier(5.0))
        assertEquals(DrainLossTier.Medium, drainLossTier(2.1))
        assertEquals(DrainLossTier.Low, drainLossTier(2.0))
        assertEquals(DrainLossTier.Low, drainLossTier(0.0))
    }

    @Test
    fun sortByLossDescendingThenAscending() {
        val stats = parseVampireStats(Json.parseToJsonElement(sampleJson))
        val desc = sortVampireEntries(stats.entries, VampireSortKey.LOSS, descending = true)
        assertEquals(listOf(6.0, 2.0), desc.map { it.drainPct })
        val asc = sortVampireEntries(stats.entries, VampireSortKey.LOSS, descending = false)
        assertEquals(listOf(2.0, 6.0), asc.map { it.drainPct })
    }

    @Test
    fun sortWithUnknownKeyLeavesOrderUntouched() {
        val stats = parseVampireStats(Json.parseToJsonElement(sampleJson))
        val same = sortVampireEntries(stats.entries, "nope", descending = true)
        assertEquals(stats.entries.map { it.id }, same.map { it.id })
    }

    @Test
    fun displayFormattersMirrorTheWebSuffixes() {
        assertEquals("1.23%/hr", prefs.rate(1.234))
        assertEquals("12.5 kWh", prefs.energyKwh(12.5))
        assertEquals("6.7%", prefs.percent1(6.7))
        assertEquals("80%", prefs.percent0(80.0))
        assertEquals("82/100", prefs.score(82.0))
        assertEquals("12.0h", prefs.durationHours(12.0))
        assertEquals("0.50", prefs.number2(0.5))
    }

    @Test
    fun dateTimeIsEmDashForBlankOrUnparseable() {
        assertEquals("\u2014", prefs.dateTime(null))
        assertEquals("\u2014", prefs.dateTime(""))
        assertEquals("\u2014", prefs.dateTime("not-a-date"))
    }

    @Test
    fun registrationIdentityMatchesNavigationDestination() {
        assertEquals("vampireDrain", VampireDrainPageRegistration.ROUTE_ID)
        assertEquals("/vampire-drain", VampireDrainPageRegistration.WEB_PATH)
        assertEquals("VampireDrainPage", VampireDrainPageRegistration.SLUG)
    }

    private companion object {
        const val EPSILON = 1e-6
    }
}
