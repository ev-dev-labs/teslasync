// Off-device unit coverage for [TOUSettingsModalViewModel] over a controllable fake [TOUSettingsModalSource]: the
// submit -> refresh -> close orchestration the web `handleSubmit` owns. Covers the happy path (the close signal, the
// forwarded site id + settings, the fired site-info refresh, no error), the failure path (the verbatim server message
// surfaced, no close, no refresh — web `setError(String(err))`), a failure with no message (web `String(err)` falls
// back to the throwable type), the refresh-must-not-block-close guarantee (a failing refresh still closes), the
// in-flight guard (a second submit while one is running is ignored — web disabled button), the stale-error reset (web
// `handleClose` clears `error`), and the once-only PII-safe `view.opened` diagnostic. No Compose / Android / HTTP —
// runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.tousettingsmodal

import io.teslasync.android.data.NoopLogger
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class TOUSettingsModalViewModelTest {
    private class FakeSource(
        private val updateResult: Result<JsonElement> = Result.success(JsonNull),
        private val refreshResult: Result<JsonElement> = Result.success(JsonNull),
    ) : TOUSettingsModalSource {
        var updateCalls = 0
        var refreshCalls = 0
        var lastSiteId: Long? = null
        var lastSettings: JsonObject? = null
        var hold = false
        val gate = CompletableDeferred<Unit>()

        override suspend fun updateTouSettings(
            siteId: Long,
            settings: JsonObject,
        ): Result<JsonElement> {
            updateCalls++
            lastSiteId = siteId
            lastSettings = settings
            if (hold) gate.await()
            return updateResult
        }

        override suspend fun refreshSiteInfo(siteId: Long): Result<JsonElement> {
            refreshCalls++
            return refreshResult
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
    fun submit_successClosesFiresRefreshAndForwardsSiteAndSettings() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource()
            val vm = viewModel(source)
            val closes = collectCloses(vm)

            vm.submit(SITE_ID, samplePayload())
            advanceUntilIdle()

            assertEquals(1, source.updateCalls)
            assertEquals(SITE_ID, source.lastSiteId)
            assertEquals(samplePayload(), source.lastSettings)
            assertEquals(1, source.refreshCalls)
            assertEquals(1, closes.size)
            assertFalse(vm.submitting.value)
            assertNull(vm.submitError.value)
        }

    @Test
    fun submit_failureSurfacesTheVerbatimMessageAndDoesNotCloseOrRefresh() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(updateResult = Result.failure(IllegalStateException("TOU update failed: 502")))
            val vm = viewModel(source)
            val closes = collectCloses(vm)

            vm.submit(SITE_ID, samplePayload())
            advanceUntilIdle()

            assertEquals("TOU update failed: 502", vm.submitError.value)
            assertTrue(closes.isEmpty())
            assertEquals(0, source.refreshCalls)
            assertFalse(vm.submitting.value)
        }

    @Test
    fun submit_failureWithoutMessageFallsBackToTheThrowableType() =
        runTest(UnconfinedTestDispatcher()) {
            val boom = RuntimeException()
            val vm = viewModel(FakeSource(updateResult = Result.failure(boom)))

            vm.submit(SITE_ID, samplePayload())
            advanceUntilIdle()

            assertEquals(boom.toString(), vm.submitError.value)
        }

    @Test
    fun submit_failingRefreshStillClosesAndShowsNoError() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    updateResult = Result.success(JsonNull),
                    refreshResult = Result.failure(IllegalStateException("refresh exploded")),
                )
            val vm = viewModel(source)
            val closes = collectCloses(vm)

            vm.submit(SITE_ID, samplePayload())
            advanceUntilIdle()

            assertEquals(1, closes.size)
            assertEquals(1, source.refreshCalls)
            assertNull(vm.submitError.value)
        }

    @Test
    fun submit_whileInFlightIsIgnored() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource().apply { hold = true }
            val vm = viewModel(source)

            vm.submit(SITE_ID, samplePayload())
            assertTrue(vm.submitting.value)
            vm.submit(SITE_ID, samplePayload())
            assertEquals(1, source.updateCalls)

            source.gate.complete(Unit)
            advanceUntilIdle()
            assertFalse(vm.submitting.value)
            assertEquals(1, source.updateCalls)
            assertEquals(1, source.refreshCalls)
        }

    @Test
    fun resetSubmitError_clearsAStaleServerError() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(updateResult = Result.failure(IllegalStateException("nope"))))

            vm.submit(SITE_ID, samplePayload())
            advanceUntilIdle()
            assertEquals("nope", vm.submitError.value)

            vm.resetSubmitError()
            assertNull(vm.submitError.value)
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
            assertEquals(mapOf("surface" to "TOUSettingsModal"), opened.single().second)
        }

    private fun TestScope.viewModel(
        source: TOUSettingsModalSource,
        logger: Logger = NoopLogger,
    ): TOUSettingsModalViewModel = TOUSettingsModalViewModel(source, logger, backgroundScope)

    private fun TestScope.collectCloses(vm: TOUSettingsModalViewModel): List<Unit> {
        val out = mutableListOf<Unit>()
        backgroundScope.launch { vm.closed.collect { out += it } }
        return out
    }

    private fun samplePayload(): JsonObject = TOUSettingsModalProjection.presets.first().settings

    private companion object {
        const val SITE_ID = 4242L
    }
}
