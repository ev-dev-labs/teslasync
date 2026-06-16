// Page-host wiring for the AlertStudioPage surface (A7) — the seam that attaches real screen content to the
// `notificationsStudio` ⁄ `/notifications/studio` navigation destination (Destinations.kt). It mirrors the
// sibling [io.teslasync.android.charging.chargingcurve.ChargingCurvePageHost] precedent: [register] is called
// once at process start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to
// the shared not-found screen. [AlertStudioRoute] reads the app DI graph from [LocalDataContainer], binds the
// page to a page-local Notifications + Vehicles repository pair (constructed over the shared resilient client +
// offline cache the container already exposes, since the Android DI graph wires no NotificationsStore yet) via
// [alertStudioPageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications)
// diverges from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is
// suppressed for the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.notifications.alertstudio

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpNotificationsRepository
import io.teslasync.shared.core.data.repo.HttpVehiclesRepository

/**
 * The stateful route entry registered for the `notificationsStudio` destination. Resolves the app data graph
 * from the CompositionLocal, builds the source over a page-local Notifications + Vehicles repository pair
 * (constructed from the shared client + offline cache the container exposes), and binds the page to the app's
 * redacting logger.
 */
@Composable
fun AlertStudioRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            alertStudioPageSourceOf(
                notificationsRepository = HttpNotificationsRepository(container.api, container.cacheStore),
                vehiclesRepository = HttpVehiclesRepository(container.api, container.cacheStore),
            )
        }
    AlertStudioPage(source = source, logger = container.logger)
}

/**
 * Registers the [AlertStudioRoute] host for the `notificationsStudio` route. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object AlertStudioPageHost {
    private val id: String = AlertStudioPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { AlertStudioRoute() }
    }
}
