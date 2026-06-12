package io.teslasync.android.featureviews.codeblock

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the CodeBlock's pure logic — the native analogue of the web component's
 * prop-to-render mapping (web/src/features/system/components/chatbot/CodeBlock.tsx): the
 * `language?.trim() || 'text'` fallback, the verbatim body, and the two reachable render states (a Content
 * block, or — for a blank body — an Empty state). Also pins the surface registration identifiers and the
 * `t(key, default)` resolver used for the native-only empty hint. Runs in the :android:testReleaseUnitTest
 * gate; the on-device render + accessibility live in CodeBlockUiTest.
 */
class CodeBlockModelTest {
    // ── Language tag fallback (web `language?.trim() || 'text'`) ──────────────────

    @Test
    fun nullLanguageFallsBackToText() {
        assertEquals(DEFAULT_LANGUAGE_LABEL, CodeBlockModel.languageLabel(null))
        assertEquals("text", CodeBlockModel.languageLabel(null))
    }

    @Test
    fun blankLanguageFallsBackToText() {
        // JS `|| 'text'` treats an empty / whitespace-only (after trim) hint as falsy.
        assertEquals("text", CodeBlockModel.languageLabel(""))
        assertEquals("text", CodeBlockModel.languageLabel("   "))
        assertEquals("text", CodeBlockModel.languageLabel("\n\t "))
    }

    @Test
    fun languageHintIsTrimmed() {
        assertEquals("go", CodeBlockModel.languageLabel("  go "))
        assertEquals("bash", CodeBlockModel.languageLabel("bash\n"))
    }

    @Test
    fun languageCaseIsPreservedVerbatim() {
        // The language id is not localized; the web uppercases it only via CSS, so the value keeps its case.
        assertEquals("TS", CodeBlockModel.languageLabel("TS"))
        assertEquals("TSX", CodeBlockModel.languageLabel("TSX"))
    }

    // ── State classification (Content vs Empty) ──────────────────────────────────

    @Test
    fun blankBodyProducesEmptyStateCarryingTheLabel() {
        assertEquals(CodeBlockState.Empty("text"), CodeBlockModel.stateFor(null, ""))
        assertEquals(CodeBlockState.Empty("go"), CodeBlockModel.stateFor("go", "   \n\t "))
    }

    @Test
    fun nonBlankBodyProducesContentWithVerbatimCode() {
        val state = CodeBlockModel.stateFor("ts", "const x = 1")
        assertEquals(CodeBlockState.Content(languageLabel = "ts", code = "const x = 1"), state)
    }

    @Test
    fun contentPreservesNewlinesAndLeadingWhitespace() {
        // Web `<code>{children ?? text}` shows the already-escaped source untouched; nothing is trimmed.
        val code = "func main() {\n    println(\"hi\")\n}"
        val state = CodeBlockModel.stateFor("go", code) as CodeBlockState.Content
        assertEquals(code, state.code)
    }

    @Test
    fun stateForResolvesTheLabelInBothBranches() {
        assertEquals("text", CodeBlockModel.stateFor(null, "x").languageLabel)
        assertEquals("text", CodeBlockModel.stateFor("  ", "").languageLabel)
        assertEquals("rust", CodeBlockModel.stateFor("rust", "fn main(){}").languageLabel)
    }

    @Test
    fun emptyAndContentStatesAreDistinct() {
        val empty = CodeBlockModel.stateFor("ts", "")
        val content = CodeBlockModel.stateFor("ts", "x")
        assertNotEquals(empty, content)
        assertTrue(empty is CodeBlockState.Empty)
        assertTrue(content is CodeBlockState.Content)
    }

    @Test
    fun stateEqualityIsValueBased() {
        // Guards the data-class semantics the UI relies on for recomposition keys.
        assertEquals(CodeBlockState.Content("ts", "a"), CodeBlockState.Content("ts", "a"))
        assertNotEquals(CodeBlockState.Content("ts", "a"), CodeBlockState.Content("ts", "b"))
        assertEquals(CodeBlockState.Empty("text"), CodeBlockState.Empty("text"))
    }

    // ── Registration + defaults (web parity) ─────────────────────────────────────

    @Test
    fun registrationExposesStableIdAndSlug() {
        assertEquals("code-block", CodeBlockRegistration.ID)
        assertEquals("CodeBlock", CodeBlockRegistration.SLUG)
    }

    @Test
    fun defaultLanguageLabelIsText() {
        assertEquals("text", DEFAULT_LANGUAGE_LABEL)
    }

    // ── Empty-hint resolver (web `t(key, default)`) ──────────────────────────────

    @Test
    fun resolveOptionalReturnsCatalogValueWhenPresent() {
        val resolved = resolveOptional({ "Geen code" }, KEY_EMPTY_HINT, CodeBlockDefaults.EMPTY_HINT)
        assertEquals("Geen code", resolved)
    }

    @Test
    fun resolveOptionalFallsBackWhenAbsent() {
        val resolved = resolveOptional({ null }, KEY_EMPTY_HINT, CodeBlockDefaults.EMPTY_HINT)
        assertEquals(CodeBlockDefaults.EMPTY_HINT, resolved)
    }

    @Test
    fun resolveOptionalFallsBackWhenBlank() {
        val resolved = resolveOptional({ "   " }, KEY_EMPTY_HINT, CodeBlockDefaults.EMPTY_HINT)
        assertEquals(CodeBlockDefaults.EMPTY_HINT, resolved)
    }
}
