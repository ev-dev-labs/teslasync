// Page-host wiring for the GrafanaPanelPage power-user surface (A7) — the seam that attaches real screen content
// to the `powerGrafana` ⁄ `/power/grafana` navigation destination (Destinations.kt). It mirrors the
// [io.teslasync.android.admin.gasprice.GasPriceAutoPollPageHost] precedent: [register] is called once at process
// start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared
// not-found screen. [GrafanaPanelRoute] reads the app DI graph from [LocalDataContainer], builds the
// SharedPreferences-backed editor-draft store over the composition [android.content.Context], wires the embedded
// Helix drafter to the real settings-derived AI gate via [grafanaPanelAiSource], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/poweruser) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.poweruser.grafanapanel

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `powerGrafana` destination. Resolves the app data graph from the
 * CompositionLocal, builds the durable editor-draft store (localStorage parity) and the real settings-derived AI
 * gate for the embedded Helix drafter, and binds the page to the app's redacting logger.
 */
@Composable
fun GrafanaPanelRoute() {
    val container = LocalDataContainer.current
    val context = LocalContext.current
    val draftStore = remember(context) { grafanaDraftStore(context) }
    val aiSource = remember(container) { grafanaPanelAiSource(container.settingsStore) }
    GrafanaPanelPage(draftStore = draftStore, aiSource = aiSource, logger = container.logger)
}

/**
 * Registers the [GrafanaPanelRoute] host for the `powerGrafana` route. Called once at process start; idempotent
 * so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object GrafanaPanelPageHost {
    private val id: String = GrafanaPanelPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { GrafanaPanelRoute() }
    }
}
