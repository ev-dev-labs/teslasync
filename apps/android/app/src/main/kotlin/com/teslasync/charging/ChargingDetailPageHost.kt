// Page-host wiring for the ChargingDetailPage surface (A7) — the seam that attaches real screen content to the
// `chargeDetail` ⁄ `/charging/:id` navigation destination (Destinations.kt). It mirrors the
// [io.teslasync.android.analytics.yearreview.YearReviewPageHost] precedent: [register] is called once at process start
// by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found screen.
// [ChargingDetailRoute] reads the numeric session id from the route argument (web `useParams().id`), resolves the app
// DI graph from [LocalDataContainer], binds the page to a page-local charging repository (over the shared client +
// cache) + the shared S8 Settings holder via [chargingDetailPageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.charging.chargingdetail

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.navigation.NavBackStackEntry
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `chargeDetail` destination. Reads the charging-session [Long] id from the
 * route argument (web `Number(id)`: a missing / non-numeric / non-positive value resolves to 0, which the view-model
 * surfaces as the empty state rather than a fetch), resolves the app data graph from the CompositionLocal, builds the
 * cache-then-network source over a page-local [ChargingDetailRepository] + the shared Settings holder, and binds the
 * page to the app's redacting logger.
 */
@Composable
fun ChargingDetailRoute(entry: NavBackStackEntry) {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            chargingDetailPageSourceOf(
                repository = ChargingDetailRepository(container.api, container.cacheStore),
                settingsStore = container.settingsStore,
            )
        }
    val sessionId =
        remember(entry) {
            entry.arguments
                ?.getString(ChargingDetailPageRegistration.ARG_ID)
                ?.toLongOrNull()
                ?.takeIf { it > 0L }
                ?: 0L
        }
    ChargingDetailPage(source = source, sessionId = sessionId, logger = container.logger)
}

/**
 * Registers the [ChargingDetailRoute] host for the `chargeDetail` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object ChargingDetailPageHost {
    private val id: String = ChargingDetailPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { entry -> ChargingDetailRoute(entry) }
    }
}
