// Pure, framework-free model for the JSON Formatter feature view — the native analogue of everything the
// web component derives via `useMemo` before returning JSX
// (web/src/features/admin/components/devtools/tools/JsonFormatter.tsx). No Compose, no Android, no HTTP:
// every type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web tool binds NO data hook — its only hook is `useTranslation`. It holds a local input string and
// reduces it, exactly as this file's [JsonFormatterModel.format] does, to one of three outcomes that the
// web `useMemo` returns: a blank input (`!inputVal.trim()` → both fields empty), a successfully parsed +
// 2-space-pretty-printed document (`JSON.stringify(parsed, null, 2)`), or a parse error message
// (`e instanceof Error ? e.message : t('Invalid Json')`). Because there is no remote data source, there is
// no loading / stale / offline lifecycle to model here — inventing one would be drift, exactly as the
// sibling ToolCard surface documents.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/JsonFormatter — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling ToolCard / AlertDetailTimeline surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.jsonformatter

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object JsonFormatterRegistration {
    /** Stable surface id. */
    const val ID: String = "json-formatter"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "JsonFormatter"
}

/**
 * The exact i18n keys + literal the web component passes to `t(...)` / renders verbatim. Kept beside the
 * model so a unit test pins them against the web source and the resolver echoes the right text.
 *
 * [TITLE], [DESCRIPTION], [INPUT_LABEL] and [INVALID] are absent from the shared P1/S10 catalog (web
 * `en.json` carries only `Formatted`), so the web renders the key text itself (i18next key-as-fallback);
 * the render boundary reproduces that by echoing the literal when no resource exists, the same approach the
 * sibling ClientUtilitiesCatalog takes. [INPUT_EXAMPLE] is the literal example JSON the web shows inside the
 * empty input (`{"key":"value"}`) — never translated.
 */
object JsonFormatterKeys {
    const val TITLE: String = "Json Formatter"
    const val DESCRIPTION: String = "Json Formatter Desc"
    const val INPUT_LABEL: String = "Json Input"
    const val INVALID: String = "Invalid Json"
    const val INPUT_EXAMPLE: String = "{\"key\":\"value\"}"
}

/**
 * The localized strings the composable renders — resolved once at the render boundary (present keys from
 * the P1/S10 resource catalog, absent keys echoed verbatim) and handed to the stateless content as a
 * framework-free bundle so the view stays a thin render layer and the strings stay assertable.
 */
data class JsonFormatterStrings(
    val title: String,
    val description: String,
    val inputLabel: String,
    val inputExample: String,
    val invalidFallback: String,
    val formattedLabel: String,
    val copyLabel: String,
    val copiedLabel: String,
)

/**
 * The reduced outcome of the input — the native analogue of the web `useMemo` return
 * (`{ formatted, error }`). The three cases are mutually exclusive, mirroring the web's three branches.
 */
sealed interface JsonFormatResult {
    /** Blank / whitespace-only input (web `if (!inputVal.trim())`): nothing is shown below the field. */
    data object Empty : JsonFormatResult

    /** A valid document, pretty-printed with a 2-space indent (web `JSON.stringify(parsed, null, 2)`). */
    data class Formatted(
        val text: String,
    ) : JsonFormatResult

    /** A parse failure carrying the parser's message (web `e.message`), or the localized fallback. */
    data class Invalid(
        val message: String,
    ) : JsonFormatResult
}

/**
 * Pure, side-effect-free reducer — the native port of the web `useMemo` block. Reproduces all three
 * branches in order:
 *  1. blank input → [JsonFormatResult.Empty] (web `if (!inputVal.trim()) return { formatted: '', error: '' }`);
 *  2. parseable input → [JsonFormatResult.Formatted] with a 2-space indent (web `JSON.stringify(_, null, 2)`),
 *     key order preserved (kotlinx [JsonElement] keeps insertion order, like `JSON.parse`);
 *  3. malformed input → [JsonFormatResult.Invalid] with the parser's message, or [invalidFallback] when the
 *     parser yields no message (web `e instanceof Error ? e.message : t('Invalid Json')`).
 *
 * @param input the raw textarea value (web `inputVal`).
 * @param invalidFallback the already-localized `Invalid Json` text, used only when the parser message is blank.
 */
object JsonFormatterModel {
    private const val PRETTY_INDENT: String = "  "

    // RFC 8259 number grammar — rejects unquoted tokens kotlinx's tolerant element parser accepts but
    // `JSON.parse` rejects (bare words, leading zeros, NaN/Infinity).
    private val jsonNumberPattern = Regex("""^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$""")

    private val prettyJson: Json =
        Json {
            prettyPrint = true
            prettyPrintIndent = PRETTY_INDENT
        }

    fun format(
        input: String,
        invalidFallback: String,
    ): JsonFormatResult {
        if (input.isBlank()) return JsonFormatResult.Empty
        return try {
            val element = Json.parseToJsonElement(input)
            if (element.isStrictJson()) {
                JsonFormatResult.Formatted(prettyJson.encodeToString(JsonElement.serializer(), element))
            } else {
                JsonFormatResult.Invalid(invalidFallback)
            }
        } catch (error: SerializationException) {
            JsonFormatResult.Invalid(error.message?.takeIf(String::isNotBlank) ?: invalidFallback)
        }
    }

    /**
     * Tightens kotlinx's tolerant element parser to `JSON.parse` semantics: every leaf must be a quoted
     * string, `true`, `false`, `null`, or a grammar-valid number. kotlinx accepts a bare token such as
     * `oops` as a non-string primitive; `JSON.parse` rejects it, so any tree carrying one is invalid here.
     */
    private fun JsonElement.isStrictJson(): Boolean =
        when (this) {
            is JsonNull -> true
            is JsonObject -> values.all { it.isStrictJson() }
            is JsonArray -> all { it.isStrictJson() }
            is JsonPrimitive ->
                isString || content == "true" || content == "false" || jsonNumberPattern.matches(content)
        }
}
