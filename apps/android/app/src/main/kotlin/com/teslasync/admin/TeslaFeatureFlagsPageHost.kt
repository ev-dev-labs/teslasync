// Page-host wiring for the TeslaFeatureFlagsPage admin surface (A7) — the seam that attaches real screen
// content to the `teslaFeatures` ⁄ `/tesla-features` navigation destination (Destinations.kt). It mirrors the
// [GasPriceAutoPollPageHost] precedent: [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found
// screen. [TeslaFeatureFlagsRoute] reads the app DI graph from [LocalDataContainer], binds the embedded
// FeatureToggles feature view to the shared S8 [io.teslasync.shared.core.presentation.user.UserStore] via
// `container.userStore`, and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.admin.teslafeatures

import androidx.compose.runtime.Composable
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `teslaFeatures` destination. Resolves the app data graph from
 * the CompositionLocal, binds the page to the shared User/Account state holder (`container.userStore`) and to
 * the app's redacting logger. No HTTP touches this route.
 */
@Composable
fun TeslaFeatureFlagsRoute() {
    val container = LocalDataContainer.current
    TeslaFeatureFlagsPage(store = container.userStore, logger = container.logger)
}

/**
 * Registers the [TeslaFeatureFlagsRoute] host for the `teslaFeatures` route. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object TeslaFeatureFlagsPageHost {
    private val id: String = TeslaFeatureFlagsPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { TeslaFeatureFlagsRoute() }
    }
}
