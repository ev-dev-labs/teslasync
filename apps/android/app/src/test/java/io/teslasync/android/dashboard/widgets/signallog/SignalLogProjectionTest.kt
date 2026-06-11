package io.teslasync.android.dashboard.widgets.signallog

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.shared.core.presentation.telemetry.SignalObservation
import io.teslasync.shared.core.presentation.telemetry.TelemetryStatus
import io.teslasync.shared.core.presentation.telemetry.VehicleTelemetry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Exercises the pure [SignalLogProjection] + [SignalLogRegistration] + [SignalSourceTokens] off-device (no
 * Compose, no Android), covering everything the web `SignalLogWidget` derives: the registry parity, the
 * source → tone/label map (incl. the `obs.source ?? 'backfill'` fallback), the single-value formatter, the
 * newest-first 20-row feed projection + folded TalkBack description (the a11y-label check), the per-vehicle
 * signals/sec aggregation, the `Math.round` rate, and the tolerant timestamp parse.
 */
class SignalLogProjectionTest {
    @Test
    fun registrationMatchesWebRegistry() {
        assertEquals("signal-log", SignalLogRegistration.ID)
        assertEquals("telemetry", SignalLogRegistration.CATEGORY)
        assertEquals("SignalLogWidget", SignalLogRegistration.SLUG)
        assertEquals(20, SignalLogRegistration.OBSERVATIONS_LIMIT)
        assertEquals(SignalLogSize(2, 4), SignalLogRegistration.DEFAULT_SIZE)
        assertEquals(SignalLogSize(2, 4), SignalLogRegistration.MIN_SIZE)
        assertEquals(SignalLogSize(4, 40), SignalLogRegistration.MAX_SIZE)
    }

    @Test
    fun footprintBoundsClampToTheRegistryConstraints() {
        assertTrue(SignalLogRegistration.isWithinBounds(SignalLogSize(2, 10)))
        assertFalse(SignalLogRegistration.isWithinBounds(SignalLogSize(1, 1)))
        assertFalse(SignalLogRegistration.isWithinBounds(SignalLogSize(5, 41)))
        assertEquals(SignalLogSize(2, 4), SignalLogRegistration.clamp(SignalLogSize(0, 0)))
        assertEquals(SignalLogSize(4, 40), SignalLogRegistration.clamp(SignalLogSize(9, 99)))
    }

    @Test
    fun sizeIsCompactOnlyAtSingleColumn() {
        assertTrue(SignalLogSize(1, 4).isCompact)
        assertFalse(SignalLogSize(2, 4).isCompact)
        assertFalse(SignalLogSize(4, 40).isCompact)
    }

    @Test
    fun sourceTokensMapEachWireSourceToToneAndLabel() {
        assertEquals(SignalSourceTone.Telemetry to "MQTT", SignalSourceTokens.of("fleet_telemetry"))
        assertEquals(SignalSourceTone.Api to "API", SignalSourceTokens.of("fleet_api"))
        assertEquals(SignalSourceTone.Manual to "Manual", SignalSourceTokens.of("manual"))
        assertEquals(SignalSourceTone.Backfill to "Cache", SignalSourceTokens.of("backfill"))
    }

    @Test
    fun sourceTokensFallBackToBackfillForBlankAndKeepRawForUnknown() {
        // Web `obs.source ?? 'backfill'` — a null/blank source resolves to the cache token.
        assertEquals(SignalSourceTone.Backfill to "Cache", SignalSourceTokens.of(null))
        assertEquals(SignalSourceTone.Backfill to "Cache", SignalSourceTokens.of("  "))
        // Web `SOURCE_LABELS[source] ?? source` — an unknown source keeps its raw wire string.
        assertEquals(SignalSourceTone.Other to "derived", SignalSourceTokens.of("derived"))
    }

    @Test
    fun formatSignalValuePrefersNumericThenTextThenBoolThenDash() {
        assertEquals("12.5", SignalLogProjection.formatSignalValue(observation(valueNumeric = 12.5)))
        assertEquals("D", SignalLogProjection.formatSignalValue(observation(valueText = "D")))
        assertEquals("true", SignalLogProjection.formatSignalValue(observation(valueBool = true)))
        assertEquals("false", SignalLogProjection.formatSignalValue(observation(valueBool = false)))
        assertEquals(SIGNAL_LOG_EM_DASH, SignalLogProjection.formatSignalValue(observation()))
    }

    @Test
    fun formatSignalValueRendersIntegralNumericWithoutTrailingDecimal() {
        // JS `String(42)` → "42", `String(42.5)` → "42.5".
        assertEquals("42", SignalLogProjection.formatSignalValue(observation(valueNumeric = 42.0)))
        assertEquals("0", SignalLogProjection.formatSignalValue(observation(valueNumeric = 0.0)))
        assertEquals("-3.25", SignalLogProjection.formatSignalValue(observation(valueNumeric = -3.25)))
    }

    @Test
    fun projectSortsNewestFirstAndCapsAtTwenty() {
        val observations =
            (1..25).map { index ->
                observation(ts = "2026-01-01T00:00:%02dZ".format(index), signalName = "sig-$index", valueNumeric = index.toDouble())
            }

        val display = SignalLogProjection.project(observations, strings(), nowMillis = NOW)

        assertEquals(20, display.items.size)
        assertTrue(display.hasItems)
        // Newest (second :25) first, capped before the oldest five.
        assertEquals("sig-25", display.items.first().signalName)
        assertEquals("sig-6", display.items.last().signalName)
    }

    @Test
    fun projectBuildsRowWithLabelValueAndFoldedContentDescription() {
        val ts = "2026-01-01T00:00:30Z"
        val now = SignalLogProjection.parseTimestampMillis(ts)!! + FIVE_MINUTES_MS
        val observation = observation(ts = ts, signalName = "VehicleSpeed", valueNumeric = 60.0)

        val row = SignalLogProjection.project(listOf(observation), strings(), nowMillis = now).items.single()

        assertEquals(SignalSourceTone.Telemetry, row.tone)
        assertEquals("MQTT", row.sourceLabel)
        assertEquals("VehicleSpeed", row.signalName)
        assertEquals("60", row.valueText)
        assertEquals("5m", row.relativeTime)
        // The TalkBack phrase folds signal + value + source + relative time into one description.
        assertEquals("VehicleSpeed \u00b7 60 \u00b7 MQTT \u00b7 5m", row.contentDescription)
    }

    @Test
    fun projectBlankSignalNameFallsBackToEmDash() {
        val row = SignalLogProjection.project(listOf(observation(signalName = "")), strings(), nowMillis = NOW).items.single()
        assertEquals(SIGNAL_LOG_EM_DASH, row.signalName)
    }

    @Test
    fun projectEmptyYieldsNoItems() {
        val display = SignalLogProjection.project(emptyList(), strings(), nowMillis = NOW)
        assertFalse(display.hasItems)
        assertTrue(display.items.isEmpty())
    }

    @Test
    fun aggregateSignalRateSumsPerVehicleRatesAndTreatsNullsAsZero() {
        val status =
            status(
                vehicle(signalsPerSecond = 2.5),
                vehicle(signalsPerSecond = 1.0),
                vehicle(signalsPerSecond = null),
            )
        assertEquals(3.5, SignalLogProjection.aggregateSignalRate(status), 0.0001)
        assertEquals(0.0, SignalLogProjection.aggregateSignalRate(null), 0.0001)
        assertEquals(0.0, SignalLogProjection.aggregateSignalRate(status(vehicles = emptyList())), 0.0001)
    }

    @Test
    fun roundedRateRoundsHalfUpLikeMathRound() {
        assertEquals(3L, SignalLogProjection.roundedRate(3.4))
        assertEquals(4L, SignalLogProjection.roundedRate(3.5))
        assertEquals(13L, SignalLogProjection.roundedRate(12.6))
        assertEquals(0L, SignalLogProjection.roundedRate(0.0))
    }

    @Test
    fun parseTimestampMillisToleratesZoneVariantsAndRejectsBlanks() {
        val zulu = SignalLogProjection.parseTimestampMillis("2026-01-01T00:00:00Z")
        val offset = SignalLogProjection.parseTimestampMillis("2026-01-01T01:00:00+01:00")
        assertEquals(zulu, offset)
        assertNull(SignalLogProjection.parseTimestampMillis(null))
        assertNull(SignalLogProjection.parseTimestampMillis("   "))
        assertNull(SignalLogProjection.parseTimestampMillis("not-a-timestamp"))
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
        const val FIVE_MINUTES_MS = 5 * 60_000L

        fun observation(
            ts: String = "2026-01-01T00:00:00Z",
            signalName: String = "sig",
            valueNumeric: Double? = null,
            valueText: String? = null,
            valueBool: Boolean? = null,
        ): SignalObservation =
            SignalObservation(
                vehicleId = 1L,
                ts = ts,
                signalName = signalName,
                valueNumeric = valueNumeric,
                valueText = valueText,
                valueBool = valueBool,
                source = "fleet_telemetry",
            )

        fun status(
            vararg vehicles: VehicleTelemetry,
            broker: String? = "tcp://mosquitto:1883",
        ): TelemetryStatus = status(vehicles = vehicles.toList(), broker = broker)

        fun status(
            vehicles: List<VehicleTelemetry>,
            broker: String? = "tcp://mosquitto:1883",
        ): TelemetryStatus =
            TelemetryStatus(
                connected = true,
                broker = broker,
                uptimeSeconds = 1.0,
                vehicles = vehicles,
                topics = emptyList(),
            )

        fun vehicle(signalsPerSecond: Double?): VehicleTelemetry =
            VehicleTelemetry(
                vin = "5YJ3E1EA1KF000001",
                vehicleId = 1L,
                state = "streaming",
                signalCount = 1L,
                batchCount = 0L,
                signalsPerSecond = signalsPerSecond,
                lastReceived = null,
                isStreaming = true,
                dataSource = "fleet_telemetry",
                latencyMs = null,
            )

        fun strings(): SignalLogStrings =
            SignalLogStrings(
                title = "Signal Log",
                signalsPerSecLabel = "signals/sec",
                pauseLabel = "Pause",
                resumeLabel = "Resume",
                noSignalsMessage = "No signal updates yet",
                refreshLabel = "Refresh",
                refreshingLabel = "Loading",
                offlineLabel = "Offline",
                formatRelative = { age ->
                    when (age) {
                        FreshnessAge.Unknown -> SIGNAL_LOG_EM_DASH
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
