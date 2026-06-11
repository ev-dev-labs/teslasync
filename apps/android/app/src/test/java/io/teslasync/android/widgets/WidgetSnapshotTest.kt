package io.teslasync.android.widgets

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for the [WidgetSnapshot] render-ready model (P3/A8): the pre-sync loading seed and the
 * [WidgetSnapshot.hasContent] flag that lets the Glance layer show a value (even when stale/offline)
 * without re-deriving the freshness contract.
 */
class WidgetSnapshotTest {
    @Test
    fun loadingSeedHasNoContentAndUnknownFreshness() {
        val snapshot = WidgetSnapshot.loading<String>()

        assertEquals(WidgetRenderState.Loading, snapshot.renderState)
        assertNull(snapshot.content)
        assertFalse(snapshot.hasContent)
        assertEquals(WidgetFreshness.Unknown, snapshot.freshness)
    }

    @Test
    fun contentPresentReportsHasContent() {
        val snapshot = WidgetSnapshot(WidgetRenderState.Content, "model-3", WidgetFreshness.Unknown)

        assertTrue(snapshot.hasContent)
        assertEquals("model-3", snapshot.content)
    }

    @Test
    fun offlineWithCachedValueStillHasContent() {
        // A stale/offline snapshot keeps its cached value visible rather than blanking it.
        val snapshot = WidgetSnapshot(WidgetRenderState.Offline, 42, WidgetFreshness.Unknown)

        assertTrue(snapshot.hasContent)
        assertEquals(42, snapshot.content)
    }

    @Test
    fun errorWithoutCachedValueHasNoContent() {
        val snapshot = WidgetSnapshot<Int>(WidgetRenderState.Error, null, WidgetFreshness.Unknown)

        assertFalse(snapshot.hasContent)
    }
}
