package io.teslasync.android.featureviews.infrastructure

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests [InfrastructureSectionViewModel] against the [InfrastructureSectionSource] seam with a fake — every
 * outcome the web tools render (success payload, a 2xx `{error}` body, a transport/offline failure), the
 * MQTT topic+message pass-through, the "ignore a second tap while running" guard, and the one-shot
 * `view.opened` diagnostic with the surface slug.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class InfrastructureSectionViewModelTest {
    @Test
    fun runSuccessProjectsResultAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val payload = buildJsonObject { put("tables", JsonPrimitive(7)) }
            val logger = RecordingLogger()
            val vm =
                InfrastructureSectionViewModel(FakeSource(mapOf(InfraTool.DbStats to Result.success(payload))), logger, backgroundScope)

            vm.run(InfraTool.DbStats)
            advanceUntilIdle()

            val run = vm.state.value.runOf(InfraTool.DbStats)
            assertEquals(RunPhase.Succeeded, run.phase)
            assertEquals(payload, run.result)
            assertTrue(logger.records.any { it.event == "infrastructure.run" })
            assertTrue(logger.records.any { it.event == "infrastructure.run.ok" })
        }

    @Test
    fun runBackendErrorBodyIsFailed() =
        runTest(UnconfinedTestDispatcher()) {
            val body = buildJsonObject { put("error", JsonPrimitive("nope")) }
            val vm =
                InfrastructureSectionViewModel(
                    FakeSource(mapOf(InfraTool.Migrations to Result.success(body))),
                    RecordingLogger(),
                    backgroundScope,
                )

            vm.run(InfraTool.Migrations)
            advanceUntilIdle()

            val run = vm.state.value.runOf(InfraTool.Migrations)
            assertEquals(RunPhase.Failed, run.phase)
            assertEquals("nope", run.errorDetail)
        }

    @Test
    fun runTransportFailureIsOfflineAndLogsFail() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm =
                InfrastructureSectionViewModel(
                    FakeSource(mapOf(InfraTool.EnvCheck to Result.failure(ApiError.Network()))),
                    logger,
                    backgroundScope,
                )

            vm.run(InfraTool.EnvCheck)
            advanceUntilIdle()

            val run = vm.state.value.runOf(InfraTool.EnvCheck)
            assertEquals(RunPhase.Failed, run.phase)
            assertTrue(run.isOffline)
            val fail = logger.records.first { it.event == "infrastructure.run.fail" }
            assertEquals("Network", fail.fields["kind"])
            assertEquals("env-check", fail.fields["tool"])
        }

    @Test
    fun mqttRunPassesTopicAndMessage() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(mapOf(InfraTool.MqttTest to Result.success(buildJsonObject {})))
            val vm = InfrastructureSectionViewModel(source, RecordingLogger(), backgroundScope)

            vm.run(InfraTool.MqttTest, topic = "test/topic", message = "{\"k\":1}")
            advanceUntilIdle()

            assertEquals("test/topic", source.lastTopic)
            assertEquals("{\"k\":1}", source.lastMessage)
            assertEquals(
                RunPhase.Succeeded,
                vm.state.value
                    .runOf(InfraTool.MqttTest)
                    .phase,
            )
        }

    @Test
    fun ignoresSecondRunWhileRunning() =
        runTest(UnconfinedTestDispatcher()) {
            val gate = CompletableDeferred<Unit>()
            val source =
                FakeSource(mapOf(InfraTool.DbStats to Result.success(buildJsonObject {})), gate = gate)
            val vm = InfrastructureSectionViewModel(source, RecordingLogger(), backgroundScope)

            vm.run(InfraTool.DbStats)
            assertEquals(
                RunPhase.Running,
                vm.state.value
                    .runOf(InfraTool.DbStats)
                    .phase,
            )
            vm.run(InfraTool.DbStats) // ignored — already running
            assertEquals(1, source.calls.count { it == InfraTool.DbStats })

            gate.complete(Unit)
            advanceUntilIdle()
            assertEquals(
                RunPhase.Succeeded,
                vm.state.value
                    .runOf(InfraTool.DbStats)
                    .phase,
            )
            assertEquals(1, source.calls.count { it == InfraTool.DbStats })
        }

    @Test
    fun viewOpenedEmitsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = InfrastructureSectionViewModel(FakeSource(), logger, backgroundScope)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("InfrastructureSection", opened.first().fields["slug"])
            assertFalse(opened.first().fields.containsKey("payload"))
        }

    // ── fakes ─────────────────────────────────────────────────────────────────
    private class FakeSource(
        private val outcomes: Map<InfraTool, Result<JsonElement>> = emptyMap(),
        private val gate: CompletableDeferred<Unit>? = null,
    ) : InfrastructureSectionSource {
        val calls = mutableListOf<InfraTool>()
        var lastTopic: String? = null
            private set
        var lastMessage: String? = null
            private set

        private suspend fun handle(tool: InfraTool): Result<JsonElement> {
            calls.add(tool)
            gate?.await()
            return outcomes[tool] ?: Result.success(buildJsonObject {})
        }

        override suspend fun dbStats(): Result<JsonElement> = handle(InfraTool.DbStats)

        override suspend fun migrationStatus(): Result<JsonElement> = handle(InfraTool.Migrations)

        override suspend fun mqttTest(
            topic: String,
            message: String,
        ): Result<JsonElement> {
            lastTopic = topic
            lastMessage = message
            return handle(InfraTool.MqttTest)
        }

        override suspend fun envCheck(): Result<JsonElement> = handle(InfraTool.EnvCheck)

        override suspend fun runtimeInfo(): Result<JsonElement> = handle(InfraTool.Runtime)
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records.add(LogRecord(level, event, fields))
        }
    }
}
