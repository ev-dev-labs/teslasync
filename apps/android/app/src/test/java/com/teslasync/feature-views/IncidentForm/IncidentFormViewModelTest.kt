// Off-device unit coverage for [IncidentFormViewModel] over a controllable fake [IncidentFormSource]: the
// validate -> create -> toast -> close orchestration the web `handleSubmit` owns. Covers the happy path (success
// toast + close signal + the assembled payload), the client-side title guard (validation toast, no request), the
// failure path (failure toast carrying the server message, no close), the in-flight guard (a second submit while one
// is running is ignored, web disabled button), and the once-only PII-safe `view.opened` diagnostic. No Compose /
// Android / HTTP — runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.incidentform

import io.teslasync.android.data.NoopLogger
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.incidents.CreateIncidentInput
import io.teslasync.shared.core.presentation.incidents.Incident
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class IncidentFormViewModelTest {
    private class FakeSource(
        private val result: Result<Incident> = Result.success(sampleIncident()),
    ) : IncidentFormSource {
        var calls = 0
        var lastInput: CreateIncidentInput? = null
        var hold = false
        val gate = CompletableDeferred<Unit>()

        override suspend fun createIncident(input: CreateIncidentInput): Result<Incident> {
            calls++
            lastInput = input
            if (hold) gate.await()
            return result
        }
    }

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    @Test
    fun submit_validDraftCreatesEmitsLoggedAndCloses() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource()
            val vm = viewModel(source)
            val toasts = collectToasts(vm)
            val closes = collectCloses(vm)

            vm.submit(IncidentDraft(title = "Wall connector down", severity = IncidentSeverity.Major))
            advanceUntilIdle()

            assertEquals(1, source.calls)
            assertEquals("Wall connector down", source.lastInput?.title)
            assertEquals("major", source.lastInput?.severity)
            assertEquals(listOf(IncidentFormToast.Logged), toasts)
            assertEquals(1, closes.size)
            assertFalse(vm.submitting.value)
        }

    @Test
    fun submit_shortTitleEmitsValidationAndSkipsRequest() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource()
            val vm = viewModel(source)
            val toasts = collectToasts(vm)
            val closes = collectCloses(vm)

            vm.submit(IncidentDraft(title = "ab"))
            advanceUntilIdle()

            assertEquals(0, source.calls)
            assertEquals(listOf(IncidentFormToast.ValidationTitleTooShort), toasts)
            assertTrue(closes.isEmpty())
            assertFalse(vm.submitting.value)
        }

    @Test
    fun submit_failureEmitsSubmitFailedWithServerMessageAndDoesNotClose() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(Result.failure(IllegalStateException("server exploded")))
            val vm = viewModel(source)
            val toasts = collectToasts(vm)
            val closes = collectCloses(vm)

            vm.submit(IncidentDraft(title = "Telemetry stalled"))
            advanceUntilIdle()

            assertEquals(listOf(IncidentFormToast.SubmitFailed("server exploded")), toasts)
            assertTrue(closes.isEmpty())
            assertFalse(vm.submitting.value)
        }

    @Test
    fun submit_whileInFlightIsIgnored() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource().apply { hold = true }
            val vm = viewModel(source)
            collectToasts(vm)

            vm.submit(IncidentDraft(title = "First incident"))
            assertTrue(vm.submitting.value)
            vm.submit(IncidentDraft(title = "Second incident"))
            assertEquals(1, source.calls)

            source.gate.complete(Unit)
            advanceUntilIdle()
            assertFalse(vm.submitting.value)
            assertEquals(1, source.calls)
        }

    @Test
    fun onViewOpened_emitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "IncidentForm"), opened.single().second)
        }

    private fun TestScope.viewModel(
        source: IncidentFormSource,
        logger: Logger = NoopLogger,
    ): IncidentFormViewModel = IncidentFormViewModel(source, logger, backgroundScope)

    private fun TestScope.collectToasts(vm: IncidentFormViewModel): List<IncidentFormToast> {
        val out = mutableListOf<IncidentFormToast>()
        backgroundScope.launch { vm.toasts.collect { out += it } }
        return out
    }

    private fun TestScope.collectCloses(vm: IncidentFormViewModel): List<Unit> {
        val out = mutableListOf<Unit>()
        backgroundScope.launch { vm.closed.collect { out += it } }
        return out
    }

    private companion object {
        fun sampleIncident(id: Long = 1L): Incident =
            Incident(
                id = id,
                title = "Logged",
                description = "",
                severity = "minor",
                status = "investigating",
                source = "manual",
                startedAt = "2026-01-01T00:00:00Z",
                createdAt = "2026-01-01T00:00:00Z",
                updatedAt = "2026-01-01T00:00:00Z",
            )
    }
}
