package io.teslasync.android.featureviews.livevehiclestate

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the LiveVehicleState's pure logic — the native mirror of every derivation the
 * web `buildLiveSignals` performs (web/src/features/admin/components/security-access/LiveVehicleState.tsx):
 * the `boolLabel` on/off/dash mapping, the `asNonEmptyString` string narrowing, the `typeof === 'boolean'`
 * speed-limit branch, the `(n ?? 0) > 0` count activity, the `!includes('off')` activity test, and the two
 * render conditionals (`latest &&` for the indicator, `liveSignals.length > 0` for the grid). Because the
 * surface is purely presentational, each [LiveVehicleStateDisplay] is exactly what the thin composable
 * renders, so these assertions double as the per-state "snapshot". The final case is the data-adapter path:
 * decode a cached `/security/latest` payload (snake_case, extra columns) and project it.
 */
class LiveVehicleStateProjectionTest {
    private val lenientJson = Json { ignoreUnknownKeys = true }

    private fun LiveVehicleStateDisplay.value(key: LiveSignalKey): SignalValue = signals.first { it.key == key }.value

    private fun LiveVehicleStateDisplay.active(key: LiveSignalKey): Boolean = signals.first { it.key == key }.active

    @Test
    fun absentEventRendersEmptyStateWithNoLiveIndicator() {
        // Web: `latest &&` is false and `buildLiveSignals(undefined)` returns [], so the empty branch shows.
        val display = LiveVehicleStateProjection.project(latest = null)

        assertFalse(display.live)
        assertTrue(display.signals.isEmpty())
    }

    @Test
    fun presentEventEmitsAllTenSignalsInWebOrderAndShowsTheIndicator() {
        val display = LiveVehicleStateProjection.project(SecurityEventLive())

        assertTrue(display.live)
        assertEquals(
            listOf(
                LiveSignalKey.HAZARDS,
                LiveSignalKey.HIGH_BEAMS,
                LiveSignalKey.TURN_SIGNAL,
                LiveSignalKey.DRIVER_SEAT,
                LiveSignalKey.PAIRED_KEYS,
                LiveSignalKey.VALET_MODE,
                LiveSignalKey.SERVICE_MODE,
                LiveSignalKey.SPEED_LIMIT,
                LiveSignalKey.HOMELINK_DEVICES,
                LiveSignalKey.CENTER_DISPLAY,
            ),
            display.signals.map { it.key },
        )
    }

    @Test
    fun booleanSignalsMapToOnOffDashAndDriveActivity() {
        val on = LiveVehicleStateProjection.project(SecurityEventLive(lightsHazardsActive = true))
        assertEquals(SignalValue.On, on.value(LiveSignalKey.HAZARDS))
        assertTrue(on.active(LiveSignalKey.HAZARDS))

        val off = LiveVehicleStateProjection.project(SecurityEventLive(lightsHazardsActive = false))
        assertEquals(SignalValue.Off, off.value(LiveSignalKey.HAZARDS))
        assertFalse(off.active(LiveSignalKey.HAZARDS))

        val unknown = LiveVehicleStateProjection.project(SecurityEventLive(lightsHazardsActive = null))
        assertEquals(SignalValue.Dash, unknown.value(LiveSignalKey.HAZARDS))
        assertFalse(unknown.active(LiveSignalKey.HAZARDS))
    }

    @Test
    fun driverSeatMapsOccupiedEmptyDash() {
        assertEquals(
            SignalValue.Occupied,
            LiveVehicleStateProjection.project(SecurityEventLive(driverSeatOccupied = true)).value(LiveSignalKey.DRIVER_SEAT),
        )
        assertEquals(
            SignalValue.Empty,
            LiveVehicleStateProjection.project(SecurityEventLive(driverSeatOccupied = false)).value(LiveSignalKey.DRIVER_SEAT),
        )
        assertEquals(
            SignalValue.Dash,
            LiveVehicleStateProjection.project(SecurityEventLive(driverSeatOccupied = null)).value(LiveSignalKey.DRIVER_SEAT),
        )
    }

    @Test
    fun countSignalsStringifyAndActivateAboveZero() {
        val three = LiveVehicleStateProjection.project(SecurityEventLive(pairedPhoneKeyCount = 3))
        assertEquals(SignalValue.Literal("3"), three.value(LiveSignalKey.PAIRED_KEYS))
        assertTrue(three.active(LiveSignalKey.PAIRED_KEYS))

        val zero = LiveVehicleStateProjection.project(SecurityEventLive(homelinkDeviceCount = 0))
        assertEquals(SignalValue.Literal("0"), zero.value(LiveSignalKey.HOMELINK_DEVICES))
        assertFalse(zero.active(LiveSignalKey.HOMELINK_DEVICES))

        val absent = LiveVehicleStateProjection.project(SecurityEventLive(pairedPhoneKeyCount = null))
        assertEquals(SignalValue.Dash, absent.value(LiveSignalKey.PAIRED_KEYS))
        assertFalse(absent.active(LiveSignalKey.PAIRED_KEYS))
    }

    @Test
    fun turnSignalNarrowsStringsAndTreatsOffAsInactive() {
        val left = LiveVehicleStateProjection.project(SecurityEventLive(lightsTurnSignal = JsonPrimitive("Left")))
        assertEquals(SignalValue.Literal("Left"), left.value(LiveSignalKey.TURN_SIGNAL))
        assertTrue(left.active(LiveSignalKey.TURN_SIGNAL))

        // Web `!s.toLowerCase().includes('off')`: an "...Off" state passes through as the value but is inactive.
        val off = LiveVehicleStateProjection.project(SecurityEventLive(lightsTurnSignal = JsonPrimitive("TurnSignalOff")))
        assertEquals(SignalValue.Literal("TurnSignalOff"), off.value(LiveSignalKey.TURN_SIGNAL))
        assertFalse(off.active(LiveSignalKey.TURN_SIGNAL))

        // A boolean in a string field is not a string (web `asNonEmptyString(false) === null`) → em-dash.
        val boolish = LiveVehicleStateProjection.project(SecurityEventLive(lightsTurnSignal = JsonPrimitive(false)))
        assertEquals(SignalValue.Dash, boolish.value(LiveSignalKey.TURN_SIGNAL))
        assertFalse(boolish.active(LiveSignalKey.TURN_SIGNAL))
    }

    @Test
    fun centerDisplayNarrowsStringsAndIgnoresBooleans() {
        val standby = LiveVehicleStateProjection.project(SecurityEventLive(centerDisplay = JsonPrimitive("Standby")))
        assertEquals(SignalValue.Literal("Standby"), standby.value(LiveSignalKey.CENTER_DISPLAY))
        assertTrue(standby.active(LiveSignalKey.CENTER_DISPLAY))

        val boolish = LiveVehicleStateProjection.project(SecurityEventLive(centerDisplay = JsonPrimitive(true)))
        assertEquals(SignalValue.Dash, boolish.value(LiveSignalKey.CENTER_DISPLAY))
        assertFalse(boolish.active(LiveSignalKey.CENTER_DISPLAY))
    }

    @Test
    fun speedLimitUsesOnOffWhenBooleanAndStringOtherwise() {
        val boolTrue = LiveVehicleStateProjection.project(SecurityEventLive(speedLimitMode = JsonPrimitive(true)))
        assertEquals(SignalValue.On, boolTrue.value(LiveSignalKey.SPEED_LIMIT))
        assertTrue(boolTrue.active(LiveSignalKey.SPEED_LIMIT))

        val boolFalse = LiveVehicleStateProjection.project(SecurityEventLive(speedLimitMode = JsonPrimitive(false)))
        assertEquals(SignalValue.Off, boolFalse.value(LiveSignalKey.SPEED_LIMIT))
        assertFalse(boolFalse.active(LiveSignalKey.SPEED_LIMIT))

        val stringOn = LiveVehicleStateProjection.project(SecurityEventLive(speedLimitMode = JsonPrimitive("Enabled")))
        assertEquals(SignalValue.Literal("Enabled"), stringOn.value(LiveSignalKey.SPEED_LIMIT))
        assertTrue(stringOn.active(LiveSignalKey.SPEED_LIMIT))

        val absent = LiveVehicleStateProjection.project(SecurityEventLive(speedLimitMode = null))
        assertEquals(SignalValue.Dash, absent.value(LiveSignalKey.SPEED_LIMIT))
        assertFalse(absent.active(LiveSignalKey.SPEED_LIMIT))
    }

    @Test
    fun projectsStraightOffTheCachedSecurityLatestJsonIgnoringUnknownColumns() {
        // The data adapter path: the owning page caches the raw `/security/latest` response, whose row
        // carries many more columns than this surface reads. Decoding + projecting must yield the same view.
        val json =
            """
            {
              "id": 1,
              "locked": true,
              "sentry_mode": "SentryModeStateOff",
              "lights_hazards_active": true,
              "lights_high_beams": false,
              "lights_turn_signal": "Left",
              "driver_seat_occupied": true,
              "paired_phone_key_count": 3,
              "valet_mode_enabled": false,
              "service_mode": false,
              "speed_limit_mode": false,
              "homelink_device_count": 2,
              "center_display": "Standby",
              "created_at": "2026-06-11T12:00:00Z"
            }
            """.trimIndent()
        val decoded = lenientJson.decodeFromString(SecurityEventLive.serializer(), json)

        val display = LiveVehicleStateProjection.project(decoded)

        assertTrue(display.live)
        assertEquals(SignalValue.On, display.value(LiveSignalKey.HAZARDS))
        assertEquals(SignalValue.Off, display.value(LiveSignalKey.HIGH_BEAMS))
        assertEquals(SignalValue.Literal("Left"), display.value(LiveSignalKey.TURN_SIGNAL))
        assertEquals(SignalValue.Occupied, display.value(LiveSignalKey.DRIVER_SEAT))
        assertEquals(SignalValue.Literal("3"), display.value(LiveSignalKey.PAIRED_KEYS))
        assertEquals(SignalValue.Off, display.value(LiveSignalKey.VALET_MODE))
        assertEquals(SignalValue.Off, display.value(LiveSignalKey.SERVICE_MODE))
        // speed_limit_mode arrived as a JSON boolean → On/Off branch, not a string.
        assertEquals(SignalValue.Off, display.value(LiveSignalKey.SPEED_LIMIT))
        assertEquals(SignalValue.Literal("2"), display.value(LiveSignalKey.HOMELINK_DEVICES))
        assertEquals(SignalValue.Literal("Standby"), display.value(LiveSignalKey.CENTER_DISPLAY))

        assertTrue(display.active(LiveSignalKey.HAZARDS))
        assertTrue(display.active(LiveSignalKey.PAIRED_KEYS))
        assertTrue(display.active(LiveSignalKey.CENTER_DISPLAY))
        assertFalse(display.active(LiveSignalKey.SPEED_LIMIT))
    }
}
