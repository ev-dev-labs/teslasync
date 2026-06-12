// Pure, framework-free model + projection for the CodeBlock feature view — the native analogue of the data
// the web component derives from its props before returning JSX
// (web/src/features/system/components/chatbot/CodeBlock.tsx). No Compose, no Android, no HTTP: every type
// here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin
// render layer.
//
// The web component is purely presentational — it binds no data hook (its only collaborators are the shared
// CopyButton and the cn() class helper). The single piece of logic it owns is the language tag fallback
// `language?.trim() || 'text'`; everything else is layout. This file reproduces that fallback in
// [CodeBlockModel.languageLabel] and classifies the body into the two reachable render states
// ([CodeBlockState]): a Content block carrying the verbatim code, or — because a caller may hand an empty
// body — an Empty state. There is no remote feed behind a CodeBlock, so there is no loading / error / stale
// / offline lifecycle to model; inventing one would be drift, exactly as the sibling JsonFormatter surface
// documents.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/CodeBlock — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.codeblock

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object CodeBlockRegistration {
    /** Stable surface id. */
    const val ID: String = "code-block"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "CodeBlock"
}

/**
 * The web fallback language tag — `language?.trim() || 'text'`. Shown verbatim (uppercased by the render
 * boundary, mirroring the web `uppercase` style) when the markdown fence carries no language hint.
 */
const val DEFAULT_LANGUAGE_LABEL: String = "text"

/**
 * Native-only microcopy defaults. The web component renders an empty `<pre>` when handed an empty body; the
 * native surface shows a friendly empty state instead so the panel is never a blank box. The web source has
 * no i18n key for this (it has no empty state), so — like the sibling ByteSizeConverter hint — the text
 * resolves through the i18n facade by-name and falls back to this default when no catalog entry exists.
 */
object CodeBlockDefaults {
    /** Friendly empty-body hint (no catalog entry ⇒ this English default is used). */
    const val EMPTY_HINT: String = "No code to display"
}

/** Resource name for the empty-body hint (by-name; absent ⇒ [CodeBlockDefaults.EMPTY_HINT]). */
const val KEY_EMPTY_HINT: String = "translation_codeBlock_empty"

/**
 * The localized strings the composable renders — resolved once at the render boundary (the shared
 * CopyButton copy/copied labels from the P1/S10 catalog, the empty hint by-name with fallback) and handed
 * to the stateless content as a framework-free bundle so the view stays a thin render layer.
 */
data class CodeBlockStrings(
    val copyLabel: String,
    val copiedLabel: String,
    val emptyHint: String,
)

/**
 * The reduced render state of a CodeBlock. The two cases are mutually exclusive and both carry the resolved
 * [languageLabel] so the header (always present, mirroring the web) renders identically in either branch.
 */
sealed interface CodeBlockState {
    /** The fallback-resolved language tag (web `language?.trim() || 'text'`). */
    val languageLabel: String

    /** A non-empty snippet: the header plus the verbatim [code] in a scrollable monospace body. */
    data class Content(
        override val languageLabel: String,
        val code: String,
    ) : CodeBlockState

    /** A blank body: the header plus a friendly empty state (never a blank box). */
    data class Empty(
        override val languageLabel: String,
    ) : CodeBlockState
}

/**
 * Pure, side-effect-free reducer — the native port of the web component's prop-to-render mapping. Stateless
 * so it is fully covered by the off-device unit gate.
 */
object CodeBlockModel {
    /**
     * Reproduces the web `language?.trim() || 'text'` fallback: a trimmed non-empty hint is returned
     * verbatim (case preserved — the language id is not localized), otherwise [DEFAULT_LANGUAGE_LABEL].
     */
    fun languageLabel(language: String?): String = language?.trim()?.takeIf(String::isNotEmpty) ?: DEFAULT_LANGUAGE_LABEL

    /**
     * Classifies the props into a [CodeBlockState]: a blank body (web would render an empty `<pre>`) becomes
     * the friendly [CodeBlockState.Empty]; any other [text] is preserved verbatim — newlines, leading
     * whitespace and all — in [CodeBlockState.Content], exactly as the web `<code>{children ?? text}` shows
     * the already-escaped source.
     */
    fun stateFor(
        language: String?,
        text: String,
    ): CodeBlockState {
        val label = languageLabel(language)
        return if (text.isBlank()) {
            CodeBlockState.Empty(languageLabel = label)
        } else {
            CodeBlockState.Content(languageLabel = label, code = text)
        }
    }
}

/**
 * Reproduces i18next's `t(key, default)` against the native i18n facade: returns the [lookup] result for
 * [resourceName] when it resolves to a non-blank string, otherwise the [fallback] default. [lookup] is a
 * thin seam over the Android string catalog in production (an optional by-name resource read) and a map in
 * tests, so the resolve-or-fallback decision stays pure and unit-tested.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback
