package io.teslasync.android.sharedsurfaces.lightbox

import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [LightboxViewModel] over a controllable fake [LightboxSource], covering the full lifecycle the web
 * gallery renders: a first fetch → loading, a resolved gallery → content, an empty gallery → the empty
 * phase, a hard fetch failure → error, a cached gallery after a failed fetch → the offline (stale + cached)
 * surface, a retry re-fetching the source, and the PII-safe `view.opened` + `lightbox.refresh` diagnostics —
 * end to end through the real `toUiState` projection. The VM's feed is `WhileSubscribed`, so each case keeps
 * an active collector alive on the background scope.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LightboxViewModelTest {
    private class FakeLightboxSource(
        initial: Resource<LightboxGallery> = Resource.Loading(cached = null, fetchedAt = null, stale = false),
    ) : LightboxSource {
        val feed = MutableStateFlow(initial)
        var refreshCalls: Int = 0

        override fun gallery(): Flow<Resource<LightboxGallery>> = feed

        override fun refresh() {
            refreshCalls++
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

    private fun gallery(count: Int = 3): LightboxGallery = LightboxGallery(List(count) { LightboxSlide(src = "img-$it", alt = "alt-$it") })

    @Test
    fun loadingResolvesToContentWhenTheGalleryArrives() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeLightboxSource()
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)

            source.feed.value = Resource.Success(gallery(), fetchedAt = STAMP, stale = false)
            advanceUntilIdle()
            val resolved = vm.state.value
            assertEquals(UiPhase.Content, resolved.phase)
            assertEquals(3, resolved.data?.total)
        }

    @Test
    fun emptyGalleryMapsToEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeLightboxSource(Resource.Success(LightboxGallery(emptyList()), fetchedAt = STAMP, stale = false))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeLightboxSource(
                    Resource.Error(cached = null, fetchedAt = null, stale = false, error = IllegalStateException("x")),
                )
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Error, vm.state.value.phase)
            assertNotNull(vm.state.value.errorKind)
        }

    @Test
    fun errorWithCachedGalleryKeepsItAndFlagsOffline() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeLightboxSource(
                    Resource.Error(cached = gallery(), fetchedAt = STAMP, stale = true, error = IllegalStateException("net")),
                )
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertNotNull(state.errorKind)
            assertEquals(LightboxFreshness.Offline, LightboxProjection.freshness(state))
        }

    @Test
    fun viewModelRefreshesTheSourceOnConstructionAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeLightboxSource(Resource.Success(gallery(), fetchedAt = STAMP, stale = false))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(1, source.refreshCalls)

            vm.retry()
            advanceUntilIdle()
            assertEquals(2, source.refreshCalls)
        }

    @Test
    fun retryEmitsRefreshDiagnosticWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeLightboxSource(Resource.Success(gallery(), fetchedAt = STAMP, stale = false)), logger)
            observe(vm)
            advanceUntilIdle()

            vm.retry()
            advanceUntilIdle()

            val refresh = logger.events.single { it.first == "lightbox.refresh" }
            assertEquals(mapOf("surface" to "Lightbox"), refresh.second)
        }

    @Test
    fun viewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeLightboxSource(Resource.Success(gallery(), fetchedAt = STAMP, stale = false)), logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "Lightbox"), opened.single().second)
        }

    private fun TestScope.viewModel(
        source: LightboxSource,
        logger: Logger = NoopLogger,
    ): LightboxViewModel = LightboxViewModel(source, logger, backgroundScope)

    private fun TestScope.observe(vm: LightboxViewModel) {
        backgroundScope.launch { vm.state.collect {} }
    }

    private companion object {
        const val STAMP = 1_700_000_000_000L
    }
}
