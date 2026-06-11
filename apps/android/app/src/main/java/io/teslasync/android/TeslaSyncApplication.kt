package io.teslasync.android

import android.app.Application
import androidx.lifecycle.ProcessLifecycleOwner
import io.teslasync.android.auth.AuthContainer
import io.teslasync.android.data.live.AppLifecycleSseBinder

/**
 * Process [Application] owning the [AuthContainer] (the auth + networking + data dependency graph) and
 * binding the live-data pipe to the app's foreground lifecycle (ADR-009).
 *
 * On process start it attaches an [AppLifecycleSseBinder] to `ProcessLifecycleOwner`, so the shared SSE
 * stream is held only while the app is foreground and resumes when it returns — independent of any single
 * Activity. Realizing the container here (rather than fully lazily) is intentional: the foreground binding
 * must exist before the first `ON_START`, and a foreground app needs the graph immediately anyway.
 */
class TeslaSyncApplication : Application() {
    val container: AuthContainer by lazy { AuthContainer(this) }

    private var liveBinder: AppLifecycleSseBinder? = null

    override fun onCreate() {
        super.onCreate()
        liveBinder =
            AppLifecycleSseBinder(
                store = container.data.liveSessionStore,
                lifecycle = ProcessLifecycleOwner.get().lifecycle,
            ).also { it.bind() }
    }
}
