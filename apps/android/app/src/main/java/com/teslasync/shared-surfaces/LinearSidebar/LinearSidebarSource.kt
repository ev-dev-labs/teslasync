// The data seam the LinearSidebar surface binds to for the nav tree it filters and renders — the native
// analogue of the web component's props (web/src/components/layout/sidebar/LinearSidebar.tsx), which the
// parent (Layout.tsx) owns: the `navSections` catalog, the `pinnedItems`, the `useLocation().pathname` active
// route, and the badge counts. The view (composable) performs NO HTTP — it only collects state from the
// [LinearSidebarViewModel], which drives this seam (ADR-002), satisfying the "no direct HTTP from the view"
// contract. In production the owning shell wires a concrete adapter over the shared S8 stores (the nav
// registry + the pin store + the navigation back-stack's current route); a test fake backs it in unit tests.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/LinearSidebar) cannot form a valid Kotlin package. `MatchingDeclarationName`
// and the ktlint filename rule are suppressed: the mandated `LinearSidebar*` filename cannot match the
// `LinearSidebarSource` seam plus its co-located adapter factories.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.linearsidebar

import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf

/** Fixed `fetchedAt` stamp for a static, always-fresh nav tree (it never goes stale). */
private const val STATIC_FETCHED_AT: Long = 0L

/**
 * The single seam the [LinearSidebarViewModel] depends on so it binds to an abstraction (real adapter ↔ test
 * fake), never a concrete client — the Android counterpart of the web LinearSidebar's props. The nav tree is
 * carried as a cache-then-network [Resource] of a [LinearSidebarNav] so the surface honours the ADR-013
 * loading / content / empty / error / stale / offline lifecycle uniformly, whether the underlying feed is a
 * static in-memory registry or an async store query. No HTTP touches the view.
 */
fun interface LinearSidebarSource {
    /**
     * The nav-tree feed. A static adapter emits a single fresh [Resource.Success]; an async adapter emits
     * [Resource.Loading] then a terminal success or error. The inline tree filter is applied in-surface (by
     * [LinearSidebarProjection]), so the feed is the full nav tree and is re-subscribed only on an explicit
     * retry / refresh — never per keystroke.
     */
    fun nav(): Flow<Resource<LinearSidebarNav>>
}

/**
 * Binds the surface to a **static** nav tree — the common case where the shell already holds the full
 * `navSections` + `pinnedItems` + current route. Emitted as a single always-fresh [Resource.Success], so the
 * body shows the tree or, when the tree is empty, the empty state. No HTTP touches the view.
 */
fun staticLinearSidebarSource(
    nav: LinearSidebarNav,
    fetchedAt: Long = STATIC_FETCHED_AT,
): LinearSidebarSource =
    LinearSidebarSource {
        flowOf(
            Resource.Success(
                data = nav,
                fetchedAt = fetchedAt,
                stale = false,
            ),
        )
    }

/** Convenience binding from a static [LinearSidebarNav] to a [staticLinearSidebarSource]. */
fun LinearSidebarNav.asLinearSidebarSource(fetchedAt: Long = STATIC_FETCHED_AT): LinearSidebarSource =
    staticLinearSidebarSource(this, fetchedAt)

/**
 * Binds the surface to an **async** nav [loader] — for shells that resolve the nav tree from a shared S8 store
 * (e.g. an account-scoped nav registry gated on forward-auth). Each subscription opens with [Resource.Loading]
 * (so the skeleton chrome shows) and resolves to a terminal [Resource.Success] or, on failure,
 * [Resource.Error] (driving the error surface + retry). A [CancellationException] is re-thrown rather than
 * reported as a failure. The owning shell wires [loader] to a shared store query; the view never reaches the
 * network itself.
 */
fun asyncLinearSidebarSource(
    now: () -> Long = System::currentTimeMillis,
    loader: suspend () -> LinearSidebarNav,
): LinearSidebarSource =
    LinearSidebarSource {
        flow {
            emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
            val outcome = runCatching { loader() }
            val failure = outcome.exceptionOrNull()
            when {
                failure is CancellationException -> throw failure
                failure != null -> emit(Resource.Error(cached = null, fetchedAt = null, stale = false, error = failure))
                else -> emit(Resource.Success(data = outcome.getOrThrow(), fetchedAt = now(), stale = false))
            }
        }
    }
