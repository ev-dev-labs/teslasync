package io.teslasync.android.sharedsurfaces.taginput

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [TagInputViewModel] over a controllable fake [TagListSource], covering the seed's cache-then-network
 * lifecycle the surface renders (loading → content, the hard error, the stale/offline envelope) AND the local
 * editing reducers folded on top — commit (Enter + mid-typing separator), case-insensitive duplicate reject,
 * maxTags cap, validator error, chip + Backspace removal — each notifying the host via `onTagsChange` and the
 * slug-only diagnostics (P1/S11). Also verifies retry re-seeds while stale refresh preserves local edits, and
 * the `view.opened` PII-safe diagnostic. The view never performs HTTP; every read flows through the fake.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TagInputViewModelTest {
    @Test
    fun seedSeedsWorkingTags() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(success(listOf("a", "b"))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(listOf("a", "b"), vm.state.value.tags)
            assertEquals(TagInputPhase.Content, vm.state.value.phase)
        }

    @Test
    fun emptySeedRendersEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(success(emptyList())))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertTrue(vm.state.value.isEmpty)
            assertEquals(emptyList<String>(), vm.state.value.tags)
        }

    @Test
    fun firstLoadWithNoCacheIsLoading() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(Resource.Loading(cached = null, fetchedAt = null, stale = false)))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertTrue(vm.state.value.isLoading)
        }

    @Test
    fun hardErrorWithNoCacheIsError() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertTrue(vm.state.value.isError)
            assertEquals(ErrorKind.Network, vm.state.value.errorKind)
        }

    @Test
    fun cachedErrorIsOffline() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(Resource.Error(cached = listOf("a"), fetchedAt = 5L, stale = true, error = ApiError.Timeout())),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertTrue(vm.state.value.offline)
            assertEquals(listOf("a"), vm.state.value.tags)
        }

    @Test
    fun commitPendingAddsTagAndNotifies() =
        runTest(UnconfinedTestDispatcher()) {
            val changes = mutableListOf<List<String>>()
            val vm = viewModel(FakeSource(success(emptyList())), onTagsChange = { changes.add(it) })
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            vm.setPending("foo")
            vm.commitPending()
            advanceUntilIdle()

            assertEquals(listOf("foo"), vm.state.value.tags)
            assertEquals("", vm.state.value.pending)
            assertEquals(listOf(listOf("foo")), changes)
        }

    @Test
    fun separatorCommitsWhileTyping() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(success(emptyList())))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            vm.setPending("foo,")
            advanceUntilIdle()

            assertEquals(listOf("foo"), vm.state.value.tags)
            assertEquals("", vm.state.value.pending)
        }

    @Test
    fun duplicateIsRejectedWithoutNotifying() =
        runTest(UnconfinedTestDispatcher()) {
            val changes = mutableListOf<List<String>>()
            val vm = viewModel(FakeSource(success(listOf("foo"))), onTagsChange = { changes.add(it) })
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = changes.size

            vm.setPending("foo")
            vm.commitPending()
            advanceUntilIdle()

            assertEquals(listOf("foo"), vm.state.value.tags)
            assertEquals(before, changes.size)
        }

    @Test
    fun maxTagsCapIsEnforced() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(success(listOf("x"))), config = TagInputConfig(maxTags = 1))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            vm.setPending("y")
            vm.commitPending()
            advanceUntilIdle()

            assertEquals(listOf("x"), vm.state.value.tags)
            assertTrue(vm.state.value.atMax)
        }

    @Test
    fun validatorErrorBlocksCommit() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(success(emptyList())), validate = { if (it.length < 2) SHORT_MESSAGE else null })
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            vm.setPending("a")
            vm.commitPending()
            advanceUntilIdle()

            assertEquals(emptyList<String>(), vm.state.value.tags)
            assertEquals(SHORT_MESSAGE, vm.state.value.error)
        }

    @Test
    fun removeAtRemovesAndAnnounces() =
        runTest(UnconfinedTestDispatcher()) {
            val changes = mutableListOf<List<String>>()
            val vm = viewModel(FakeSource(success(listOf("a", "b", "c"))), onTagsChange = { changes.add(it) })
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            vm.removeAt(1)
            advanceUntilIdle()

            assertEquals(listOf("a", "c"), vm.state.value.tags)
            assertEquals(TagAnnouncement.Removed("b"), vm.state.value.announcement)
            assertEquals(listOf("a", "c"), changes.last())
        }

    @Test
    fun removeLastRemovesTrailingChip() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(success(listOf("a", "b"))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            vm.removeLast()
            advanceUntilIdle()

            assertEquals(listOf("a"), vm.state.value.tags)
        }

    @Test
    fun retryReFetchesAndReseeds() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()))
            val vm = viewModel(source, logger = logger)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertTrue(vm.state.value.isError)
            val before = source.calls

            source.resource = success(listOf("x"))
            vm.retry()
            advanceUntilIdle()

            assertTrue(source.calls > before)
            assertEquals(listOf("x"), vm.state.value.tags)
            assertTrue(vm.state.value.isContent)
            assertTrue(logger.events.any { it.first == "tagInput.refresh" })
        }

    @Test
    fun refreshPreservesLocalEdits() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(success(listOf("a"))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            vm.setPending("b")
            vm.commitPending()
            advanceUntilIdle()
            assertEquals(listOf("a", "b"), vm.state.value.tags)

            vm.refresh()
            advanceUntilIdle()

            assertEquals(listOf("a", "b"), vm.state.value.tags)
        }

    @Test
    fun viewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(success(emptyList())), logger = logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "TagInput"), opened.single().second)
        }

    @Test
    fun addAndRemoveEmitSlugOnlyDiagnostics() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(success(listOf("a"))), logger = logger)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            vm.setPending("b")
            vm.commitPending()
            vm.removeAt(0)
            advanceUntilIdle()

            assertTrue(logger.events.any { it.first == "tagInput.added" && it.second == mapOf("surface" to "TagInput") })
            assertTrue(logger.events.any { it.first == "tagInput.removed" && it.second == mapOf("surface" to "TagInput") })
        }

    private class FakeSource(
        var resource: Resource<List<String>>,
    ) : TagListSource {
        var calls: Int = 0

        override fun tags(): Flow<Resource<List<String>>> {
            calls++
            return flow { emit(resource) }
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

    private fun TestScope.viewModel(
        source: TagListSource,
        config: TagInputConfig = TagInputConfig(),
        validate: ((String) -> String?)? = null,
        onTagsChange: (List<String>) -> Unit = {},
        logger: Logger = NoopLogger,
    ): TagInputViewModel = TagInputViewModel(source, config, validate, onTagsChange, logger, backgroundScope)

    private companion object {
        const val SHORT_MESSAGE = "Tags must be at least 2 characters"

        fun success(tags: List<String>): Resource<List<String>> = Resource.Success(tags, fetchedAt = 1L, stale = false)
    }
}
