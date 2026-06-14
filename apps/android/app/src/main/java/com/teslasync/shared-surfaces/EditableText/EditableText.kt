// The native Jetpack Compose + Material 3 view for the EditableText shared surface — the parity port of the web
// inline-edit primitive (web/src/components/ui/EditableText.tsx). It binds the existing screen-reader announcer
// state holder (the `useAnnouncer` port, P1/S8) and reproduces, branch for branch, every state the web source
// renders: the default button-styled-as-text display, the caller-supplied `display` render prop, the empty
// value shown as muted ghost text (the web empty-value hint), the editor, the save-in-flight indicator (web
// `saving`),
// and the validation / save-failed error that keeps the editor open. All commit / validation / display logic
// flows through the pure [decideCommit] / [liveValidationError] / [resolveDisplayText] in EditableTextModel.kt,
// so this file is a thin render + effect layer.
//
// Data binding (P1/S8): the only data source the web component has is `useAnnouncer` (plus `useTranslation` and
// `useId`). It is reproduced 1:1 — the success announcement fires through the shared [Announcer] / [GlobalAnnouncer]
// (the `useAnnouncer` port), the four user-visible strings resolve through the P1/S10 catalog with
// `stringResource`, and the web `useId` (which only links the input to its error node via `aria-describedby`)
// has no analogue because Compose models the field↔error link natively through the `isError` flag plus the
// `error()` semantics property. The view performs NO HTTP — the async `onSave` is the parent's, and the saved
// `value` is handed in (ADR-002).
//
// Accessibility: the default display is one `Role.Button` whose accessible name is the required [ariaLabel]
// (web `aria-label` on the `<button>`), so TalkBack announces what is being edited rather than the visible
// text; the pencil is decorative. The editor input carries the same [ariaLabel] as its name and the error
// message through `error()` semantics (web `aria-invalid` + `aria-describedby`). The save indicator is a polite
// live region carrying the localized "Saving…" text (web `role="status"`), and it collapses to a static label
// under the reduced-motion preference (P1/S9) so the only animation the surface has is opt-out-able. Web
// click / double-click / F2 / Enter / Space all collapse to the platform-idiomatic single activation (tap /
// TalkBack double-tap) on touch, with hardware Enter→commit and Escape→cancel preserved for physical keyboards.
//
// A one-shot PII-safe `view.opened` diagnostic (P1/S11) fires on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/EditableText) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless editor + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.editabletext

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.sharedsurfaces.announcerregion.Announcer
import io.teslasync.android.sharedsurfaces.announcerregion.GlobalAnnouncer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.launch
import kotlin.coroutines.cancellation.CancellationException

// ── Test tags (stable hooks for EditableTextUiTest; inert at runtime; mirror the web data-testid values) ──
const val EDITABLE_TEXT_TRIGGER_TAG: String = "editable-text-trigger"
const val EDITABLE_TEXT_INPUT_TAG: String = "editable-text-input"
const val EDITABLE_TEXT_SPINNER_TAG: String = "editable-text-spinner"
const val EDITABLE_TEXT_ERROR_TAG: String = "editable-text-error"
const val EDITABLE_TEXT_DISPLAY_TAG: String = "editable-text-display"

/** Web `h-3.5 w-3.5` save indicator. */
private val SAVE_INDICATOR_SIZE = 16.dp

/** Web `border-2` stroke on the save indicator. */
private val SAVE_INDICATOR_STROKE = 2.dp

/**
 * Inline-edit primitive — the faithful, stateful port of the web `EditableText`. Records the one-shot PII-safe
 * `view.opened` diagnostic (P1/S11) on first composition, owns the transient edit state (editing / draft /
 * saving / error), and switches between the display ([display] render prop or the default button-styled-as-text)
 * and the [EditableTextEditor]. The trimmed draft commits on Enter / IME-done / blur and cancels on Escape; a
 * successful save fires a polite screen-reader announcement through [announcer] (the `useAnnouncer` port).
 *
 * @param value the currently-saved value; the starting point for each edit (web `value`).
 * @param onSave async commit of the trimmed next value; a thrown error keeps the editor open with the message
 *   (web `onSave: (next) => Promise<void>`).
 * @param ariaLabel the required accessible name for the field, already localized (web `ariaLabel`); used as the
 *   trigger's and the input's TalkBack name and interpolated into the success announcement.
 * @param validate optional per-keystroke + commit validator; returns null when valid or a localized message
 *   (web `validate`). Defaults to always-valid.
 * @param ghostText the empty-value display fallback AND the editor hint — the native name for the web
 *   empty-value hint prop. `null` ⇒ an empty value renders as an empty (but never broken) display.
 * @param maxLength optional hard cap on the editor's character count (web native `maxLength`).
 * @param variant [EditableTextVariant.Body] (default) or [EditableTextVariant.Heading] — display text size only.
 * @param disabled renders display-only with no edit affordance (web `disabled`).
 * @param announcer the screen-reader announcer the success message fires through; defaults to [GlobalAnnouncer].
 * @param logger the redacting logger the `view.opened` diagnostic routes through; defaults to the app container.
 * @param display optional render prop fully owning the display layout (e.g. a link + pencil); it receives an
 *   [EditableTextDisplayScope] and calls `onStartEdit` to enter edit mode (web `display`).
 */
@Composable
fun EditableText(
    value: String,
    onSave: suspend (String) -> Unit,
    ariaLabel: String,
    modifier: Modifier = Modifier,
    validate: (String) -> String? = { null },
    ghostText: String? = null,
    maxLength: Int? = null,
    variant: EditableTextVariant = EditableTextVariant.Body,
    disabled: Boolean = false,
    announcer: Announcer = GlobalAnnouncer,
    logger: Logger = LocalDataContainer.current.logger,
    display: (@Composable (EditableTextDisplayScope) -> Unit)? = null,
) {
    LaunchedEffect(Unit) { EditableTextDiagnostics.recordViewOpened(logger) }

    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val focusRequester = remember { FocusRequester() }

    var editing by rememberSaveable { mutableStateOf(false) }
    var draft by rememberSaveable { mutableStateOf(value) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val lastSubmitted = remember { mutableStateOf<String?>(null) }

    val emptyMessage = stringResource(R.string.translation_editableText_error_empty)
    val saveFailedMessage = stringResource(R.string.translation_editableText_error_saveFailed)
    val savingLabel = stringResource(R.string.translation_editableText_saving)

    // Re-sync the draft when the canonical value changes from outside while NOT editing (web useEffect that
    // leaves an in-flight draft alone).
    LaunchedEffect(value, editing) { if (!editing) draft = value }

    fun startEdit() {
        if (disabled) return
        draft = value
        error = null
        lastSubmitted.value = null
        editing = true
    }

    fun cancelEdit() {
        if (saving) return
        draft = value
        error = null
        editing = false
    }

    // Single commit path — web `commitDraft`. `saving` is set synchronously before the launch so a rapid
    // Enter-then-blur second call is rejected by the guard (the web `savingRef`).
    fun commit() {
        if (saving) return
        when (val decision = decideCommit(draft, value, lastSubmitted.value, emptyMessage, validate)) {
            CommitDecision.Exit -> {
                error = null
                editing = false
            }
            is CommitDecision.Invalid -> {
                error = decision.message
            }
            is CommitDecision.Save -> {
                saving = true
                error = null
                scope.launch {
                    try {
                        runCatching { onSave(decision.value) }
                            .onSuccess {
                                lastSubmitted.value = decision.value
                                editing = false
                                announcer.announce(
                                    context.getString(
                                        R.string.translation_editableText_announce_saved,
                                        ariaLabel,
                                    ),
                                )
                            }.onFailure { failure ->
                                if (failure is CancellationException) throw failure
                                error = failure.message?.takeIf(String::isNotBlank) ?: saveFailedMessage
                                // Keep focus on the input so the user can fix and retry (web queueMicrotask focus).
                                runCatching { focusRequester.requestFocus() }
                            }
                    } finally {
                        saving = false
                    }
                }
            }
        }
    }

    when {
        editing ->
            EditableTextEditor(
                draft = draft,
                ariaLabel = ariaLabel,
                saving = saving,
                errorMessage = error,
                savingLabel = savingLabel,
                modifier = modifier,
                ghostText = ghostText,
                variant = variant,
                focusRequester = focusRequester,
                onDraftChange = { next ->
                    val limited = if (maxLength != null) next.take(maxLength) else next
                    draft = limited
                    error = liveValidationError(limited, validate)
                },
                onCommit = { commit() },
                onCancel = { cancelEdit() },
                onBlur = { if (editing && !saving && error == null) commit() },
            )
        display != null ->
            Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
                display(EditableTextDisplayScope(value = value, onStartEdit = { startEdit() }, disabled = disabled))
            }
        else ->
            DefaultEditableDisplay(
                value = value,
                ariaLabel = ariaLabel,
                ghostText = ghostText,
                variant = variant,
                disabled = disabled,
                onStartEdit = { startEdit() },
                modifier = modifier,
            )
    }
}

/**
 * Stateless editor renderer — the per-state entry point for previews and UI tests, and the body of the editing
 * branch. Draws the single-line input (carrying [ariaLabel] as its TalkBack name and [errorMessage] through
 * `error()` semantics), the in-flight [saving] indicator (a polite live region, static under reduced motion),
 * and the [errorMessage] line below. Autofocuses on entry (web `autoFocus`). Enter / IME-done commit, Escape
 * cancels, and a blur commits via [onBlur]; the caller owns the actual commit / cancel logic.
 *
 * @param draft the in-flight text (web `draft`).
 * @param ariaLabel the accessible name for the input (web input `aria-label`).
 * @param saving a save is in flight — disables the input and shows the indicator (web `saving`).
 * @param errorMessage the current error, or null — shown below and wired into the input's error semantics.
 * @param savingLabel the localized "Saving…" text voiced by the indicator (web `role="status"` label).
 * @param ghostText the editor hint shown when [draft] is empty — the native name for the web empty-value hint.
 * @param variant the editor text size, matched to the display (web `sizeClass`).
 * @param focusRequester the requester the editor autofocuses and the caller refocuses after a failed save.
 * @param onDraftChange invoked with each edited value (already length-capped by the caller).
 * @param onCommit commit the draft — Enter / IME-done (web Enter-to-save).
 * @param onCancel cancel the edit — Escape (web Escape-to-cancel).
 * @param onBlur the input lost focus — the caller decides whether to commit (web blur-to-save).
 */
@Composable
fun EditableTextEditor(
    draft: String,
    ariaLabel: String,
    saving: Boolean,
    errorMessage: String?,
    savingLabel: String,
    modifier: Modifier = Modifier,
    ghostText: String? = null,
    variant: EditableTextVariant = EditableTextVariant.Body,
    focusRequester: FocusRequester = remember { FocusRequester() },
    onDraftChange: (String) -> Unit = {},
    onCommit: () -> Unit = {},
    onCancel: () -> Unit = {},
    onBlur: () -> Unit = {},
) {
    var hadFocus by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { runCatching { focusRequester.requestFocus() } }

    Column(modifier = modifier) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            OutlinedTextField(
                value = draft,
                onValueChange = onDraftChange,
                modifier =
                    Modifier
                        .weight(1f)
                        .testTag(EDITABLE_TEXT_INPUT_TAG)
                        .focusRequester(focusRequester)
                        .onFocusChanged { state ->
                            val wasFocused = hadFocus
                            hadFocus = state.isFocused
                            if (wasFocused && !state.isFocused) onBlur()
                        }.onKeyEvent { event ->
                            if (event.type != KeyEventType.KeyDown) {
                                false
                            } else {
                                when (event.key) {
                                    Key.Enter, Key.NumPadEnter -> {
                                        onCommit()
                                        true
                                    }
                                    Key.Escape -> {
                                        onCancel()
                                        true
                                    }
                                    else -> false
                                }
                            }
                        }.semantics {
                            contentDescription = ariaLabel
                            if (errorMessage != null) error(errorMessage)
                        },
                enabled = !saving,
                singleLine = true,
                isError = errorMessage != null,
                textStyle = editorTextStyle(variant),
                placeholder = { if (ghostText != null) Text(ghostText) }, // parity:allow Material slot; ghost text, not a stub.
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { onCommit() }),
                shape = MaterialTheme.shapes.medium,
            )
            if (saving) SaveIndicator(savingLabel)
        }
        if (errorMessage != null) {
            ErrorText(
                errorMessage,
                modifier = Modifier.padding(top = Spacing.xs).testTag(EDITABLE_TEXT_ERROR_TAG),
            )
        }
    }
}

/**
 * The save-in-flight indicator — web `role="status"` spinner. A polite live region carrying the localized
 * [label] so TalkBack voices "Saving…" the moment it appears; the spinning indicator collapses to a static
 * caption under the reduced-motion preference (P1/S9) so the surface's only animation is opt-out-able.
 */
@Composable
private fun SaveIndicator(label: String) {
    if (rememberReducedMotion()) {
        Caption(
            label,
            modifier =
                Modifier
                    .testTag(EDITABLE_TEXT_SPINNER_TAG)
                    .semantics { liveRegion = LiveRegionMode.Polite },
        )
    } else {
        CircularProgressIndicator(
            modifier =
                Modifier
                    .size(SAVE_INDICATOR_SIZE)
                    .testTag(EDITABLE_TEXT_SPINNER_TAG)
                    .semantics {
                        contentDescription = label
                        liveRegion = LiveRegionMode.Polite
                    },
            strokeWidth = SAVE_INDICATOR_STROKE,
        )
    }
}

/**
 * The default display — web button-styled-as-text. One merged [Role.Button] whose accessible name is
 * [ariaLabel] (web `aria-label`, overriding the visible text for screen readers), entering edit mode on
 * activation when not [disabled]. The value (or the muted ghost fallback when empty) renders left, the
 * decorative pencil right. The visible text's own semantics are cleared so the button announces only its
 * [ariaLabel].
 */
@Composable
private fun DefaultEditableDisplay(
    value: String,
    ariaLabel: String,
    ghostText: String?,
    variant: EditableTextVariant,
    disabled: Boolean,
    onStartEdit: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val resolved = resolveDisplayText(value, ghostText)
    val textColor =
        if (resolved.isGhost) {
            MaterialTheme.colorScheme.onSurfaceVariant
        } else {
            MaterialTheme.colorScheme.onSurface
        }
    Row(
        modifier =
            modifier
                .clip(MaterialTheme.shapes.small)
                .then(
                    if (disabled) {
                        Modifier
                    } else {
                        Modifier.clickable(role = Role.Button, onClick = onStartEdit)
                    },
                ).semantics(mergeDescendants = true) { contentDescription = ariaLabel }
                .padding(horizontal = Spacing.xs, vertical = Spacing.xs)
                .testTag(EDITABLE_TEXT_TRIGGER_TAG),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        DisplayLabel(
            text = resolved.text,
            variant = variant,
            color = textColor,
            modifier = Modifier.clearAndSetSemantics { }.testTag(EDITABLE_TEXT_DISPLAY_TAG),
        )
        if (!disabled) {
            Icon(
                TeslaGlyphs.Edit,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** The display text at the [variant] size (web `sizeClass`), tinted [color] (muted for the ghost fallback). */
@Composable
private fun DisplayLabel(
    text: String,
    variant: EditableTextVariant,
    color: Color,
    modifier: Modifier = Modifier,
) {
    when (variant) {
        EditableTextVariant.Heading ->
            Heading(text, modifier = modifier, level = HeadingLevel.Panel, color = color, maxLines = 1)
        EditableTextVariant.Body ->
            BodyText(text, modifier = modifier, color = color, maxLines = 1)
    }
}

/** The editor input text style for [variant] (web `text-sm font-normal` / `text-base font-semibold`). */
@Composable
private fun editorTextStyle(variant: EditableTextVariant): TextStyle =
    when (variant) {
        EditableTextVariant.Heading -> MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold)
        EditableTextVariant.Body -> MaterialTheme.typography.bodyMedium
    }

// ── Previews — one per render branch (value / ghost / disabled display + editor normal / saving / error). ──

private const val PREVIEW_LABEL = "Rename geofence Home"

@Preview(name = "EditableText · display (value)", showBackground = true)
@Composable
private fun EditableTextDisplayValuePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DefaultEditableDisplay(
            value = "Home",
            ariaLabel = PREVIEW_LABEL,
            ghostText = "Unnamed",
            variant = EditableTextVariant.Body,
            disabled = false,
            onStartEdit = {},
        )
    }
}

@Preview(name = "EditableText · display (ghost / empty)", showBackground = true)
@Composable
private fun EditableTextDisplayGhostPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DefaultEditableDisplay(
            value = "",
            ariaLabel = PREVIEW_LABEL,
            ghostText = "Unnamed location",
            variant = EditableTextVariant.Heading,
            disabled = false,
            onStartEdit = {},
        )
    }
}

@Preview(name = "EditableText · display (disabled)", showBackground = true)
@Composable
private fun EditableTextDisplayDisabledPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DefaultEditableDisplay(
            value = "Read only",
            ariaLabel = PREVIEW_LABEL,
            ghostText = null,
            variant = EditableTextVariant.Body,
            disabled = true,
            onStartEdit = {},
        )
    }
}

@Preview(name = "EditableText · editor", showBackground = true)
@Composable
private fun EditableTextEditorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EditableTextEditor(
            draft = "Home",
            ariaLabel = PREVIEW_LABEL,
            saving = false,
            errorMessage = null,
            savingLabel = "Saving…",
            ghostText = "Name",
        )
    }
}

@Preview(name = "EditableText · editor (saving)", showBackground = true)
@Composable
private fun EditableTextEditorSavingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EditableTextEditor(
            draft = "Garage",
            ariaLabel = PREVIEW_LABEL,
            saving = true,
            errorMessage = null,
            savingLabel = "Saving…",
        )
    }
}

@Preview(name = "EditableText · editor (error)", showBackground = true)
@Composable
private fun EditableTextEditorErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EditableTextEditor(
            draft = "",
            ariaLabel = PREVIEW_LABEL,
            saving = false,
            errorMessage = "Value cannot be empty",
            savingLabel = "Saving…",
        )
    }
}
