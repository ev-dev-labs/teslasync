package io.teslasync.android.components.charts

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue

/**
 * Process-wide store for cross-chart cursor sync — the Android counterpart of the
 * web `cursorSync.ts` external store. Charts that share a `syncId` mirror the last
 * hovered/selected x-axis [index] so a persistent reference appears on every synced
 * chart even after the touch lifts. Keyed by `syncId` (page-scoped) so cross-page
 * leakage is impossible; `ChartSyncScope` clears its entry on dispose.
 *
 * The store core is framework-free (JVM-tested); [cursorSyncPosition] is the thin
 * Compose bridge that subscribes a recomposition to it.
 */
object CursorSyncStore {
    private val positions = mutableMapOf<String, Int>()
    private val listeners = mutableSetOf<() -> Unit>()

    /** Sets the cursor index for [syncId]; `null` clears it. No-op when unchanged. */
    fun set(
        syncId: String,
        value: Int?,
    ) {
        val current = positions[syncId]
        if (current == value) return
        if (value == null) positions.remove(syncId) else positions[syncId] = value
        emit()
    }

    /** Current cursor index for [syncId], or `null` when unset / `syncId` is null. */
    fun get(syncId: String?): Int? = if (syncId == null) null else positions[syncId]

    /** Drops the entry for [syncId] (called on `ChartSyncScope` dispose). */
    fun clear(syncId: String) {
        if (positions.remove(syncId) != null) emit()
    }

    /** Subscribes [listener] to changes; returns an unsubscribe handle. */
    fun subscribe(listener: () -> Unit): () -> Unit {
        listeners.add(listener)
        return { listeners.remove(listener) }
    }

    /** Test helper — fully resets the store. */
    fun reset() {
        positions.clear()
        listeners.clear()
    }

    private fun emit() {
        listeners.toList().forEach { it() }
    }
}

/**
 * Subscribes the calling composable to the persistent cursor index for [syncId].
 * Returns `null` when no `syncId` is active or nothing has been hovered yet.
 */
@Composable
fun cursorSyncPosition(syncId: String?): Int? {
    var value by remember(syncId) { mutableStateOf(CursorSyncStore.get(syncId)) }
    DisposableEffect(syncId) {
        value = CursorSyncStore.get(syncId)
        val unsubscribe = CursorSyncStore.subscribe { value = CursorSyncStore.get(syncId) }
        onDispose(unsubscribe)
    }
    return value
}
