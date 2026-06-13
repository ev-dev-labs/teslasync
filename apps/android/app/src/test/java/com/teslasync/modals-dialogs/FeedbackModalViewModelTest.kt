// Off-device unit coverage for [FeedbackModalViewModel] over a controllable fake [FeedbackModalSource]: the
// validate -> submit -> close orchestration the web `onSubmit` owns. Covers the happy path (the close signal + the
// assembled payload, no submit error), the client-side validity guard (an invalid draft sends no request, mirroring
// the web disabled submit), the failure path (the inline submit-error flag set, no close — web `submit.isError`), the
// in-flight guard (a second submit while one is running is ignored — web disabled button), the stale-error reset (web
// `submit.reset()` on re-open), and the once-only PII-safe `view.opened` diagnostic. No Compose / Android / HTTP —
// runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.feedbackmodal

import io.teslasync.android.data.NoopLogger
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.feedback.FeedbackEntry
import io.teslasync.shared.core.presentation.feedback.FeedbackSubmitInput
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
class FeedbackModalViewModelTest {
    private class FakeSource(
        private val result: Result<FeedbackEntry> = Result.success(sampleEntry()),
    ) : FeedbackModalSource {
        var calls = 0
        var lastInput: FeedbackSubmitInput? = null
        var hold = false
        val gate = CompletableDeferred<Unit>()

        override suspend fun submitFeedback(input: FeedbackSubmitInput): Result<FeedbackEntry> {
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
    fun submit_validDraftSubmitsAndClosesWithoutError() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource()
            val vm = viewModel(source)
            val closes = collectCloses(vm)

            vm.submit(validDraft(), validContext())
            advanceUntilIdle()

            assertEquals(1, source.calls)
            assertEquals("bug", source.lastInput?.category)
            assertEquals("Battery widget shows NaN", source.lastInput?.title)
            assertEquals("/battery", source.lastInput?.pageRoute)
            assertEquals(1, closes.size)
            assertFalse(vm.submitting.value)
            assertFalse(vm.submitError.value)
        }

    @Test
    fun submit_invalidDraftSendsNoRequestAndDoesNotClose() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource()
            val vm = viewModel(source)
            val closes = collectCloses(vm)

            vm.submit(FeedbackDraft(title = "no", body = "short"), validContext())
            advanceUntilIdle()

            assertEquals(0, source.calls)
            assertTrue(closes.isEmpty())
            assertFalse(vm.submitError.value)
            assertFalse(vm.submitting.value)
        }

    @Test
    fun submit_failureSetsInlineErrorAndDoesNotClose() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(Result.failure(IllegalStateException("server exploded")))
            val vm = viewModel(source)
            val closes = collectCloses(vm)

            vm.submit(validDraft(), validContext())
            advanceUntilIdle()

            assertTrue(vm.submitError.value)
            assertTrue(closes.isEmpty())
            assertFalse(vm.submitting.value)
        }

    @Test
    fun submit_whileInFlightIsIgnored() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource().apply { hold = true }
            val vm = viewModel(source)

            vm.submit(validDraft(), validContext())
            assertTrue(vm.submitting.value)
            vm.submit(validDraft(), validContext())
            assertEquals(1, source.calls)

            source.gate.complete(Unit)
            advanceUntilIdle()
            assertFalse(vm.submitting.value)
            assertEquals(1, source.calls)
        }

    @Test
    fun resetSubmitError_clearsAStaleInlineError() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(Result.failure(IllegalStateException("nope")))
            val vm = viewModel(source)

            vm.submit(validDraft(), validContext())
            advanceUntilIdle()
            assertTrue(vm.submitError.value)

            vm.resetSubmitError()
            assertFalse(vm.submitError.value)
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
            assertEquals(mapOf("surface" to "FeedbackModal"), opened.single().second)
        }

    private fun TestScope.viewModel(
        source: FeedbackModalSource,
        logger: Logger = NoopLogger,
    ): FeedbackModalViewModel = FeedbackModalViewModel(source, logger, backgroundScope)

    private fun TestScope.collectCloses(vm: FeedbackModalViewModel): List<Unit> {
        val out = mutableListOf<Unit>()
        backgroundScope.launch { vm.closed.collect { out += it } }
        return out
    }

    private fun validDraft(): FeedbackDraft =
        FeedbackDraft(
            category = FeedbackCategory.Bug,
            title = "Battery widget shows NaN",
            body = "The battery widget renders NaN after a charge completes.",
        )

    private fun validContext(): FeedbackContext = FeedbackContext(pageRoute = "/battery", appVersion = "1.0.0")

    private companion object {
        fun sampleEntry(): FeedbackEntry =
            FeedbackEntry(
                id = 1L,
                createdAt = "2026-01-01T00:00:00Z",
                category = "bug",
                title = "Battery widget shows NaN",
                body = "The battery widget renders NaN after a charge completes.",
                status = "new",
            )
    }
}
