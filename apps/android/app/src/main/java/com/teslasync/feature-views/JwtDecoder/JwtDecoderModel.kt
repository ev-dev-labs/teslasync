// Pure, framework-free model for the JwtDecoder feature view — the native analogue of everything the
// web component derives before returning JSX
// (web/src/features/admin/components/devtools/tools/JwtDecoder.tsx). No Compose, no Android, no HTTP:
// every type here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web tool binds only `useTranslation` (i18n, not a data hook) plus a local `useState(jwt)` and a
// `useMemo` that decodes the token. It performs NO network I/O, so the cache-then-network lifecycle the
// data-bound surfaces carry (loading / stale / offline) does not exist here — modelling those would
// invent behaviour the source lacks (drift). The web `useMemo` produces exactly three outcomes, which
// this model makes first-class as [JwtDecodeResult]:
//   • blank input            → `{ header: null, payload: null }`            → [JwtDecodeResult.Idle]
//   • < 2 dot-segments / any
//     base64 or JSON failure → `{ header: null, payload: null, error }`     → [JwtDecodeResult.Invalid]
//   • both segments decode   → `{ header, payload }`                        → [JwtDecodeResult.Decoded]
//
// The web decodes with `atob` (standard-alphabet base64, lenient about missing padding) and
// `JSON.parse`. [JwtDecoderLogic.decode] reproduces that precisely: the standard [java.util.Base64]
// decoder (so base64url-only chars `-`/`_` fail exactly as `atob` throws on them), re-padded to a
// multiple of four (so unpadded JWT segments decode like `atob` tolerates), then parsed to a
// [JsonElement] (the canonical shape [ResultPanel] already consumes). Any failure folds to [Invalid],
// mirroring the web `try/catch`.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/JwtDecoder — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling ToolCard / ResultPanel
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.feature.views.jwtdecoder

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import java.util.Base64

/**
 * The outcome of decoding the JWT input — the native, exhaustive analogue of the web `useMemo`'s
 * `{ header, payload, error? }` object. Modelling the three branches as a sealed hierarchy makes every
 * state the composable must render explicit and off-device testable.
 */
sealed interface JwtDecodeResult {
    /** Blank / whitespace-only input — web `if (!jwt.trim()) return { header: null, payload: null }`. */
    data object Idle : JwtDecodeResult

    /**
     * Fewer than two dot-segments, or a segment that fails base64/JSON decoding — web's
     * `parts.length < 2` guard and `catch` arm, both of which set `error: t('Invalid Jwt')`. The
     * localized message is resolved at the render boundary (this model stays framework-free).
     */
    data object Invalid : JwtDecodeResult

    /**
     * Both the header and payload segments decoded to valid JSON — web `{ header, payload }`.
     *
     * @property header the decoded first segment (web `JSON.parse(atob(parts[0]))`).
     * @property payload the decoded second segment (web `JSON.parse(atob(parts[1]))`).
     */
    data class Decoded(
        val header: JsonElement,
        val payload: JsonElement,
    ) : JwtDecodeResult
}

/**
 * Pure, side-effect-free decoder — the native port of the web `useMemo` body. The single entry point
 * [decode] takes the raw input string and returns the matching [JwtDecodeResult]; it never throws (all
 * failure paths fold to [JwtDecodeResult.Invalid], mirroring the web `try/catch`).
 */
object JwtDecoderLogic {
    private const val BASE64_BLOCK = 4

    // kotlinx Json is only used to validate + materialize the decoded segment as a JsonElement; any
    // parse failure surfaces through `runCatching` exactly like the web `JSON.parse` throwing into `catch`.
    private val json = Json

    /**
     * Decodes [raw] into the render-ready [JwtDecodeResult], reproducing the web `useMemo` step for step:
     * blank input is [JwtDecodeResult.Idle]; fewer than two `.`-segments or any base64/JSON failure is
     * [JwtDecodeResult.Invalid]; otherwise both segments are decoded into [JwtDecodeResult.Decoded].
     */
    fun decode(raw: String): JwtDecodeResult {
        if (raw.isBlank()) return JwtDecodeResult.Idle
        val parts = raw.split(".")
        // The second segment is absent when the token has fewer than two parts (web `parts.length < 2`),
        // so `payload` stays null and the result folds to Invalid — the same outcome as the web guard.
        val header = parts.getOrNull(0)?.let(::decodeSegment)
        val payload = parts.getOrNull(1)?.let(::decodeSegment)
        return if (header != null && payload != null) {
            JwtDecodeResult.Decoded(header = header, payload = payload)
        } else {
            JwtDecodeResult.Invalid
        }
    }

    /**
     * Decodes one base64 segment into a [JsonElement], or `null` when it is not valid base64 / JSON —
     * the native analogue of `JSON.parse(atob(segment))`. The segment is re-padded to a multiple of four
     * so unpadded JWT segments decode the way browser `atob` tolerates; the standard-alphabet decoder
     * rejects base64url-only characters (`-`/`_`) exactly as `atob` throws on them.
     */
    private fun decodeSegment(segment: String): JsonElement? =
        runCatching {
            val remainder = segment.length % BASE64_BLOCK
            val padded = if (remainder == 0) segment else segment + "=".repeat(BASE64_BLOCK - remainder)
            val decoded = Base64.getDecoder().decode(padded)
            json.parseToJsonElement(decoded.decodeToString())
        }.getOrNull()
}

/**
 * The web i18n keys this surface passes to `t(...)`, verbatim — the same key strings the web source
 * uses. None are present in the generated shared catalog (P1/S10) upstream, so the render boundary
 * resolves them via i18next's key-as-fallback (it echoes the key text), the identical treatment the
 * sibling ClientUtilities registry gives these very keys. Centralized here so no display string is an
 * unrouted literal and the i18n contract is pinned by [JwtDecoderModelTest].
 */
object JwtDecoderI18n {
    /** Web `t('Jwt Decoder')` — the ToolCard title. */
    const val TITLE: String = "Jwt Decoder"

    /** Web `t('Jwt Decoder Desc')` — the ToolCard description. */
    const val DESCRIPTION: String = "Jwt Decoder Desc"

    /** Web `t('Jwt Input')` — the textarea label. */
    const val INPUT_LABEL: String = "Jwt Input"

    /** Web `t('Invalid Jwt')` — the decode-failure message. */
    const val INVALID_ERROR: String = "Invalid Jwt"

    /** Web `t('Jwt Header')` — the decoded-header ResultPanel title. */
    const val HEADER_TITLE: String = "Jwt Header"

    /** Web `t('Jwt Payload')` — the decoded-payload ResultPanel title. */
    const val PAYLOAD_TITLE: String = "Jwt Payload"

    /**
     * The web textarea's empty-field example token — reproduced as the input's hint. It is a literal
     * example, NOT translated copy (the web source does not wrap it in `t(...)`), so it is kept verbatim.
     */
    const val INPUT_EXAMPLE_TOKEN: String = "eyJhbGciOiJSUzI1NiIs..."
}

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object JwtDecoderRegistration {
    /** Stable surface id. */
    const val ID: String = "jwt-decoder"

    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "JwtDecoder"
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface slug — never the
 * pasted token, the decoded header/payload, or any error text — so a diagnostics line can never leak the
 * inspected credential.
 */
object JwtDecoderDiagnostics {
    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to JwtDecoderRegistration.SLUG))
    }
}
