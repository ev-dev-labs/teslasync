// Page-host wiring for the DiskForecastPage admin surface (A7) — the seam that attaches real screen content to
// the `adminDiskForecast` ⁄ `/admin/disk-forecast` navigation destination (Destinations.kt). It mirrors the
// [io.teslasync.android.admin.secretrotation.SecretRotationPageHost] precedent: [register] is called once at
// process start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared
// not-found screen. [DiskForecastRoute] reads the app DI graph from [LocalDataContainer], binds the page to the
// shared S8 [io.teslasync.shared.core.presentation.operatorconfidence.OperatorConfidenceStore] via
// [asDiskForecastSource], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.admin.diskforecast

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `adminDiskForecast` destination. Resolves the app data graph
 * from the CompositionLocal, builds the cache-then-network source over the shared Operator-Confidence holder,
 * and binds the page to the app's redacting logger.
 */
@Composable
fun DiskForecastRoute() {
    val container = LocalDataContainer.current
    val source = remember(container) { container.operatorConfidenceStore.asDiskForecastSource() }
    DiskForecastPage(source = source, logger = container.logger)
}

/**
 * Registers the [DiskForecastRoute] host for the `adminDiskForecast` route. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object DiskForecastPageHost {
    private val id: String = DiskForecastPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { DiskForecastRoute() }
    }
}
