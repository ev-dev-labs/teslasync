// Pure, framework-free model + projections for the ResponseViewer feature view — the native analogue of
// every derivation the web component performs before returning JSX
// (web/src/features/admin/components/ResponseViewer.tsx). No Compose, no Android, no HTTP: every type here is
// unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// ResponseViewer is a purely presentational surface. Its only web hook is `useTranslation`; the request
// `response`, the `loading` flag, the `history`, and the `onReplay` callback are all props supplied by the
// parent API-playground page. Because it binds NO data hook, the cache-then-network states that the
// data-bound surfaces carry (error / stale / offline) do not exist here — exactly as the sibling ResultPanel
// surface documents. The genuine state set the web source defines is the three branches of the response
// panel: `loading` (skeleton), no-response (empty state), and a resolved response (status bar + body +
// headers). This file owns the byte-size formatter (web `formatBytes`), the status/method tone classifiers
// (web `statusColor`/`statusBg` and the history method-badge ternary), the rendered-body derivation (web
// `contentType.includes('json') && typeof body !== 'string' ? JSON.stringify(...) : bodyText`), the request
// history projection, and the four-language code-snippet generator (web `generateSnippet`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ResponseViewer — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as every sibling feature-view surface does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.responseviewer

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import java.util.Locale

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object ResponseViewerRegistration {
    /** Stable surface id. */
    const val ID: String = "response-viewer"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ResponseViewer"
}

/**
 * One HTTP response — the native port of the web `ApiResponse` interface. [body] is the parsed document
 * (web `unknown`, modelled here as the canonical [JsonElement] every other surface threads through) and
 * [bodyText] is the raw response text the web renders when the body is not pretty-printable JSON. [durationMs]
 * is the round-trip time in milliseconds (web `duration`) and [sizeBytes] the payload size in bytes (web
 * `size`); both are transport metrics, never unit-policed domain quantities.
 */
data class ApiResponse(
    val status: Int,
    val statusText: String,
    val headers: Map<String, String>,
    val body: JsonElement?,
    val bodyText: String,
    val durationMs: Long,
    val sizeBytes: Long,
    val contentType: String,
)

/** One recent-request entry — the native port of the web `HistoryEntry` interface. */
data class HistoryEntry(
    val method: String,
    val path: String,
    val status: Int,
    val durationMs: Long,
    val timestamp: String,
)

/**
 * The semantic tone of a status code — the native analogue of the web `statusColor`/`statusBg` ternary
 * (`status < 300 ? green : status < 400 ? amber : red`). Resolved to a concrete status color + container
 * wash at the render boundary so the tone stays correct in every theme.
 */
enum class ResponseStatusTone {
    Success,
    Redirect,
    Error,
    ;

    companion object {
        private const val REDIRECT_MIN: Int = 300
        private const val ERROR_MIN: Int = 400

        /** Classifies a numeric status code, reproducing the web `statusColor`/`statusBg` ternary exactly. */
        fun forStatus(status: Int): ResponseStatusTone =
            when {
                status < REDIRECT_MIN -> Success
                status < ERROR_MIN -> Redirect
                else -> Error
            }
    }
}

/**
 * The semantic tone of an HTTP method — the native analogue of the web history method-badge ternary
 * (`GET → green, POST → blue, DELETE → red, else amber`). Matched case-sensitively, exactly as the web `===`
 * comparisons are; resolved to a badge variant at the render boundary.
 */
enum class HttpMethodTone {
    Get,
    Post,
    Delete,
    Other,
    ;

    companion object {
        /** Classifies an HTTP method, reproducing the web method-badge ternary exactly. */
        fun forMethod(method: String): HttpMethodTone =
            when (method) {
                "GET" -> Get
                "POST" -> Post
                "DELETE" -> Delete
                else -> Other
            }
    }
}

/**
 * The four snippet languages the web `SnippetPanel` offers — the native port of the web `format` union plus
 * its `formats` array. [key] is the stable web value (`'curl' | 'javascript' | 'python' | 'go'`) and [label]
 * the human label shown on the selector tab (web `{ value, label }`).
 */
enum class SnippetFormat(
    val key: String,
    val label: String,
) {
    Curl("curl", "cURL"),
    JavaScript("javascript", "JavaScript"),
    Python("python", "Python"),
    Go("go", "Go"),
    ;

    companion object {
        /** Resolves a stored [key] back to a [SnippetFormat], defaulting to [Curl] (the web initial value). */
        fun fromKey(key: String): SnippetFormat = entries.firstOrNull { it.key == key } ?: Curl
    }
}

/** Which of the response panel's three render branches applies (web `loading ? … : !response ? … : …`). */
enum class ResponseViewerMode { Loading, Empty, Content }

/**
 * The fully projected, render-ready response — the native analogue of everything the web component computes
 * inside the `!loading && response` branch before returning JSX. Pure data (no Compose types) so it is
 * unit-tested without a UI host; the thin composable maps it straight onto shared primitives.
 *
 * @property statusLine the status bar's leading text (web `{status} {statusText}`), e.g. `200 OK`.
 * @property tone the status tone driving the status bar color + container wash (web `statusColor`/`statusBg`).
 * @property meta the status bar's trailing text (web `{duration}ms · {formatBytes(size)}`).
 * @property body the body the `<pre>` renders: the 2-space-pretty-printed JSON document when the response is
 *   JSON and the parsed body is not itself a string, otherwise the raw [ApiResponse.bodyText].
 * @property headers the response headers in insertion order (web `Object.entries(headers)`).
 */
data class ResponseContent(
    val statusLine: String,
    val tone: ResponseStatusTone,
    val meta: String,
    val body: String,
    val headers: List<Pair<String, String>>,
) {
    /** At least one header to show — the web `ResponseHeaders` returns `null` when there are none. */
    val hasHeaders: Boolean get() = headers.isNotEmpty()

    /** The header count shown beside the toggle label (web `({entries.length})`). */
    val headerCount: Int get() = headers.size
}

/**
 * The render-ready view for the response panel — the active [mode] plus the projected [content], which is
 * non-null only in the [ResponseViewerMode.Content] branch.
 */
data class ResponseViewerDisplay(
    val mode: ResponseViewerMode,
    val content: ResponseContent?,
)

/** One projected history chip — the render-ready analogue of a web `RequestHistory` button. */
data class HistoryRow(
    val method: String,
    val methodTone: HttpMethodTone,
    val path: String,
    val status: Int,
    val statusTone: ResponseStatusTone,
    val durationText: String,
    val accessibleLabel: String,
)

/**
 * Pure projection from raw inputs to the render-ready [ResponseViewerDisplay] — the native port of the web
 * component's `loading`/`response` branch selection and the per-field derivations inside the resolved branch.
 */
object ResponseViewerProjection {
    // Web `JSON.stringify(response.body, null, 2)`: pretty-printed with a two-space indent.
    private val prettyJson: Json =
        Json {
            prettyPrint = true
            prettyPrintIndent = "  "
        }

    private const val JSON_CONTENT_MARKER: String = "json"

    /**
     * Selects the active branch, mirroring the web render order exactly: `loading` wins first (web
     * `{loading && <Skeleton/>}`), then a missing response (web `{!loading && !response && <EmptyState/>}`),
     * then the resolved response (web `{!loading && response && …}`).
     */
    fun project(
        response: ApiResponse?,
        loading: Boolean,
    ): ResponseViewerDisplay =
        when {
            loading -> ResponseViewerDisplay(ResponseViewerMode.Loading, null)
            response == null -> ResponseViewerDisplay(ResponseViewerMode.Empty, null)
            else -> ResponseViewerDisplay(ResponseViewerMode.Content, contentOf(response))
        }

    private fun contentOf(response: ApiResponse): ResponseContent =
        ResponseContent(
            statusLine = "${response.status} ${response.statusText}",
            tone = ResponseStatusTone.forStatus(response.status),
            meta = "${response.durationMs}ms · ${formatBytes(response.sizeBytes)}",
            body = renderedBody(response),
            headers = response.headers.entries.map { it.key to it.value },
        )

    /**
     * The body text the `<pre>` renders — the native port of the web expression
     * `(contentType ?? '').includes('json') && typeof body !== 'string' ? JSON.stringify(body, null, 2)
     * : bodyText`. A JSON content type with a non-string, present parsed body is pretty-printed; a string
     * primitive body, a non-JSON content type, or an absent parsed body falls back to [ApiResponse.bodyText]
     * (the absent case maps the web `undefined` body — which `JSON.stringify` cannot render — onto the raw
     * text so the panel is never blank).
     */
    fun renderedBody(response: ApiResponse): String {
        val body = response.body
        val jsonContent = response.contentType.contains(JSON_CONTENT_MARKER)
        val isStringPrimitive = body is JsonPrimitive && body.isString
        return if (jsonContent && body != null && !isStringPrimitive) {
            prettyJson.encodeToString(JsonElement.serializer(), body)
        } else {
            response.bodyText
        }
    }
}

/** Pure projection for the request-history strip — the web `RequestHistory` derivations. */
object ResponseHistoryProjection {
    /** The web `{history.length === 0 ? null : …}` guard. */
    fun hasHistory(history: List<HistoryEntry>): Boolean = history.isNotEmpty()

    /**
     * Projects each entry into a render-ready [HistoryRow]: the method tone (web method-badge ternary), the
     * status tone (web `statusColor`), the duration label (web `{duration}ms`), and the chip's accessible
     * label — the native analogue of the web `title={`{method} {path} → {status} ({duration}ms)`}`.
     */
    fun rows(history: List<HistoryEntry>): List<HistoryRow> =
        history.map { entry ->
            HistoryRow(
                method = entry.method,
                methodTone = HttpMethodTone.forMethod(entry.method),
                path = entry.path,
                status = entry.status,
                statusTone = ResponseStatusTone.forStatus(entry.status),
                durationText = "${entry.durationMs}ms",
                accessibleLabel = "${entry.method} ${entry.path} → ${entry.status} (${entry.durationMs}ms)",
            )
        }
}

/**
 * The four-language code-snippet generator — a faithful native port of the web `generateSnippet`. Each
 * branch reproduces the web template byte-for-byte (including the auth-note comment, the GET-vs-body
 * conditionals, and the `body ?? '{}'` Go fallback) so a copied snippet matches the web tool exactly.
 */
object SnippetModel {
    private const val AUTH_NOTE_CURL: String = "# Add auth: -H \"X-API-Key: YOUR_KEY\" or use session cookies"
    private const val AUTH_NOTE_JS: String = "// Auth: include credentials or X-API-Key header"
    private const val AUTH_NOTE_PY: String = "# Auth: pass headers={\"X-API-Key\": \"YOUR_KEY\"}"
    private const val AUTH_NOTE_GO: String = "// Auth: add X-API-Key header to the request"
    private const val GET: String = "GET"
    private const val CONTINUATION: String = " \\\n"

    /** The selectable formats, in web order (`cURL`, `JavaScript`, `Python`, `Go`). */
    val formats: List<SnippetFormat> = SnippetFormat.entries.toList()

    /** Dispatches to the per-language generator — the web `switch (format)`. */
    fun generate(
        method: String,
        url: String,
        format: SnippetFormat,
        body: String?,
    ): String =
        when (format) {
            SnippetFormat.Curl -> curl(method, url, body)
            SnippetFormat.JavaScript -> javascript(method, url, body)
            SnippetFormat.Python -> python(method, url, body)
            SnippetFormat.Go -> go(method, url, body)
        }

    private fun hasBody(
        method: String,
        body: String?,
    ): Boolean = !body.isNullOrEmpty() && method != GET

    private fun curl(
        method: String,
        url: String,
        body: String?,
    ): String {
        val parts = mutableListOf("curl -X $method '$url'")
        if (hasBody(method, body)) {
            parts += "  -H 'Content-Type: application/json'"
            parts += "  -d '$body'"
        }
        return AUTH_NOTE_CURL + "\n" + parts.joinToString(CONTINUATION)
    }

    private fun javascript(
        method: String,
        url: String,
        body: String?,
    ): String {
        val lines = mutableListOf(AUTH_NOTE_JS, "const response = await fetch('$url', {", "  method: '$method',")
        if (hasBody(method, body)) {
            lines += "  headers: { 'Content-Type': 'application/json' },"
            lines += "  body: JSON.stringify($body),"
        }
        lines += "});"
        lines += "const data = await response.json();"
        return lines.joinToString("\n")
    }

    private fun python(
        method: String,
        url: String,
        body: String?,
    ): String {
        val suffix = if (hasBody(method, body)) ", json=$body" else ""
        val call = "response = requests.${method.lowercase()}('$url'$suffix)"
        return listOf(AUTH_NOTE_PY, "import requests", "", call, "data = response.json()").joinToString("\n")
    }

    private fun go(
        method: String,
        url: String,
        body: String?,
    ): String =
        if (method == GET) {
            listOf(
                AUTH_NOTE_GO,
                "resp, err := http.Get(\"$url\")",
                "if err != nil { log.Fatal(err) }",
                "defer resp.Body.Close()",
            ).joinToString("\n")
        } else {
            listOf(
                AUTH_NOTE_GO,
                "body := strings.NewReader(`${body ?: "{}"}`)",
                "req, _ := http.NewRequest(\"$method\", \"$url\", body)",
                "req.Header.Set(\"Content-Type\", \"application/json\")",
                "resp, err := http.DefaultClient.Do(req)",
                "if err != nil { log.Fatal(err) }",
                "defer resp.Body.Close()",
            ).joinToString("\n")
        }
}

/** Byte-size formatter — the native port of the web `formatBytes` (B → KB → MB, one decimal place). */
private const val BYTES_PER_KB: Long = 1024L
private const val BYTES_PER_MB: Long = 1024L * 1024L
private const val KB_DIVISOR: Double = 1024.0
private const val MB_DIVISOR: Double = 1024.0 * 1024.0

private fun oneDecimal(value: Double): String = String.format(Locale.US, "%.1f", value)

/** Formats [bytes] exactly as the web `formatBytes` does: `B` under 1 KiB, then `KB`, then `MB`. */
fun formatBytes(bytes: Long): String =
    when {
        bytes < BYTES_PER_KB -> "$bytes B"
        bytes < BYTES_PER_MB -> "${oneDecimal(bytes / KB_DIVISOR)} KB"
        else -> "${oneDecimal(bytes / MB_DIVISOR)} MB"
    }

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface slug — never a header
 * value, a body, a URL, or a status — so a diagnostics line can never leak the inspected request/response.
 */
object ResponseViewerDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = ResponseViewerRegistration.SLUG

    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
