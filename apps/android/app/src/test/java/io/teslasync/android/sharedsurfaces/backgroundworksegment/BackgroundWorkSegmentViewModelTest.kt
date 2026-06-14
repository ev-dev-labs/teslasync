// Tests [BackgroundWorkSegmentViewModel] against the real fold seam — covering the work states the segment
// renders and the contract the view depends on: a successful export fetch with rows folds to content; an
// empty fetch with nothing registered folds to the empty surface; a hard error with no cache folds to the
// retry surface; an error that still has cached rows folds to the offline / last-known surface; registered
// mutation / custom work is merged in; retry re-collects the feed and logs the PII-safe diagnostic (slug only,
// never a job label); and the one-shot `view.opened` fires exactly once. The framework-free model is covered
// by BackgroundWorkSegmentModelTest. Runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.backgroundworksegment

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class BackgroundWorkSegmentViewModelTest {
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

    private fun source(feed: () -> Flow<Resource<List<BackgroundJob>>>): BackgroundExportsSource = backgroundExportsSource(feed)

    private fun registry() = BackgroundJobRegistry(now = { "2026-06-13T09:00:00Z" })

    private fun exportJob(id: String) =
        BackgroundJob(
            id = id,
            kind = BackgroundJobKind.Export,
            startedAtIso = "2026-06-13T10:00:00Z",
            label = "export.csv",
            detail = ExportProgress.Processing,
        )

    @Test
    fun stateReflectsRunningWorkAsContent() =
        runTest(UnconfinedTestDispatcher()) {
            val src = source { flowOf(Resource.Success(listOf(exportJob("export:1")), fetchedAt = 1L, stale = false)) }
            val model = BackgroundWorkSegmentViewModel(src, registry(), RecordingLogger(), backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            val state = model.state.value
            assertEquals(WorkPhase.Content, state.phase)
            assertEquals(1, state.count)
            assertFalse(state.stale)
        }

    @Test
    fun stateReflectsAResolvedEmptyFeedAsEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val src = source { flowOf(Resource.Success(emptyList(), fetchedAt = 1L, stale = false)) }
            val model = BackgroundWorkSegmentViewModel(src, registry(), RecordingLogger(), backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            assertEquals(WorkPhase.Empty, model.state.value.phase)
        }

    @Test
    fun stateReflectsAHardErrorWithNoCacheAsError() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                source {
                    flowOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = RuntimeException("boom")))
                }
            val model = BackgroundWorkSegmentViewModel(src, registry(), RecordingLogger(), backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            assertEquals(WorkPhase.Error, model.state.value.phase)
        }

    @Test
    fun stateReflectsOfflineWhenAnErrorStillHasCachedRows() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                source {
                    flowOf(
                        Resource.Error(
                            cached = listOf(exportJob("export:1")),
                            fetchedAt = 5L,
                            stale = true,
                            error = RuntimeException("offline"),
                        ),
                    )
                }
            val model = BackgroundWorkSegmentViewModel(src, registry(), RecordingLogger(), backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            val state = model.state.value
            assertEquals(WorkPhase.Content, state.phase)
            assertTrue("the cached row keeps showing", state.hasJobs)
            assertTrue("flagged offline / last known", state.offline)
        }

    @Test
    fun registeredMutationWorkIsMergedIntoTheState() =
        runTest(UnconfinedTestDispatcher()) {
            val registry = registry()
            val src = source { flowOf(Resource.Success(emptyList(), fetchedAt = 1L, stale = false)) }
            val model = BackgroundWorkSegmentViewModel(src, registry, RecordingLogger(), backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()
            assertEquals(WorkPhase.Empty, model.state.value.phase)

            registry.register("save", kind = BackgroundJobKind.Mutation, label = "Saving…")
            advanceUntilIdle()

            val state = model.state.value
            assertEquals(WorkPhase.Content, state.phase)
            assertEquals("save", state.jobs.single().id)
        }

    @Test
    fun retryReCollectsTheFeedAndLogsPiiSafeDiagnostic() =
        runTest(UnconfinedTestDispatcher()) {
            var collections = 0
            val logger = RecordingLogger()
            val src =
                source {
                    flow {
                        collections++
                        emit(Resource.Success(listOf(exportJob("export:1")), fetchedAt = collections.toLong(), stale = false))
                    }
                }
            val model = BackgroundWorkSegmentViewModel(src, registry(), logger, backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()
            assertEquals(1, collections)

            model.retry()
            advanceUntilIdle()
            assertEquals("retry re-collects the cache-then-network feed", 2, collections)

            val record = logger.records.single { it.event == "backgroundWork.retry" }
            assertEquals(mapOf("surface" to "BackgroundWorkSegment"), record.fields)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model =
                BackgroundWorkSegmentViewModel(
                    source = source { flowOf(Resource.Success(emptyList(), fetchedAt = 1L, stale = false)) },
                    registry = registry(),
                    logger = logger,
                    scope = backgroundScope,
                )

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("BackgroundWorkSegment", opened.first().fields["surface"])
        }
}
