// Page-host wiring for the AlertRulesPage surface (A7) — the seam that attaches real screen content to the
// `notificationsRules` ⁄ `/notifications/rules` navigation destination (Destinations.kt). It mirrors the sibling
// [io.teslasync.android.driving.driveslist.DrivesListPageHost] precedent: [register] is called once at process
// start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared
// not-found screen. [AlertRulesRoute] reads the app DI graph from [LocalDataContainer], binds the page to a
// page-local notifications repository (constructed over the shared resilient client + offline cache the
// container already exposes, since the Android DI graph wires no NotificationsStore yet) via
// [alertRulesPageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.notifications.alertrules

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpNotificationsRepository

/**
 * The stateful route entry registered for the `notificationsRules` destination. Resolves the app data graph from
 * the CompositionLocal, builds the source over a page-local notifications repository (constructed from the shared
 * client + offline cache the container exposes), and binds the page to the app's redacting logger.
 */
@Composable
fun AlertRulesRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            alertRulesPageSourceOf(
                repository = HttpNotificationsRepository(container.api, container.cacheStore),
            )
        }
    AlertRulesPage(source = source, logger = container.logger)
}

/**
 * Registers the [AlertRulesRoute] host for the `notificationsRules` route. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object AlertRulesPageHost {
    private val id: String = AlertRulesPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { AlertRulesRoute() }
    }
}
