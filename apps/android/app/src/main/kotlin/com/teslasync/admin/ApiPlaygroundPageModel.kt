// Pure, framework-free metadata + domain model for the ApiPlaygroundPage admin surface — the native analogue of
// the cross-cutting concerns + spec-parsing the web page owns (web/src/features/admin/pages/ApiPlaygroundPage.tsx,
// the OpenAPI explorer + request builder mounted at /api-playground). No Compose, no Android framework, no HTTP
// lives here, so the route identity, the OpenAPI parser and the request projections are all exercised off-device and
// the composable stays a thin render layer.
//
// The web page fetches `/system/openapi` (YAML), parses it client-side with js-yaml + a hand-written `parseSpec`,
// and renders an endpoint sidebar + request builder. This model carries the native equivalents: the navigation
// identity ([ApiPlaygroundPageRegistration]) + the one PII-safe `view.opened` diagnostic, and the [OpenApiSpecParser]
// — a dependency-free, indentation-aware parser for the generated OpenAPI 3.x YAML that projects the document onto
// the shared [ParsedEndpoint] catalog the EndpointSidebar + RequestBuilder feature views already consume (A3, DRY).
// The parser owns no networking (ADR-002); a source fetches the bytes and hands them here.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory (com/teslasync/admin — the P3
// prompt's allowed-files path) cannot form the package the rest of the app's `io.teslasync.android.*` namespace uses,
// so the package intentionally diverges from the path — exactly as the sibling admin / power-user page surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located registration + recorder + parser.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.apiplayground

import io.teslasync.android.featureviews.endpointsidebar.EndpointBody
import io.teslasync.android.featureviews.endpointsidebar.EndpointParam
import io.teslasync.android.featureviews.endpointsidebar.HttpMethod
import io.teslasync.android.featureviews.endpointsidebar.ParamLocation
import io.teslasync.android.featureviews.endpointsidebar.ParsedEndpoint
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical metadata for the ApiPlaygroundPage surface. The web page is a top-level admin route, not a draggable
 * dashboard widget, so there is no web registry row to mirror — this object carries the cross-cutting concerns the
 * surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires (already a metadata-only destination at
 * Destinations.kt `page("apiPlayground", "/api-playground", NavGroup.Admin)`) and the diagnostics [SLUG] emitted with
 * the one-shot `view.opened` event (P1/S11). [OPENAPI_PATH] is the spec endpoint the source fetches (the client adds
 * the `/api/v1` prefix, so it is given prefix-less, matching the web `request('/system/openapi')`).
 */
object ApiPlaygroundPageRegistration {
    /** The navigation destination id (Destinations.kt `page("apiPlayground", "/api-playground", NavGroup.Admin)`). */
    const val ROUTE_ID: String = "apiPlayground"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/api-playground"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ApiPlaygroundPage"

    /** The OpenAPI spec endpoint the source reads (prefix-less; the client prepends `/api/v1`). */
    const val OPENAPI_PATH: String = "/system/openapi"
}

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no endpoint data. */
internal fun recordApiPlaygroundPageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to ApiPlaygroundPageRegistration.SLUG))
}

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"

/**
 * A dependency-free parser for the generated OpenAPI 3.x YAML the backend serves at `/system/openapi`. It is the
 * native port of the web page's `js-yaml` load + `parseSpec`/`parseParameter`/`parseRequestBody` pipeline: it walks
 * the document's `paths` tree, resolves `$ref` parameters against `components/parameters`, and projects each
 * operation onto a [ParsedEndpoint] — the exact catalog shape the EndpointSidebar + RequestBuilder feature views
 * already consume (DRY). The generated spec is machine-emitted with stable two-space indentation, so an
 * indentation-aware line walk parses it without pulling in a YAML dependency for this single read-only document
 * (mirroring the backend handler note: "Frontend parses with js-yaml to avoid adding a Go YAML dependency").
 *
 * The parse is tolerant: unrecognised or malformed lines are skipped rather than throwing, so a spec the backend
 * extends with new fields still yields every operation it could resolve (the surface then renders content; an empty
 * result renders the data-empty state). It performs no networking (ADR-002).
 */
object OpenApiSpecParser {
    private val HTTP_METHODS: Set<String> = setOf("get", "post", "put", "delete", "patch")

    // Web `methodWeight` — the secondary sort key after tag, before path.
    private val METHOD_WEIGHT: Map<HttpMethod, Int> =
        mapOf(
            HttpMethod.Get to 0,
            HttpMethod.Post to 1,
            HttpMethod.Put to 2,
            HttpMethod.Patch to 3,
            HttpMethod.Delete to 4,
        )

    private const val PATHS_INDENT = 2
    private const val METHOD_INDENT = 4
    private const val OP_FIELD_INDENT = 6
    private const val PARAM_ITEM_INDENT = 8
    private const val PARAM_FIELD_INDENT = 10
    private const val COMPONENT_PARAM_INDENT = 4
    private const val COMPONENT_FIELD_INDENT = 6
    private const val OTHER_TAG = "Other"

    /**
     * Parses the [yaml] document into the sorted [ParsedEndpoint] catalog (web `parseSpec`). The result is sorted by
     * tag, then HTTP-verb weight, then path — the exact ordering the web `endpoints.sort(...)` produces — so the
     * sidebar's tag groups and rows match the web page. A document with no `paths` (or one that fails to parse) yields
     * an empty list, which the surface renders as its data-empty state.
     */
    fun parse(yaml: String): List<ParsedEndpoint> {
        val lines = yaml.split("\n")
        val componentParams = parseComponentParameters(lines)
        val endpoints = mutableListOf<ParsedEndpoint>()

        val pathsStart = lines.indexOfFirst { it.trimEnd() == "paths:" }
        if (pathsStart < 0) return emptyList()

        var i = pathsStart + 1
        var currentPath: String? = null
        while (i < lines.size) {
            val line = lines[i]
            if (isSkippable(line)) {
                i++
                continue
            }
            val indent = leadingSpaces(line)
            if (indent == 0) break // left the paths section (e.g. `components:`).

            val stripped = line.trim()
            if (indent == PATHS_INDENT && stripped.endsWith(":") && stripped.startsWith("/")) {
                currentPath = stripped.dropLast(1)
                i++
                continue
            }
            val path = currentPath
            if (indent == METHOD_INDENT && path != null && stripped.endsWith(":")) {
                val verb = stripped.dropLast(1).lowercase()
                if (verb in HTTP_METHODS) {
                    val method = HttpMethod.fromWire(verb)
                    val (operation, next) = parseOperation(lines, i + 1, componentParams)
                    if (method != null) {
                        endpoints += operation.toEndpoint(method, path)
                    }
                    i = next
                    continue
                }
            }
            i++
        }

        return endpoints.sortedWith(
            compareBy({ it.tag.lowercase() }, { METHOD_WEIGHT[it.method] ?: Int.MAX_VALUE }, { it.path }),
        )
    }

    /** Mutable accumulator for one operation block while it is being walked. */
    private class OperationDraft {
        var operationId: String = ""
        var summary: String = ""
        var description: String = ""
        var tag: String = OTHER_TAG
        var parameters: List<EndpointParam> = emptyList()
        var requestBody: EndpointBody? = null

        fun toEndpoint(
            method: HttpMethod,
            path: String,
        ): ParsedEndpoint =
            ParsedEndpoint(
                method = method,
                path = path,
                tag = tag.ifBlank { OTHER_TAG },
                summary = summary,
                description = description,
                operationId = operationId,
                parameters = parameters,
                requestBody = requestBody,
            )
    }

    /** Walks one operation block (indent >= 6) from [start]; returns the draft + the index of the next line. */
    private fun parseOperation(
        lines: List<String>,
        start: Int,
        componentParams: Map<String, EndpointParam>,
    ): Pair<OperationDraft, Int> {
        val draft = OperationDraft()
        var i = start
        while (i < lines.size) {
            val line = lines[i]
            if (isSkippable(line)) {
                i++
                continue
            }
            val indent = leadingSpaces(line)
            if (indent <= METHOD_INDENT) break

            val stripped = line.trim()
            if (indent == OP_FIELD_INDENT) {
                when {
                    stripped.startsWith("operationId:") -> draft.operationId = valueOf(stripped, "operationId:")
                    stripped.startsWith("summary:") -> draft.summary = valueOf(stripped, "summary:")
                    stripped.startsWith("description:") -> draft.description = valueOf(stripped, "description:")
                    stripped.startsWith("tags:") -> draft.tag = inlineTagOf(valueOf(stripped, "tags:")) ?: draft.tag
                    stripped == "parameters:" -> {
                        val (params, next) = parseParameters(lines, i + 1, componentParams)
                        draft.parameters = params
                        i = next
                        continue
                    }
                    stripped == "requestBody:" -> {
                        val (body, next) = parseRequestBody(lines, i + 1)
                        draft.requestBody = body
                        i = next
                        continue
                    }
                }
                i++
            } else {
                // A block-list tag item (`tags:` then `- Tag` at indent 8) is the only deeper line we read here.
                if (indent == PARAM_ITEM_INDENT && draft.tag == OTHER_TAG && stripped.startsWith("- ")) {
                    val value = stripped.removePrefix("- ").trim()
                    if (value.isNotEmpty() && !value.contains(":") && !value.startsWith("$")) {
                        draft.tag = value
                    }
                }
                i++
            }
        }
        return draft to i
    }

    /** Walks a `parameters:` block (list items at indent 8); resolves `$ref` items against [componentParams]. */
    private fun parseParameters(
        lines: List<String>,
        start: Int,
        componentParams: Map<String, EndpointParam>,
    ): Pair<List<EndpointParam>, Int> {
        val params = mutableListOf<EndpointParam>()
        var current: ParamDraft? = null
        var i = start
        while (i < lines.size) {
            val line = lines[i]
            if (isSkippable(line)) {
                i++
                continue
            }
            val indent = leadingSpaces(line)
            if (indent <= OP_FIELD_INDENT) break

            val stripped = line.trim()
            if (indent == PARAM_ITEM_INDENT && stripped.startsWith("- ")) {
                val inner = stripped.removePrefix("- ").trim()
                if (inner.startsWith("\$ref:")) {
                    val refName = refTargetOf(valueOf(inner, "\$ref:"))
                    componentParams[refName]?.let { params += it }
                    current = null
                } else {
                    val draft = ParamDraft()
                    current = draft
                    if (inner.startsWith("name:")) draft.name = valueOf(inner, "name:")
                    // The list slot is inserted on the `- name:` line, then rebuilt as later sub-fields are absorbed.
                    params += draft.build()
                }
            } else if (current != null && indent >= PARAM_FIELD_INDENT) {
                current.absorb(stripped)
                params[params.lastIndex] = current.build()
            }
            i++
        }
        return params.toList() to i
    }

    /** Walks a `requestBody:` block; detects the declared content type (web `parseRequestBody`). */
    private fun parseRequestBody(
        lines: List<String>,
        start: Int,
    ): Pair<EndpointBody?, Int> {
        var contentType: String? = null
        var i = start
        while (i < lines.size) {
            val line = lines[i]
            if (isSkippable(line)) {
                i++
                continue
            }
            val indent = leadingSpaces(line)
            if (indent <= OP_FIELD_INDENT) break

            val stripped = line.trim()
            if (contentType == null && stripped.endsWith(":") && indent >= PARAM_FIELD_INDENT) {
                val candidate = stripped.dropLast(1).trim()
                if (candidate.contains("/")) contentType = candidate
            }
            i++
        }
        return contentType?.let { EndpointBody(contentType = it) } to i
    }

    /** Parses `components/parameters` into a name -> [EndpointParam] map for `$ref` resolution (web `resolveRef`). */
    private fun parseComponentParameters(lines: List<String>): Map<String, EndpointParam> {
        val out = LinkedHashMap<String, EndpointParam>()
        val componentsStart = lines.indexOfFirst { it.trimEnd() == "components:" }
        if (componentsStart < 0) return out

        var i = componentsStart + 1
        var parametersStart = -1
        while (i < lines.size) {
            val line = lines[i]
            if (!isSkippable(line)) {
                val indent = leadingSpaces(line)
                if (indent == 0) return out
                if (indent == PATHS_INDENT && line.trim() == "parameters:") {
                    parametersStart = i
                    break
                }
            }
            i++
        }
        if (parametersStart < 0) return out

        i = parametersStart + 1
        var currentName: String? = null
        var draft: ParamDraft? = null
        while (i < lines.size) {
            val line = lines[i]
            if (isSkippable(line)) {
                i++
                continue
            }
            val indent = leadingSpaces(line)
            if (indent <= PATHS_INDENT) break

            val stripped = line.trim()
            if (indent == COMPONENT_PARAM_INDENT && stripped.endsWith(":")) {
                currentName?.let { name -> draft?.let { out[name] = it.build() } }
                currentName = stripped.dropLast(1)
                draft = ParamDraft()
            } else if (draft != null && indent >= COMPONENT_FIELD_INDENT) {
                draft.absorb(stripped)
            }
            i++
        }
        currentName?.let { name -> draft?.let { out[name] = it.build() } }
        return out
    }

    /** Mutable accumulator for one parameter while its sub-fields are being walked. */
    private class ParamDraft {
        var name: String = ""
        var location: String = "query"
        var required: Boolean = false
        var type: String = "string"
        var description: String = ""
        var default: String? = null

        fun absorb(stripped: String) {
            when {
                stripped.startsWith("name:") -> name = valueOf(stripped, "name:")
                stripped.startsWith("in:") -> location = valueOf(stripped, "in:")
                stripped.startsWith("required:") -> required = stripped.contains("true")
                stripped.startsWith("description:") -> description = valueOf(stripped, "description:")
                stripped.startsWith("type:") -> type = valueOf(stripped, "type:")
                stripped.startsWith("default:") -> default = valueOf(stripped, "default:")
            }
        }

        fun build(): EndpointParam =
            EndpointParam(
                name = name,
                location = ParamLocation.fromWire(location),
                required = required,
                type = type,
                description = description,
                default = default,
            )
    }

    private fun isSkippable(line: String): Boolean {
        val trimmed = line.trim()
        return trimmed.isEmpty() || trimmed.startsWith("#")
    }

    private fun leadingSpaces(line: String): Int = line.indexOfFirst { it != ' ' }.let { if (it < 0) line.length else it }

    // The scalar to the right of a `key:` token, unquoted — the web `String(resolved.x ?? '')`.
    private fun valueOf(
        stripped: String,
        key: String,
    ): String = stripped.removePrefix(key).trim().trim('"', '\'')

    // The inline-array first tag (`tags: [Auth]` -> `Auth`); a non-array value yields null (block list handled later).
    private fun inlineTagOf(raw: String): String? {
        if (!raw.startsWith("[")) return null
        val inner = raw.trim('[', ']')
        val first = inner.split(",").firstOrNull()?.trim()?.trim('"', '\'').orEmpty()
        return first.ifEmpty { null }
    }

    // The last path segment of a `$ref` target (`#/components/parameters/vehicleID` -> `vehicleID`).
    private fun refTargetOf(ref: String): String = ref.substringAfterLast('/')
}
