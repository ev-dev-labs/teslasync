// Page-host wiring for the UsersPage admin surface (A7) — the seam that attaches real screen content to the
// surface's navigation id. It mirrors the [io.teslasync.android.admin.slowqueries.SlowQueriesPageHost]
// precedent: [register] is called once at process start by [io.teslasync.android.TeslaSyncApplication].
// [UsersRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared S8
// [io.teslasync.shared.core.presentation.impersonation.ImpersonationStore] via [asUsersPageSource], and performs
// no HTTP itself.
//
// The web page ships UNROUTED (the parity manifest records its web route as `(unrouted)`; the web file notes a
// follow-up will register the route). There is therefore no [io.teslasync.android.navigation.Destinations] row
// for [UsersPageRegistration.ROUTE_ID] yet — adding one would break the generated 137-route parity lock — so
// this registration is forward-ready and dormant: [io.teslasync.android.navigation.TeslaSyncNavHost] only
// renders ids present in [io.teslasync.android.navigation.Destinations], so the content lights up automatically
// once a follow-up lands the route, exactly mirroring the web page's own "shipped but unrouted" status.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.admin.users

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry for the UsersPage surface. Resolves the app data graph from the CompositionLocal,
 * builds the source over the shared S8 [io.teslasync.shared.core.presentation.impersonation.ImpersonationStore],
 * and binds the page to the app's redacting logger.
 */
@Composable
fun UsersRoute() {
    val container = LocalDataContainer.current
    val source = remember(container) { container.impersonationStore.asUsersPageSource() }
    UsersPage(source = source, logger = container.logger)
}

/**
 * Registers the [UsersRoute] host for the surface's reserved navigation id. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op. The
 * registration is dormant until a follow-up adds the matching `Destinations` row (the web page ships unrouted).
 */
object UsersPageHost {
    private val id: String = UsersPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { UsersRoute() }
    }
}
