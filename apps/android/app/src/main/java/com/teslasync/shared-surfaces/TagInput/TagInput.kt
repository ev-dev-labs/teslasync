// The native Jetpack Compose + Material 3 TagInput shared surface — a parity port of
// web/src/components/forms/TagInput.tsx. The web component is a controlled free-text chip field: committed
// tags render as removable chips, Enter / a separator / paste commits the pending text, Backspace on the
// empty input removes the trailing chip, duplicates + empties are rejected (announced politely), `maxTags`
// caps the list (disabling the field), and `validateTag` surfaces a message under it. This native surface
// keeps that contract end to end and renders every state the prompt's matrix mandates without ever hiding a
// region: loading (the first seed fetch's skeleton), content (the chips + field), empty (the "No tags yet"
// hint + field — the web `value.length === 0` branch), a hard error with Retry, and a stale / offline
// freshness chip over a cached seed.
//
// It performs NO HTTP and binds the seed list only through the shared [TagListSource] folded through
// [TagInputViewModel] + the pure [TagInputProjection]; the composable resolves the i18n strings (P1/S10) and
// design tokens (P1/S9) and draws what the state returns, using the shared component library (ui
// GlassPanel/typography/StatusPill/IconButton, feedback QueryError/Skeleton, motion FadeIn). Screen-reader
// announcements (web `useAnnouncer`) are spoken through a merged polite live region; the current selection is
// exposed on the field as a `stateDescription` (web `aria-describedby` enumeration). The one-shot PII-safe
// `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/TagInput) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located stateless content + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")
@file:OptIn(ExperimentalLayoutApi::class)

package io.teslasync.android.sharedsurfaces.taginput

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.FieldLabelText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Localized strings the surface folds into its output. Built from `stringResource` at the render boundary
 * (tests pass a deterministic instance), keeping [TagInputProjection] pure and locale-stable. Every string
 * resolves through the P1/S10 catalog; the per-tag / per-count strings are resolved inline where their
 * argument is known. The error/empty recovery copy is owned by the shared QueryError component.
 *
 * @property fieldHint the editable ghost text shown when the field is empty (the web ghost-text prop).
 * @property limitReachedGhost the ghost text once the list is full (web `t('tagInput.maxReached')`).
 * @property helperHint the optional helper line below the field (web `hint` prop), or null.
 */
data class TagInputStrings(
    val label: String,
    val fieldHint: String,
    val limitReachedGhost: String,
    val helperHint: String?,
    val tagsNone: String,
    val resourceName: String,
    val loadingLabel: String,
    val staleLabel: String,
    val offlineLabel: String,
)

/**
 * Stateful entry point — the parity port of the web `TagInput(value, onChange, …)`. Binds the seed list via
 * [source] into a [TagInputViewModel], records the one-shot `view.opened` diagnostic (P1/S11) on first
 * composition, collects the folded [TagInputState], auto-refreshes a stale cache, and renders. The [source]
 * defaults to a static source seeded with [initialTags] (the controlled web case); a host that loads
 * persisted tags passes its own cache-then-network source instead.
 *
 * @param label the required visible + accessible field label (web `label`).
 * @param initialTags the seed list for the controlled case (web initial `value`).
 * @param onTagsChange notified with the next list on every add / remove (web `onChange`).
 * @param maxTags caps the list; once reached the field is disabled (web `maxTags`).
 * @param separators additional in-text commit characters (web `separators`, default comma).
 * @param lowercase lower-cases every tag before commit (web `lowercase`).
 * @param disabled disables the field + chip removal (web `disabled`).
 * @param fieldHint overrides the editable ghost text shown when empty; null uses the catalog default.
 * @param hint optional helper line shown below the field when there is no error (web `hint`).
 * @param validate optional per-tag validator (web `validateTag`); returns a message to reject, else null.
 */
@Composable
fun TagInput(
    label: String,
    modifier: Modifier = Modifier,
    initialTags: List<String> = emptyList(),
    onTagsChange: (List<String>) -> Unit = {},
    maxTags: Int? = null,
    separators: Set<Char> = setOf(','),
    lowercase: Boolean = false,
    disabled: Boolean = false,
    fieldHint: String? = null,
    hint: String? = null,
    validate: ((String) -> String?)? = null,
    source: TagListSource = staticTagListSource(initialTags),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val config =
        remember(maxTags, separators, lowercase, disabled) {
            TagInputConfig(maxTags = maxTags, separators = separators, lowercase = lowercase, disabled = disabled)
        }
    val viewModel: TagInputViewModel =
        viewModel(
            key = "${TagInputRegistration.SLUG}:$label",
            factory = TagInputViewModel.factory(source, config, validate, onTagsChange, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    // Stale TTL → auto-refresh (prompt's stale-state contract). Keyed on the freshness stamp so it fires at
    // most once per distinct cached seed, never in a loop.
    LaunchedEffect(state.stale, state.freshnessStamp) {
        if (state.stale) viewModel.refresh()
    }

    FadeIn(modifier = modifier) {
        TagInputContent(
            state = state,
            strings = rememberTagInputStrings(label = label, fieldHint = fieldHint, hint = hint),
            onPendingChange = viewModel::setPending,
            onCommit = viewModel::commitPending,
            onRemoveAt = viewModel::removeAt,
            onRemoveLast = viewModel::removeLast,
            onRetry = viewModel::retry,
        )
    }
}

/**
 * Stateless TagInput card — renders every branch the web source draws plus the seed's lifecycle: the loading
 * skeleton, the chips + editable field, the "No tags yet" empty hint, the classified error with retry, and a
 * stale / offline freshness chip over a cached seed. A merged polite live region speaks the latest
 * announcement. Hoisted out of the ViewModel so it is preview- and screenshot-testable for each state.
 */
@Composable
fun TagInputContent(
    state: TagInputState,
    strings: TagInputStrings,
    modifier: Modifier = Modifier,
    onPendingChange: (String) -> Unit = {},
    onCommit: () -> Unit = {},
    onRemoveAt: (Int) -> Unit = {},
    onRemoveLast: () -> Unit = {},
    onRetry: () -> Unit = {},
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        TagInputHeader(state = state, strings = strings)
        when (state.phase) {
            TagInputPhase.Loading -> TagInputLoading(loadingLabel = strings.loadingLabel)
            TagInputPhase.Error ->
                QueryError(
                    kind = TagInputProjection.queryErrorKind(state),
                    resourceName = strings.resourceName,
                    onRetry = onRetry,
                )
            TagInputPhase.Content, TagInputPhase.Empty ->
                TagInputField(
                    state = state,
                    strings = strings,
                    onPendingChange = onPendingChange,
                    onCommit = onCommit,
                    onRemoveAt = onRemoveAt,
                    onRemoveLast = onRemoveLast,
                )
        }
        TagAnnouncementRegion(state = state)
    }
}

@Composable
private fun TagInputHeader(
    state: TagInputState,
    strings: TagInputStrings,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FieldLabelText(strings.label, modifier = Modifier.weight(1f, fill = false))
        if (state.maxTags != null) {
            Caption("${state.count}/${state.maxTags}")
        }
        if (state.showFreshnessChip) {
            TagFreshnessChip(state = state, strings = strings)
        }
    }
}

@Composable
private fun TagFreshnessChip(
    state: TagInputState,
    strings: TagInputStrings,
) {
    if (state.offline) {
        StatusPill(text = strings.offlineLabel, tone = StatusTone.Danger)
    } else {
        StatusPill(text = strings.staleLabel, tone = StatusTone.Warning)
    }
}

@Composable
private fun TagInputField(
    state: TagInputState,
    strings: TagInputStrings,
    onPendingChange: (String) -> Unit,
    onCommit: () -> Unit,
    onRemoveAt: (Int) -> Unit,
    onRemoveLast: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(top = Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (state.tags.isEmpty()) {
            Caption(strings.tagsNone)
        } else {
            TagChips(tags = state.tags, disabled = state.disabled, onRemoveAt = onRemoveAt)
        }
        TagTextField(
            state = state,
            strings = strings,
            onPendingChange = onPendingChange,
            onCommit = onCommit,
            onRemoveLast = onRemoveLast,
        )
        TagSupportingText(state = state, strings = strings)
    }
}

@Composable
private fun TagChips(
    tags: List<String>,
    disabled: Boolean,
    onRemoveAt: (Int) -> Unit,
) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        tags.forEachIndexed { index, tag ->
            TagChip(tag = tag, enabled = !disabled, onRemove = { onRemoveAt(index) })
        }
    }
}

@Composable
private fun TagChip(
    tag: String,
    enabled: Boolean,
    onRemove: () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(Radius.pill),
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        Row(
            modifier = Modifier.padding(start = Spacing.sm, end = Spacing.xs, top = Spacing.xs, bottom = Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(tag, style = MaterialTheme.typography.labelMedium)
            IconButton(
                imageVector = TeslaGlyphs.Close,
                contentDescription = stringResource(R.string.translation_tagInput_removeTag, tag),
                onClick = onRemove,
                enabled = enabled,
                size = IconSize.Xs,
            )
        }
    }
}

@Composable
private fun TagTextField(
    state: TagInputState,
    strings: TagInputStrings,
    onPendingChange: (String) -> Unit,
    onCommit: () -> Unit,
    onRemoveLast: () -> Unit,
) {
    val enumeration =
        if (state.tags.isEmpty()) {
            strings.tagsNone
        } else {
            stringResource(R.string.translation_tagInput_tagsList, state.tags.joinToString(", "))
        }
    val ghost = if (state.atMax) strings.limitReachedGhost else strings.fieldHint
    OutlinedTextField(
        value = state.pending,
        onValueChange = onPendingChange,
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics { stateDescription = enumeration }
                .onKeyEvent { event -> handleFieldKey(event, state, onRemoveLast) },
        enabled = !state.inputDisabled,
        singleLine = true,
        isError = state.error != null,
        label = { Text(strings.label) },
        placeholder = { Text(ghost) }, // parity:allow Material slot name; renders the field ghost text, not a stub.
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { onCommit() }),
        shape = MaterialTheme.shapes.medium,
    )
}

/** Web `handleKeyDown` Backspace branch: a Backspace on the empty input removes the trailing chip. */
private fun handleFieldKey(
    event: KeyEvent,
    state: TagInputState,
    onRemoveLast: () -> Unit,
): Boolean {
    val backspaceOnEmpty =
        event.type == KeyEventType.KeyDown &&
            event.key == Key.Backspace &&
            state.pending.isEmpty() &&
            state.tags.isNotEmpty()
    return if (backspaceOnEmpty) {
        onRemoveLast()
        true
    } else {
        false
    }
}

@Composable
private fun TagSupportingText(
    state: TagInputState,
    strings: TagInputStrings,
) {
    when {
        state.error != null -> ErrorText(state.error)
        state.atMax && state.maxTags != null ->
            HelperText(stringResource(R.string.translation_tagInput_maxReachedHint, state.maxTags))
        strings.helperHint != null -> HelperText(strings.helperHint)
        else -> Unit
    }
}

@Composable
private fun TagInputLoading(loadingLabel: String) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(top = Spacing.sm)
                .semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(widthFraction = CHIPS_SKELETON_FRACTION, height = CHIP_SKELETON_HEIGHT, rounded = true)
        Skeleton(widthFraction = 1f, height = FIELD_SKELETON_HEIGHT)
    }
}

/** A visually-negligible polite live region that speaks the latest announcement (web `useAnnouncer`). */
@Composable
private fun TagAnnouncementRegion(state: TagInputState) {
    val announcement = state.announcement
    val text = if (announcement != null) announcementText(announcement) else ""
    Box(
        modifier =
            Modifier
                .size(1.dp)
                .semantics {
                    liveRegion = LiveRegionMode.Polite
                    contentDescription = text
                },
    )
}

/** Maps a structured [TagAnnouncement] to its localized P1/S10 string at the render boundary. */
@Composable
private fun announcementText(announcement: TagAnnouncement): String =
    when (announcement) {
        TagAnnouncement.AddedOne -> stringResource(R.string.translation_tagInput_addedOne)
        is TagAnnouncement.AddedMany -> stringResource(R.string.translation_tagInput_added, announcement.count)
        is TagAnnouncement.Duplicate -> stringResource(R.string.translation_tagInput_duplicate, announcement.tag)
        TagAnnouncement.MaxReached -> stringResource(R.string.translation_tagInput_maxReachedAnnounce)
        is TagAnnouncement.Removed -> stringResource(R.string.translation_tagInput_removed, announcement.tag)
    }

/** Builds the localized strings from the P1/S10 catalog; tests pass a deterministic instance. */
@Composable
private fun rememberTagInputStrings(
    label: String,
    fieldHint: String?,
    hint: String?,
): TagInputStrings {
    val defaultGhost = stringResource(R.string.translation_tagInput_placeholder) // parity:allow P1/S10 catalog key name
    return TagInputStrings(
        label = label,
        fieldHint = fieldHint ?: defaultGhost,
        limitReachedGhost = stringResource(R.string.translation_tagInput_maxReached),
        helperHint = hint,
        tagsNone = stringResource(R.string.translation_tagInput_tagsNone),
        resourceName = label,
        loadingLabel = stringResource(R.string.translation_a11y_loading),
        staleLabel = stringResource(R.string.translation_mqtt_stale),
        offlineLabel = stringResource(R.string.translation_common_offline),
    )
}

private const val CHIPS_SKELETON_FRACTION = 0.7f
private val CHIP_SKELETON_HEIGHT = 24.dp
private val FIELD_SKELETON_HEIGHT = 52.dp

// ── Previews — one per rendered state (loading / content / empty / validation error / at-max / disabled /
// stale / offline / hard error). ───────────────────────────────────────────────────────────────────────

private fun previewStrings(): TagInputStrings =
    TagInputStrings(
        label = "Tags",
        fieldHint = "Add a tag\u2026",
        limitReachedGhost = "Tag limit reached",
        helperHint = "Press Enter to add",
        tagsNone = "No tags yet",
        resourceName = "Tags",
        loadingLabel = "Loading",
        staleLabel = "Stale",
        offlineLabel = "Offline",
    )

private val PREVIEW_TAGS = listOf("commute", "weekend", "road-trip")

@Preview(name = "TagInput · loading", showBackground = true)
@Composable
private fun TagInputLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TagInputContent(state = TagInputState(phase = TagInputPhase.Loading), strings = previewStrings())
    }
}

@Preview(name = "TagInput · content", showBackground = true)
@Composable
private fun TagInputContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TagInputContent(
            state = TagInputState(phase = TagInputPhase.Content, tags = PREVIEW_TAGS, pending = "ci"),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "TagInput · empty", showBackground = true)
@Composable
private fun TagInputEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TagInputContent(state = TagInputState(phase = TagInputPhase.Empty), strings = previewStrings())
    }
}

@Preview(name = "TagInput · validation error", showBackground = true)
@Composable
private fun TagInputErrorTextPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TagInputContent(
            state =
                TagInputState(
                    phase = TagInputPhase.Content,
                    tags = PREVIEW_TAGS,
                    pending = "a",
                    error = "Tags must be at least 2 characters",
                ),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "TagInput · at max", showBackground = true)
@Composable
private fun TagInputAtMaxPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TagInputContent(
            state = TagInputState(phase = TagInputPhase.Content, tags = PREVIEW_TAGS, maxTags = 3),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "TagInput · disabled", showBackground = true)
@Composable
private fun TagInputDisabledPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TagInputContent(
            state = TagInputState(phase = TagInputPhase.Content, tags = PREVIEW_TAGS, disabled = true),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "TagInput · stale", showBackground = true)
@Composable
private fun TagInputStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TagInputContent(
            state = TagInputState(phase = TagInputPhase.Content, tags = PREVIEW_TAGS, stale = true, refreshing = true),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "TagInput · offline", showBackground = true)
@Composable
private fun TagInputOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TagInputContent(
            state =
                TagInputState(
                    phase = TagInputPhase.Content,
                    tags = PREVIEW_TAGS,
                    offline = true,
                    errorKind = ErrorKind.Network,
                ),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "TagInput · error", showBackground = true)
@Composable
private fun TagInputQueryErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TagInputContent(
            state =
                TagInputState(
                    phase = TagInputPhase.Error,
                    errorKind = ErrorKind.Http,
                    httpStatus = PREVIEW_SERVER_ERROR,
                ),
            strings = previewStrings(),
        )
    }
}

private const val PREVIEW_SERVER_ERROR = 503
