package io.teslasync.shared.core.net.sse

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SseFrameParserTest {
    private fun SseFrameParser.feedAll(vararg chunks: String): List<SseFrame> {
        val out = mutableListOf<SseFrame>()
        for (chunk in chunks) out += feed(chunk)
        return out
    }

    @Test
    fun parsesASingleEventDataFrame() {
        val frames = SseFrameParser().feed("event: heartbeat\ndata: {\"time\":\"t\"}\n\n")
        assertEquals(1, frames.size)
        assertEquals("heartbeat", frames[0].event)
        assertEquals("{\"time\":\"t\"}", frames[0].data)
        assertNull(frames[0].id)
    }

    @Test
    fun reassemblesFramesSplitAcrossChunkBoundaries() {
        val parser = SseFrameParser()
        val frames =
            parser.feedAll(
                "event: heart",
                "beat\ndata: {\"a\"",
                ":1}\n",
                "\n",
            )
        assertEquals(1, frames.size)
        assertEquals("heartbeat", frames[0].event)
        assertEquals("{\"a\":1}", frames[0].data)
    }

    @Test
    fun joinsMultipleDataLinesWithNewline() {
        val frames = SseFrameParser().feed("event: x\ndata: line1\ndata: line2\n\n")
        assertEquals(1, frames.size)
        assertEquals("line1\nline2", frames[0].data)
    }

    @Test
    fun capturesIdAndRetryFields() {
        val frames = SseFrameParser().feed("id: 42\nretry: 5000\nevent: x\ndata: {}\n\n")
        assertEquals(1, frames.size)
        assertEquals("42", frames[0].id)
        assertEquals(5000L, frames[0].retry)
    }

    @Test
    fun ignoresCommentLines() {
        val frames = SseFrameParser().feed(": keep-alive comment\nevent: x\ndata: {}\n\n")
        assertEquals(1, frames.size)
        assertEquals("x", frames[0].event)
    }

    @Test
    fun toleratesCarriageReturnLineEndings() {
        val frames = SseFrameParser().feed("event: x\r\ndata: hi\r\n\r\n")
        assertEquals(1, frames.size)
        assertEquals("x", frames[0].event)
        assertEquals("hi", frames[0].data)
    }

    @Test
    fun emitsMultipleFramesFromOneChunk() {
        val frames =
            SseFrameParser().feed(
                "event: a\ndata: 1\n\nevent: b\ndata: 2\n\n",
            )
        assertEquals(2, frames.size)
        assertEquals("a", frames[0].event)
        assertEquals("b", frames[1].event)
    }

    @Test
    fun buffersIncompleteFrameUntilBlankLine() {
        val parser = SseFrameParser()
        assertTrue(parser.feed("event: a\ndata: 1\n").isEmpty())
        val frames = parser.feed("\n")
        assertEquals(1, frames.size)
    }

    @Test
    fun stripsOnlyTheFirstLeadingSpaceOfValues() {
        val frames = SseFrameParser().feed("data:  two-spaces\n\n")
        assertEquals(1, frames.size)
        assertEquals(" two-spaces", frames[0].data)
    }
}
