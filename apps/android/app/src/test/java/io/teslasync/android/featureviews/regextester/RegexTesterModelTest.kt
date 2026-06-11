package io.teslasync.android.featureviews.regextester

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the RegexTester's pure logic — the native analogue of the web component's
 * `useMemo` match derivation and static `flagOptions`
 * (web/src/features/admin/components/devtools/tools/RegexTester.tsx). Runs in the
 * :app:testReleaseUnitTest gate; the on-device render + accessibility are covered by RegexTesterUiTest.
 */
class RegexTesterModelTest {
    // ── Empty-input guard (web `if (!pattern || !testStr) return []`) ─────────────────────────────

    @Test
    fun evaluateReturnsNothingWhenPatternIsEmpty() {
        assertTrue(RegexTesterModel.evaluate(pattern = "", flags = "g", testStr = "abc").isEmpty())
    }

    @Test
    fun evaluateReturnsNothingWhenTestStringIsEmpty() {
        assertTrue(RegexTesterModel.evaluate(pattern = "\\d+", flags = "g", testStr = "").isEmpty())
    }

    @Test
    fun evaluateReturnsNothingWhenBothEmpty() {
        assertTrue(RegexTesterModel.evaluate(pattern = "", flags = "g", testStr = "").isEmpty())
    }

    // ── Invalid pattern is swallowed (web `try { … } catch { return [] }`) ────────────────────────

    @Test
    fun evaluateSwallowsInvalidPatternAndReturnsNothing() {
        // An unbalanced group throws in the engine; the web shows zero matches with no error chrome.
        assertTrue(RegexTesterModel.evaluate(pattern = "(", flags = "g", testStr = "abc").isEmpty())
        assertTrue(RegexTesterModel.evaluate(pattern = "[a-", flags = "", testStr = "abc").isEmpty())
    }

    // ── Global matching (web `while ((m = re.exec()) !== null)`) ──────────────────────────────────

    @Test
    fun evaluateGlobalCollectsEveryMatchWithIndices() {
        val matches = RegexTesterModel.evaluate(pattern = "\\d+", flags = "g", testStr = "order 123 then 45")
        assertEquals(listOf(RegexMatch("123", 6), RegexMatch("45", 15)), matches)
    }

    @Test
    fun evaluateGlobalReturnsNothingWhenNoMatch() {
        assertTrue(RegexTesterModel.evaluate(pattern = "\\d+", flags = "g", testStr = "no digits here").isEmpty())
    }

    // ── Non-global matching (web single `re.exec`) ────────────────────────────────────────────────

    @Test
    fun evaluateNonGlobalReturnsOnlyTheFirstMatch() {
        val matches = RegexTesterModel.evaluate(pattern = "\\d+", flags = "", testStr = "order 123 then 45")
        assertEquals(listOf(RegexMatch("123", 6)), matches)
    }

    // ── Flag semantics ────────────────────────────────────────────────────────────────────────────

    @Test
    fun evaluateCaseInsensitiveFlagMatchesMixedCase() {
        val matches = RegexTesterModel.evaluate(pattern = "abc", flags = "gi", testStr = "abcABCAbc")
        assertEquals(listOf(RegexMatch("abc", 0), RegexMatch("ABC", 3), RegexMatch("Abc", 6)), matches)
    }

    @Test
    fun evaluateMultilineFlagAnchorsEachLine() {
        val multiline = RegexTesterModel.evaluate(pattern = "^\\d", flags = "gm", testStr = "1a\n2b\n3c")
        assertEquals(listOf(RegexMatch("1", 0), RegexMatch("2", 3), RegexMatch("3", 6)), multiline)

        // Without the multiline flag, `^` anchors only the start of the whole input.
        val singleLine = RegexTesterModel.evaluate(pattern = "^\\d", flags = "g", testStr = "1a\n2b\n3c")
        assertEquals(listOf(RegexMatch("1", 0)), singleLine)
    }

    // ── Zero-width matches stop the global loop (web `if (!m[0]) break`) ──────────────────────────

    @Test
    fun evaluateGlobalStopsAtFirstZeroWidthMatch() {
        // `a*` matches "aa" at 0, then the empty string at index 2 — the web records it and breaks.
        val matches = RegexTesterModel.evaluate(pattern = "a*", flags = "g", testStr = "aab")
        assertEquals(listOf(RegexMatch("aa", 0), RegexMatch("", 2)), matches)
    }

    @Test
    fun evaluateGlobalRecordsSingleZeroWidthMatchWithoutLooping() {
        // No 'a' to consume: the first match is zero-width at index 0, recorded once, then stop.
        val matches = RegexTesterModel.evaluate(pattern = "a*", flags = "g", testStr = "bbb")
        assertEquals(listOf(RegexMatch("", 0)), matches)
    }

    // ── Flag presets (web `flagOptions`) ──────────────────────────────────────────────────────────

    @Test
    fun flagOptionsMirrorTheWebPresetValuesInOrder() {
        assertEquals(
            listOf("g", "gi", "gm", "gim", ""),
            RegexTesterModel.FLAG_OPTIONS.map { it.value },
        )
    }

    @Test
    fun flagOptionsExposeTheVerbatimWebLabels() {
        assertEquals(
            listOf("g (global)", "gi (global, case-insensitive)", "gm (global, multiline)", "gim (all)", "No Flags"),
            RegexTesterModel.FLAG_OPTIONS.map { it.labelKey },
        )
    }

    @Test
    fun defaultFlagsSelectTheGlobalPreset() {
        assertEquals("g", RegexTesterModel.DEFAULT_FLAGS)
        assertTrue(RegexTesterModel.FLAG_OPTIONS.any { it.value == RegexTesterModel.DEFAULT_FLAGS })
    }

    // ── Registration identifiers (P1/S11) ─────────────────────────────────────────────────────────

    @Test
    fun registrationExposesStableIdAndSlug() {
        assertEquals("regex-tester", RegexTesterRegistration.ID)
        assertEquals("RegexTester", RegexTesterRegistration.SLUG)
    }
}
