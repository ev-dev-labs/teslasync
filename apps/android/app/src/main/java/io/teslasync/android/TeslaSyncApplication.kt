package io.teslasync.android

import android.app.Application
import io.teslasync.android.auth.AuthContainer

/**
 * Process [Application] owning the [AuthContainer] (the auth + networking dependency graph). The
 * container is created lazily on first access so process start stays cheap, and is reached by the
 * Compose tree (via `LocalAuthController`) and by the OIDC redirect activity.
 */
class TeslaSyncApplication : Application() {
    val container: AuthContainer by lazy { AuthContainer(this) }
}
