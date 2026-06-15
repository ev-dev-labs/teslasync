// Page-host wiring for the SharedDrivePage sharing surface (A7) — the seam that attaches real screen content to the
// `sharedDrive` ⁄ `/s/:token` navigation destination (Destinations.kt). It mirrors the
// [io.teslasync.android.analytics.yearreview.YearReviewPageHost] precedent for a parameterized standalone route:
// [register] is called once at process start by [io.teslasync.android.TeslaSyncApplication]; until then the route
// falls through to the shared not-found screen. [SharedDriveRoute] reads the public share token from the route
// argument (web `useParams().token`), resolves the app DI graph from [LocalDataContainer], binds the page to the
// shared resilient client + the shared settings holder via [sharedDrivePageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/sharing) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.sharing.shareddrive

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.navigation.NavBackStackEntry
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `sharedDrive` destination. Reads the public share [token] from the
 * route argument (web `useParams().token`), resolves the app data graph from the CompositionLocal, builds the source
 * over the shared resilient client + the shared settings holder, and binds the page to the app's redacting logger.
 */
@Composable
fun SharedDriveRoute(entry: NavBackStackEntry) {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            sharedDrivePageSourceOf(
                api = container.api,
                settingsStore = container.settingsStore,
            )
        }
    val token =
        remember(entry) {
            entry.arguments?.getString(SharedDrivePageRegistration.ARG_TOKEN).orEmpty()
        }
    SharedDrivePage(source = source, token = token, logger = container.logger)
}

/**
 * Registers the [SharedDriveRoute] host for the `sharedDrive` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object SharedDrivePageHost {
    private val id: String = SharedDrivePageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { entry -> SharedDriveRoute(entry) }
    }
}
