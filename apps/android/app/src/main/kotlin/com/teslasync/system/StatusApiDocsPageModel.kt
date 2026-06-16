// Pure, framework-free model + projections for the StatusApiDocsPage system surface — the native analogue of
// everything the web page carries before composing its panels (web/src/features/system/pages/StatusApiDocsPage.tsx,
// the public /api/v1/status contract docs mounted at /docs/status-api). No Compose, no Android framework, no HTTP
// lives here: every declaration is plain Kotlin, so the static endpoint catalog and the empty/success projection are
// exercised off-device and the composable stays a thin render layer.
//
// The web page reads NO API; it renders a hardcoded list of <Endpoint> cards from inline props. This port mirrors
// that exactly: the catalog is a static, ordered list of [StatusEndpoint] carrying only the protocol tokens the web
// passes as props — the HTTP [method], the [path], the optional [query] spec, and the pretty-printed [exampleJson]
// response. Those are protocol identifiers (not localizable copy, exactly as the web hardcodes them), so they live
// here as data; the human-readable description for each endpoint is resolved at the render boundary from the
// platform string catalog (ADR-014), keyed by the stable [StatusEndpointId].
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory (com/teslasync/system — the
// P3 prompt's allowed-files path) cannot form the package the rest of the app's `io.teslasync.android.*` namespace
// uses, so the package intentionally diverges from the path — exactly as the sibling system page surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located registration + recorder + model types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.system.statusapidocs

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical metadata for the StatusApiDocsPage surface. The web page is a top-level system route that renders only
 * its static catalog, so this object carries just the cross-cutting concerns the surface owes: the navigation
 * [ROUTE_ID] / [WEB_PATH] the host wires (already a metadata-only destination at Destinations.kt
 * `page("statusApiDocs", "/docs/status-api", NavGroup.System)`) and the diagnostics [SLUG] emitted with the
 * one-shot `view.opened` event (P1/S11). There is no feed metadata because the page reads no data of its own.
 */
object StatusApiDocsPageRegistration {
    /** The navigation destination id (Destinations.kt `page("statusApiDocs", "/docs/status-api", NavGroup.System)`). */
    const val ROUTE_ID: String = "statusApiDocs"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/docs/status-api"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "StatusApiDocsPage"
}

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no page content. */
internal fun recordStatusApiDocsPageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to StatusApiDocsPageRegistration.SLUG))
}

/** The HTTP method an endpoint is documented under — the web `<Endpoint method>` prop (only GET is documented). */
enum class StatusHttpMethod { Get }

/**
 * A stable identity for one documented endpoint — the web `<Endpoint>` row. It carries no localized copy; the render
 * boundary maps each id to its description string, keeping this model free of Android resources and Compose types so
 * it is unit-testable off-device. Declared in the web's exact card order.
 */
enum class StatusEndpointId {
    Overall,
    Components,
    Resources,
    Uptime,
    Incidents,
    Live,
}

/**
 * One documented endpoint: a stable [id], its HTTP [method], the [path] it is mounted at, an optional [query] spec
 * string (web `query` prop, rendered as `?{query}`), and the pretty-printed [exampleJson] response shown in the
 * disclosure. Every field except [id] is a protocol token carried verbatim from the web props (not localized copy).
 */
data class StatusEndpoint(
    val id: StatusEndpointId,
    val method: StatusHttpMethod,
    val path: String,
    val query: String?,
    val exampleJson: String,
)

/** The `/api/v1/status` overall-snapshot example response (web `<Endpoint>` `example`, JSON.stringify-formatted). */
private val OVERALL_EXAMPLE: String =
    """
    {
      "status": "operational",
      "generated_at": "2025-01-15T14:32:11Z",
      "version": {
        "build": "1.4.2",
        "go_version": "go1.22.5",
        "started_at": "2025-01-10T08:00:00Z"
      },
      "counts": {
        "components_total": 8,
        "components_healthy": 8,
        "components_degraded": 0,
        "components_unhealthy": 0
      },
      "resources": {
        "goroutines": 142,
        "uptime_seconds": 458321.4,
        "go_version": "go1.22.5"
      },
      "incidents": []
    }
    """.trimIndent()

/** The `/api/v1/status/components` per-component example response. */
private val COMPONENTS_EXAMPLE: String =
    """
    {
      "generated_at": "2025-01-15T14:32:11Z",
      "counts": {
        "components_total": 3,
        "components_healthy": 3,
        "components_degraded": 0,
        "components_unhealthy": 0
      },
      "components": [
        { "name": "database", "status": "healthy", "consecutive_failures": 0, "last_check_at": "2025-01-15T14:32:08Z" },
        { "name": "mqtt", "status": "healthy", "consecutive_failures": 0, "last_check_at": "2025-01-15T14:32:08Z" },
        { "name": "tesla", "status": "healthy", "consecutive_failures": 0, "last_check_at": "2025-01-15T14:32:08Z" }
      ]
    }
    """.trimIndent()

/** The `/api/v1/status/resources` runtime-resources example response. */
private val RESOURCES_EXAMPLE: String =
    """
    {
      "generated_at": "2025-01-15T14:32:11Z",
      "resources": {
        "goroutines": 142,
        "uptime_seconds": 458321.4,
        "go_version": "go1.22.5"
      }
    }
    """.trimIndent()

/** The `/api/v1/status/uptime` windowed-uptime example response. */
private val UPTIME_EXAMPLE: String =
    """
    {
      "window": "30d",
      "uptime_percent": 100,
      "healthy_count": 8,
      "total_count": 8,
      "generated_at": "2025-01-15T14:32:11Z",
      "historical_source": "current_snapshot",
      "note": "Per-window uptime requires the heartbeat history backend (planned). This value reflects the current snapshot only."
    }
    """.trimIndent()

/** The `/api/v1/status/incidents` active-incidents example response. */
private val INCIDENTS_EXAMPLE: String =
    """
    {
      "count": 1,
      "incidents": [
        {
          "id": 17,
          "title": "MQTT broker reconnect storm",
          "status": "monitoring",
          "severity": "minor",
          "source": "manual",
          "affected_components": ["mqtt"],
          "started_at": "2025-01-15T13:55:00Z",
          "updated_at": "2025-01-15T14:20:00Z",
          "updates": [
            { "at": "2025-01-15T13:55:00Z", "status": "investigating", "message": "Incident opened.", "author": "operator" },
            { "at": "2025-01-15T14:10:00Z", "status": "identified", "message": "Cause: TLS cert rotation gap.", "author": "operator" },
            { "at": "2025-01-15T14:20:00Z", "status": "monitoring", "message": "Cert rotated; watching.", "author": "operator" }
          ]
        }
      ]
    }
    """.trimIndent()

/**
 * The `/api/v1/status/live` SSE example response. The web `note` string escapes its newlines (`\\n`), so the
 * pretty-printed value shows the literal `\n` frame separators of an SSE event — reproduced verbatim here.
 */
private val LIVE_EXAMPLE: String =
    """
    {
      "note": "event: status\ndata: <full StatusSnapshot JSON>\n\n"
    }
    """.trimIndent()

/**
 * The static endpoint catalog, in the web's exact card order
 * (web/src/features/system/pages/StatusApiDocsPage.tsx). The page reads no API, so this fixed list is the single
 * source of truth — mirrored verbatim from the web `<Endpoint>` props.
 */
val statusApiDocsCatalog: List<StatusEndpoint> =
    listOf(
        StatusEndpoint(
            id = StatusEndpointId.Overall,
            method = StatusHttpMethod.Get,
            path = "/api/v1/status",
            query = null,
            exampleJson = OVERALL_EXAMPLE,
        ),
        StatusEndpoint(
            id = StatusEndpointId.Components,
            method = StatusHttpMethod.Get,
            path = "/api/v1/status/components",
            query = null,
            exampleJson = COMPONENTS_EXAMPLE,
        ),
        StatusEndpoint(
            id = StatusEndpointId.Resources,
            method = StatusHttpMethod.Get,
            path = "/api/v1/status/resources",
            query = null,
            exampleJson = RESOURCES_EXAMPLE,
        ),
        StatusEndpoint(
            id = StatusEndpointId.Uptime,
            method = StatusHttpMethod.Get,
            path = "/api/v1/status/uptime",
            query = "window=24h | 7d | 30d | 90d | 1y",
            exampleJson = UPTIME_EXAMPLE,
        ),
        StatusEndpoint(
            id = StatusEndpointId.Incidents,
            method = StatusHttpMethod.Get,
            path = "/api/v1/status/incidents",
            query = "active=1 | limit=N",
            exampleJson = INCIDENTS_EXAMPLE,
        ),
        StatusEndpoint(
            id = StatusEndpointId.Live,
            method = StatusHttpMethod.Get,
            path = "/api/v1/status/live",
            query = null,
            exampleJson = LIVE_EXAMPLE,
        ),
    )

/**
 * The immutable success surface the ViewModel exposes and the page renders. [endpoints] drives the per-endpoint
 * card sections (GlassPanel2). The overview panel (GlassPanel1) and footer (GlassPanel3) are static chrome rendered
 * unconditionally on success. The page is [isEmpty] only when the catalog yields no endpoint card at all — the
 * empty-state seam the parity gate requires (the static catalog never actually reaches it).
 */
data class StatusApiDocsSnapshot(
    val endpoints: List<StatusEndpoint>,
) {
    /** True when there is no endpoint card to show — the empty-data surface. */
    val isEmpty: Boolean get() = endpoints.isEmpty()

    /** Total documented endpoints (web `endpoints.length`). */
    val total: Int get() = endpoints.size
}

/**
 * Derive the [StatusApiDocsSnapshot] from a [catalog] — the native analogue of the web page rendering its static
 * `<Endpoint>` list. Pure, so the projection contract is unit-tested without Android.
 */
fun buildStatusApiDocsSnapshot(catalog: List<StatusEndpoint> = statusApiDocsCatalog): StatusApiDocsSnapshot =
    StatusApiDocsSnapshot(endpoints = catalog)

/**
 * Wrap a derived [snapshot] in a terminal cache-then-network [Resource.Success] so the page renders through the
 * same lifecycle-aware [io.teslasync.android.data.UiState] surface every parity page uses (loading -> empty ->
 * success), even though the catalog is static and never errors. [fetchedAt] stamps the synthetic load. Pure.
 */
fun statusApiDocsSnapshotResource(
    snapshot: StatusApiDocsSnapshot,
    fetchedAt: Long,
): Resource<StatusApiDocsSnapshot> = Resource.Success(data = snapshot, fetchedAt = fetchedAt, stale = false)
