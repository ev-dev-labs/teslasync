// Pure, framework-free model + projection for the AlertMessageEditor feature view — the native analogue of
// everything the web component derives before it returns JSX
// (web/src/features/notifications/components/AlertMessageEditor.tsx). No Compose, no Android, no HTTP: every
// declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the composable stays a
// thin render layer over these pure functions.
//
// The web component is a per-rule notification-message-template editor. It composes an `include_title`
// checkbox, a multi-line template field with a `{{`-trigger autocomplete sourced from
// the backend message-token catalog, a "Pick a preset" Modal sourced from the preset catalog, and a live
// preview pane fed by `/alerts/message-preview`. This file owns the data derivations that sit behind those
// surfaces: the `{{key}}` token extraction (web `extractTemplateKeys`), the
// autocomplete filter + grouping (web token filter + autocomplete grouping), the
// op-validity preset filter (web `opValidPresets`), the preset tag set (web `presetTags`), the active-tag
// filter (web `filteredPresets`), the autocomplete cursor clamp (web `setAutocompleteCursor` effect), and the
// `{{`-trigger detect + token splice (web `handleTextareaChange` + the token-insert helper). Colors, glyphs and
// localized labels are resolved at the Compose boundary, never here.
//
// Domain vocabulary: the web names each `{{key}}` catalog entry after its brace syntax; this Kotlin port
// calls the concept a [TemplateToken] (an accurate term for a `{{...}}` template variable) so the surface
// vocabulary is clean and self-describing. The user-facing strings keep the web's original wording in the i18n
// catalog (P1/S10).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/AlertMessageEditor — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.alertmessageeditor

import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object AlertMessageEditorRegistration {
    /** Stable surface id. */
    const val ID: String = "alert-message-editor"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AlertMessageEditor"
}

/**
 * One insertable `{{key}}` template token — the native mirror of a web message-token catalog
 * entry (the web token catalog type). [key] is the bare token name (spliced as `{{key}}`), [label] the
 * human title, [group] the catalog section it lists under, and [description] / [example] optional detail.
 */
data class TemplateToken(
    val key: String,
    val label: String,
    val group: String,
    val description: String? = null,
    val example: String? = null,
)

/**
 * A curated message-template preset — the native mirror of a web `/alerts/message-presets` entry (web
 * `AlertMessagePreset`). [template] is the body applied verbatim; [tags] drive the gallery filter chips.
 */
data class MessagePreset(
    val id: String,
    val name: String,
    val template: String,
    val description: String? = null,
    val tags: List<String> = emptyList(),
)

/** The rendered preview the editor shows — the native mirror of the web `/alerts/message-preview` response. */
data class MessagePreview(
    val title: String,
    val body: String,
)

/**
 * The editor draft the preview + token-catalog endpoints read — the native mirror of the web
 * `AlertMessageEditorDraft`. The view only interprets [op] (for the preset op-validity filter); the remaining
 * fields are carried verbatim so the host can build the `/alerts/message-preview` request, exactly as the web
 * threads its `draft` into the preview body.
 */
data class MessageEditorDraft(
    val name: String? = null,
    val kind: String? = null,
    val signalName: String? = null,
    val op: String? = null,
    val severity: String? = null,
    val vehicleName: String? = null,
    val valueNum: Double? = null,
    val valueText: String? = null,
    val valueBool: Boolean? = null,
    val valueMin: Double? = null,
    val valueMax: Double? = null,
    val metricId: String? = null,
    val metricWindow: String? = null,
    val metricOp: String? = null,
    val metricThreshold: Double? = null,
)

/** A detected `{{`-trigger: the [index] of the opening `{{` and the [filter] typed after it. */
data class TokenTrigger(
    val index: Int,
    val filter: String,
)

/** The result of splicing a token into the template: the [text] to apply and the new [caret] offset. */
data class TokenInsertion(
    val text: String,
    val caret: Int,
)

/** One catalog group of tokens — preserves the received order so keyboard/scroll navigation is predictable. */
data class TokenGroup(
    val name: String,
    val tokens: List<TemplateToken>,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's data derivations.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object AlertMessageEditorProjection {
    // Mirrors the backend substituteRe in internal/alertmsg/formatter.go and the web brace-token regex.
    // Extracts the referenced token keys from a template so presets depending on tokens the current rule's op
    // does not populate can be hidden.
    private val tokenKeyRe = Regex("""\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*}}""")

    /** Extracts the referenced `{{key}}` token names from [template] (web `extractTemplateKeys`). */
    fun extractTemplateKeys(template: String): List<String> = tokenKeyRe.findAll(template).map { it.groupValues[1] }.toList()

    /**
     * Filters [all] tokens by the autocomplete [needle] (web token filter memo): a blank needle returns
     * the full list; otherwise a case-insensitive substring match on the key or the label.
     */
    fun filterTokens(
        all: List<TemplateToken>,
        needle: String,
    ): List<TemplateToken> {
        val trimmed = needle.trim().lowercase(Locale.ROOT)
        if (trimmed.isEmpty()) return all
        return all.filter { token ->
            token.key.lowercase(Locale.ROOT).contains(trimmed) || token.label.lowercase(Locale.ROOT).contains(trimmed)
        }
    }

    /** Groups [tokens] by their group, preserving first-seen order (web autocomplete grouping). */
    fun groupTokens(tokens: List<TemplateToken>): List<TokenGroup> {
        val byGroup = LinkedHashMap<String, MutableList<TemplateToken>>()
        for (token in tokens) byGroup.getOrPut(token.group) { mutableListOf() }.add(token)
        return byGroup.map { (name, list) -> TokenGroup(name, list) }
    }

    /** The set of token keys valid for the current rule (web `availableKeys`). */
    fun availableKeys(tokens: List<TemplateToken>): Set<String> = tokens.mapTo(LinkedHashSet()) { it.key }

    /**
     * Hides presets whose template references any token the current op does not populate (web `opValidPresets`).
     * While the token catalog is still loading, the catalog is empty for any reason, OR the rule has no op yet,
     * all presets are shown — better to over-show for one frame than flash an empty gallery.
     */
    fun opValidPresets(
        presets: List<MessagePreset>,
        availableKeys: Set<String>,
        tokensLoading: Boolean,
        hasOp: Boolean,
    ): List<MessagePreset> {
        if (tokensLoading || availableKeys.isEmpty() || !hasOp) return presets
        return presets.filter { preset -> extractTemplateKeys(preset.template).all { it in availableKeys } }
    }

    /** The sorted, de-duplicated tag set across [presets] (web `presetTags`). */
    fun presetTags(presets: List<MessagePreset>): List<String> = presets.flatMap { it.tags }.toSortedSet().toList()

    /** Filters [presets] to those carrying [tag]; a `null` tag is the "All" chip (web `filteredPresets`). */
    fun filterPresetsByTag(
        presets: List<MessagePreset>,
        tag: String?,
    ): List<MessagePreset> = if (tag == null) presets else presets.filter { tag in it.tags }

    /**
     * Clamps the autocomplete [cursor] into the current list (web `setAutocompleteCursor` re-clamp effect): an
     * empty list pins it to 0, otherwise it is held within `0..size-1`.
     */
    fun clampCursor(
        cursor: Int,
        size: Int,
    ): Int = if (size <= 0) 0 else cursor.coerceIn(0, size - 1)

    /**
     * Detects the active `{{`-trigger in [text] at [caret] (web `handleTextareaChange`): walks back from the
     * caret to the last unclosed `{{` and returns its index + the partial typed after it, or `null` when there
     * is no open trigger or the partial contains whitespace (the user is typing something other than a key).
     */
    fun detectTokenTrigger(
        text: String,
        caret: Int = text.length,
    ): TokenTrigger? {
        val bounded = caret.coerceIn(0, text.length)
        val upToCaret = text.substring(0, bounded)
        val openIdx = upToCaret.lastIndexOf("{{")
        val closeIdx = upToCaret.lastIndexOf("}}")
        if (openIdx == -1 || openIdx <= closeIdx) return null
        val partial = upToCaret.substring(openIdx + 2)
        return if (partial.any { it.isWhitespace() }) null else TokenTrigger(index = openIdx, filter = partial)
    }

    /**
     * Splices the canonical `{{key}}` form into [text], replacing the trigger window (web token-insert helper):
     * the text before [triggerIndex] is kept, `{{key}}` is injected (closing braces always added), and the
     * text from [caret] onward is appended. Returns the new text and the caret offset just past the insertion.
     */
    fun insertToken(
        text: String,
        triggerIndex: Int,
        key: String,
        caret: Int = text.length,
    ): TokenInsertion {
        val boundedTrigger = triggerIndex.coerceIn(0, text.length)
        val boundedCaret = caret.coerceIn(boundedTrigger, text.length)
        val before = text.substring(0, boundedTrigger)
        val after = text.substring(boundedCaret)
        val insertion = "{{$key}}"
        return TokenInsertion(text = before + insertion + after, caret = before.length + insertion.length)
    }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [AlertMessageEditorRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from
 * its first-composition effect.
 */
fun recordAlertMessageEditorOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to AlertMessageEditorRegistration.SLUG))
}
