// The data seam the TreeSelect surface binds to for the group/leaf catalog it filters and renders — the
// native analogue of the web component's `groups` prop (web/src/components/forms/TreeSelect.tsx), which the
// parent owns. The view (composable) performs NO HTTP — it only collects state from the [TreeSelectViewModel],
// which drives this seam (ADR-002), satisfying the "no direct HTTP from the view" contract. In production the
// owning page wires a concrete adapter over a shared S8 store (a signal catalog, a column registry, a vehicle
// list …); a test fake backs it in unit tests.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/TreeSelect) cannot form a valid Kotlin package. `MatchingDeclarationName` and
// the ktlint filename rule are suppressed: the mandated `TreeSelect*` filename cannot match the
// `TreeSelectSource` seam plus its co-located adapter factories.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.treeselect

import io.teslasync.android.components.forms.TreeGroup
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf

/** Fixed `fetchedAt` stamp for a static, always-fresh catalog (it never goes stale). */
private const val STATIC_FETCHED_AT: Long = 0L

/**
 * The single seam the [TreeSelectViewModel] depends on so it binds to an abstraction (real adapter ↔ test
 * fake), never a concrete client — the Android counterpart of the web TreeSelect's `groups` prop. The catalog
 * is carried as a cache-then-network [Resource] of shared [TreeGroup]s so the surface honours the ADR-013
 * loading / content / empty / error / stale / offline lifecycle uniformly, whether the underlying feed is a
 * static array or an async store query. No HTTP touches the view.
 */
fun interface TreeSelectSource {
    /**
     * The group/leaf catalog feed. A static adapter emits a single fresh [Resource.Success]; an async adapter
     * emits [Resource.Loading] then a terminal success or error. The search filter is applied in-surface (by
     * [TreeSelectProjection]), so the feed is the full catalog and is re-subscribed only on an explicit retry
     * / refresh — never per keystroke.
     */
    fun groups(): Flow<Resource<List<TreeGroup>>>
}

/**
 * Binds the surface to a **static** catalog array — the common web case where the parent already holds the
 * full `groups`. Emitted as a single always-fresh [Resource.Success], so the body shows
 * [TreeSelectPhase.Content] or, when the array is empty, [TreeSelectPhase.Empty]. No HTTP touches the view.
 */
fun staticTreeSelectSource(
    groups: List<TreeGroup>,
    fetchedAt: Long = STATIC_FETCHED_AT,
): TreeSelectSource =
    TreeSelectSource {
        flowOf(
            Resource.Success(
                data = groups,
                fetchedAt = fetchedAt,
                stale = false,
            ),
        )
    }

/** Convenience binding from a static [TreeGroup] array to a [staticTreeSelectSource]. */
fun List<TreeGroup>.asTreeSelectSource(fetchedAt: Long = STATIC_FETCHED_AT): TreeSelectSource = staticTreeSelectSource(this, fetchedAt)

/**
 * Binds the surface to an **async** catalog [loader] — for catalogs fetched from a shared S8 store. Each
 * subscription opens with [Resource.Loading] (so the skeleton chrome shows) and resolves to a terminal
 * [Resource.Success] or, on failure, [Resource.Error] (driving the error surface + retry). A
 * [CancellationException] is re-thrown rather than reported as a failure. The owning page wires [loader] to a
 * shared store query; the view never reaches the network itself.
 */
fun asyncTreeSelectSource(
    now: () -> Long = System::currentTimeMillis,
    loader: suspend () -> List<TreeGroup>,
): TreeSelectSource =
    TreeSelectSource {
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
