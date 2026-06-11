// Off-device unit coverage for the URL Encoder feature view's pure model (P3 acceptance: adapter +
// per-state + a11y label tests). Exercises the two ECMAScript transforms (the web `encodeURIComponent` /
// `decodeURIComponent` analogues), the `useMemo` projection (mode/blank/throw branching), the top-level
// lifecycle classifier the composable switches on (per-state coverage), the accessibility content-description
// fold (a11y label coverage), and the `t(key, default)` resolver. No Compose / Android / HTTP — runs in
// :android:testReleaseUnitTest. Reference values are the outputs the web tool produces for the same inputs.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.urlencoder

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UrlEncoderModelTest {
    // ── encode (web encodeURIComponent parity) ──────────────────────────────────

    @Test
    fun encodeMatchesWebEncodeExample() {
        assertEquals(UrlEncoderExamples.DECODE, UrlEncoderProjection.encode(UrlEncoderExamples.ENCODE))
        assertEquals("hello%20world%26foo%3Dbar", UrlEncoderProjection.encode("hello world&foo=bar"))
    }

    @Test
    fun encodeUsesPercent20ForSpaceAndPercent2BForPlus() {
        // The defining difference from Java URLEncoder, which would emit '+' for a space and keep '+'.
        assertEquals("a%20b", UrlEncoderProjection.encode("a b"))
        assertEquals("%2B", UrlEncoderProjection.encode("+"))
    }

    @Test
    fun encodePreservesTheUnreservedSet() {
        assertEquals("-_.!~*'()", UrlEncoderProjection.encode("-_.!~*'()"))
        assertEquals("AZaz09", UrlEncoderProjection.encode("AZaz09"))
    }

    @Test
    fun encodePercentEncodesReservedAsciiInUpperCaseHex() {
        assertEquals("%2F%3F%23%5B%5D%40", UrlEncoderProjection.encode("/?#[]@"))
    }

    @Test
    fun encodeEmitsUtf8OctetsForMultibyteAndSupplementaryCodePoints() {
        assertEquals("caf%C3%A9", UrlEncoderProjection.encode("caf\u00e9"))
        // U+1F600 GRINNING FACE — a surrogate pair encoded as its full four-octet UTF-8 form.
        assertEquals("%F0%9F%98%80", UrlEncoderProjection.encode("\uD83D\uDE00"))
    }

    // ── decode (web decodeURIComponent parity) ──────────────────────────────────

    @Test
    fun decodeRoundTripsTheEncodeExample() {
        assertEquals("hello world&foo=bar", UrlEncoderProjection.decodeOrNull("hello%20world%26foo%3Dbar"))
    }

    @Test
    fun decodePreservesLiteralPlusUnlikeFormDecoding() {
        assertEquals("a+b", UrlEncoderProjection.decodeOrNull("a+b"))
    }

    @Test
    fun decodeAcceptsEitherHexCaseAndJoinsMultiOctetRuns() {
        assertEquals("\u00e9", UrlEncoderProjection.decodeOrNull("%C3%A9"))
        assertEquals("\u00e9", UrlEncoderProjection.decodeOrNull("%c3%a9"))
        assertEquals("AB", UrlEncoderProjection.decodeOrNull("%41%42"))
        assertEquals("A\u00e9b", UrlEncoderProjection.decodeOrNull("A%C3%A9b"))
    }

    @Test
    fun decodeReturnsNullForTruncatedOrNonHexEscapes() {
        assertNull(UrlEncoderProjection.decodeOrNull("%"))
        assertNull(UrlEncoderProjection.decodeOrNull("%2"))
        assertNull(UrlEncoderProjection.decodeOrNull("%zz"))
        assertNull(UrlEncoderProjection.decodeOrNull("abc%"))
    }

    @Test
    fun decodeReturnsNullForInvalidUtf8OctetRuns() {
        assertNull(UrlEncoderProjection.decodeOrNull("%C3%28")) // lead byte without a valid continuation
        assertNull(UrlEncoderProjection.decodeOrNull("%80")) // lone continuation byte
    }

    // ── project (web useMemo branching) ─────────────────────────────────────────

    @Test
    fun projectReturnsEmptyForBlankInputInEitherMode() {
        assertEquals(UrlEncoderOutput.Empty, UrlEncoderProjection.project(UrlEncoderMode.Encode, ""))
        assertEquals(UrlEncoderOutput.Empty, UrlEncoderProjection.project(UrlEncoderMode.Decode, ""))
    }

    @Test
    fun projectEncodesNonEmptyInputIncludingAllSpaces() {
        assertEquals(
            UrlEncoderOutput.Value("a%20b"),
            UrlEncoderProjection.project(UrlEncoderMode.Encode, "a b"),
        )
        // All-spaces is non-empty (JS `!inputVal` is false), so it encodes rather than projecting Empty.
        assertEquals(
            UrlEncoderOutput.Value("%20%20%20"),
            UrlEncoderProjection.project(UrlEncoderMode.Encode, "   "),
        )
    }

    @Test
    fun projectDecodesValidInputAndFlagsMalformedAsInvalid() {
        assertEquals(
            UrlEncoderOutput.Value("hello world"),
            UrlEncoderProjection.project(UrlEncoderMode.Decode, "hello%20world"),
        )
        assertEquals(UrlEncoderOutput.Invalid, UrlEncoderProjection.project(UrlEncoderMode.Decode, "%zz"))
    }

    // ── lifecycle classifier (per-state coverage) ───────────────────────────────

    @Test
    fun urlEncoderSurfaceForMapsLifecycleFlags() {
        assertEquals(UrlEncoderSurfaceState.Loading, urlEncoderSurfaceFor(isLoading = true, isError = false))
        assertEquals(UrlEncoderSurfaceState.Error, urlEncoderSurfaceFor(isLoading = false, isError = true))
        assertEquals(UrlEncoderSurfaceState.Loading, urlEncoderSurfaceFor(isLoading = true, isError = true))
        assertEquals(UrlEncoderSurfaceState.Ready, urlEncoderSurfaceFor(isLoading = false, isError = false))
    }

    @Test
    fun surfaceCoversEveryUiStatePhase() {
        assertEquals(UrlEncoderSurfaceState.Loading, surfaceFor(UiState.loading<Unit>()))
        assertEquals(
            UrlEncoderSurfaceState.Error,
            surfaceFor(UiState<Unit>(UiPhase.Error, errorKind = ErrorKind.Network)),
        )
        assertEquals(UrlEncoderSurfaceState.Ready, surfaceFor(UiState<Unit>(UiPhase.Content, data = Unit)))
        assertEquals(UrlEncoderSurfaceState.Ready, surfaceFor(UiState<Unit>(UiPhase.Empty, data = Unit)))
        val offline = UiState<Unit>(UiPhase.Content, data = Unit, stale = true, errorKind = ErrorKind.Network)
        assertEquals(UrlEncoderSurfaceState.Ready, surfaceFor(offline))
        assertTrue(offline.isOffline)
    }

    // ── accessibility label fold ─────────────────────────────────────────────────

    @Test
    fun outputContentDescriptionFoldsLabelAndValue() {
        assertEquals(
            "Output Label: hello%20world",
            UrlEncoderProjection.outputContentDescription("Output Label", "hello%20world"),
        )
    }

    // ── t(key, default) resolver + web-mirrored constants ───────────────────────

    @Test
    fun resolveOptionalReturnsLookupWhenPresent() {
        val lookup: (String) -> String? = mapOf(KEY_TITLE to "URL-encode")::get
        assertEquals("URL-encode", resolveOptional(lookup, KEY_TITLE, UrlEncoderDefaults.TITLE))
    }

    @Test
    fun resolveOptionalFallsBackWhenAbsentOrBlank() {
        assertEquals(UrlEncoderDefaults.TITLE, resolveOptional({ null }, KEY_TITLE, UrlEncoderDefaults.TITLE))
        assertEquals(
            UrlEncoderDefaults.DESCRIPTION,
            resolveOptional({ "" }, KEY_DESCRIPTION, UrlEncoderDefaults.DESCRIPTION),
        )
    }

    @Test
    fun defaultsAndKeysMirrorWebSource() {
        assertEquals("Url Encoder", UrlEncoderDefaults.TITLE)
        assertEquals("Url Encoder Desc", UrlEncoderDefaults.DESCRIPTION)
        assertEquals("Input Label", UrlEncoderDefaults.INPUT_LABEL)
        assertEquals("Output Label", UrlEncoderDefaults.OUTPUT_LABEL)
        assertEquals("Invalid Input", UrlEncoderDefaults.INVALID_INPUT)
        assertEquals("translation_Url_Encoder", KEY_TITLE)
        assertEquals("translation_Url_Encoder_Desc", KEY_DESCRIPTION)
        assertEquals("translation_Input_Label", KEY_INPUT_LABEL)
        assertEquals("translation_Output_Label", KEY_OUTPUT_LABEL)
        assertEquals("translation_Invalid_Input", KEY_INVALID_INPUT)
        assertEquals("UrlEncoder", UrlEncoderRegistration.SLUG)
        assertFalse(UrlEncoderDefaults.EMPTY_HINT.isBlank())
    }

    /** Bridges a [UiState] to the composable's classifier the same way `UrlEncoderContent` does. */
    private fun surfaceFor(state: UiState<*>): UrlEncoderSurfaceState =
        urlEncoderSurfaceFor(isLoading = state.isLoading, isError = state.isError)
}
