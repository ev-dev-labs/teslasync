// Pure, framework-free model + projection for the RequestBuilder feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/admin/components/RequestBuilder.tsx). No Compose, no Android, no HTTP: every type here
// is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin render
// layer.
//
// The web component is prop-driven (`endpoint: ParsedEndpoint`, `onSend`, `loading`) and binds no data hook
// of its own (only `useTranslation`). Its `endpoint`, however, originates from the parent
// (ApiPlaygroundPage) `/system/openapi` query, and the parent renders a friendly "select an endpoint" empty
// state until one is chosen — so the loading / empty / error / stale / offline envelope is REAL end-to-end,
// reproduced here uniformly with the sibling EndpointSidebar surface (which exports the data contract this
// file reuses). The `loading` prop (a send in flight) is a separate concern carried by the composable's
// `sending` flag, not part of this fetch envelope.
//
// This file reproduces the four derivations the web component owns: the per-endpoint default-param seed +
// request-body seed (web `useEffect`), the final URL builder (web `buildUrl`, path substitution + encoded
// query string), the destructive-method guard (web `isDestructive`), and the optional `X-API-Key` header
// build (web `handleSend`) — folded into the [RequestDraft] the host's `onSend` receives.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/RequestBuilder — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and PascalCase segments are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as every sibling feature-view surface does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.requestbuilder

import io.teslasync.android.featureviews.endpointsidebar.EndpointParam
import io.teslasync.android.featureviews.endpointsidebar.HttpMethod
import io.teslasync.android.featureviews.endpointsidebar.ParamLocation
import io.teslasync.android.featureviews.endpointsidebar.ParsedEndpoint
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object RequestBuilderRegistration {
    /** Stable surface id. */
    const val ID: String = "request-builder"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "RequestBuilder"
}

/**
 * The outgoing request the host's `onSend` receives — the native port of the web
 * `onSend(url, method, body?, headers)` call. [body] is `null` when the editor is empty (web
 * `body || undefined`), and [headers] carries the optional `X-API-Key` only when a key was entered.
 *
 * @property url the path + query string WITHOUT the `/api/v1` prefix (the client adds it), matching the web
 *   `onSend(buildUrl(), …)` argument.
 * @property method the upper-case HTTP verb (web `endpoint.method`).
 * @property body the request body, or `null` when empty.
 * @property headers the request headers (only `X-API-Key`, when supplied).
 */
data class RequestDraft(
    val url: String,
    val method: String,
    val body: String?,
    val headers: Map<String, String>,
)

/**
 * The snapshot the state holder carries — the resolved selected endpoint (web `endpoint` prop). A `null`
 * [endpoint] maps to the surface's data-empty state (the parent's "select an endpoint from the sidebar"
 * prompt, shown until a row is chosen); a non-null endpoint maps to the request-builder form.
 */
data class RequestBuilderSnapshot(
    val endpoint: ParsedEndpoint?,
) {
    /** No endpoint selected yet (web parent's `!selected` branch) → the data-empty surface. */
    val isEmpty: Boolean get() = endpoint == null

    companion object {
        /** The no-selection sentinel for the data-empty preview / test branch. */
        val EMPTY: RequestBuilderSnapshot = RequestBuilderSnapshot(null)
    }
}

/**
 * Pure, side-effect-free derivations — the native port of the web component's `useEffect` seed, `buildUrl`
 * memo, `isDestructive` flag and `handleSend` header/body fold. Drives both the composable and the
 * off-device unit tests.
 */
object RequestBuilderProjection {
    /** The header the optional API key is sent under — the web `headers['X-API-Key']`. */
    const val API_KEY_HEADER: String = "X-API-Key"

    /** The prefix the request client prepends to every path — the web `<code>/api/v1{buildUrl()}</code>`. */
    const val API_PREFIX: String = "/api/v1"

    // The seed for an endpoint that declares a request body but ships no example (web `'{\n  \n}'`).
    private const val EMPTY_BODY_TEMPLATE: String = "{\n  \n}"

    // The unreserved set `encodeURIComponent` leaves untouched (everything else is percent-encoded).
    private const val UNRESERVED: String =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"

    private const val HEX_RADIX: Int = 16
    private const val BYTE_MASK: Int = 0xFF

    // Web `JSON.stringify(example, null, 2)`: pretty-printed with a two-space indent.
    private val prettyJson =
        Json {
            prettyPrint = true
            prettyPrintIndent = "  "
        }

    /**
     * The web `useEffect` default-param seed: every parameter that declares a default is seeded with it
     * (web `if (p.default != null) defaults[p.name] = String(p.default)`); parameters with no default are
     * absent. First-encounter order is preserved.
     */
    fun seedParams(endpoint: ParsedEndpoint): Map<String, String> {
        val seeded = LinkedHashMap<String, String>()
        for (param in endpoint.parameters) {
            val default = param.default
            if (default != null) seeded[param.name] = default
        }
        return seeded
    }

    /**
     * The web `useEffect` body seed: the endpoint's example pretty-printed (web `JSON.stringify(example,
     * null, 2)`), or the `{\n  \n}` template when a body is declared with no example, or an empty string
     * when the endpoint takes no body. An example that does not parse as JSON is seeded verbatim.
     */
    fun seedBody(endpoint: ParsedEndpoint): String {
        val body = endpoint.requestBody ?: return ""
        return body.example?.let(::prettifyJson) ?: EMPTY_BODY_TEMPLATE
    }

    // Pretty-prints a raw JSON example with a two-space indent (web `JSON.stringify(example, null, 2)`);
    // an example that does not parse as JSON is returned verbatim.
    private fun prettifyJson(example: String): String =
        runCatching {
            prettyJson.encodeToString(JsonElement.serializer(), Json.parseToJsonElement(example))
        }.getOrDefault(example)

    /** The path parameters, in declaration order (web `parameters.filter(p => p.in === 'path')`). */
    fun pathParams(endpoint: ParsedEndpoint): List<EndpointParam> = endpoint.parameters.filter { it.location == ParamLocation.Path }

    /** The query parameters, in declaration order (web `parameters.filter(p => p.in === 'query')`). */
    fun queryParams(endpoint: ParsedEndpoint): List<EndpointParam> = endpoint.parameters.filter { it.location == ParamLocation.Query }

    /**
     * The web `buildUrl` memo: substitutes each path parameter into the template (an empty value keeps the
     * unsubstituted `{name}` token, web `params[p.name] || \`{${p.name}}\``), then appends every non-empty query
     * parameter as `name=encoded(value)` joined with `&` (web `encodeURIComponent`). The `/api/v1` prefix is
     * NOT included here — it is the display/transport concern (see [displayUrl]).
     */
    fun buildUrl(
        endpoint: ParsedEndpoint,
        params: Map<String, String>,
    ): String {
        var url = endpoint.path
        for (param in pathParams(endpoint)) {
            val value = params[param.name]
            val replacement = if (value.isNullOrEmpty()) "{${param.name}}" else value
            url = url.replace("{${param.name}}", replacement)
        }
        val queryParts =
            queryParams(endpoint)
                .mapNotNull { param ->
                    val value = params[param.name]
                    if (value.isNullOrEmpty()) null else "${param.name}=${encodeQueryComponent(value)}"
                }
        return if (queryParts.isEmpty()) url else "$url?${queryParts.joinToString("&")}"
    }

    /** The full URL the surface renders, with the transport prefix (web `/api/v1{buildUrl()}`). */
    fun displayUrl(
        endpoint: ParsedEndpoint,
        params: Map<String, String>,
    ): String = "$API_PREFIX${buildUrl(endpoint, params)}"

    /** The web `isDestructive` flag: any verb other than GET requires confirmation before sending. */
    fun isDestructive(endpoint: ParsedEndpoint): Boolean = endpoint.method != HttpMethod.Get

    /**
     * The web `handleSend` header fold: a trimmed, non-empty API key becomes the `X-API-Key` header (web
     * `if (apiKey.trim()) headers['X-API-Key'] = apiKey.trim()`); a blank key sends no extra header.
     */
    fun buildHeaders(apiKey: String): Map<String, String> {
        val key = apiKey.trim()
        return if (key.isEmpty()) emptyMap() else mapOf(API_KEY_HEADER to key)
    }

    /**
     * Folds the current form inputs into the [RequestDraft] the host's `onSend` receives — the native port
     * of the web `onSend(buildUrl(), endpoint.method, body || undefined, headers)` call. An empty [body] is
     * sent as `null` (web `body || undefined`).
     */
    fun draft(
        endpoint: ParsedEndpoint,
        params: Map<String, String>,
        body: String,
        apiKey: String,
    ): RequestDraft =
        RequestDraft(
            url = buildUrl(endpoint, params),
            method = endpoint.method.wire,
            body = body.ifEmpty { null },
            headers = buildHeaders(apiKey),
        )

    /**
     * Percent-encodes [value] exactly as the web `encodeURIComponent` does: every byte of its UTF-8 encoding
     * is emitted verbatim when it falls in the [UNRESERVED] set, otherwise as an upper-case `%XX` escape.
     */
    fun encodeQueryComponent(value: String): String {
        val out = StringBuilder()
        for (byte in value.toByteArray(Charsets.UTF_8)) {
            val code = byte.toInt() and BYTE_MASK
            val char = code.toChar()
            if (char in UNRESERVED) {
                out.append(char)
            } else {
                out.append('%').append(code.toString(HEX_RADIX).uppercase().padStart(2, '0'))
            }
        }
        return out.toString()
    }
}
