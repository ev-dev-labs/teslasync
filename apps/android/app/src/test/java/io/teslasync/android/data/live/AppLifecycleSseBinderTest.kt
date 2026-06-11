package io.teslasync.android.data.live

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import io.teslasync.android.data.NoopLogger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Verifies [AppLifecycleSseBinder] translates a `Lifecycle`'s foreground transitions (a fake
 * `LifecycleRegistry` standing in for `ProcessLifecycleOwner`) into the store's foreground gate, so the
 * shared stream opens on `ON_START` and is torn down on `ON_STOP` (ADR-009) — driven end-to-end through
 * a real [LiveSessionStore] + [FakeLiveFeed].
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AppLifecycleSseBinderTest {
    private class FakeOwner : LifecycleOwner {
        lateinit var registry: LifecycleRegistry
        override val lifecycle: Lifecycle get() = registry
    }

    @Test
    fun startConnectsStopDisconnects() =
        runTest(UnconfinedTestDispatcher()) {
            val feed = FakeLiveFeed()
            val store =
                LiveSessionStore(
                    feed = feed,
                    authenticated = MutableStateFlow(true),
                    scope = backgroundScope,
                    logger = NoopLogger,
                    nowMillis = { currentTime },
                )
            backgroundScope.launch { store.state.collect {} }
            advanceUntilIdle()

            val owner = FakeOwner()
            val registry = LifecycleRegistry.createUnsafe(owner)
            owner.registry = registry
            AppLifecycleSseBinder(store, registry).bind()

            // Created but not started → no stream held in the background.
            registry.handleLifecycleEvent(Lifecycle.Event.ON_CREATE)
            advanceUntilIdle()
            assertEquals(0, feed.opens)

            // Foreground → stream opens.
            registry.handleLifecycleEvent(Lifecycle.Event.ON_START)
            advanceUntilIdle()
            assertEquals(1, feed.opens)
            assertEquals(1, feed.activeStreams)

            // Background → stream torn down (no held background stream).
            registry.handleLifecycleEvent(Lifecycle.Event.ON_STOP)
            advanceUntilIdle()
            assertEquals(0, feed.activeStreams)

            // Re-enter foreground → resumes.
            registry.handleLifecycleEvent(Lifecycle.Event.ON_START)
            advanceUntilIdle()
            assertEquals(2, feed.opens)
            assertEquals(1, feed.activeStreams)
        }

    @Test
    fun unbindDisconnects() =
        runTest(UnconfinedTestDispatcher()) {
            val feed = FakeLiveFeed()
            val store =
                LiveSessionStore(
                    feed = feed,
                    authenticated = MutableStateFlow(true),
                    scope = backgroundScope,
                    logger = NoopLogger,
                    nowMillis = { currentTime },
                )
            backgroundScope.launch { store.state.collect {} }
            val owner = FakeOwner()
            val registry = LifecycleRegistry.createUnsafe(owner)
            owner.registry = registry
            val binder = AppLifecycleSseBinder(store, registry)
            binder.bind()
            registry.handleLifecycleEvent(Lifecycle.Event.ON_START)
            advanceUntilIdle()
            assertEquals(1, feed.activeStreams)

            binder.unbind()
            advanceUntilIdle()

            assertEquals(0, feed.activeStreams)
        }
}
