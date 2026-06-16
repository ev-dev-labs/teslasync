// Page-host wiring for the AnalyticsPage surface (A7) — the seam that attaches real screen content to the
// `analytics` ⁄ `/analytics` navigation destination (Destinations.kt). It mirrors the sibling A7 hosts (e.g.
// [io.teslasync.android.admin.slowqueries.SlowQueriesPageHost]): [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found
// screen. [AnalyticsRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared S8
// [io.teslasync.shared.core.presentation.analytics.AnalyticsStore] via [asAnalyticsSource], and performs no
// HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.analytics

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `analytics` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the shared S8 Analytics holder, and binds the page to the app's
 * redacting logger.
 */
@Composable
fun AnalyticsRoute() {
    val container = LocalDataContainer.current
    val source = remember(container) { container.analyticsStore.asAnalyticsSource() }
    AnalyticsPage(source = source, logger = container.logger)
}

/**
 * Registers the [AnalyticsRoute] host for the `analytics` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object AnalyticsPageHost {
    private val id: String = AnalyticsPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { AnalyticsRoute() }
    }
}
