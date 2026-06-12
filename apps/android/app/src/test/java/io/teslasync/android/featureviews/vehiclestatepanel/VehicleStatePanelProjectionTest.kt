package io.teslasync.android.featureviews.vehiclestatepanel

import io.teslasync.android.data.UnitFormatter
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the VehicleStatePanel's pure logic — the native mirror of every derivation the
 * web component performs (web/src/features/vehicles/components/telemetry-panels/VehicleStatePanel.tsx): the
 * `x ? onLabel : 'Off'` boolean rows (no em-dash branch), the `(x as string) || 'Off'` turn-signal narrowing
 * with its `!== 'Off'` activity test, the `live.speedLimitMode ? formatSpeed(...) : 'Off'` branch, the
 * `(x as string) || '—'` JS-truthiness count/display rows, and the `sseConnected` indicator gate. Because the
 * surface is purely presentational, each [VehicleStateDisplay] is exactly what the thin composable renders, so
 * these assertions double as the per-state "snapshot". The final case is the data-adapter path: decode a
 * cached camelCase `live` object (with extra columns) and project it.
 */
class VehicleStatePanelProjectionTest {
    private val lenientJson = Json { ignoreUnknownKeys = true }
    private val formatter = UnitFormatter.default()

    private fun project(
        live: VehicleLiveState,
        sseConnected: Boolean = false,
    ): VehicleStateDisplay = VehicleStatePanelProjection.project(live, sseConnected, formatter)

    private fun VehicleStateDisplay.row(key: StateRowKey): StateRow = groups.flatten().first { it.key == key }

    private fun VehicleStateDisplay.value(key: StateRowKey): SignalValue = row(key).value

    private fun VehicleStateDisplay.active(key: StateRowKey): Boolean = row(key).active

    @Test
    fun sseConnectedGatesTheLiveIndicator() {
        // Web `sseConnected &&` — the indicator shows exactly when connected; the rows are unaffected.
        assertTrue(project(VehicleLiveState(), sseConnected = true).live)
        assertFalse(project(VehicleLiveState(), sseConnected = false).live)
    }

    @Test
    fun emitsAllTenRowsInWebOrderAndThreeGroups() {
        val display = project(VehicleLiveState())

        assertEquals(listOf(3, 2, 5), display.groups.map { it.size })
        assertEquals(
            listOf(
                StateRowKey.HIGH_BEAMS,
                StateRowKey.TURN_SIGNAL,
                StateRowKey.HAZARDS,
                StateRowKey.DRIVER_SEAT,
                StateRowKey.PAIRED_KEYS,
                StateRowKey.VALET_MODE,
                StateRowKey.SERVICE_MODE,
                StateRowKey.SPEED_LIMIT,
                StateRowKey.CENTER_DISPLAY,
                StateRowKey.HOMELINK_DEVICES,
            ),
            display.groups.flatten().map { it.key },
        )
    }

    @Test
    fun emptyLiveMapRendersEveryRowWithItsFallbackAndNeverDashesABoolean() {
        // Web: an empty `live` map leaves every `live.x` undefined → every boolean row shows "Off" (never "—"),
        // driver seat shows "Empty", and the three count/display rows show the em-dash.
        val display = project(VehicleLiveState())

        assertEquals(SignalValue.Off, display.value(StateRowKey.HIGH_BEAMS))
        assertEquals(SignalValue.Off, display.value(StateRowKey.HAZARDS))
        assertEquals(SignalValue.Off, display.value(StateRowKey.TURN_SIGNAL))
        assertEquals(SignalValue.Off, display.value(StateRowKey.VALET_MODE))
        assertEquals(SignalValue.Off, display.value(StateRowKey.SERVICE_MODE))
        assertEquals(SignalValue.Off, display.value(StateRowKey.SPEED_LIMIT))
        assertEquals(SignalValue.Empty, display.value(StateRowKey.DRIVER_SEAT))
        assertEquals(SignalValue.Dash, display.value(StateRowKey.PAIRED_KEYS))
        assertEquals(SignalValue.Dash, display.value(StateRowKey.CENTER_DISPLAY))
        assertEquals(SignalValue.Dash, display.value(StateRowKey.HOMELINK_DEVICES))
        display.groups.flatten().forEach { assertFalse(it.active) }
    }

    @Test
    fun booleanRowsMapTruthyToTheirOnLabelAndFalsyOrAbsentToOff() {
        val on = project(VehicleLiveState(lightsHighBeams = true, lightsHazards = true, valetMode = true, serviceMode = true))
        assertEquals(SignalValue.On, on.value(StateRowKey.HIGH_BEAMS))
        assertEquals(SignalValue.Active, on.value(StateRowKey.HAZARDS))
        assertEquals(SignalValue.Enabled, on.value(StateRowKey.VALET_MODE))
        assertEquals(SignalValue.Active, on.value(StateRowKey.SERVICE_MODE))
        assertTrue(on.active(StateRowKey.HIGH_BEAMS))
        assertTrue(on.active(StateRowKey.VALET_MODE))

        val off = project(VehicleLiveState(lightsHighBeams = false, lightsHazards = false, valetMode = false))
        assertEquals(SignalValue.Off, off.value(StateRowKey.HIGH_BEAMS))
        assertEquals(SignalValue.Off, off.value(StateRowKey.HAZARDS))
        assertEquals(SignalValue.Off, off.value(StateRowKey.VALET_MODE))
        assertFalse(off.active(StateRowKey.HIGH_BEAMS))
    }

    @Test
    fun driverSeatMapsOccupiedEmptyAndTreatsAbsentAsEmpty() {
        assertEquals(SignalValue.Occupied, project(VehicleLiveState(driverSeatOccupied = true)).value(StateRowKey.DRIVER_SEAT))
        assertTrue(project(VehicleLiveState(driverSeatOccupied = true)).active(StateRowKey.DRIVER_SEAT))
        assertEquals(SignalValue.Empty, project(VehicleLiveState(driverSeatOccupied = false)).value(StateRowKey.DRIVER_SEAT))
        // Web has no em-dash branch — an absent seat reads "Empty", inactive.
        assertEquals(SignalValue.Empty, project(VehicleLiveState(driverSeatOccupied = null)).value(StateRowKey.DRIVER_SEAT))
        assertFalse(project(VehicleLiveState(driverSeatOccupied = null)).active(StateRowKey.DRIVER_SEAT))
    }

    @Test
    fun turnSignalNarrowsStringsFallsBackToOffAndTreatsOffAsInactive() {
        val left = project(VehicleLiveState(lightsTurnSignal = JsonPrimitive("Left")))
        assertEquals(SignalValue.Literal("Left"), left.value(StateRowKey.TURN_SIGNAL))
        assertTrue(left.active(StateRowKey.TURN_SIGNAL))

        // Web `!== 'Off'`: the literal "Off" passes through as the value but is inactive.
        val off = project(VehicleLiveState(lightsTurnSignal = JsonPrimitive("Off")))
        assertEquals(SignalValue.Literal("Off"), off.value(StateRowKey.TURN_SIGNAL))
        assertFalse(off.active(StateRowKey.TURN_SIGNAL))

        // Absent / non-string falls back to the localized "Off" branch, inactive.
        assertEquals(SignalValue.Off, project(VehicleLiveState(lightsTurnSignal = null)).value(StateRowKey.TURN_SIGNAL))
        assertEquals(SignalValue.Off, project(VehicleLiveState(lightsTurnSignal = JsonPrimitive(true))).value(StateRowKey.TURN_SIGNAL))
        assertFalse(project(VehicleLiveState(lightsTurnSignal = JsonPrimitive(true))).active(StateRowKey.TURN_SIGNAL))
    }

    @Test
    fun speedLimitFormatsSiSpeedWhenOnAndShowsOffOtherwise() {
        val on = project(VehicleLiveState(speedLimitMode = true, currentSpeedLimit = 26.8))
        // The value is the SI metres-per-second formatted through the shared units boundary (web formatSpeed).
        assertEquals(SignalValue.Literal(formatter.speed(26.8)), on.value(StateRowKey.SPEED_LIMIT))
        assertTrue(on.active(StateRowKey.SPEED_LIMIT))

        val off = project(VehicleLiveState(speedLimitMode = false, currentSpeedLimit = 26.8))
        assertEquals(SignalValue.Off, off.value(StateRowKey.SPEED_LIMIT))
        assertFalse(off.active(StateRowKey.SPEED_LIMIT))
    }

    @Test
    fun countAndDisplayRowsStringifyTruthyValuesAndDashFalsyOnes() {
        val present =
            project(
                VehicleLiveState(
                    pairedKeyCount = JsonPrimitive(3),
                    homelinkDeviceCount = JsonPrimitive(2),
                    centerDisplay = JsonPrimitive("Drive"),
                ),
            )
        assertEquals(SignalValue.Literal("3"), present.value(StateRowKey.PAIRED_KEYS))
        assertEquals(SignalValue.Literal("2"), present.value(StateRowKey.HOMELINK_DEVICES))
        assertEquals(SignalValue.Literal("Drive"), present.value(StateRowKey.CENTER_DISPLAY))

        // Web `0 || '—'` and `'' || '—'`: a numeric zero and an empty string fall back to the em-dash.
        val zero =
            project(
                VehicleLiveState(
                    pairedKeyCount = JsonPrimitive(0),
                    homelinkDeviceCount = JsonPrimitive(0),
                    centerDisplay = JsonPrimitive(""),
                ),
            )
        assertEquals(SignalValue.Dash, zero.value(StateRowKey.PAIRED_KEYS))
        assertEquals(SignalValue.Dash, zero.value(StateRowKey.HOMELINK_DEVICES))
        assertEquals(SignalValue.Dash, zero.value(StateRowKey.CENTER_DISPLAY))
    }

    @Test
    fun countAndDisplayRowsAlwaysUseTheNeutralPrimaryAccent() {
        // Web `text-[var(--text-primary)]`: Paired Keys, Center Display, HomeLink Devices never tint.
        val display =
            project(
                VehicleLiveState(
                    pairedKeyCount = JsonPrimitive(3),
                    centerDisplay = JsonPrimitive("Drive"),
                    homelinkDeviceCount = JsonPrimitive(2),
                ),
            )
        assertEquals(RowAccent.NEUTRAL, display.row(StateRowKey.PAIRED_KEYS).accent)
        assertEquals(RowAccent.NEUTRAL, display.row(StateRowKey.CENTER_DISPLAY).accent)
        assertEquals(RowAccent.NEUTRAL, display.row(StateRowKey.HOMELINK_DEVICES).accent)
    }

    @Test
    fun perRowAccentsMatchTheWebTailwindColors() {
        val display = project(VehicleLiveState())
        assertEquals(RowAccent.INFO, display.row(StateRowKey.HIGH_BEAMS).accent)
        assertEquals(RowAccent.WARNING, display.row(StateRowKey.TURN_SIGNAL).accent)
        assertEquals(RowAccent.DANGER, display.row(StateRowKey.HAZARDS).accent)
        assertEquals(RowAccent.SUCCESS, display.row(StateRowKey.DRIVER_SEAT).accent)
        assertEquals(RowAccent.PURPLE, display.row(StateRowKey.VALET_MODE).accent)
        assertEquals(RowAccent.WARNING, display.row(StateRowKey.SERVICE_MODE).accent)
        assertEquals(RowAccent.INFO, display.row(StateRowKey.SPEED_LIMIT).accent)
    }

    @Test
    fun projectsStraightOffACachedCamelCaseLiveObjectIgnoringUnknownKeys() {
        // The data adapter path: the owning page caches the serialized live-signal object, which carries many
        // more keys than this surface reads. Decoding + projecting must yield the same view.
        val json =
            """
            {
              "vehicleId": 7,
              "batteryLevel": 82,
              "lightsHighBeams": true,
              "lightsTurnSignal": "Left",
              "lightsHazards": false,
              "driverSeatOccupied": true,
              "pairedKeyCount": 3,
              "valetMode": false,
              "serviceMode": false,
              "speedLimitMode": true,
              "currentSpeedLimit": 26.8,
              "centerDisplay": "Drive",
              "homelinkDeviceCount": 2,
              "updatedAt": "2026-06-11T12:00:00Z"
            }
            """.trimIndent()
        val decoded = lenientJson.decodeFromString(VehicleLiveState.serializer(), json)

        val display = VehicleStatePanelProjection.project(decoded, sseConnected = true, formatter)

        assertTrue(display.live)
        assertEquals(SignalValue.On, display.value(StateRowKey.HIGH_BEAMS))
        assertEquals(SignalValue.Literal("Left"), display.value(StateRowKey.TURN_SIGNAL))
        assertEquals(SignalValue.Off, display.value(StateRowKey.HAZARDS))
        assertEquals(SignalValue.Occupied, display.value(StateRowKey.DRIVER_SEAT))
        assertEquals(SignalValue.Literal("3"), display.value(StateRowKey.PAIRED_KEYS))
        assertEquals(SignalValue.Off, display.value(StateRowKey.VALET_MODE))
        assertEquals(SignalValue.Off, display.value(StateRowKey.SERVICE_MODE))
        assertEquals(SignalValue.Literal(formatter.speed(26.8)), display.value(StateRowKey.SPEED_LIMIT))
        assertEquals(SignalValue.Literal("Drive"), display.value(StateRowKey.CENTER_DISPLAY))
        assertEquals(SignalValue.Literal("2"), display.value(StateRowKey.HOMELINK_DEVICES))

        assertTrue(display.active(StateRowKey.HIGH_BEAMS))
        assertTrue(display.active(StateRowKey.TURN_SIGNAL))
        assertTrue(display.active(StateRowKey.SPEED_LIMIT))
        assertFalse(display.active(StateRowKey.HAZARDS))
    }
}
