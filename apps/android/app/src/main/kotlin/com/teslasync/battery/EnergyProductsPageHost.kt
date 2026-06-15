// Page-host wiring for the EnergyProductsPage battery surface (A7) — the seam that attaches real screen content to the
// `energyProducts` ⁄ `/energy-products` navigation destination (Destinations.kt). It mirrors the sibling
// [io.teslasync.android.battery.batteryhealth.BatteryHealthPageHost] precedent: [register] is called once at process
// start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found
// screen. [EnergyProductsRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared S8
// Energy + Settings holders via [energyProductsPageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.battery.energyproducts

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `energyProducts` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the shared Energy + Settings holders, and binds the page to the app's
 * redacting logger.
 */
@Composable
fun EnergyProductsRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            energyProductsPageSourceOf(
                energyStore = container.energyStore,
                settingsStore = container.settingsStore,
            )
        }
    EnergyProductsPage(source = source, logger = container.logger)
}

/**
 * Registers the [EnergyProductsRoute] host for the `energyProducts` route. Called once at process start; idempotent so
 * a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object EnergyProductsPageHost {
    private val id: String = EnergyProductsPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { EnergyProductsRoute() }
    }
}
