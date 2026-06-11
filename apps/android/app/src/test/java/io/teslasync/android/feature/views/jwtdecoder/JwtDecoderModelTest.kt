package io.teslasync.android.feature.views.jwtdecoder

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

/**
 * Off-device verification of the JwtDecoder's pure logic — the native mirror of every step the web
 * `useMemo` performs (web/src/features/admin/components/devtools/tools/JwtDecoder.tsx): the blank-input
 * short-circuit, the `parts.length < 2` guard, the `atob` + `JSON.parse` of the first two dot-segments,
 * and the all-or-nothing `try/catch` that folds any failure to an error. Because the surface is purely
 * computational this is also the per-state "snapshot": each [JwtDecodeResult] is exactly what the thin
 * composable renders (Idle → just the input, Invalid → the error line, Decoded → the two panels). The
 * i18n key contract and the PII-safe diagnostic are pinned here too. Runs in the
 * :app:testReleaseUnitTest gate; the on-device render + accessibility are covered by JwtDecoderUiTest.
 */
class JwtDecoderModelTest {
    private val encoder: Base64.Encoder = Base64.getEncoder().withoutPadding()

    private fun segment(json: String): String = encoder.encodeToString(json.toByteArray(Charsets.UTF_8))

    // ── Idle (web `if (!jwt.trim()) …`) ───────────────────────────────────────────

    @Test
    fun blankInputIsIdle() {
        assertSame(JwtDecodeResult.Idle, JwtDecoderLogic.decode(""))
        assertSame(JwtDecodeResult.Idle, JwtDecoderLogic.decode("   "))
        assertSame(JwtDecodeResult.Idle, JwtDecoderLogic.decode("\t\n "))
    }

    // ── Decoded (web `{ header, payload }`) ───────────────────────────────────────

    @Test
    fun validTokenDecodesHeaderAndPayload() {
        val headerJson = """{"alg":"HS256","typ":"JWT"}"""
        val payloadJson = """{"sub":"1234567890","name":"Ada Lovelace","admin":true}"""
        val token = "${segment(headerJson)}.${segment(payloadJson)}.signature-is-ignored"

        val result = JwtDecoderLogic.decode(token)

        assertTrue("expected Decoded, was $result", result is JwtDecodeResult.Decoded)
        result as JwtDecodeResult.Decoded
        assertEquals(Json.parseToJsonElement(headerJson), result.header)
        assertEquals(Json.parseToJsonElement(payloadJson), result.payload)
    }

    @Test
    fun exactlyTwoSegmentsAreEnoughToDecode() {
        // Web guard is `parts.length < 2`, so an unsigned (header.payload) token still decodes.
        val headerJson = """{"alg":"none"}"""
        val payloadJson = """{"iss":"teslasync"}"""

        val result = JwtDecoderLogic.decode("${segment(headerJson)}.${segment(payloadJson)}")

        assertTrue(result is JwtDecodeResult.Decoded)
        result as JwtDecodeResult.Decoded
        assertEquals(Json.parseToJsonElement(headerJson), result.header)
        assertEquals(Json.parseToJsonElement(payloadJson), result.payload)
    }

    @Test
    fun unpaddedSegmentsDecodeLikeBrowserAtob() {
        // JWT segments are unpadded; the decoder re-pads to a multiple of four the way `atob` tolerates.
        val headerJson = """{"a":1}"""
        val payloadJson = """{"b":2}"""
        val token = "${segment(headerJson)}.${segment(payloadJson)}"

        // Sanity: at least one segment is genuinely unpadded (length not a multiple of four).
        assertTrue(token.substringBefore(".").length % 4 != 0 || token.substringAfter(".").length % 4 != 0)
        assertTrue(JwtDecoderLogic.decode(token) is JwtDecodeResult.Decoded)
    }

    // ── Invalid (web `parts.length < 2` guard + `catch`) ──────────────────────────

    @Test
    fun fewerThanTwoSegmentsIsInvalid() {
        assertSame(JwtDecodeResult.Invalid, JwtDecoderLogic.decode("not-a-jwt"))
        assertSame(JwtDecodeResult.Invalid, JwtDecoderLogic.decode(segment("""{"alg":"none"}""")))
    }

    @Test
    fun nonBase64SegmentIsInvalid() {
        // `@` is outside the base64 alphabet, so `atob`/the decoder throws → web `catch`.
        assertSame(JwtDecodeResult.Invalid, JwtDecoderLogic.decode("@@@@.@@@@"))
    }

    @Test
    fun base64UrlOnlyCharactersFailJustLikeAtob() {
        // `-` and `_` are base64url-only; standard-alphabet `atob` throws on them, and so do we.
        val payload = segment("""{"ok":true}""")
        assertSame(JwtDecodeResult.Invalid, JwtDecoderLogic.decode("ab-_.$payload"))
    }

    @Test
    fun validBase64ButNonJsonIsInvalid() {
        // The segment decodes to bytes fine, but `JSON.parse` throws on non-JSON text → web `catch`.
        val notJson = segment("this is definitely not json {{{")
        val payload = segment("""{"ok":true}""")
        assertSame(JwtDecodeResult.Invalid, JwtDecoderLogic.decode("$notJson.$payload"))
    }

    @Test
    fun headerValidButPayloadInvalidIsAllOrNothing() {
        // Web decodes header then payload inside one `try`; a payload failure discards the header too.
        val header = segment("""{"alg":"HS256"}""")
        assertSame(JwtDecodeResult.Invalid, JwtDecoderLogic.decode("$header.@@@@"))
    }

    // ── i18n key contract (web `t(...)` keys, verbatim) ───────────────────────────

    @Test
    fun i18nKeysMatchTheWebSourceVerbatim() {
        // Pins the keys against the web source so a rename in either place is caught as drift.
        assertEquals("Jwt Decoder", JwtDecoderI18n.TITLE)
        assertEquals("Jwt Decoder Desc", JwtDecoderI18n.DESCRIPTION)
        assertEquals("Jwt Input", JwtDecoderI18n.INPUT_LABEL)
        assertEquals("Invalid Jwt", JwtDecoderI18n.INVALID_ERROR)
        assertEquals("Jwt Header", JwtDecoderI18n.HEADER_TITLE)
        assertEquals("Jwt Payload", JwtDecoderI18n.PAYLOAD_TITLE)
        assertEquals("eyJhbGciOiJSUzI1NiIs...", JwtDecoderI18n.INPUT_EXAMPLE_TOKEN)
    }

    // ── Registration + PII-safe diagnostics (P1/S11) ──────────────────────────────

    @Test
    fun registrationExposesStableIdAndSlug() {
        assertEquals("jwt-decoder", JwtDecoderRegistration.ID)
        assertEquals("JwtDecoder", JwtDecoderRegistration.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        JwtDecoderDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "JwtDecoder"), opened.single().second)
    }

    @Test
    fun diagnosticNeverCarriesTokenOrPayloadFields() {
        val logger = RecordingLogger()

        JwtDecoderDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
        // The decoded payload is JSON; a leak would surface as a brace in a field value.
        assertTrue(fields.values.none { it.contains("{") })
    }

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }
}
