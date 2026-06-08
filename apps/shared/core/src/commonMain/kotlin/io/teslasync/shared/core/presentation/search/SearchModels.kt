package io.teslasync.shared.core.presentation.search

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The entity kinds the unified search endpoint can return — the cross-platform port of the web
 * `SearchHitType` union (web/src/api/types.ts). Each constant's [wire] string is the verbatim token
 * the backend sends (and accepts in the `types` filter), matched via [SerialName] so a hit decodes
 * unchanged and a type filter serialises to the same comma-joined list the web hook sends.
 */
@Serializable
public enum class SearchHitType(
    public val wire: String,
) {
    @SerialName("vehicle")
    Vehicle("vehicle"),

    @SerialName("drive")
    Drive("drive"),

    @SerialName("charging")
    Charging("charging"),

    @SerialName("alert")
    Alert("alert"),

    @SerialName("notification")
    Notification("notification"),

    @SerialName("geofence")
    Geofence("geofence"),

    @SerialName("automation")
    Automation("automation"),

    @SerialName("location")
    Location("location"),

    @SerialName("trip")
    Trip("trip"),
}

/**
 * One unified-search result row — the cross-platform port of the web `SearchHit` interface
 * (web/src/api/types.ts). Keys arrive from `GET /api/v1/search?q=`; they are matched verbatim via
 * [SerialName] so the cached payload round-trips unchanged.
 *
 * [type], [id], [title], [url], and [score] are always present; [subtitle] and [whenAt] are
 * nullable (the web `subtitle?` / `when?`). [whenAt] carries the server's `when` field, renamed here
 * only because `when` is a Kotlin hard keyword. No field is unit-bearing, so there is no SI
 * conversion at this layer — display formatting is the render boundary's job (S5).
 */
@Serializable
public data class SearchHit(
    val type: SearchHitType,
    val id: Long,
    val title: String,
    val subtitle: String? = null,
    val url: String,
    val score: Double,
    @SerialName("when") val whenAt: String? = null,
)

/**
 * The unified-search response envelope — the cross-platform port of the web `SearchResponse`
 * interface (web/src/api/types.ts). [hits] is always an array (never null), exactly as the web hook
 * guarantees; [query] echoes back the server-normalised query string.
 */
@Serializable
public data class SearchResponse(
    val hits: List<SearchHit> = emptyList(),
    val query: String = "",
)

/**
 * The minimum trimmed query length the server enforces — mirrored from the web
 * `SEARCH_MIN_QUERY_LENGTH` (web/src/api/hooks/useSearch.ts) so the holder can short-circuit a
 * too-short query to empty hits WITHOUT a network round-trip, exactly as the web hook's `enabled`
 * guard does.
 */
public const val SEARCH_MIN_QUERY_LENGTH: Int = 2

/**
 * The optional knobs for a global search — the cross-platform port of the web
 * `UseGlobalSearchOptions` (web/src/api/hooks/useSearch.ts).
 *
 * @property types when non-empty, restrict the search to these entity types (web `options.types`).
 * @property limit per-type LIMIT passed to the backend, clamped server-side to `[1, 25]` (web
 *   `options.limit`); only sent on the wire when `> 0`.
 * @property disabled when `true`, the search is gated off regardless of query length (web
 *   `options.disabled`).
 */
public data class SearchOptions(
    val types: List<SearchHitType> = emptyList(),
    val limit: Int? = null,
    val disabled: Boolean = false,
)

/**
 * The bundled input a [SearchStore] resolves — the raw [query] string plus its [options]. Mirrors
 * the web hook's `(query, options)` argument pair so a change to either re-plans the read.
 */
public data class SearchInput(
    val query: String,
    val options: SearchOptions = SearchOptions(),
)

/**
 * The decision of whether a given [SearchInput] should hit the network — the language-neutral
 * derivation of the web hook's `enabled` guard (web/src/api/hooks/useSearch.ts):
 * `!disabled && query.trim().length >= SEARCH_MIN_QUERY_LENGTH`.
 *
 * A [Skip] reproduces the web `enabled: false` branch — no request is made and the holder surfaces
 * empty hits (or the retained previous hits, mirroring the web hook's `(prev) => prev` keep-previous
 * option). A [Fetch] carries the TRIMMED query (the web `trimmed`) and the filters so the repository
 * builds the exact `/search` params the web `queryFn` does.
 */
public sealed interface SearchRequestPlan {
    /** The query is too short or the search is disabled: emit empty/previous hits, issue no request. */
    public data object Skip : SearchRequestPlan

    /** The query is enabled: fetch with the trimmed query and the supplied filters. */
    public data class Fetch(
        val query: String,
        val types: List<SearchHitType>,
        val limit: Int?,
    ) : SearchRequestPlan
}

/**
 * Plans a global search exactly as the web `useGlobalSearch` hook does: trims the query, then gates
 * the request on `!disabled && trimmed.length >= SEARCH_MIN_QUERY_LENGTH`. Returns
 * [SearchRequestPlan.Fetch] carrying the trimmed query (so the request and cache key match the web
 * `trimmed`) when enabled, or [SearchRequestPlan.Skip] otherwise. Locked by the golden vectors shared
 * with the Windows C# port.
 */
public fun planSearch(input: SearchInput): SearchRequestPlan {
    val trimmed = input.query.trim()
    val enabled = !input.options.disabled && trimmed.length >= SEARCH_MIN_QUERY_LENGTH
    return if (enabled) {
        SearchRequestPlan.Fetch(query = trimmed, types = input.options.types, limit = input.options.limit)
    } else {
        SearchRequestPlan.Skip
    }
}
