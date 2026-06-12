package io.teslasync.android.featureviews.telemetrygrid

import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.data.UnitPreferences
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the TelemetryGrid's pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/vehicles/components/telemetry-panels/TelemetryGrid.tsx): the six tiles
 * in source order, the `fmtInt`/`fmtNumber` figures (`battery_level%`, `charger_power kW`,
 * `time_to_full_charge h`), the `useUnits` delegations (rated range, speed, inside/outside temperature,
 * odometer), the battery `> 50` / `> 20` accent thresholds, the `speed > 0 ? Driving : Parked`, the
 * `is_charging` and `sentry_mode` branches, and the `state ? grid : empty` conditional. Because the surface
 * is purely presentational, each [TelemetryGridDisplay] is exactly what the thin composable renders, so these
 * assertions double as the per-state "snapshot". The final case is the data-adapter path: decode a cached
 * `/vehicles/{vehicleID}/state` payload (snake_case, extra columns) and project it.
 *
 * The unit-formatted fields are asserted against the injected [UnitFormatter] directly (proving the projection
 * wires the right field to the right formatter with the right precision) plus an imperial cross-check (proving
 * the preference is actually applied), rather than re-pinning the shared formatter's golden decimals — those
 * are covered by the shared :core unit-golden suite.
 */
class TelemetryGridProjectionTest {
    private val metric = UnitFormatter.default()
    private val lenientJson = Json { ignoreUnknownKeys = true }

    private fun imperial(): UnitFormatter =
        UnitFormatter(
            UnitPreferences.fromSettings(
                buildJsonObject {
                    put("unit_of_length", "mi")
                    put("unit_of_temp", "F")
                },
            ),
        )

    private val sampleState =
        VehicleStateTelemetry(
            batteryLevel = 84.0,
            ratedRangeMeters = 350_000.0,
            speedMps = 0.0,
            insideTempCelsius = 21.0,
            outsideTempCelsius = 14.0,
            odometerMeters = 19_874_000.0,
            isCharging = true,
            chargerPowerKw = 11.0,
            timeToFullChargeHours = 1.5,
            sentryMode = true,
        )

    private fun TelemetryGridDisplay.tile(key: TelemetryTileKey): TelemetryTile = tiles.first { it.key == key }

    private fun text(value: TileValue): String = (value as TileValue.Text).text

    @Test
    fun absentStateSelectsTheEmptyBranch() {
        // Web `state ? <grid/> : <EmptyState/>`: a null state yields no display (empty branch).
        assertNull(TelemetryGridProjection.project(state = null, formatter = metric))
    }

    @Test
    fun presentStateEmitsAllSixTilesInWebSourceOrder() {
        val display = TelemetryGridProjection.project(sampleState, metric)!!

        assertEquals(
            listOf(
                TelemetryTileKey.BATTERY,
                TelemetryTileKey.SPEED,
                TelemetryTileKey.INSIDE,
                TelemetryTileKey.ODOMETER,
                TelemetryTileKey.CHARGER,
                TelemetryTileKey.SENTRY,
            ),
            display.tiles.map { it.key },
        )
    }

    @Test
    fun batteryFormatsPercentAndRangeSubAndDrivesAccentByThreshold() {
        val display = TelemetryGridProjection.project(sampleState, metric)!!
        val battery = display.tile(TelemetryTileKey.BATTERY)

        // Web `${fmtInt(battery_level)}%`.
        assertEquals("84%", text(battery.value))
        // Web `> 50` emerald branch.
        assertEquals(TileAccent.SUCCESS, battery.accent)
        // Web sub `${formatDistance(rated_range)} range` — the distance fragment delegates to useUnits.
        assertEquals(metric.distance(350_000.0), (battery.sub as TileSub.Range).distance)
    }

    @Test
    fun batteryAccentTracksTheWebThresholds() {
        fun accentFor(level: Double): TileAccent =
            TelemetryGridProjection
                .project(sampleState.copy(batteryLevel = level), metric)!!
                .tile(TelemetryTileKey.BATTERY)
                .accent

        assertEquals(TileAccent.SUCCESS, accentFor(51.0))
        // 50 is not `> 50` so it falls to the amber `> 20` branch (boundary check).
        assertEquals(TileAccent.WARNING, accentFor(50.0))
        assertEquals(TileAccent.WARNING, accentFor(21.0))
        // 20 is not `> 20` so it falls to the rose branch (boundary check).
        assertEquals(TileAccent.DANGER, accentFor(20.0))
        assertEquals(TileAccent.DANGER, accentFor(5.0))
    }

    @Test
    fun speedDelegatesToUseUnitsAndPicksDrivingOrParked() {
        val parked = TelemetryGridProjection.project(sampleState.copy(speedMps = 0.0), metric)!!.tile(TelemetryTileKey.SPEED)
        assertEquals(metric.speed(0.0), text(parked.value))
        assertEquals(TileSub.Parked, parked.sub)
        assertEquals(TileAccent.PRIMARY, parked.accent)

        val driving =
            TelemetryGridProjection.project(sampleState.copy(speedMps = 27.0), metric)!!.tile(TelemetryTileKey.SPEED)
        assertEquals(metric.speed(27.0), text(driving.value))
        assertEquals(TileSub.Driving, driving.sub)
    }

    @Test
    fun insideDelegatesToUseUnitsWithAnOutsideSub() {
        val inside = TelemetryGridProjection.project(sampleState, metric)!!.tile(TelemetryTileKey.INSIDE)

        assertEquals(metric.temperature(21.0), text(inside.value))
        assertEquals(metric.temperature(14.0), (inside.sub as TileSub.Outside).temperature)
        assertEquals(TileAccent.PRIMARY, inside.accent)
    }

    @Test
    fun odometerDelegatesToUseUnitsAtZeroPrecisionWithNoSub() {
        val odometer = TelemetryGridProjection.project(sampleState, metric)!!.tile(TelemetryTileKey.ODOMETER)

        // Web `formatDistance(odometer, { precision: 0 })`.
        assertEquals(metric.distance(19_874_000.0, precision = 0), text(odometer.value))
        assertEquals(TileSub.None, odometer.sub)
    }

    @Test
    fun chargerWhenChargingShowsPowerEmeraldAndAFullInSub() {
        val charger = TelemetryGridProjection.project(sampleState, metric)!!.tile(TelemetryTileKey.CHARGER)

        // Web `${fmtInt(charger_power)} kW`.
        assertEquals("11 kW", text(charger.value))
        assertEquals(TileAccent.SUCCESS, charger.accent)
        // Web `Full in ${fmtNumber(time_to_full_charge)}h` — projection bakes the hours glyph; precision 2.
        assertEquals("1.50h", (charger.sub as TileSub.FullIn).hours)
    }

    @Test
    fun chargerWhenChargingWithoutAnEtaHasNoSub() {
        val charger =
            TelemetryGridProjection
                .project(sampleState.copy(timeToFullChargeHours = null), metric)!!
                .tile(TelemetryTileKey.CHARGER)

        assertEquals("11 kW", text(charger.value))
        assertEquals(TileSub.None, charger.sub)
    }

    @Test
    fun chargerWhenNotChargingShowsTheNotChargingMarkerMutedWithNoSub() {
        val charger =
            TelemetryGridProjection
                .project(sampleState.copy(isCharging = false), metric)!!
                .tile(TelemetryTileKey.CHARGER)

        assertEquals(TileValue.NotCharging, charger.value)
        assertEquals(TileAccent.MUTED, charger.accent)
        assertEquals(TileSub.None, charger.sub)
    }

    @Test
    fun sentryMapsArmedToActiveRoseAndDisarmedToOffMuted() {
        val armed = TelemetryGridProjection.project(sampleState.copy(sentryMode = true), metric)!!.tile(TelemetryTileKey.SENTRY)
        assertEquals(TileValue.SentryActive, armed.value)
        assertEquals(TileAccent.DANGER, armed.accent)
        assertEquals(TileSub.None, armed.sub)

        val off = TelemetryGridProjection.project(sampleState.copy(sentryMode = false), metric)!!.tile(TelemetryTileKey.SENTRY)
        assertEquals(TileValue.SentryOff, off.value)
        assertEquals(TileAccent.MUTED, off.accent)
    }

    @Test
    fun unitFieldsActuallyApplyTheUserPreference() {
        // Switching to imperial must change the distance / speed / temperature outputs, proving useUnits is
        // applied rather than a hard-coded metric string.
        val metricGrid = TelemetryGridProjection.project(sampleState, metric)!!
        val imperialGrid = TelemetryGridProjection.project(sampleState, imperial())!!

        assertNotEquals(
            text(metricGrid.tile(TelemetryTileKey.ODOMETER).value),
            text(imperialGrid.tile(TelemetryTileKey.ODOMETER).value),
        )
        assertTrue(text(imperialGrid.tile(TelemetryTileKey.ODOMETER).value).contains("mi"))
        assertTrue(text(imperialGrid.tile(TelemetryTileKey.SPEED).value).contains("mph"))
        assertTrue((imperialGrid.tile(TelemetryTileKey.INSIDE).sub as TileSub.Outside).temperature.contains("F"))
    }

    @Test
    fun sparseFieldsNeverRenderNaN() {
        // Web `safeNumber` coerces null/NaN to 0; a battery with no level renders "0%" in the rose branch.
        val battery =
            TelemetryGridProjection
                .project(VehicleStateTelemetry(batteryLevel = null), metric)!!
                .tile(TelemetryTileKey.BATTERY)

        assertEquals("0%", text(battery.value))
        assertEquals(TileAccent.DANGER, battery.accent)
    }

    @Test
    fun projectsStraightOffTheCachedVehicleStateJsonIgnoringUnknownColumns() {
        // The data-adapter path: the owning page caches the raw `/vehicles/{vehicleID}/state` response, whose
        // row carries many more columns than this surface reads. Decoding + projecting must yield the grid.
        val json =
            """
            {
              "vehicle_id": 7,
              "state": "online",
              "latitude": 37.4,
              "longitude": -122.1,
              "speed": 0,
              "power": 0,
              "battery_level": 84,
              "rated_range": 350000,
              "ideal_range": 360000,
              "odometer": 19874000,
              "inside_temp": 21,
              "outside_temp": 14,
              "is_climate_on": false,
              "is_charging": false,
              "charger_power": 0,
              "charge_rate": 0,
              "time_to_full_charge": 0,
              "is_locked": true,
              "sentry_mode": true,
              "software_version": "2026.4.1"
            }
            """.trimIndent()
        val decoded = lenientJson.decodeFromString(VehicleStateTelemetry.serializer(), json)

        val display = TelemetryGridProjection.project(decoded, metric)!!

        assertEquals("84%", text(display.tile(TelemetryTileKey.BATTERY).value))
        assertEquals(TileAccent.SUCCESS, display.tile(TelemetryTileKey.BATTERY).accent)
        // speed 0 → Parked; is_charging false → Not charging; sentry_mode true → Active.
        assertEquals(TileSub.Parked, display.tile(TelemetryTileKey.SPEED).sub)
        assertEquals(TileValue.NotCharging, display.tile(TelemetryTileKey.CHARGER).value)
        assertEquals(TileValue.SentryActive, display.tile(TelemetryTileKey.SENTRY).value)
    }
}
