package io.teslasync.android.battery.powerflow

import io.teslasync.shared.core.data.repo.Resource
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device coverage for the framework-free PowerFlowDashboardPage model — the decoders, the watt/watt-hour/percent
 * display formatters, the date labels, and the [Resource] projection. Run by the offline `:android:testDebugUnitTest`
 * gate, mirroring the sibling battery-surface model tests.
 */
class PowerFlowDashboardPageModelTest {
    private val json = Json

    @Test
    fun parsesFullLiveSnapshot() {
        val live =
            parsePowerFlowLive(
                json.parseToJsonElement(
                    """
                    {"id":7,"solar_power":3200.0,"battery_power":-1500.0,"load_power":1700.0,"grid_power":-400.0,
                     "grid_services_power":0.0,"energy_left":12000.0,"total_pack_energy":13500.0,
                     "percentage_charged":88.9,"grid_status":"Active","backup_capable":true,
                     "storm_mode_active":false,"timestamp":"2024-03-10T14:30:00Z"}
                    """.trimIndent(),
                ),
            )
        assertTrue(live.hasData)
        assertEquals(7L, live.id)
        assertEquals(3200.0, live.solarPowerW!!, 0.0)
        assertEquals(-1500.0, live.batteryPowerW!!, 0.0)
        assertEquals(12000.0, live.energyLeftWh!!, 0.0)
        assertEquals("Active", live.gridStatus)
        assertTrue(live.backupCapable)
        assertFalse(live.stormModeActive)
        assertEquals("2024-03-10T14:30:00Z", live.timestamp)
    }

    @Test
    fun liveWithoutIdHasNoData() {
        val live = parsePowerFlowLive(json.parseToJsonElement("""{"message":"no live status available"}"""))
        assertFalse(live.hasData)
        assertNull(live.id)
    }

    @Test
    fun liveNullPayloadIsEmpty() {
        assertFalse(parsePowerFlowLive(null).hasData)
    }

    @Test
    fun parsesAndSortsHistoryAscending() {
        val samples =
            parsePowerFlowHistory(
                json.parseToJsonElement(
                    """
                    [{"timestamp":"2024-03-10T12:00:00Z","solar_power":100.0,"battery_power":0.0,"grid_power":0.0,
                      "load_power":50.0,"percentage_charged":60.0},
                     {"timestamp":"2024-03-10T08:00:00Z","solar_power":0.0,"battery_power":-200.0,"grid_power":300.0,
                      "load_power":80.0,"percentage_charged":55.0}]
                    """.trimIndent(),
                ),
            )
        assertEquals(2, samples.size)
        assertEquals("2024-03-10T08:00:00Z", samples.first().timestamp)
        assertEquals(55.0, samples.first().socPct, 0.0)
        assertEquals(300.0, samples.first().gridW, 0.0)
    }

    @Test
    fun historyNonArrayOrNullIsEmpty() {
        assertTrue(parsePowerFlowHistory(json.parseToJsonElement("""{"x":1}""")).isEmpty())
        assertTrue(parsePowerFlowHistory(null).isEmpty())
    }

    @Test
    fun formatsWattsWithMagnitudeScaling() {
        assertEquals("\u2014", formatWatts(null, Locale.US))
        assertEquals("850 W", formatWatts(850.0, Locale.US))
        assertEquals("1.5 kW", formatWatts(1500.0, Locale.US))
        assertEquals("-1.5 kW", formatWatts(-1500.0, Locale.US))
    }

    @Test
    fun formatsWattHoursWithMagnitudeScaling() {
        assertEquals("\u2014", formatWattHours(null, Locale.US))
        assertEquals("500 Wh", formatWattHours(500.0, Locale.US))
        assertEquals("2.5 kWh", formatWattHours(2500.0, Locale.US))
    }

    @Test
    fun formatsPercent() {
        assertEquals("\u2014", formatPercent(null, Locale.US))
        assertEquals("87.5%", formatPercent(87.5, Locale.US))
    }

    @Test
    fun buildsShortAndDateTimeLabels() {
        assertEquals("03/10", shortDateLabel("2024-03-10T14:30:00Z"))
        assertEquals("2024-03-10 14:30", dateTimeLabel("2024-03-10T14:30:00Z"))
    }

    @Test
    fun mapDataTransformsCachedAndFreshValues() {
        val success: Resource<Int> = Resource.Success(2, 1L, false)
        assertEquals(4, success.mapData { it * 2 }.cached)
        val loading: Resource<Int> = Resource.Loading(3, 1L, false)
        assertEquals(6, loading.mapData { it * 2 }.cached)
    }
}
