// Compose render layer for the FlagEditDrawer modal/dialog surface — the native analogue of the JSX
// the web component returns (web/src/features/admin/components/feature-flags/FlagEditDrawer.tsx). It is
// a thin shell over the pure [FlagEditDrawerProjection] derivations (FlagEditDrawerModel.kt): a single
// controlled create/edit form for one typed feature flag — the flag-key field (read-only in edit mode,
// with the immutable-key note), the free-form JSON value editor with its live parse-error helper, and
// the required audit-reason field — plus the Cancel + Save actions (Save disables until the value
// parses AND the key + reason are non-blank, and flips to a spinner while a save is in flight). Every
// string resolves from the i18n catalog (P1/S10); spacing comes from the generated theme tokens
// (P1/S9). The view performs NO HTTP and binds NO store — the web component's only hook is
// `useTranslation`, and the assembled `{ key, value, reason }` write is handed back to the parent
// through [onSave] exactly as the web `onSave` prop is, the parent owning `useSetFlag` + the `saving`
// flag.
//
// Tier adaptation (declared, not silent): the web component renders inside the shared `Drawer` (a
// slide-in side panel with a dedicated footer slot for Cancel/Save). The P3 tier classifies this
// artifact as a modal/dialog surface ("overlay surface with focus trap + dismiss semantics"), so the
// native surface hosts the same form in the shared [Modal] shell (platform scrim, outside-tap +
// system-back dismiss, pane-title for TalkBack) and gates it on the host's `if (open)` composition —
// the Compose idiom for the web `open` prop, prescribed by the [Modal] KDoc and used by every sibling
// dialog. The web footer's Cancel/Save buttons become the content's trailing end-aligned action row,
// exactly as the sibling ConfirmDialog / FeedbackModal surfaces render theirs.
//
// Field-hint adaptation: the web fields carry in-field ghost example text (the key example, the JSON
// example, the reason prompt). The shared [Input] / [Textarea] wrappers expose a `hint` (supporting
// text below the field) rather than an in-field ghost slot, so those examples map to the field hint —
// the same localized copy, surfaced one line lower. The value editor's hint yields to its parse-error
// text when the JSON is empty/invalid (the wrapper renders error-or-hint), mirroring the web, where
// the parse error is the salient affordance.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/modals-dialogs/FlagEditDrawer) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed because the file's primary export is the `FlagEditDrawer`
// composable (matching the filename); the co-located [FlagEditDrawerStrings] carrier + test-tag holder
// are supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.flageditdrawer

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.Textarea
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonPrimitive

/** Test tags for the nodes the UI test selects (the web `data-testid` / field-role attributes). */
object FlagEditDrawerTestTags {
    const val ROOT: String = "flag-edit-drawer"
    const val KEY_FIELD: String = "flag-edit-key"
    const val VALUE_FIELD: String = "flag-edit-value"
    const val REASON_FIELD: String = "flag-edit-reason"
    const val IMMUTABLE_NOTE: String = "flag-edit-immutable"
    const val CANCEL: String = "flag-edit-cancel"
    const val SAVE: String = "flag-edit-save"
}

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10). Bundled into
 * one carrier so the stateless [FlagEditDrawerContent] takes plain strings and stays trivially
 * previewable + UI-testable. The two dynamic strings — the edit-mode title (interpolates the key) and
 * the invalid-JSON helper (interpolates the parser message) — are resolved at their call sites with
 * format arguments and are intentionally not carried here.
 */
data class FlagEditDrawerStrings(
    val createTitle: String,
    val close: String,
    val cancel: String,
    val save: String,
    val keyLabel: String,
    val keyHint: String,
    val keyImmutable: String,
    val valueLabel: String,
    val valueRequired: String,
    val reasonLabel: String,
    val reasonHint: String,
)

/** Resolves every static [FlagEditDrawerStrings] entry from the surface's i18n catalog keys (P1/S10). */
@Composable
fun rememberFlagEditDrawerStrings(): FlagEditDrawerStrings =
    FlagEditDrawerStrings(
        createTitle = stringResource(R.string.translation_admin_flags_drawer_createTitle),
        close = stringResource(R.string.translation_common_close),
        cancel = stringResource(R.string.translation_common_cancel),
        save = stringResource(R.string.translation_admin_flags_drawer_save),
        keyLabel = stringResource(R.string.translation_admin_flags_editor_keyLabel),
        keyHint = stringResource(R.string.translation_admin_flags_editor_keyPlaceholder), // parity:allow i18n key name
        keyImmutable = stringResource(R.string.translation_admin_flags_editor_keyImmutable),
        valueLabel = stringResource(R.string.translation_admin_flags_editor_valueLabel),
        valueRequired = stringResource(R.string.translation_admin_flags_editor_valueEmpty),
        reasonLabel = stringResource(R.string.translation_admin_flags_editor_reasonLabel),
        reasonHint = stringResource(R.string.translation_admin_flags_editor_reasonPlaceholder), // parity:allow i18n key name
    )

/**
 * Stateful entry point — the faithful 1:1 port of the web `FlagEditDrawer({ open, initial, saving,
 * onClose, onSave })`. Records the one-shot PII-safe `view.opened` diagnostic on first composition
 * (P1/S11), resolves the localized copy + the create-vs-edit title (web `editing ? editTitle :
 * createTitle`), and hosts the form in the shared [Modal]. The owning page gates composition (web
 * `open`); see the file header.
 *
 * @param initial the flag being edited, or `null` for "create new" mode (web `initial`).
 * @param saving whether a save is in flight — disables the controls + flips Save to a spinner (web
 *   `saving`).
 * @param onDismiss dismiss callback — invoked by the Cancel/close affordances (web `onClose`).
 * @param onSave receives the assembled, trimmed `{ key, value, reason }` write (web `onSave`); the
 *   parent forwards it to the shared `setFlag` mutation and flips `saving`.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun FlagEditDrawer(
    initial: FlagEditTarget?,
    saving: Boolean,
    onDismiss: () -> Unit,
    onSave: (FlagEditSubmission) -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordFlagEditDrawerOpened(logger) }
    val strings = rememberFlagEditDrawerStrings()
    val title =
        if (FlagEditDrawerProjection.isEditing(initial)) {
            stringResource(R.string.translation_admin_flags_drawer_editTitle, initial?.key ?: "")
        } else {
            strings.createTitle
        }
    Modal(
        onDismissRequest = onDismiss,
        modifier = modifier,
        title = title,
        accessibleName = title,
        closeLabel = strings.close,
    ) {
        FlagEditDrawerContent(
            initial = initial,
            saving = saving,
            strings = strings,
            onSave = onSave,
            onCancel = onDismiss,
        )
    }
}

/**
 * Stateless renderer + form-state owner — the unit/UI-test and preview entry point. Owns the ephemeral
 * draft (web `useState`), re-seeded whenever [initial] changes so re-opening on a different flag never
 * clobbers an unrelated row (web's `useEffect([open, initial])` re-seed). Each edit re-derives the
 * value parse via the pure [FlagEditDrawerProjection], maps it to the localized helper text, and gates
 * Save on the composite validity rule; the Save action hands the assembled [FlagEditSubmission] back
 * through [onSave]. Every control disables while [saving]; Save also shows a spinner.
 */
@Composable
fun FlagEditDrawerContent(
    initial: FlagEditTarget?,
    saving: Boolean,
    strings: FlagEditDrawerStrings,
    onSave: (FlagEditSubmission) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val editing = FlagEditDrawerProjection.isEditing(initial)
    var keyInput by remember(initial) { mutableStateOf(initial?.key ?: "") }
    var valueInput by remember(initial) { mutableStateOf(FlagEditDrawerProjection.defaultValueJson(initial)) }
    var reason by remember(initial) { mutableStateOf("") }

    val parse = remember(valueInput) { FlagEditDrawerProjection.parseValue(valueInput) }
    val valueError =
        when (parse) {
            FlagValueParse.Empty -> strings.valueRequired
            is FlagValueParse.Invalid ->
                stringResource(R.string.translation_admin_flags_editor_valueInvalid, parse.message)
            is FlagValueParse.Valid -> null
        }
    val canSave = FlagEditDrawerProjection.canSubmit(parse, keyInput, reason, saving)

    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(FlagEditDrawerTestTags.ROOT),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        GlassPanel(padding = PanelPadding.Md) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Input(
                    value = keyInput,
                    onValueChange = { keyInput = it },
                    modifier = Modifier.testTag(FlagEditDrawerTestTags.KEY_FIELD),
                    label = strings.keyLabel,
                    hint = if (editing) null else strings.keyHint,
                    enabled = !editing && !saving,
                    required = true,
                )
                if (editing) {
                    HelperText(
                        text = strings.keyImmutable,
                        modifier = Modifier.testTag(FlagEditDrawerTestTags.IMMUTABLE_NOTE),
                    )
                }
            }
        }

        GlassPanel(padding = PanelPadding.Md) {
            Textarea(
                value = valueInput,
                onValueChange = { valueInput = it },
                modifier = Modifier.testTag(FlagEditDrawerTestTags.VALUE_FIELD),
                label = strings.valueLabel,
                hint = VALUE_JSON_EXAMPLE,
                errorText = valueError,
                enabled = !saving,
                required = true,
                minLines = VALUE_MIN_LINES,
                maxLines = VALUE_MAX_LINES,
            )
        }

        GlassPanel(padding = PanelPadding.Md) {
            Input(
                value = reason,
                onValueChange = { reason = it },
                modifier = Modifier.testTag(FlagEditDrawerTestTags.REASON_FIELD),
                label = strings.reasonLabel,
                hint = strings.reasonHint,
                enabled = !saving,
                required = true,
            )
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm, alignment = Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Button(
                label = strings.cancel,
                onClick = onCancel,
                modifier = Modifier.testTag(FlagEditDrawerTestTags.CANCEL),
                variant = ButtonVariant.Secondary,
                enabled = !saving,
            )
            Button(
                label = strings.save,
                onClick = {
                    val current = parse
                    if (current is FlagValueParse.Valid &&
                        FlagEditDrawerProjection.canSubmit(current, keyInput, reason, saving)
                    ) {
                        onSave(FlagEditDrawerProjection.buildSubmission(keyInput, current.value, reason))
                    }
                },
                modifier = Modifier.testTag(FlagEditDrawerTestTags.SAVE),
                variant = ButtonVariant.Primary,
                enabled = canSave,
                loading = saving,
            )
        }
    }
}

/** Value editor row count (web `rows={8}`). */
private const val VALUE_MIN_LINES = 8

/** Upper bound so a long JSON value can grow before the editor scrolls internally. */
private const val VALUE_MAX_LINES = 14

/** The JSON-shape example shown as the value editor's hint (mirrors the web value field's in-field example). */
private const val VALUE_JSON_EXAMPLE = "{\n  \"enabled\": true\n}"

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val previewStrings =
    FlagEditDrawerStrings(
        createTitle = "Create flag",
        close = "Close",
        cancel = "Cancel",
        save = "Save flag",
        keyLabel = "Flag key",
        keyHint = "feature.dlq.replay_enabled",
        keyImmutable = "Flag keys are immutable once created. Delete + re-create to rename.",
        valueLabel = "Value (JSON)",
        valueRequired = "Value is required.",
        reasonLabel = "Reason",
        reasonHint = "Why this change? (logged in audit)",
    )

@Preview(name = "Create mode (empty value -> required helper)", showBackground = true, widthDp = 360)
@Composable
private fun FlagEditDrawerCreatePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FlagEditDrawerContent(
            initial = null,
            saving = false,
            strings = previewStrings,
            onSave = {},
            onCancel = {},
        )
    }
}

@Preview(name = "Edit mode (key locked, immutable note)", showBackground = true, widthDp = 360)
@Composable
private fun FlagEditDrawerEditPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FlagEditDrawerContent(
            initial = FlagEditTarget("feature.dlq.replay_enabled", JsonPrimitive(true)),
            saving = false,
            strings = previewStrings,
            onSave = {},
            onCancel = {},
        )
    }
}

@Preview(name = "Saving (controls disabled, Save spinner)", showBackground = true, widthDp = 360)
@Composable
private fun FlagEditDrawerSavingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FlagEditDrawerContent(
            initial = FlagEditTarget("feature.dlq.replay_enabled", JsonPrimitive(true)),
            saving = true,
            strings = previewStrings,
            onSave = {},
            onCancel = {},
        )
    }
}
