// The native Jetpack Compose + Material 3 FormField shared surface — a parity port of
// web/src/components/forms/FormField.tsx. The web surface is the opinionated label + control + supporting-line
// wrapper reached for when a control is a custom composite that has no `label` prop of its own (a coordinate
// picker, a toggle-group row, a react-hook-form Controller). It lays out a required visible label (with an
// optional `*` whose `aria-label="required"` a screen reader reads in place of the glyph), the `children` control,
// and exactly ONE supporting line below it — a validation `error` (an `aria-live` alert) that takes precedence
// over a `hint`, or nothing when neither is set. The id wiring (web `useId`, overridable by `htmlFor`) gives the
// label its association target and the supporting line a stable id.
//
// This native surface keeps that contract end to end and renders every branch the web source draws — required vs
// optional, crossed with the error / hint / no-supporting-line outcomes — without ever hiding a region. It
// performs NO HTTP and binds NO state holder (the web component fetches nothing; see FormFieldModel.kt for the
// honesty rationale and why the generic loading/empty/error/stale/offline states do not apply to a controlled
// wrapper). The chrome is composed from the shared ui typography atoms (FieldLabelText / HelperText / ErrorText)
// so the field tracks light / dark / high-contrast themes; the only string it renders beyond its props (the
// required marker's accessible name) resolves through the i18n catalog (P1/S10, `translation_form_required`). The
// label + required marker are exposed to TalkBack as one merged announcement ("{label}, required"), the error
// line is an assertive live region (the web `role="alert"`), and a one-shot PII-safe `view.opened` diagnostic
// (P1/S11) fires on first composition. All derivation flows through the pure [classify] in FormFieldModel.kt.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/FormField) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located stateless content + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.formfield

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.FieldLabelText
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Input
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry point — the faithful port of the web `FormField`. Records the one-shot `view.opened` diagnostic
 * (P1/S11) on first composition, generates the stable fallback id (the web `useId()` value, kept across
 * recompositions by `rememberSaveable`), and renders the field. Performs no HTTP and binds no state holder (the
 * web component is controlled; its label, control, and messages are owned by the parent). [logger] defaults to the
 * process logger.
 *
 * @param label the required visible label (web `label`).
 * @param htmlFor the caller-supplied control id (web `htmlFor`); blank ⇒ the generated id is used.
 * @param hint the helper line shown when there is no error (web `hint`).
 * @param error the validation message; when set it replaces the hint and is announced as an alert (web `error`).
 * @param required whether the required marker + accessible "required" suffix are shown (web `required`).
 * @param content the field control (the faithful port of the web `children`).
 */
@Composable
fun FormField(
    label: String,
    modifier: Modifier = Modifier,
    htmlFor: String? = null,
    hint: String? = null,
    error: String? = null,
    required: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
    content: @Composable ColumnScope.() -> Unit,
) {
    LaunchedEffect(Unit) { FormFieldDiagnostics.recordViewOpened(logger) }
    val autoId = rememberSaveable { FormFieldIds.next() }
    FormFieldContent(
        label = label,
        autoId = autoId,
        modifier = modifier,
        htmlFor = htmlFor,
        hint = hint,
        error = error,
        required = required,
        content = content,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Classifies the props into a
 * [FormFieldRender] and draws the label (with the optional required marker), the [content] control, and the single
 * supporting line (the error, the hint, or nothing). Deterministic: the fallback [autoId] is supplied by the
 * caller, so no id is generated here.
 */
@Composable
fun FormFieldContent(
    label: String,
    autoId: String,
    modifier: Modifier = Modifier,
    htmlFor: String? = null,
    hint: String? = null,
    error: String? = null,
    required: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    val render =
        classify(
            FormFieldInput(htmlFor = htmlFor, autoId = autoId, hint = hint, error = error, required = required),
        )
    val requiredText = stringResource(R.string.translation_form_required)
    val accessibleLabel =
        fieldAccessibilityLabel(label = label, required = render.showRequiredMarker, requiredText = requiredText)

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        FormFieldLabel(label = label, showRequired = render.showRequiredMarker, accessibleLabel = accessibleLabel)
        content()
        FormFieldSupportingLine(render = render, hint = hint, error = error)
    }
}

/**
 * The label row: the visible [label] plus an optional tinted required asterisk. The whole row is merged into one
 * semantics node whose accessible name is [accessibleLabel] ("{label}, required" when required), so TalkBack reads
 * the requirement in place of the `*` glyph — the native mirror of the web asterisk's `aria-label="required"`.
 */
@Composable
private fun FormFieldLabel(
    label: String,
    showRequired: Boolean,
    accessibleLabel: String,
) {
    Row(
        modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = accessibleLabel },
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FieldLabelText(label)
        if (showRequired) {
            Text(
                text = "*",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.error,
            )
        }
    }
}

/**
 * The single supporting line beneath the control — an assertive [ErrorText] when a validation error is present
 * (the web `role="alert"`), else a muted [HelperText] hint, else nothing (web `error ? … : hint ? … : null`). Each
 * line carries the derived child id as a test tag (the native analogue of the web `id` on the `<p>`).
 */
@Composable
private fun FormFieldSupportingLine(
    render: FormFieldRender,
    hint: String?,
    error: String?,
) {
    when (render.support) {
        FormFieldSupport.Error ->
            if (error != null) {
                ErrorText(
                    text = error,
                    modifier =
                        Modifier
                            .testTag(render.errorId.orEmpty())
                            .semantics { liveRegion = LiveRegionMode.Assertive },
                )
            }
        FormFieldSupport.Hint ->
            if (hint != null) {
                HelperText(text = hint, modifier = Modifier.testTag(render.hintId.orEmpty()))
            }
        FormFieldSupport.None -> Unit
    }
}

// ── Previews — the required / optional axis crossed with the error / hint / no-supporting-line outcomes. ──────
// Each wraps a label-less shared Input as the custom control, exactly the case the web FormField exists for (a
// control with no `label` prop of its own), so the field supplies the label, required marker, and message.

private const val PREVIEW_AUTO_ID = "form-field-preview"
private const val PREVIEW_LABEL = "Signal"
private const val PREVIEW_HINT = "Pick the telemetry signal to alert on."
private const val PREVIEW_ERROR = "Select a signal."

@Preview(name = "FormField · required + hint", showBackground = true)
@Composable
private fun FormFieldRequiredHintPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FormFieldContent(label = PREVIEW_LABEL, autoId = PREVIEW_AUTO_ID, hint = PREVIEW_HINT, required = true) {
            Input(value = "Battery level", onValueChange = {})
        }
    }
}

@Preview(name = "FormField · required + error", showBackground = true)
@Composable
private fun FormFieldRequiredErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FormFieldContent(
            label = PREVIEW_LABEL,
            autoId = PREVIEW_AUTO_ID,
            hint = PREVIEW_HINT,
            error = PREVIEW_ERROR,
            required = true,
        ) {
            Input(value = "", onValueChange = {})
        }
    }
}

@Preview(name = "FormField · optional, no supporting line", showBackground = true)
@Composable
private fun FormFieldBarePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FormFieldContent(label = "Display name", autoId = PREVIEW_AUTO_ID) {
            Input(value = "Garage", onValueChange = {})
        }
    }
}
