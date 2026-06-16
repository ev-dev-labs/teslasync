// Page-host wiring for the ActiveSessionsPage settings surface (A7) — the seam that attaches real screen content
// to the `accountSessions` ⁄ `/account/sessions` navigation destination (Destinations.kt, already a
// metadata-only route). It mirrors the sibling [io.teslasync.android.notifications.archived.ArchivedPageHost]
// precedent: [register] is called once at process start by [io.teslasync.android.TeslaSyncApplication]; until
// then the route falls through to the shared not-found screen. [ActiveSessionsRoute] reads the app DI graph from
// [LocalDataContainer], binds the page to a sessions repository over the shared resilient client + offline cache
// (via [activeSessionsPageSourceOf]), and performs no HTTP itself.
//
// The sessions feed is bound through an [HttpSessionRepository] (the same resilient client + cache the shared
// stores run on) assembled into the P1/S8 SessionsStore by the view-model, so the open-mode normalisation,
// freshness, and invalidate-on-revoke contract come from the shared layer unchanged.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/settings) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.settings.sessions

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpSessionRepository

/**
 * The stateful route entry registered for the `accountSessions` destination. Resolves the app data graph from
 * the CompositionLocal, builds the source over a sessions repository (the shared resilient client + offline
 * cache), and binds the page to the app's redacting logger. The cache-then-network list feed and the two revoke
 * mutations live entirely in the shared P1/S8 SessionsStore the view-model assembles; this route owns no data of
 * its own.
 */
@Composable
fun ActiveSessionsRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            activeSessionsPageSourceOf(
                repository = HttpSessionRepository(container.api, container.cacheStore),
            )
        }
    ActiveSessionsPage(source = source, logger = container.logger)
}

/**
 * Registers the [ActiveSessionsRoute] host for the `accountSessions` route. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object ActiveSessionsPageHost {
    private val id: String = ActiveSessionsPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { ActiveSessionsRoute() }
    }
}
