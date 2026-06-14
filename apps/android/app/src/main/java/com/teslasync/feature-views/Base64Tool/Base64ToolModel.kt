// Pure, framework-free model + projection for the Base64 feature view — the native analogue of everything
// the web component derives via `useMemo` before returning JSX
// (web/src/features/admin/components/devtools/tools/Base64Tool.tsx). No Compose, no Android, no HTTP: every
// type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin
// render layer.
//
// The web tool is a self-contained client-side utility. Its only data hook is `useTranslation`; it holds a
// mode (`encode` | `decode`) and a typed string in `useState`, and a `useMemo` returns the transformed value
// (`btoa` / `atob`), the empty string for blank input (which hides the output box), or the localized
// "Invalid Input" message when the transform throws. This file owns exactly that derivation: a faithful port
// of the two ECMAScript transforms plus the mode/blank/throw branching the `useMemo` performs.
//
// Parity note on the transforms: `btoa` / `atob` are NOT Java's `Base64.getEncoder()` / `getDecoder()`.
// `btoa` operates on a "binary string": it iterates UTF-16 code units, throws `InvalidCharacterError` the
// instant a unit exceeds 0xFF (so anything outside Latin-1 — `€`, emoji, lone surrogates — is rejected), and
// otherwise standard-Base64-encodes those bytes with `=` padding. `atob` runs the WHATWG "forgiving-base64
// decode": it first strips ASCII whitespace, rejects a length that is `1 (mod 4)`, removes one or two trailing
// `=` only when the length is `0 (mod 4)`, fails on any other non-alphabet code point, and yields a binary
// string whose bytes map 1:1 to Latin-1 code points. Java's basic decoder rejects whitespace and is strict
// about padding, so both directions are implemented here by hand to the ECMAScript / WHATWG contract.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/Base64Tool — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a PascalCase segment with digits adjoining a hyphenated parent is illegal in a package
// identifier), so the package intentionally diverges from the path — exactly as the sibling UrlEncoder /
// ColorConverter / ByteSizeConverter surfaces do. `MatchingDeclarationName` is suppressed for the co-located
// supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.base64tool

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object Base64ToolRegistration {
    /** Stable surface id. */
    const val ID: String = "base64-tool"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "Base64Tool"
}

/**
 * The transform direction — the native analogue of the web `useState<'encode' | 'decode'>`. The composable
 * binds a toggle to this; [Base64ToolProjection.project] switches on it just like the web `useMemo`.
 */
enum class Base64ToolMode { Encode, Decode }

/**
 * Mode-specific example inputs — the literal sample strings the web field shows for each mode (`Hello World`
 * for encode, its Base64 form for decode). These are illustrative text, not user-facing prose, so they are
 * not localized (the web does not route them through `t()` either).
 */
object Base64ToolExamples {
    /** Example shown in encode mode (the web field's encode sample text). */
    const val ENCODE: String = "Hello World"

    /** Example shown in decode mode — the encode example after `btoa`. */
    const val DECODE: String = "SGVsbG8gV29ybGQ="
}

/**
 * The three mutually-exclusive top-level surfaces the composable renders. The tool has no network feed, so a
 * host normally supplies [Ready]; [Loading] and [Error] are the lifecycle chrome the shared feature-view
 * contract (P1/S8) can still carry — reproduced for full state coverage, never faked from a fetch the tool
 * does not perform.
 */
enum class Base64ToolSurfaceState { Loading, Error, Ready }

/**
 * Classifies the host lifecycle flags into the top-level [Base64ToolSurfaceState] — the pure mirror of the
 * composable's `when` (loading first, then hard error, otherwise the ready tool). Kept framework-free so each
 * branch is asserted off-device.
 */
fun base64ToolSurfaceFor(
    isLoading: Boolean,
    isError: Boolean,
): Base64ToolSurfaceState =
    when {
        isLoading -> Base64ToolSurfaceState.Loading
        isError -> Base64ToolSurfaceState.Error
        else -> Base64ToolSurfaceState.Ready
    }

/**
 * The render-ready result of transforming the typed input — the native analogue of the web `useMemo`'s output
 * string, modeled as three explicit cases so each renders its own surface (never a blank box):
 *
 * - [Empty] — blank input, or a transform that yields the empty string (an all-whitespace `atob`). Web returns
 *   `''`, whose falsiness hides the output box; the composable shows a friendly hint.
 * - [Value] — a successful encode or decode. Web shows it in the output box; [text] is the copyable result.
 * - [Invalid] — a transform that threw (`btoa` of a non-Latin-1 character, or `atob` of malformed Base64).
 *   Web returns the localized "Invalid Input" message; the composable renders that same localized message as
 *   a friendly inline surface (a malformed input yields no meaningful value to copy).
 */
sealed interface Base64ToolOutput {
    /** Blank input or an empty transform result — nothing to show yet. */
    data object Empty : Base64ToolOutput

    /** A successful transform whose [text] is the value shown and copied. */
    data class Value(
        val text: String,
    ) : Base64ToolOutput

    /** A transform that could not be performed (the web `InvalidCharacterError` / `DOMException` branch). */
    data object Invalid : Base64ToolOutput
}

/**
 * The pure projection the composable renders — the native mirror of the web tool's `useMemo` block plus the
 * two transforms it calls. Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object Base64ToolProjection {
    /** The standard Base64 alphabet (RFC 4648 §4) — index `n` is the character for the 6-bit value `n`. */
    private const val ALPHABET: String =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

    /** The five WHATWG "ASCII whitespace" code points `atob` strips before decoding (tab/LF/FF/CR/space). */
    private const val ASCII_WHITESPACE: String = "\t\n\u000C\r "

    /** The `=` padding character — emitted by `btoa`, stripped (only when complete) by `atob`. */
    private const val PAD: Char = '='

    /** The largest UTF-16 code unit `btoa` accepts; anything above throws `InvalidCharacterError`. */
    private const val LATIN1_MAX: Int = 0xFF

    private const val BYTE_MASK: Int = 0xFF
    private const val SIXTET_MASK: Int = 0x3F
    private const val BITS_PER_SIXTET: Int = 6
    private const val GROUP_BITS: Int = 24
    private const val TAIL_TWO_BYTE_BITS: Int = 18
    private const val TAIL_ONE_BYTE_BITS: Int = 12
    private const val GROUP_BYTES: Int = 3

    /**
     * Faithful `btoa`: returns the standard-Base64 encoding of [input], or `null` exactly where the web throws
     * `InvalidCharacterError` — the first UTF-16 code unit greater than 0xFF (any non-Latin-1 character,
     * including a lone surrogate). Each accepted unit contributes its low byte to the encoded byte stream.
     */
    fun encodeOrNull(input: String): String? {
        val bytes = ByteArray(input.length)
        for (index in input.indices) {
            val code = input[index].code
            if (code > LATIN1_MAX) return null
            bytes[index] = code.toByte()
        }
        return base64Encode(bytes)
    }

    /**
     * Faithful `atob`: returns the decoded binary string (each byte mapped to its Latin-1 code point), or
     * `null` exactly where the web throws — a length of `1 (mod 4)` after whitespace removal, a `=` in any
     * position other than complete trailing padding, or any other non-alphabet character. The strict-decode
     * work is delegated to [decodeStrict], whose thrown errors are folded to `null` here so the public
     * contract stays total.
     */
    fun decodeOrNull(input: String): String? = runCatching { decodeStrict(input) }.getOrNull()

    /**
     * The web `useMemo` analogue: blank input projects to [Base64ToolOutput.Empty] (web `if (!inputVal)
     * return ''`); otherwise the mode's transform is applied and its result classified by [classify] — a
     * thrown transform becomes [Base64ToolOutput.Invalid] (the web try/catch "Invalid Input" message), an
     * empty result becomes [Base64ToolOutput.Empty] (the web `output && …` falsiness that hides the box), and
     * any other result becomes [Base64ToolOutput.Value]. Blankness is tested with `isEmpty`, not `isBlank`, so
     * an all-spaces input still runs the transform, matching JS truthiness.
     */
    fun project(
        mode: Base64ToolMode,
        input: String,
    ): Base64ToolOutput {
        if (input.isEmpty()) return Base64ToolOutput.Empty
        val result =
            when (mode) {
                Base64ToolMode.Encode -> encodeOrNull(input)
                Base64ToolMode.Decode -> decodeOrNull(input)
            }
        return classify(result)
    }

    /**
     * Folds an output [label] and [value] into a single TalkBack content description ("<label>: <value>") so
     * the result reads as one node while its copy affordance stays a separate, independently-labeled control.
     */
    fun outputContentDescription(
        label: String,
        value: String,
    ): String = "$label: $value"

    /** Maps a raw transform result to its render case: `null` ⇒ Invalid, "" ⇒ Empty, otherwise Value. */
    private fun classify(result: String?): Base64ToolOutput =
        when {
            result == null -> Base64ToolOutput.Invalid
            result.isEmpty() -> Base64ToolOutput.Empty
            else -> Base64ToolOutput.Value(result)
        }

    /** Standard-Base64-encodes [bytes] in big-endian 24-bit groups, padding the final partial group with `=`. */
    private fun base64Encode(bytes: ByteArray): String {
        val out = StringBuilder((bytes.size + GROUP_BYTES) / GROUP_BYTES * 4)
        var index = 0
        while (index + GROUP_BYTES <= bytes.size) {
            val chunk =
                ((bytes[index].toInt() and BYTE_MASK) shl 16) or
                    ((bytes[index + 1].toInt() and BYTE_MASK) shl 8) or
                    (bytes[index + 2].toInt() and BYTE_MASK)
            out.append(ALPHABET[(chunk ushr 18) and SIXTET_MASK])
            out.append(ALPHABET[(chunk ushr 12) and SIXTET_MASK])
            out.append(ALPHABET[(chunk ushr 6) and SIXTET_MASK])
            out.append(ALPHABET[chunk and SIXTET_MASK])
            index += GROUP_BYTES
        }
        appendEncodedTail(out, bytes, index)
        return out.toString()
    }

    /** Encodes the trailing 1 or 2 bytes (if any) into [out], emitting `=` padding to a full 4-character quad. */
    private fun appendEncodedTail(
        out: StringBuilder,
        bytes: ByteArray,
        index: Int,
    ) {
        when (bytes.size - index) {
            1 -> {
                val chunk = (bytes[index].toInt() and BYTE_MASK) shl 16
                out.append(ALPHABET[(chunk ushr 18) and SIXTET_MASK])
                out.append(ALPHABET[(chunk ushr 12) and SIXTET_MASK])
                out.append(PAD).append(PAD)
            }
            2 -> {
                val chunk =
                    ((bytes[index].toInt() and BYTE_MASK) shl 16) or
                        ((bytes[index + 1].toInt() and BYTE_MASK) shl 8)
                out.append(ALPHABET[(chunk ushr 18) and SIXTET_MASK])
                out.append(ALPHABET[(chunk ushr 12) and SIXTET_MASK])
                out.append(ALPHABET[(chunk ushr 6) and SIXTET_MASK])
                out.append(PAD)
            }
        }
    }

    /**
     * WHATWG forgiving-base64 decode core. Strips ASCII whitespace, throws for a `1 (mod 4)` length, removes
     * complete trailing padding only when the length is `0 (mod 4)`, then accumulates 6 bits per alphabet
     * character into big-endian bytes (throwing on any non-alphabet character — including a misplaced `=`).
     * Both throws are folded to `null` by [decodeOrNull], mirroring the web `DOMException`.
     */
    private fun decodeStrict(input: String): String {
        val stripped = stripAsciiWhitespace(input)
        val data =
            when (stripped.length % 4) {
                0 -> stripTrailingPadding(stripped)
                1 -> throw IllegalArgumentException("invalid base64 length")
                else -> stripped
            }
        val bytes = ArrayList<Byte>(data.length)
        var buffer = 0
        var bits = 0
        for (char in data) {
            val sixtet = ALPHABET.indexOf(char)
            require(sixtet >= 0) { "invalid base64 character" }
            buffer = (buffer shl BITS_PER_SIXTET) or sixtet
            bits += BITS_PER_SIXTET
            if (bits == GROUP_BITS) {
                appendDecodedGroup(bytes, buffer)
                buffer = 0
                bits = 0
            }
        }
        appendDecodedTail(bytes, buffer, bits)
        return String(bytes.toByteArray(), Charsets.ISO_8859_1)
    }

    /** Returns [input] with every WHATWG ASCII-whitespace code point removed (the first `atob` step). */
    private fun stripAsciiWhitespace(input: String): String =
        buildString(input.length) {
            for (char in input) if (char !in ASCII_WHITESPACE) append(char)
        }

    /** Removes one or two trailing `=` — only valid for a `0 (mod 4)`-length run, per the spec. */
    private fun stripTrailingPadding(data: String): String =
        when {
            data.endsWith("$PAD$PAD") -> data.dropLast(2)
            data.endsWith(PAD) -> data.dropLast(1)
            else -> data
        }

    /** Emits a full 24-bit [buffer] as three big-endian bytes into [bytes]. */
    private fun appendDecodedGroup(
        bytes: ArrayList<Byte>,
        buffer: Int,
    ) {
        bytes.add(((buffer ushr 16) and BYTE_MASK).toByte())
        bytes.add(((buffer ushr 8) and BYTE_MASK).toByte())
        bytes.add((buffer and BYTE_MASK).toByte())
    }

    /** Emits the leftover bits — 12 bits ⇒ one byte, 18 bits ⇒ two bytes — discarding the spare low bits. */
    private fun appendDecodedTail(
        bytes: ArrayList<Byte>,
        buffer: Int,
        bits: Int,
    ) {
        when (bits) {
            TAIL_ONE_BYTE_BITS -> bytes.add(((buffer ushr 4) and BYTE_MASK).toByte())
            TAIL_TWO_BYTE_BITS -> {
                bytes.add(((buffer ushr 10) and BYTE_MASK).toByte())
                bytes.add(((buffer ushr 2) and BYTE_MASK).toByte())
            }
        }
    }
}

/**
 * The web `t(key, default)` fallback strings for the keys that exist in NO i18n catalog. The web calls
 * `t('Input Label')`, `t('Output Label')`, and `t('Invalid Input')`, whose keys are absent (and must not be
 * added to the generated, drift-checked catalog — ADR-014), so i18next renders the key text itself; these
 * defaults reproduce that exactly. [TITLE] / [DESCRIPTION] mirror the web defaults for `t('devtools.utils.
 * base64', 'Base64')` / `t('devtools.utils.base64Desc', 'Base64Desc')`, whose keys DO resolve in the catalog
 * (so the composable reads them as compile-time resources); they are retained here only as the documented
 * web contract the unit gate asserts. [EMPTY_HINT] is the friendly "no input yet" microcopy the
 * always-visible empty state shows where the web hides the output box.
 */
object Base64ToolDefaults {
    /** Web `t('devtools.utils.base64', 'Base64')` default — present in the catalog as a compile-time string. */
    const val TITLE: String = "Base64"

    /** Web `t('devtools.utils.base64Desc', 'Base64Desc')` default — present in the catalog. */
    const val DESCRIPTION: String = "Base64Desc"

    /** Web `t('Input Label')` → "Input Label" (no catalog entry, so i18next returns the key). */
    const val INPUT_LABEL: String = "Input Label"

    /** Web `t('Output Label')` → "Output Label" (no catalog entry, so i18next returns the key). */
    const val OUTPUT_LABEL: String = "Output Label"

    /** Web `t('Invalid Input')` → "Invalid Input" (no catalog entry, so i18next returns the key). */
    const val INVALID_INPUT: String = "Invalid Input"

    /** Native-only empty hint (no input entered) — the always-visible counterpart to the web hidden box. */
    const val EMPTY_HINT: String = "Enter text to encode or decode"
}

/** Resource name for the web `devtools.utils.base64` title key (compile-time present ⇒ resolves in-catalog). */
const val KEY_TITLE: String = "translation_devtools_utils_base64"

/** Resource name for the web `devtools.utils.base64Desc` key (compile-time present ⇒ resolves in-catalog). */
const val KEY_DESCRIPTION: String = "translation_devtools_utils_base64Desc"

/** Resource name for the web `Input Label` key (by-name; absent ⇒ [Base64ToolDefaults.INPUT_LABEL]). */
const val KEY_INPUT_LABEL: String = "translation_Input_Label"

/** Resource name for the web `Output Label` key (by-name; absent ⇒ [Base64ToolDefaults.OUTPUT_LABEL]). */
const val KEY_OUTPUT_LABEL: String = "translation_Output_Label"

/** Resource name for the web `Invalid Input` key (by-name; absent ⇒ [Base64ToolDefaults.INVALID_INPUT]). */
const val KEY_INVALID_INPUT: String = "translation_Invalid_Input"

/** Resource name for the native empty hint (by-name; absent ⇒ [Base64ToolDefaults.EMPTY_HINT]). */
const val KEY_EMPTY_HINT: String = "translation_base64_enterText"

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
 * Localized microcopy folded into the surface — the web `t('devtools.utils.base64')`,
 * `t('devtools.utils.base64Desc')`, `t('Encode')`, `t('Decode')`, `t('Input Label')`, `t('Output Label')`,
 * and `t('Invalid Input')` strings, plus the shared `Copy`/`Copied` clipboard labels and the always-visible
 * empty hint. The composable builds this from the i18n facade; tests pass a deterministic instance.
 */
data class Base64ToolStrings(
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
