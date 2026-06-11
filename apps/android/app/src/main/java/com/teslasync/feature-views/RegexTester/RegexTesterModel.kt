// Pure, framework-free model for the RegexTester feature view — the native analogue of the only
// derivation the web component performs before returning JSX
// (web/src/features/admin/components/devtools/tools/RegexTester.tsx). No Compose, no Android, no HTTP:
// every type here is unit-tested off-device in the :app:testReleaseUnitTest gate, so the composable
// stays a thin render layer over deterministic logic.
//
// The web tool is purely client-side and binds NO data hook (its only hook is `useTranslation`): the
// pattern, flags and test string are local `useState`, and the match list is a `useMemo` over them.
// There is therefore no loading / error / stale / offline data lifecycle to model — inventing one
// would be drift (honesty covenant §9). What the surface genuinely varies is the match result: the
// empty result (no input, no match, or an invalid pattern — the web silently swallows the `RegExp`
// throw and shows zero matches) and the populated result (one or more matches). [evaluate] reproduces
// that `useMemo` exactly, and [FLAG_OPTIONS] mirrors the static `flagOptions` array.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/RegexTester — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path — exactly as the sibling
// ToolCard / AlertDetailTimeline surfaces do. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.regextester

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object RegexTesterRegistration {
    /** Stable surface id. */
    const val ID: String = "regex-tester"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "RegexTester"
}

/**
 * One regex match — the matched text and its start index, the native analogue of the web result
 * record `{ match: m[0], index: m.index }`.
 */
data class RegexMatch(
    val match: String,
    val index: Int,
)

/**
 * One preset in the Flags dropdown — the native analogue of a web `flagOptions` entry
 * (`{ value, label }`). [labelKey] is the exact web label text; the view resolves it through the
 * shared i18n facade (P1/S10), reproducing i18next's key-as-fallback so the catalog-backed key (the
 * last option, "No Flags") localizes while the four literal flag-notation labels render verbatim —
 * exactly as the web does, since it wraps only the last label in `t()`.
 */
data class RegexFlagOption(
    val value: String,
    val labelKey: String,
)

/**
 * The pure logic behind the RegexTester surface: the match evaluation, the static flag presets, and
 * the verbatim web i18n keys. Holds no Compose/Android types so it runs in the off-device unit-test
 * gate.
 */
object RegexTesterModel {
    /** The flag preset selected on first render (web `useState('g')`). */
    const val DEFAULT_FLAGS: String = "g"

    private const val GLOBAL_FLAG: Char = 'g'
    private const val IGNORE_CASE_FLAG: Char = 'i'
    private const val MULTILINE_FLAG: Char = 'm'

    // ── Web i18n keys (resolved at the render boundary via the P1/S10 facade) ─────────────────────

    /** Card title — web `t('Regex Tester')`. */
    const val KEY_TITLE: String = "Regex Tester"

    /** Card description — web `t('Regex Tester Desc')`. */
    const val KEY_DESCRIPTION: String = "Regex Tester Desc"

    /** Pattern field label — web `t('Pattern')`. */
    const val KEY_PATTERN: String = "Pattern"

    /** Flags field label — web `t('Flags')`. */
    const val KEY_FLAGS: String = "Flags"

    /** Test-string field label — web `t('Test String')`. */
    const val KEY_TEST_STRING: String = "Test String"

    /** Test-string ghost-prompt key — the web textarea's `t()` hint key (its verbatim value below). */
    const val KEY_TEST_STRING_HINT: String = "Test String Placeholder" // parity:allow verbatim web i18next key from RegexTester.tsx

    /** Match-count noun — web `t('Matches')`. */
    const val KEY_MATCHES: String = "Matches"

    /** Per-match index prefix — web `t('At Index')`. */
    const val KEY_AT_INDEX: String = "At Index"

    /** The empty-flags preset label — web `t('No Flags')`. */
    const val KEY_NO_FLAGS: String = "No Flags"

    /** The pattern field's ghost-prompt example — the web `\d+` hint shown inside the input. */
    const val PATTERN_HINT: String = "\\d+"

    /**
     * The five flag presets, in web order. The first four labels are literal flag notation (the web
     * does not translate them); the last is the catalog-backed [KEY_NO_FLAGS]. Values mirror the web
     * `value` field (`g`, `gi`, `gm`, `gim`, `""`).
     */
    val FLAG_OPTIONS: List<RegexFlagOption> =
        listOf(
            RegexFlagOption(value = "g", labelKey = "g (global)"),
            RegexFlagOption(value = "gi", labelKey = "gi (global, case-insensitive)"),
            RegexFlagOption(value = "gm", labelKey = "gm (global, multiline)"),
            RegexFlagOption(value = "gim", labelKey = "gim (all)"),
            RegexFlagOption(value = "", labelKey = KEY_NO_FLAGS),
        )

    /**
     * Reproduces the web `useMemo` exactly:
     *  * an empty [pattern] or [testStr] yields no matches (web `if (!pattern || !testStr) return []`);
     *  * an invalid pattern yields no matches (web `try { … } catch { return [] }` — the throw is
     *    swallowed, so the surface shows zero matches with no error chrome);
     *  * with the global flag (`g` in [flags]) every match is collected, stopping at the first
     *    zero-width match (web `if (!m[0]) break`) so a pattern like `a*` cannot loop forever;
     *  * without the global flag only the first match is returned (web single `re.exec`).
     */
    fun evaluate(
        pattern: String,
        flags: String,
        testStr: String,
    ): List<RegexMatch> {
        val regex =
            if (pattern.isEmpty() || testStr.isEmpty()) {
                null
            } else {
                runCatching { Regex(pattern, optionsFor(flags)) }.getOrNull()
            }
        return when {
            regex == null -> emptyList()
            flags.contains(GLOBAL_FLAG) -> findAll(regex, testStr)
            else -> regex.find(testStr)?.let { listOf(RegexMatch(it.value, it.range.first)) } ?: emptyList()
        }
    }

    /**
     * Collects every match the way the web global loop does: advance past each non-empty match, but
     * record-then-stop at the first zero-width match. Setting the cursor past the end on a zero-width
     * match lets the loop exit through its own guard, so the single `break` (the no-more-matches case)
     * is the only jump.
     */
    private fun findAll(
        regex: Regex,
        testStr: String,
    ): List<RegexMatch> {
        val results = ArrayList<RegexMatch>()
        var from = 0
        while (from <= testStr.length) {
            val match = regex.find(testStr, from) ?: break
            results.add(RegexMatch(match.value, match.range.first))
            from = if (match.value.isEmpty()) testStr.length + 1 else match.range.last + 1
        }
        return results
    }

    /**
     * Maps the JS flag string onto Kotlin [RegexOption]s: `i` → case-insensitive, `m` → multiline.
     * The `g` flag is not a Kotlin option (it selects all-vs-first matching, handled by [evaluate]).
     */
    private fun optionsFor(flags: String): Set<RegexOption> {
        val options = LinkedHashSet<RegexOption>()
        if (flags.contains(IGNORE_CASE_FLAG)) options.add(RegexOption.IGNORE_CASE)
        if (flags.contains(MULTILINE_FLAG)) options.add(RegexOption.MULTILINE)
        return options
    }
}
