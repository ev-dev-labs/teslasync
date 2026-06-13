// Compose render layer for the AcknowledgeAlertDialog modal/dialog surface — the native analogue of the JSX the web
// component returns (web/src/features/admin/components/AcknowledgeAlertDialog.tsx). It is a thin shell over the pure
// [AcknowledgeAlertProjection] derivations: a Material 3 modal hosting the optional alert-title subtitle, the optional
// note textarea (with its in-field prompt + the persistent "up to N characters" helper, which doubles as the field's
// error affordance once the trimmed note exceeds the limit), and the Cancel + Acknowledge actions. The Acknowledge
// action hands the *trimmed* note (possibly empty — the backend accepts a no-note ack) back to the parent through the
// [onSubmit] callback exactly as the web `onSubmit` prop is; the parent owns the mutation + cache wiring (web comment).
// While a submit is in flight both actions disable and the dialog refuses dismissal (web Modal `onClose` guard), the
// Acknowledge button surfaces an in-button busy hint (web prop doc), and the field disables. Every string is resolved
// from the i18n catalog (P1/S10); spacing + colours come from the generated theme tokens (P1/S9). The view performs NO
// HTTP and owns no store: the web component's only hooks are `useTranslation` and `useId`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/modals-dialogs/AcknowledgeAlertDialog) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed because the file's primary export is
// the `AcknowledgeAlertDialog` composable (matching the filename); the co-located [AcknowledgeAlertStrings] carrier is a
// supporting type.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.acknowledgealertdialog

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.stringResource
import io.teslasync.android.R
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.Textarea
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * The already-localized dialog microcopy the composable reads from the i18n catalog (P1/S10). Bundled into one carrier
 * so the stateless [AcknowledgeAlertDialogContent] takes plain strings and stays trivially previewable + UI-testable.
 *
 * @property notePrompt the short in-field guidance shown before the operator types (the web prompt text).
 * @property noteHint the persistent "up to N characters" helper that doubles as the over-limit error (web `noteHint`).
 */
data class AcknowledgeAlertStrings(
    val title: String,
    val close: String,
    val noteLabel: String,
    val notePrompt: String,
    val noteHint: String,
    val cancel: String,
    val submit: String,
)

/** Resolves every [AcknowledgeAlertStrings] entry from the surface-owned i18n catalog keys (P1/S10). */
@Composable
fun rememberAcknowledgeAlertStrings(): AcknowledgeAlertStrings =
    AcknowledgeAlertStrings(
        title = stringResource(R.string.translation_alerts_ack_dialogTitle),
        close = stringResource(R.string.translation_common_close),
        noteLabel = stringResource(R.string.translation_alerts_ack_noteLabel),
        notePrompt = stringResource(R.string.translation_alerts_ack_notePlaceholder), // parity:allow web i18n key name
        noteHint = stringResource(R.string.translation_alerts_ack_noteHint, AcknowledgeAlertProjection.NOTE_MAX),
        cancel = stringResource(R.string.translation_alerts_ack_cancel),
        submit = stringResource(R.string.translation_alerts_ack_submit),
    )

/**
 * Stateful entry point — the faithful 1:1 port of the web `AcknowledgeAlertDialog` props. Renders nothing while [open]
 * is false (the Compose idiom for the web `open` prop, so re-opening enters a fresh composition and clears any stale
 * note — web `useEffect([open])` reset), records the one-shot PII-safe `view.opened` diagnostic on open (P1/S11), and
 * hosts the modal form. The trimmed note is handed to [onSubmit]; [onClose] dismisses — but only while a submit is not
 * in flight (web Modal `onClose` guard). No HTTP, no store — the parent owns both callbacks exactly as the web
 * component's props are.
 *
 * @param open whether the dialog is shown (web `open`).
 * @param onClose dismiss callback fired by Cancel, the close affordance, and backdrop/back — gated while [submitting].
 * @param onSubmit receives the trimmed note (possibly empty) on a valid submit (web `onSubmit(trimmed)`).
 * @param submitting when true, disables Cancel/Acknowledge + the field and refuses dismissal (web `submitting`).
 * @param alertTitle the acknowledged alert's title, shown as a context subtitle when present (web `alertTitle`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun AcknowledgeAlertDialog(
    open: Boolean,
    onClose: () -> Unit,
    onSubmit: (String) -> Unit,
    modifier: Modifier = Modifier,
    submitting: Boolean = false,
    alertTitle: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    if (!open) return
    LaunchedEffect(Unit) { AcknowledgeAlertDialogDiagnostics.recordViewOpened(logger) }
    val strings = rememberAcknowledgeAlertStrings()
    Modal(
        onDismissRequest = { if (!submitting) onClose() },
        modifier = modifier,
        title = strings.title,
        accessibleName = strings.title,
        closeLabel = strings.close,
        dismissOnBackdrop = !submitting,
    ) {
        AcknowledgeAlertDialogContent(
            strings = strings,
            submitting = submitting,
            alertTitle = alertTitle,
            onSubmit = onSubmit,
            onCancel = onClose,
        )
    }
}

/**
 * Stateless renderer + form-state owner — the unit/UI-test and preview entry point. Owns the ephemeral note (web
 * `useState('')`), clamps each edit to the web `maxLength` bound, focuses the field on open (web `textareaRef.focus()`),
 * derives the over-limit state + submit enablement through the pure [AcknowledgeAlertProjection], and hands the trimmed
 * note back through [onSubmit]. Every control carries an accessible label; the Cancel + Acknowledge actions disable
 * while a submit is in flight and the Acknowledge action additionally disables while the note is over the limit.
 */
@Composable
fun AcknowledgeAlertDialogContent(
    strings: AcknowledgeAlertStrings,
    submitting: Boolean,
    alertTitle: String?,
    onSubmit: (String) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var note by remember { mutableStateOf("") }
    val noteFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { noteFocus.requestFocus() } }

    val tooLong = AcknowledgeAlertProjection.isTooLong(note)
    val canSubmit = AcknowledgeAlertProjection.canSubmit(note, submitting)

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (!alertTitle.isNullOrBlank()) {
            BodyText(alertTitle, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        Textarea(
            value = note,
            onValueChange = { note = AcknowledgeAlertProjection.clampNote(it) },
            modifier = Modifier.focusRequester(noteFocus),
            label = strings.noteLabel,
            hint = strings.notePrompt,
            errorText = if (tooLong) strings.noteHint else null,
            enabled = !submitting,
            minLines = NOTE_MIN_LINES,
        )

        HelperText(strings.noteHint)

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm, alignment = Alignment.End),
        ) {
            Button(
                label = strings.cancel,
                onClick = onCancel,
                variant = ButtonVariant.Ghost,
                enabled = !submitting,
            )
            Button(
                label = strings.submit,
                onClick = {
                    if (AcknowledgeAlertProjection.canSubmit(note, submitting)) {
                        onSubmit(AcknowledgeAlertProjection.resolveSubmitNote(note))
                    }
                },
                enabled = canSubmit,
                loading = submitting,
            )
        }
    }
}

/** Note textarea row count (web `rows={4}`). */
private const val NOTE_MIN_LINES = 4
