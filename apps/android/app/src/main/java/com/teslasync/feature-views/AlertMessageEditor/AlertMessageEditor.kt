// The native Jetpack Compose + Material 3 AlertMessageEditor feature view — a parity port of
// web/src/features/notifications/components/AlertMessageEditor.tsx. The web component is a per-rule
// notification-message-template editor that composes: an `include_title` Checkbox (+ HelpIcon); a header row
// with the "Message Template" label, an insert-a-token hint, a HelpIcon, and a
// "Pick a preset" Button; a multi-line Textarea whose `{{`-trigger opens a token autocomplete sourced from
// the backend message-token catalog; a live preview pane (title + body) fed by `/alerts/message-preview` on a
// 150 ms debounce; and a preset-gallery Modal with tag filter chips + curated template cards sourced from
// `/alerts/message-presets`.
//
// This port keeps that contract end to end and performs NO HTTP. The parent owns the editor value (web
// `msgTemplate` / `includeTitle` + `onChange`) and the three data feeds, which the host supplies through the
// shared P1/S8 state-holder layer as [UiState]s (the cache-then-network projections of the token catalog, the
// preset gallery, and the live preview). Because those feeds carry the full lifecycle, this view renders every
// state each can produce — loading (skeleton/“Loading…”), content, empty, hard error with retry, and
// stale/offline “last known + retry” — without ever fetching. The 150 ms preview debounce is reproduced here
// with a keyed effect that calls [onPreviewRequested]; the host runs the round-trip and feeds [preview] back.
//
// The autocomplete is rendered as an inline suggestion panel beneath the field (the native idiom for a
// type-ahead) rather than a focus-grabbing popup, so the soft keyboard and editing focus are never stolen
// mid-token — the faithful native equivalent of the web `Popover`. All glyphs are authored 24dp vectors
// (Android bundles no lucide set, and a feature view may not expand the shared icon library), token/preset
// accents map to design tokens (never raw hex), and every string resolves through the i18n catalog (P1/S10).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AlertMessageEditor — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.alertmessageeditor

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.SkeletonLines
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Checkbox
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelpIcon
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.Textarea
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay
import java.util.Locale

/** The web `PREVIEW_DEBOUNCE_MS` — debounce before the live preview round-trip is requested. */
private const val PREVIEW_DEBOUNCE_MS: Long = 150L

/** Em dash shown for an unknown freshness age — the shared freshness "no value" fallback. */
internal const val EM_DASH: String = "\u2014"

/** Max height of the inline token suggestion list before it scrolls. */
private val SUGGESTIONS_MAX_HEIGHT: Dp = 240.dp

/** The debounced preview request the view hands back to the host; the host runs the round-trip. */
data class PreviewRequest(
    val template: String,
    val includeTitle: Boolean,
    val draft: MessageEditorDraft,
)

/**
 * The already-localized editor microcopy the composable reads from the i18n catalog (P1/S10) — the 16
 * `notifications.alertStudio.editor.*` strings the web component uses. The lifecycle-chrome strings (loading /
 * retry / offline / server-error / freshness / close) are resolved inline at the Compose boundary, so this
 * holder stays a thin content carrier.
 */
data class AlertMessageEditorStrings(
    val includeTitleLabel: String,
    val includeTitleHelp: String,
    val messageTemplateLabel: String,
    val messageTemplateHint: String,
    val messageTemplateHelp: String,
    val messageTemplateExample: String,
    val presetButton: String,
    val autocompleteLabel: String,
    val autocompleteEmpty: String,
    val previewLabel: String,
    val previewEmpty: String,
    val previewEmptyBody: String,
    val presetModalTitle: String,
    val presetModalIntro: String,
    val presetAllTag: String,
    val presetEmpty: String,
)

/**
 * Stateful entry point for the editor. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11) and
 * renders the editor over the host-owned feeds. The host owns the value + feeds (P1/S8) and supplies the
 * change callbacks, the debounced [onPreviewRequested] sink, and the per-feed retries; this view never
 * performs HTTP.
 *
 * @param template the current template body (web `msgTemplate`; `""` means "use default").
 * @param includeTitle the current include-title toggle (web `includeTitle`).
 * @param tokens the cache-then-network projection of the `{{key}}` token catalog (web token catalog query).
 * @param presets the cache-then-network projection of the preset gallery (web presets query).
 * @param preview the cache-then-network projection of the live preview (web preview mutation).
 * @param onTemplateChange notifies the parent when the user edits the body (web `onTemplateChange`).
 * @param onIncludeTitleChange notifies the parent when the user toggles include-title.
 * @param draft the rule draft used by the preview + token endpoints (web `draft`).
 * @param enabled disables all controls while a save mutation is in flight (web `disabled`, inverted).
 * @param onPreviewRequested debounced sink the host runs the `/message-preview` round-trip against.
 * @param onRetryTokens re-runs the token-catalog load (hard-error retry + stale auto-refresh).
 * @param onRetryPresets re-runs the preset-gallery load (hard-error retry + stale auto-refresh).
 * @param onRetryPreview re-runs the preview load (hard-error retry).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun AlertMessageEditor(
    template: String,
    includeTitle: Boolean,
    tokens: UiState<List<TemplateToken>>,
    presets: UiState<List<MessagePreset>>,
    preview: UiState<MessagePreview>,
    onTemplateChange: (String) -> Unit,
    onIncludeTitleChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    draft: MessageEditorDraft = MessageEditorDraft(),
    enabled: Boolean = true,
    onPreviewRequested: (PreviewRequest) -> Unit = {},
    onRetryTokens: () -> Unit = {},
    onRetryPresets: () -> Unit = {},
    onRetryPreview: () -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordAlertMessageEditorOpened(logger) }
    AlertMessageEditorContent(
        template = template,
        includeTitle = includeTitle,
        tokens = tokens,
        presets = presets,
        preview = preview,
        onTemplateChange = onTemplateChange,
        onIncludeTitleChange = onIncludeTitleChange,
        modifier = modifier,
        draft = draft,
        enabled = enabled,
        onPreviewRequested = onPreviewRequested,
        onRetryTokens = onRetryTokens,
        onRetryPresets = onRetryPresets,
        onRetryPreview = onRetryPreview,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Owns only ephemeral UI state
 * (autocomplete open/filter/trigger, preset-modal open, active tag); the value + feeds are passed in. Drives
 * the 150 ms preview debounce, the autocomplete trigger detection, and the stale auto-refresh for the token +
 * preset feeds. [locale] is reserved for locale-sensitive formatting; [strings] supplies the localized copy.
 */
@Composable
fun AlertMessageEditorContent(
    template: String,
    includeTitle: Boolean,
    tokens: UiState<List<TemplateToken>>,
    presets: UiState<List<MessagePreset>>,
    preview: UiState<MessagePreview>,
    onTemplateChange: (String) -> Unit,
    onIncludeTitleChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    draft: MessageEditorDraft = MessageEditorDraft(),
    enabled: Boolean = true,
    onPreviewRequested: (PreviewRequest) -> Unit = {},
    onRetryTokens: () -> Unit = {},
    onRetryPresets: () -> Unit = {},
    onRetryPreview: () -> Unit = {},
    @Suppress("UNUSED_PARAMETER") locale: Locale = Locale.getDefault(),
    strings: AlertMessageEditorStrings = rememberAlertMessageEditorStrings(),
) {
    var autocompleteOpen by remember { mutableStateOf(false) }
    var tokenFilter by remember { mutableStateOf("") }
    var triggerIndex by remember { mutableStateOf<Int?>(null) }
    var presetModalOpen by remember { mutableStateOf(false) }
    var activeTag by remember { mutableStateOf<String?>(null) }

    // Debounced live-preview request — the web 150 ms effect keyed on template + include-title + draft.
    LaunchedEffect(template, includeTitle, draft) {
        delay(PREVIEW_DEBOUNCE_MS)
        onPreviewRequested(PreviewRequest(template, includeTitle, draft))
    }
    // Stale (non-error) catalogs auto-refresh — the shared "last known + retry" freshness contract.
    LaunchedEffect(tokens.stale, tokens.refreshing, tokens.hasError) {
        if (tokens.stale && !tokens.refreshing && !tokens.hasError) onRetryTokens()
    }
    LaunchedEffect(presets.stale, presets.refreshing, presets.hasError) {
        if (presets.stale && !presets.refreshing && !presets.hasError) onRetryPresets()
    }

    val tokenList = tokens.data ?: emptyList()
    val presetList = presets.data ?: emptyList()
    val availableKeys = remember(tokenList) { AlertMessageEditorProjection.availableKeys(tokenList) }
    val filteredTokens = remember(tokenList, tokenFilter) { AlertMessageEditorProjection.filterTokens(tokenList, tokenFilter) }
    val tokenGroups = remember(filteredTokens) { AlertMessageEditorProjection.groupTokens(filteredTokens) }
    val opValidPresets =
        remember(presetList, availableKeys, tokens.isLoading, draft.op) {
            AlertMessageEditorProjection.opValidPresets(
                presets = presetList,
                availableKeys = availableKeys,
                tokensLoading = tokens.isLoading,
                hasOp = !draft.op.isNullOrBlank(),
            )
        }
    val presetTags = remember(opValidPresets) { AlertMessageEditorProjection.presetTags(opValidPresets) }
    val visiblePresets = remember(opValidPresets, activeTag) { AlertMessageEditorProjection.filterPresetsByTag(opValidPresets, activeTag) }
    // Drop a now-empty tag selection back to "All" so the gallery never strands on an empty filter.
    LaunchedEffect(presetTags, activeTag) {
        if (activeTag != null && activeTag !in presetTags) activeTag = null
    }

    val onTemplateEdited: (String) -> Unit = { next ->
        onTemplateChange(next)
        val trigger = AlertMessageEditorProjection.detectTokenTrigger(next)
        if (trigger != null) {
            autocompleteOpen = true
            triggerIndex = trigger.index
            tokenFilter = trigger.filter
        } else {
            autocompleteOpen = false
            triggerIndex = null
            tokenFilter = ""
        }
    }
    val onTokenSelected: (TemplateToken) -> Unit = { token ->
        val idx = triggerIndex
        if (idx != null) {
            val result = AlertMessageEditorProjection.insertToken(template, idx, token.key)
            onTemplateChange(result.text)
        }
        autocompleteOpen = false
        triggerIndex = null
        tokenFilter = ""
    }

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        IncludeTitleRow(includeTitle = includeTitle, onIncludeTitleChange = onIncludeTitleChange, enabled = enabled, strings = strings)
        TemplateHeaderRow(enabled = enabled, strings = strings, onPickPreset = { presetModalOpen = true })
        TemplateField(
            template = template,
            enabled = enabled,
            autocompleteOpen = autocompleteOpen,
            tokens = tokens,
            tokenGroups = tokenGroups,
            strings = strings,
            onTemplateEdited = onTemplateEdited,
            onTokenSelected = onTokenSelected,
            onRetryTokens = onRetryTokens,
        )
        PreviewPanel(preview = preview, includeTitle = includeTitle, strings = strings, onRetryPreview = onRetryPreview)
    }

    if (presetModalOpen) {
        PresetGalleryModal(
            presets = presets,
            visiblePresets = visiblePresets,
            tags = presetTags,
            activeTag = activeTag,
            strings = strings,
            onTagChange = { activeTag = it },
            onApply = { preset ->
                onTemplateChange(preset.template)
                presetModalOpen = false
            },
            onClose = { presetModalOpen = false },
            onRetryPresets = onRetryPresets,
        )
    }
}

/** The include-title Checkbox + its HelpIcon (web include-title row). The whole label row is one tap target. */
@Composable
private fun IncludeTitleRow(
    includeTitle: Boolean,
    onIncludeTitleChange: (Boolean) -> Unit,
    enabled: Boolean,
    strings: AlertMessageEditorStrings,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Checkbox(
            checked = includeTitle,
            onCheckedChange = if (enabled) onIncludeTitleChange else null,
            label = strings.includeTitleLabel,
            enabled = enabled,
        )
        HelpIcon(text = strings.includeTitleHelp, contentDescription = strings.includeTitleLabel)
    }
}

/** The label + hint + HelpIcon on the left and the "Pick a preset" Button on the right (web header row). */
@Composable
private fun TemplateHeaderRow(
    enabled: Boolean,
    strings: AlertMessageEditorStrings,
    onPickPreset: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(
            modifier = Modifier.weight(1f),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Caption(strings.messageTemplateHint)
            HelpIcon(text = strings.messageTemplateHelp, contentDescription = strings.messageTemplateLabel)
        }
        Button(
            label = strings.presetButton,
            onClick = onPickPreset,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            enabled = enabled,
            leadingIcon = SparklesGlyph,
        )
    }
}

/** The multi-line Textarea + the inline token suggestion panel that the `{{`-trigger reveals. */
@Composable
private fun TemplateField(
    template: String,
    enabled: Boolean,
    autocompleteOpen: Boolean,
    tokens: UiState<List<TemplateToken>>,
    tokenGroups: List<TokenGroup>,
    strings: AlertMessageEditorStrings,
    onTemplateEdited: (String) -> Unit,
    onTokenSelected: (TemplateToken) -> Unit,
    onRetryTokens: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Textarea(
            value = template,
            onValueChange = onTemplateEdited,
            label = strings.messageTemplateLabel,
            hint = strings.messageTemplateExample,
            enabled = enabled,
            minLines = 3,
            maxLines = 6,
        )
        if (autocompleteOpen) {
            TokenSuggestions(
                tokens = tokens,
                tokenGroups = tokenGroups,
                strings = strings,
                onTokenSelected = onTokenSelected,
                onRetryTokens = onRetryTokens,
            )
        }
    }
}

/** Inline grouped suggestion list — the native analogue of the web token-autocomplete popover. */
@Composable
private fun TokenSuggestions(
    tokens: UiState<List<TemplateToken>>,
    tokenGroups: List<TokenGroup>,
    strings: AlertMessageEditorStrings,
    onTokenSelected: (TemplateToken) -> Unit,
    onRetryTokens: () -> Unit,
) {
    GlassPanel(padding = PanelPadding.Sm) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .heightIn(max = SUGGESTIONS_MAX_HEIGHT)
                    .verticalScroll(rememberScrollState())
                    .semantics { contentDescription = strings.autocompleteLabel },
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            when {
                tokens.isLoading && !tokens.hasData -> Caption(stringResource(R.string.translation_common_loading))
                tokens.isError && !tokens.hasData -> RegionError(onRetry = onRetryTokens)
                tokenGroups.isEmpty() -> Caption(strings.autocompleteEmpty)
                else -> {
                    if (tokens.stale || tokens.refreshing || tokens.hasError) FreshnessChip(tokens)
                    tokenGroups.forEach { group ->
                        Caption(group.name)
                        group.tokens.forEach { token -> TokenRow(token = token, onSelect = onTokenSelected) }
                    }
                }
            }
        }
    }
}

/** One suggestion row — the `{{key}}` code chip + the human label (web suggestion button). */
@Composable
private fun TokenRow(
    token: TemplateToken,
    onSelect: (TemplateToken) -> Unit,
) {
    Button(
        onClick = { onSelect(token) },
        modifier = Modifier.fillMaxWidth(),
        variant = ButtonVariant.Ghost,
        size = ButtonSize.Sm,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            CodeText("{{${token.key}}}")
            BodyText(token.label, modifier = Modifier.weight(1f), maxLines = 1)
        }
    }
}

/** The live preview pane — header (eye glyph + label + freshness) and the rendered title/body (web preview). */
@Composable
private fun PreviewPanel(
    preview: UiState<MessagePreview>,
    includeTitle: Boolean,
    strings: AlertMessageEditorStrings,
    onRetryPreview: () -> Unit,
) {
    GlassPanel(padding = PanelPadding.Sm) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Icon(TeslaGlyphs.Eye, contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Caption(strings.previewLabel)
            }
            if (preview.stale || preview.refreshing || preview.hasError) FreshnessChip(preview)
        }
        Spacer(Modifier.height(Spacing.xs))
        PreviewBody(preview = preview, includeTitle = includeTitle, strings = strings, onRetryPreview = onRetryPreview)
    }
}

/** The preview body branch — loading skeleton, hard-error retry, "start typing" empty, or the rendered text. */
@Composable
private fun PreviewBody(
    preview: UiState<MessagePreview>,
    includeTitle: Boolean,
    strings: AlertMessageEditorStrings,
    onRetryPreview: () -> Unit,
) {
    val data = preview.data
    when {
        preview.isLoading && data == null -> SkeletonLines(lines = 2)
        preview.isError && data == null -> RegionError(onRetry = onRetryPreview)
        data == null -> Caption(strings.previewEmpty)
        else ->
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                if (includeTitle && data.title.isNotBlank()) Subhead(data.title)
                if (data.body.isNotBlank()) BodyText(data.body) else Caption(strings.previewEmptyBody)
            }
    }
}

/** The preset-gallery Modal — intro, tag filter chips, and the curated template cards (web preset modal). */
@Composable
private fun PresetGalleryModal(
    presets: UiState<List<MessagePreset>>,
    visiblePresets: List<MessagePreset>,
    tags: List<String>,
    activeTag: String?,
    strings: AlertMessageEditorStrings,
    onTagChange: (String?) -> Unit,
    onApply: (MessagePreset) -> Unit,
    onClose: () -> Unit,
    onRetryPresets: () -> Unit,
) {
    Modal(
        onDismissRequest = onClose,
        title = strings.presetModalTitle,
        closeLabel = stringResource(R.string.translation_common_close),
    ) {
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            BodyText(strings.presetModalIntro, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (tags.isNotEmpty()) {
                PresetTagRow(tags = tags, activeTag = activeTag, allLabel = strings.presetAllTag, onTagChange = onTagChange)
            }
            when {
                presets.isLoading && !presets.hasData -> Caption(stringResource(R.string.translation_common_loading))
                presets.isError && !presets.hasData -> RegionError(onRetry = onRetryPresets)
                visiblePresets.isEmpty() -> EmptyState(message = strings.presetEmpty, icon = SparklesGlyph)
                else ->
                    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                        if (presets.stale || presets.refreshing || presets.hasError) FreshnessChip(presets)
                        visiblePresets.forEach { preset -> PresetCard(preset = preset, onApply = onApply) }
                    }
            }
        }
    }
}

/** The "All" + per-tag filter chips, horizontally scrollable (web preset tag chip row). */
@Composable
private fun PresetTagRow(
    tags: List<String>,
    activeTag: String?,
    allLabel: String,
    onTagChange: (String?) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        TagChip(label = allLabel, selected = activeTag == null, onClick = { onTagChange(null) })
        tags.forEach { tag -> TagChip(label = tag, selected = activeTag == tag, onClick = { onTagChange(tag) }) }
    }
}

/** One filter chip — a selected chip reads as a filled tonal button, an unselected one as outlined. */
@Composable
private fun TagChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Button(
        label = label,
        onClick = onClick,
        variant = if (selected) ButtonVariant.Secondary else ButtonVariant.Outline,
        size = ButtonSize.Sm,
    )
}

/** One curated preset card — tapping the whole card applies the template (web preset card button). */
@Composable
private fun PresetCard(
    preset: MessagePreset,
    onApply: (MessagePreset) -> Unit,
) {
    GlassPanel(
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable(role = Role.Button, onClickLabel = preset.name) { onApply(preset) },
        padding = PanelPadding.Md,
    ) {
        Subhead(preset.name)
        preset.description?.let { description -> Caption(description) }
        Spacer(Modifier.height(Spacing.xs))
        CodeText(preset.template)
        if (preset.tags.isNotEmpty()) {
            Spacer(Modifier.height(Spacing.xs))
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                preset.tags.forEach { tag -> Badge(tag, variant = BadgeVariant.Neutral) }
            }
        }
    }
}

/** A compact, accessible "offline / updating / last-updated" freshness chip for a [state]. */
@Composable
private fun FreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberEditorFreshnessFormatter(),
    )
}

/** Compact hard-error row with a retry affordance — the web `QueryError` equivalent for an inline region. */
@Composable
private fun RegionError(onRetry: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        ErrorText(stringResource(R.string.translation_error_serverError_message), modifier = Modifier.weight(1f))
        Button(
            label = stringResource(R.string.translation_common_retry),
            onClick = onRetry,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
        )
    }
}

/**
 * Builds the localized [AlertMessageEditorStrings] from the i18n catalog (P1/S10): the 16
 * `notifications.alertStudio.editor.*` keys the web component reads. Remembered against the resolved strings
 * so a locale change re-projects.
 */
@Composable
private fun rememberAlertMessageEditorStrings(): AlertMessageEditorStrings {
    val includeTitleLabel = stringResource(R.string.translation_notifications_alertStudio_editor_includeTitleLabel)
    val includeTitleHelp = stringResource(R.string.translation_notifications_alertStudio_editor_includeTitleHelp)
    val messageTemplateLabel = stringResource(R.string.translation_notifications_alertStudio_editor_messageTemplateLabel)
    val messageTemplateHint = stringResource(R.string.translation_notifications_alertStudio_editor_messageTemplateHint)
    val messageTemplateHelp = stringResource(R.string.translation_notifications_alertStudio_editor_messageTemplateHelp)
    val messageTemplateExample =
        stringResource(R.string.translation_notifications_alertStudio_editor_messageTemplatePlaceholder) // parity:allow web i18n key id
    val presetButton = stringResource(R.string.translation_notifications_alertStudio_editor_presetButton)
    val autocompleteLabel = stringResource(R.string.translation_notifications_alertStudio_editor_autocompleteLabel)
    val autocompleteEmpty = stringResource(R.string.translation_notifications_alertStudio_editor_autocompleteEmpty)
    val previewLabel = stringResource(R.string.translation_notifications_alertStudio_editor_previewLabel)
    val previewEmpty = stringResource(R.string.translation_notifications_alertStudio_editor_previewEmpty)
    val previewEmptyBody = stringResource(R.string.translation_notifications_alertStudio_editor_previewEmptyBody)
    val presetModalTitle = stringResource(R.string.translation_notifications_alertStudio_editor_presetModalTitle)
    val presetModalIntro = stringResource(R.string.translation_notifications_alertStudio_editor_presetModalIntro)
    val presetAllTag = stringResource(R.string.translation_notifications_alertStudio_editor_presetAllTag)
    val presetEmpty = stringResource(R.string.translation_notifications_alertStudio_editor_presetEmpty)
    return remember(includeTitleLabel, messageTemplateLabel, presetButton, previewLabel, presetModalTitle) {
        AlertMessageEditorStrings(
            includeTitleLabel = includeTitleLabel,
            includeTitleHelp = includeTitleHelp,
            messageTemplateLabel = messageTemplateLabel,
            messageTemplateHint = messageTemplateHint,
            messageTemplateHelp = messageTemplateHelp,
            messageTemplateExample = messageTemplateExample,
            presetButton = presetButton,
            autocompleteLabel = autocompleteLabel,
            autocompleteEmpty = autocompleteEmpty,
            previewLabel = previewLabel,
            previewEmpty = previewEmpty,
            previewEmptyBody = previewEmptyBody,
            presetModalTitle = presetModalTitle,
            presetModalIntro = presetModalIntro,
            presetAllTag = presetAllTag,
            presetEmpty = presetEmpty,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberEditorFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(age.value)
                is FreshnessAge.Minutes -> minutes.format(age.value)
                is FreshnessAge.Hours -> hours.format(age.value)
                is FreshnessAge.Days -> days.format(age.value)
                is FreshnessAge.Weeks -> weeks.format(age.value)
            }
        }
    }
}

// ── Local lucide glyph ───────────────────────────────────────────────────────────────────────────────────
// The web "Pick a preset" button shows the lucide `Sparkles` glyph. Android bundles no lucide set and a
// feature view may not expand the shared icon library, so it is authored here as a 24×24 stroked vector in the
// shared monochrome style — recolored at render time by the button's content color.

/** The web `Sparkles` (lucide) — a large four-point star with two small twinkles. */
val SparklesGlyph: ImageVector =
    sparklesVector {
        moveTo(12f, 3f)
        lineTo(13.6f, 8.4f)
        lineTo(19f, 10f)
        lineTo(13.6f, 11.6f)
        lineTo(12f, 17f)
        lineTo(10.4f, 11.6f)
        lineTo(5f, 10f)
        lineTo(10.4f, 8.4f)
        close()
        moveTo(18f, 16f)
        lineTo(18.7f, 18.3f)
        lineTo(21f, 19f)
        lineTo(18.7f, 19.7f)
        lineTo(18f, 22f)
        lineTo(17.3f, 19.7f)
        lineTo(15f, 19f)
        lineTo(17.3f, 18.3f)
        close()
    }

/** Builds a 24×24 round-capped stroked [ImageVector] in the shared monochrome icon style. */
private fun sparklesVector(build: PathBuilder.() -> Unit): ImageVector =
    ImageVector
        .Builder(
            name = "Sparkles",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ─────────────────────────────

private val PREVIEW_STRINGS =
    AlertMessageEditorStrings(
        includeTitleLabel = "Include title in notifications",
        includeTitleHelp = "When unchecked, Discord/Slack/Telegram/ntfy/webhook deliver only the body.",
        messageTemplateLabel = "Message Template",
        messageTemplateHint = "Type {{ to insert a token",
        messageTemplateHelp = "Per-rule body template. Reference live signals with {{BatteryLevel}}.",
        messageTemplateExample = "Battery at {{BatteryLevel}}% \u2014 leave blank for the smart default",
        presetButton = "Pick a preset",
        autocompleteLabel = "Suggestions",
        autocompleteEmpty = "No matching tokens",
        previewLabel = "Preview",
        previewEmpty = "Start typing to see a preview",
        previewEmptyBody = "(no body \u2014 title carries the alert)",
        presetModalTitle = "Message Presets",
        presetModalIntro = "Curated templates for common alert shapes.",
        presetAllTag = "All",
        presetEmpty = "No presets match this filter",
    )

private val PREVIEW_TOKENS =
    listOf(
        TemplateToken(key = "BatteryLevel", label = "Battery level (%)", group = "Battery"),
        TemplateToken(key = "VehicleName", label = "Vehicle name", group = "Vehicle"),
    )

private val PREVIEW_PRESETS =
    listOf(
        MessagePreset(
            id = "low-battery",
            name = "Low battery",
            template = "{{VehicleName}} battery is {{BatteryLevel}}%",
            description = "Warns when charge drops.",
            tags = listOf("battery"),
        ),
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun AlertMessageEditorContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AlertMessageEditorContent(
            template = "Battery at {{BatteryLevel}}%",
            includeTitle = true,
            tokens = UiState(UiPhase.Content, data = PREVIEW_TOKENS),
            presets = UiState(UiPhase.Content, data = PREVIEW_PRESETS),
            preview = UiState(UiPhase.Content, data = MessagePreview(title = "Low battery", body = "Model 3 battery is 18%")),
            onTemplateChange = {},
            onIncludeTitleChange = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Preview loading", showBackground = true)
@Composable
private fun AlertMessageEditorLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AlertMessageEditorContent(
            template = "",
            includeTitle = true,
            tokens = UiState(UiPhase.Loading),
            presets = UiState(UiPhase.Loading),
            preview = UiState(UiPhase.Loading),
            onTemplateChange = {},
            onIncludeTitleChange = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Preview error", showBackground = true)
@Composable
private fun AlertMessageEditorErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AlertMessageEditorContent(
            template = "Battery at {{BatteryLevel}}%",
            includeTitle = true,
            tokens = UiState(UiPhase.Content, data = PREVIEW_TOKENS),
            presets = UiState(UiPhase.Content, data = PREVIEW_PRESETS),
            preview = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onTemplateChange = {},
            onIncludeTitleChange = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Preview offline (cached)", showBackground = true)
@Composable
private fun AlertMessageEditorOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AlertMessageEditorContent(
            template = "Battery at {{BatteryLevel}}%",
            includeTitle = true,
            tokens = UiState(UiPhase.Content, data = PREVIEW_TOKENS),
            presets = UiState(UiPhase.Content, data = PREVIEW_PRESETS),
            preview =
                UiState(
                    phase = UiPhase.Content,
                    data = MessagePreview(title = "Low battery", body = "Model 3 battery is 18%"),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onTemplateChange = {},
            onIncludeTitleChange = {},
            strings = PREVIEW_STRINGS,
        )
    }
}
