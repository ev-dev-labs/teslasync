// The data seam the SearchInput surface binds to for the recent-search history it reads — the native analogue
// of the web `@/lib/searchHistory` module (web/src/components/forms/SearchInput.tsx records to and reads from a
// per-scope localStorage envelope). The view (composable) performs NO IO — it only collects state from the
// [SearchInputViewModel], which drives this seam (ADR-002), satisfying the "no direct HTTP/IO from the view"
// contract. A concrete adapter over a shared, multi-observer history store backs it in production; a test fake
// backs it in unit tests.
//
// `ktlint:standard:filename` is suppressed because the mandated `SearchInput*` filename cannot match both the
// [SearchInputSource] seam and its co-located store adapter. `MatchingDeclarationName` / `InvalidPackageDeclaration`
// are suppressed for the same reasons as the rest of the surface (hyphenated directory + multiple declarations).
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.searchinput

import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

/**
 * The single, already-scoped seam the [SearchInputViewModel] depends on so it binds to an abstraction
 * (real adapter ↔ test fake), never a concrete client — the Android counterpart of the web `historyScope`
 * binding. It exposes the cache-then-network recent-search feed plus the three mutations the dropdown drives
 * (record on submit, remove one entry, clear the scope). No IO touches the view.
 */
interface SearchInputSource {
    /** The recent searches for the bound scope, newest-first, as a cache-then-network [Resource] feed. */
    fun recentSearches(): Flow<Resource<List<String>>>

    /** Records [query] into the bound scope (web `recordSearch`); below-minimum noise is ignored. */
    suspend fun record(query: String)

    /** Removes the case-insensitive match for [query] from the bound scope (web `removeSearch`). */
    suspend fun remove(query: String)

    /** Wipes every recent search in the bound scope (web `clearScope`). */
    suspend fun clearAll()
}

/**
 * The shared **P1/S8** recent-search history store — the native analogue of the web localStorage envelope
 * (`{ scopes: { [scope]: HistoryEntry[] } }`). It is an in-process, multi-observer store so every SearchInput
 * bound to the same scope sees a recorded query immediately, and it survives for the process lifetime exactly
 * like the web module's module-level state. Mutations apply the pure [recordHistory] / [removeHistory] algebra,
 * so the de-duplication, capacity, and ordering rules match the web byte-for-byte. It performs no HTTP — the
 * recent-search list is local UX state, not a server document.
 *
 * @param clock injectable wall clock (tests pin it); production uses [System.currentTimeMillis].
 * @param cap per-scope capacity; defaults to the web `CAP`.
 */
class InMemorySearchHistoryStore(
    private val clock: () -> Long = { System.currentTimeMillis() },
    private val cap: Int = SearchInputRegistration.CAP,
) {
    private val scopes = MutableStateFlow<Map<String, List<SearchHistoryEntry>>>(emptyMap())

    /**
     * Binds a [SearchInputSource] for [scope], rendering at most [maxHistory] rows. Each bound source observes
     * the same underlying store, so a record from one updates every observer of that scope.
     */
    fun source(
        scope: String,
        maxHistory: Int = SearchInputRegistration.DEFAULT_MAX_HISTORY,
    ): SearchInputSource = ScopedSource(scope, maxHistory)

    /** Test/inspection helper: the raw entries currently held for [scope] (newest-first). */
    fun snapshot(scope: String): List<SearchHistoryEntry> = scopes.value[scope] ?: emptyList()

    private fun mutate(
        scope: String,
        transform: (List<SearchHistoryEntry>) -> List<SearchHistoryEntry>,
    ) {
        scopes.update { current ->
            val next = transform(current[scope] ?: emptyList())
            if (next.isEmpty()) current - scope else current + (scope to next)
        }
    }

    private inner class ScopedSource(
        private val scope: String,
        private val maxHistory: Int,
    ) : SearchInputSource {
        override fun recentSearches(): Flow<Resource<List<String>>> =
            scopes.map { all ->
                Resource.Success(
                    data = recentQueries(all[scope] ?: emptyList(), maxHistory, cap),
                    fetchedAt = clock(),
                    stale = false,
                )
            }

        override suspend fun record(query: String) = mutate(scope) { recordHistory(it, query, clock(), cap) }

        override suspend fun remove(query: String) = mutate(scope) { removeHistory(it, query) }

        override suspend fun clearAll() = mutate(scope) { emptyList() }
    }
}

/**
 * Binds the surface to the shared **P1/S8** [InMemorySearchHistoryStore] for [scope] — convenience mirror of
 * the sibling surfaces' `asXSource` binders.
 */
fun InMemorySearchHistoryStore.asSearchInputSource(
    scope: String,
    maxHistory: Int = SearchInputRegistration.DEFAULT_MAX_HISTORY,
): SearchInputSource = source(scope, maxHistory)
