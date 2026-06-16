// Page-host wiring for the SafetySettingsPage vehicle-systems surface (A7) — the seam that attaches real screen content
// to the `safetySettings` ⁄ `/safety-settings` navigation destination (Destinations.kt). It mirrors the sibling A7
// precedents (e.g. [io.teslasync.android.analytics.statistics.StatisticsPageHost]): [register] is called once at
// process start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared
// not-found screen. [SafetySettingsRoute] reads the app DI graph from [LocalDataContainer], binds the page to the
// page-local safety repository (constructed over the shared resilient client + offline cache the container exposes) +
// the shared Settings holder + the app-scoped active-vehicle selection via [safetySettingsPageSourceOf], and performs
// no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.vehiclesystems.safetysettings

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `safetySettings` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the page-local [SafetyExtrasRepository] (constructed from the shared client
 * + offline cache the container exposes) + the shared Settings holder + the active-vehicle selection, and binds the
 * page to the app's redacting logger.
 */
@Composable
fun SafetySettingsRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            safetySettingsPageSourceOf(
                extras = SafetyExtrasRepository(container.api, container.cacheStore),
                settingsStore = container.settingsStore,
                selectedVehicleStore = container.selectedVehicleStore,
            )
        }
    SafetySettingsPage(source = source, logger = container.logger)
}

/**
 * Registers the [SafetySettingsRoute] host for the `safetySettings` route. Called once at process start; idempotent so
 * a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object SafetySettingsPageHost {
    private val id: String = SafetySettingsPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { SafetySettingsRoute() }
    }
}
