package io.teslasync.android.auth

import io.teslasync.shared.core.auth.AuthBrowser
import io.teslasync.shared.core.auth.RedirectResult

/**
 * Android [AuthBrowser] implementation. The shared core builds the full OIDC authorize URL and
 * delegates only the system-browser round-trip to the platform; this implementation hands that URL
 * to [launch] (which starts the Chrome Custom Tab via [AuthorizationActivity] / AppAuth) and awaits
 * the captured redirect through the process-wide [AuthRedirectCoordinator].
 *
 * The launch side effect is injected so the browser's bridging logic is exercised in plain JVM unit
 * tests with a fake launcher and a coordinator driven directly, without any Android framework.
 */
class AndroidAuthBrowser(
    private val coordinator: AuthRedirectCoordinator,
    private val launch: (authorizeUrl: String) -> Unit,
) : AuthBrowser {
    override suspend fun authorize(authorizeUrl: String): RedirectResult = coordinator.authorize { launch(authorizeUrl) }
}
