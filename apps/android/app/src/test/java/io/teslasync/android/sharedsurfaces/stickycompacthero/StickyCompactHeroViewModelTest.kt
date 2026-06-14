// Tests [StickyCompactHeroViewModel] against the status-feed seam — covering the contract the view depends on: the
// status feed re-shares onto a lifecycle-aware [io.teslasync.android.data.UiState] seeded as loading and surfaces
// content/error; refresh logs a slug-only PII-safe event; and the one-shot view.opened fires exactly once with
// the surface slug. The framework-free projection is covered by its own tests. Runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.stickycompacthero

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class StickyCompactHeroViewModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    private val stamp = 1_700_000_000_000L

    private fun success(status: HeroStatus): Resource<HeroStatus> = Resource.Success(status, stamp, false)

    private fun source(status: Flow<Resource<HeroStatus>> = flowOf(success(HeroStatus.Healthy))): StickyCompactHeroSource =
        stickyCompactHeroSource(status = { status })

    // ── status feed → UiState ───────────────────────────────────────────────────────────────────────────────────

    @Test
    fun stateSeedsAsLoadingBeforeAnyEmission() =
        runTest(UnconfinedTestDispatcher()) {
            val model = StickyCompactHeroViewModel(source(status = flowOf()), RecordingLogger(), backgroundScope)
            assertTrue(model.state.value.isLoading)
        }

    @Test
    fun stateReflectsAResolvedStatus() =
        runTest(UnconfinedTestDispatcher()) {
            val model = StickyCompactHeroViewModel(source(), RecordingLogger(), backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            assertTrue(model.state.value.isContent)
            assertEquals(HeroStatus.Healthy, model.state.value.data)
        }

    @Test
    fun stateReflectsAHardError() =
        runTest(UnconfinedTestDispatcher()) {
            val errored =
                source(status = flowOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = RuntimeException("x"))))
            val model = StickyCompactHeroViewModel(errored, RecordingLogger(), backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            assertTrue(model.state.value.isError)
        }

    // ── diagnostics + refresh ───────────────────────────────────────────────────────────────────────────────────

    @Test
    fun refreshLogsASlugOnlyEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = StickyCompactHeroViewModel(source(), logger, backgroundScope)

            model.refresh()

            val refresh = logger.records.filter { it.event == "stickyCompactHero.refresh" }
            assertEquals(1, refresh.size)
            assertEquals(mapOf("surface" to "StickyCompactHero"), refresh.single().fields)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = StickyCompactHeroViewModel(source(), logger, backgroundScope)

            model.recordViewOpened()
            model.recordViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("StickyCompactHero", opened.first().fields["surface"])
            assertTrue("diagnostics carry only the surface slug", opened.first().fields.keys == setOf("surface"))
        }
}
