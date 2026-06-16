// Page-host wiring for the HelpPage surface (A7) — the seam that attaches real screen content to the standalone
// `help` navigation route (TeslaSyncNavHost). It mirrors the sibling CommandsPageHost precedent: [register] is called
// once at process start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the
// shared not-found screen. [HelpRoute] reads the app DI graph from [LocalDataContainer] and binds the page to the
// app's redacting logger; the HelpPage has no API data source, so no repository/source is constructed here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system.help

import androidx.compose.runtime.Composable
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the standalone `help` destination. Resolves the app data graph from the
 * CompositionLocal and binds the page to the app's redacting logger.
 */
@Composable
fun HelpRoute() {
    val container = LocalDataContainer.current
    HelpPage(logger = container.logger)
}

/**
 * Registers the [HelpRoute] host for the `help` route. Called once at process start; idempotent so a repeat call
 * (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object HelpPageHost {
    private val id: String = HelpPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { HelpRoute() }
    }
}
