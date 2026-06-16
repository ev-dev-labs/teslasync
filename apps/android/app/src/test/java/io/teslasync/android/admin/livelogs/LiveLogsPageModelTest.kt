package io.teslasync.android.admin.livelogs

import io.teslasync.shared.core.presentation.logstream.LogStreamEvent
import io.teslasync.shared.core.presentation.logstream.LogStreamLevel
import io.teslasync.shared.core.presentation.logstream.LogStreamState
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId

/**
 * Off-device verification of the LiveLogsPage pure model — the native port of everything the web page derives
 * inline (web/src/features/admin/pages/LiveLogsPage.tsx + the `useLogStream` helpers): the level→badge tone
 * map, the time/message/field/vehicle extraction over a row's raw zerolog JSON, the client-side vehicle
 * filter, the connection-status classification (`ConnectionBadge`), the table-region phase
 * (loading / empty / content), and the download `.txt` body + filename. All run with a fixed UTC clock so the
 * formatting assertions are deterministic.
 */
class LiveLogsPageModelTest {
    private val utc = ZoneId.of("UTC")

    private fun event(
        seq: Int,
        level: String,
        payload: String,
        parsed: JsonObject?,
        receivedAt: Long = 0L,
    ): LogStreamEvent = LogStreamEvent(seq = seq, receivedAt = receivedAt, payload = payload, parsed = parsed, level = level)

    // ── levelTone (web levelBadgeVariant) ───────────────────────────────────────────────────────────────────

    @Test
    fun levelToneMapsEverySeverityClass() {
        assertEquals(LiveLogsTone.Neutral, levelTone("debug"))
        assertEquals(LiveLogsTone.Neutral, levelTone("TRACE"))
        assertEquals(LiveLogsTone.Info, levelTone("info"))
        assertEquals(LiveLogsTone.Warning, levelTone("warn"))
        assertEquals(LiveLogsTone.Warning, levelTone("warning"))
        assertEquals(LiveLogsTone.Danger, levelTone("error"))
        assertEquals(LiveLogsTone.Danger, levelTone("fatal"))
        assertEquals(LiveLogsTone.Danger, levelTone("panic"))
        assertEquals(LiveLogsTone.Neutral, levelTone("unknown"))
    }

    @Test
    fun levelFromWireResolvesTokenAndDefaults() {
        assertEquals(LogStreamLevel.Debug, levelFromWire("debug"))
        assertEquals(LogStreamLevel.Error, levelFromWire("error"))
        assertEquals(LogStreamLevel.Info, levelFromWire("nonsense"))
    }

    // ── connectionStatus (web ConnectionBadge precedence) ───────────────────────────────────────────────────

    @Test
    fun connectionStatusFollowsWebPrecedence() {
        assertEquals(LiveLogsConnection.Error, connectionStatus(hasError = true, enabled = true, isConnected = true, paused = false))
        assertEquals(
            LiveLogsConnection.Disconnected,
            connectionStatus(hasError = false, enabled = false, isConnected = true, paused = false),
        )
        assertEquals(
            LiveLogsConnection.Connecting,
            connectionStatus(hasError = false, enabled = true, isConnected = false, paused = false),
        )
        assertEquals(
            LiveLogsConnection.Paused,
            connectionStatus(hasError = false, enabled = true, isConnected = true, paused = true),
        )
        assertEquals(
            LiveLogsConnection.Connected,
            connectionStatus(hasError = false, enabled = true, isConnected = true, paused = false),
        )
    }

    // ── extractMessage / extractFields / extractVehicleId (web extract* helpers) ────────────────────────────

    @Test
    fun extractMessagePrefersMessageThenMsgThenRaw() {
        assertEquals("hello", extractMessage(buildJsonObject { put("message", "hello") }, "raw"))
        assertEquals("viamsg", extractMessage(buildJsonObject { put("msg", "viamsg") }, "raw"))
        assertEquals("raw-line", extractMessage(buildJsonObject { put("level", "info") }, "raw-line"))
        assertEquals("only-raw", extractMessage(null, "only-raw"))
    }

    @Test
    fun extractFieldsSkipsReservedAndStringifiesValues() {
        val parsed =
            buildJsonObject {
                put("level", "info")
                put("time", "t")
                put("message", "m")
                put("msg", "m2")
                put("vehicle_id", 7)
                put("count", 3)
                put("ok", true)
                putJsonObject("nested") { put("a", 1) }
            }
        val fields = extractFields(parsed).toMap()
        assertFalse(fields.containsKey("level"))
        assertFalse(fields.containsKey("time"))
        assertFalse(fields.containsKey("message"))
        assertFalse(fields.containsKey("msg"))
        assertEquals("7", fields["vehicle_id"])
        assertEquals("3", fields["count"])
        assertEquals("true", fields["ok"])
        assertTrue(fields["nested"]!!.contains("\"a\""))
    }

    @Test
    fun extractVehicleIdHandlesEveryCandidateKey() {
        assertEquals("12", extractVehicleId(buildJsonObject { put("vehicle_id", "12") }))
        assertEquals("34", extractVehicleId(buildJsonObject { put("vehicleID", 34) }))
        assertEquals("56", extractVehicleId(buildJsonObject { put("vehicleId", "56") }))
        assertNull(extractVehicleId(buildJsonObject { put("vehicle_id", "") }))
        assertNull(extractVehicleId(buildJsonObject { put("other", "x") }))
        assertNull(extractVehicleId(null))
    }

    @Test
    fun filterByVehicleAppliesNeedleToBuffer() {
        val events =
            listOf(
                event(1, "info", "a", buildJsonObject { put("vehicle_id", 7) }),
                event(2, "info", "b", buildJsonObject { put("vehicle_id", 9) }),
                event(3, "info", "c", parsed = null),
            )
        assertEquals(3, filterByVehicle(events, "").size)
        assertEquals(3, filterByVehicle(events, "   ").size)
        assertEquals(listOf(1), filterByVehicle(events, "7").map { it.seq })
        assertTrue(filterByVehicle(events, "100").isEmpty())
    }

    // ── projectLiveLogs (the data-state matrix bound to the StateFlow) ──────────────────────────────────────

    @Test
    fun projectLoadingWhenConnectingWithEmptyBuffer() {
        val state = projectLiveLogs(LogStreamState(isConnected = false), LiveLogsInteraction())
        assertEquals(LiveLogsConnection.Connecting, state.connection)
        assertEquals(LiveLogsPhase.Loading, state.phase)
        assertFalse(state.hasError)
    }

    @Test
    fun projectEmptyWhenConnectedWithNoRows() {
        val state = projectLiveLogs(LogStreamState(isConnected = true), LiveLogsInteraction())
        assertEquals(LiveLogsConnection.Connected, state.connection)
        assertEquals(LiveLogsPhase.Empty, state.phase)
    }

    @Test
    fun projectContentSurfacesBufferAndCounters() {
        val rows = listOf(event(1, "warn", "x", buildJsonObject { put("vehicle_id", 7) }))
        val stream = LogStreamState(events = rows, isConnected = true, totalReceived = 5, drops = 2)
        val state = projectLiveLogs(stream, LiveLogsInteraction())
        assertEquals(LiveLogsPhase.Content, state.phase)
        assertEquals(LiveLogsConnection.Connected, state.connection)
        assertEquals(1, state.events.size)
        assertEquals(1, state.bufferedCount)
        assertEquals(5, state.totalReceived)
        assertEquals(2, state.drops)
    }

    @Test
    fun projectErrorFlagsHasErrorRegardlessOfBuffer() {
        val stream = LogStreamState(isConnected = false, error = "boom")
        val state = projectLiveLogs(stream, LiveLogsInteraction())
        assertEquals(LiveLogsConnection.Error, state.connection)
        assertTrue(state.hasError)
        assertEquals("boom", state.errorMessage)
    }

    @Test
    fun projectPausedKeepsBufferAndShowsPausedBadge() {
        val rows = listOf(event(1, "info", "x", null))
        val stream = LogStreamState(events = rows, isConnected = true)
        val state = projectLiveLogs(stream, LiveLogsInteraction(paused = true))
        assertEquals(LiveLogsConnection.Paused, state.connection)
        assertEquals(LiveLogsPhase.Content, state.phase)
    }

    @Test
    fun projectAppliesVehicleFilterAndShowsFullBufferCount() {
        val rows =
            listOf(
                event(1, "info", "a", buildJsonObject { put("vehicle_id", 7) }),
                event(2, "info", "b", buildJsonObject { put("vehicle_id", 9) }),
            )
        val stream = LogStreamState(events = rows, isConnected = true)
        val state = projectLiveLogs(stream, LiveLogsInteraction(vehicleFilter = "9"))
        assertEquals(1, state.events.size)
        assertEquals(2, state.bufferedCount)
        assertEquals("b", extractMessage(state.events.first().parsed, state.events.first().payload))
    }

    // ── download body / filename (web eventToText + downloadFilename) ───────────────────────────────────────

    @Test
    fun formatLogTimeUsesMillisecondClock() {
        assertEquals("00:00:00.000", formatLogTime(0L, utc))
    }

    @Test
    fun eventToLineMatchesWebShape() {
        val ev = event(1, "info", "{\"message\":\"hi\"}", null)
        assertEquals("[00:00:00.000] INFO {\"message\":\"hi\"}", eventToLine(ev, utc))
    }

    @Test
    fun downloadBodyJoinsEveryVisibleRow() {
        val rows = listOf(event(1, "info", "p1", null), event(2, "warn", "p2", null))
        assertEquals("[00:00:00.000] INFO p1\n[00:00:00.000] WARN p2", downloadBody(rows, utc))
    }

    @Test
    fun downloadTimestampStripsFractionAndColons() {
        assertEquals("1970-01-01T00-00-00Z", downloadTimestamp(0L, utc))
    }

    @Test
    fun truncateFieldValueCapsLongValues() {
        assertEquals("short", truncateFieldValue("short"))
        val long = "x".repeat(40)
        val truncated = truncateFieldValue(long)
        assertTrue(truncated.endsWith("\u2026"))
        assertEquals(33, truncated.length)
    }

    @Test
    fun extractVehicleIdReadsNumericPrimitiveContent() {
        // A number primitive renders unquoted; mirror the web `String(v)` coercion.
        val parsed = buildJsonObject { put("vehicle_id", JsonPrimitive(88)) }
        assertEquals("88", extractVehicleId(parsed))
    }
}
