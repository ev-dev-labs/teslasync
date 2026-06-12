package io.teslasync.android.featureviews.telemetrypipelinecard

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.TelemetryStatus
import io.teslasync.shared.core.presentation.telemetry.VehicleTelemetry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.util.Locale

/**
 * Off-device verification of the TelemetryPipelineCard's pure projection — the native port of the web
 * component's inline derivations (web/src/features/system/components/status/TelemetryPipelineCard.tsx):
 * the per-vehicle liveness union + age ladder, the relative-time bucketing, the VIN tail / state badge,
 * the fleet rollup, the MQTT/polling connectivity chips, and the PII-safe `view.opened` diagnostic.
 */
class TelemetryPipelineProjectionTest {
    private val now = Instant.parse("2025-06-15T12:00:00Z").toEpochMilli()

    private fun isoAt(offsetSeconds: Long): String = Instant.ofEpochMilli(now + offsetSeconds * 1000L).toString()

    // ── liveness(): union of the freshest of {poll, stream} + the < 5 min / < 30 min ladder ──────────

    @Test
    fun livenessOfflineWhenNoTimestamps() {
        val result = liveness(lastPollIso = null, lastStreamIso = "", nowMillis = now)
        assertEquals(Liveness.Offline, result.level)
        assertEquals(LivenessSource.None, result.source)
        assertNull(result.lastSeenIso)
    }

    @Test
    fun livenessSendingUnderFiveMinutes() {
        val result = liveness(lastPollIso = isoAt(-120), lastStreamIso = null, nowMillis = now)
        assertEquals(Liveness.Sending, result.level)
        assertEquals(LivenessSource.Poll, result.source)
    }

    @Test
    fun livenessSlowBetweenFiveAndThirtyMinutes() {
        val result = liveness(lastPollIso = null, lastStreamIso = isoAt(-10 * 60), nowMillis = now)
        assertEquals(Liveness.Slow, result.level)
        assertEquals(LivenessSource.Stream, result.source)
    }

    @Test
    fun livenessStaleBeyondThirtyMinutes() {
        val result = liveness(lastPollIso = isoAt(-40 * 60), lastStreamIso = null, nowMillis = now)
        assertEquals(Liveness.Stale, result.level)
    }

    @Test
    fun livenessPicksFreshestStreamOverPoll() {
        val result = liveness(lastPollIso = isoAt(-600), lastStreamIso = isoAt(-60), nowMillis = now)
        assertEquals(LivenessSource.Stream, result.source)
        assertEquals(isoAt(-60), result.lastSeenIso)
        assertEquals(Liveness.Sending, result.level)
    }

    @Test
    fun livenessPicksFreshestPollOverStream() {
        val result = liveness(lastPollIso = isoAt(-30), lastStreamIso = isoAt(-900), nowMillis = now)
        assertEquals(LivenessSource.Poll, result.source)
        assertEquals(isoAt(-30), result.lastSeenIso)
    }

    @Test
    fun livenessPrefersStreamOnTie() {
        // Web: streamMs >= pollMs picks stream.
        val sameInstant = isoAt(-120)
        val result = liveness(lastPollIso = sameInstant, lastStreamIso = sameInstant, nowMillis = now)
        assertEquals(LivenessSource.Stream, result.source)
    }

    // ── parseIso / relativeTimeOf ────────────────────────────────────────────────────────────────────

    @Test
    fun parseIsoRejectsBlankAndMalformed() {
        assertNull(parseIso(null))
        assertNull(parseIso(""))
        assertNull(parseIso("   "))
        assertNull(parseIso("not-a-date"))
    }

    @Test
    fun relativeTimeNullForAbsentTimestamp() {
        assertNull(relativeTimeOf(null, now))
        assertNull(relativeTimeOf("", now))
    }

    @Test
    fun relativeTimePastSeconds() {
        val rt = relativeTimeOf(isoAt(-3), now)!!
        assertTrue(rt.past)
        assertEquals(RelativeUnit.Seconds, rt.unit)
        assertEquals(3L, rt.value)
    }

    @Test
    fun relativeTimeFutureMinutesForNextPoll() {
        val rt = relativeTimeOf(isoAt(20 * 60), now)!!
        assertFalse(rt.past)
        assertEquals(RelativeUnit.Minutes, rt.unit)
        assertEquals(20L, rt.value)
    }

    @Test
    fun relativeTimeBucketsHoursAndDays() {
        assertEquals(RelativeUnit.Hours, relativeTimeOf(isoAt(-3 * 3600), now)!!.unit)
        assertEquals(RelativeUnit.Days, relativeTimeOf(isoAt(-2 * 86_400), now)!!.unit)
    }

    // ── vinTail / vehicleStateBadge / batteryTone / fmtCount ─────────────────────────────────────────

    @Test
    fun vinTailMasksToLastFour() {
        assertEquals("0001", vinTail("5YJ3E1EA1KF000001"))
        assertEquals("AB", vinTail("AB"))
        assertEquals(VIN_TAIL_UNKNOWN, vinTail(null))
        assertEquals(VIN_TAIL_UNKNOWN, vinTail("   "))
    }

    @Test
    fun vehicleStateBadgeNormalizesTokens() {
        assertEquals("online", vehicleStateBadge("online", "unknown"))
        assertEquals("driving", vehicleStateBadge("Driving", "unknown"))
        assertEquals("asleep", vehicleStateBadge("sleeping", "unknown"))
        assertEquals("offline", vehicleStateBadge("offline", "unknown"))
        assertEquals("custom", vehicleStateBadge("CUSTOM", "unknown"))
        assertEquals("unknown", vehicleStateBadge(null, "unknown"))
        assertEquals("unknown", vehicleStateBadge("", "unknown"))
    }

    @Test
    fun batteryToneLadder() {
        assertEquals(BatteryTone.Good, batteryTone(50))
        assertEquals(BatteryTone.Warn, batteryTone(20))
        assertEquals(BatteryTone.Critical, batteryTone(19))
    }

    @Test
    fun fmtCountGroupsOrEmDash() {
        assertEquals(EM_DASH, fmtCount(null, Locale.US))
        assertEquals("1,234", fmtCount(1234, Locale.US))
        assertEquals("0", fmtCount(0, Locale.US))
    }

    // ── project(): full render-ready display ─────────────────────────────────────────────────────────

    @Test
    fun projectBuildsRollupGridAndVehiclesConnectedLabel() {
        val display = project(vehicles = vehicles())
        assertEquals("2 connected", display.rollup.vehiclesValue)
        assertEquals("1,000", display.rollup.positionsValue)
        assertEquals("12", display.rollup.drivesValue)
        assertEquals(EM_DASH, display.rollup.chargingValue)
        assertEquals(EM_DASH, display.rollup.signalLogValue)
        assertTrue(display.hasVehicles)
        assertTrue(display.showLivenessSummary)
    }

    @Test
    fun projectNoVehiclesShowsEmptyAndNoneConfigured() {
        val display = project(vehicles = emptyList())
        assertFalse(display.hasVehicles)
        assertFalse(display.showLivenessSummary)
        assertEquals("none configured", display.rollup.vehiclesValue)
    }

    @Test
    fun projectMqttConnectedChip() {
        val display = project(vehicles = vehicles(), feeds = feeds(mqttConnected = true))
        assertTrue(display.mqttChip.connected)
        assertEquals("Fleet Telemetry connected", display.mqttChip.label)
    }

    @Test
    fun projectMqttDisconnectedChip() {
        val display = project(vehicles = vehicles(), feeds = feeds(mqttConnected = false))
        assertFalse(display.mqttChip.connected)
        assertEquals("MQTT broker disconnected", display.mqttChip.label)
    }

    @Test
    fun projectPollingChipOffWhenDisabledButStreaming() {
        val display = project(vehicles = vehicles(), feeds = feeds(mqttConnected = true, pollingEnabled = false))
        assertEquals(PollingChipKind.OffStreamingOnly, display.pollingChip?.kind)
    }

    @Test
    fun projectPollingChipDisabledWhenNoStreaming() {
        val display = project(vehicles = vehicles(), feeds = feeds(mqttConnected = false, pollingEnabled = false))
        assertEquals(PollingChipKind.Disabled, display.pollingChip?.kind)
    }

    @Test
    fun projectNoPollingChipWhenEnabled() {
        val display = project(vehicles = vehicles(), feeds = feeds(pollingEnabled = true))
        assertNull(display.pollingChip)
    }

    @Test
    fun projectVehicleRowFoldsPollingAndStream() {
        val display = project(vehicles = vehicles())
        // VIN ...0002 has a polling entry with battery 64 and a future next poll; no stream -> poll source.
        val row = display.vehicles.single { it.id == 2L }
        assertEquals("VIN 0002", row.vinLabel)
        assertEquals(64, row.batteryPercent)
        assertEquals("64%", row.batteryText)
        assertEquals("battery 64%", row.batteryContentDescription)
        assertEquals("telemetry status: ${row.livenessLabel}", row.statusContentDescription)
        assertEquals(LivenessSource.Poll, row.source)
        assertEquals("poll", row.sourceLabel)
        assertEquals("in 20 min", row.nextRelative)
    }

    @Test
    fun projectVehicleRowUsesStreamWhenFreshest() {
        val display = project(vehicles = vehicles())
        // VIN ...0001 streams (1 min ago) -> sending via stream, no polling entry -> no battery / no next.
        val row = display.vehicles.single { it.id == 1L }
        assertEquals(Liveness.Sending, row.level)
        assertEquals(LivenessSource.Stream, row.source)
        assertEquals("stream", row.sourceLabel)
        assertNull(row.batteryPercent)
        assertEquals(EM_DASH, row.batteryText)
        assertNull(row.batteryContentDescription)
        assertNull(row.nextRelative)
    }

    @Test
    fun projectVehicleRowFallbackName() {
        val display = project(vehicles = listOf(TelemetryPipelineVehicle(id = 9, vin = "X", displayName = null, state = null)))
        assertEquals("Vehicle 9", display.vehicles.single().name)
        assertEquals("unknown", display.vehicles.single().stateLabel)
    }

    @Test
    fun projectLivenessTallyCountsBuckets() {
        val display = project(vehicles = vehicles())
        // Two vehicles: one sending (stream), one slow/stale/offline depending on poll age; both present.
        val total = display.livenessChips.sumOf { it.count }
        assertEquals(2, total)
        assertTrue(display.livenessChips.all { it.count > 0 })
        val sendingChip = display.livenessChips.first { it.level == Liveness.Sending }
        assertEquals("1 sending", sendingChip.label)
    }

    // ── diagnostics ──────────────────────────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSurfaceSlug() {
        val logger = RecordingLogger()
        recordTelemetryPipelineCardOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "TelemetryPipelineCard"), opened.single().second)
        assertEquals("TelemetryPipelineCard", TELEMETRY_PIPELINE_CARD_SLUG)
    }

    // ── fixtures ─────────────────────────────────────────────────────────────────────────────────────

    private fun project(
        vehicles: List<TelemetryPipelineVehicle>,
        feeds: TelemetryPipelineFeeds = feeds(),
        counts: FleetCounts = FleetCounts(1_000, 12, null, null),
    ): TelemetryPipelineDisplay {
        val context = TelemetryPipelineContext(now, STRINGS, Locale.US)
        return TelemetryPipelineProjection.project(feeds, vehicles, counts, context)
    }

    private fun vehicles(): List<TelemetryPipelineVehicle> =
        listOf(
            TelemetryPipelineVehicle(id = 1, vin = "5YJ3E1EA1KF000001", displayName = "Model 3", state = "online"),
            TelemetryPipelineVehicle(id = 2, vin = "5YJSA1E26MF000002", displayName = "Model S", state = "asleep"),
        )

    private fun feeds(
        mqttConnected: Boolean = true,
        pollingEnabled: Boolean = true,
    ): TelemetryPipelineFeeds =
        TelemetryPipelineFeeds(
            mqtt =
                TelemetryStatus(
                    connected = mqttConnected,
                    broker = "tcp://broker:1883",
                    uptimeSeconds = 1.0,
                    vehicles =
                        listOf(
                            VehicleTelemetry(
                                vin = "5YJ3E1EA1KF000001",
                                vehicleId = 1,
                                state = "online",
                                signalCount = 10,
                                batchCount = 1,
                                signalsPerSecond = 2.0,
                                lastReceived = isoAt(-60),
                                isStreaming = true,
                                dataSource = "fleet_telemetry",
                                latencyMs = null,
                            ),
                        ),
                    topics = emptyList(),
                ),
            polling =
                PollEngineStatus(
                    enabled = pollingEnabled,
                    vehicles =
                        mapOf(
                            "5YJSA1E26MF000002" to
                                VehiclePollingStatus(
                                    lastPollTime = isoAt(-10 * 60),
                                    nextPollAfter = isoAt(20 * 60),
                                    batteryLevel = 64.0,
                                ),
                        ),
                ),
        )

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    private companion object {
        val STRINGS =
            TelemetryPipelineStrings(
                vehiclesLabel = "Vehicles",
                gpsPositionsLabel = "GPS positions",
                drivesLabel = "Drives",
                chargingSessionsLabel = "Charging sessions",
                signalLogLabel = "Signal log",
                vehiclesConnectedTemplate = "%d connected",
                noneConfigured = "none configured",
                livenessTitle = "Liveness:",
                sending = "sending",
                slow = "slow",
                stale = "stale",
                offline = "offline",
                fleetTelemetryConnected = "Fleet Telemetry connected",
                mqttBrokerDisconnected = "MQTT broker disconnected",
                pollingEngineOff = "polling engine off (streaming-only)",
                pollingEngineDisabled = "polling engine disabled",
                noVehiclesMessage = "No vehicles configured yet.",
                teslaAccountAction = "Tesla account",
                vinPrefix = "VIN ",
                unknownState = "unknown",
                streamLabel = "stream",
                pollLabel = "poll",
                lastPrefix = "last:",
                nextPrefix = "next:",
                statusA11yPrefix = "telemetry status:",
                batteryA11yPrefix = "battery",
                vehicleFallbackNameTemplate = "Vehicle %d",
                openTelemetryCoverage = "Open Telemetry Coverage",
                mqttInspector = "MQTT Inspector",
                allVehicles = "All vehicles",
                formatRelativeTime = { rt ->
                    when (rt.unit) {
                        RelativeUnit.Seconds -> if (rt.past) "${rt.value}s ago" else "in ${rt.value}s"
                        RelativeUnit.Minutes -> if (rt.past) "${rt.value} min ago" else "in ${rt.value} min"
                        RelativeUnit.Hours -> if (rt.past) "${rt.value}h ago" else "in ${rt.value}h"
                        RelativeUnit.Days -> if (rt.past) "${rt.value}d ago" else "in ${rt.value}d"
                    }
                },
            )
    }
}
