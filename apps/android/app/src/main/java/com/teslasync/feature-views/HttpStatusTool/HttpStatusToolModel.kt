// Pure, framework-free model for the HttpStatusTool feature view — the native analogue of the
// derivations the web component performs (web/src/features/admin/components/devtools/tools/HttpStatusTool.tsx
// plus its constants.ts `HTTP_CODES`). No Compose, no Android, no HTTP: every type here is unit-tested
// off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web component is a static client-side reference: a `useState` search box over a `useMemo` filter of
// the fixed `HTTP_CODES` array, drawn in a sortable + paginated `DataTable`. It binds NO data hook (only
// `useTranslation`), so — exactly as the sibling ClientUtilitiesSection surface does — the static catalog
// is modelled as a shared-layer feed (see HttpStatusToolSource) so the loading / empty / error / stale /
// offline envelope stays uniform and testable. This file owns the catalog, the status-class → badge
// classification (web `code < 300 ? success : code < 400 ? info : code < 500 ? warning : danger`), the
// search filter (web `filtered` memo) and the code-column sort (web `DataTable` sortable column).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/HttpStatusTool — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package; the package intentionally diverges from the path — exactly as every sibling feature-view
// surface does. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.httpstatus

import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object HttpStatusToolRegistration {
    /** Stable surface id. */
    const val ID: String = "http-status-tool"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "HttpStatusTool"
}

/** The web `DataTable` column keys. Only [CODE] is sortable (web `sortable: true` on the code column). */
object HttpStatusColumns {
    const val CODE: String = "code"
    const val TEXT: String = "text"
    const val DESC: String = "desc"
}

/**
 * The semantic class of an HTTP status code — the native analogue of the web Badge-variant ternary
 * (`code < 300 ? 'success' : code < 400 ? 'info' : code < 500 ? 'warning' : 'danger'`). Resolved to a
 * concrete [io.teslasync.android.components.ui.BadgeVariant] at the render boundary so the chip color
 * stays correct in every theme.
 */
enum class HttpStatusClass {
    Success,
    Info,
    Warning,
    Danger,
    ;

    companion object {
        private const val REDIRECT_MIN = 300
        private const val CLIENT_ERROR_MIN = 400
        private const val SERVER_ERROR_MIN = 500

        /** Classifies a numeric status code, reproducing the web Badge-variant ternary exactly. */
        fun forCode(code: Int): HttpStatusClass =
            when {
                code < REDIRECT_MIN -> Success
                code < CLIENT_ERROR_MIN -> Info
                code < SERVER_ERROR_MIN -> Warning
                else -> Danger
            }
    }
}

/**
 * One HTTP status reference row — the native port of a web `HTTP_CODES` entry (`{ code, text, desc }`).
 * [text]/[desc] are the canonical reason phrase + short description and are domain data (the web ships them
 * verbatim in constants.ts, not through i18n), so they are carried as-is rather than as i18n keys.
 */
data class HttpStatusCode(
    val code: Int,
    val text: String,
    val desc: String,
) {
    /** The semantic class driving the row's badge color (web Badge `variant`). */
    val statusClass: HttpStatusClass get() = HttpStatusClass.forCode(code)
}

/**
 * The snapshot the state holder carries — the resolved-immediately catalog (web static `HTTP_CODES`). An
 * empty [codes] maps to the surface's data-empty state; the static catalog is never empty in production,
 * but the field keeps the loading / empty / error envelope honest and testable.
 */
data class HttpStatusSnapshot(
    val codes: List<HttpStatusCode>,
) {
    /** No catalog rows (web `HTTP_CODES.length === 0`) → the data-empty surface. */
    val isEmpty: Boolean get() = codes.isEmpty()

    companion object {
        /** The empty-catalog sentinel for the data-empty preview / test branch. */
        val EMPTY: HttpStatusSnapshot = HttpStatusSnapshot(emptyList())
    }
}

/**
 * The filtered rows the table renders — the web `filtered` array. [hasResults] is `false` when the search
 * query matched nothing (web `filtered.length === 0`) → the friendly empty state.
 */
data class HttpStatusDisplay(
    val codes: List<HttpStatusCode>,
) {
    /** At least one row matched the active query. */
    val hasResults: Boolean get() = codes.isNotEmpty()
}

/** Pure, side-effect-free search + sort projection — the web `filtered` memo and the code-column sort. */
object HttpStatusProjection {
    /**
     * The web `filtered` memo: a blank query returns the catalog unchanged (web `if (!search.trim()) return
     * HTTP_CODES`); otherwise it keeps rows whose code string, reason phrase OR description contains the
     * (un-trimmed, lower-cased) query — matching the web `String(c.code).includes(q) ||
     * c.text.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q)` exactly.
     */
    fun filter(
        codes: List<HttpStatusCode>,
        search: String,
    ): HttpStatusDisplay {
        if (search.trim().isEmpty()) return HttpStatusDisplay(codes)
        val q = search.lowercase()
        return HttpStatusDisplay(
            codes.filter { row ->
                row.code.toString().contains(q) ||
                    row.text.lowercase().contains(q) ||
                    row.desc.lowercase().contains(q)
            },
        )
    }

    /**
     * Applies the hoisted table [sort]. Only the `code` column is sortable (web `sortable: true` on the
     * code column alone); any other (or no) active sort key preserves the catalog's natural order.
     */
    fun sorted(
        codes: List<HttpStatusCode>,
        sort: SortState,
    ): List<HttpStatusCode> =
        if (sort.key != HttpStatusColumns.CODE) {
            codes
        } else {
            when (sort.direction) {
                SortDirection.Asc -> codes.sortedBy { it.code }
                SortDirection.Desc -> codes.sortedByDescending { it.code }
            }
        }
}

/**
 * The fixed HTTP status catalog — the native, order-preserving port of the web `HTTP_CODES` constant (19
 * rows, the common 2xx/3xx/4xx/5xx codes). The reason phrases + descriptions are the verbatim web strings
 * (domain data, not i18n).
 */
object HttpStatusCatalog {
    val codes: List<HttpStatusCode> =
        listOf(
            HttpStatusCode(200, "OK", "Request succeeded"),
            HttpStatusCode(201, "Created", "Resource created"),
            HttpStatusCode(204, "No Content", "Success with no body"),
            HttpStatusCode(301, "Moved Permanently", "Resource moved"),
            HttpStatusCode(302, "Found", "Temporary redirect"),
            HttpStatusCode(304, "Not Modified", "Use cached version"),
            HttpStatusCode(400, "Bad Request", "Invalid request"),
            HttpStatusCode(401, "Unauthorized", "Auth required"),
            HttpStatusCode(403, "Forbidden", "Access denied"),
            HttpStatusCode(404, "Not Found", "Resource not found"),
            HttpStatusCode(405, "Method Not Allowed", "HTTP method not supported"),
            HttpStatusCode(408, "Request Timeout", "Client took too long"),
            HttpStatusCode(409, "Conflict", "Resource conflict"),
            HttpStatusCode(422, "Unprocessable Entity", "Validation failed"),
            HttpStatusCode(429, "Too Many Requests", "Rate limited"),
            HttpStatusCode(500, "Internal Server Error", "Server error"),
            HttpStatusCode(502, "Bad Gateway", "Upstream error"),
            HttpStatusCode(503, "Service Unavailable", "Server overloaded"),
            HttpStatusCode(504, "Gateway Timeout", "Upstream timeout"),
        )

    /** The default snapshot — the full catalog, always content (web `HTTP_CODES` is never empty). */
    val snapshot: HttpStatusSnapshot = HttpStatusSnapshot(codes)
}
