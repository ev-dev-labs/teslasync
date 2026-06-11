// Pure, framework-free model + projection for the URL Encoder feature view — the native analogue of
// everything the web component derives via `useMemo` before returning JSX
// (web/src/features/admin/components/devtools/tools/UrlEncoder.tsx). No Compose, no Android, no HTTP:
// every type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer.
//
// The web tool is a self-contained client-side utility. Its only data hook is `useTranslation`; it holds a
// mode (`encode` | `decode`) and a typed string in `useState`, and a `useMemo` returns the transformed value
// (`encodeURIComponent` / `decodeURIComponent`), the empty string for blank input (which hides the output
// box), or the localized "Invalid Input" message when a decode throws. This file owns exactly that
// derivation: a faithful port of the two ECMAScript transforms plus the mode/blank/throw branching the
// `useMemo` performs.
//
// Parity note on the transforms: JavaScript `encodeURIComponent` / `decodeURIComponent` are NOT the same as
// Java's `URLEncoder` / `URLDecoder`. `URLEncoder` form-encodes a space as `+` and escapes `! ~ * ' ( )`,
// while `encodeURIComponent` emits `%20` for a space and leaves those marks unescaped; `URLDecoder` turns a
// literal `+` into a space, while `decodeURIComponent` keeps the `+`. So both directions are implemented here
// by hand to the ECMAScript contract — the unreserved set `A-Za-z0-9-_.!~*'()`, UTF-8 percent-octets in
// upper-case hex, and a strict decoder that yields `null` exactly where the web throws a `URIError`
// (a truncated or non-hex escape, or octets that are not valid UTF-8).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/UrlEncoder — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling ColorConverter / ByteSizeConverter surfaces
// do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.urlencoder

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object UrlEncoderRegistration {
    /** Stable surface id. */
    const val ID: String = "url-encoder"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "UrlEncoder"
}

/**
 * The transform direction — the native analogue of the web `useState<'encode' | 'decode'>`. The composable
 * binds a toggle to this; [UrlEncoderProjection.project] switches on it just like the web `useMemo`.
 */
enum class UrlEncoderMode { Encode, Decode }

/**
 * Mode-specific example inputs — the literal sample strings the web field shows for each mode
 * (`hello world&foo=bar` for encode, its encoded form for decode). These are illustrative text, not
 * user-facing prose, so they are not localized (the web does not route them through `t()` either).
 */
object UrlEncoderExamples {
    /** Example shown in encode mode (web encode example). */
    const val ENCODE: String = "hello world&foo=bar"

    /** Example shown in decode mode — the encode example after `encodeURIComponent`. */
    const val DECODE: String = "hello%20world%26foo%3Dbar"
}

/**
 * The three mutually-exclusive top-level surfaces the composable renders. The tool has no network feed, so a
 * host normally supplies [Ready]; [Loading] and [Error] are the lifecycle chrome the shared feature-view
 * contract (P1/S8) can still carry — reproduced for full state coverage, never faked from a fetch the tool
 * does not perform.
 */
enum class UrlEncoderSurfaceState { Loading, Error, Ready }

/**
 * Classifies the host lifecycle flags into the top-level [UrlEncoderSurfaceState] — the pure mirror of the
 * composable's `when` (loading first, then hard error, otherwise the ready tool). Kept framework-free so each
 * branch is asserted off-device.
 */
fun urlEncoderSurfaceFor(
    isLoading: Boolean,
    isError: Boolean,
): UrlEncoderSurfaceState =
    when {
        isLoading -> UrlEncoderSurfaceState.Loading
        isError -> UrlEncoderSurfaceState.Error
        else -> UrlEncoderSurfaceState.Ready
    }

/**
 * The render-ready result of transforming the typed input — the native analogue of the web `useMemo`'s output
 * string, modeled as three explicit cases so each renders its own surface (never a blank box):
 *
 * - [Empty] — blank input. Web returns `''`, which hides the output box; the composable shows a friendly hint.
 * - [Value] — a successful encode (always) or decode. Web shows it in the output box; [text] is the copyable
 *   result placed on the clipboard.
 * - [Invalid] — a decode that threw a `URIError`. Web returns the localized "Invalid Input" message; the
 *   composable renders that same localized message as a friendly inline surface (a malformed input yields no
 *   meaningful value to copy).
 */
sealed interface UrlEncoderOutput {
    /** Blank input — nothing to transform yet. */
    data object Empty : UrlEncoderOutput

    /** A successful transform whose [text] is the value shown and copied. */
    data class Value(
        val text: String,
    ) : UrlEncoderOutput

    /** A decode that could not be performed (the web `URIError` branch). */
    data object Invalid : UrlEncoderOutput
}

/**
 * The pure projection the composable renders — the native mirror of the web tool's `useMemo` block plus the
 * two ECMAScript transforms it calls. Stateless and side-effect-free so it is fully covered by the off-device
 * unit gate.
 */
object UrlEncoderProjection {
    /** The `encodeURIComponent` unreserved set — kept verbatim; every other character is percent-encoded. */
    private const val UNRESERVED: String =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"

    /** Upper-case hex alphabet for percent-octets (web emits upper-case, e.g. `%C3%A9`). */
    private const val HEX_DIGITS: String = "0123456789ABCDEF"

    private const val PERCENT: Char = '%'
    private const val ASCII_LIMIT: Int = 0x80
    private const val BYTE_MASK: Int = 0xFF
    private const val LOW_NIBBLE_MASK: Int = 0x0F
    private const val NIBBLE: Int = 4
    private const val HEX_LETTER_OFFSET: Int = 10

    /** Hex digits consumed after a `%` (the two characters of one percent-octet). */
    private const val ESCAPE_DIGITS: Int = 2

    /**
     * Faithful `encodeURIComponent`: characters in the unreserved set pass through unchanged; every other
     * code point is emitted as its UTF-8 octets, each as `%` + two upper-case hex digits. Supplementary code
     * points (surrogate pairs) are encoded as their full four-octet UTF-8 form.
     */
    fun encode(input: String): String {
        val out = StringBuilder(input.length)
        var index = 0
        while (index < input.length) {
            val codePoint = input.codePointAt(index)
            val charCount = Character.charCount(codePoint)
            if (codePoint < ASCII_LIMIT && UNRESERVED.indexOf(codePoint.toChar()) >= 0) {
                out.append(codePoint.toChar())
            } else {
                appendPercentOctets(out, input.substring(index, index + charCount))
            }
            index += charCount
        }
        return out.toString()
    }

    /**
     * Faithful `decodeURIComponent`: returns the decoded string, or `null` exactly where the web throws a
     * `URIError` — a `%` not followed by two hex digits, or a percent-octet run that is not valid UTF-8.
     * Non-`%` characters (including a literal `+`) are preserved as-is. The strict-decode work is delegated to
     * [decodeStrict], whose thrown errors are folded to `null` here so the public contract stays total.
     */
    fun decodeOrNull(input: String): String? = runCatching { decodeStrict(input) }.getOrNull()

    /**
     * The web `useMemo` analogue: blank input projects to [UrlEncoderOutput.Empty] (web `if (!inputVal)
     * return ''`); otherwise an encode always yields a [UrlEncoderOutput.Value], and a decode yields a
     * [UrlEncoderOutput.Value] on success or [UrlEncoderOutput.Invalid] when [decodeOrNull] reports a
     * malformed input (the web try/catch returning the "Invalid Input" message). Blankness is tested with
     * `isEmpty`, not `isBlank`, so an all-spaces input still encodes (`%20…`), matching JS truthiness.
     */
    fun project(
        mode: UrlEncoderMode,
        input: String,
    ): UrlEncoderOutput {
        if (input.isEmpty()) return UrlEncoderOutput.Empty
        return when (mode) {
            UrlEncoderMode.Encode -> UrlEncoderOutput.Value(encode(input))
            UrlEncoderMode.Decode ->
                decodeOrNull(input)?.let { UrlEncoderOutput.Value(it) } ?: UrlEncoderOutput.Invalid
        }
    }

    /**
     * Folds an output [label] and [value] into a single TalkBack content description ("<label>: <value>") so
     * the result reads as one node while its copy affordance stays a separate, independently-labeled control.
     */
    fun outputContentDescription(
        label: String,
        value: String,
    ): String = "$label: $value"

    /** Emits the UTF-8 octets of [segment] as `%HH` triples into [out]. */
    private fun appendPercentOctets(
        out: StringBuilder,
        segment: String,
    ) {
        for (octet in segment.toByteArray(Charsets.UTF_8)) {
            val value = octet.toInt() and BYTE_MASK
            out.append(PERCENT)
            out.append(HEX_DIGITS[value ushr NIBBLE])
            out.append(HEX_DIGITS[value and LOW_NIBBLE_MASK])
        }
    }

    /**
     * Strict `decodeURIComponent` core. Maximal runs of consecutive `%HH` escapes are gathered into one octet
     * buffer and decoded as UTF-8 together (so multi-octet characters survive), while non-`%` characters are
     * copied verbatim. Throws when a `%` lacks two trailing hex digits ([require]) or when [decodeUtf8] finds
     * invalid UTF-8 — both folded to `null` by [decodeOrNull], mirroring the web `URIError`.
     */
    private fun decodeStrict(input: String): String {
        val out = StringBuilder(input.length)
        var index = 0
        while (index < input.length) {
            if (input[index] == PERCENT) {
                val octets = ArrayList<Byte>()
                while (index < input.length && input[index] == PERCENT) {
                    require(index + ESCAPE_DIGITS < input.length) { "truncated percent-escape" }
                    val high = hexValue(input[index + 1])
                    val low = hexValue(input[index + 2])
                    require(high != null && low != null) { "non-hex digit in percent-escape" }
                    octets.add(((high shl NIBBLE) or low).toByte())
                    index += 1 + ESCAPE_DIGITS
                }
                out.append(decodeUtf8(octets.toByteArray()))
            } else {
                out.append(input[index])
                index += 1
            }
        }
        return out.toString()
    }

    /** Decodes [octets] as UTF-8, throwing `CharacterCodingException` on any malformed/unmappable sequence. */
    private fun decodeUtf8(octets: ByteArray): String =
        Charsets.UTF_8
            .newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(octets))
            .toString()

    /** The numeric value 0–15 of a single hex digit (either case), or `null` for any other character. */
    private fun hexValue(c: Char): Int? =
        when (c) {
            in '0'..'9' -> c - '0'
            in 'a'..'f' -> c - 'a' + HEX_LETTER_OFFSET
            in 'A'..'F' -> c - 'A' + HEX_LETTER_OFFSET
            else -> null
        }
}

/**
 * The web `t(key, default)` fallback strings. The web calls `t('Url Encoder')`, `t('Url Encoder Desc')`,
 * `t('Input Label')`, `t('Output Label')`, and `t('Invalid Input')`, whose keys exist in no i18n catalog (and
 * must not be added to the generated, drift-checked catalog — ADR-014), so i18next renders the key text
 * itself; these defaults reproduce that exactly. [EMPTY_HINT] is the friendly "no input yet" microcopy the
 * always-visible empty state shows where the web hides the output box.
 */
object UrlEncoderDefaults {
    /** Web `t('Url Encoder')` → "Url Encoder" (no catalog entry, so i18next returns the key). */
    const val TITLE: String = "Url Encoder"

    /** Web `t('Url Encoder Desc')` → "Url Encoder Desc" (no catalog entry, so i18next returns the key). */
    const val DESCRIPTION: String = "Url Encoder Desc"

    /** Web `t('Input Label')` → "Input Label" (no catalog entry, so i18next returns the key). */
    const val INPUT_LABEL: String = "Input Label"

    /** Web `t('Output Label')` → "Output Label" (no catalog entry, so i18next returns the key). */
    const val OUTPUT_LABEL: String = "Output Label"

    /** Web `t('Invalid Input')` → "Invalid Input" (no catalog entry, so i18next returns the key). */
    const val INVALID_INPUT: String = "Invalid Input"

    /** Native-only empty hint (no input entered) — the always-visible counterpart to the web hidden box. */
    const val EMPTY_HINT: String = "Enter text to encode or decode"
}

/** Resource name for the web `Url Encoder` title key (by-name; absent ⇒ [UrlEncoderDefaults.TITLE]). */
const val KEY_TITLE: String = "translation_Url_Encoder"

/** Resource name for the web `Url Encoder Desc` key (by-name; absent ⇒ [UrlEncoderDefaults.DESCRIPTION]). */
const val KEY_DESCRIPTION: String = "translation_Url_Encoder_Desc"

/** Resource name for the web `Input Label` key (by-name; absent ⇒ [UrlEncoderDefaults.INPUT_LABEL]). */
const val KEY_INPUT_LABEL: String = "translation_Input_Label"

/** Resource name for the web `Output Label` key (by-name; absent ⇒ [UrlEncoderDefaults.OUTPUT_LABEL]). */
const val KEY_OUTPUT_LABEL: String = "translation_Output_Label"

/** Resource name for the web `Invalid Input` key (by-name; absent ⇒ [UrlEncoderDefaults.INVALID_INPUT]). */
const val KEY_INVALID_INPUT: String = "translation_Invalid_Input"

/** Resource name for the native empty hint (by-name; absent ⇒ [UrlEncoderDefaults.EMPTY_HINT]). */
const val KEY_EMPTY_HINT: String = "translation_urlEncoder_enterText"

/**
 * Reproduces i18next's `t(key, default)` against the native i18n facade: returns the [lookup] result for
 * [resourceName] when it resolves to a non-blank string, otherwise the [fallback] default. [lookup] is a thin
 * seam over the Android string catalog in production (an optional by-name resource read) and a map in tests,
 * so the resolve-or-fallback decision stays pure and unit-tested.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback

/**
 * Localized microcopy folded into the surface — the web `t('Url Encoder')`, `t('Url Encoder Desc')`,
 * `t('Encode')`, `t('Decode')`, `t('Input Label')`, `t('Output Label')`, and `t('Invalid Input')` strings,
 * plus the shared `Copy`/`Copied` clipboard labels and the always-visible empty hint. The composable builds
 * this from the i18n facade; tests pass a deterministic instance.
 */
data class UrlEncoderStrings(
    val title: String,
    val description: String,
    val encodeLabel: String,
    val decodeLabel: String,
    val inputLabel: String,
    val outputLabel: String,
    val invalidMessage: String,
    val emptyHint: String,
    val copyLabel: String,
    val copiedLabel: String,
)
