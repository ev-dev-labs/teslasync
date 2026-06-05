package io.teslasync.shared.core.net.sse

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class SseDecodeTest {
    private fun decode(
        event: String,
        data: String,
        id: String? = null,
    ): LiveEvent = decodeEvent(SseFrame(event = event, data = data, id = id, retry = null))

    @Test
    fun decodesConnected() {
        val event = decode("connected", "{\"client_id\":\"sse-123\"}", id = "9")
        val connected = assertIs<LiveEvent.Connected>(event)
        assertEquals("sse-123", connected.clientId)
        assertEquals("9", connected.id)
    }

    @Test
    fun decodesHeartbeat() {
        val event = decode("heartbeat", "{\"time\":\"2026-06-04T00:00:00Z\"}")
        val heartbeat = assertIs<LiveEvent.Heartbeat>(event)
        assertEquals("2026-06-04T00:00:00Z", heartbeat.time)
    }

    @Test
    fun decodesVehicleUpdateAsObject() {
        val event = decode("vehicle_update", "{\"vehicle_id\":7,\"state\":{\"speed\":12}}")
        val update = assertIs<LiveEvent.VehicleUpdate>(event)
        assertEquals(7, (update.data["vehicle_id"] as kotlinx.serialization.json.JsonPrimitive).content.toInt())
    }

    @Test
    fun decodesAlertExportAchievement() {
        assertIs<LiveEvent.Alert>(decode("alert", "{}"))
        assertIs<LiveEvent.ExportStatus>(decode("export_status", "{}"))
        assertIs<LiveEvent.AchievementUnlocked>(decode("achievement_unlocked", "{}"))
    }

    @Test
    fun decodesSignalChangeWithLongFormKind() {
        val data =
            "{\"vehicle_id\":42,\"field\":\"VehicleSpeed\",\"kind\":\"ValueKindFloat\"," +
                "\"value\":31.5,\"ts\":\"2026-06-04T00:00:00Z\"}"
        val event = decode("signal_change", data)
        val signal = assertIs<LiveEvent.Signal>(event)
        assertEquals(42L, signal.envelope.vehicleId)
        assertEquals("VehicleSpeed", signal.envelope.field)
        assertEquals(SignalKind.Float, signal.envelope.kind)
        val value = assertIs<SignalValue.NumberValue>(signal.envelope.value)
        assertEquals(31.5, value.value)
    }

    @Test
    fun decodesSignalChangeWithIntegerKindDiscriminator() {
        // kind 2 == ValueKindBool per the protomodel iota order.
        val data = "{\"vehicle_id\":1,\"field\":\"Locked\",\"kind\":2,\"value\":true,\"ts\":\"\"}"
        val signal = assertIs<LiveEvent.Signal>(decode("signal_change", data))
        assertEquals(SignalKind.Bool, signal.envelope.kind)
        assertEquals(SignalValue.BoolValue(true), signal.envelope.value)
    }

    @Test
    fun decodesStringAndTimeAndNullSignalValues() {
        val str =
            assertIs<LiveEvent.Signal>(
                decode("signal_change", "{\"vehicle_id\":1,\"field\":\"Gear\",\"kind\":\"string\",\"value\":\"D\",\"ts\":\"\"}"),
            )
        assertEquals(SignalValue.StringValue("D"), str.envelope.value)

        val nul =
            assertIs<LiveEvent.Signal>(
                decode("signal_change", "{\"vehicle_id\":1,\"field\":\"Gear\",\"kind\":\"string\",\"value\":null,\"ts\":\"\"}"),
            )
        assertEquals(SignalValue.NullValue, nul.envelope.value)
    }

    @Test
    fun malformedSignalChangeDegradesToUnknown() {
        // Missing required `field` → cannot build an envelope.
        val event = decode("signal_change", "{\"vehicle_id\":1,\"kind\":\"string\",\"value\":\"x\"}")
        val unknown = assertIs<LiveEvent.Unknown>(event)
        assertEquals("signal_change", unknown.event)
    }

    @Test
    fun unnamedOrUnrecognisedEventDegradesToUnknown() {
        val event = decode("something_new", "raw-payload")
        val unknown = assertIs<LiveEvent.Unknown>(event)
        assertEquals("something_new", unknown.event)
        assertEquals("raw-payload", unknown.data)
    }
}
