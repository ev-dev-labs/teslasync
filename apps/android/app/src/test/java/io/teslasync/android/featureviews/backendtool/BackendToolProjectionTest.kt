package io.teslasync.android.featureviews.backendtool

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pure (off-device) tests for the BackendTool response envelope (the web `apiFetch` return shaping), the
 * render projection ([BackendToolProjection] — the web `loading` flag, the `mutation.data &&` badge gate,
 * and the `data`/`error` result-panel split), and the request descriptor's dev-tools path. Covers every
 * branch the web source defines: idle / running / success / failure, and the web truthiness rules for
 * `data.error` (only a non-empty JSON string counts as a failure).
 */
class BackendToolProjectionTest {
    // ── response envelope (web apiFetch return) ───────────────────────────────────────

    @Test
    fun ofReadsStringErrorFieldFromPayload() {
        val response = BackendToolResponse.of(buildJsonObject { put("error", "boom") })
        assertTrue(response.isError)
        assertEquals("boom", response.error)
    }

    @Test
    fun ofWithoutErrorFieldIsSuccess() {
        val response = BackendToolResponse.of(buildJsonObject { put("authenticated", true) })
        assertFalse(response.isError)
        assertNull(response.error)
    }

    @Test
    fun ofTreatsNonStringErrorFieldAsSuccess() {
        // Web `typeof data.error === 'string'`: a numeric `error` is not a failure.
        val response = BackendToolResponse.of(buildJsonObject { put("error", 503) })
        assertFalse(response.isError)
        assertNull(response.error)
    }

    @Test
    fun emptyErrorStringIsTreatedAsSuccess() {
        // Web truthiness: an empty `error` string is falsy, so it is not a failure.
        val response = BackendToolResponse.of(buildJsonObject { put("error", "") })
        assertFalse(response.isError)
    }

    @Test
    fun ofErrorMarksFailure() {
        val response = BackendToolResponse.ofError("network unreachable")
        assertTrue(response.isError)
        assertEquals("network unreachable", response.error)
    }

    @Test
    fun parseDecodesAJsonObjectBody() {
        val response = BackendToolResponse.parse("""{"baseUrl":"https://example.com","authenticated":true}""")
        assertFalse(response.isError)
        assertEquals("https://example.com", (response.payload["baseUrl"] as kotlinx.serialization.json.JsonPrimitive).content)
    }

    @Test
    fun parseInvalidJsonBecomesAnErrorResponse() {
        val response = BackendToolResponse.parse("not json {{{")
        assertTrue(response.isError)
    }

    @Test
    fun parseNonObjectBodyBecomesAnErrorResponse() {
        val response = BackendToolResponse.parse("[1, 2, 3]")
        assertTrue(response.isError)
    }

    @Test
    fun parsePreservesAnEmbeddedErrorString() {
        val response = BackendToolResponse.parse("""{"error":"already failed"}""")
        assertTrue(response.isError)
        assertEquals("already failed", response.error)
    }

    // ── projection (web render branches) ──────────────────────────────────────────────

    @Test
    fun idleHasNoSpinnerNoBadgeNoResult() {
        val display = BackendToolProjection.project(BackendToolActionState.Idle)
        assertFalse(display.running)
        assertFalse(display.showBadge)
        assertNull(display.outcome)
        assertNull(display.resultData)
        assertNull(display.resultError)
    }

    @Test
    fun runningSetsTheSpinnerFlagOnly() {
        val display = BackendToolProjection.project(BackendToolActionState.Running)
        assertTrue(display.running)
        assertFalse(display.showBadge)
        assertNull(display.resultData)
        assertNull(display.resultError)
    }

    @Test
    fun doneSuccessShowsTheBadgeAndPayload() {
        val payload = buildJsonObject { put("clientId", "ownerapi") }
        val display = BackendToolProjection.project(BackendToolActionState.Done(BackendToolResponse.of(payload)))
        assertFalse(display.running)
        assertTrue(display.showBadge)
        assertEquals(BackendToolOutcome.Success, display.outcome)
        assertSame(payload, display.resultData)
        assertNull(display.resultError)
    }

    @Test
    fun doneFailureShowsTheBadgeAndError() {
        val display =
            BackendToolProjection.project(BackendToolActionState.Done(BackendToolResponse.ofError("503 Service Unavailable")))
        assertFalse(display.running)
        assertTrue(display.showBadge)
        assertEquals(BackendToolOutcome.Failure, display.outcome)
        assertNull(display.resultData)
        assertEquals("503 Service Unavailable", display.resultError)
    }

    @Test
    fun actionStateExposesRunningAndResponseAccessors() {
        assertFalse(BackendToolActionState.Idle.isRunning)
        assertTrue(BackendToolActionState.Running.isRunning)
        assertNull(BackendToolActionState.Idle.response)
        val response = BackendToolResponse.of(buildJsonObject { put("ok", true) })
        assertSame(response, BackendToolActionState.Done(response).response)
    }

    // ── request descriptor (web endpoint/method/body props) ───────────────────────────

    @Test
    fun requestPathNestsTheEndpointUnderDevTools() {
        val request = BackendToolRequest("fleet-api-info")
        assertEquals("/dev-tools/fleet-api-info", request.path)
        assertEquals(BackendToolMethod.Get, request.method)
        assertNull(request.body)
    }

    @Test
    fun requestCarriesMethodAndBody() {
        val body = buildJsonObject { put("domain", "example.com") }
        val request = BackendToolRequest("register-partner", BackendToolMethod.Post, body)
        assertEquals("/dev-tools/register-partner", request.path)
        assertEquals(BackendToolMethod.Post, request.method)
        assertSame(body, request.body)
    }
}
