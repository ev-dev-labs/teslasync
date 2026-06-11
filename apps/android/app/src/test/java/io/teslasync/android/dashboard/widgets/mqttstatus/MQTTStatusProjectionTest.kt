package io.teslasync.android.dashboard.widgets.mqttstatus

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.shared.core.presentation.telemetry.TelemetryStatus
import io.teslasync.shared.core.presentation.telemetry.VehicleTelemetry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Exercises the pure [MqttStatusProjection] + [MqttStatusRegistration] off-device (no Compose, no Android),
 * covering everything the web `MQTTStatusWidget` derives: the per-vehicle signal-count / rate sums, the
 * latest-received pick + relative-time label, the connected/offline status, the broker + last-message
 * em-dash fallbacks, the one-decimal rate + grouped-integer total formatting, the registry parity, and the
 * folded compact TalkBack description (the a11y-label check).
 */
class MQTTStatusProjectionTest {
    @Test
    fun registrationMatchesWebRegistry() {
        assertEquals("mqtt-status", MqttStatusRegistration.ID)
        assertEquals("system", MqttStatusRegistration.CATEGORY)
        assertEquals("MQTTStatusWidget", MqttStatusRegistration.SLUG)
        assertEquals(MqttStatusSize(2, 2), MqttStatusRegistration.DEFAULT_SIZE)
        assertEquals(MqttStatusSize(1, 2), MqttStatusRegistration.MIN_SIZE)
        assertEquals(MqttStatusSize(3, 40), MqttStatusRegistration.MAX_SIZE)
    }

    @Test
    fun footprintBoundsClampToTheRegistryConstraints() {
        assertTrue(MqttStatusRegistration.isWithinBounds(MqttStatusSize(2, 10)))
        assertFalse(MqttStatusRegistration.isWithinBounds(MqttStatusSize(0, 1)))
        assertFalse(MqttStatusRegistration.isWithinBounds(MqttStatusSize(4, 41)))
        assertEquals(MqttStatusSize(1, 2), MqttStatusRegistration.clamp(MqttStatusSize(0, 0)))
        assertEquals(MqttStatusSize(3, 40), MqttStatusRegistration.clamp(MqttStatusSize(9, 99)))
    }

    @Test
    fun sizeIsCompactOnlyAtSingleColumn() {
        assertTrue(MqttStatusSize(1, 2).isCompact)
        assertFalse(MqttStatusSize(2, 2).isCompact)
        assertFalse(MqttStatusSize(3, 40).isCompact)
    }

    @Test
    fun projectSumsCountsAndRatesAcrossVehicles() {
        val status =
            status(
                connected = true,
                vehicles =
                    listOf(
                        vehicle(signalCount = 100, signalsPerSecond = 2.5, lastReceived = null),
                        vehicle(signalCount = 50, signalsPerSecond = 1.0, lastReceived = null),
                    ),
            )

        val display = MqttStatusProjection.project(status, strings(), nowMillis = 0L, locale = Locale.US)

        assertEquals(150L, display.totalMessages)
        assertEquals(3.5, display.messagesPerSecValue, 0.0001)
        assertEquals("3.5", display.messagesPerSecText)
        assertEquals("150", display.totalMessagesText)
    }

    @Test
    fun projectFormatsRateOneDecimalAndTotalGrouped() {
        val status =
            status(
                connected = true,
                vehicles =
                    listOf(
                        vehicle(signalCount = 24_000, signalsPerSecond = 7.46, lastReceived = null),
                        vehicle(signalCount = 585, signalsPerSecond = null, lastReceived = null),
                    ),
            )

        val display = MqttStatusProjection.project(status, strings(), nowMillis = 0L, locale = Locale.US)

        assertEquals("7.5", display.messagesPerSecText)
        assertEquals("24,585", display.totalMessagesText)
    }

    @Test
    fun projectPicksLatestReceivedForTheRelativeLabel() {
        val latest = "2026-01-01T00:00:30Z"
        val now = MqttStatusProjection.parseTimestampMillis(latest)!! + FIVE_MINUTES_MS
        val status =
            status(
                connected = true,
                vehicles =
                    listOf(
                        vehicle(signalCount = 1, signalsPerSecond = 0.0, lastReceived = "2025-12-01T00:00:00Z"),
                        vehicle(signalCount = 1, signalsPerSecond = 0.0, lastReceived = latest),
                    ),
            )

        val display = MqttStatusProjection.project(status, strings(), nowMillis = now, locale = Locale.US)

        // 5 minutes after the LATEST timestamp → "5m"; the stale December reading would have bucketed weeks.
        assertEquals("5m", display.lastMessageText)
    }

    @Test
    fun projectFallsBackToEmDashForMissingBrokerAndLastMessage() {
        val status =
            status(
                connected = true,
                broker = null,
                vehicles = listOf(vehicle(signalCount = 5, signalsPerSecond = 1.0, lastReceived = "  ")),
            )

        val display = MqttStatusProjection.project(status, strings(), nowMillis = 0L, locale = Locale.US)

        assertEquals(MQTT_EM_DASH, display.broker)
        assertEquals(MQTT_EM_DASH, display.lastMessageText)
    }

    @Test
    fun projectReflectsConnectedAndOfflineStatus() {
        val connected = MqttStatusProjection.project(status(connected = true, vehicles = emptyList()), strings(), 0L, Locale.US)
        assertTrue(connected.connected)
        assertEquals(MQTT_STATUS_ONLINE, connected.statusToken)
        assertEquals("Online", connected.statusLabel)

        val offline = MqttStatusProjection.project(status(connected = false, vehicles = emptyList()), strings(), 0L, Locale.US)
        assertFalse(offline.connected)
        assertEquals(MQTT_STATUS_OFFLINE, offline.statusToken)
        assertEquals("Offline", offline.statusLabel)
    }

    @Test
    fun projectEmptyFleetYieldsZeroes() {
        val display = MqttStatusProjection.project(status(connected = false, vehicles = emptyList()), strings(), 0L, Locale.US)

        assertEquals(0L, display.totalMessages)
        assertEquals(0.0, display.messagesPerSecValue, 0.0001)
        assertEquals("0.0", display.messagesPerSecText)
        assertEquals("0", display.totalMessagesText)
        assertEquals(MQTT_EM_DASH, display.lastMessageText)
    }

    @Test
    fun compactContentDescriptionFoldsTitleStatusAndRate() {
        val status =
            status(connected = true, vehicles = listOf(vehicle(signalCount = 1, signalsPerSecond = 12.4, lastReceived = null)))

        val display = MqttStatusProjection.project(status, strings(), nowMillis = 0L, locale = Locale.US)

        assertEquals("MQTT Status: Online, 12.4 msg/s", display.compactContentDescription)
    }

    @Test
    fun parseTimestampMillisToleratesZoneVariantsAndRejectsBlanks() {
        val zulu = MqttStatusProjection.parseTimestampMillis("2026-01-01T00:00:00Z")
        val offset = MqttStatusProjection.parseTimestampMillis("2026-01-01T01:00:00+01:00")
        assertEquals(zulu, offset)
        assertEquals(zulu, MqttStatusProjection.parseTimestampMillis("2026-01-01T00:00:00"))
        assertNull(MqttStatusProjection.parseTimestampMillis(null))
        assertNull(MqttStatusProjection.parseTimestampMillis("   "))
        assertNull(MqttStatusProjection.parseTimestampMillis("not-a-timestamp"))
    }

    private companion object {
        const val FIVE_MINUTES_MS = 5 * 60_000L

        fun status(
            connected: Boolean,
            vehicles: List<VehicleTelemetry>,
            broker: String? = "tcp://mosquitto:1883",
        ): TelemetryStatus =
            TelemetryStatus(
                connected = connected,
                broker = broker,
                uptimeSeconds = 1.0,
                vehicles = vehicles,
                topics = emptyList(),
            )

        fun vehicle(
            signalCount: Long,
            signalsPerSecond: Double?,
            lastReceived: String?,
        ): VehicleTelemetry =
            VehicleTelemetry(
                vin = "5YJ3E1EA1KF000001",
                vehicleId = 1L,
                state = "streaming",
                signalCount = signalCount,
                batchCount = 0L,
                signalsPerSecond = signalsPerSecond,
                lastReceived = lastReceived,
                isStreaming = true,
                dataSource = "fleet_telemetry",
                latencyMs = null,
            )

        fun strings(): MqttStatusStrings =
            MqttStatusStrings(
                title = "MQTT Status",
                msgSec = "msg/s",
                statusLabel = "Status",
                msgRate = "Messages/sec",
                totalToday = "Total Messages",
                lastMessage = "Last Message",
                broker = "Broker",
                noData = "No MQTT status data",
                online = "Online",
                offline = "Offline",
                formatRelative = { age ->
                    when (age) {
                        FreshnessAge.Unknown -> MQTT_EM_DASH
                        FreshnessAge.JustNow -> "just now"
                        is FreshnessAge.Seconds -> "${age.value}s"
                        is FreshnessAge.Minutes -> "${age.value}m"
                        is FreshnessAge.Hours -> "${age.value}h"
                        is FreshnessAge.Days -> "${age.value}d"
                        is FreshnessAge.Weeks -> "${age.value}w"
                    }
                },
            )
    }
}
