// The data seam the Combobox surface binds to for the options it filters and renders — the native analogue
// of the web component's `options` prop (web/src/components/forms/Combobox.tsx), which is either a static
// array filtered locally or an async loader keyed by the typed query. The view (composable) performs NO HTTP
// — it only collects state from the [ComboboxViewModel], which drives this seam (ADR-002), satisfying the
// "no direct HTTP from the view" contract. In production the owning page wires a concrete adapter over a
// shared S8 store (a vehicle / signal / geocoded-address feed — exactly as the trip-planner wires its
// AddressInput `geocode` seam to `DrivingStore.geocodeSearch`); a test fake backs it in unit tests.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Combobox) cannot form a valid Kotlin package. `MatchingDeclarationName` and
// the ktlint filename rule are suppressed: the mandated `Combobox*` filename cannot match the
// `ComboboxSource` seam plus its co-located adapter factories.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.combobox

import io.teslasync.android.components.forms.ComboOption
import io.teslasync.android.components.forms.filterComboOptions
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf

/** Fixed `fetchedAt` stamp for a static, always-fresh option list (it never goes stale). */
private const val STATIC_FETCHED_AT: Long = 0L

/**
 * The single seam the [ComboboxViewModel] depends on so it binds to an abstraction (real adapter ↔ test
 * fake), never a concrete client — the Android counterpart of the web Combobox's `options` prop. The
 * options are carried as a cache-then-network [Resource] of shared [ComboOption]s so the surface honours the
 * ADR-013 loading / results / empty / error / stale / offline lifecycle uniformly, whether the underlying
 * feed is a static array or an async per-keystroke loader. No HTTP touches the view.
 */
fun interface ComboboxSource {
    /**
     * The option feed for the current (debounced) [query]. A static adapter pre-filters the array and emits a
     * single fresh [Resource.Success]; an async adapter emits [Resource.Loading] then a terminal success or
     * error, and is cancelled by the ViewModel's `flatMapLatest` when a newer keystroke arrives (the web
     * "every new keystroke cancels the previous in-flight request").
     */
    fun options(query: String): Flow<Resource<List<ComboOption>>>
}

/**
 * Binds the surface to a **static** option array — the web `defaultFilter` branch. The array is filtered
 * locally by [io.teslasync.android.components.forms.filterComboOptions] (case-insensitive label `contains`,
 * a blank query returns everything) and emitted as a single always-fresh [Resource.Success], so the dropdown
 * shows [ComboboxPhase.Results] or, when nothing matches, [ComboboxPhase.Empty]. No HTTP touches the view.
 */
fun staticComboboxSource(
    options: List<ComboOption>,
    fetchedAt: Long = STATIC_FETCHED_AT,
): ComboboxSource =
    ComboboxSource { query ->
        flowOf(
            Resource.Success(
                data = filterComboOptions(options, query),
                fetchedAt = fetchedAt,
                stale = false,
            ),
        )
    }

/** Convenience binding from a static [ComboOption] array to a [staticComboboxSource]. */
fun List<ComboOption>.asComboboxSource(fetchedAt: Long = STATIC_FETCHED_AT): ComboboxSource = staticComboboxSource(this, fetchedAt)

/**
 * Binds the surface to an **async** option [loader] keyed by the typed query — the web async-loader branch.
 * Each emission opens with [Resource.Loading] (so the input's loading mark spins) and resolves to a terminal
 * [Resource.Success] or, on failure, [Resource.Error] (driving the dropdown's error row + retry). A
 * [CancellationException] from `flatMapLatest` aborting the previous request is re-thrown rather than
 * reported as a failure, exactly mirroring the web AbortController contract. The owning page wires [loader]
 * to a shared S8 store query; the view never reaches the network itself.
 */
fun asyncComboboxSource(
    now: () -> Long = System::currentTimeMillis,
    loader: suspend (String) -> List<ComboOption>,
): ComboboxSource =
    ComboboxSource { query ->
        flow {
            emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
            val outcome = runCatching { loader(query) }
            val failure = outcome.exceptionOrNull()
            when {
                failure is CancellationException -> throw failure
                failure != null -> emit(Resource.Error(cached = null, fetchedAt = null, stale = false, error = failure))
                else -> emit(Resource.Success(data = outcome.getOrThrow(), fetchedAt = now(), stale = false))
            }
        }
    }
