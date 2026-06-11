package io.teslasync.android.data

import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for [BaseFeedViewModel] — the A7 base every page ViewModel subclasses. They verify
 * the cross-cutting contract the base owns (not the [toUiState] projection itself, which
 * `ResourceUiStateTest` covers): a `StateFlow` feed's first frame is the projection of its current
 * value (never an artificial blank), the plain-`Flow` variant starts at loading, the re-shared state
 * tracks upstream while observed, one-shot [UiEvent]s are delivered through the events channel, and the
 * [launch] helper runs work on the injected scope. A `TestScope`-backed scope keeps everything on
 * virtual time with no real ViewModel lifecycle.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BaseFeedViewModelTest {
    private class TestFeedViewModel(
        feed: StateFlow<Resource<List<Int>>>,
        derived: Flow<Resource<List<Int>>>,
        scope: CoroutineScope,
    ) : BaseFeedViewModel(NoopLogger, scope) {
        val state: StateFlow<UiState<List<Int>>> = feed.asUiState()
        val derivedState: StateFlow<UiState<List<Int>>> = derived.asUiState()

        fun fire(event: UiEvent) = emitEvent(event)

        fun runOnScope(block: suspend CoroutineScope.() -> Unit) = launch(block)
    }

    private fun viewModel(
        feed: StateFlow<Resource<List<Int>>>,
        derived: Flow<Resource<List<Int>>> = flow { },
        scope: CoroutineScope,
    ): TestFeedViewModel = TestFeedViewModel(feed, derived, scope)

    @Test
    fun stateFlowFeedFirstFrameProjectsCurrentValue() =
        runTest(UnconfinedTestDispatcher()) {
            val feed = MutableStateFlow<Resource<List<Int>>>(Resource.Success(listOf(1, 2), 10L, false))
            val vm = viewModel(feed, scope = backgroundScope)

            // No collector yet: the initial value is the projection of the feed's current value.
            assertEquals(UiPhase.Content, vm.state.value.phase)
            assertEquals(listOf(1, 2), vm.state.value.data)
            assertEquals(10L, vm.state.value.fetchedAt)
        }

    @Test
    fun stateFlowFeedTracksUpstreamWhileObserved() =
        runTest(UnconfinedTestDispatcher()) {
            val feed = MutableStateFlow<Resource<List<Int>>>(Resource.Success(listOf(1), 10L, false))
            val vm = viewModel(feed, scope = backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            feed.value = Resource.Success(emptyList(), 20L, false)
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
            assertEquals(emptyList<Int>(), vm.state.value.data)
        }

    @Test
    fun flowVariantStartsLoadingThenProjects() =
        runTest(UnconfinedTestDispatcher()) {
            val feed = MutableStateFlow<Resource<List<Int>>>(Resource.Success(listOf(0), 1L, false))
            val derived = flow<Resource<List<Int>>> { emit(Resource.Success(listOf(7, 8), 5L, false)) }
            val vm = viewModel(feed, derived, backgroundScope)

            // A cold flow has no current value to project, so it starts at loading.
            assertEquals(UiPhase.Loading, vm.derivedState.value.phase)

            backgroundScope.launch { vm.derivedState.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Content, vm.derivedState.value.phase)
            assertEquals(listOf(7, 8), vm.derivedState.value.data)
        }

    @Test
    fun emitEventIsDeliveredOnceThroughTheChannel() =
        runTest(UnconfinedTestDispatcher()) {
            val feed = MutableStateFlow<Resource<List<Int>>>(Resource.Success(listOf(1), 1L, false))
            val vm = viewModel(feed, scope = backgroundScope)
            val received = mutableListOf<UiEvent>()
            backgroundScope.launch { vm.events.collect { received.add(it) } }
            advanceUntilIdle()

            vm.fire(UiEvent.CommandOutcome("wake", success = true))
            advanceUntilIdle()

            assertEquals(1, received.size)
            assertEquals(UiEvent.CommandOutcome("wake", success = true), received.first())
        }

    @Test
    fun launchHelperRunsWorkOnTheInjectedScope() =
        runTest(UnconfinedTestDispatcher()) {
            val feed = MutableStateFlow<Resource<List<Int>>>(Resource.Success(listOf(1), 1L, false))
            val vm = viewModel(feed, scope = backgroundScope)
            var ran = false

            vm.runOnScope { ran = true }
            advanceUntilIdle()

            assertTrue(ran)
        }
}
