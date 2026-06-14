// Off-device unit coverage for the Base64 feature view's pure model (P3 acceptance: adapter + per-state +
// a11y label tests). Exercises the two transforms (the web `btoa` / `atob` analogues) against the canonical
// RFC 4648 §10 test vectors, the `useMemo` projection (mode/blank/throw/empty branching), the top-level
// lifecycle classifier the composable switches on (per-state coverage), the accessibility content-description
// fold (a11y label coverage), and the `t(key, default)` resolver. No Compose / Android / HTTP — runs in
// :android:testReleaseUnitTest. Reference values are the outputs the web tool produces for the same inputs.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.base64tool

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class Base64ToolModelTest {
    // ── encode (web btoa parity) ────────────────────────────────────────────────

    @Test
    fun encodeMatchesWebEncodeExample() {
        assertEquals(Base64ToolExamples.DECODE, Base64ToolProjection.encodeOrNull(Base64ToolExamples.ENCODE))
        assertEquals("SGVsbG8gV29ybGQ=", Base64ToolProjection.encodeOrNull("Hello World"))
    }

    @Test
    fun encodeMatchesRfc4648TestVectors() {
        assertEquals("", Base64ToolProjection.encodeOrNull(""))
        assertEquals("Zg==", Base64ToolProjection.encodeOrNull("f"))
        assertEquals("Zm8=", Base64ToolProjection.encodeOrNull("fo"))
        assertEquals("Zm9v", Base64ToolProjection.encodeOrNull("foo"))
        assertEquals("Zm9vYg==", Base64ToolProjection.encodeOrNull("foob"))
        assertEquals("Zm9vYmE=", Base64ToolProjection.encodeOrNull("fooba"))
        assertEquals("Zm9vYmFy", Base64ToolProjection.encodeOrNull("foobar"))
    }

    @Test
    fun encodeAcceptsLatin1AndEncodesItsLowByte() {
        // 'é' is U+00E9 (233) — within the binary-string range, so btoa encodes byte 0xE9.
        assertEquals("6Q==", Base64ToolProjection.encodeOrNull("\u00e9"))
    }

    @Test
    fun encodeReturnsNullForCharactersAboveLatin1() {
        // The defining btoa failure: any UTF-16 code unit > 0xFF throws InvalidCharacterError on the web.
        assertNull(Base64ToolProjection.encodeOrNull("\u20ac")) // '€' U+20AC
        assertNull(Base64ToolProjection.encodeOrNull("caf\u00e9\u2026")) // trailing '…' U+2026
        assertNull(Base64ToolProjection.encodeOrNull("\uD83D\uDE00")) // '😀' — surrogate pair, first unit > 0xFF
    }

    // ── decode (web atob parity) ────────────────────────────────────────────────

    @Test
    fun decodeRoundTripsTheEncodeExample() {
        assertEquals("Hello World", Base64ToolProjection.decodeOrNull("SGVsbG8gV29ybGQ="))
    }

    @Test
    fun decodeMatchesRfc4648TestVectors() {
        assertEquals("", Base64ToolProjection.decodeOrNull(""))
        assertEquals("f", Base64ToolProjection.decodeOrNull("Zg=="))
        assertEquals("fo", Base64ToolProjection.decodeOrNull("Zm8="))
        assertEquals("foo", Base64ToolProjection.decodeOrNull("Zm9v"))
        assertEquals("foob", Base64ToolProjection.decodeOrNull("Zm9vYg=="))
        assertEquals("fooba", Base64ToolProjection.decodeOrNull("Zm9vYmE="))
        assertEquals("foobar", Base64ToolProjection.decodeOrNull("Zm9vYmFy"))
    }

    @Test
    fun decodeStripsAsciiWhitespaceBeforeDecoding() {
        assertEquals("Hello World", Base64ToolProjection.decodeOrNull("SGVsbG8g\nV29ybGQ="))
        assertEquals("Hello World", Base64ToolProjection.decodeOrNull("  SGVs bG8g\tV29y bGQ=  "))
    }

    @Test
    fun decodeAcceptsForgivingMissingPadding() {
        // The forgiving-base64 algorithm only strips '=' when the length is 0 (mod 4); a 2/3-length run with
        // no padding is still valid and must decode (web atob behaves identically).
        assertEquals("f", Base64ToolProjection.decodeOrNull("Zg"))
        assertEquals("fo", Base64ToolProjection.decodeOrNull("Zm8"))
        assertEquals("foobar", Base64ToolProjection.decodeOrNull("Zm9vYmFy"))
    }

    @Test
    fun decodeYieldsLatin1BinaryStringForNonTextBytes() {
        assertEquals("\u00e9", Base64ToolProjection.decodeOrNull("6Q=="))
    }

    @Test
    fun decodeReturnsNullForLengthOneModFour() {
        assertNull(Base64ToolProjection.decodeOrNull("a"))
        assertNull(Base64ToolProjection.decodeOrNull("Zm9vYmFyZ")) // 9 chars → 1 (mod 4)
    }

    @Test
    fun decodeReturnsNullForNonAlphabetOrMisplacedPadding() {
        assertNull(Base64ToolProjection.decodeOrNull("@@@@"))
        assertNull(Base64ToolProjection.decodeOrNull("====")) // strips to "==", which is non-alphabet
        assertNull(Base64ToolProjection.decodeOrNull("A===")) // strips to "A=", '=' is misplaced
        assertNull(Base64ToolProjection.decodeOrNull("ab*d"))
        assertNull(Base64ToolProjection.decodeOrNull("%zz"))
    }

    // ── project (web useMemo branching) ─────────────────────────────────────────

    @Test
    fun projectReturnsEmptyForBlankInputInEitherMode() {
        assertEquals(Base64ToolOutput.Empty, Base64ToolProjection.project(Base64ToolMode.Encode, ""))
        assertEquals(Base64ToolOutput.Empty, Base64ToolProjection.project(Base64ToolMode.Decode, ""))
    }

    @Test
    fun projectEncodesNonEmptyInputAndFlagsNonLatin1AsInvalid() {
        assertEquals(
            Base64ToolOutput.Value("SGVsbG8gV29ybGQ="),
            Base64ToolProjection.project(Base64ToolMode.Encode, "Hello World"),
        )
        assertEquals(
            Base64ToolOutput.Invalid,
            Base64ToolProjection.project(Base64ToolMode.Encode, "\u20ac"),
        )
    }

    @Test
    fun projectDecodesValidInputAndFlagsMalformedAsInvalid() {
        assertEquals(
            Base64ToolOutput.Value("Hello World"),
            Base64ToolProjection.project(Base64ToolMode.Decode, "SGVsbG8gV29ybGQ="),
        )
        assertEquals(Base64ToolOutput.Invalid, Base64ToolProjection.project(Base64ToolMode.Decode, "@@@@"))
    }

    @Test
    fun projectTreatsAnEmptyDecodeResultAsEmptyMirroringWebFalsiness() {
        // atob of an all-whitespace string is "" on the web, whose falsiness hides the output box; the
        // projection collapses that to Empty so the surface shows the friendly hint, not a blank box.
        assertEquals(Base64ToolOutput.Empty, Base64ToolProjection.project(Base64ToolMode.Decode, "   "))
        assertEquals(Base64ToolOutput.Empty, Base64ToolProjection.project(Base64ToolMode.Decode, "\n\t"))
    }

    // ── lifecycle classifier (per-state coverage) ───────────────────────────────

    @Test
    fun base64ToolSurfaceForMapsLifecycleFlags() {
        assertEquals(Base64ToolSurfaceState.Loading, base64ToolSurfaceFor(isLoading = true, isError = false))
        assertEquals(Base64ToolSurfaceState.Error, base64ToolSurfaceFor(isLoading = false, isError = true))
        assertEquals(Base64ToolSurfaceState.Loading, base64ToolSurfaceFor(isLoading = true, isError = true))
        assertEquals(Base64ToolSurfaceState.Ready, base64ToolSurfaceFor(isLoading = false, isError = false))
    }

    @Test
    fun surfaceCoversEveryUiStatePhase() {
        assertEquals(Base64ToolSurfaceState.Loading, surfaceFor(UiState.loading<Unit>()))
        assertEquals(
            Base64ToolSurfaceState.Error,
            surfaceFor(UiState<Unit>(UiPhase.Error, errorKind = ErrorKind.Network)),
        )
        assertEquals(Base64ToolSurfaceState.Ready, surfaceFor(UiState<Unit>(UiPhase.Content, data = Unit)))
        assertEquals(Base64ToolSurfaceState.Ready, surfaceFor(UiState<Unit>(UiPhase.Empty, data = Unit)))
        val offline = UiState<Unit>(UiPhase.Content, data = Unit, stale = true, errorKind = ErrorKind.Network)
        assertEquals(Base64ToolSurfaceState.Ready, surfaceFor(offline))
        assertTrue(offline.isOffline)
    }

    // ── accessibility label fold ─────────────────────────────────────────────────

    @Test
    fun outputContentDescriptionFoldsLabelAndValue() {
        assertEquals(
            "Output Label: SGVsbG8gV29ybGQ=",
            Base64ToolProjection.outputContentDescription("Output Label", "SGVsbG8gV29ybGQ="),
        )
    }

    // ── t(key, default) resolver + web-mirrored constants ───────────────────────

    @Test
    fun resolveOptionalReturnsLookupWhenPresent() {
        val lookup: (String) -> String? = mapOf(KEY_INPUT_LABEL to "Source")::get
        assertEquals("Source", resolveOptional(lookup, KEY_INPUT_LABEL, Base64ToolDefaults.INPUT_LABEL))
    }

    @Test
    fun resolveOptionalFallsBackWhenAbsentOrBlank() {
        assertEquals(
            Base64ToolDefaults.INPUT_LABEL,
            resolveOptional({ null }, KEY_INPUT_LABEL, Base64ToolDefaults.INPUT_LABEL),
        )
        assertEquals(
            Base64ToolDefaults.OUTPUT_LABEL,
            resolveOptional({ "" }, KEY_OUTPUT_LABEL, Base64ToolDefaults.OUTPUT_LABEL),
        )
    }

    @Test
    fun defaultsAndKeysMirrorWebSource() {
        assertEquals("Base64", Base64ToolDefaults.TITLE)
        assertEquals("Base64Desc", Base64ToolDefaults.DESCRIPTION)
        assertEquals("Input Label", Base64ToolDefaults.INPUT_LABEL)
        assertEquals("Output Label", Base64ToolDefaults.OUTPUT_LABEL)
        assertEquals("Invalid Input", Base64ToolDefaults.INVALID_INPUT)
        assertEquals("translation_devtools_utils_base64", KEY_TITLE)
        assertEquals("translation_devtools_utils_base64Desc", KEY_DESCRIPTION)
        assertEquals("translation_Input_Label", KEY_INPUT_LABEL)
        assertEquals("translation_Output_Label", KEY_OUTPUT_LABEL)
        assertEquals("translation_Invalid_Input", KEY_INVALID_INPUT)
        assertEquals("Base64Tool", Base64ToolRegistration.SLUG)
        assertEquals("base64-tool", Base64ToolRegistration.ID)
        assertEquals("Hello World", Base64ToolExamples.ENCODE)
        assertEquals("SGVsbG8gV29ybGQ=", Base64ToolExamples.DECODE)
        assertFalse(Base64ToolDefaults.EMPTY_HINT.isBlank())
    }

    /** Bridges a [UiState] to the composable's classifier the same way `Base64ToolContent` does. */
    private fun surfaceFor(state: UiState<*>): Base64ToolSurfaceState =
        base64ToolSurfaceFor(isLoading = state.isLoading, isError = state.isError)
}
