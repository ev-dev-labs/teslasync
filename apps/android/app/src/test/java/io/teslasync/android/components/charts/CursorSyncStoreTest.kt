package io.teslasync.android.components.charts

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/**
 * JVM unit tests for the framework-free [CursorSyncStore] core — set/get/clear,
 * the no-op-on-unchanged guard, and listener notification — mirroring the web
 * `cursorSync` external-store behavior. The Compose bridge is exercised by the
 * instrumented tests.
 */
class CursorSyncStoreTest {
    @Before
    fun setUp() {
        CursorSyncStore.reset()
    }

    @After
    fun tearDown() {
        CursorSyncStore.reset()
    }

    @Test
    fun getReturnsNullForUnknownOrNullSyncId() {
        assertNull(CursorSyncStore.get("missing"))
        assertNull(CursorSyncStore.get(null))
    }

    @Test
    fun setThenGetRoundTrips() {
        CursorSyncStore.set("drive", 4)
        assertEquals(4, CursorSyncStore.get("drive"))
    }

    @Test
    fun setNullClearsEntry() {
        CursorSyncStore.set("drive", 4)
        CursorSyncStore.set("drive", null)
        assertNull(CursorSyncStore.get("drive"))
    }

    @Test
    fun clearRemovesEntry() {
        CursorSyncStore.set("drive", 9)
        CursorSyncStore.clear("drive")
        assertNull(CursorSyncStore.get("drive"))
    }

    @Test
    fun keysAreIsolated() {
        CursorSyncStore.set("a", 1)
        CursorSyncStore.set("b", 2)
        assertEquals(1, CursorSyncStore.get("a"))
        assertEquals(2, CursorSyncStore.get("b"))
    }

    @Test
    fun listenersFireOnRealChangeOnly() {
        var count = 0
        val unsubscribe = CursorSyncStore.subscribe { count++ }
        CursorSyncStore.set("drive", 3)
        CursorSyncStore.set("drive", 3) // unchanged -> no emit
        CursorSyncStore.set("drive", 5)
        assertEquals(2, count)
        unsubscribe()
        CursorSyncStore.set("drive", 8)
        assertEquals(2, count)
    }
}
