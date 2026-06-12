// The inline command dialogs for the VehicleCommandCenter feature view — the native analogue of the web
// dialog family the orchestrator opens (CommandInputDialog / CommandSelectDialog / CommandConfirmDialog).
// Those polished standalone dialog surfaces are out of scope (each has its own prompt); this file renders
// functional inline dialogs (built on the shared Modal / Input / Button / ConfirmDialog) so the
// self-contained orchestrator reproduces the web dialog routing without importing the sibling surfaces.
// Prompts + option labels resolve through the i18n facade ([lookup]); action labels resolve from the
// catalog (translation_common_*). Each dialog returns the collected params to the host, which converts
// them to the JSON body and dispatches the command.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory cannot form a valid Kotlin
// package, so the package intentionally diverges from the path — exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclecommandcenter

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import io.teslasync.android.R
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.ConfirmSeverity
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Renders the dialog routed for [request], the native analogue of the web `activeDialog` switch: input /
 * select / confirm. [onSubmit] receives the command + the collected param map (the host converts it to the
 * JSON body and dispatches); [onDismiss] closes without dispatching (web `closeDialog`).
 */
@Composable
fun CommandDialogHost(
    request: DialogRequest,
    lookup: (String) -> String?,
    loading: Boolean,
    onSubmit: (CommandCenterCommand, Map<String, String>) -> Unit,
    onDismiss: () -> Unit,
) {
    when (request.kind) {
        DialogKind.Input -> CommandInputDialog(request.command, lookup, loading, onSubmit, onDismiss)
        DialogKind.Select -> CommandSelectDialog(request.command, lookup, onSubmit, onDismiss)
        DialogKind.Confirm ->
            CommandConfirmDialog(
                command = request.command,
                lookup = lookup,
                loading = loading,
                onConfirm = { onSubmit(request.command, request.command.params) },
                onDismiss = onDismiss,
            )
    }
}

/**
 * The input dialog — a single field (web single-param `InputConfig`) or a labelled field per `fields`
 * entry (web multi-field, e.g. lat/lon). The keyboard + a non-blank submit gate follow each field's
 * validation family; on submit the collected values are merged with the command's static params.
 */
@Composable
private fun CommandInputDialog(
    command: CommandCenterCommand,
    lookup: (String) -> String?,
    loading: Boolean,
    onSubmit: (CommandCenterCommand, Map<String, String>) -> Unit,
    onDismiss: () -> Unit,
) {
    val config = command.input ?: return
    val prompt = resolveOptional(lookup, foldCatalogKey(config.promptKey), config.promptFallback)
    val values = remember(command.id) { mutableStateMapOf<String, String>() }
    val singleKey = config.paramName
    val isMultiField = config.fields.isNotEmpty()

    val singleValue = values[singleKey] ?: config.defaultValue.orEmpty()
    val canSubmit =
        if (isMultiField) {
            config.fields.all { (values[it.name] ?: "").isNotBlank() }
        } else {
            singleValue.isNotBlank()
        }

    Modal(onDismissRequest = onDismiss, title = prompt, closeLabel = stringResource(R.string.translation_common_close)) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            if (isMultiField) {
                config.fields.forEach { field ->
                    Input(
                        value = values[field.name] ?: "",
                        onValueChange = { values[field.name] = it },
                        label = resolveOptional(lookup, foldCatalogKey(field.labelKey), field.labelFallback),
                        hint = field.hint,
                        keyboardType = keyboardTypeFor(field.validation),
                    )
                }
            } else {
                Input(
                    value = singleValue,
                    onValueChange = { values[singleKey] = it },
                    label = prompt,
                    keyboardType = keyboardTypeFor(config.validation),
                )
            }
            CommandDialogActions(
                onCancel = onDismiss,
                onSubmit = { onSubmit(command, buildInputParams(command, config, values, singleValue)) },
                submitLabel = stringResource(R.string.translation_common_send),
                cancelLabel = stringResource(R.string.translation_common_cancel),
                submitEnabled = canSubmit,
                loading = loading,
            )
        }
    }
}

/**
 * The select dialog — a list of options (web `SelectConfig`). Tapping an option dispatches immediately
 * (web `onSelect(value)`), merging the chosen value into the command's static params.
 */
@Composable
private fun CommandSelectDialog(
    command: CommandCenterCommand,
    lookup: (String) -> String?,
    onSubmit: (CommandCenterCommand, Map<String, String>) -> Unit,
    onDismiss: () -> Unit,
) {
    val config = command.select ?: return
    val title = resolveOptional(lookup, foldCatalogKey(command.labels.labelKey), command.labels.labelFallback)
    Modal(onDismissRequest = onDismiss, title = title, closeLabel = stringResource(R.string.translation_common_close)) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            config.options.forEach { option ->
                Button(
                    onClick = { onSubmit(command, command.params + (config.paramName to option.value)) },
                    modifier = Modifier.fillMaxWidth(),
                    variant = ButtonVariant.Outline,
                    size = ButtonSize.Md,
                ) {
                    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                        PanelTitle(resolveOptional(lookup, foldCatalogKey(option.labelKey), option.labelFallback))
                        option.description?.let { Caption(it) }
                    }
                }
            }
        }
    }
}

/**
 * The confirm dialog — the shared [ConfirmDialog] with the command's confirmation message and, when the
 * command requires it, a typed-confirmation gate (web `confirmInput`, e.g. "ERASE").
 */
@Composable
private fun CommandConfirmDialog(
    command: CommandCenterCommand,
    lookup: (String) -> String?,
    loading: Boolean,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    val confirm = command.confirm ?: return
    ConfirmDialog(
        title = resolveOptional(lookup, foldCatalogKey(command.labels.labelKey), command.labels.labelFallback),
        message = resolveOptional(lookup, foldCatalogKey(confirm.confirmKey), confirm.confirmFallback),
        confirmLabel = stringResource(R.string.translation_common_confirm),
        cancelLabel = stringResource(R.string.translation_common_cancel),
        onConfirm = onConfirm,
        onCancel = onDismiss,
        severity = ConfirmSeverity.Danger,
        loading = loading,
        requireTypedConfirmation = confirm.confirmInput,
        closeLabel = stringResource(R.string.translation_common_close),
    )
}

@Composable
private fun CommandDialogActions(
    onCancel: () -> Unit,
    onSubmit: () -> Unit,
    submitLabel: String,
    cancelLabel: String,
    submitEnabled: Boolean,
    loading: Boolean,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
    ) {
        Button(cancelLabel, onClick = onCancel, variant = ButtonVariant.Ghost, size = ButtonSize.Md, enabled = !loading)
        Button(
            submitLabel,
            onClick = onSubmit,
            variant = ButtonVariant.Primary,
            size = ButtonSize.Md,
            enabled = submitEnabled && !loading,
            loading = loading,
        )
    }
}

/** Builds the dispatch params for an input command — merges the command's static params with the field values. */
private fun buildInputParams(
    command: CommandCenterCommand,
    config: InputConfigDef,
    values: Map<String, String>,
    singleValue: String,
): Map<String, String> =
    if (config.fields.isNotEmpty()) {
        command.params + config.fields.associate { it.name to (values[it.name].orEmpty().trim()) }
    } else {
        command.params + (config.paramName to singleValue.trim())
    }

/** Maps an [InputValidation] family to the Material keyboard type for its field. */
private fun keyboardTypeFor(validation: InputValidation): KeyboardType =
    when (validation) {
        InputValidation.Pin -> KeyboardType.NumberPassword
        InputValidation.Number -> KeyboardType.Number
        InputValidation.Decimal -> KeyboardType.Decimal
        InputValidation.Text -> KeyboardType.Text
    }
