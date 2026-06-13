package io.teslasync.android.sharedsurfaces.savedviewmenu

import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiEvent
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.savedviews.DeleteSavedViewArgs
import io.teslasync.shared.core.presentation.savedviews.SavedView
import io.teslasync.shared.core.presentation.savedviews.SavedViewCreateInput
import io.teslasync.shared.core.presentation.savedviews.SetDefaultSavedViewArgs
import io.teslasync.shared.core.presentation.savedviews.UpdateSavedViewArgs
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [SavedViewMenuViewModel] over a controllable fake [SavedViewMenuSource], covering the feed lifecycle
 * the surface renders plus every mutation's success/failure split (web `onSuccess`/`onError` toasts), the
 * pin/default toggles, the input guards, retry re-fetching, and the PII-safe `view.opened` diagnostic (P1/S11
 * — surface slug only, never a name or query). The view never performs HTTP; every read flows through the fake.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SavedViewMenuViewModelTest {
    @Test
    fun feedSuccessExposesContentRows() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(success(listOf(view(1, "Trips")))))
            backgroundScope.launch { vm.views.collect {} }
            advanceUntilIdle()

            assertTrue(vm.views.value.isContent)
            val rows = vm.views.value.data
            assertEquals(1, rows?.size)
        }

    @Test
    fun emptyFeedExposesEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(success(emptyList())))
            backgroundScope.launch { vm.views.collect {} }
            advanceUntilIdle()

            assertTrue(vm.views.value.isEmpty)
        }

    @Test
    fun createSendsInputAndToastsAndClosesDialog() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(success(emptyList()))
            val vm = viewModel(source)
            val events = collectEvents(vm)
            var closed = false

            vm.create(name = "  My View  ", makeDefault = true, currentQuery = "status=active") { closed = true }
            advanceUntilIdle()

            assertEquals(1, source.created.size)
            val input = source.created.single()
            assertEquals("My View", input.name)
            assertEquals(ROUTE, input.route)
            assertEquals("status=active", input.query)
            assertEquals(true, input.isDefault)
            assertTrue(closed)
            assertTrue(events.any { it.messageKey == SavedViewMenuRegistration.TOAST_CREATE_SUCCESS })
        }

    @Test
    fun createWithBlankNameIsIgnored() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(success(emptyList()))
            val vm = viewModel(source)

            vm.create(name = "   ", makeDefault = false, currentQuery = "") {}
            advanceUntilIdle()

            assertTrue(source.created.isEmpty())
        }

    @Test
    fun createFailureSurfacesErrorToast() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(success(emptyList()))
            source.createResult = Result.failure(ApiError.Network())
            val vm = viewModel(source)
            val events = collectEvents(vm)
            var closed = false

            vm.create(name = "Bad", makeDefault = false, currentQuery = "") { closed = true }
            advanceUntilIdle()

            assertFalse(closed)
            val error = events.single { it.messageKey == SavedViewMenuRegistration.TOAST_CREATE_ERROR }
            assertEquals(UiEvent.Severity.Error, error.severity)
        }

    @Test
    fun renameUnchangedNameClosesWithoutMutating() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(success(emptyList()))
            val vm = viewModel(source)
            var closed = false

            vm.rename(view(1, "Same"), "Same") { closed = true }
            advanceUntilIdle()

            assertTrue(source.updated.isEmpty())
            assertTrue(closed)
        }

    @Test
    fun renameSendsPatchedName() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(success(emptyList()))
            val vm = viewModel(source)

            vm.rename(view(7, "Old"), "New name") {}
            advanceUntilIdle()

            val args = source.updated.single()
            assertEquals("New name", args.patch.name)
        }

    @Test
    fun deleteSendsArgsAndToasts() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(success(emptyList()))
            val vm = viewModel(source)
            val events = collectEvents(vm)

            vm.delete(view(3, "Gone")) {}
            advanceUntilIdle()

            assertEquals(3L, source.deleted.single().id)
            assertTrue(events.any { it.messageKey == SavedViewMenuRegistration.TOAST_DELETE_SUCCESS })
        }

    @Test
    fun togglePinFlipsTheFlagAndToasts() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(success(emptyList()))
            val vm = viewModel(source)
            val events = collectEvents(vm)

            vm.togglePin(view(1, "A", isPinned = false))
            advanceUntilIdle()

            val args = source.updated.single()
            assertEquals(true, args.patch.isPinned)
            assertTrue(events.any { it.messageKey == SavedViewMenuRegistration.TOAST_UPDATE_SUCCESS })
        }

    @Test
    fun toggleDefaultSetsAndUnsetsWithDistinctToasts() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(success(emptyList()))
            val vm = viewModel(source)
            val events = collectEvents(vm)

            vm.toggleDefault(view(1, "A", isDefault = false))
            advanceUntilIdle()
            assertEquals(true, source.defaulted.last().isDefault)
            assertTrue(events.any { it.messageKey == SavedViewMenuRegistration.TOAST_SET_DEFAULT_SUCCESS })

            vm.toggleDefault(view(1, "A", isDefault = true))
            advanceUntilIdle()
            assertEquals(false, source.defaulted.last().isDefault)
            assertTrue(events.any { it.messageKey == SavedViewMenuRegistration.TOAST_UNSET_DEFAULT_SUCCESS })
        }

    @Test
    fun retryRefreshesTheRouteFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(success(emptyList()))
            val vm = viewModel(source)
            backgroundScope.launch { vm.views.collect {} }
            advanceUntilIdle()
            val before = source.savedViewsCalls

            vm.retry()
            advanceUntilIdle()

            assertEquals(1, source.refreshCalls)
            assertTrue(source.savedViewsCalls > before)
        }

    @Test
    fun viewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(success(emptyList())), logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == SavedViewMenuRegistration.EVENT_VIEW_OPENED }
            assertEquals(1, opened.size)
            assertEquals(mapOf(SavedViewMenuRegistration.SURFACE_KEY to SavedViewMenuRegistration.SLUG), opened.single().second)
        }

    private fun TestScope.collectEvents(vm: SavedViewMenuViewModel): List<UiEvent.Message> {
        val events = mutableListOf<UiEvent.Message>()
        backgroundScope.launch { vm.events.collect { if (it is UiEvent.Message) events += it } }
        return events
    }

    private class FakeSource(
        var resource: Resource<List<SavedView>>,
    ) : SavedViewMenuSource {
        var savedViewsCalls = 0
        var refreshCalls = 0
        val created = mutableListOf<SavedViewCreateInput>()
        val updated = mutableListOf<UpdateSavedViewArgs>()
        val deleted = mutableListOf<DeleteSavedViewArgs>()
        val defaulted = mutableListOf<SetDefaultSavedViewArgs>()
        var createResult: Result<SavedView> = Result.success(view(99, "Created"))
        var updateResult: Result<SavedView> = Result.success(view(1, "Updated"))
        var deleteResult: Result<Unit> = Result.success(Unit)
        var setDefaultResult: Result<SavedView> = Result.success(view(1, "Default"))

        override fun savedViews(route: String): Flow<Resource<List<SavedView>>> {
            savedViewsCalls++
            return flow { emit(resource) }
        }

        override fun refresh(route: String) {
            refreshCalls++
        }

        override suspend fun create(input: SavedViewCreateInput): Result<SavedView> {
            created += input
            return createResult
        }

        override suspend fun update(args: UpdateSavedViewArgs): Result<SavedView> {
            updated += args
            return updateResult
        }

        override suspend fun delete(args: DeleteSavedViewArgs): Result<Unit> {
            deleted += args
            return deleteResult
        }

        override suspend fun setDefault(args: SetDefaultSavedViewArgs): Result<SavedView> {
            defaulted += args
            return setDefaultResult
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
        source: SavedViewMenuSource,
        logger: Logger = NoopLogger,
    ): SavedViewMenuViewModel = SavedViewMenuViewModel(source, ROUTE, logger, backgroundScope)

    private companion object {
        const val ROUTE = "/drives"

        fun view(
            id: Long,
            name: String,
            isDefault: Boolean = false,
            isPinned: Boolean = false,
        ): SavedView =
            SavedView(
                id = id,
                name = name,
                route = ROUTE,
                query = "status=active",
                isDefault = isDefault,
                isPinned = isPinned,
                createdAt = "2024-01-01T00:00:00Z",
                updatedAt = "2024-01-01T00:00:00Z",
            )

        fun success(views: List<SavedView>): Resource<List<SavedView>> = Resource.Success(views, fetchedAt = 1L, stale = false)
    }
}
