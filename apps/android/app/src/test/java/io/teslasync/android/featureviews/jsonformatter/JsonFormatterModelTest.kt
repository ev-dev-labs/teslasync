package io.teslasync.android.featureviews.jsonformatter

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the JSON Formatter's pure logic — the native analogue of the web component's
 * `useMemo` block (web/src/features/admin/components/devtools/tools/JsonFormatter.tsx): the three-branch
 * reduction (blank → empty, valid → 2-space pretty print with order preserved, malformed → error message
 * with the localized fallback) plus the surface registration identifiers and the exact web i18n keys. Runs
 * in the :android:testReleaseUnitTest gate; the on-device render + accessibility live in JsonFormatterUiTest.
 */
class JsonFormatterModelTest {
    private val fallback = "Invalid Json"

    private fun formatted(input: String): String {
        val result = JsonFormatterModel.format(input, fallback)
        return (result as JsonFormatResult.Formatted).text
    }

    // ── Branch 1: blank input (web `if (!inputVal.trim())`) ───────────────────────

    @Test
    fun emptyStringReducesToEmpty() {
        assertEquals(JsonFormatResult.Empty, JsonFormatterModel.format("", fallback))
    }

    @Test
    fun whitespaceOnlyReducesToEmpty() {
        // Web trims before the truthiness check, so spaces / tabs / newlines are all "blank".
        assertEquals(JsonFormatResult.Empty, JsonFormatterModel.format("   \n\t  ", fallback))
    }

    // ── Branch 2: valid document (web `JSON.stringify(parsed, null, 2)`) ───────────

    @Test
    fun validObjectIsPrettyPrintedWithTwoSpaceIndent() {
        val text = formatted("""{"a":1}""")
        // 2-space indent before the (only, top-level) key — the web `null, 2` argument.
        assertTrue("expected 2-space indent, was:\n$text", text.contains("\n  \"a\": 1"))
        // ...and not a 4-space indent at the top level.
        assertTrue(!text.contains("\n    \"a\""))
    }

    @Test
    fun nestedObjectIndentsByDepth() {
        val text = formatted("""{"outer":{"inner":true}}""")
        assertTrue("outer key at 2 spaces:\n$text", text.contains("\n  \"outer\""))
        assertTrue("inner key at 4 spaces:\n$text", text.contains("\n    \"inner\": true"))
    }

    @Test
    fun objectKeyOrderIsPreserved() {
        // `JSON.parse`/kotlinx JsonObject both keep insertion order — b must precede a.
        val text = formatted("""{"b":1,"a":2}""")
        assertTrue("b before a:\n$text", text.indexOf("\"b\"") < text.indexOf("\"a\""))
    }

    @Test
    fun arrayIsPrettyPrinted() {
        val text = formatted("[1,2,3]")
        assertTrue("multi-line array:\n$text", text.startsWith("[\n"))
        assertTrue(text.contains("\n  1,"))
        assertEquals(listOf("1", "2", "3"), Regex("\\d").findAll(text).map { it.value }.toList())
    }

    @Test
    fun emptyContainersStayCompact() {
        // Web `JSON.stringify({}, null, 2)` → "{}"; strip whitespace to stay layout-agnostic.
        assertEquals("{}", formatted("{}").filterNot(Char::isWhitespace))
        assertEquals("[]", formatted("[]").filterNot(Char::isWhitespace))
    }

    @Test
    fun topLevelPrimitivesRoundTripVerbatim() {
        // No indentation is involved, so these are exact (web `JSON.stringify(123, null, 2)` → "123").
        assertEquals("123", formatted("123"))
        assertEquals("true", formatted("true"))
        assertEquals("null", formatted("null"))
        assertEquals("\"hi\"", formatted("\"hi\""))
    }

    @Test
    fun reformattingIsIdempotent() {
        // Pretty-printing an already-pretty document yields the same text — a stable, whitespace-agnostic
        // characterisation that doesn't hardcode kotlinx's exact byte layout.
        val once = formatted("""{"a":[1,{"b":2}],"c":"d"}""")
        assertEquals(once, formatted(once))
    }

    @Test
    fun leadingAndTrailingWhitespaceAroundValidJsonStillParses() {
        assertTrue(JsonFormatterModel.format("  \n {\"a\":1} \t ", fallback) is JsonFormatResult.Formatted)
    }

    // ── Branch 3: malformed input (web `catch`) ───────────────────────────────────

    @Test
    fun malformedInputReducesToInvalidWithNonBlankMessage() {
        val invalid = JsonFormatterModel.format("not json", fallback) as JsonFormatResult.Invalid
        // Web shows `e.message`; the parser always supplies one, so the fallback is only a defensive guard.
        assertTrue("expected a non-blank parser message", invalid.message.isNotBlank())
    }

    @Test
    fun truncatedDocumentReducesToInvalid() {
        assertTrue(JsonFormatterModel.format("""{"a":}""", fallback) is JsonFormatResult.Invalid)
        assertTrue(JsonFormatterModel.format("""{"a":1""", fallback) is JsonFormatResult.Invalid)
    }

    @Test
    fun trailingCommaIsRejectedLikeJsonParse() {
        // `JSON.parse('[1,2,]')` throws; kotlinx (non-lenient) agrees — not a silently-accepted document.
        assertTrue(JsonFormatterModel.format("[1,2,]", fallback) is JsonFormatResult.Invalid)
    }

    @Test
    fun bareWordsAreRejectedLikeJsonParse() {
        // `JSON.parse('oops')` throws; kotlinx's tolerant element parser would accept the bare token, so the
        // model tightens parsing to reject any unquoted non-literal — matching the web tool exactly.
        assertTrue(JsonFormatterModel.format("oops", fallback) is JsonFormatResult.Invalid)
        assertTrue(JsonFormatterModel.format("undefined", fallback) is JsonFormatResult.Invalid)
        assertTrue(JsonFormatterModel.format("NaN", fallback) is JsonFormatResult.Invalid)
    }

    @Test
    fun bareWordNestedInsideAContainerIsRejected() {
        assertTrue(JsonFormatterModel.format("""{"a":oops}""", fallback) is JsonFormatResult.Invalid)
        assertTrue(JsonFormatterModel.format("[bad]", fallback) is JsonFormatResult.Invalid)
    }

    @Test
    fun leadingZeroNumberIsRejectedLikeJsonParse() {
        // `JSON.parse('01')` throws; the strict number grammar rejects the leading zero.
        assertTrue(JsonFormatterModel.format("01", fallback) is JsonFormatResult.Invalid)
    }

    @Test
    fun invalidResultDiffersFromEmptyAndFormatted() {
        val invalid = JsonFormatterModel.format("oops", fallback)
        assertNotEquals(JsonFormatResult.Empty, invalid)
        assertTrue(invalid !is JsonFormatResult.Formatted)
    }

    // ── Registration + i18n key pins (web parity) ─────────────────────────────────

    @Test
    fun registrationExposesStableIdAndSlug() {
        assertEquals("json-formatter", JsonFormatterRegistration.ID)
        assertEquals("JsonFormatter", JsonFormatterRegistration.SLUG)
    }

    @Test
    fun i18nKeysMatchTheWebSourceVerbatim() {
        // Pinned against web `t('Json Formatter')`, `t('Json Formatter Desc')`, `t('Json Input')`,
        // `t('Invalid Json')` and the literal example `{"key":"value"}`.
        assertEquals("Json Formatter", JsonFormatterKeys.TITLE)
        assertEquals("Json Formatter Desc", JsonFormatterKeys.DESCRIPTION)
        assertEquals("Json Input", JsonFormatterKeys.INPUT_LABEL)
        assertEquals("Invalid Json", JsonFormatterKeys.INVALID)
        assertEquals("{\"key\":\"value\"}", JsonFormatterKeys.INPUT_EXAMPLE)
    }

    @Test
    fun formattedResultEqualityIsValueBased() {
        // Guards the sealed type's data-class semantics the UI relies on for recomposition keys.
        assertEquals(JsonFormatResult.Formatted("x"), JsonFormatResult.Formatted("x"))
        assertNotEquals(JsonFormatResult.Formatted("x"), JsonFormatResult.Formatted("y"))
    }
}
