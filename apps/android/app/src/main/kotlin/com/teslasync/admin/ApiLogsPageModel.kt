// Pure, framework-free model + projection for the ApiLogsPage admin surface — the native analogue of
// everything the web page derives before it returns JSX (web/src/features/admin/pages/ApiLogsPage.tsx, the
// API call-log inspector). No Compose, no Android framework, no HTTP lives here: every type is exercised
// off-device, keeping the composable a thin render layer.
//
// The two feeds arrive as the raw verbatim server JSON the shared S8 AdminStore already exposes
// (`GET /api-logs` ▸ apiLogs(page), `GET /api-logs/stats` ▸ apiLogStats()). So this file owns the parse +
// the client-side derivations the web component does inline: the per-log row mapping, the method / status /
// service badge tones, the curated service catalog + the derived Service-filter option list
// (web `deriveServiceOptions`), the active-filter predicate, and the pagination arithmetic. Values are plain
// counts / millis / a percentage the backend already computed — none are unit-bearing — so there is no SI
// conversion here; locale number formatting is applied at the render boundary.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/admin — the P3 prompt's allowed-files path) cannot form the package the rest of the app's
// `io.teslasync.android.*` namespace uses, so the package intentionally diverges from the path — exactly as
// the sibling feature-view surfaces do. `MatchingDeclarationName` is suppressed for the co-located types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.apilogs

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/** Em dash used as the universal "no value" marker, matching the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/**
 * Canonical metadata for this surface. The web page is a top-level admin route, not a draggable dashboard
 * widget, so there is no web registry row to mirror — this object carries the cross-cutting concerns the
 * surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires, the diagnostics [SLUG] emitted with
 * the one-shot `view.opened` event (P1/S11), and the fixed [PAGE_SIZE] the web uses (`limit = 25`).
 */
object ApiLogsPageRegistration {
    /** The navigation destination id (Destinations.kt `page("apiLogs", "/api-logs", …)`). */
    const val ROUTE_ID: String = "apiLogs"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/api-logs"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ApiLogsPage"

    /** Rows per page — the web `limit = 25`. */
    const val PAGE_SIZE: Int = 25
}

/** Semantic tone for a log badge, mapped to the design-system badge palette at the render boundary. */
enum class LogTone { Success, Info, Warning, Danger, Neutral }

/**
 * One API call-log row — the native mirror of the web `APICallLog`. Nullable wire fields stay nullable so
 * the render boundary applies the web `?? '—'` / `?? 'N/A'` fallbacks honestly rather than fabricating zero.
 */
data class ApiCallLog(
    val id: Long,
    val ts: String,
    val service: String,
    val httpMethod: String,
    val endpoint: String,
    val statusCode: Int?,
    val durationMs: Long,
    val errorMessage: String?,
    val requestBody: String?,
    val responseBody: String?,
) {
    internal companion object {
        fun from(obj: JsonObject?): ApiCallLog? {
            if (obj == null) return null
            return ApiCallLog(
                id = obj.long("id") ?: 0L,
                ts = obj.string("ts") ?: "",
                service = obj.string("service") ?: "",
                httpMethod = obj.string("http_method") ?: "",
                endpoint = obj.string("endpoint") ?: "",
                statusCode = obj.int("status_code"),
                durationMs = obj.long("duration_ms") ?: 0L,
                errorMessage = obj.string("error_message"),
                requestBody = obj.string("request_body"),
                responseBody = obj.string("response_body"),
            )
        }
    }
}

/**
 * The `/api-logs/stats` rollup — the native mirror of the web `APICallLogStats`. Every scalar is nullable so
 * the StatCards show the web em-dash before stats resolve, never a misleading zero. [byService] keeps its
 * server order so the chip row matches the web `Object.entries(stats.by_service)` iteration.
 */
data class ApiLogStats(
    val totalCalls: Long?,
    val errorRate: Double?,
    val errorCount: Long?,
    val avgDurationMs: Double?,
    val last24h: Long?,
    val byService: Map<String, Long>,
) {
    internal companion object {
        fun from(obj: JsonObject?): ApiLogStats? {
            if (obj == null) return null
            return ApiLogStats(
                totalCalls = obj.long("total_calls"),
                errorRate = obj.double("error_rate"),
                errorCount = obj.long("error_count"),
                avgDurationMs = obj.double("avg_duration_ms"),
                last24h = obj.long("last_24h"),
                byService = obj.longMap("by_service"),
            )
        }
    }
}

/**
 * The combined render-ready payload the surface binds to: the current page's [logs], the server [total]
 * (drives pagination + the "showing" range, unaffected by client-side filtering), and the best-effort
 * [stats] (folded in opportunistically, web `stats?.…`). [isEmpty] gates the native Empty phase — the server
 * returned no rows for this page.
 */
data class ApiLogsData(
    val logs: List<ApiCallLog>,
    val total: Int,
    val stats: ApiLogStats?,
) {
    val isEmpty: Boolean get() = logs.isEmpty()

    internal companion object {
        val EMPTY: ApiLogsData = ApiLogsData(emptyList(), 0, null)

        /** Parse the raw `/api-logs` envelope + `/api-logs/stats` element into the combined payload. */
        fun from(
            logsJson: JsonElement?,
            statsJson: JsonElement?,
        ): ApiLogsData {
            val envelope = logsJson as? JsonObject
            val rows = (envelope?.get("data") as? JsonArray).orEmpty()
            val logs = rows.mapNotNull { ApiCallLog.from(it as? JsonObject) }
            val total = envelope?.int("total") ?: logs.size
            return ApiLogsData(logs = logs, total = total, stats = ApiLogStats.from(statsJson as? JsonObject))
        }
    }
}

/** A Service-filter dropdown option — a stable [value] and its display [label] (web `ServiceSelectOption`). */
data class ServiceOption(
    val value: String,
    val label: String,
)

/**
 * The four active filters mirroring the web URL params (`method` / `status` / `endpoint` / `service`). An
 * empty string means "no filter" for that facet (the web `method || undefined` semantics). [hasAny] backs
 * the web `hasFilters` flag that reveals the Clear affordance + the "adjust your filters" empty hint.
 */
data class ApiLogsFilters(
    val method: String = "",
    val status: String = "",
    val endpoint: String = "",
    val service: String = "",
) {
    /** Whether any facet is active (web `!!(method || status || endpoint || service)`). */
    val hasAny: Boolean
        get() = method.isNotEmpty() || status.isNotEmpty() || endpoint.isNotEmpty() || service.isNotEmpty()
}

/** A curated service's display label + badge tone (web `SERVICE_CONFIG`). */
private data class ServiceConfig(
    val label: String,
    val tone: LogTone,
)

/**
 * Static catalog of services the backend can write (web `SERVICE_CONFIG`). Curated services are always
 * filterable even with zero rows so a fresh install / quiet service stays selectable.
 */
private val SERVICE_CONFIG: Map<String, ServiceConfig> =
    linkedMapOf(
        "teslasync-api" to ServiceConfig("TeslaSync API", LogTone.Info),
        "tesla-api" to ServiceConfig("Tesla API", LogTone.Info),
        "tesla-auth" to ServiceConfig("Tesla Auth", LogTone.Info),
        "geocoder-google" to ServiceConfig("Geocoder (Google)", LogTone.Warning),
        "geocoder-nominatim" to ServiceConfig("Geocoder (Nominatim)", LogTone.Warning),
        "geocoder-azure" to ServiceConfig("Geocoder (Azure)", LogTone.Warning),
        "geocoder-search" to ServiceConfig("Geocoder (Search)", LogTone.Warning),
        "github-releases" to ServiceConfig("GitHub Releases", LogTone.Neutral),
        "notify-generic" to ServiceConfig("Notifications", LogTone.Neutral),
        "system-dns-check" to ServiceConfig("DNS Health Check", LogTone.Neutral),
        "eia" to ServiceConfig("EIA", LogTone.Neutral),
    )

/** The keys of [SERVICE_CONFIG] — the static catalog size the `serviceCount` helper reports as "known". */
val KNOWN_SERVICES: List<String> = SERVICE_CONFIG.keys.toList()

/** HTTP-method badge tone (web `METHOD_VARIANTS`). */
fun methodTone(method: String): LogTone =
    when (method.uppercase()) {
        "GET" -> LogTone.Success
        "POST" -> LogTone.Info
        "PUT", "PATCH" -> LogTone.Warning
        "DELETE" -> LogTone.Danger
        else -> LogTone.Neutral
    }

/** Status-code badge tone (web `statusBadgeVariant`): 2xx success, 3xx info, 4xx warning, 5xx danger. */
fun statusTone(code: Int?): LogTone =
    when {
        code == null || code == 0 -> LogTone.Neutral
        code < 300 -> LogTone.Success
        code < 400 -> LogTone.Info
        code < 500 -> LogTone.Warning
        else -> LogTone.Danger
    }

/** A service's display label (web `serviceBadgeConfig().label`), falling back to the raw key. */
fun serviceLabel(service: String): String = SERVICE_CONFIG[service]?.label ?: service

/** A service's badge tone (web `serviceBadgeConfig().variant`), neutral when uncurated. */
fun serviceTone(service: String): LogTone = SERVICE_CONFIG[service]?.tone ?: LogTone.Neutral

/**
 * Builds the Service-filter option list (web `deriveServiceOptions`): the union of the static catalog, the
 * live `stats.by_service` keys, and the [activeService] (so the control always reflects its own value),
 * mapped to labels and sorted alphabetically (case-insensitive), with the pinned "All Services" head first.
 */
fun deriveServiceOptions(
    byService: Map<String, Long>?,
    activeService: String,
    allLabel: String,
): List<ServiceOption> {
    val values = LinkedHashSet<String>()
    values.addAll(KNOWN_SERVICES)
    byService?.keys?.let(values::addAll)
    if (activeService.isNotEmpty()) values.add(activeService)
    val tail =
        values
            .map { ServiceOption(it, serviceLabel(it)) }
            .sortedBy { it.label.lowercase() }
    return buildList {
        add(ServiceOption("", allLabel))
        addAll(tail)
    }
}

/**
 * The active client-side filter predicate — the native adaptation of the web's server-side query params
 * over the shared `AdminStore.apiLogs(page)` seam, which is page-only. Applied to the current page's rows:
 * method exact, status by `2xx`/`3xx`/`4xx`/`5xx` class, endpoint case-insensitive substring, service exact.
 */
fun filterLogs(
    logs: List<ApiCallLog>,
    filters: ApiLogsFilters,
): List<ApiCallLog> {
    if (!filters.hasAny) return logs
    val endpointNeedle = filters.endpoint.trim().lowercase()
    return logs.filter { log ->
        (filters.method.isEmpty() || log.httpMethod.equals(filters.method, ignoreCase = true)) &&
            (filters.status.isEmpty() || statusClass(log.statusCode) == filters.status) &&
            (endpointNeedle.isEmpty() || log.endpoint.lowercase().contains(endpointNeedle)) &&
            (filters.service.isEmpty() || log.service == filters.service)
    }
}

/** Maps a status code to its `2xx`/`3xx`/`4xx`/`5xx` filter class, or `""` when unknown. */
private fun statusClass(code: Int?): String =
    when {
        code == null || code < 100 -> ""
        code < 300 -> "2xx"
        code < 400 -> "3xx"
        code < 500 -> "4xx"
        code < 600 -> "5xx"
        else -> ""
    }

/** Total page count for [total] rows at [pageSize] (web `Math.ceil(total / limit)`), at least 1. */
fun totalPages(
    total: Int,
    pageSize: Int = ApiLogsPageRegistration.PAGE_SIZE,
): Int = if (total <= 0 || pageSize <= 0) 0 else (total + pageSize - 1) / pageSize

/**
 * The 1-based inclusive "showing X–Y of Z" window for [page] (0-based) — web
 * `from = page*limit+1`, `to = min((page+1)*limit, total)`. Returns `(0, 0)` when there is nothing to show.
 */
fun showingRange(
    page: Int,
    total: Int,
    pageSize: Int = ApiLogsPageRegistration.PAGE_SIZE,
): Pair<Int, Int> {
    if (total <= 0) return 0 to 0
    val from = page * pageSize + 1
    val to = minOf((page + 1) * pageSize, total)
    return from to to
}

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no log content. */
internal fun recordApiLogsPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to ApiLogsPageRegistration.SLUG))
}

private val exportJson = Json { prettyPrint = true }

/**
 * Serialize [logs] to the pretty-printed JSON the web Export-JSON action writes — the native equivalent of
 * the web `JSON.stringify(logs, null, 2)` Blob, surfaced on Android by copying it to the clipboard.
 */
fun encodeLogsJson(logs: List<ApiCallLog>): String {
    val array =
        buildJsonArray {
            logs.forEach { log ->
                addJsonObject {
                    put("id", log.id)
                    put("ts", log.ts)
                    put("service", log.service)
                    put("http_method", log.httpMethod)
                    put("endpoint", log.endpoint)
                    put("status_code", log.statusCode)
                    put("duration_ms", log.durationMs)
                    put("error_message", log.errorMessage)
                    put("request_body", log.requestBody)
                    put("response_body", log.responseBody)
                }
            }
        }
    return exportJson.encodeToString(JsonArray.serializer(), array)
}

// ── JSON helpers (tolerant readers over the raw AdminStore element) ─────────────────────────────────────────

private fun JsonObject.prim(key: String): JsonPrimitive? = this[key] as? JsonPrimitive

private fun JsonObject.string(key: String): String? = prim(key)?.contentOrNull

private fun JsonObject.int(key: String): Int? = prim(key)?.intOrNull

private fun JsonObject.long(key: String): Long? = prim(key)?.longOrNull

private fun JsonObject.double(key: String): Double? = prim(key)?.doubleOrNull

private fun JsonObject.longMap(key: String): Map<String, Long> {
    val obj = this[key] as? JsonObject ?: return emptyMap()
    val out = LinkedHashMap<String, Long>(obj.size)
    for ((k, v) in obj) {
        (v as? JsonPrimitive)?.longOrNull?.let { out[k] = it }
    }
    return out
}

private fun JsonArray?.orEmpty(): List<JsonElement> = this ?: emptyList()
