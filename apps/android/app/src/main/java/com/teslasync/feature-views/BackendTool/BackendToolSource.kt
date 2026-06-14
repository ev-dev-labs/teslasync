// The data port the [BackendToolViewModel] binds to (P1/S8 state-holder seam) — the native analogue of
// the web component's `useMutation` over `apiFetch('/dev-tools/{endpoint}', method, bodyBuilder?.())`
// (web/src/features/admin/components/devtools/BackendTool.tsx + ./helpers.ts). The view never performs
// HTTP itself (ADR-002); a shared-data-layer transport (production) or a fixed-response fake
// (previews/tests) drives the port. There is intentionally no shared dev-tools repository in the KMP
// core, so this surface owns the abstraction (hexagonal port) and a host supplies the transport — keeping
// "no direct HTTP from the view" intact end to end, exactly as the sibling FleetApiSection does.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/BackendTool) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.backendtool

import kotlinx.serialization.json.JsonObject

/** The HTTP verb a [BackendToolRequest] uses — the native analogue of the web `method?: 'GET'|'POST'|'DELETE'` prop. */
enum class BackendToolMethod {
    Get,
    Post,
    Delete,
}

/**
 * The mutation request descriptor — the native analogue of the web component's `endpoint` / `method` /
 * `bodyBuilder` props. A host pairs it with a transport to build a [BackendToolPort]; the view itself
 * only ever calls [BackendToolPort.run], never touching the wire.
 *
 * @property endpoint the dev-tools endpoint segment (web `endpoint`, e.g. `fleet-api-info`).
 * @property method the HTTP verb (web `method`, defaulting to GET as the web prop does).
 * @property body the optional JSON request body (web `bodyBuilder?.()`), or `null` for no body.
 */
data class BackendToolRequest(
    val endpoint: String,
    val method: BackendToolMethod = BackendToolMethod.Get,
    val body: JsonObject? = null,
) {
    /** The full request path the production transport targets — web `request('/dev-tools/${endpoint}')`. */
    val path: String get() = DEV_TOOLS_PREFIX + endpoint

    companion object {
        /** The dev-tools route prefix every endpoint is nested under (web `apiFetch` `/dev-tools/`). */
        const val DEV_TOOLS_PREFIX: String = "/dev-tools/"
    }
}

/**
 * The single mutating operation the surface invokes — the native seam over the web
 * `apiFetch('/dev-tools/{endpoint}', method, body)` call. It is non-throwing (mirroring `apiFetch`'s
 * catch → `{ error }`): a transport/HTTP failure is returned as a [BackendToolResponse] whose
 * [BackendToolResponse.error] is set, so the result panel renders the failure branch rather than crashing
 * the view. A single-method functional interface so the view-model depends on an abstraction (real
 * transport ↔ fixed-response fake), never on the network.
 */
fun interface BackendToolPort {
    /** Run the configured request once and return its (non-throwing) response (web `mutation.mutate()`). */
    suspend fun run(): BackendToolResponse
}

/**
 * Binds a [request] descriptor to a host-supplied [transport] (the shared HTTP layer) — the production
 * wiring. The [transport] owns the actual `/dev-tools/{endpoint}` round-trip and is expected to fold any
 * failure into [BackendToolResponse.ofError] (the `apiFetch` catch contract), so the returned port never
 * throws.
 */
fun backendToolPort(
    request: BackendToolRequest,
    transport: suspend (BackendToolRequest) -> BackendToolResponse,
): BackendToolPort = BackendToolPort { transport(request) }

/**
 * A fixed-[response] port — the default for previews/tests (and a safe fallback). Each [BackendToolPort.run]
 * resolves to the same already-decoded [response], so every render branch (success / failure) is reachable
 * without a network.
 */
fun backendToolPort(response: BackendToolResponse): BackendToolPort = BackendToolPort { response }
