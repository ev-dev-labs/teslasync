package io.teslasync.android.featureviews.infrastructure

import io.teslasync.android.data.ErrorKind
import io.teslasync.shared.core.net.ApiError
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device unit tests for the pure Infrastructure model + projection (the gate's "adapter unit test").
 * Covers the web `mutation.data.error ? 'Failed' : 'Success'` truthiness rules, the transport-failure
 * branch, the JSON pretty-printer, the tool catalog (order / endpoints / MQTT input flag), and the
 * per-tool state container — every branch the composable renders, verified without a device.
 */
class InfrastructureSectionProjectionTest {
    // ── projectRun: success / error bodies ──────────────────────────────────────
    @Test
    fun successPayloadProjectsToSucceeded() {
        val body = buildJsonObject { put("tables", JsonPrimitive(3)) }
        val run = InfrastructureSectionProjection.projectRun(Result.success(body))
        assertEquals(RunPhase.Succeeded, run.phase)
        assertEquals(body, run.result)
        assertNull(run.errorDetail)
        assertNull(run.errorKind)
        assertFalse(run.isOffline)
    }

    @Test
    fun backendErrorStringProjectsToFailedWithVerbatimDetail() {
        val body = buildJsonObject { put("error", JsonPrimitive("connection refused")) }
        val run = InfrastructureSectionProjection.projectRun(Result.success(body))
        assertEquals(RunPhase.Failed, run.phase)
        assertEquals("connection refused", run.errorDetail)
        assertNull(run.result)
    }

    @Test
    fun nonStringTruthyErrorIsFailedWithoutDetail() {
        val body = buildJsonObject { put("error", JsonPrimitive(true)) }
        val run = InfrastructureSectionProjection.projectRun(Result.success(body))
        assertEquals(RunPhase.Failed, run.phase)
        assertNull(run.errorDetail)
    }

    @Test
    fun falsyErrorValuesAreSuccess() {
        val empty = buildJsonObject { put("error", JsonPrimitive("")) }
        val nullErr = buildJsonObject { put("error", JsonNull) }
        val zero = buildJsonObject { put("error", JsonPrimitive(0)) }
        val falseErr = buildJsonObject { put("error", JsonPrimitive(false)) }
        for (body in listOf(empty, nullErr, zero, falseErr)) {
            assertEquals(RunPhase.Succeeded, InfrastructureSectionProjection.projectRun(Result.success(body)).phase)
        }
    }

    @Test
    fun structuralTruthyErrorsAreFailed() {
        val number = buildJsonObject { put("error", JsonPrimitive(5)) }
        val obj = buildJsonObject { put("error", buildJsonObject { put("k", JsonPrimitive("v")) }) }
        val arr = buildJsonObject { put("error", buildJsonArray { add(JsonPrimitive("x")) }) }
        for (body in listOf(number, obj, arr)) {
            assertEquals(RunPhase.Failed, InfrastructureSectionProjection.projectRun(Result.success(body)).phase)
        }
    }

    @Test
    fun missingErrorFieldAndNonObjectBodyAreSuccess() {
        val noError = buildJsonObject { put("ok", JsonPrimitive(true)) }
        val arrayBody = buildJsonArray { add(JsonPrimitive(1)) }
        assertFalse(InfrastructureSectionProjection.hasTruthyError(noError))
        assertFalse(InfrastructureSectionProjection.hasTruthyError(arrayBody))
        assertEquals(RunPhase.Succeeded, InfrastructureSectionProjection.projectRun(Result.success(arrayBody)).phase)
    }

    // ── projectRun: transport failures ──────────────────────────────────────────
    @Test
    fun networkFailureIsOfflineFailed() {
        val run = InfrastructureSectionProjection.projectRun(Result.failure(ApiError.Network()))
        assertEquals(RunPhase.Failed, run.phase)
        assertEquals(ErrorKind.Network, run.errorKind)
        assertTrue(run.isOffline)
    }

    @Test
    fun timeoutAndCircuitOpenAreOffline() {
        assertTrue(InfrastructureSectionProjection.projectRun(Result.failure(ApiError.Timeout())).isOffline)
        assertTrue(InfrastructureSectionProjection.projectRun(Result.failure(ApiError.CircuitOpen())).isOffline)
    }

    @Test
    fun httpFailureIsFailedButNotOffline() {
        val run = InfrastructureSectionProjection.projectRun(Result.failure(ApiError.Http(status = 500)))
        assertEquals(RunPhase.Failed, run.phase)
        assertEquals(ErrorKind.Http, run.errorKind)
        assertFalse(run.isOffline)
    }

    // ── helpers ─────────────────────────────────────────────────────────────────
    @Test
    fun errorStringOrNullReturnsStringElseNull() {
        val str = buildJsonObject { put("error", JsonPrimitive("boom")) }
        val bool = buildJsonObject { put("error", JsonPrimitive(true)) }
        val none = buildJsonObject { put("ok", JsonPrimitive(1)) }
        assertEquals("boom", InfrastructureSectionProjection.errorStringOrNull(str))
        assertNull(InfrastructureSectionProjection.errorStringOrNull(bool))
        assertNull(InfrastructureSectionProjection.errorStringOrNull(none))
    }

    @Test
    fun prettyJsonUsesTwoSpaceIndent() {
        val body = buildJsonObject { put("a", JsonPrimitive(1)) }
        val pretty = InfrastructureSectionProjection.prettyJson(body)
        assertTrue(pretty.startsWith("{"))
        assertTrue(pretty.contains("\n  \"a\": 1"))
    }

    // ── tool catalog ──────────────────────────────────────────────────────────
    @Test
    fun toolCatalogMatchesWebOrderEndpointsAndInputFlag() {
        assertEquals(
            listOf(InfraTool.DbStats, InfraTool.Migrations, InfraTool.MqttTest, InfraTool.EnvCheck, InfraTool.Runtime),
            InfraTool.entries.toList(),
        )
        assertEquals("db-stats", InfraTool.DbStats.endpoint)
        assertEquals("migration-status", InfraTool.Migrations.endpoint)
        assertEquals("mqtt-test", InfraTool.MqttTest.endpoint)
        assertEquals("env-check", InfraTool.EnvCheck.endpoint)
        assertEquals("runtime-info", InfraTool.Runtime.endpoint)
        // Only the MQTT tool collects input / issues a POST; the rest are bodyless GETs.
        assertTrue(InfraTool.MqttTest.needsInput)
        assertTrue(InfraTool.MqttTest.post)
        assertTrue(InfraTool.entries.filter { it != InfraTool.MqttTest }.none { it.needsInput || it.post })
    }

    // ── state container ──────────────────────────────────────────────────────────
    @Test
    fun stateDefaultsEveryToolToIdleAndReplacesOne() {
        val initial = InfrastructureSectionState.initial()
        assertTrue(InfraTool.entries.all { initial.runOf(it).isIdle })

        val updated = initial.with(InfraTool.DbStats, ToolRun(phase = RunPhase.Running))
        assertTrue(updated.runOf(InfraTool.DbStats).isRunning)
        // Other tools are untouched.
        assertTrue(updated.runOf(InfraTool.Runtime).isIdle)
    }

    @Test
    fun offlineFlagOnlyForConnectivityKinds() {
        assertTrue(ToolRun(phase = RunPhase.Failed, errorKind = ErrorKind.Network).isOffline)
        assertTrue(ToolRun(phase = RunPhase.Failed, errorKind = ErrorKind.Timeout).isOffline)
        assertTrue(ToolRun(phase = RunPhase.Failed, errorKind = ErrorKind.CircuitOpen).isOffline)
        assertFalse(ToolRun(phase = RunPhase.Failed, errorKind = ErrorKind.Http).isOffline)
        assertFalse(ToolRun(phase = RunPhase.Failed, errorKind = ErrorKind.Decode).isOffline)
        assertFalse(ToolRun(phase = RunPhase.Succeeded).isOffline)
    }
}
