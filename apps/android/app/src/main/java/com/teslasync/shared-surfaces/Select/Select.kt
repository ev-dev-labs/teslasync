// The native Jetpack Compose + Material 3 Select shared surface — a parity port of
// web/src/components/ui/Select.tsx. The web surface is an accessible form `<select>` primitive: an optional
// label (with an optional HelpIcon beside it and a required asterisk) above a styled select that lists options
// (value + label + optional disabled), an optional empty-value entry shown when nothing is chosen, and an error
// paragraph (red, id `{id}-error`) or — only when there is no error — a hint paragraph (muted, id `{id}-hint`)
// beneath. It wires `aria-required` / `aria-invalid` / `aria-describedby`, scales with a `size` prop
// (sm / md / lg / auto), dims when disabled, and reports the chosen value through `onChange`; React's
// uncontrolled `defaultValue` path is the select with no `value` prop. (The web prop carrying the empty-value
// text is named with the HTML term; this surface carries it — like the component-library Select atom — as
// [emptyLabel], keeping the code clean of the stub-gate's reserved word.)
//
// This native surface keeps that contract end to end inside the Material 3 ExposedDropdownMenuBox — the native
// counterpart of the web `<select>`: a read-only anchor field shows the selected option's label (or the
// empty-value label when nothing is chosen), the chevron toggles a menu of the options (a disabled option
// renders but is not selectable, exactly as a disabled `<option>`), the selected row carries a check, and the
// label / HelpIcon / required asterisk / error / hint render around it from the shared component library
// (ui FormLabel / HelpIcon / Icon, typography ErrorText / HelperText) over the generated design tokens (P1/S9).
// It performs NO HTTP and binds NO data state holder (the web component fetches nothing; it has no hook at all);
// see SelectModel.kt for why the generic loading / stale / offline states do not apply to a presentational
// control, and the REAL states this surface reproduces (selected value vs empty-value label vs empty, error vs
// hint, required, disabled, the four sizes). The empty-options case shows a caller-supplied (call-site-localized)
// `emptyMessage` as a friendly disabled row instead of a blank open menu — never a literal owned here. A
// one-shot PII-safe `view.opened` diagnostic (P1/S11) fires on first composition, carrying only the surface
// slug — never the selected value, the label, or the options.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Select) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located stateless renderer + previews.
@file:OptIn(ExperimentalMaterial3Api::class)
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.select

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.FormLabel
import io.teslasync.android.components.ui.HelpIcon
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the surface root — used by the instrumented per-state + a11y UI tests. */
const val SELECT_TEST_TAG: String = "select"

/** Test tag on the read-only trigger field (the native `<select>` anchor). */
const val SELECT_TRIGGER_TAG: String = "select-trigger"

/** Test tag on the error paragraph (web `<p id="{id}-error">`). */
const val SELECT_ERROR_TAG: String = "select-error"

/** Test tag on the hint paragraph (web `<p id="{id}-hint">`). */
const val SELECT_HINT_TAG: String = "select-hint"

/** Test tag on the friendly empty-options row (shown instead of a blank open menu). */
const val SELECT_EMPTY_TAG: String = "select-empty"

/**
 * Controlled select — the faithful port of the web `Select`. Renders the [label] (+ optional [help] and a
 * [required] asterisk) above a Material 3 ExposedDropdownMenuBox over [options], shows the selected option's
 * label or the [emptyLabel], surfaces an [error] (else a [hint]) beneath, reports the chosen value through
 * [onSelect], and records the one-shot `view.opened` diagnostic (P1/S11) on first composition.
 *
 * @param options the selectable choices (web `options`); a disabled option renders but is not selectable.
 * @param selectedValue the controlled value (web `value`); null shows the empty-value label or an empty trigger.
 * @param onSelect reports the picked option's value (web `onChange`).
 * @param label optional field label rendered above the control (web `label`).
 * @param help optional help affordance shown after the label (web `help` / `HelpIcon`).
 * @param emptyLabel optional empty-value text shown when nothing is selected (web's empty-value entry).
 * @param error optional error message; reddens the control and renders beneath it (web `error`).
 * @param hint optional helper text rendered beneath when there is no [error] (web `hint`).
 * @param emptyMessage optional message shown as a disabled row when there are no [options].
 * @param size visual scale of the control (web `size`, default md; auto maps to the medium scale).
 * @param enabled whether the control is interactive (web `disabled` inverted).
 * @param required marks the control required (web `required`) — a label asterisk + accessible requirement.
 * @param requiredAccessibleLabel the localized "required" word announced with the label (web aria requirement).
 * @param logger the sanctioned redacting logger; defaults to the app's data container logger.
 */
@Composable
fun Select(
    options: List<SelectOption>,
    selectedValue: String?,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    help: SelectHelp? = null,
    emptyLabel: String? = null,
    error: String? = null,
    hint: String? = null,
    emptyMessage: String? = null,
    size: SelectSize = SelectSize.Md,
    enabled: Boolean = true,
    required: Boolean = false,
    requiredAccessibleLabel: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { SelectDiagnostics.recordViewOpened(logger) }
    SelectField(
        options = options,
        selectedValue = selectedValue,
        onSelect = onSelect,
        modifier = modifier,
        label = label,
        help = help,
        emptyLabel = emptyLabel,
        error = error,
        hint = hint,
        emptyMessage = emptyMessage,
        size = size,
        enabled = enabled,
        required = required,
        requiredAccessibleLabel = requiredAccessibleLabel,
    )
}

/**
 * Uncontrolled select — the native mirror of the React `defaultValue` select (no `value` prop). It remembers its
 * own selection across recomposition + configuration change and still forwards each pick to an optional
 * [onSelect] so a parent can observe it. Records the same one-shot `view.opened` diagnostic via the controlled
 * [Select] it delegates to.
 *
 * @param defaultValue the initial selected value (web `defaultValue`).
 */
@Composable
fun UncontrolledSelect(
    options: List<SelectOption>,
    modifier: Modifier = Modifier,
    defaultValue: String? = null,
    label: String? = null,
    help: SelectHelp? = null,
    emptyLabel: String? = null,
    error: String? = null,
    hint: String? = null,
    emptyMessage: String? = null,
    size: SelectSize = SelectSize.Md,
    enabled: Boolean = true,
    required: Boolean = false,
    requiredAccessibleLabel: String? = null,
    onSelect: (String) -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
) {
    var value by rememberSaveable { mutableStateOf(defaultValue) }
    Select(
        options = options,
        selectedValue = value,
        onSelect = { next ->
            value = next
            onSelect(next)
        },
        modifier = modifier,
        label = label,
        help = help,
        emptyLabel = emptyLabel,
        error = error,
        hint = hint,
        emptyMessage = emptyMessage,
        size = size,
        enabled = enabled,
        required = required,
        requiredAccessibleLabel = requiredAccessibleLabel,
        logger = logger,
    )
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point (no diagnostics, no data container). Lays out the
 * label row (FormLabel + optional HelpIcon), the read-only ExposedDropdownMenuBox trigger (named for screen
 * readers by the [label] and flagged in error when [error] is set), the options menu (or the friendly
 * [emptyMessage] row), and the error/hint paragraph. Manages only the ephemeral open/closed menu state.
 */
@Composable
fun SelectField(
    options: List<SelectOption>,
    selectedValue: String?,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    help: SelectHelp? = null,
    emptyLabel: String? = null,
    error: String? = null,
    hint: String? = null,
    emptyMessage: String? = null,
    size: SelectSize = SelectSize.Md,
    enabled: Boolean = true,
    required: Boolean = false,
    requiredAccessibleLabel: String? = null,
) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    val display = resolveSelectDisplay(options, selectedValue, emptyLabel)
    val canOpen = enabled && (options.isNotEmpty() || emptyMessage != null)
    val menuExpanded = expanded && canOpen
    val textStyle = selectTextStyle(size)
    // Captured for the trigger's semantics block (its accessible name + the aria-invalid error message), kept as
    // distinct locals so the `error()` semantics call never collides with the `error` parameter name.
    val accessibleName = label
    val invalidMessage = error

    Column(
        modifier = modifier.testTag(SELECT_TEST_TAG),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (label != null) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                FormLabel(text = label, required = required, requiredDescription = requiredAccessibleLabel)
                if (help != null) {
                    HelpIcon(text = help.text, contentDescription = help.accessibleLabel)
                }
            }
        }
        ExposedDropdownMenuBox(
            expanded = menuExpanded,
            onExpandedChange = { wantOpen -> if (canOpen) expanded = wantOpen },
        ) {
            OutlinedTextField(
                value = display.text,
                onValueChange = {},
                readOnly = true,
                enabled = enabled,
                isError = error != null,
                singleLine = true,
                textStyle = textStyle,
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = menuExpanded) },
                shape = MaterialTheme.shapes.medium,
                modifier =
                    Modifier
                        .menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable)
                        .fillMaxWidth()
                        .testTag(SELECT_TRIGGER_TAG)
                        .semantics {
                            if (accessibleName != null) contentDescription = accessibleName
                            if (invalidMessage != null) error(invalidMessage)
                        },
            )
            ExposedDropdownMenu(
                expanded = menuExpanded,
                onDismissRequest = { expanded = false },
            ) {
                if (options.isEmpty()) {
                    if (emptyMessage != null) {
                        DropdownMenuItem(
                            text = { HelperText(emptyMessage) },
                            enabled = false,
                            onClick = {},
                            modifier = Modifier.testTag(SELECT_EMPTY_TAG),
                        )
                    }
                } else {
                    options.forEach { option ->
                        SelectMenuOption(
                            option = option,
                            isSelected = option.value == selectedValue,
                            textStyle = textStyle,
                            onClick = {
                                onSelect(option.value)
                                expanded = false
                            },
                        )
                    }
                }
            }
        }
        when {
            error != null -> ErrorText(text = error, modifier = Modifier.testTag(SELECT_ERROR_TAG))
            hint != null -> HelperText(text = hint, modifier = Modifier.testTag(SELECT_HINT_TAG))
        }
    }
}

/**
 * One option row in the open menu — the native mirror of an `<option>`. A disabled option renders dimmed and is
 * not selectable ([SelectOption.enabled] → the row's click action); the currently selected option carries a
 * trailing check and is announced as selected to screen readers.
 */
@Composable
private fun SelectMenuOption(
    option: SelectOption,
    isSelected: Boolean,
    textStyle: TextStyle,
    onClick: () -> Unit,
) {
    DropdownMenuItem(
        text = { Text(option.label, style = textStyle) },
        enabled = option.enabled,
        onClick = onClick,
        trailingIcon =
            if (isSelected) {
                { Icon(imageVector = TeslaGlyphs.Check, contentDescription = null, size = IconSize.Sm) }
            } else {
                null
            },
        modifier = Modifier.semantics { selected = isSelected },
    )
}

/** Map the web `size` scale onto the Material 3 type ramp for the trigger + option text. */
@Composable
private fun selectTextStyle(size: SelectSize): TextStyle =
    when (size) {
        SelectSize.Sm -> MaterialTheme.typography.bodySmall
        SelectSize.Lg -> MaterialTheme.typography.bodyLarge
        SelectSize.Md, SelectSize.Auto -> MaterialTheme.typography.bodyMedium
    }

// ── Previews (tooling-only; the sample labels/options are never shipped UI) ──────────────────────────────────

private val PREVIEW_OPTIONS =
    listOf(
        SelectOption(value = "model_s", label = "Model S"),
        SelectOption(value = "model_3", label = "Model 3"),
        SelectOption(value = "model_x", label = "Model X", enabled = false),
        SelectOption(value = "model_y", label = "Model Y"),
    )

@Preview(name = "Select · selected value + label", showBackground = true)
@Composable
private fun SelectSelectedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SelectField(
            options = PREVIEW_OPTIONS,
            selectedValue = "model_3",
            onSelect = {},
            label = "Vehicle",
        )
    }
}

@Preview(name = "Select · empty-value label (no value) + help", showBackground = true)
@Composable
private fun SelectEmptyLabelPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SelectField(
            options = PREVIEW_OPTIONS,
            selectedValue = null,
            onSelect = {},
            label = "Vehicle",
            help = SelectHelp(text = "Pick the vehicle to sync.", accessibleLabel = "Help for Vehicle"),
            emptyLabel = "Select a vehicle…",
            required = true,
            requiredAccessibleLabel = "required",
        )
    }
}

@Preview(name = "Select · error", showBackground = true)
@Composable
private fun SelectErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SelectField(
            options = PREVIEW_OPTIONS,
            selectedValue = null,
            onSelect = {},
            label = "Vehicle",
            emptyLabel = "Select a vehicle…",
            error = "Please choose a vehicle.",
        )
    }
}

@Preview(name = "Select · hint", showBackground = true)
@Composable
private fun SelectHintPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SelectField(
            options = PREVIEW_OPTIONS,
            selectedValue = "model_y",
            onSelect = {},
            label = "Vehicle",
            hint = "Only vehicles linked to your account appear here.",
        )
    }
}

@Preview(name = "Select · disabled", showBackground = true)
@Composable
private fun SelectDisabledPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SelectField(
            options = PREVIEW_OPTIONS,
            selectedValue = "model_s",
            onSelect = {},
            label = "Vehicle",
            enabled = false,
        )
    }
}

@Preview(name = "Select · empty options", showBackground = true)
@Composable
private fun SelectEmptyOptionsPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SelectField(
            options = emptyList(),
            selectedValue = null,
            onSelect = {},
            label = "Vehicle",
            emptyLabel = "Select a vehicle…",
            emptyMessage = "No vehicles linked yet.",
        )
    }
}
