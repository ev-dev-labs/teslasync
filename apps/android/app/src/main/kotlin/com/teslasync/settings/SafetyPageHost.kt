// Page-host wiring for the SafetyPage settings surface (A7) — the seam that attaches real screen content to the
// `settingsSafety` ⁄ `/settings/safety` navigation destination (Destinations.kt). It mirrors the
// [GasPriceAutoPollPageHost] precedent: [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found screen.
// [SafetyPageRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared S8
// [io.teslasync.shared.core.presentation.settings.SettingsStore] (the listing's `/settings` document feed) and the
// shared resilient [io.teslasync.shared.core.net.ApiHttpClient] (the embedded AI explainer's narration stream), and
// performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/settings) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.settings.safety

import androidx.compose.runtime.Composable
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `settingsSafety` destination. Resolves the app data graph from the
 * CompositionLocal and binds the page to the shared Settings holder (web `useSettings`), the resilient API client (the
 * embedded AI explainer's stream seam), and the app's redacting logger.
 */
@Composable
fun SafetyPageRoute() {
    val container = LocalDataContainer.current
    SafetyPage(
        settingsStore = container.settingsStore,
        apiClient = container.api,
        logger = container.logger,
    )
}

/**
 * Registers the [SafetyPageRoute] host for the `settingsSafety` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object SafetyPageHost {
    private val id: String = SafetyPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { SafetyPageRoute() }
    }
}
