// The typed-step editors the AutomationBuilderPage composes inside its "When / Only If / Then" sections — the native
// counterparts of the web page's sibling `TriggerConfigurator` / `ConditionBuilder` / `ActionBuilder` components. Each is
// a stateless editor over one of the shared-core id-free input step hierarchies: it renders the current step(s) and
// emits the next value through an `onChange` callback, so the ViewModel stays the single owner of form state (ADR-002).
// No HTTP, no view-model: pure Compose over the shared domain types, using the A3 component library + the generated
// string catalog (ADR-014) for every label.
//
// `InvalidPackageDeclaration` is suppressed (mandated surface directory diverges from the app package);
// `MatchingDeclarationName`/`LongMethod`/`TooManyFunctions` for the co-located per-kind editors.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "LongMethod", "TooManyFunctions")

package io.teslasync.android.automations.builder

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconButtonVariant
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.presentation.automations.AutomationActionInput
import io.teslasync.shared.core.presentation.automations.AutomationConditionInput
import io.teslasync.shared.core.presentation.automations.AutomationTriggerInput
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel

// ── Trigger configurator (GlassPanel1 content) ───────────────────────────────────────────────────────────────────

/**
 * The per-kind trigger editor the "When" panel hosts (web `<TriggerConfigurator>`). Dispatches on the selected
 * trigger's kind and renders its essential fields; every edit emits the next [AutomationTriggerInput] through
 * [onChange] so the ViewModel owns the form state.
 */
@Composable
fun TriggerConfigurator(
    trigger: AutomationTriggerInput,
    onChange: (AutomationTriggerInput) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        when (trigger) {
            is AutomationTriggerInput.Signal -> SignalTriggerFields(trigger, onChange)
            is AutomationTriggerInput.Geofence -> GeofenceTriggerFields(trigger, onChange)
            is AutomationTriggerInput.Schedule -> ScheduleTriggerFields(trigger, onChange)
            is AutomationTriggerInput.Event -> EventTriggerFields(trigger, onChange)
        }
    }
}

@Composable
private fun SignalTriggerFields(
    trigger: AutomationTriggerInput.Signal,
    onChange: (AutomationTriggerInput) -> Unit,
) {
    Input(
        value = trigger.signal,
        onValueChange = { onChange(trigger.copy(signal = it)) },
        label = stringResource(R.string.translation_automations_builder_signal),
    )
    WireSelect(
        label = stringResource(R.string.translation_automations_builder_operator),
        options = SIGNAL_OPERATORS,
        selected = trigger.op,
        onSelect = { onChange(trigger.copy(op = it)) },
    )
    NumberInput(
        value = trigger.valueNum,
        onValueChange = { onChange(trigger.copy(valueNum = it)) },
        label = stringResource(R.string.translation_automations_builder_valueNumber),
    )
}

@Composable
private fun GeofenceTriggerFields(
    trigger: AutomationTriggerInput.Geofence,
    onChange: (AutomationTriggerInput) -> Unit,
) {
    LongInput(
        value = trigger.placeId,
        onValueChange = { onChange(trigger.copy(placeId = it ?: 0L)) },
        label = stringResource(R.string.translation_automations_builder_geofence),
    )
    WireSelect(
        label = stringResource(R.string.translation_automations_builder_geofenceEvent),
        options = GEOFENCE_EVENTS,
        selected = trigger.event,
        onSelect = { onChange(trigger.copy(event = it)) },
    )
    if (trigger.event == "dwell") {
        IntInput(
            value = trigger.dwellMinutes,
            onValueChange = { onChange(trigger.copy(dwellMinutes = it)) },
            label = stringResource(R.string.translation_automations_builder_dwellMinutes),
        )
    }
}

@Composable
private fun ScheduleTriggerFields(
    trigger: AutomationTriggerInput.Schedule,
    onChange: (AutomationTriggerInput) -> Unit,
) {
    Input(
        value = trigger.cronExpr,
        onValueChange = { onChange(trigger.copy(cronExpr = it)) },
        label = stringResource(R.string.translation_automations_builder_cronExpr),
    )
    Input(
        value = trigger.timezone,
        onValueChange = { onChange(trigger.copy(timezone = it)) },
        label = stringResource(R.string.translation_automations_builder_timezone),
    )
}

@Composable
private fun EventTriggerFields(
    trigger: AutomationTriggerInput.Event,
    onChange: (AutomationTriggerInput) -> Unit,
) {
    WireSelect(
        label = stringResource(R.string.translation_automations_builder_event),
        options = VEHICLE_EVENTS,
        selected = trigger.eventType,
        onSelect = { onChange(trigger.copy(eventType = it)) },
    )
}

// ── Conditions editor (the "Only If" section) ────────────────────────────────────────────────────────────────────

/**
 * The optional-conditions list editor (web `<ConditionBuilder>`). Renders one card per condition with its type picker,
 * essential fields, and a remove affordance, plus an add-row button; an empty list shows the friendly `noConditions`
 * empty-state so the section is never a blank box.
 */
@Composable
fun ConditionsEditor(
    conditions: List<AutomationConditionInput>,
    onChange: (List<AutomationConditionInput>) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        if (conditions.isEmpty()) {
            GlassPanel(padding = PanelPadding.Md) {
                EmptyState(message = stringResource(R.string.translation_automations_builder_noConditions))
            }
        } else {
            conditions.forEachIndexed { index, condition ->
                ConditionRow(
                    condition = condition,
                    onChange = { next -> onChange(conditions.replaceAt(index, next)) },
                    onRemove = { onChange(conditions.removeAt(index)) },
                )
            }
        }
        Button(
            label = stringResource(R.string.translation_automations_builder_addCondition),
            onClick = { onChange(conditions + createDefaultCondition(ConditionKind.Signal)) },
            variant = ButtonVariant.Outline,
            size = ButtonSize.Sm,
            leadingIcon = AutomationBuilderGlyphs.Plus,
        )
    }
}

@Composable
private fun ConditionRow(
    condition: AutomationConditionInput,
    onChange: (AutomationConditionInput) -> Unit,
    onRemove: () -> Unit,
) {
    GlassPanel(padding = PanelPadding.Md) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            KindSelect(
                label = stringResource(R.string.translation_automations_builder_conditionType),
                options = ConditionKind.entries.map { it to conditionKindLabel(it) },
                selected = condition.kind(),
                onSelect = { onChange(createDefaultCondition(it)) },
                modifier = Modifier.weight(1f),
            )
            IconButton(
                imageVector = AutomationBuilderGlyphs.Close,
                contentDescription = stringResource(R.string.translation_automations_builder_removeCondition),
                onClick = onRemove,
                variant = IconButtonVariant.Standard,
                size = IconSize.Sm,
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            when (condition) {
                is AutomationConditionInput.Signal -> SignalConditionFields(condition, onChange)
                is AutomationConditionInput.TimeWindow -> TimeWindowConditionFields(condition, onChange)
                is AutomationConditionInput.Geofence -> GeofenceConditionFields(condition, onChange)
                is AutomationConditionInput.OtherAutomation -> OtherAutomationConditionFields(condition, onChange)
            }
        }
    }
}

@Composable
private fun SignalConditionFields(
    condition: AutomationConditionInput.Signal,
    onChange: (AutomationConditionInput) -> Unit,
) {
    Input(
        value = condition.signal,
        onValueChange = { onChange(condition.copy(signal = it)) },
        label = stringResource(R.string.translation_automations_builder_signal),
    )
    WireSelect(
        label = stringResource(R.string.translation_automations_builder_operator),
        options = SIGNAL_OPERATORS,
        selected = condition.op,
        onSelect = { onChange(condition.copy(op = it)) },
    )
    NumberInput(
        value = condition.valueNum,
        onValueChange = { onChange(condition.copy(valueNum = it)) },
        label = stringResource(R.string.translation_automations_builder_valueNumber),
    )
}

@Composable
private fun TimeWindowConditionFields(
    condition: AutomationConditionInput.TimeWindow,
    onChange: (AutomationConditionInput) -> Unit,
) {
    Input(
        value = condition.startTime,
        onValueChange = { onChange(condition.copy(startTime = it)) },
        label = stringResource(R.string.translation_automations_builder_startTime),
    )
    Input(
        value = condition.endTime,
        onValueChange = { onChange(condition.copy(endTime = it)) },
        label = stringResource(R.string.translation_automations_builder_endTime),
    )
    Input(
        value = condition.timezone,
        onValueChange = { onChange(condition.copy(timezone = it)) },
        label = stringResource(R.string.translation_automations_builder_timezone),
    )
}

@Composable
private fun GeofenceConditionFields(
    condition: AutomationConditionInput.Geofence,
    onChange: (AutomationConditionInput) -> Unit,
) {
    LongInput(
        value = condition.placeId,
        onValueChange = { onChange(condition.copy(placeId = it ?: 0L)) },
        label = stringResource(R.string.translation_automations_builder_geofence),
    )
    Input(
        value = condition.state,
        onValueChange = { onChange(condition.copy(state = it)) },
        label = stringResource(R.string.translation_automations_builder_state),
    )
}

@Composable
private fun OtherAutomationConditionFields(
    condition: AutomationConditionInput.OtherAutomation,
    onChange: (AutomationConditionInput) -> Unit,
) {
    LongInput(
        value = condition.otherAutomationId,
        onValueChange = { onChange(condition.copy(otherAutomationId = it ?: 0L)) },
        label = stringResource(R.string.translation_automations_builder_otherAutomationId),
    )
    Input(
        value = condition.state,
        onValueChange = { onChange(condition.copy(state = it)) },
        label = stringResource(R.string.translation_automations_builder_state),
    )
}

// ── Actions editor (the "Then" section) ──────────────────────────────────────────────────────────────────────────

/**
 * The ordered-actions list editor (web `<ActionBuilder>`). Renders one card per action with its type picker, essential
 * fields, reorder (up/down) and remove affordances, plus an add-row button. Notify actions read their channel options
 * from the live [channels] list (web `useNotificationChannels`).
 */
@Composable
fun ActionsEditor(
    actions: List<AutomationActionInput>,
    channels: List<NotificationChannel>,
    onChange: (List<AutomationActionInput>) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        actions.forEachIndexed { index, action ->
            ActionRow(
                action = action,
                channels = channels,
                canMoveUp = index > 0,
                canMoveDown = index < actions.lastIndex,
                onChange = { next -> onChange(actions.replaceAt(index, next)) },
                onRemove = { onChange(actions.removeAt(index)) },
                onMoveUp = { onChange(actions.swap(index, index - 1)) },
                onMoveDown = { onChange(actions.swap(index, index + 1)) },
            )
        }
        Button(
            label = stringResource(R.string.translation_automations_builder_addAction),
            onClick = { onChange(actions + createDefaultAction(ActionKind.Command)) },
            variant = ButtonVariant.Outline,
            size = ButtonSize.Sm,
            leadingIcon = AutomationBuilderGlyphs.Plus,
        )
    }
}

@Composable
private fun ActionRow(
    action: AutomationActionInput,
    channels: List<NotificationChannel>,
    canMoveUp: Boolean,
    canMoveDown: Boolean,
    onChange: (AutomationActionInput) -> Unit,
    onRemove: () -> Unit,
    onMoveUp: () -> Unit,
    onMoveDown: () -> Unit,
) {
    GlassPanel(padding = PanelPadding.Md) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            KindSelect(
                label = stringResource(R.string.translation_automations_builder_actionType),
                options = ActionKind.entries.map { it to actionKindLabel(it) },
                selected = action.kind(),
                onSelect = { onChange(createDefaultAction(it)) },
                modifier = Modifier.weight(1f),
            )
            IconButton(
                imageVector = AutomationBuilderGlyphs.ChevronUp,
                contentDescription = stringResource(R.string.translation_automations_builder_moveUp),
                onClick = onMoveUp,
                enabled = canMoveUp,
                size = IconSize.Sm,
            )
            IconButton(
                imageVector = AutomationBuilderGlyphs.ChevronDown,
                contentDescription = stringResource(R.string.translation_automations_builder_moveDown),
                onClick = onMoveDown,
                enabled = canMoveDown,
                size = IconSize.Sm,
            )
            IconButton(
                imageVector = AutomationBuilderGlyphs.Close,
                contentDescription = stringResource(R.string.translation_automations_builder_removeAction),
                onClick = onRemove,
                size = IconSize.Sm,
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            when (action) {
                is AutomationActionInput.Command -> CommandActionFields(action, onChange)
                is AutomationActionInput.Notify -> NotifyActionFields(action, channels, onChange)
                is AutomationActionInput.SetSetting -> SetSettingActionFields(action, onChange)
                is AutomationActionInput.CallAutomation -> CallActionFields(action, onChange)
            }
        }
    }
}

@Composable
private fun CommandActionFields(
    action: AutomationActionInput.Command,
    onChange: (AutomationActionInput) -> Unit,
) {
    Input(
        value = action.commandName,
        onValueChange = { onChange(action.copy(commandName = it)) },
        label = stringResource(R.string.translation_automations_builder_command),
    )
}

@Composable
private fun NotifyActionFields(
    action: AutomationActionInput.Notify,
    channels: List<NotificationChannel>,
    onChange: (AutomationActionInput) -> Unit,
) {
    if (channels.isEmpty()) {
        Caption(stringResource(R.string.translation_automations_builder_noChannels))
    } else {
        Select(
            label = stringResource(R.string.translation_automations_builder_channel),
            options = channels.map { SelectOption(value = it.id.toString(), label = it.name) },
            selectedValue = action.channelId.takeIf { it > 0L }?.toString(),
            onSelect = { onChange(action.copy(channelId = it.toLongOrNull() ?: 0L)) },
        )
    }
    Input(
        value = action.template,
        onValueChange = { onChange(action.copy(template = it)) },
        label = stringResource(R.string.translation_automations_builder_notifyMessage),
    )
}

@Composable
private fun SetSettingActionFields(
    action: AutomationActionInput.SetSetting,
    onChange: (AutomationActionInput) -> Unit,
) {
    Input(
        value = action.settingKey,
        onValueChange = { onChange(action.copy(settingKey = it)) },
        label = stringResource(R.string.translation_automations_builder_settingKey),
    )
    Input(
        value = action.valueText.orEmpty(),
        onValueChange = { onChange(action.copy(valueText = it, valueNum = null, valueBool = null)) },
        label = stringResource(R.string.translation_automations_builder_valueText),
    )
}

@Composable
private fun CallActionFields(
    action: AutomationActionInput.CallAutomation,
    onChange: (AutomationActionInput) -> Unit,
) {
    LongInput(
        value = action.targetAutomationId,
        onValueChange = { onChange(action.copy(targetAutomationId = it ?: 0L)) },
        label = stringResource(R.string.translation_automations_builder_targetAutomationId),
    )
}

// ── Shared field helpers ─────────────────────────────────────────────────────────────────────────────────────────

/** A select over a list of raw wire values (operators / events / states), each shown verbatim as its own label. */
@Composable
private fun WireSelect(
    label: String,
    options: List<String>,
    selected: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Select(
        label = label,
        options = options.map { SelectOption(value = it, label = it) },
        selectedValue = selected,
        onSelect = onSelect,
        modifier = modifier,
    )
}

/** A select over a typed kind enum, each paired with its localized label. */
@Composable
private fun <T> KindSelect(
    label: String,
    options: List<Pair<T, String>>,
    selected: T,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
) {
    Select(
        label = label,
        options = options.map { (value, text) -> SelectOption(value = value.toString(), label = text) },
        selectedValue = selected.toString(),
        onSelect = { picked -> options.firstOrNull { it.first.toString() == picked }?.let { onSelect(it.first) } },
        modifier = modifier,
    )
}

/** A numeric (decimal) input bound to a nullable [Double]; a blank field clears the value. */
@Composable
private fun NumberInput(
    value: Double?,
    onValueChange: (Double?) -> Unit,
    label: String,
) {
    Input(
        value = value?.let { formatNumber(it) } ?: "",
        onValueChange = { onValueChange(parseDecimal(it)) },
        label = label,
        keyboardType = KeyboardType.Number,
    )
}

/** A numeric (integer) input bound to a nullable [Int]; a blank field clears the value. */
@Composable
private fun IntInput(
    value: Int?,
    onValueChange: (Int?) -> Unit,
    label: String,
) {
    Input(
        value = value?.toString() ?: "",
        onValueChange = { onValueChange(it.trim().toIntOrNull()) },
        label = label,
        keyboardType = KeyboardType.Number,
    )
}

/** A numeric (integer) input bound to a [Long]; a blank field clears the value. */
@Composable
private fun LongInput(
    value: Long,
    onValueChange: (Long?) -> Unit,
    label: String,
) {
    Input(
        value = value.takeIf { it > 0L }?.toString() ?: "",
        onValueChange = { onValueChange(it.trim().toLongOrNull()) },
        label = label,
        keyboardType = KeyboardType.Number,
    )
}

@Composable
private fun conditionKindLabel(kind: ConditionKind): String =
    when (kind) {
        ConditionKind.Signal -> stringResource(R.string.translation_automations_builder_signal)
        ConditionKind.TimeWindow -> stringResource(R.string.translation_automations_builder_time)
        ConditionKind.Geofence -> stringResource(R.string.translation_automations_builder_geofence)
        ConditionKind.OtherAutomation -> stringResource(R.string.translation_automations_builder_otherAutomationId)
    }

@Composable
private fun actionKindLabel(kind: ActionKind): String =
    when (kind) {
        ActionKind.Command -> stringResource(R.string.translation_automations_builder_command)
        ActionKind.Notify -> stringResource(R.string.translation_automations_builder_notifyMessage)
        ActionKind.SetSetting -> stringResource(R.string.translation_automations_builder_settingKey)
        ActionKind.CallAutomation -> stringResource(R.string.translation_automations_builder_targetAutomationId)
    }

/** Renders a double without a trailing `.0` so whole numbers read cleanly in the field. */
private fun formatNumber(value: Double): String = if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()

/** Parses a trimmed decimal string to a [Double] (via the JDK parser), or null when the field is blank/invalid. */
private fun parseDecimal(text: String): Double? {
    val trimmed = text.trim()
    if (trimmed.isEmpty()) return null
    return runCatching { java.lang.Double.parseDouble(trimmed) }.getOrNull()
}

private fun <T> List<T>.replaceAt(
    index: Int,
    value: T,
): List<T> = toMutableList().also { it[index] = value }

private fun <T> List<T>.removeAt(index: Int): List<T> = toMutableList().also { it.removeAt(index) }

private fun <T> List<T>.swap(
    a: Int,
    b: Int,
): List<T> = toMutableList().also { val tmp = it[a]; it[a] = it[b]; it[b] = tmp }
