// Page-host wiring for the MyActivityPage system surface (A7) — the seam that attaches real screen content to the
// `myActivity` ⁄ `/me/activity` navigation destination (Destinations.kt). It mirrors the sibling
// [io.teslasync.android.system.teslaaccount.TeslaAccountPageHost] precedent: [register] is called once at process
// start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared
// not-found screen. [MyActivityRoute] reads the app DI graph from [LocalDataContainer], builds the source over
// the shared User/Account holder via [myActivityPageSourceOf], resolves the feed-row click-through through the
// ambient [LocalDeepLinkRouter] (the sanctioned page-host navigation seam — no `LocalNavController` is exposed to
// hosts; mirrors the InboxPage / AlertRulesPage precedent, the native analogue of the web `<Link>`), and performs
// no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system.myactivity

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.android.navigation.RouteTable
import io.teslasync.android.notifications.LocalDeepLinkRouter

/**
 * The stateful route entry registered for the `myActivity` destination. Resolves the app data graph from the
 * CompositionLocal, builds the cache-then-network source over the shared
 * [io.teslasync.shared.core.presentation.user.UserStore], wires the feed-row click-through to the
 * [io.teslasync.android.notifications.DeepLinkRouter] (a tapped entity route — e.g. `/vehicles/3` — becomes a
 * `teslasync://app/vehicles/3` deep link the navigation shell consumes), and binds the page to the app's
 * redacting logger. The activity feed lives in the bound view-model; this route owns no data of its own.
 */
@Composable
fun MyActivityRoute() {
    val container = LocalDataContainer.current
    val source = remember(container) { myActivityPageSourceOf(container.userStore) }

    val router = LocalDeepLinkRouter.current
    val onOpenEntity: (String) -> Unit =
        remember(router) {
            { path -> router?.request("${RouteTable.APP_SCHEME}://app$path") ?: Unit }
        }

    MyActivityPage(source = source, onOpenEntity = onOpenEntity, logger = container.logger)
}

/**
 * Registers the [MyActivityRoute] host for the `myActivity` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object MyActivityPageHost {
    private val id: String = MyActivityPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { MyActivityRoute() }
    }
}
