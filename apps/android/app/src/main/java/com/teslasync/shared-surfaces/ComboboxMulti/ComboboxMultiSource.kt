// The data seam the ComboboxMulti surface binds to for its options — the native analogue of the web `options`
// prop (web/src/components/forms/ComboboxMulti.tsx), which is either a static array OR an async loader
// `(query, signal) => Promise<T[]>`. The view (composable) performs NO HTTP — it only collects state from the
// [ComboboxMultiViewModel], which drives this seam (ADR-002), satisfying the "no direct HTTP from the view"
// contract. A static adapter backs the static-array case; an async adapter backs the loader case (its
// per-keystroke cancellation is realised by `flatMapLatest` in the ViewModel, the native equivalent of the web
// `AbortController`). A test fake backs it in unit tests.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ComboboxMulti) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed: the mandated `ComboboxMulti*` filename cannot match the `ComboboxMultiOptionsSource` seam name.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "ktlint:standard:filename")

package io.teslasync.android.sharedsurfaces.comboboxmulti

import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlin.coroutines.coroutineContext

/**
 * The single seam the [ComboboxMultiViewModel] depends on so it binds to an abstraction (real adapter ↔ test
 * fake), never a concrete client — the Android counterpart of the web `options` prop. [load] is a cold,
 * cache-then-network [Resource] feed keyed on the current filter [query]; the ViewModel debounces the query and
 * `flatMapLatest`-cancels an in-flight load when the next keystroke arrives, exactly as the web aborts the
 * previous fetch. No HTTP touches the view.
 */
fun interface ComboboxMultiOptionsSource {
    /** Cache-then-network options feed for the current filter [query]. */
    fun load(query: String): Flow<Resource<List<ComboboxMultiOption>>>
}

/**
 * Binds the surface to a fixed, in-memory option set — the web static-array `options` case. Filtering happens
 * in [ComboboxMultiProjection], so the full set is emitted once as a fresh [Resource.Success]; there is no
 * network, hence no loading flicker, error, or staleness for this source.
 */
fun staticComboboxOptions(options: List<ComboboxMultiOption>): ComboboxMultiOptionsSource =
    ComboboxMultiOptionsSource {
        flow { emit(Resource.Success(options, fetchedAt = STATIC_STAMP, stale = false)) }
    }

/**
 * Binds the surface to an async loader — the web `(query, signal) => Promise<T[]>` case. The cold feed emits
 * [Resource.Loading] immediately (the dropdown's spinner row), then the loaded options as [Resource.Success]
 * or, on failure, [Resource.Error] (the honest retry surface the web swallows to an empty list). Coroutine
 * cancellation — raised when `flatMapLatest` abandons this load for a newer query — is re-checked through
 * [ensureActive] so it propagates instead of being mis-reported as a load error.
 */
fun asyncComboboxOptions(loader: suspend (query: String) -> List<ComboboxMultiOption>): ComboboxMultiOptionsSource =
    ComboboxMultiOptionsSource { query ->
        flow {
            emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
            val outcome = runCatching { loader(query) }
            outcome.exceptionOrNull()?.let { coroutineContext.ensureActive() }
            outcome
                .onSuccess { emit(Resource.Success(it, fetchedAt = STATIC_STAMP, stale = false)) }
                .onFailure { emit(Resource.Error(cached = null, fetchedAt = null, stale = false, error = it)) }
        }
    }

/** Deterministic freshness stamp for the non-timestamped sources (static + async one-shot). */
private const val STATIC_STAMP: Long = 0L
