// Pure, framework-free model + projection for the TeslaApiRefTool feature view — the native analogue
// of every derivation the web component performs before returning JSX
// (web/src/features/admin/components/devtools/tools/TeslaApiRefTool.tsx, which filters the static
// TESLA_ENDPOINTS constant from ../constants.ts). No Compose, no Android, no HTTP: every type here is
// unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin
// render layer.
//
// The web source binds NO data feed — its only hook is `useTranslation`, and its data is a
// compile-time constant. There is therefore no loading / error / stale / offline branch in the source
// to reproduce; the genuine surface states are exactly two: the rendered table (web `data`) and the
// search-yields-nothing empty state (web `DataTable` `emptyMessage`). Inventing async lifecycle states
// the source does not have would be drift, so — as the sibling ToolCard and ReferenceLinksSection
// surfaces document — only the states the spec actually has are modelled. The single derivation the
// web performs is the `useMemo` search filter and the per-row `method === 'GET' ? 'info' : 'warning'`
// badge accent; both live here as pure functions.
//
// i18n note (web parity): the web renders six `t(...)` strings. Four of the keys — `Tesla Api Ref`,
// `Tesla Api Ref Desc`, `Search Endpoints`, `Endpoint Desc` — are absent from BOTH the web catalog
// (web/src/i18n/en.json has no entry, so i18next returns the raw key text) AND the generated Android
// catalog, while `Method` / `Path` (and the `Copy` / `Copied` / pagination / no-data keys the shared
// components need) are present. The composable therefore resolves the four absent keys by name through
// the i18n facade (so the localized value renders the moment the catalog generates it) and otherwise
// falls back to the documented default in [TeslaApiRefDefaults] — which equals the exact text the web
// renders today (the natural-language key itself). This mirrors the ReferenceLinksSection precedent and
// is intentional + documented, never silent.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/TeslaApiRefTool — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package identifier (a hyphen and PascalCase segments are illegal), so the package
// intentionally diverges from the path — exactly as every sibling feature view does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.teslaapiref

/**
 * Canonical metadata for this surface. There is no web dashboard-registry entry to mirror (the web
 * `TeslaApiRefTool` is a composed dev-tool, not a draggable widget), so this object carries the
 * cross-cutting identifiers every surface owes: the diagnostics surface [SLUG] emitted with the
 * one-shot `view.opened` event (P1/S11), the [TABLE_ID] mirroring the web `tableId`, and the
 * pagination [PAGE_SIZE] reproducing the web `DataTable` default page size.
 */
object TeslaApiRefToolRegistration {
    /** Stable surface id. */
    const val ID: String = "tesla-api-ref-tool"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "TeslaApiRefTool"

    /** Web parity: the `DataTable` `tableId="admin:tesla-api-ref"` (column-preference persistence key). */
    const val TABLE_ID: String = "admin:tesla-api-ref"

    /** Web parity: the `DataTable` default page size when `pagination` is enabled (web `defaultPageSize ?? 25`). */
    const val PAGE_SIZE: Int = 25
}

/**
 * Semantic accent of the HTTP-method badge — the native analogue of the web ternary
 * `r.method === 'GET' ? 'info' : 'warning'`. Kept as a pure enum so the projection stays free of the
 * Compose `BadgeVariant` type; the composable maps each case onto its `BadgeVariant` at render time.
 */
enum class MethodAccent { Info, Warning }

/**
 * One Tesla Fleet API endpoint reference entry, in the exact web `TESLA_ENDPOINTS` shape: the HTTP
 * [method], the request [path], and the human-readable [desc]. These three fields are raw API
 * identifiers (not localized in the web source — they are rendered verbatim), so they are embedded as
 * literals here exactly as the web constant declares them.
 */
data class TeslaApiEndpoint(
    val method: String,
    val path: String,
    val desc: String,
)

/**
 * The static endpoint reference table — a verbatim port of the web `TESLA_ENDPOINTS` constant
 * (web/src/features/admin/components/devtools/constants.ts), in the same order. Compile-time data: it
 * needs no fetch, which is precisely why the surface has no loading / error / stale / offline state.
 */
object TeslaApiReference {
    /** The 11 reference endpoints, in web declaration order. */
    val endpoints: List<TeslaApiEndpoint> =
        listOf(
            TeslaApiEndpoint("GET", "/api/1/vehicles", "List vehicles"),
            TeslaApiEndpoint("GET", "/api/1/vehicles/{id}/vehicle_data", "Get vehicle data"),
            TeslaApiEndpoint("POST", "/api/1/vehicles/{id}/command/wake_up", "Wake up vehicle"),
            TeslaApiEndpoint("POST", "/api/1/vehicles/{id}/command/door_lock", "Lock doors"),
            TeslaApiEndpoint("POST", "/api/1/vehicles/{id}/command/door_unlock", "Unlock doors"),
            TeslaApiEndpoint("POST", "/api/1/vehicles/{id}/command/flash_lights", "Flash lights"),
            TeslaApiEndpoint("POST", "/api/1/vehicles/{id}/command/honk_horn", "Honk horn"),
            TeslaApiEndpoint("POST", "/api/1/vehicles/{id}/command/set_charge_limit", "Set charge limit"),
            TeslaApiEndpoint("POST", "/api/1/vehicles/{id}/command/charge_start", "Start charging"),
            TeslaApiEndpoint("POST", "/api/1/vehicles/{id}/command/charge_stop", "Stop charging"),
            TeslaApiEndpoint("GET", "/api/1/vehicles/{id}/nearby_charging_sites", "Nearby chargers"),
        )
}

/**
 * Maps an HTTP [method] to its badge [MethodAccent], reproducing the web ternary
 * `r.method === 'GET' ? 'info' : 'warning'`: `GET` reads informational, every other verb (the
 * state-changing `POST` commands) reads as a warning accent.
 */
fun accentForMethod(method: String): MethodAccent = if (method == "GET") MethodAccent.Info else MethodAccent.Warning

/**
 * Filters the endpoint table by the search [query], a faithful port of the web `useMemo`: a blank
 * query returns every endpoint; otherwise the query is lower-cased and matched as a substring against
 * each endpoint's method, path, and description (case-insensitive, OR across the three fields).
 */
fun filterEndpoints(
    endpoints: List<TeslaApiEndpoint>,
    query: String,
): List<TeslaApiEndpoint> {
    if (query.trim().isEmpty()) return endpoints
    val q = query.lowercase()
    return endpoints.filter { endpoint ->
        endpoint.method.lowercase().contains(q) ||
            endpoint.path.lowercase().contains(q) ||
            endpoint.desc.lowercase().contains(q)
    }
}

/**
 * One render-ready table row: the source [endpoint], its derived badge [accent], and the localized,
 * per-row [copyActionLabel] that names the row's copy button to TalkBack (e.g. "Copy /api/1/vehicles").
 * Pure data (no Compose types) so the projection is unit-tested without a UI host; the composable maps
 * [accent] onto a `BadgeVariant` and wires the copy button to the endpoint path.
 */
data class TeslaApiRow(
    val endpoint: TeslaApiEndpoint,
    val accent: MethodAccent,
    val copyActionLabel: String,
)

/**
 * Pure projection from the raw endpoint table + the current search query to the render-ready
 * [TeslaApiRow]s, in web filter order. The per-row [TeslaApiRow.copyActionLabel] folds the localized
 * copy verb with the endpoint path so each row's icon-only copy button has a distinct, descriptive
 * accessible name — a native a11y refinement over the web's identical "Copy" buttons.
 */
object TeslaApiRefProjection {
    /** The filtered, render-ready rows for [query], each carrying its badge accent + copy label. */
    fun rows(
        endpoints: List<TeslaApiEndpoint>,
        query: String,
        copyWord: String,
    ): List<TeslaApiRow> =
        filterEndpoints(endpoints, query).map { endpoint ->
            TeslaApiRow(
                endpoint = endpoint,
                accent = accentForMethod(endpoint.method),
                copyActionLabel = "$copyWord ${endpoint.path}",
            )
        }
}

/**
 * Pure pagination arithmetic — the native analogue of the web `DataTable` slice
 * `data.slice((page - 1) * pageSize, page * pageSize)`. Framework-free so it is JVM-unit-tested; the
 * composable owns only the `page` state and renders the shared `Pagination` control over these results.
 */
object TeslaApiRefPaging {
    /** The number of pages for [total] rows at [pageSize] (at least one, even when empty). */
    fun pageCount(
        total: Int,
        pageSize: Int,
    ): Int = if (total <= 0) 1 else (total + pageSize - 1) / pageSize

    /**
     * The [rows] visible on [page] (1-based) at [pageSize]. [page] is clamped into range so an
     * out-of-bounds page (e.g. after the filter shrinks the result set) never throws; an empty input
     * yields an empty page.
     */
    fun <T> page(
        rows: List<T>,
        page: Int,
        pageSize: Int,
    ): List<T> {
        if (rows.isEmpty()) return emptyList()
        val current = page.coerceIn(1, pageCount(rows.size, pageSize))
        val from = (current - 1) * pageSize
        return rows.subList(from, minOf(from + pageSize, rows.size))
    }
}

/**
 * The localized strings the surface folds in — the native counterpart of every web `t(...)` call plus
 * the strings the shared components need (the copy button's labels and the table's empty message). The
 * composable builds this from the i18n facade; tests pass a deterministic instance.
 */
data class TeslaApiRefStrings(
    val title: String,
    val description: String,
    val searchHint: String,
    val methodHeader: String,
    val pathHeader: String,
    val descHeader: String,
    val copyLabel: String,
    val copiedLabel: String,
    val emptyMessage: String,
)

/**
 * The generated-catalog resource names for the four web keys that are absent from the catalog today
 * (the `translation.`-prefixed key with spaces folded to underscores, matching the catalog generator's
 * convention, e.g. `Tesla Api Ref` → `translation_Tesla_Api_Ref`). The composable resolves each by name
 * so the proper localized value renders the moment the catalog defines it. `Method` / `Path` and the
 * shared-component keys are present in the catalog and are read via their compile-time `R.string` ids.
 */
object TeslaApiRefKeys {
    /** Catalog key for web `t('Tesla Api Ref')` (card title). */
    const val TITLE: String = "translation_Tesla_Api_Ref"

    /** Catalog key for web `t('Tesla Api Ref Desc')` (card description). */
    const val DESCRIPTION: String = "translation_Tesla_Api_Ref_Desc"

    /** Catalog key for web `t('Search Endpoints')` (search field hint). */
    const val SEARCH_HINT: String = "translation_Search_Endpoints"

    /** Catalog key for web `t('Endpoint Desc')` (description column header). */
    const val DESC_HEADER: String = "translation_Endpoint_Desc"
}

/**
 * Documented human-readable fallbacks for the four catalog keys absent today (see file header). Each
 * value equals exactly what the web renders right now: i18next returns the natural-language key string
 * itself when a key is missing and no inline default is passed, so reproducing that text is faithful
 * parity (not the raw-dotted-key gap the ReferenceLinksSection surface had to paper over). Documented
 * here, never silent.
 */
object TeslaApiRefDefaults {
    /** Fallback for `Tesla Api Ref` — the web-rendered title. */
    const val TITLE: String = "Tesla Api Ref"

    /** Fallback for `Tesla Api Ref Desc` — the web-rendered description. */
    const val DESCRIPTION: String = "Tesla Api Ref Desc"

    /** Fallback for `Search Endpoints` — the web-rendered search hint. */
    const val SEARCH_HINT: String = "Search Endpoints"

    /** Fallback for `Endpoint Desc` — the web-rendered description column header. */
    const val DESC_HEADER: String = "Endpoint Desc"
}

/**
 * Reproduces i18next's `t(key, default)` against the native i18n facade: returns the [lookup] result
 * for [resourceName] when it resolves to a non-blank string, otherwise the [fallback] default. [lookup]
 * is a thin seam over the Android string catalog in production (an optional by-name resource read) and
 * a map in tests, so the resolve-or-fallback decision stays pure and unit-tested.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback
