// Pure, framework-free model for the EndpointSidebar feature view — the native analogue of the
// derivations the web component performs (web/src/features/admin/components/EndpointSidebar.tsx). No
// Compose, no Android, no HTTP: every type here is unit-tested off-device in the
// :app:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web component receives its `endpoints: ParsedEndpoint[]` as a prop from its parent
// (ApiPlaygroundPage), which fetches + parses `/system/openapi`. It binds NO data hook of its own (only
// `useTranslation`). It exports the `ParsedEndpoint` / `ParsedParam` / `ParsedBody` data contract (the
// parent + RequestBuilder import it), so this file reproduces that full exported shape, plus the two
// `useMemo` derivations the sidebar owns: the search filter (`filtered`) over path / summary /
// operationId, and the group-by-tag fold (`grouped`). The static request/response carry-through fields
// are modelled faithfully (the parent depends on them) even though the sidebar renders only the method,
// path, tag and summary — exactly as the web sidebar does.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/EndpointSidebar — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package; the package intentionally diverges from the path — exactly as every sibling
// feature-view surface does. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.endpointsidebar

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object EndpointSidebarRegistration {
    /** Stable surface id. */
    const val ID: String = "endpoint-sidebar"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "EndpointSidebar"
}

/**
 * An HTTP verb — the native port of the web `ParsedEndpoint['method']` union
 * (`'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'`). [wire] is the upper-case spelling the web renders in
 * the method badge and uses in the selection / React key (`${method}-${path}`); the render boundary maps
 * each verb to a concrete accent color (web `METHOD_COLORS`).
 */
enum class HttpMethod(
    val wire: String,
) {
    Get("GET"),
    Post("POST"),
    Put("PUT"),
    Delete("DELETE"),
    Patch("PATCH"),
    ;

    companion object {
        /** Resolves a wire verb (case-insensitive) to an [HttpMethod], or `null` if unrecognised. */
        fun fromWire(raw: String): HttpMethod? = entries.firstOrNull { it.wire.equals(raw.trim(), ignoreCase = true) }
    }
}

/** Where a parameter is carried — the native port of the web `ParsedParam['in']` (`'path' | 'query'`). */
enum class ParamLocation(
    val wire: String,
) {
    Path("path"),
    Query("query"),
    ;

    companion object {
        /** Resolves a wire location to a [ParamLocation], defaulting to [Query] (web `?? 'query'`). */
        fun fromWire(raw: String?): ParamLocation = entries.firstOrNull { it.wire.equals(raw?.trim(), ignoreCase = true) } ?: Query
    }
}

/**
 * One operation parameter — the native port of the web `ParsedParam`. Carried through to the
 * RequestBuilder surface; the sidebar itself renders none of it (web parity).
 */
data class EndpointParam(
    val name: String,
    val location: ParamLocation,
    val required: Boolean,
    val type: String,
    val description: String,
    val default: String? = null,
)

/**
 * A request body descriptor — the native port of the web `ParsedBody`. [example] is the optional raw
 * JSON example the RequestBuilder seeds its editor with; the sidebar renders none of it (web parity).
 */
data class EndpointBody(
    val contentType: String,
    val example: String? = null,
)

/** One response entry — the native port of a web `ParsedEndpoint['responses'][code]` (`{ description }`). */
data class EndpointResponse(
    val description: String,
)

/**
 * One parsed OpenAPI operation — the native port of the web `ParsedEndpoint` (exported from
 * EndpointSidebar.tsx). The sidebar reads only [method], [path], [tag] and [summary] (and [operationId]
 * for search); [parameters] / [requestBody] / [responses] are the faithful carry-through the parent +
 * RequestBuilder consume.
 */
data class ParsedEndpoint(
    val method: HttpMethod,
    val path: String,
    val tag: String,
    val summary: String,
    val description: String = "",
    val operationId: String = "",
    val parameters: List<EndpointParam> = emptyList(),
    val requestBody: EndpointBody? = null,
    val responses: Map<String, EndpointResponse> = emptyMap(),
) {
    /** Stable identity for selection + list keys — the web `${method}-${path}` composite key. */
    val identity: String get() = "${method.wire} $path"
}

/**
 * The snapshot the state holder carries — the resolved endpoint catalog (web `endpoints` prop). An empty
 * [endpoints] maps to the surface's data-empty state (the parent's spec had no operations / failed to
 * parse); the search empty state ("No matching endpoints") is a separate, filter-driven branch.
 */
data class EndpointSidebarSnapshot(
    val endpoints: List<ParsedEndpoint>,
) {
    /** No operations at all (web `endpoints.length === 0`) → the data-empty surface. */
    val isEmpty: Boolean get() = endpoints.isEmpty()

    companion object {
        /** The empty-catalog sentinel for the data-empty preview / test branch. */
        val EMPTY: EndpointSidebarSnapshot = EndpointSidebarSnapshot(emptyList())
    }
}

/** One collapsible tag section — the web `grouped` map entry (`[tag, endpoints]`). */
data class EndpointTagGroup(
    val tag: String,
    val endpoints: List<ParsedEndpoint>,
) {
    /** The endpoint count shown on the right of the group header (web `{endpoints.length}`). */
    val count: Int get() = endpoints.size
}

/**
 * The filtered + grouped projection the sidebar renders — the web `filtered` array folded into the
 * `grouped` map. [matchCount] is the post-filter endpoint count (web `filtered.length`, shown in the count
 * line and driving the empty branch); [groups] preserves first-encounter order (web `Map` insertion order).
 */
data class EndpointSidebarDisplay(
    val groups: List<EndpointTagGroup>,
    val matchCount: Int,
) {
    /** At least one endpoint matched the active query (web `filtered.length !== 0`). */
    val hasResults: Boolean get() = matchCount > 0

    /** The number of rendered tag groups (web `grouped.size`). */
    val groupCount: Int get() = groups.size
}

/**
 * Pure, side-effect-free search + group projection — the web `filtered` and `grouped` memos plus the
 * per-group `defaultOpen` rule. Drives both the composable and the off-device unit tests.
 */
object EndpointSidebarProjection {
    /** The fallback tag for an operation with no tag (web `ep.tag || 'Other'`). */
    const val OTHER_TAG: String = "Other"

    /** Below this group count every group defaults to open (web `grouped.size <= 5`). */
    const val DEFAULT_OPEN_MAX_GROUPS: Int = 5

    /**
     * The web `filtered` memo: a blank (whitespace-only) query returns the list unchanged (web `if
     * (!search.trim()) return endpoints`); otherwise it keeps operations whose path, summary OR
     * operationId contains the lower-cased query — matching the web
     * `e.path.includes(q) || e.summary.includes(q) || e.operationId.includes(q)` exactly (each lower-cased,
     * each guarded with `?? ''`; the native fields are non-null so no guard is needed).
     */
    fun filter(
        endpoints: List<ParsedEndpoint>,
        search: String,
    ): List<ParsedEndpoint> {
        if (search.trim().isEmpty()) return endpoints
        val query = search.lowercase()
        return endpoints.filter { endpoint ->
            endpoint.path.lowercase().contains(query) ||
                endpoint.summary.lowercase().contains(query) ||
                endpoint.operationId.lowercase().contains(query)
        }
    }

    /**
     * The web `grouped` memo: folds operations into tag groups in first-encounter order (web `Map`
     * insertion order), an empty tag falling back to [OTHER_TAG] (web `ep.tag || 'Other'`).
     */
    fun group(endpoints: List<ParsedEndpoint>): List<EndpointTagGroup> {
        val byTag = LinkedHashMap<String, MutableList<ParsedEndpoint>>()
        for (endpoint in endpoints) {
            val tag = endpoint.tag.ifBlank { OTHER_TAG }
            byTag.getOrPut(tag) { mutableListOf() }.add(endpoint)
        }
        return byTag.map { (tag, eps) -> EndpointTagGroup(tag, eps) }
    }

    /** The full projection — filter then group — the sidebar's two memos in one pass. */
    fun display(
        endpoints: List<ParsedEndpoint>,
        search: String,
    ): EndpointSidebarDisplay {
        val filtered = filter(endpoints, search)
        return EndpointSidebarDisplay(groups = group(filtered), matchCount = filtered.size)
    }

    /**
     * The web per-group `defaultOpen` rule: a group is initially open when it holds the currently
     * [selected] endpoint's tag, OR when there are few enough groups to show them all open at once (web
     * `selected?.tag === tag || grouped.size <= 5`).
     */
    fun isDefaultOpen(
        tag: String,
        selected: ParsedEndpoint?,
        groupCount: Int,
    ): Boolean = selected?.tag == tag || groupCount <= DEFAULT_OPEN_MAX_GROUPS
}
