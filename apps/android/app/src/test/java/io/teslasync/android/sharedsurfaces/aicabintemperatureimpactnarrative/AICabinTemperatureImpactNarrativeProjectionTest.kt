package io.teslasync.android.sharedsurfaces.aicabintemperatureimpactnarrative

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.shared.core.api.generated.Vehicle
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Off-device unit coverage of the pure [AICabinTemperatureImpactNarrativeProjection] — the AI-Off gate
 * (web `useAiEnabled`), the vehicle-scope resolution (web `vehicleId ?? vehicles?.[0]?.id`), the SSE frame
 * parser + delta accumulator (web `parseSSEFrame` + `useAiStream` reducer), the surface selection, and
 * the error-kind classification. Every branch the web source renders is exercised here, with no Android,
 * UI, or network in the loop.
 */
class AICabinTemperatureImpactNarrativeProjectionTest {
    private val projection = AICabinTemperatureImpactNarrativeProjection
    private val featureId = AICabinTemperatureImpactNarrativeRegistration.FEATURE_ID

    // ── Gate (web useAiEnabled, ADR-015 fail-closed) ─────────────────────────────

    @Test
    fun gateEnabledWhenModeOnAndFeatureTrue() {
        val doc =
            buildJsonObject {
                put("ai_mode", JsonPrimitive("local"))
                put("ai_features", buildJsonObject { put(featureId, JsonPrimitive(true)) })
            }
        assertTrue(projection.isCabinNarrativeEnabled(doc))
    }

    @Test
    fun gateDisabledWhenModeOff() {
        val doc =
            buildJsonObject {
                put("ai_mode", JsonPrimitive("off"))
                put("ai_features", buildJsonObject { put(featureId, JsonPrimitive(true)) })
            }
        assertFalse(projection.isCabinNarrativeEnabled(doc))
    }

    @Test
    fun gateDisabledWhenModeMissing() {
        val doc = buildJsonObject { put("ai_features", buildJsonObject { put(featureId, JsonPrimitive(true)) }) }
        assertFalse(projection.isCabinNarrativeEnabled(doc))
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
        assertFalse(projection.isCabinNarrativeEnabled(featureFalse))
        assertFalse(projection.isCabinNarrativeEnabled(featureMissing))
        assertFalse(projection.isCabinNarrativeEnabled(noMap))
    }

    @Test
    fun gateDisabledWhenDocumentNullOrNotObject() {
        assertFalse(projection.isCabinNarrativeEnabled(null))
        assertFalse(projection.isCabinNarrativeEnabled(JsonNull))
        assertFalse(projection.isCabinNarrativeEnabled(JsonPrimitive("not-an-object")))
    }

    // ── Vehicle resolution (web vehicleId ?? vehicles[0].id) ─────────────────────

    @Test
    fun resolveVehiclePrefersPositiveExplicit() {
        assertEquals(7L, projection.resolveVehicleId(explicit = 7L, vehicles = listOf(vehicle(3L))))
    }

    @Test
    fun resolveVehicleFallsBackToFirstWhenExplicitMissingOrNonPositive() {
        assertEquals(3L, projection.resolveVehicleId(explicit = null, vehicles = listOf(vehicle(3L), vehicle(9L))))
        assertEquals(3L, projection.resolveVehicleId(explicit = 0L, vehicles = listOf(vehicle(3L))))
    }

    @Test
    fun resolveVehicleNullWhenNoneUsable() {
        assertNull(projection.resolveVehicleId(explicit = null, vehicles = emptyList()))
        assertNull(projection.resolveVehicleId(explicit = null, vehicles = null))
        assertNull(projection.resolveVehicleId(explicit = 0L, vehicles = listOf(vehicle(0L))))
    }

    // ── SSE frame parsing (web parseSSEFrame + toTypedEvent) ─────────────────────

    @Test
    fun parsesDeltaFrame() {
        val event = projection.parseNarrationFrame("event: delta\ndata: {\"text\":\"hello\"}")
        assertEquals(AiNarrationEvent.Delta("hello"), event)
    }

    @Test
    fun parsesDoneFrameWithUsage() {
        val event =
            projection.parseNarrationFrame(
                "event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":12,\"out\":34}}",
            )
        assertEquals(AiNarrationEvent.Done("stop", 12, 34), event)
    }

    @Test
    fun parsesErrorFrameWithLimitFields() {
        val event =
            projection.parseNarrationFrame(
                "event: error\ndata: {\"message\":\"boom\",\"reason\":\"rate_limit\"," +
                    "\"retry_after_s\":5,\"baseline_available\":true}",
            )
        assertEquals(
            AiNarrationEvent.Error(message = "boom", reason = "rate_limit", retryAfterS = 5, baselineAvailable = true),
            event,
        )
    }

    @Test
    fun ignoresCommentLinesAndKeepsDelta() {
        val event = projection.parseNarrationFrame(":keepalive\nevent: delta\ndata: {\"text\":\"x\"}")
        assertEquals(AiNarrationEvent.Delta("x"), event)
    }

    @Test
    fun returnsNullForUnknownEventMalformedDataOrNoEvent() {
        assertNull(projection.parseNarrationFrame("event: mystery\ndata: {}"))
        assertNull(projection.parseNarrationFrame("event: delta\ndata: {not valid json"))
        assertNull(projection.parseNarrationFrame("data: {\"text\":\"x\"}"))
    }

    @Test
    fun parsesMultiFrameStreamSkippingBlanks() {
        val body =
            "event: delta\ndata: {\"text\":\"a\"}\n\n" +
                "event: delta\ndata: {\"text\":\"b\"}\n\n" +
                "event: done\ndata: {}\n\n"
        assertEquals(
            listOf(AiNarrationEvent.Delta("a"), AiNarrationEvent.Delta("b"), AiNarrationEvent.Done("stop", 0, 0)),
            projection.parseNarrationStream(body),
        )
    }

    // ── Lifecycle reducer (web useAiStream handleEvent) ──────────────────────────

    @Test
    fun deltaAccumulatesTextAndStreams() {
        val start = idle()
        val afterFirst = projection.reduceNarration(start, AiNarrationEvent.Delta("hi"))
        val afterSecond = projection.reduceNarration(afterFirst, AiNarrationEvent.Delta(" there"))
        assertEquals(NarrationPhase.Streaming, afterSecond.phase)
        assertEquals("hi there", afterSecond.text)
    }

    @Test
    fun doneCompletesAndErrorFails() {
        val streaming = idle().copy(phase = NarrationPhase.Streaming, text = "narration")
        val done = projection.reduceNarration(streaming, AiNarrationEvent.Done("stop", 0, 0))
        assertEquals(NarrationPhase.Done, done.phase)

        val failed = projection.reduceNarration(streaming, AiNarrationEvent.Error(message = "boom"))
        assertEquals(NarrationPhase.Error, failed.phase)
        assertEquals("boom", failed.error?.message)
    }

    @Test
    fun toolFramesAreInert() {
        val streaming = idle().copy(phase = NarrationPhase.Streaming, text = "x")
        assertEquals(streaming, projection.reduceNarration(streaming, AiNarrationEvent.ToolCall("1", "lookup")))
        assertEquals(streaming, projection.reduceNarration(streaming, AiNarrationEvent.ToolResult("1", "lookup", true)))
    }

    @Test
    fun startCoalescesWhileStreamingAndFinishMarksDone() {
        val started = projection.startNarration(idle())
        assertEquals(NarrationPhase.Streaming, started.phase)

        val withText = started.copy(text = "partial")
        assertEquals(withText, projection.startNarration(withText))

        assertEquals(NarrationPhase.Done, projection.finishNarration(withText).phase)
        val alreadyError = idle().copy(phase = NarrationPhase.Error)
        assertEquals(NarrationPhase.Error, projection.finishNarration(alreadyError).phase)
    }

    // ── Surface selection + canStart ─────────────────────────────────────────────

    @Test
    fun surfaceSelectionCoversEveryBranch() {
        assertEquals(NarrativeSurface.Hidden, projection.narrativeSurface(idle().copy(gateEnabled = false)))
        assertEquals(NarrativeSurface.Idle, projection.narrativeSurface(idle()))
        assertEquals(
            NarrativeSurface.Streaming,
            projection.narrativeSurface(idle().copy(phase = NarrationPhase.Streaming)),
        )
        assertEquals(
            NarrativeSurface.Content,
            projection.narrativeSurface(idle().copy(phase = NarrationPhase.Done, text = "done")),
        )
        assertEquals(
            NarrativeSurface.Error,
            projection.narrativeSurface(idle().copy(phase = NarrationPhase.Error, error = NarrationError("x"))),
        )
    }

    @Test
    fun canStartRequiresGateVehicleAndNotStreaming() {
        assertTrue(idle().canStart)
        assertFalse(idle().copy(gateEnabled = false).canStart)
        assertFalse(idle().copy(vehicleId = null).canStart)
        assertFalse(idle().copy(phase = NarrationPhase.Streaming).canStart)
    }

    // ── Error classification ─────────────────────────────────────────────────────

    @Test
    fun errorKindMapsToRecoveryBucket() {
        assertEquals(QueryErrorKind.Network, projection.narrationQueryErrorKind(NarrationError("x", ErrorKind.Network)))
        assertEquals(QueryErrorKind.Network, projection.narrationQueryErrorKind(NarrationError("x", ErrorKind.Timeout)))
        assertEquals(
            QueryErrorKind.Waiting,
            projection.narrationQueryErrorKind(NarrationError("x", ErrorKind.CircuitOpen)),
        )
        assertEquals(
            QueryErrorKind.Unauthorized,
            projection.narrationQueryErrorKind(NarrationError("x", ErrorKind.Http, httpStatus = 401)),
        )
        assertEquals(
            QueryErrorKind.ServerError,
            projection.narrationQueryErrorKind(NarrationError("x", ErrorKind.Http, httpStatus = 503)),
        )
        assertEquals(QueryErrorKind.ServerError, projection.narrationQueryErrorKind(NarrationError("x", kind = null)))
    }

    private fun idle(): AICabinTemperatureImpactNarrativeState = AICabinTemperatureImpactNarrativeState(gateEnabled = true, vehicleId = 1L)

    private fun vehicle(id: Long): Vehicle =
        Vehicle(
            createdAt = Instant.fromEpochMilliseconds(0L),
            displayName = "Car",
            enrolledAt = Instant.fromEpochMilliseconds(0L),
            id = id,
            teslaId = id,
            timezone = "UTC",
            updatedAt = Instant.fromEpochMilliseconds(0L),
            vin = "VIN$id",
        )
}
