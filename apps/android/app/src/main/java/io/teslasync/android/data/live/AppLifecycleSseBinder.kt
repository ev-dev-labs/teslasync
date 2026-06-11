package io.teslasync.android.data.live

import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner

/**
 * Binds a [Lifecycle] — in production `ProcessLifecycleOwner.get().lifecycle`, the app-wide
 * foreground/background signal — to [LiveSessionStore.setForeground], so the shared SSE stream is held
 * only while the app is actually foreground (ADR-009: live data is foreground-only; background uses push,
 * never a held stream). A fake `LifecycleRegistry` drives this in unit tests.
 *
 * `ProcessLifecycleOwner` emits `ON_START` when the first activity becomes visible and `ON_STOP` ~700ms
 * after the last leaves the foreground (debouncing rotations), which is exactly the connect/disconnect
 * boundary we want — a configuration change does not flap the stream.
 *
 * @param store the app-scoped live store whose foreground gate this drives.
 * @param lifecycle the process (or test) lifecycle to observe.
 */
class AppLifecycleSseBinder(
    private val store: LiveSessionStore,
    private val lifecycle: Lifecycle,
) : DefaultLifecycleObserver {
    /** Starts observing; seeds the store with the current foreground state. Idempotent. */
    fun bind() {
        lifecycle.addObserver(this)
    }

    /** Stops observing and marks the app backgrounded so the stream is torn down. */
    fun unbind() {
        lifecycle.removeObserver(this)
        store.setForeground(false)
    }

    override fun onStart(owner: LifecycleOwner) {
        store.setForeground(true)
    }

    override fun onStop(owner: LifecycleOwner) {
        store.setForeground(false)
    }
}
