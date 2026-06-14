// The native Jetpack Compose + Material 3 Input shared surface — a parity port of
// web/src/components/ui/Input.tsx. The web surface is a labelled single-line text field: an optional label
// row (a tinted required `*` plus a field-level help affordance) sits above the box; the box carries an
// optional leading icon, an optional trailing suffix, a ghost prompt when empty, four sizes, and a disabled
// dim; and a single message line below shows — in strict precedence — a red validation error OR a muted hint.
//
// This native surface keeps that contract end to end. It reproduces every branch the web source draws — the
// labelled / unlabelled row, the required marker (whose "required" word is folded into the field's accessible
// name, never announced as the glyph), the optional help trigger, the leading icon, the trailing suffix, the
// ghost-prompt empty box, the four sizes, the disabled dim, and the three-way message slot (error / hint /
// none) selected by the pure [resolveSupporting] in InputModel.kt. The label row is laid out natively (label
// + required `*` + the shared component-library [HelpIcon]) above a Material [OutlinedTextField]; the field's
// invalid styling, the red supporting message, and the muted hint all flow from Material's `isError` +
// `supportingText` so the same red-border / red-text / muted-hint outcome is reached without hand-rolled
// color. The field is named for TalkBack via the pure [fieldAccessibleName] (label, plus the localized
// `form.required` word when required), mirroring how the web `<label for>` association names the input.
//
// It performs NO HTTP and binds NO data state holder (the web component fetches nothing; it has no hook at
// all). See InputModel.kt for the honesty rationale and why the generic loading / empty / stale / offline
// states do not apply to a presentational control — the `error` prop here is the field's own validation
// message, not a fetch failure. A one-shot PII-safe `view.opened` diagnostic (P1/S11) fires on first
// composition, carrying only the surface slug — never the typed value or the label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Input) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.input

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.ui.HelpIcon
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the input field — used by the instrumented per-state + a11y UI tests. */
const val INPUT_TEST_TAG: String = "input"

/**
 * Controlled input — the faithful port of the web `Input`. Renders the optional label row, the field at the
 * chosen [size] with its leading icon / trailing suffix / ghost prompt, and the error-or-hint message below,
 * reports edits through [onValueChange], and records the one-shot `view.opened` diagnostic on first
 * composition.
 *
 * @param value the controlled text value (web `value`).
 * @param onValueChange reports the edited text (web `onChange`).
 * @param label optional label shown above the field (web `label`).
 * @param help optional help text revealed by a `(?)` trigger beside the label (web `help`).
 * @param error optional validation message; shown red and marks the field invalid (web `error`).
 * @param hint optional muted helper line, shown only when there is no error (web `hint`).
 * @param leadingIcon optional decorative glyph inside the start of the field (web `icon`).
 * @param suffix optional trailing text inside the end of the field (web `suffix`).
 * @param ghost optional in-field ghost prompt shown when empty (the web ghost-text input attribute).
 * @param size visual size of the field text (web `size`, default md).
 * @param enabled whether the field is interactive (web `disabled` inverted).
 * @param readOnly whether the field shows its value without allowing edits (web `readOnly`).
 * @param required marks the field required: a tinted `*` and the localized required word in its a11y name.
 * @param singleLine whether the field is one line (web `<input>` is always single-line).
 * @param keyboardType the soft-keyboard type (web `type`, e.g. email / number / password).
 * @param visualTransformation masks the text, e.g. for a password field (web `type="password"`).
 * @param id explicit control id used to name the help affordance (web `id`).
 * @param logger the sanctioned redacting logger; defaults to the app's data container logger.
 */
@Composable
fun Input(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    help: String? = null,
    error: String? = null,
    hint: String? = null,
    leadingIcon: ImageVector? = null,
    suffix: String? = null,
    ghost: String? = null,
    size: InputSize = InputSize.Md,
    enabled: Boolean = true,
    readOnly: Boolean = false,
    required: Boolean = false,
    singleLine: Boolean = true,
    keyboardType: KeyboardType = KeyboardType.Text,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    id: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { InputDiagnostics.recordViewOpened(logger) }
    InputField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier,
        label = label,
        help = help,
        error = error,
        hint = hint,
        leadingIcon = leadingIcon,
        suffix = suffix,
        ghost = ghost,
        size = size,
        enabled = enabled,
        readOnly = readOnly,
        required = required,
        singleLine = singleLine,
        keyboardType = keyboardType,
        visualTransformation = visualTransformation,
        id = id,
    )
}

/**
 * Uncontrolled input — the native mirror of the React `defaultValue` input (a field with no `value` prop). It
 * remembers its own text across recomposition + configuration change, updates on edit, and still forwards the
 * new value to an optional [onValueChange] so a parent can observe it. Records the same one-shot `view.opened`
 * diagnostic via the controlled [Input] it delegates to.
 *
 * @param defaultValue the initial text (web `defaultValue`).
 */
@Composable
fun UncontrolledInput(
    modifier: Modifier = Modifier,
    defaultValue: String = "",
    label: String? = null,
    help: String? = null,
    error: String? = null,
    hint: String? = null,
    leadingIcon: ImageVector? = null,
    suffix: String? = null,
    ghost: String? = null,
    size: InputSize = InputSize.Md,
    enabled: Boolean = true,
    readOnly: Boolean = false,
    required: Boolean = false,
    singleLine: Boolean = true,
    keyboardType: KeyboardType = KeyboardType.Text,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    id: String? = null,
    onValueChange: (String) -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
) {
    var text by rememberSaveable { mutableStateOf(defaultValue) }
    Input(
        value = text,
        onValueChange = { next ->
            text = next
            onValueChange(next)
        },
        modifier = modifier,
        label = label,
        help = help,
        error = error,
        hint = hint,
        leadingIcon = leadingIcon,
        suffix = suffix,
        ghost = ghost,
        size = size,
        enabled = enabled,
        readOnly = readOnly,
        required = required,
        singleLine = singleLine,
        keyboardType = keyboardType,
        visualTransformation = visualTransformation,
        id = id,
        logger = logger,
    )
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point (no diagnostics, no data container). Lays out
 * the optional label row above a Material [OutlinedTextField], wiring the field's accessible name, invalid
 * styling, and the error-or-hint supporting message from the pure model so every web branch renders.
 */
@Composable
fun InputField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    help: String? = null,
    error: String? = null,
    hint: String? = null,
    leadingIcon: ImageVector? = null,
    suffix: String? = null,
    ghost: String? = null,
    size: InputSize = InputSize.Md,
    enabled: Boolean = true,
    readOnly: Boolean = false,
    required: Boolean = false,
    singleLine: Boolean = true,
    keyboardType: KeyboardType = KeyboardType.Text,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    id: String? = null,
) {
    val supporting = resolveSupporting(error, hint)
    val requiredWord = stringResource(R.string.translation_form_required)
    val accessibleName = fieldAccessibleName(label, required, requiredWord)
    val nameModifier =
        if (accessibleName != null) {
            Modifier.semantics { contentDescription = accessibleName }
        } else {
            Modifier
        }

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (label != null) {
            InputLabelRow(label = label, help = help, required = required, fieldId = helpFieldName(id, label))
        }
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .testTag(INPUT_TEST_TAG)
                    .then(nameModifier),
            textStyle = size.textStyle(),
            enabled = enabled,
            readOnly = readOnly,
            isError = supporting.isError,
            singleLine = singleLine,
            placeholder = ghost?.let { prompt -> { Text(prompt) } }, // parity:allow Material slot; field ghost text
            leadingIcon = leadingIcon?.let { glyph -> { Icon(glyph, contentDescription = null) } },
            trailingIcon = suffix?.let { text -> { Text(text, style = MaterialTheme.typography.bodyMedium) } },
            supportingText = supporting.text?.let { message -> { Text(message) } },
            keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
            visualTransformation = visualTransformation,
            shape = MaterialTheme.shapes.medium,
        )
    }
}

/**
 * The label row above the field — the native mirror of the web `<div className="flex items-center gap-1">`.
 * Shows the label, a tinted required `*` (decorative / cleared from a11y, as the web glyph is `aria-hidden`),
 * and the shared [HelpIcon] when [help] is present. The required information itself reaches a screen reader
 * through the field's accessible name, not this glyph.
 */
@Composable
private fun InputLabelRow(
    label: String,
    help: String?,
    required: Boolean,
    fieldId: String?,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (required) {
            Text(
                text = "*",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.clearAndSetSemantics {},
            )
        }
        if (help != null) {
            InputHelp(help = help, fieldId = fieldId)
        }
    }
}

/**
 * The field-level help affordance — the shared component-library [HelpIcon] (a `(?)` button revealing [help]
 * in a tooltip). Its accessible name is "Help for {field}" when the field has an id/label, else the generic
 * `help.tooltip.iconLabel`, mirroring the web `HelpIcon` aria-label resolution.
 */
@Composable
private fun InputHelp(
    help: String,
    fieldId: String?,
) {
    val contentDescription =
        if (fieldId != null) {
            stringResource(R.string.translation_a11y_helpFor, fieldId)
        } else {
            stringResource(R.string.translation_help_tooltip_iconLabel)
        }
    HelpIcon(text = help, contentDescription = contentDescription)
}

/** The body text style per [InputSize] (web text-xs / text-sm / text-base; auto follows the md baseline). */
@Composable
private fun InputSize.textStyle(): TextStyle =
    when (this) {
        InputSize.Sm -> MaterialTheme.typography.bodySmall
        InputSize.Md -> MaterialTheme.typography.bodyMedium
        InputSize.Lg -> MaterialTheme.typography.bodyLarge
        InputSize.Auto -> MaterialTheme.typography.bodyMedium
    }

// ── Previews (tooling-only; the sample strings are never shipped UI) ──────────────────────────────────────

private const val PREVIEW_LABEL = "Email"
private const val PREVIEW_HELP = "We only use this to send charge alerts."
private const val PREVIEW_HINT = "You can change this later in settings."
private const val PREVIEW_ERROR = "Enter a valid email address."
private const val PREVIEW_GHOST = "you@example.com"

@Preview(name = "Input · label + required + help + hint", showBackground = true)
@Composable
private fun InputLabelledPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        InputField(
            value = "",
            onValueChange = {},
            label = PREVIEW_LABEL,
            help = PREVIEW_HELP,
            hint = PREVIEW_HINT,
            ghost = PREVIEW_GHOST,
            required = true,
        )
    }
}

@Preview(name = "Input · error", showBackground = true)
@Composable
private fun InputErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        InputField(
            value = "not-an-email",
            onValueChange = {},
            label = PREVIEW_LABEL,
            error = PREVIEW_ERROR,
            hint = PREVIEW_HINT,
            required = true,
        )
    }
}

@Preview(name = "Input · leading icon + suffix", showBackground = true)
@Composable
private fun InputIconSuffixPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        InputField(
            value = "75",
            onValueChange = {},
            label = "Battery Capacity",
            leadingIcon = io.teslasync.android.components.ui.TeslaGlyphs.Edit,
            suffix = "kWh",
            keyboardType = KeyboardType.Decimal,
        )
    }
}

@Preview(name = "Input · disabled", showBackground = true)
@Composable
private fun InputDisabledPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        InputField(
            value = "read-only value",
            onValueChange = {},
            label = PREVIEW_LABEL,
            enabled = false,
        )
    }
}

@Preview(name = "Input · sizes sm / md / lg", showBackground = true)
@Composable
private fun InputSizesPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            InputField(value = "Small", onValueChange = {}, label = "Small", size = InputSize.Sm)
            InputField(value = "Medium", onValueChange = {}, label = "Medium", size = InputSize.Md)
            InputField(value = "Large", onValueChange = {}, label = "Large", size = InputSize.Lg)
        }
    }
}
