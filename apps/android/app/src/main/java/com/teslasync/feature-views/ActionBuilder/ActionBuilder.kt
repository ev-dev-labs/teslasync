// The native Jetpack Compose + Material 3 ActionBuilder feature view — a parity port of
// web/src/features/automations/pages/ActionBuilder.tsx, the controlled action-list editor inside the
// automation builder. It reproduces the web composition: a vertical list of GlassPanel "action cards", each
// carrying a 1-based index, an action-type Select, the kind-specific field set, and a move-up / move-down /
// remove control column — followed by a ghost "Add Action" button. The web component binds no data feed (its
// only hook is `useTranslation`; `actions` + `channels` are props and edits flow through `onChange`) and
// performs no async work, so there is no skeleton / error / stale / offline branch in the source to
// reproduce. The surface's real, render-driven states ARE reproduced: an empty `actions` list (just the Add
// button — the web map over `[]` renders nothing), each of the four action kinds with its own fields, the
// command-params JSON validation (cleared / valid object / not-an-object / unparseable), the
// "No channels configured" notify fallback, and the text/number/boolean value-type switch.
//
// Composition: [ActionBuilder] is the stateful entry (owns the editable list — the web parent's state —
// records the one-shot `view.opened` diagnostic, and resolves strings + option lists). [ActionBuilderContent]
// is the stateless renderer that is the unit/UI-test entry point. The pure model (action factory, value
// coercion, list ops, JSON parse, i18n fold + fallback) lives in ActionBuilderModel.kt so this file stays a
// thin render layer. Every chrome string resolves through the i18n facade (see [rememberActionBuilderStrings])
// and every interactive control carries an accessible name (the icon-only move/remove buttons take an
// explicit contentDescription; the Selects/Inputs/Textareas carry visible labels). The Trash glyph is absent
// from the shared catalog and editing shared files is out of scope here, so it is authored locally below as a
// 24×24 stroked vector — the same approach CronParser and the shared glyph sets take.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ActionBuilder) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.actionbuilder

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
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
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.Textarea
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private const val PARAMS_MIN_LINES = 2
private const val PARAMS_MAX_LINES = 6
private const val MESSAGE_MIN_LINES = 2
private const val MESSAGE_MAX_LINES = 4

/**
 * Stateful entry point. Spins up the [ActionBuilderViewModel] (carrying only the `view.opened` diagnostic —
 * this surface binds no feed), records that diagnostic once, resolves the localized strings + option lists,
 * and owns the editable action list (the web parent's state). Edits update the local list and are mirrored to
 * [onActionsChange] so a host (the automation editor page) can observe them, exactly as the web `onChange`
 * prop reports up.
 *
 * @param initialActions the action list to seed the editor with (web `actions` prop).
 * @param channels the notification channels the notify action can target (web `channels` prop).
 * @param onActionsChange invoked with the full new list after every edit (web `onChange`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param instanceKey unique key per placement so multiple instances keep independent state holders.
 */
@Composable
fun ActionBuilder(
    modifier: Modifier = Modifier,
    initialActions: List<ActionStepInput> = emptyList(),
    channels: List<ActionChannel> = emptyList(),
    onActionsChange: (List<ActionStepInput>) -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = ActionBuilderRegistration.SLUG,
) {
    val viewModel: ActionBuilderViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { ActionBuilderViewModel(logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val context = LocalContext.current
    val strings = rememberActionBuilderStrings()
    val actionTypeOptions = remember(context) { buildActionTypeOptions { name -> context.optionalString(name) } }
    val commandOptions = remember(context) { buildCommandOptions { name -> context.optionalString(name) } }

    var actions by remember { mutableStateOf(initialActions) }

    ActionBuilderContent(
        actions = actions,
        channels = channels,
        strings = strings,
        actionTypeOptions = actionTypeOptions,
        commandOptions = commandOptions,
        onActionsChange = { next ->
            actions = next
            onActionsChange(next)
        },
        modifier = modifier,
    )
}

/**
 * Stateless renderer — the unit/UI-test entry point. Lays out the action cards followed by the Add button
 * (web `<div className="space-y-3">{actions.map(…)}<UiButton>Add Action</UiButton></div>`). An empty
 * [actions] list renders just the Add button, mirroring the web map over `[]`. All list mutations are pure
 * (ActionBuilderModel) and reported through [onActionsChange]; this composable owns no list state.
 */
@Composable
fun ActionBuilderContent(
    actions: List<ActionStepInput>,
    channels: List<ActionChannel>,
    strings: ActionBuilderStrings,
    actionTypeOptions: List<LabeledValue>,
    commandOptions: List<LabeledValue>,
    onActionsChange: (List<ActionStepInput>) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        actions.forEachIndexed { index, action ->
            ActionCard(
                index = index,
                total = actions.size,
                action = action,
                channels = channels,
                strings = strings,
                actionTypeOptions = actionTypeOptions,
                commandOptions = commandOptions,
                onReplace = { next -> onActionsChange(replaceAction(actions, index, next)) },
                onMove = { direction -> onActionsChange(moveAction(actions, index, direction)) },
                onRemove = { onActionsChange(removeAction(actions, index)) },
            )
        }

        Button(
            label = strings.addAction,
            onClick = { onActionsChange(addAction(actions, defaultChannelId(channels))) },
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            leadingIcon = TeslaGlyphs.Plus,
        )
    }
}

/**
 * One action card — web `<GlassPanel className="p-4">`: the 1-based index, a weighted column holding the
 * action-type Select (its label shown only on the first card, web `index === 0 ? … : undefined`) and the
 * kind-specific fields, and the move/remove control column.
 */
@Composable
private fun ActionCard(
    index: Int,
    total: Int,
    action: ActionStepInput,
    channels: List<ActionChannel>,
    strings: ActionBuilderStrings,
    actionTypeOptions: List<LabeledValue>,
    commandOptions: List<LabeledValue>,
    onReplace: (ActionStepInput) -> Unit,
    onMove: (Int) -> Unit,
    onRemove: () -> Unit,
) {
    val defaultChannel = remember(channels) { defaultChannelId(channels) }
    GlassPanel(padding = PanelPadding.Lg) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.Top,
        ) {
            Caption(text = "${index + 1}.", modifier = Modifier.padding(top = Spacing.md))
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Select(
                    options = actionTypeOptions.map { SelectOption(it.value, it.label) },
                    selectedValue = action.kind.wireValue,
                    onSelect = { value ->
                        val kind = AutomationActionKind.fromWire(value) ?: action.kind
                        onReplace(createDefaultAction(kind, defaultChannel))
                    },
                    label = if (index == 0) strings.actionType else null,
                )
                ActionFields(
                    action = action,
                    channels = channels,
                    strings = strings,
                    commandOptions = commandOptions,
                    onChange = onReplace,
                )
            }
            MoveRemoveColumn(
                canMoveUp = index > 0,
                canMoveDown = index < total - 1,
                strings = strings,
                onMove = onMove,
                onRemove = onRemove,
            )
        }
    }
}

/** The move-up / move-down / remove control column — web `<div className="flex flex-col gap-1">`. */
@Composable
private fun MoveRemoveColumn(
    canMoveUp: Boolean,
    canMoveDown: Boolean,
    strings: ActionBuilderStrings,
    onMove: (Int) -> Unit,
    onRemove: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        IconButton(
            imageVector = TeslaGlyphs.ChevronUp,
            contentDescription = strings.moveUp,
            onClick = { onMove(-1) },
            enabled = canMoveUp,
            variant = IconButtonVariant.Standard,
            size = IconSize.Md,
        )
        IconButton(
            imageVector = TeslaGlyphs.ChevronDown,
            contentDescription = strings.moveDown,
            onClick = { onMove(1) },
            enabled = canMoveDown,
            variant = IconButtonVariant.Standard,
            size = IconSize.Md,
        )
        IconButton(
            imageVector = ActionBuilderGlyphs.Trash,
            contentDescription = strings.removeAction,
            onClick = onRemove,
            variant = IconButtonVariant.Standard,
            size = IconSize.Md,
            tint = TeslaTokens.status.danger,
        )
    }
}

/**
 * The kind-specific field set — web `ActionFields`' `switch (action.kind)`. Each branch is a full-width
 * column of fields (the web `flex flex-wrap gap-3` row, stacked for a phone-idiomatic layout); the shared
 * Input/Select/Textarea already fill their width.
 */
@Composable
private fun ActionFields(
    action: ActionStepInput,
    channels: List<ActionChannel>,
    strings: ActionBuilderStrings,
    commandOptions: List<LabeledValue>,
    onChange: (ActionStepInput) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        when (action) {
            is ActionStepInput.Command -> CommandFields(action, strings, commandOptions, onChange)
            is ActionStepInput.Notify -> NotifyFields(action, channels, strings, onChange)
            is ActionStepInput.SetSetting -> SetSettingFields(action, strings, onChange)
            is ActionStepInput.CallAutomation -> CallAutomationFields(action, strings, onChange)
        }
    }
}

/**
 * Command fields — the command Select (with the leading `Select command...` empty row, web `commandOptions`)
 * and the optional JSON params Textarea. The params text + error are local edit state (the web ActionFields
 * `useState`), re-seeded whenever the bound [action] changes so a committed-and-reformatted object shows the
 * pretty-printed JSON (web `useEffect([action])`). Only a valid JSON object commits up; a non-object or
 * unparseable value surfaces the matching error and leaves the action untouched (web onChange branch).
 */
@Composable
private fun CommandFields(
    action: ActionStepInput.Command,
    strings: ActionBuilderStrings,
    commandOptions: List<LabeledValue>,
    onChange: (ActionStepInput) -> Unit,
) {
    val options =
        remember(commandOptions, strings.selectCommand) {
            listOf(SelectOption("", strings.selectCommand)) + commandOptions.map { SelectOption(it.value, it.label) }
        }
    var paramsText by remember(action) { mutableStateOf(formatCommandParams(action.commandParams)) }
    var paramsError by remember(action) { mutableStateOf<String?>(null) }

    Select(
        options = options,
        selectedValue = action.commandName,
        onSelect = { onChange(action.copy(commandName = it)) },
        label = strings.command,
    )
    Textarea(
        value = paramsText,
        onValueChange = { next ->
            paramsText = next
            when (val parse = parseCommandParams(next)) {
                is CommandParamsParse.Cleared -> {
                    paramsError = null
                    onChange(action.copy(commandParams = null))
                }
                is CommandParamsParse.Valid -> {
                    paramsError = null
                    onChange(action.copy(commandParams = parse.params))
                }
                is CommandParamsParse.NotObject -> {
                    paramsError = strings.commandParamsObjectError
                }
                is CommandParamsParse.Invalid -> {
                    paramsError = parse.message ?: strings.invalidJson
                }
            }
        },
        label = strings.commandParams,
        hint = strings.commandParamsHint,
        errorText = paramsError,
        minLines = PARAMS_MIN_LINES,
        maxLines = PARAMS_MAX_LINES,
    )
}

/**
 * Notify fields — the channel Select and the message Textarea. When no channels are configured the Select
 * shows the single `No channels configured` option (web `channelOptions.length > 0 ? … : …`); disabled
 * channels render but cannot be chosen (web `disabled: !enabled`).
 */
@Composable
private fun NotifyFields(
    action: ActionStepInput.Notify,
    channels: List<ActionChannel>,
    strings: ActionBuilderStrings,
    onChange: (ActionStepInput) -> Unit,
) {
    val options =
        remember(channels, strings.noChannels) {
            val resolved = channelOptions(channels)
            if (resolved.isEmpty()) {
                listOf(SelectOption("0", strings.noChannels))
            } else {
                val disabled = disabledChannelIds(channels)
                resolved.map { SelectOption(it.value, it.label, enabled = it.value !in disabled) }
            }
        }

    Select(
        options = options,
        selectedValue = action.channelId.toString(),
        onSelect = { onChange(action.copy(channelId = jsParseInt(it))) },
        label = strings.channel,
    )
    Textarea(
        value = action.template,
        onValueChange = { onChange(action.copy(template = it)) },
        label = strings.notifyMessage,
        hint = strings.notifyHint,
        minLines = MESSAGE_MIN_LINES,
        maxLines = MESSAGE_MAX_LINES,
    )
}

/**
 * Set-Setting fields — the setting-key Input, the value-type Select, and the value editor that switches
 * between a boolean Select (True/False) and a text/number Input, web `valueKind === 'boolean' ? … : …`.
 */
@Composable
private fun SetSettingFields(
    action: ActionStepInput.SetSetting,
    strings: ActionBuilderStrings,
    onChange: (ActionStepInput) -> Unit,
) {
    val valueKind = settingValueKind(action)
    val value = settingValueText(action)

    Input(
        value = action.settingKey,
        onValueChange = { onChange(action.copy(settingKey = it)) },
        label = strings.settingKey,
        hint = strings.settingKeyHint,
    )
    Select(
        options =
            listOf(
                SelectOption(SettingValueKind.Text.wireValue, strings.valueText),
                SelectOption(SettingValueKind.Number.wireValue, strings.valueNumber),
                SelectOption(SettingValueKind.Boolean.wireValue, strings.valueBoolean),
            ),
        selectedValue = valueKind.wireValue,
        onSelect = { onChange(actionWithSettingValue(action, SettingValueKind.fromWire(it), value)) },
        label = strings.valueType,
    )
    if (valueKind == SettingValueKind.Boolean) {
        Select(
            options =
                listOf(
                    SelectOption("true", strings.valueTrue),
                    SelectOption("false", strings.valueFalse),
                ),
            selectedValue = value,
            onSelect = { onChange(actionWithSettingValue(action, valueKind, it)) },
            label = strings.value,
        )
    } else {
        Input(
            value = value,
            onValueChange = { onChange(actionWithSettingValue(action, valueKind, it)) },
            label = strings.value,
            hint = if (valueKind == SettingValueKind.Number) strings.valueNumberHint else strings.valueTextHint,
            keyboardType = if (valueKind == SettingValueKind.Number) KeyboardType.Number else KeyboardType.Text,
        )
    }
}

/** Call-Automation field — the target automation id Input. A 0 id renders empty (web `value || ''`). */
@Composable
private fun CallAutomationFields(
    action: ActionStepInput.CallAutomation,
    strings: ActionBuilderStrings,
    onChange: (ActionStepInput) -> Unit,
) {
    Input(
        value = if (action.targetAutomationId != 0) action.targetAutomationId.toString() else "",
        onValueChange = { onChange(action.copy(targetAutomationId = jsParseInt(it))) },
        label = strings.targetAutomationId,
        keyboardType = KeyboardType.Number,
    )
}

/**
 * Builds the localized [ActionBuilderStrings] from the i18n facade (P1/S10). Every key resolves by name
 * through the generated catalog, falling back to the web's `t(key, fallback)` default for the keys the
 * catalog does not (yet) define — see the model header. Remembered against the context so a locale change
 * re-projects the surface.
 */
@Composable
private fun rememberActionBuilderStrings(): ActionBuilderStrings {
    val context = LocalContext.current
    return remember(context) {
        buildActionBuilderStrings { name -> context.optionalString(name) }
    }
}

/**
 * Optional by-name read from the Android string catalog — the production seam that reproduces web
 * `t(key, default)`. `getIdentifier` is the only way to attempt a key that may be absent (a compile-time
 * `R.string` reference cannot express "resolve if present, else fall back"), so `DiscouragedApi` is
 * suppressed. Release builds keep resource names (resource shrinking is off — see app/build.gradle.kts), so
 * the by-name lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

/**
 * Locally authored line-style Trash glyph (lucide `trash2`), absent from the shared [TeslaGlyphs] catalog and
 * outside this surface's allowed-files scope, drawn as a 24×24 stroked [ImageVector] and recolored at render
 * time by the [IconButton] tint: a lidded can with a handle and two inner streaks.
 */
private object ActionBuilderGlyphs {
    /** Trash-can glyph — the web lucide `Trash2` icon used by the remove-action control. */
    val Trash: ImageVector =
        trashStroked("ActionBuilderTrash") {
            moveTo(4f, 7f)
            lineTo(20f, 7f)
            moveTo(9f, 4f)
            lineTo(15f, 4f)
            moveTo(6f, 7f)
            lineTo(7f, 20f)
            lineTo(17f, 20f)
            lineTo(18f, 7f)
            moveTo(10f, 10.5f)
            lineTo(10.5f, 16.5f)
            moveTo(14f, 10.5f)
            lineTo(13.5f, 16.5f)
        }
}

private fun trashStroked(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

// ---- design-time previews --------------------------------------------------------------------------------

private val PREVIEW_CHANNELS =
    listOf(
        ActionChannel(id = 1, name = "Family Telegram", kind = "telegram", enabled = true),
        ActionChannel(id = 2, name = "Ops Slack", kind = "slack", enabled = false),
    )

private val PREVIEW_ACTIONS: List<ActionStepInput> =
    listOf(
        ActionStepInput.Command(
            commandName = "set_charge_limit",
            commandParams =
                buildJsonObject {
                    put("percent", 80)
                },
        ),
        ActionStepInput.Notify(channelId = 1, template = "Car is warming up!"),
        ActionStepInput.SetSetting(settingKey = "charge_limit", valueNum = 80.0),
        ActionStepInput.CallAutomation(targetAutomationId = 12),
    )

@Composable
private fun previewStrings(): ActionBuilderStrings = buildActionBuilderStrings { null }

@Composable
private fun previewActionTypeOptions(): List<LabeledValue> = buildActionTypeOptions { null }

@Composable
private fun previewCommandOptions(): List<LabeledValue> = buildCommandOptions { null }

@Preview(name = "ActionBuilder — populated", showBackground = true)
@Composable
private fun ActionBuilderPopulatedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ActionBuilderContent(
            actions = PREVIEW_ACTIONS,
            channels = PREVIEW_CHANNELS,
            strings = previewStrings(),
            actionTypeOptions = previewActionTypeOptions(),
            commandOptions = previewCommandOptions(),
            onActionsChange = {},
            modifier = Modifier.padding(Spacing.md),
        )
    }
}

@Preview(name = "ActionBuilder — empty", showBackground = true)
@Composable
private fun ActionBuilderEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ActionBuilderContent(
            actions = emptyList(),
            channels = emptyList(),
            strings = previewStrings(),
            actionTypeOptions = previewActionTypeOptions(),
            commandOptions = previewCommandOptions(),
            onActionsChange = {},
            modifier = Modifier.padding(Spacing.md),
        )
    }
}
