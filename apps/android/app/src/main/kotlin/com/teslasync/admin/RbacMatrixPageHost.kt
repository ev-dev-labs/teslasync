// Page-host wiring for the RbacMatrixPage admin surface (A7) — the seam that attaches real screen content to
// the native `RbacMatrixPage` navigation destination ([io.teslasync.android.navigation.TeslaSyncNavHost]).
// It mirrors the [io.teslasync.android.admin.feedback.FeedbackQueuePageHost] precedent: [register] is called
// once at process start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to
// the shared not-found screen. The web page is currently un-wired in `web/src/App.tsx` (no canonical web
// path), so the surface is registered by its stable id rather than mapped from a web route.
// [RbacMatrixRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared S8
// [io.teslasync.shared.core.presentation.rbacmatrix.RbacMatrixStore] via [asRbacMatrixSource], and performs
// no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.admin.rbac

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `RbacMatrixPage` destination. Resolves the app data graph from
 * the CompositionLocal, builds the source over the shared S8 RBAC holder, and binds the page to the app's
 * redacting logger.
 */
@Composable
fun RbacMatrixRoute() {
    val container = LocalDataContainer.current
    val source = remember(container) { container.rbacMatrixStore.asRbacMatrixSource() }
    RbacMatrixPage(source = source, logger = container.logger)
}

/**
 * Registers the [RbacMatrixRoute] host for the `RbacMatrixPage` route. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object RbacMatrixPageHost {
    private val id: String = RbacMatrixRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { RbacMatrixRoute() }
    }
}
