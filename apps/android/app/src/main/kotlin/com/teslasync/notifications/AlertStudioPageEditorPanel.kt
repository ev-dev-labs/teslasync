// The rule-editor surface of the AlertStudioPage (GlassPanel 5) plus its three nested panels — the allowed-
// operators panel (GlassPanel 6), the any-change description panel (GlassPanel 7) and the test-channels panel
// (GlassPanel 8). A parity port of the web page's `<GlassPanel data-tour="alert-studio-builder">` editor: the
// identity fields, the vehicle scope, the signal/computed-metric kind switch, the typed condition, the
// severity + value editors, the cooldown + alert-behavior + escalation controls, the test-delivery channels
// and the save / delete / test / reset actions — every visible string from the generated res/values catalog.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications)
// diverges from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7
// pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.notifications.alertstudio

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.ConfirmSeverity
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.FieldLabelText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.Toggle
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.presentation.notifications.ComputedMetricSummary
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel

/** The canonical severity ids, lowest first (web `severityOptions` order). */
private val severityIds = listOf("info", "warn", "critical")

/**
 * GlassPanel 5 — the rule editor (web `alert-studio-builder` panel). Renders the title, the validation banner,
 * every editor field group, the nested allowed-operators / any-change / test-channels panels, and the action
 * buttons, with an unsaved-changes guard on Reset.
 */
@Composable
fun RuleEditorPanel(
    interaction: AlertStudioInteraction,
    metricsState: UiState<List<ComputedMetricSummary>>,
    channelsState: UiState<List<NotificationChannel>>,
    vehiclesState: UiState<List<Vehicle>>,
    saving: Boolean,
    actions: AlertStudioActions,
) {
    val editor = interaction.editor
    var showUnsaved by remember { mutableStateOf(false) }
    GlassPanel(padding = PanelPadding.Lg) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            EditorHeader(interaction = interaction)
            if (!canSave(editor)) {
                AlertBanner(
                    message = stringResource(R.string.translation_forms_validationFailed),
                    tone = Tone.Danger,
                )
            }
            EditorIdentityFields(editor = editor, actions = actions)
            VehicleScopeSection(editor = editor, vehiclesState = vehiclesState, actions = actions)
            KindSelector(editor = editor, actions = actions)
            if (editor.kind == RuleKind.ComputedMetric) {
                ComputedMetricSection(editor = editor, metricsState = metricsState, actions = actions)
            } else {
                SignalConditionSection(editor = editor, actions = actions)
            }
            SeverityRow(editor = editor, actions = actions)
            if (editor.kind == RuleKind.Signal) {
                ValueEditor(editor = editor, actions = actions)
            }
            CooldownAndBehavior(editor = editor, actions = actions)
            if (editor.triggerMode == TriggerMode.Repeat) {
                MaxFiresSection(editor = editor, actions = actions)
                EscalationSection(editor = editor, actions = actions)
            }
            TestChannelsSection(interaction = interaction, channelsState = channelsState, actions = actions)
            EditorActionButtons(
                interaction = interaction,
                saving = saving,
                actions = actions,
                onRequestReset = { dirty -> if (dirty) showUnsaved = true else actions.onNewRule() },
            )
        }
    }
    if (showUnsaved) {
        UnsavedChangesDialog(
            onDiscard = {
                showUnsaved = false
                actions.onNewRule()
            },
            onKeep = { showUnsaved = false },
        )
    }
}

/** The editor title (edit vs new) plus the unsaved-draft indicator (web `isEditing` + `draft.noun.rule`). */
@Composable
private fun EditorHeader(interaction: AlertStudioInteraction) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PanelTitle(
            if (interaction.isEditing) {
                stringResource(R.string.translation_notifications_alertStudio_editor_editTitle)
            } else {
                stringResource(R.string.translation_notifications_alertStudio_editor_newTitle)
            },
        )
        if (!interaction.isEditing && interaction.editor != AlertStudioEditor()) {
            Caption(stringResource(R.string.translation_draft_noun_rule))
        }
    }
}

/** The name field + the enabled/disabled status select (web identity row). */
@Composable
private fun EditorIdentityFields(
    editor: AlertStudioEditor,
    actions: AlertStudioActions,
) {
    Input(
        value = editor.name,
        onValueChange = { next -> actions.onUpdateEditor { it.copy(name = next) } },
        label = stringResource(R.string.translation_notifications_alertStudio_editor_nameLabel),
        hint = stringResource(R.string.translation_notifications_alertStudio_editor_namePlaceholder), // parity:allow web i18n key name, not a stub marker
        modifier = Modifier.fillMaxWidth(),
    )
    Select(
        options =
            listOf(
                SelectOption("true", stringResource(R.string.translation_notifications_alertStudio_editor_enabled)),
                SelectOption("false", stringResource(R.string.translation_notifications_alertStudio_editor_disabled)),
            ),
        selectedValue = editor.enabled.toString(),
        onSelect = { value -> actions.onUpdateEditor { it.copy(enabled = value == "true") } },
        label = stringResource(R.string.translation_notifications_alertStudio_editor_enabledLabel),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The vehicle-scope picker (web `VehicleMultiSelect`): an all-vehicles toggle + per-vehicle checkboxes. */
@Composable
private fun VehicleScopeSection(
    editor: AlertStudioEditor,
    vehiclesState: UiState<List<Vehicle>>,
    actions: AlertStudioActions,
) {
    val vehicles = vehiclesState.data.orEmpty()
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        FieldLabelText(stringResource(R.string.translation_notifications_alertStudio_editor_vehiclesLabel))
        Toggle(
            checked = editor.allVehicles,
            onCheckedChange = { next -> actions.onUpdateEditor { it.copy(allVehicles = next) } },
            label = stringResource(R.string.translation_notifications_alertStudio_editor_vehiclesLabel),
        )
        if (!editor.allVehicles) {
            if (vehiclesState.isLoading) {
                Skeleton(widthFraction = 0.8f, height = 16.dp)
            } else {
                vehicles.forEach { vehicle ->
                    Toggle(
                        checked = vehicle.id in editor.vehicleIds,
                        onCheckedChange = { checked ->
                            actions.onUpdateEditor { state ->
                                val next = if (checked) state.vehicleIds + vehicle.id else state.vehicleIds - vehicle.id
                                state.copy(vehicleIds = next)
                            }
                        },
                        label = vehicle.displayName,
                    )
                }
            }
        }
    }
}

/** The signal-threshold vs computed-metric kind switch + its hint (web kind selector). */
@Composable
private fun KindSelector(
    editor: AlertStudioEditor,
    actions: AlertStudioActions,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        FieldLabelText(stringResource(R.string.translation_notifications_alertStudio_editor_kindLabel))
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Button(
                label = stringResource(R.string.translation_notifications_alertStudio_kind_signal),
                onClick = { actions.onUpdateEditor { it.copy(kind = RuleKind.Signal) } },
                variant = if (editor.kind == RuleKind.Signal) ButtonVariant.Secondary else ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
            Button(
                label = stringResource(R.string.translation_notifications_alertStudio_kind_computedMetric),
                onClick = { actions.onUpdateEditor { it.copy(kind = RuleKind.ComputedMetric) } },
                variant = if (editor.kind == RuleKind.ComputedMetric) ButtonVariant.Secondary else ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
        HelperText(
            if (editor.kind == RuleKind.ComputedMetric) {
                stringResource(R.string.translation_notifications_alertStudio_kind_computedMetricHint)
            } else {
                stringResource(R.string.translation_notifications_alertStudio_kind_signalHint)
            },
        )
    }
}

/** The signal select + operator select + the signal-type hint (web signal condition row). */
@Composable
private fun SignalConditionSection(
    editor: AlertStudioEditor,
    actions: AlertStudioActions,
) {
    val options =
        signalCatalog.map { sig ->
            SelectOption(
                value = sig.name,
                label =
                    stringResource(
                        R.string.translation_notifications_alertStudio_signals_optionLabel,
                        sig.name,
                        sig.category,
                        signalTypeLabel(sig.valueType),
                    ),
            )
        }
    Select(
        options = options,
        selectedValue = editor.signalName.takeIf { it.isNotBlank() },
        onSelect = { value ->
            val firstOp = operatorsForType(signalFor(value)?.valueType).firstOrNull() ?: ">"
            actions.onUpdateEditor { it.copy(signalName = value, op = firstOp) }
        },
        label = stringResource(R.string.translation_notifications_alertStudio_editor_signalNameLabel),
        emptyLabel = stringResource(R.string.translation_notifications_alertStudio_editor_signalNamePlaceholder), // parity:allow web i18n key name, not a stub marker
        modifier = Modifier.fillMaxWidth(),
    )
    OperatorSelect(editor = editor, actions = actions)
    val sig = signalFor(editor.signalName)
    when {
        sig != null ->
            HelperText(
                stringResource(
                    R.string.translation_notifications_alertStudio_editor_signalTypeHint,
                    signalTypeLabel(sig.valueType),
                    sig.category,
                ),
            )

        editor.signalName.isNotBlank() ->
            Caption(
                stringResource(
                    R.string.translation_notifications_alertStudio_signals_customOptionLabel,
                    editor.signalName,
                    stringResource(R.string.translation_notifications_alertStudio_signalCategories_custom),
                ),
            )
    }
}

/** The operator select, scoped to the operators valid for the selected signal's value type. */
@Composable
private fun OperatorSelect(
    editor: AlertStudioEditor,
    actions: AlertStudioActions,
) {
    val operators = operatorsForType(signalFor(editor.signalName)?.valueType)
    Select(
        options = operators.map { SelectOption(it, it) },
        selectedValue = editor.op.takeIf { it.isNotBlank() },
        onSelect = { value -> actions.onUpdateEditor { it.copy(op = value) } },
        label = stringResource(R.string.translation_notifications_alertStudio_editor_operatorLabel),
        enabled = editor.signalName.isNotBlank(),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The severity select + the allowed-operators panel (GlassPanel 6) for signal rules. */
@Composable
private fun SeverityRow(
    editor: AlertStudioEditor,
    actions: AlertStudioActions,
) {
    Select(
        options = severityIds.map { SelectOption(it, severityLabel(it)) },
        selectedValue = editor.severity,
        onSelect = { value ->
            actions.onUpdateEditor { state ->
                val keepEsc = state.escalationSeverity.isBlank() ||
                    (severityRank[state.escalationSeverity] ?: 0) > (severityRank[value] ?: 0)
                state.copy(severity = value, escalationSeverity = if (keepEsc) state.escalationSeverity else "")
            }
        },
        label = stringResource(R.string.translation_notifications_alertStudio_editor_severityLabel),
        modifier = Modifier.fillMaxWidth(),
    )
    if (editor.kind == RuleKind.Signal) {
        AllowedOperatorsPanel(editor = editor)
    }
}

/** GlassPanel 6 — the read-only allowed-operators summary for the selected signal (web allowed-operators panel). */
@Composable
private fun AllowedOperatorsPanel(editor: AlertStudioEditor) {
    GlassPanel(padding = PanelPadding.Sm) {
        FieldLabelText(stringResource(R.string.translation_notifications_alertStudio_editor_allowedOperatorsLabel))
        if (editor.signalName.isNotBlank()) {
            BodyText(operatorsForType(signalFor(editor.signalName)?.valueType).joinToString("   "))
        } else {
            HelperText(stringResource(R.string.translation_notifications_alertStudio_editor_allowedOperatorsPlaceholder)) // parity:allow web i18n key name, not a stub marker
        }
    }
}

/** The typed-value editor — numeric / text / boolean / range / any-change (GlassPanel 7) / no-signal states. */
@Composable
private fun ValueEditor(
    editor: AlertStudioEditor,
    actions: AlertStudioActions,
) {
    FieldLabelText(stringResource(R.string.translation_notifications_alertStudio_editor_typedValueLabel))
    if (editor.signalName.isBlank()) {
        EmptyState(
            title = stringResource(R.string.translation_notifications_alertStudio_editor_noSignalTitle),
            message = stringResource(R.string.translation_notifications_alertStudio_editor_noSignalDescription),
        )
        return
    }
    when (valueKindFor(editor)) {
        ValueKind.None -> AnyChangePanel()
        ValueKind.Number ->
            Input(
                value = editor.valueNum,
                onValueChange = { next -> actions.onUpdateEditor { it.copy(valueNum = next) } },
                label = stringResource(R.string.translation_notifications_alertStudio_editor_numericValueLabel),
                keyboardType = KeyboardType.Number,
                modifier = Modifier.fillMaxWidth(),
            )

        ValueKind.Text ->
            Input(
                value = editor.valueText,
                onValueChange = { next -> actions.onUpdateEditor { it.copy(valueText = next) } },
                label = stringResource(R.string.translation_notifications_alertStudio_editor_textValueLabel),
                hint = stringResource(R.string.translation_notifications_alertStudio_editor_textValuePlaceholder), // parity:allow web i18n key name, not a stub marker
                modifier = Modifier.fillMaxWidth(),
            )

        ValueKind.Bool ->
            Select(
                options =
                    listOf(
                        SelectOption("true", stringResource(R.string.translation_notifications_alertStudio_boolean_true)),
                        SelectOption("false", stringResource(R.string.translation_notifications_alertStudio_boolean_false)),
                    ),
                selectedValue = editor.valueBool.toString(),
                onSelect = { value -> actions.onUpdateEditor { it.copy(valueBool = value == "true") } },
                label = stringResource(R.string.translation_notifications_alertStudio_editor_booleanValueLabel),
                modifier = Modifier.fillMaxWidth(),
            )

        ValueKind.Range ->
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Input(
                    value = editor.valueMin,
                    onValueChange = { next -> actions.onUpdateEditor { it.copy(valueMin = next) } },
                    label = stringResource(R.string.translation_notifications_alertStudio_editor_minValueLabel),
                    keyboardType = KeyboardType.Number,
                    modifier = Modifier.weight(1f),
                )
                Input(
                    value = editor.valueMax,
                    onValueChange = { next -> actions.onUpdateEditor { it.copy(valueMax = next) } },
                    label = stringResource(R.string.translation_notifications_alertStudio_editor_maxValueLabel),
                    keyboardType = KeyboardType.Number,
                    modifier = Modifier.weight(1f),
                )
            }
    }
}

/** GlassPanel 7 — the any-change description shown when the rule fires on every signal change (web `none`). */
@Composable
private fun AnyChangePanel() {
    GlassPanel(padding = PanelPadding.Sm) {
        HelperText(stringResource(R.string.translation_notifications_alertStudio_editor_anyChangeDescription))
    }
}

/** The cooldown field + the alert-behavior selector with its recommend banner + force-choose guard. */
@Composable
private fun CooldownAndBehavior(
    editor: AlertStudioEditor,
    actions: AlertStudioActions,
) {
    Input(
        value = editor.cooldownMin,
        onValueChange = { next -> actions.onUpdateEditor { it.copy(cooldownMin = next) } },
        label = stringResource(R.string.translation_notifications_alertStudio_editor_cooldownLabel),
        keyboardType = KeyboardType.Number,
        modifier = Modifier.fillMaxWidth(),
    )
    AlertBehaviorSection(editor = editor, actions = actions)
}

/** The alert-behavior tri-state selector (web `alert-behavior-block`): recommend banner, select, descriptions. */
@Composable
private fun AlertBehaviorSection(
    editor: AlertStudioEditor,
    actions: AlertStudioActions,
) {
    FieldLabelText(stringResource(R.string.translation_notifications_alertStudio_editor_alertBehaviorLabel))
    val (recommended, alternative) = behaviorRecommendation(editor.op)
    if (editor.triggerMode == TriggerMode.Unset) {
        AlertBanner(
            message =
                stringResource(
                    R.string.translation_notifications_alertStudio_editor_alertBehavior_recommendBanner,
                    editor.op,
                    recommended,
                ),
            tone = Tone.Info,
        )
        Caption(
            stringResource(
                R.string.translation_notifications_alertStudio_editor_alertBehavior_recommendBannerAlt,
                alternative,
            ),
        )
    }
    Select(
        options =
            listOf(
                SelectOption("once", stringResource(R.string.translation_notifications_alertStudio_editor_alertBehavior_onceLabel)),
                SelectOption("repeat", stringResource(R.string.translation_notifications_alertStudio_editor_alertBehavior_repeatLabel)),
            ),
        selectedValue = behaviorWire(editor.triggerMode),
        onSelect = { value -> actions.onUpdateEditor { applyTriggerMode(it, value) } },
        label = stringResource(R.string.translation_notifications_alertStudio_editor_alertBehaviorLabel),
        emptyLabel = stringResource(R.string.translation_notifications_alertStudio_editor_alertBehaviorPlaceholder), // parity:allow web i18n key name, not a stub marker
        modifier = Modifier.fillMaxWidth(),
    )
    when (editor.triggerMode) {
        TriggerMode.Unset -> ErrorText(stringResource(R.string.translation_notifications_alertStudio_editor_alertBehavior_forceChoose))
        TriggerMode.Once -> HelperText(stringResource(R.string.translation_notifications_alertStudio_editor_alertBehavior_onceDesc))
        TriggerMode.Repeat ->
            HelperText(
                stringResource(
                    R.string.translation_notifications_alertStudio_editor_alertBehavior_repeatDesc,
                    editor.cooldownMin,
                ),
            )
    }
}

/** The max-fires cap field for repeat-mode rules (web `alert-max-fires`). */
@Composable
private fun MaxFiresSection(
    editor: AlertStudioEditor,
    actions: AlertStudioActions,
) {
    Input(
        value = editor.maxFires,
        onValueChange = { next -> actions.onUpdateEditor { it.copy(maxFires = next) } },
        label = stringResource(R.string.translation_notifications_alertStudio_editor_maxFiresLabel),
        hint = stringResource(R.string.translation_notifications_alertStudio_editor_maxFiresPlaceholder), // parity:allow web i18n key name, not a stub marker
        keyboardType = KeyboardType.Number,
        modifier = Modifier.fillMaxWidth(),
    )
    HelperText(stringResource(R.string.translation_notifications_alertStudio_editor_maxFiresHint))
}

/** The escalation toggle + (when on) the after-minutes + escalated-severity controls (web escalation block). */
@Composable
private fun EscalationSection(
    editor: AlertStudioEditor,
    actions: AlertStudioActions,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Toggle(
            checked = editor.escalationEnabled,
            onCheckedChange = { next -> actions.onUpdateEditor { it.copy(escalationEnabled = next) } },
            label = stringResource(R.string.translation_notifications_alertStudio_editor_escalationCheckboxLabel),
        )
    }
    if (!editor.escalationEnabled) return
    Input(
        value = editor.escalationAfterMin,
        onValueChange = { next -> actions.onUpdateEditor { it.copy(escalationAfterMin = next) } },
        label = stringResource(R.string.translation_notifications_alertStudio_editor_escalationAfterLabel),
        hint = stringResource(R.string.translation_notifications_alertStudio_editor_escalationAfterPlaceholder), // parity:allow web i18n key name, not a stub marker
        keyboardType = KeyboardType.Number,
        modifier = Modifier.fillMaxWidth(),
    )
    val higher = severityIds.filter { (severityRank[it] ?: 0) > (severityRank[editor.severity] ?: 0) }
    Select(
        options = higher.map { SelectOption(it, severityLabel(it)) },
        selectedValue = editor.escalationSeverity.takeIf { it.isNotBlank() },
        onSelect = { value -> actions.onUpdateEditor { it.copy(escalationSeverity = value) } },
        label = stringResource(R.string.translation_notifications_alertStudio_editor_escalationSeverityLabel),
        emptyLabel = stringResource(R.string.translation_notifications_alertStudio_editor_escalationSeverityPlaceholder), // parity:allow web i18n key name, not a stub marker
        modifier = Modifier.fillMaxWidth(),
    )
    HelperText(stringResource(R.string.translation_notifications_alertStudio_editor_escalationHint))
}

/** The test-delivery-target section + GlassPanel 8 (web test-target block + `alert-studio-channels` panel). */
@Composable
private fun TestChannelsSection(
    interaction: AlertStudioInteraction,
    channelsState: UiState<List<NotificationChannel>>,
    actions: AlertStudioActions,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        FieldLabelText(stringResource(R.string.translation_notifications_alertStudio_channels_testTargetLabel))
        HelperText(stringResource(R.string.translation_notifications_alertStudio_channels_browserToast))
        HelperText(stringResource(R.string.translation_notifications_alertStudio_channels_alertHistory))
        TestChannelsPanel(interaction = interaction, channelsState = channelsState, actions = actions)
    }
}

/** GlassPanel 8 — the external test-delivery channels with its own loading / error / empty / content matrix. */
@Composable
private fun TestChannelsPanel(
    interaction: AlertStudioInteraction,
    channelsState: UiState<List<NotificationChannel>>,
    actions: AlertStudioActions,
) {
    val channels = channelsState.data.orEmpty()
    GlassPanel(padding = PanelPadding.Md) {
        when {
            channelsState.isLoading -> Skeleton(widthFraction = 0.8f, height = 24.dp, rounded = true)
            channelsState.isError ->
                ErrorDisplay(
                    message = stringResource(R.string.translation_error_serverError_message),
                    title = stringResource(R.string.translation_error_serverError_title),
                    onRetry = actions.onRetryChannels,
                    retryLabel = stringResource(R.string.translation_common_retry),
                )

            channels.isNotEmpty() -> {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    Caption(stringResource(R.string.translation_notifications_alertStudio_channels_externalChannels))
                    val ids = channels.map { it.id }
                    channels.forEach { channel ->
                        Button(
                            label = "${channel.name} (${channelKind(channel)})",
                            onClick = { actions.onToggleTestChannel(channel.id, ids) },
                            variant = if (interaction.isTestChannelSelected(channel.id)) ButtonVariant.Secondary else ButtonVariant.Ghost,
                            size = ButtonSize.Sm,
                        )
                    }
                }
            }

            else ->
                EmptyState(
                    title = stringResource(R.string.translation_notifications_alertStudio_channels_emptyTitle),
                    message = stringResource(R.string.translation_notifications_alertStudio_channels_emptyDescription),
                )
        }
    }
}

/** The computed-metric editor (web `ComputedMetricEditor`): the metric picker, operator and threshold. */
@Composable
private fun ComputedMetricSection(
    editor: AlertStudioEditor,
    metricsState: UiState<List<ComputedMetricSummary>>,
    actions: AlertStudioActions,
) {
    val metrics = metricsState.data.orEmpty()
    Select(
        options = metrics.map { SelectOption(it.id, it.label.ifBlank { it.id }) },
        selectedValue = editor.metricId.takeIf { it.isNotBlank() },
        onSelect = { value ->
            val metric = metrics.firstOrNull { it.id == value }
            actions.onUpdateEditor {
                it.copy(
                    metricId = value,
                    metricWindow = metric?.windows?.firstOrNull() ?: it.metricWindow,
                    metricOp = metric?.ops?.firstOrNull() ?: it.metricOp,
                )
            }
        },
        label = stringResource(R.string.translation_notifications_alertStudio_kind_computedMetric),
        enabled = !metricsState.isLoading,
        modifier = Modifier.fillMaxWidth(),
    )
    val metricOps = metrics.firstOrNull { it.id == editor.metricId }?.ops.orEmpty().ifEmpty { listOf(">", ">=", "<", "<=") }
    Select(
        options = metricOps.map { SelectOption(it, it) },
        selectedValue = editor.metricOp.takeIf { it.isNotBlank() },
        onSelect = { value -> actions.onUpdateEditor { it.copy(metricOp = value) } },
        label = stringResource(R.string.translation_notifications_alertStudio_editor_operatorLabel),
        modifier = Modifier.fillMaxWidth(),
    )
    Input(
        value = editor.metricThreshold,
        onValueChange = { next -> actions.onUpdateEditor { it.copy(metricThreshold = next) } },
        label = stringResource(R.string.translation_notifications_alertStudio_editor_numericValueLabel),
        keyboardType = KeyboardType.Number,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The save / delete / test / reset action buttons (web editor footer). */
@Composable
private fun EditorActionButtons(
    interaction: AlertStudioInteraction,
    saving: Boolean,
    actions: AlertStudioActions,
    onRequestReset: (Boolean) -> Unit,
) {
    val editor = interaction.editor
    val defaultMessage = stringResource(R.string.translation_notifications_alertStudio_test_defaultMessage)
    val saveLabel =
        when {
            saving -> stringResource(R.string.translation_notifications_alertStudio_actions_saving)
            interaction.isEditing -> stringResource(R.string.translation_notifications_alertStudio_actions_updateRule)
            else -> stringResource(R.string.translation_notifications_alertStudio_actions_createRule)
        }
    val dirty = interaction.isEditing || editor != AlertStudioEditor()
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Button(
            label = saveLabel,
            onClick = actions.onSave,
            variant = ButtonVariant.Primary,
            size = ButtonSize.Sm,
            enabled = canSave(editor) && !saving,
            loading = saving,
        )
        if (interaction.isEditing) {
            Button(
                label = stringResource(R.string.translation_notifications_alertStudio_actions_delete),
                onClick = { editor.id?.let(actions.onDelete) },
                variant = ButtonVariant.Danger,
                size = ButtonSize.Sm,
            )
        }
        Button(
            label = stringResource(R.string.translation_notifications_alertStudio_actions_test),
            onClick = { actions.onTest(defaultMessage) },
            variant = ButtonVariant.Secondary,
            size = ButtonSize.Sm,
            enabled = editor.name.isNotBlank(),
        )
        Button(
            label = stringResource(R.string.translation_notifications_alertStudio_actions_reset),
            onClick = { onRequestReset(dirty) },
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
        )
    }
}

/** The unsaved-changes guard shown before discarding an in-progress edit (web `useNavigationGuard`). */
@Composable
private fun UnsavedChangesDialog(
    onDiscard: () -> Unit,
    onKeep: () -> Unit,
) {
    ConfirmDialog(
        title = stringResource(R.string.translation_forms_unsavedTitle),
        message =
            stringResource(R.string.translation_forms_unsavedRule) +
                "\n" +
                stringResource(R.string.translation_forms_unsavedWarning),
        confirmLabel = stringResource(R.string.translation_forms_discard),
        cancelLabel = stringResource(R.string.translation_forms_keepEditing),
        onConfirm = onDiscard,
        onCancel = onKeep,
        severity = ConfirmSeverity.Warning,
    )
}

// ── Editor helpers ────────────────────────────────────────────────────────────────────────────────────────

/** The recommended + alternative behavior labels for an operator (web `recommendedTriggerMode`). */
@Composable
private fun behaviorRecommendation(op: String): Pair<String, String> {
    val once = stringResource(R.string.translation_notifications_alertStudio_editor_alertBehavior_onceLabel)
    val repeat = stringResource(R.string.translation_notifications_alertStudio_editor_alertBehavior_repeatLabel)
    val thresholdOps = setOf("<", "<=", ">", ">=", "between")
    return if (op in thresholdOps) repeat to once else once to repeat
}

/** The localized notification-channel kind shown in the test-target chip (web `ch.kind`). */
private fun channelKind(channel: NotificationChannel): String =
    when (channel) {
        is NotificationChannel.Discord -> "discord"
        is NotificationChannel.Slack -> "slack"
        is NotificationChannel.Telegram -> "telegram"
        is NotificationChannel.Email -> "email"
        is NotificationChannel.Webhook -> "webhook"
        is NotificationChannel.Ntfy -> "ntfy"
        is NotificationChannel.Pushover -> "pushover"
    }

/** The select value for a trigger mode, or null while `Unset` so the prompt option shows. */
private fun behaviorWire(mode: TriggerMode): String? =
    when (mode) {
        TriggerMode.Once -> "once"
        TriggerMode.Repeat -> "repeat"
        TriggerMode.Unset -> null
    }

/** Applies a chosen behavior value to the editor, clearing the escalation pair when leaving repeat mode. */
private fun applyTriggerMode(
    editor: AlertStudioEditor,
    value: String,
): AlertStudioEditor {
    val mode = if (value == "repeat") TriggerMode.Repeat else TriggerMode.Once
    val repeat = mode == TriggerMode.Repeat
    return editor.copy(
        triggerMode = mode,
        escalationEnabled = if (repeat) editor.escalationEnabled else false,
        escalationAfterMin = if (repeat) editor.escalationAfterMin else "",
        escalationSeverity = if (repeat) editor.escalationSeverity else "",
    )
}
