// Page-host wiring for the PeriodComparePage analytics surface (A7) — the seam that attaches real screen content
// to the `periodCompare` ⁄ `/period-compare` navigation destination (already declared in Destinations.kt). It
// mirrors the admin-surface precedent (e.g. SchemaDriftPageHost): [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found screen.
// [PeriodCompareRoute] reads the app DI graph from [LocalDataContainer] for the shared S8 Vehicles holder (the
// `useVehicles` source), the live unit formatter, and the redacting logger, and reads the resilient
// [io.teslasync.shared.core.net.ApiHttpClient] from the process [io.teslasync.android.auth.AuthContainer] for the
// period-stats reads (the web page's raw `request()` has no KMP repository surface). The route performs no HTTP
// itself — it only assembles the source the view-model drives.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.analytics.periodcompare

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import io.teslasync.android.TeslaSyncApplication
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `periodCompare` destination. Resolves the app data graph from the
 * CompositionLocal (Vehicles holder + unit formatter + logger) and the resilient HTTP client from the process
 * auth container, builds the [PeriodCompareSource] over them, and binds the page to the app's redacting logger.
 */
@Composable
fun PeriodCompareRoute() {
    val container = LocalDataContainer.current
    val context = LocalContext.current
    val api = remember(context) { (context.applicationContext as TeslaSyncApplication).container.apiHttpClient }
    val source = remember(container, api) { periodCompareSource(container.vehiclesStore, api) }
    PeriodComparePage(
        source = source,
        unitFormatter = container.unitFormatter,
        logger = container.logger,
    )
}

/**
 * Registers the [PeriodCompareRoute] host for the `periodCompare` route. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object PeriodComparePageHost {
    private val id: String = PeriodComparePageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { PeriodCompareRoute() }
    }
}
