// Page-host wiring for the YearReviewPage analytics surface (A7) — the seam that attaches real screen content to
// the `yearReview` ⁄ `/year-review/:year` navigation destination (Destinations.kt). It mirrors the
// [io.teslasync.android.analytics.lifetimestats.LifetimeStatsPageHost] precedent: [register] is called once at
// process start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared
// not-found screen. [YearReviewRoute] reads the recap year from the route argument (web `useParams().year`),
// resolves the app DI graph from [LocalDataContainer], binds the page to the shared S8 Vehicles + Analytics
// holders via [yearReviewPageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.analytics.yearreview

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.navigation.NavBackStackEntry
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import java.time.Year

/**
 * The stateful route entry registered for the `yearReview` destination. Reads the recap [year] from the route
 * argument (web `Number(yearParam) || new Date().getFullYear()`: a missing / non-numeric / zero value falls back
 * to the current calendar year), resolves the app data graph from the CompositionLocal, builds the
 * cache-then-network source over the shared Vehicles + Analytics holders, and binds the page to the app's
 * redacting logger.
 */
@Composable
fun YearReviewRoute(entry: NavBackStackEntry) {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            yearReviewPageSourceOf(
                vehiclesStore = container.vehiclesStore,
                analyticsStore = container.analyticsStore,
                settingsStore = container.settingsStore,
            )
        }
    val year =
        remember(entry) {
            entry.arguments
                ?.getString(YearReviewPageRegistration.ARG_YEAR)
                ?.toIntOrNull()
                ?.takeIf { it != 0 }
                ?: Year.now().value
        }
    YearReviewPage(source = source, year = year, logger = container.logger)
}

/**
 * Registers the [YearReviewRoute] host for the `yearReview` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object YearReviewPageHost {
    private val id: String = YearReviewPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { entry -> YearReviewRoute(entry) }
    }
}
