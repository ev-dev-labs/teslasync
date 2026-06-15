// Page-host wiring for the PowersharePage surface (A7) — the seam that attaches real screen content to the
// `powershare` ⁄ `/powershare` navigation destination (Destinations.kt L64). It mirrors the sibling
// [io.teslasync.android.charging.chargingcurve.ChargingCurvePageHost] precedent: [register] is called once at
// process start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared
// not-found screen. [PowershareRoute] reads the app DI graph from [LocalDataContainer], binds the page to the
// app-scoped active-vehicle selection and a page-local telemetry repository (constructed over the shared resilient
// client + offline cache the container already exposes, since the Android DI graph wires no TelemetryStore yet)
// via [powersharePageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.charging.powershare

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpTelemetryRepository

/**
 * The stateful route entry registered for the `powershare` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the app-scoped active-vehicle selection + a page-local telemetry
 * repository (constructed from the shared client + offline cache the container exposes), and binds the page to the
 * app's redacting logger.
 */
@Composable
fun PowershareRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            powersharePageSourceOf(
                telemetryRepository = HttpTelemetryRepository(container.api, container.cacheStore),
                selectedVehicleStore = container.selectedVehicleStore,
            )
        }
    PowersharePage(source = source, logger = container.logger)
}

/**
 * Registers the [PowershareRoute] host for the `powershare` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object PowersharePageHost {
    private val id: String = PowersharePageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { PowershareRoute() }
    }
}
