// Pure, framework-free model + projection for the ActionBuilder feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/automations/pages/ActionBuilder.tsx). No Compose, no Android, no HTTP: every type here
// is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin render
// layer.
//
// The web component is a CONTROLLED sub-component of the automation editor: it receives its `actions` and
// `channels` as props from the parent (AutomationBuilderPage) and reports edits through `onChange`. It binds
// NO data feed of its own (its only hook is `useTranslation`) and performs no async work, so there is no
// loading / error / stale / offline branch in the source to reproduce. Its real, render-driven states ARE
// reproduced here and by the view: an empty `actions` list (just the "Add Action" button), the four action
// kinds each with their own field set, the command-params JSON validation states (cleared / valid object /
// not-an-object / unparseable), the "No channels configured" fallback, and the text/number/boolean
// value-type switch for the Set-Setting kind — exactly the web `switch (action.kind)` + `{paramsError}` +
// `channelOptions.length > 0 ? … : …` + `valueKind === …` contract.
//
// JavaScript numeric coercion is reproduced precisely because the web relies on it at the edit boundary:
// `Number.parseInt(value, 10) || 0` (channel id, automation id), `Number.parseFloat(value) || 0` (numeric
// setting value), and `String(value_num ?? 0)` (which prints whole numbers without a trailing `.0`). A
// drifting interpretation would silently change the value committed back to the parent, so [jsParseInt],
// [jsParseFloat] and [jsNumberToString] pin the leading-number parse and integer-string formatting.
//
// i18n note (web parity): every label routes through the P1/S10 facade by name. The web reads dotted
// i18next keys (`t('automations.builder.actionType', 'Action Type')`, …). The generated, drift-checked
// catalog (ADR-014, never hand-authored) folds these to `translation_automations_builder_actionType` etc.
// Most `automations.builder.*` keys plus `common.true` / `common.false` exist in the catalog and resolve
// live; the `automations.actions.*`, `automations.commandGroups.*`, `automations.commands.*` and
// `automations.builder.commandParamsObjectError` keys are not yet generated, so — exactly as the CronParser
// precedent does — [resolveOptional] attempts the folded catalog key and otherwise falls back to the web's
// effective string (which, for those keys, is precisely what i18next returns today). No English literal is
// ever hard-coded in the composable; the fallback constants live here beside the key they back.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ActionBuilder — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and PascalCase segments are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as every sibling feature-view surface does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.actionbuilder

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

/**
 * Canonical metadata for this surface. There is no web dashboard-registry entry to mirror (the web
 * `ActionBuilder` is a composed sub-component of the automation editor, not a draggable widget), so this
 * object carries only the cross-cutting concern every surface owes: the diagnostics [SLUG] emitted with the
 * one-shot `view.opened` event (P1/S11).
 */
object ActionBuilderRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ActionBuilder"
}

/**
 * The four automation action kinds — the native port of the web `AutomationActionKind` union. [wireValue]
 * is the exact discriminator the API/web use (`action_command`, …); it is the stable identity the
 * action-type [Select] binds to, so it must never drift.
 */
enum class AutomationActionKind(
    val wireValue: String,
) {
    Command("action_command"),
    Notify("action_notify"),
    SetSetting("action_set_setting"),
    CallAutomation("action_call_automation"),
    ;

    companion object {
        /** Resolves a [wireValue] back to its kind, or `null` when unknown (a defensive guard for Select input). */
        fun fromWire(value: String): AutomationActionKind? = entries.firstOrNull { it.wireValue == value }
    }
}

/**
 * A single editable automation action — the native port of the web `AutomationActionStepInput` discriminated
 * union. Each variant carries exactly the fields the matching web interface declares (snake_case JSON tags
 * map to these camelCase properties); nullable setting values are pointers so "unset" is distinguishable
 * from zero (web `value_num?: number | null`).
 */
sealed interface ActionStepInput {
    /** The discriminator backing the action-type Select. */
    val kind: AutomationActionKind

    /** Web `{ kind: 'action_command', command_name, command_params? }`. */
    data class Command(
        val commandName: String,
        val commandParams: JsonObject? = null,
    ) : ActionStepInput {
        override val kind: AutomationActionKind get() = AutomationActionKind.Command
    }

    /** Web `{ kind: 'action_notify', channel_id, template }`. */
    data class Notify(
        val channelId: Int,
        val template: String,
    ) : ActionStepInput {
        override val kind: AutomationActionKind get() = AutomationActionKind.Notify
    }

    /** Web `{ kind: 'action_set_setting', setting_key, value_text? | value_num? | value_bool? }`. */
    data class SetSetting(
        val settingKey: String,
        val valueText: String? = null,
        val valueNum: Double? = null,
        val valueBool: Boolean? = null,
    ) : ActionStepInput {
        override val kind: AutomationActionKind get() = AutomationActionKind.SetSetting
    }

    /** Web `{ kind: 'action_call_automation', target_automation_id }`. */
    data class CallAutomation(
        val targetAutomationId: Int,
    ) : ActionStepInput {
        override val kind: AutomationActionKind get() = AutomationActionKind.CallAutomation
    }
}

/**
 * The Set-Setting value editor's three modes — web `SettingValueKind = 'text' | 'number' | 'boolean'`.
 * [wireValue] is the exact option value the web `<Select>` binds to, kept stable so the value-type dropdown
 * round-trips through [fromWire].
 */
enum class SettingValueKind(
    val wireValue: String,
) {
    Text("text"),
    Number("number"),
    Boolean("boolean"),
    ;

    companion object {
        /** Resolves a [wireValue] back to its mode, defaulting to [Text] (web's fallthrough branch). */
        fun fromWire(value: String): SettingValueKind = entries.firstOrNull { it.wireValue == value } ?: Text
    }
}

/**
 * A notification channel the notify-action Select chooses among — the native port of the web
 * `NotificationChannel` (only the fields this surface reads: [id], [name], [kind], [enabled]). A disabled
 * channel still renders but cannot be selected (web `disabled: !channel.enabled`).
 */
data class ActionChannel(
    val id: Int,
    val name: String,
    val kind: String,
    val enabled: Boolean,
)

/** A render-ready `value`/`label` pair for a [Select] option — decouples the model from the UI component. */
data class LabeledValue(
    val value: String,
    val label: String,
)

// ---- action factory + value coercion (web helpers) -------------------------------------------------------

/**
 * The default channel the notify action seeds with — web
 * `channels.find(c => c.enabled)?.id ?? channels[0]?.id ?? 0`: the first enabled channel, else the first
 * channel, else 0.
 */
fun defaultChannelId(channels: List<ActionChannel>): Int = channels.firstOrNull { it.enabled }?.id ?: channels.firstOrNull()?.id ?: 0

/**
 * Builds the default action for a freshly chosen [kind] — web `createDefaultAction(kind, channelId)`. A new
 * command defaults to `climate_on`, a notify to the [channelId] with an empty template, a set-setting to an
 * empty text value, and a call-automation to id 0.
 */
fun createDefaultAction(
    kind: AutomationActionKind,
    channelId: Int = 0,
): ActionStepInput =
    when (kind) {
        AutomationActionKind.Command -> ActionStepInput.Command(commandName = "climate_on")
        AutomationActionKind.Notify -> ActionStepInput.Notify(channelId = channelId, template = "")
        AutomationActionKind.SetSetting -> ActionStepInput.SetSetting(settingKey = "", valueText = "")
        AutomationActionKind.CallAutomation -> ActionStepInput.CallAutomation(targetAutomationId = 0)
    }

/**
 * The active value mode for a set-setting action — web `settingValueKind`: a non-null `value_num` is numeric,
 * a non-null `value_bool` is boolean, otherwise text.
 */
fun settingValueKind(action: ActionStepInput.SetSetting): SettingValueKind =
    when {
        action.valueNum != null -> SettingValueKind.Number
        action.valueBool != null -> SettingValueKind.Boolean
        else -> SettingValueKind.Text
    }

/**
 * The string the value editor shows for the current [SettingValueKind] — web
 * `valueKind === 'number' ? String(value_num ?? 0) : valueKind === 'boolean' ? String(value_bool ?? false)
 * : (value_text ?? '')`. Numbers print with JavaScript's integer-without-decimal rule (see [jsNumberToString]).
 */
fun settingValueText(action: ActionStepInput.SetSetting): String =
    when (settingValueKind(action)) {
        SettingValueKind.Number -> jsNumberToString(action.valueNum ?: 0.0)
        SettingValueKind.Boolean -> (action.valueBool ?: false).toString()
        SettingValueKind.Text -> action.valueText ?: ""
    }

/**
 * Re-encodes a set-setting action when the value or value-type changes — web `actionWithSettingValue`.
 * Switching kinds drops the other-typed fields (only the chosen value is carried), exactly as the web helper
 * returns a fresh object with a single value field. Numeric/boolean parsing reproduces the web coercion
 * (`Number.parseFloat(value) || 0`, `value === 'true'`).
 */
fun actionWithSettingValue(
    action: ActionStepInput.SetSetting,
    kind: SettingValueKind,
    value: String,
): ActionStepInput.SetSetting =
    when (kind) {
        SettingValueKind.Number -> ActionStepInput.SetSetting(settingKey = action.settingKey, valueNum = jsParseFloat(value))
        SettingValueKind.Boolean -> ActionStepInput.SetSetting(settingKey = action.settingKey, valueBool = value == "true")
        SettingValueKind.Text -> ActionStepInput.SetSetting(settingKey = action.settingKey, valueText = value)
    }

// ---- immutable list operations (web onChange callbacks) --------------------------------------------------

/** Appends a default command action seeded with [channelId] — web `addAction`. */
fun addAction(
    actions: List<ActionStepInput>,
    channelId: Int,
): List<ActionStepInput> = actions + createDefaultAction(AutomationActionKind.Command, channelId)

/** Removes the action at [index] — web `removeAction` (`filter((_, i) => i !== index)`). */
fun removeAction(
    actions: List<ActionStepInput>,
    index: Int,
): List<ActionStepInput> = actions.filterIndexed { currentIndex, _ -> currentIndex != index }

/** Replaces the action at [index] with [next] — web `replaceAction` (`map((a, i) => i === index ? next : a)`). */
fun replaceAction(
    actions: List<ActionStepInput>,
    index: Int,
    next: ActionStepInput,
): List<ActionStepInput> = actions.mapIndexed { currentIndex, action -> if (currentIndex == index) next else action }

/**
 * Swaps the action at [index] with its neighbour in [direction] (`-1` up, `+1` down) — web `moveAction`.
 * Returns the list unchanged when the move would fall off either end (web `if (target < 0 || …) return`).
 */
fun moveAction(
    actions: List<ActionStepInput>,
    index: Int,
    direction: Int,
): List<ActionStepInput> {
    val target = index + direction
    if (target < 0 || target >= actions.size) return actions
    val next = actions.toMutableList()
    next[index] = actions[target]
    next[target] = actions[index]
    return next
}

// ---- command-params JSON parsing (web ActionFields textarea onChange) -------------------------------------

private val prettyJson =
    Json {
        prettyPrint = true
        prettyPrintIndent = "  "
    }

/**
 * Pretty-prints the command params for the textarea — web `JSON.stringify(command_params, null, 2)`. `null`
 * params render as the empty string (web `command_params ? … : ''`).
 */
fun formatCommandParams(params: JsonObject?): String = params?.let { prettyJson.encodeToString(JsonObject.serializer(), it) } ?: ""

/**
 * The outcome of parsing the command-params textarea — the native port of the web onChange branch
 * (`!nextText.trim()` → clear; `JSON.parse` → object check; catch → error). Kept as data so the pure parse
 * is unit-tested and the composable only maps the outcome onto state + an i18n message.
 */
sealed interface CommandParamsParse {
    /** Blank input — web clears the error and sets `command_params: undefined`. */
    data object Cleared : CommandParamsParse

    /** Valid JSON object — web `setParamsError(null); onChange({ …, command_params: parsed })`. */
    data class Valid(
        val params: JsonObject,
    ) : CommandParamsParse

    /** Parsed but not an object (array/scalar/null) — web `Params must be a JSON object.`. */
    data object NotObject : CommandParamsParse

    /** Unparseable — web shows `error.message` (or the localized `Invalid JSON` when absent). */
    data class Invalid(
        val message: String?,
    ) : CommandParamsParse
}

/**
 * Parses the command-params textarea text — web ActionFields onChange. Reproduces the web `isCommandParams`
 * guard exactly: a value is acceptable only when it is a JSON object (kotlinx [JsonObject]), never an array,
 * scalar, or null.
 */
fun parseCommandParams(text: String): CommandParamsParse {
    if (text.isBlank()) return CommandParamsParse.Cleared
    return runCatching { Json.parseToJsonElement(text) }.fold(
        onSuccess = { parsed -> if (parsed is JsonObject) CommandParamsParse.Valid(parsed) else CommandParamsParse.NotObject },
        onFailure = { error -> CommandParamsParse.Invalid(error.message) },
    )
}

// ---- JavaScript numeric coercion (pinned for parity) -----------------------------------------------------

private val LEADING_INT = Regex("""^[+-]?\d+""")
private val LEADING_FLOAT = Regex("""^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?""")

/**
 * Reproduces web `Number.parseInt(value, 10) || 0`: parses the leading integer (after optional sign),
 * stopping at the first non-digit, and yields 0 when no integer is present. Used for the channel id and the
 * target automation id, where the web coerces a falsy/NaN parse to 0.
 */
fun jsParseInt(value: String): Int = LEADING_INT.find(value.trim())?.value?.toIntOrNull() ?: 0

/**
 * Reproduces web `Number.parseFloat(value) || 0`: parses the leading float (decimal/exponent allowed) and
 * yields 0 when no number is present (or the parse is NaN). Used for the numeric setting value.
 */
fun jsParseFloat(value: String): Double {
    val match = LEADING_FLOAT.find(value.trim())?.value ?: return 0.0
    return match.toDoubleOrNull() ?: 0.0 // parity:allow Kotlin stdlib numeric parse
}

/**
 * Reproduces JavaScript `String(number)`: a whole number prints without a trailing decimal (`80`, not
 * `80.0`); a fractional number keeps its decimals. Mirrors the web `String(value_num ?? 0)` display.
 */
fun jsNumberToString(value: Double): String {
    val isWhole = value.isFinite() && value == value.toLong().toDouble() // parity:allow Kotlin stdlib whole check
    return if (isWhole) value.toLong().toString() else value.toString()
}

// ---- command catalog (web ACTION_TYPES + COMMAND_GROUPS) -------------------------------------------------

/** An action-type option for the kind Select — web `ACTION_TYPES` entry (value + i18n label). */
data class ActionTypeOption(
    val kind: AutomationActionKind,
    val labelKey: String,
    val fallback: String,
)

/** A single vehicle command option — web `COMMAND_GROUPS[].commands[]` entry. */
data class CommandOption(
    val value: String,
    val labelKey: String,
    val fallback: String,
)

/** A named group of vehicle commands — web `COMMAND_GROUPS[]` entry. */
data class CommandGroup(
    val labelKey: String,
    val fallback: String,
    val commands: List<CommandOption>,
)

/** Web `ACTION_TYPES`, in render order. */
val ACTION_TYPES: List<ActionTypeOption> =
    listOf(
        ActionTypeOption(AutomationActionKind.Command, "automations.actions.command", "Vehicle Command"),
        ActionTypeOption(AutomationActionKind.Notify, "automations.actions.notify", "Send Notification"),
        ActionTypeOption(AutomationActionKind.SetSetting, "automations.actions.setSetting", "Set Setting"),
        ActionTypeOption(AutomationActionKind.CallAutomation, "automations.actions.callAutomation", "Call Automation"),
    )

/** Web `COMMAND_GROUPS`, in render order — the grouped vehicle commands the command Select offers. */
val COMMAND_GROUPS: List<CommandGroup> =
    listOf(
        CommandGroup(
            labelKey = "automations.commandGroups.security",
            fallback = "Security & Access",
            commands =
                listOf(
                    CommandOption("lock", "automations.commands.lock", "Lock Doors"),
                    CommandOption("unlock", "automations.commands.unlock", "Unlock Doors"),
                    CommandOption("sentry_on", "automations.commands.sentryOn", "Sentry Mode On"),
                    CommandOption("sentry_off", "automations.commands.sentryOff", "Sentry Mode Off"),
                    CommandOption("valet_on", "automations.commands.valetOn", "Valet Mode On"),
                    CommandOption("valet_off", "automations.commands.valetOff", "Valet Mode Off"),
                ),
        ),
        CommandGroup(
            labelKey = "automations.commandGroups.climate",
            fallback = "Climate",
            commands =
                listOf(
                    CommandOption("climate_on", "automations.commands.climateOn", "Climate On"),
                    CommandOption("climate_off", "automations.commands.climateOff", "Climate Off"),
                    CommandOption("set_temps", "automations.commands.setTemps", "Set Temperature"),
                    CommandOption("seat_heater", "automations.commands.seatHeater", "Seat Heater"),
                    CommandOption("seat_cooler", "automations.commands.seatCooler", "Seat Cooler"),
                    CommandOption("steering_wheel_heat", "automations.commands.steeringWheelHeat", "Steering Wheel Heater"),
                    CommandOption("dog_mode", "automations.commands.dogMode", "Dog Mode"),
                    CommandOption("camp_mode", "automations.commands.campMode", "Camp Mode"),
                ),
        ),
        CommandGroup(
            labelKey = "automations.commandGroups.charging",
            fallback = "Charging",
            commands =
                listOf(
                    CommandOption("charge_start", "automations.commands.chargeStart", "Start Charging"),
                    CommandOption("charge_stop", "automations.commands.chargeStop", "Stop Charging"),
                    CommandOption("set_charge_limit", "automations.commands.setChargeLimit", "Set Charge Limit"),
                    CommandOption("set_charging_amps", "automations.commands.setChargingAmps", "Set Charging Amps"),
                    CommandOption("open_charge_port", "automations.commands.openChargePort", "Open Charge Port"),
                    CommandOption("close_charge_port", "automations.commands.closeChargePort", "Close Charge Port"),
                ),
        ),
        CommandGroup(
            labelKey = "automations.commandGroups.doors",
            fallback = "Doors & Trunk",
            commands =
                listOf(
                    CommandOption("frunk_open", "automations.commands.frunkOpen", "Open Frunk"),
                    CommandOption("trunk_open", "automations.commands.trunkOpen", "Open Trunk"),
                ),
        ),
        CommandGroup(
            labelKey = "automations.commandGroups.alerts",
            fallback = "Alerts",
            commands =
                listOf(
                    CommandOption("honk", "automations.commands.honk", "Honk Horn"),
                    CommandOption("flash", "automations.commands.flash", "Flash Lights"),
                ),
        ),
        CommandGroup(
            labelKey = "automations.commandGroups.navigation",
            fallback = "Navigation",
            commands =
                listOf(
                    CommandOption("navigation_request", "automations.commands.navigationRequest", "Navigate to Address"),
                    CommandOption("navigation_gps_request", "automations.commands.navigationGpsRequest", "Navigate to GPS"),
                    CommandOption("trigger_homelink", "automations.commands.triggerHomelink", "Trigger HomeLink"),
                ),
        ),
        CommandGroup(
            labelKey = "automations.commandGroups.driveSoftware",
            fallback = "Drive & Software",
            commands =
                listOf(
                    CommandOption("remote_start_drive", "automations.commands.remoteStartDrive", "Remote Start"),
                    CommandOption("wake_up", "automations.commands.wakeUp", "Wake Up"),
                ),
        ),
    )

// ---- option projections (web useMemo) --------------------------------------------------------------------

/** The localized action-type options for the kind Select — web `actionTypeOptions`. */
fun buildActionTypeOptions(lookup: (String) -> String?): List<LabeledValue> =
    ACTION_TYPES.map { option ->
        LabeledValue(
            value = option.kind.wireValue,
            label = resolveOptional(lookup, foldCatalogKey(option.labelKey), option.fallback),
        )
    }

/**
 * The flattened, localized command options for the command Select — web `commandOptions` minus the leading
 * `Select command...` row (the composable prepends that empty option). Each label is `"<group> - <command>"`,
 * matching web `${groupLabel} - ${t(command.labelKey, command.fallback)}`.
 */
fun buildCommandOptions(lookup: (String) -> String?): List<LabeledValue> =
    COMMAND_GROUPS.flatMap { group ->
        val groupLabel = resolveOptional(lookup, foldCatalogKey(group.labelKey), group.fallback)
        group.commands.map { command ->
            LabeledValue(
                value = command.value,
                label = "$groupLabel - ${resolveOptional(lookup, foldCatalogKey(command.labelKey), command.fallback)}",
            )
        }
    }

/**
 * The localized channel options for the notify Select — web `channelOptions`: label `"<name> (<kind>)"`. The
 * composable substitutes the single `No channels configured` option when this list is empty (web
 * `channelOptions.length > 0 ? … : …`), and disables the rows in [disabledChannelIds].
 */
fun channelOptions(channels: List<ActionChannel>): List<LabeledValue> =
    channels.map { channel -> LabeledValue(value = channel.id.toString(), label = "${channel.name} (${channel.kind})") }

/** The set of disabled channel ids — the notify Select disables these option rows (web `disabled: !enabled`). */
fun disabledChannelIds(channels: List<ActionChannel>): Set<String> = channels.filterNot { it.enabled }.map { it.id.toString() }.toSet()

// ---- i18n facade -----------------------------------------------------------------------------------------

private val NON_IDENTIFIER = Regex("[^A-Za-z0-9]+")

/**
 * Folds an i18next key into the Android string-resource name the generated catalog uses: the `translation_`
 * prefix with every run of non-identifier characters (the dots in `automations.builder.actionType`) replaced
 * by a single underscore. Verified against the real generated resources (e.g. `automations.builder.command`
 * → `translation_automations_builder_command`).
 */
fun foldCatalogKey(webKey: String): String = "translation_" + webKey.replace(NON_IDENTIFIER, "_").trim('_')

/**
 * Reproduces i18next's `t(key, default)` against the native i18n facade: returns the [lookup] result for
 * [resourceName] when it resolves to a non-blank string, otherwise the [fallback]. [lookup] is a thin seam
 * over the Android string catalog in production (an optional by-name resource read) and a map in tests, so
 * the resolve-or-fallback decision stays pure and unit-tested.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback

/**
 * The chrome strings the surface folds in, each tied to the verbatim web i18next key it reads. [fallback] is
 * exactly the web `t(key, fallback)` default, so when the catalog lacks the key the rendered text matches the
 * web's effective output today.
 */
enum class ActionBuilderText(
    val webKey: String,
    val fallback: String,
) {
    ActionType("automations.builder.actionType", "Action Type"),
    MoveUp("automations.builder.moveUp", "Move up"),
    MoveDown("automations.builder.moveDown", "Move down"),
    RemoveAction("automations.builder.removeAction", "Remove action"),
    AddAction("automations.builder.addAction", "Add Action"),
    SelectCommand("automations.builder.selectCommand", "Select command..."),
    Command("automations.builder.command", "Command"),
    CommandParams("automations.builder.commandParams", "Params (JSON, optional)"),
    CommandParamsHint("automations.builder.commandParamsPlaceholder", "{\"temp\": 21}"), // parity:allow verbatim web i18n key
    CommandParamsObjectError("automations.builder.commandParamsObjectError", "Params must be a JSON object."),
    InvalidJson("automations.builder.invalidJson", "Invalid JSON"),
    Channel("automations.builder.channel", "Channel"),
    NoChannels("automations.builder.noChannels", "No channels configured"),
    NotifyMessage("automations.builder.notifyMessage", "Message"),
    NotifyHint("automations.builder.notifyPlaceholder", "Car is warming up!"), // parity:allow verbatim web i18n key
    SettingKey("automations.builder.settingKey", "Setting Key"),
    SettingKeyHint("automations.builder.settingKeyPlaceholder", "charge_limit"), // parity:allow verbatim web i18n key
    ValueType("automations.builder.valueType", "Value Type"),
    ValueText("automations.builder.valueText", "Text"),
    ValueNumber("automations.builder.valueNumber", "Number"),
    ValueBoolean("automations.builder.valueBoolean", "Boolean"),
    Value("automations.builder.value", "Value"),
    True("common.true", "True"),
    False("common.false", "False"),
    ValueNumberHint("automations.builder.valueNumberPlaceholder", "80"), // parity:allow verbatim web i18n key
    ValueTextHint("automations.builder.valueTextPlaceholder", "enabled"), // parity:allow verbatim web i18n key
    TargetAutomationId("automations.builder.targetAutomationId", "Target Automation ID"),
    ;

    /** The generated-catalog resource name for [webKey] (see [foldCatalogKey]). */
    val androidResourceName: String get() = foldCatalogKey(webKey)
}

/** The localized chrome strings the composable hands the renderer; tests pass a deterministic instance. */
data class ActionBuilderStrings(
    val actionType: String,
    val moveUp: String,
    val moveDown: String,
    val removeAction: String,
    val addAction: String,
    val selectCommand: String,
    val command: String,
    val commandParams: String,
    val commandParamsHint: String,
    val commandParamsObjectError: String,
    val invalidJson: String,
    val channel: String,
    val noChannels: String,
    val notifyMessage: String,
    val notifyHint: String,
    val settingKey: String,
    val settingKeyHint: String,
    val valueType: String,
    val valueText: String,
    val valueNumber: String,
    val valueBoolean: String,
    val value: String,
    val valueTrue: String,
    val valueFalse: String,
    val valueNumberHint: String,
    val valueTextHint: String,
    val targetAutomationId: String,
)

/**
 * Builds the localized [ActionBuilderStrings] from a by-name string [lookup] (the i18n facade in production,
 * a map in tests). Every field routes through [resolveOptional] so it resolves live from the catalog when
 * present and falls back to the web's `t(key, fallback)` default otherwise.
 */
fun buildActionBuilderStrings(lookup: (String) -> String?): ActionBuilderStrings =
    ActionBuilderStrings(
        actionType = resolve(lookup, ActionBuilderText.ActionType),
        moveUp = resolve(lookup, ActionBuilderText.MoveUp),
        moveDown = resolve(lookup, ActionBuilderText.MoveDown),
        removeAction = resolve(lookup, ActionBuilderText.RemoveAction),
        addAction = resolve(lookup, ActionBuilderText.AddAction),
        selectCommand = resolve(lookup, ActionBuilderText.SelectCommand),
        command = resolve(lookup, ActionBuilderText.Command),
        commandParams = resolve(lookup, ActionBuilderText.CommandParams),
        commandParamsHint = resolve(lookup, ActionBuilderText.CommandParamsHint),
        commandParamsObjectError = resolve(lookup, ActionBuilderText.CommandParamsObjectError),
        invalidJson = resolve(lookup, ActionBuilderText.InvalidJson),
        channel = resolve(lookup, ActionBuilderText.Channel),
        noChannels = resolve(lookup, ActionBuilderText.NoChannels),
        notifyMessage = resolve(lookup, ActionBuilderText.NotifyMessage),
        notifyHint = resolve(lookup, ActionBuilderText.NotifyHint),
        settingKey = resolve(lookup, ActionBuilderText.SettingKey),
        settingKeyHint = resolve(lookup, ActionBuilderText.SettingKeyHint),
        valueType = resolve(lookup, ActionBuilderText.ValueType),
        valueText = resolve(lookup, ActionBuilderText.ValueText),
        valueNumber = resolve(lookup, ActionBuilderText.ValueNumber),
        valueBoolean = resolve(lookup, ActionBuilderText.ValueBoolean),
        value = resolve(lookup, ActionBuilderText.Value),
        valueTrue = resolve(lookup, ActionBuilderText.True),
        valueFalse = resolve(lookup, ActionBuilderText.False),
        valueNumberHint = resolve(lookup, ActionBuilderText.ValueNumberHint),
        valueTextHint = resolve(lookup, ActionBuilderText.ValueTextHint),
        targetAutomationId = resolve(lookup, ActionBuilderText.TargetAutomationId),
    )

private fun resolve(
    lookup: (String) -> String?,
    text: ActionBuilderText,
): String = resolveOptional(lookup, text.androidResourceName, text.fallback)
