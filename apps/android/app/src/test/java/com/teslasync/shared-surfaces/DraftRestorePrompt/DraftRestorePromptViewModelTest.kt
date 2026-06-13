// Off-device unit tests for [DraftRestorePromptViewModel] and the production [DraftRegistry] over a
// controllable fake source (the :android:testReleaseUnitTest gate). They cover the draft feed's
// loading → content → empty → offline state mapping, Discard / Discard-all delegation and PII-safe failure
// logging, the per-session dismiss/resume one-shot guard (web `sessionStorage`), the retry re-read, the one
// `view.opened` diagnostic, and the registry's reactive record / discard / discard-all (web
// `subscribeDraftIndex` keeping observers in sync). Mirrors the web component's client-side state machine
// (web/src/components/feedback/DraftRestorePrompt.tsx); the framework-free model is covered by
// DraftRestorePromptModelTest.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.draftrestoreprompt

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.onStart
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
class DraftRestorePromptViewModelTest {
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

    /** A fake draft seam whose [feed] the test fully controls (real registry ↔ test fake, never the network). */
    private class FakeDraftSource(
        initial: Resource<List<DraftRecord>> = Resource.Loading(cached = null, fetchedAt = null, stale = false),
    ) : DraftRestorePromptSource {
        val feed = MutableStateFlow(initial)
        val discarded = mutableListOf<String>()
        var discardAllCount = 0
        var subscriptions = 0
        var discardResult: Result<Unit> = Result.success(Unit)

        override fun drafts(): Flow<Resource<List<DraftRecord>>> = feed.onStart { subscriptions++ }

        override suspend fun discard(storageKey: String): Result<Unit> {
            discarded += storageKey
            return discardResult
        }

        override suspend fun discardAll(): Result<Unit> {
            discardAllCount++
            return discardResult
        }
    }

    /** Builds the holder and keeps its `WhileSubscribed` feed hot so `.value` reflects every emission. */
    private fun TestScope.startedViewModel(
        source: DraftRestorePromptSource,
        logger: Logger = RecordingLogger(),
    ): DraftRestorePromptViewModel {
        val viewModel = DraftRestorePromptViewModel(source, logger, backgroundScope)
        backgroundScope.launch { viewModel.drafts.collect {} }
        return viewModel
    }

    @Test
    fun feedTransitionsFromLoadingToContent() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeDraftSource()
            val viewModel = startedViewModel(source)
            advanceUntilIdle()
            assertTrue("first read with no cache is loading", viewModel.drafts.value.isLoading)

            source.feed.value = Resource.Success(listOf(NEWER, OLDER), fetchedAt = 100L, stale = false)
            advanceUntilIdle()
            assertTrue(viewModel.drafts.value.isContent)
            assertEquals(
                2,
                viewModel.drafts.value.data
                    ?.size,
            )
        }

    @Test
    fun feedProjectsEmptyWhenNoDrafts() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeDraftSource(Resource.Success(emptyList(), fetchedAt = 1L, stale = false))
            val viewModel = startedViewModel(source)
            advanceUntilIdle()
            assertTrue(viewModel.drafts.value.isEmpty)
        }

    @Test
    fun failedRefreshKeepsCachedDraftsAsOffline() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeDraftSource(
                    Resource.Error(
                        cached = listOf(NEWER),
                        fetchedAt = 50L,
                        stale = true,
                        error = RuntimeException("down"),
                    ),
                )
            val viewModel = startedViewModel(source)
            advanceUntilIdle()
            assertTrue("cached drafts stay visible", viewModel.drafts.value.isContent)
            assertTrue(viewModel.drafts.value.stale)
            assertTrue(viewModel.drafts.value.hasError)
        }

    @Test
    fun discardDelegatesToTheSource() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeDraftSource(Resource.Success(listOf(NEWER), fetchedAt = 1L, stale = false))
            val viewModel = startedViewModel(source)
            advanceUntilIdle()

            viewModel.discard(NEWER)
            advanceUntilIdle()
            assertEquals(listOf("k-new"), source.discarded)
        }

    @Test
    fun discardFailureLogsAPiiSafeKind() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source =
                FakeDraftSource(Resource.Success(listOf(NEWER), fetchedAt = 1L, stale = false)).apply {
                    discardResult = Result.failure(RuntimeException("rejected"))
                }
            val viewModel = startedViewModel(source, logger)
            advanceUntilIdle()

            viewModel.discard(NEWER)
            advanceUntilIdle()
            val failures = logger.records.filter { it.event == DraftRestorePromptRegistration.EVENT_DISCARD_FAILED }
            assertEquals(1, failures.size)
            assertEquals(LogLevel.Warn, failures.first().level)
            assertEquals("DraftRestorePrompt", failures.first().fields["surface"])
            assertEquals("Unknown", failures.first().fields["kind"])
        }

    @Test
    fun discardAllDelegatesToTheSource() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeDraftSource(Resource.Success(listOf(NEWER, OLDER), fetchedAt = 1L, stale = false))
            val viewModel = startedViewModel(source)
            advanceUntilIdle()

            viewModel.discardAll()
            advanceUntilIdle()
            assertEquals(1, source.discardAllCount)
        }

    @Test
    fun dismissSetsTheSessionGuard() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val viewModel = startedViewModel(FakeDraftSource(), logger)
            assertFalse(viewModel.dismissed.value)

            viewModel.dismiss()
            assertTrue(viewModel.dismissed.value)
            assertTrue(logger.records.any { it.event == DraftRestorePromptRegistration.EVENT_DISMISS })
        }

    @Test
    fun resumeSetsTheSessionGuard() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val viewModel = startedViewModel(FakeDraftSource(), logger)

            viewModel.resume()
            assertTrue(viewModel.dismissed.value)
            assertTrue(logger.records.any { it.event == DraftRestorePromptRegistration.EVENT_RESUME })
        }

    @Test
    fun retryReReadsTheFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeDraftSource(Resource.Success(listOf(NEWER), fetchedAt = 1L, stale = false))
            val viewModel = startedViewModel(source)
            advanceUntilIdle()
            val before = source.subscriptions

            viewModel.retry()
            advanceUntilIdle()
            assertTrue("retry re-subscribes the feed", source.subscriptions > before)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val viewModel = DraftRestorePromptViewModel(FakeDraftSource(), logger, backgroundScope)

            viewModel.onViewOpened()
            viewModel.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(LogLevel.Info, opened.first().level)
            assertEquals("DraftRestorePrompt", opened.first().fields["surface"])
        }

    // ── production registry: reactive record / discard / discard-all (web `subscribeDraftIndex`) ──────

    @Test
    fun registryRecordsAndDiscardsReactively() =
        runTest(UnconfinedTestDispatcher()) {
            val registry = DraftRegistry()
            val seen = mutableListOf<Resource<List<DraftRecord>>>()
            backgroundScope.launch { registry.drafts().collect { seen += it } }
            advanceUntilIdle()
            assertTrue("the first emission is the loading read", seen.first() is Resource.Loading)
            assertTrue(latestDrafts(seen).isEmpty())

            registry.record(NEWER)
            registry.record(OLDER)
            advanceUntilIdle()
            assertEquals(setOf("k-new", "k-old"), latestDrafts(seen).map { it.storageKey }.toSet())

            registry.discard("k-new")
            advanceUntilIdle()
            assertEquals(listOf("k-old"), latestDrafts(seen).map { it.storageKey })

            registry.discardAll()
            advanceUntilIdle()
            assertTrue(latestDrafts(seen).isEmpty())
        }

    @Test
    fun registryReplacesADraftWithTheSameStorageKey() =
        runTest(UnconfinedTestDispatcher()) {
            val registry = DraftRegistry()
            val seen = mutableListOf<Resource<List<DraftRecord>>>()
            backgroundScope.launch { registry.drafts().collect { seen += it } }

            registry.record(NEWER.copy(label = "first"))
            registry.record(NEWER.copy(label = "second"))
            advanceUntilIdle()

            val drafts = latestDrafts(seen)
            assertEquals(1, drafts.size)
            assertEquals("second", drafts.first().label)
        }

    private fun latestDrafts(seen: List<Resource<List<DraftRecord>>>): List<DraftRecord> =
        seen.filterIsInstance<Resource.Success<List<DraftRecord>>>().last().data

    private companion object {
        val NEWER = DraftRecord(storageKey = "k-new", route = "/a/new", label = "Newer", savedAtEpochMs = 2L)
        val OLDER = DraftRecord(storageKey = "k-old", route = "/b/new", label = "Older", savedAtEpochMs = 1L)
    }
}
