package io.teslasync.shared.core.presentation.logstream

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class LogStreamReducerTest {
    @Test
    fun buildPathAlwaysIncludesLevel() {
        assertEquals(
            "/admin/logs/stream?level=info",
            LogStreamReducer.buildLogStreamPath(LogStreamLevel.Info, ""),
        )
        assertEquals(
            "/admin/logs/stream?level=debug",
            LogStreamReducer.buildLogStreamPath(LogStreamLevel.Debug, "   "),
        )
    }

    @Test
    fun buildPathAppendsGrepWhenNonBlankAndFormEncodes() {
        assertEquals(
            "/admin/logs/stream?level=warn&grep=mqtt",
            LogStreamReducer.buildLogStreamPath(LogStreamLevel.Warn, "mqtt"),
        )
        // space -> '+', reserved chars percent-encoded, matching URLSearchParams.
        assertEquals(
            "/admin/logs/stream?level=error&grep=a+b%2Fc%26d",
            LogStreamReducer.buildLogStreamPath(LogStreamLevel.Error, "a b/c&d"),
        )
    }

    @Test
    fun detectLevelReadsLevelFieldOrFallsBackToInfo() {
        assertEquals("warn", LogStreamReducer.detectLevel(jsonObject("{\"level\":\"warn\"}")))
        assertEquals("info", LogStreamReducer.detectLevel(jsonObject("{\"msg\":\"x\"}")))
        assertEquals("info", LogStreamReducer.detectLevel(null))
        // Non-string level falls back to info, mirroring the web typeof guard.
        assertEquals("info", LogStreamReducer.detectLevel(jsonObject("{\"level\":5}")))
    }

    @Test
    fun buildLogEventParsesObjectOrLeavesParsedNull() {
        val ok = LogStreamReducer.buildLogEvent("{\"level\":\"error\",\"msg\":\"boom\"}", 1, 42L)
        assertEquals(1, ok.seq)
        assertEquals(42L, ok.receivedAt)
        assertEquals("error", ok.level)
        assertTrue(ok.parsed != null)

        val bad = LogStreamReducer.buildLogEvent("not json", 2, 7L)
        assertNull(bad.parsed)
        assertEquals("info", bad.level)
        assertEquals("not json", bad.payload)
    }

    @Test
    fun parseDropCountReadsCountFieldOnly() {
        assertEquals(3, LogStreamReducer.parseDropCount("{\"count\":3}"))
        assertEquals(0, LogStreamReducer.parseDropCount("{\"count\":0}"))
        // Backend's real keys are ignored — web-parity reads `count` only.
        assertEquals(0, LogStreamReducer.parseDropCount("{\"missed\":4,\"total\":9}"))
        assertEquals(0, LogStreamReducer.parseDropCount("not json"))
        assertEquals(0, LogStreamReducer.parseDropCount("{\"count\":\"5\"}"))
    }

    @Test
    fun appendLogEvictsOldestBeyondMaxAndCountsAll() {
        var state = LogStreamState()
        state = LogStreamReducer.appendLog(state, event("a"), maxEvents = 2)
        state = LogStreamReducer.appendLog(state, event("b"), maxEvents = 2)
        state = LogStreamReducer.appendLog(state, event("c"), maxEvents = 2)
        assertEquals(listOf("b", "c"), state.events.map { it.level })
        assertEquals(3, state.totalReceived)
    }

    @Test
    fun clearedResetsBufferAndCountersButKeepsConnection() {
        val state =
            LogStreamState(
                events = listOf(event("a")),
                isConnected = true,
                error = "boom",
                drops = 4,
                totalReceived = 9,
            )
        val cleared = LogStreamReducer.cleared(state)
        assertTrue(cleared.events.isEmpty())
        assertEquals(0, cleared.drops)
        assertEquals(0, cleared.totalReceived)
        assertTrue(cleared.isConnected)
        assertEquals("boom", cleared.error)
    }

    private fun event(level: String): LogStreamEvent = LogStreamReducer.buildLogEvent("{\"level\":\"$level\"}", 0, 0L)

    private fun jsonObject(raw: String) = LogStreamReducer.buildLogEvent(raw, 0, 0L).parsed
}
