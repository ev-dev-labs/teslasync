// The UI-thread-free state holder backing the LayoutBreadcrumbs shared surface — the native binding of the web
// `useBreadcrumbOverrides()` read (web/src/components/layout/LayoutBreadcrumbs.tsx). It exposes the merged crumb
// label overrides the surface needs and the one PII-safe `view.opened` diagnostic, and owns no Compose state. The
// other web input — the current route (`useBreadcrumbs` reading `useLocation` / `useParams`) — is supplied to the
// composable by the owning navigation scaffold, exactly as the sibling RouteAnnouncer receives its destination, so
// the surface stays a thin render layer over the pure model (P1/S8 boundary, ADR-002).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces) cannot
// form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.layoutbreadcrumbs

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow

/**
 * Binds the breadcrumb-label override store to the surface and guards the one-shot diagnostic. The view only
 * collects [overrides] and calls [onViewOpened]; all label/route derivation happens in the pure model at the
 * render boundary, so this holder carries no business logic of its own.
 *
 * @param overridesStore the shared label-override state holder (web `BreadcrumbOverridesContext`); an
 *   [InMemoryBreadcrumbOverridesStore] in production, a fake in tests.
 * @param logger the single sanctioned redacting logger (ADR-016); receives only the PII-safe `view.opened` event
 *   carrying the non-PII surface slug (never a route id or crumb label).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class LayoutBreadcrumbsViewModel(
    overridesStore: BreadcrumbOverridesStore,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /** The merged crumb-label overrides the surface renders — the web `useBreadcrumbOverrides()` value. */
    val overrides: StateFlow<Map<String, String>> = overridesStore.overrides

    /** Emits the one PII-safe `view.opened` diagnostic (P1/S11), at most once per holder. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        LayoutBreadcrumbsDiagnostics.recordViewOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            overridesStore: BreadcrumbOverridesStore,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { LayoutBreadcrumbsViewModel(overridesStore, logger) }
            }
    }
}
