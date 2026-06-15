// Page-host wiring for the SqlPlaygroundPage power-user surface (A7) — the seam that attaches real screen content to
// the `powerSql` ⁄ `/power/sql` navigation destination (Destinations.kt, already a metadata-only route). It mirrors
// the sibling [io.teslasync.android.admin.region.TeslaRegionPageHost] precedent: [register] is called once at
// process start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared
// not-found screen. [SqlPlaygroundRoute] renders the page directly — the surface owns only in-memory editor state
// against the static curated catalog, so it binds no shared store / repository and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/poweruser) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.poweruser.sqlplayground

import androidx.compose.runtime.Composable
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `powerSql` destination. Binds the page to the app's redacting logger
 * (for the one-shot `view.opened` diagnostic); the page holds the editor state and the static catalog itself, so
 * this route resolves no data graph beyond the logger.
 */
@Composable
fun SqlPlaygroundRoute() {
    SqlPlaygroundPage(logger = LocalDataContainer.current.logger)
}

/**
 * Registers the [SqlPlaygroundRoute] host for the `powerSql` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object SqlPlaygroundPageHost {
    private val id: String = SqlPlaygroundPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { SqlPlaygroundRoute() }
    }
}
