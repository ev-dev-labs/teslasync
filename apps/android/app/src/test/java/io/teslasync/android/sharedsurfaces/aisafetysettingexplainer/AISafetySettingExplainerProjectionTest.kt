package io.teslasync.android.sharedsurfaces.aisafetysettingexplainer

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device unit coverage of the pure [AISafetySettingExplainerProjection] — the AI-Off gate (web
 * `useAiEnabled`), the SSE frame parser + delta accumulator (web `parseSSEFrame` + `useAiStream`
 * reducer), the surface selection, and the error-kind classification. Every branch the web source renders
 * is exercised here, with no Android, UI, or network in the loop. There is no vehicle resolution because
 * the surface has no vehicle scope (the web body is `{}`).
 */
class AISafetySettingExplainerProjectionTest {
    private val projection = AISafetySettingExplainerProjection
    private val featureId = AISafetySettingExplainerRegistration.FEATURE_ID

    // ── Gate (web useAiEnabled, ADR-015 fail-closed) ─────────────────────────────

    @Test
    fun gateEnabledWhenModeOnAndFeatureTrue() {
        val doc =
            buildJsonObject {
                put("ai_mode", JsonPrimitive("local"))
                put("ai_features", buildJsonObject { put(featureId, JsonPrimitive(true)) })
            }
        assertTrue(projection.isSafetyExplainerEnabled(doc))
    }

    @Test
    fun gateDisabledWhenModeOff() {
        val doc =
            buildJsonObject {
                put("ai_mode", JsonPrimitive("off"))
                put("ai_features", buildJsonObject { put(featureId, JsonPrimitive(true)) })
            }
        assertFalse(projection.isSafetyExplainerEnabled(doc))
    }

    @Test
    fun gateDisabledWhenModeMissing() {
        val doc = buildJsonObject { put("ai_features", buildJsonObject { put(featureId, JsonPrimitive(true)) }) }
        assertFalse(projection.isSafetyExplainerEnabled(doc))
    }

    @Test
    fun gateDisabledWhenFeatureFalseOrMissingOrNoMap() {
        val featureFalse =
            buildJsonObject {
                put("ai_mode", JsonPrimitive("cloud"))
                put("ai_features", buildJsonObject { put(featureId, JsonPrimitive(false)) })
            }
        val featureMissing =
            buildJsonObject {
                put("ai_mode", JsonPrimitive("cloud"))
                put("ai_features", buildJsonObject { put("other-feature", JsonPrimitive(true)) })
            }
        val noMap = buildJsonObject { put("ai_mode", JsonPrimitive("cloud")) }
        assertFalse(projection.isSafetyExplainerEnabled(featureFalse))
        assertFalse(projection.isSafetyExplainerEnabled(featureMissing))
        assertFalse(projection.isSafetyExplainerEnabled(noMap))
    }

    @Test
    fun gateDisabledWhenDocumentNullOrNotObject() {
        assertFalse(projection.isSafetyExplainerEnabled(null))
        assertFalse(projection.isSafetyExplainerEnabled(JsonNull))
        assertFalse(projection.isSafetyExplainerEnabled(JsonPrimitive("not-an-object")))
    }

    // ── SSE frame parsing (web parseSSEFrame + toTypedEvent) ─────────────────────

    @Test
    fun parsesDeltaFrame() {
        val event = projection.parseExplainFrame("event: delta\ndata: {\"text\":\"hello\"}")
        assertEquals(AiExplainEvent.Delta("hello"), event)
    }

    @Test
    fun parsesDoneFrameWithUsage() {
        val event =
            projection.parseExplainFrame(
                "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":12,\"out\":34}}",
            )
        assertEquals(AiExplainEvent.Done("stop", 12, 34), event)
    }

    @Test
    fun parsesErrorFrameWithLimitFields() {
        val event =
            projection.parseExplainFrame(
                "event: error\ndata: {\"message\":\"boom\",\"reason\":\"rate_limit\"," +
                    "\"retry_after_s\":5,\"baseline_available\":true}",
            )
        assertEquals(
            AiExplainEvent.Error(message = "boom", reason = "rate_limit", retryAfterS = 5, baselineAvailable = true),
            event,
        )
    }

    @Test
    fun ignoresCommentLinesAndKeepsDelta() {
        val event = projection.parseExplainFrame(":keepalive\nevent: delta\ndata: {\"text\":\"x\"}")
        assertEquals(AiExplainEvent.Delta("x"), event)
    }

    @Test
    fun returnsNullForUnknownEventMalformedDataOrNoEvent() {
        assertNull(projection.parseExplainFrame("event: mystery\ndata: {}"))
        assertNull(projection.parseExplainFrame("event: delta\ndata: {not valid json"))
        assertNull(projection.parseExplainFrame("data: {\"text\":\"x\"}"))
    }

    @Test
    fun parsesMultiFrameStreamSkippingBlanks() {
        val body =
            "event: delta\ndata: {\"text\":\"a\"}\n\n" +
                "event: delta\ndata: {\"text\":\"b\"}\n\n" +
                "event: done\ndata: {}\n\n"
        assertEquals(
            listOf(AiExplainEvent.Delta("a"), AiExplainEvent.Delta("b"), AiExplainEvent.Done("stop", 0, 0)),
            projection.parseExplainStream(body),
        )
    }

    // ── Lifecycle reducer (web useAiStream handleEvent) ──────────────────────────

    @Test
    fun deltaAccumulatesTextAndStreams() {
        val start = idle()
        val afterFirst = projection.reduceExplain(start, AiExplainEvent.Delta("hi"))
        val afterSecond = projection.reduceExplain(afterFirst, AiExplainEvent.Delta(" there"))
        assertEquals(ExplainPhase.Streaming, afterSecond.phase)
        assertEquals("hi there", afterSecond.text)
    }

    @Test
    fun doneCompletesAndErrorFails() {
        val streaming = idle().copy(phase = ExplainPhase.Streaming, text = "narration")
        val done = projection.reduceExplain(streaming, AiExplainEvent.Done("stop", 0, 0))
        assertEquals(ExplainPhase.Done, done.phase)

        val failed = projection.reduceExplain(streaming, AiExplainEvent.Error(message = "boom"))
        assertEquals(ExplainPhase.Error, failed.phase)
        assertEquals("boom", failed.error?.message)
    }

    @Test
    fun toolFramesAreInert() {
        val streaming = idle().copy(phase = ExplainPhase.Streaming, text = "x")
        assertEquals(streaming, projection.reduceExplain(streaming, AiExplainEvent.ToolCall("1", "lookup")))
        assertEquals(streaming, projection.reduceExplain(streaming, AiExplainEvent.ToolResult("1", "lookup", true)))
    }

    @Test
    fun startCoalescesWhileStreamingAndFinishMarksDone() {
        val started = projection.startExplain(idle())
        assertEquals(ExplainPhase.Streaming, started.phase)

        val withText = started.copy(text = "partial")
        assertEquals(withText, projection.startExplain(withText))

        assertEquals(ExplainPhase.Done, projection.finishExplain(withText).phase)
        val alreadyError = idle().copy(phase = ExplainPhase.Error)
        assertEquals(ExplainPhase.Error, projection.finishExplain(alreadyError).phase)
    }

    // ── Surface selection + canStart ─────────────────────────────────────────────

    @Test
    fun surfaceSelectionCoversEveryBranch() {
        assertEquals(ExplainSurface.Hidden, projection.explainSurface(idle().copy(gateEnabled = false)))
        assertEquals(ExplainSurface.Idle, projection.explainSurface(idle()))
        assertEquals(
            ExplainSurface.Streaming,
            projection.explainSurface(idle().copy(phase = ExplainPhase.Streaming)),
        )
        assertEquals(
            ExplainSurface.Content,
            projection.explainSurface(idle().copy(phase = ExplainPhase.Done, text = "done")),
        )
        assertEquals(
            ExplainSurface.Error,
            projection.explainSurface(idle().copy(phase = ExplainPhase.Error, error = ExplainError("x"))),
        )
    }

    @Test
    fun canStartRequiresGateAndNotStreaming() {
        assertTrue(idle().canStart)
        assertFalse(idle().copy(gateEnabled = false).canStart)
        assertFalse(idle().copy(phase = ExplainPhase.Streaming).canStart)
    }

    // ── Error classification ─────────────────────────────────────────────────────

    @Test
    fun errorKindMapsToRecoveryBucket() {
        assertEquals(QueryErrorKind.Network, projection.explainQueryErrorKind(ExplainError("x", ErrorKind.Network)))
        assertEquals(QueryErrorKind.Network, projection.explainQueryErrorKind(ExplainError("x", ErrorKind.Timeout)))
        assertEquals(
            QueryErrorKind.Waiting,
            projection.explainQueryErrorKind(ExplainError("x", ErrorKind.CircuitOpen)),
        )
        assertEquals(
            QueryErrorKind.Unauthorized,
            projection.explainQueryErrorKind(ExplainError("x", ErrorKind.Http, httpStatus = 401)),
        )
        assertEquals(
            QueryErrorKind.ServerError,
            projection.explainQueryErrorKind(ExplainError("x", ErrorKind.Http, httpStatus = 503)),
        )
        assertEquals(QueryErrorKind.ServerError, projection.explainQueryErrorKind(ExplainError("x", kind = null)))
    }

    @Test
    fun networkClassFlagCoversConnectivityKinds() {
        assertTrue(ExplainError("x", ErrorKind.Network).isNetworkClass)
        assertTrue(ExplainError("x", ErrorKind.Timeout).isNetworkClass)
        assertTrue(ExplainError("x", ErrorKind.CircuitOpen).isNetworkClass)
        assertFalse(ExplainError("x", ErrorKind.Http).isNetworkClass)
        assertFalse(ExplainError("x", kind = null).isNetworkClass)
    }

    private fun idle(): AISafetySettingExplainerState = AISafetySettingExplainerState(gateEnabled = true)
}
