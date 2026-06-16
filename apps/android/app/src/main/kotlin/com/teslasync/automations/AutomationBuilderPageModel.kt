// Pure, framework-free model + projections for the AutomationBuilderPage automations surface — the native analogue of
// everything the web page derives outside its render layer (web/src/features/automations/pages/AutomationBuilderPage.tsx,
// the typed create/edit form at /automations/new and /automations/:id/edit). No Compose, no Android framework, no HTTP
// lives here: every declaration is plain Kotlin over the shared-core Automations domain types, so the composable stays a
// thin render layer and all of this is exercised off-device by the :android:testDebugUnitTest gate.
//
// The web page owns these concerns this file ports: (1) the editable [BuilderForm] the four FormSections bind to and the
// pure projections that move between it and the wire shapes — [automationToForm] (web `automationToForm`, the edit-mode
// hydrate), [presetToForm] (web preset hydrate), and [toFullInput] (web `formToPayload`, the create/update body); (2) the
// pre-save [validate] gate (web `validate`) returning a typed [BuilderValidation] the render boundary maps to one of the
// six localized error strings; and (3) the kind taxonomies + default-step factories the trigger/condition/action editors
// use (web `TRIGGER_TYPES` / `createDefaultTrigger` and the per-kind defaults), all over the shared-core id-free input
// step hierarchies so every mutation body is byte-equivalent to one the strict backend decoder accepts.
//
// No field on the form is unit-bearing, so there is no SI conversion at this layer — exactly like the shared domain
// models the form reads and writes (display formatting, where any existed, would be the render boundary's job, S5).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/automations) diverges from the
// `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling analytics/admin surfaces do.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.automations.builder

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.automations.AutomationActionInput
import io.teslasync.shared.core.presentation.automations.AutomationConditionInput
import io.teslasync.shared.core.presentation.automations.AutomationFull
import io.teslasync.shared.core.presentation.automations.AutomationFullInput
import io.teslasync.shared.core.presentation.automations.AutomationPreset
import io.teslasync.shared.core.presentation.automations.AutomationTriggerInput

/**
 * Canonical metadata for this surface. The web page is a top-level (hidden) automations route, not a draggable
 * dashboard widget, so there is no web registry row to mirror — this object carries the cross-cutting concerns the
 * surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires and the diagnostics [SLUG] emitted with the
 * one-shot `view.opened` event (P1/S11). It renders a typed builder form, not a data feed of its own.
 */
object AutomationBuilderPageRegistration {
    /** The navigation destination id (Destinations.kt `hidden("automationBuilder", "/automations/new", …)`). */
    const val ROUTE_ID: String = "automationBuilder"

    /** The web route this surface mirrors (the create entry; the edit form is `/automations/{id}/edit`). */
    const val WEB_PATH: String = "/automations/new"

    /** The optional path argument carrying the automation id in edit mode (web `useParams().id`). */
    const val ARG_ID: String = "id"

    /** The optional query argument carrying the preset id in install-preset mode (web `searchParams.get('preset')`). */
    const val ARG_PRESET: String = "preset"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no automation content. */
    const val SLUG: String = "AutomationBuilderPage"
}

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no automation content. */
internal fun recordAutomationBuilderPageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to AutomationBuilderPageRegistration.SLUG))
}

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"

/**
 * Which entry point opened the builder — the native analogue of the web page's `isEdit` / `presetId` branching that
 * selects the page title, the hydrate source, and whether the draft-recovery affordance applies.
 */
enum class BuilderMode { Create, Edit, Preset }

/**
 * The editable form state the four FormSections bind to — the port of the web `FormState`. The step lanes use the
 * shared-core id-free input hierarchies, so [toFullInput] needs no per-step rewriting: the form IS the wire shape.
 * The default action mirrors the web `getInitialForm()` seed (one `climate_on` command) so a brand-new automation is
 * one trigger choice away from valid.
 */
data class BuilderForm(
    val name: String = "",
    val description: String = "",
    val vehicleId: Long? = null,
    val enabled: Boolean = true,
    val triggers: List<AutomationTriggerInput> = emptyList(),
    val conditions: List<AutomationConditionInput> = emptyList(),
    val actions: List<AutomationActionInput> = listOf(defaultAction()),
)

/**
 * The typed result of the pre-save [validate] gate — the native analogue of the localized strings the web `validate`
 * returns. Kept framework-free (no string here) so the ViewModel stays Android-free; the render boundary maps each
 * case to its `automations.builder.error*` resource (the six error strings in the parity set).
 */
enum class BuilderValidation {
    NameRequired,
    TriggerRequired,
    TriggerPlace,
    ConditionPlace,
    ActionsRequired,
    ActionDetails,
}

/**
 * Validates [form] in the web page's exact order, returning the first failing [BuilderValidation] or `null` when the
 * form is ready to save (web `validate`). The order matters: name → trigger present → trigger place → condition place
 * → actions present → action details.
 */
fun validate(form: BuilderForm): BuilderValidation? =
    when {
        form.name.isBlank() -> BuilderValidation.NameRequired
        form.triggers.isEmpty() -> BuilderValidation.TriggerRequired
        form.triggers.any(::triggerNeedsPlace) -> BuilderValidation.TriggerPlace
        form.conditions.any(::conditionNeedsPlace) -> BuilderValidation.ConditionPlace
        form.actions.isEmpty() -> BuilderValidation.ActionsRequired
        form.actions.any(::actionIsIncomplete) -> BuilderValidation.ActionDetails
        else -> null
    }

/** A geofence trigger with no place chosen yet (web `triggerNeedsPlace`: `place_id <= 0`). */
private fun triggerNeedsPlace(trigger: AutomationTriggerInput): Boolean =
    trigger is AutomationTriggerInput.Geofence && trigger.placeId <= 0L

/** A geofence condition with no place chosen yet (web `conditionNeedsPlace`: `place_id <= 0`). */
private fun conditionNeedsPlace(condition: AutomationConditionInput): Boolean =
    condition is AutomationConditionInput.Geofence && condition.placeId <= 0L

/**
 * Whether an action is missing required detail (web `actionIsIncomplete`). A command needs a name; a notify needs a
 * channel and a template; a set-setting needs a key AND exactly one typed value; a call needs a target id.
 */
private fun actionIsIncomplete(action: AutomationActionInput): Boolean =
    when (action) {
        is AutomationActionInput.Command -> action.commandName.isBlank()
        is AutomationActionInput.Notify -> action.channelId <= 0L || action.template.isBlank()
        is AutomationActionInput.SetSetting ->
            action.settingKey.isBlank() ||
                listOfNotNull(action.valueText, action.valueNum, action.valueBool).size != 1
        is AutomationActionInput.CallAutomation -> action.targetAutomationId <= 0L
    }

// ── Projections between the form and the wire shapes ─────────────────────────────────────────────────────────────

/** Hydrates the form from a fully-expanded automation (web `automationToForm`, the edit-mode source of truth). */
fun automationToForm(automation: AutomationFull): BuilderForm =
    BuilderForm(
        name = automation.name,
        description = automation.description ?: "",
        vehicleId = automation.vehicleId,
        enabled = automation.enabled,
        triggers = automation.triggers,
        conditions = automation.conditions,
        actions = automation.actions,
    )

/** Hydrates the form from a preset definition (web preset hydrate). A preset never pins a vehicle and starts enabled. */
fun presetToForm(preset: AutomationPreset): BuilderForm =
    BuilderForm(
        name = preset.name,
        description = preset.description,
        vehicleId = null,
        enabled = true,
        triggers = preset.triggers,
        conditions = preset.conditions,
        actions = preset.actions,
    )

/**
 * Projects the form to the create/update body (web `formToPayload`). Name/description are trimmed; the lanes pass
 * through verbatim because they are already the id-free input shapes the strict backend decoder accepts.
 */
fun BuilderForm.toFullInput(): AutomationFullInput =
    AutomationFullInput(
        name = name.trim(),
        description = description.trim(),
        vehicleId = vehicleId,
        enabled = enabled,
        triggers = triggers,
        conditions = conditions,
        actions = actions,
    )

// ── Kind taxonomies + default-step factories ─────────────────────────────────────────────────────────────────────

/**
 * The trigger kinds offered in the "When" type picker — the port of the web `TRIGGER_TYPES`, in the same order
 * (Schedule, Vehicle Event, Geofence, Signal Threshold). [wire] is the discriminator the backend reads.
 */
enum class TriggerKind(val wire: String) {
    Schedule("trigger_schedule"),
    Event("trigger_event"),
    Geofence("trigger_geofence"),
    Signal("trigger_signal"),
}

/** The kind of the first (only) configured trigger, or `null` when none is chosen yet (web `selectedTrigger`). */
fun BuilderForm.selectedTriggerKind(): TriggerKind? =
    when (triggers.firstOrNull()) {
        is AutomationTriggerInput.Schedule -> TriggerKind.Schedule
        is AutomationTriggerInput.Event -> TriggerKind.Event
        is AutomationTriggerInput.Geofence -> TriggerKind.Geofence
        is AutomationTriggerInput.Signal -> TriggerKind.Signal
        null -> null
    }

/** A fresh trigger of [kind] with editable defaults (web `createDefaultTrigger`). */
fun createDefaultTrigger(kind: TriggerKind): AutomationTriggerInput =
    when (kind) {
        TriggerKind.Schedule -> AutomationTriggerInput.Schedule(cronExpr = DEFAULT_CRON, timezone = DEFAULT_TIMEZONE)
        TriggerKind.Event -> AutomationTriggerInput.Event(eventType = DEFAULT_EVENT_TYPE)
        TriggerKind.Geofence -> AutomationTriggerInput.Geofence(placeId = 0L, event = DEFAULT_GEOFENCE_EVENT)
        TriggerKind.Signal -> AutomationTriggerInput.Signal(signal = "", op = DEFAULT_OP)
    }

/** The condition kinds offered in the per-row type picker (web `AutomationConditionInput` union). */
enum class ConditionKind(val wire: String) {
    Signal("condition_signal"),
    TimeWindow("condition_time_window"),
    Geofence("condition_geofence"),
    OtherAutomation("condition_other_automation"),
}

/** The kind of an existing condition row, for the type picker's current selection. */
fun AutomationConditionInput.kind(): ConditionKind =
    when (this) {
        is AutomationConditionInput.Signal -> ConditionKind.Signal
        is AutomationConditionInput.TimeWindow -> ConditionKind.TimeWindow
        is AutomationConditionInput.Geofence -> ConditionKind.Geofence
        is AutomationConditionInput.OtherAutomation -> ConditionKind.OtherAutomation
    }

/** A fresh condition of [kind] with editable defaults (the web `ConditionBuilder` add-row seed). */
fun createDefaultCondition(kind: ConditionKind): AutomationConditionInput =
    when (kind) {
        ConditionKind.Signal -> AutomationConditionInput.Signal(signal = "", op = DEFAULT_OP)
        ConditionKind.TimeWindow ->
            AutomationConditionInput.TimeWindow(startTime = "08:00", endTime = "17:00", timezone = DEFAULT_TIMEZONE)
        ConditionKind.Geofence -> AutomationConditionInput.Geofence(placeId = 0L, state = DEFAULT_GEOFENCE_STATE)
        ConditionKind.OtherAutomation ->
            AutomationConditionInput.OtherAutomation(otherAutomationId = 0L, state = DEFAULT_OTHER_STATE)
    }

/** The action kinds offered in the per-row type picker (web `AutomationActionInput` union). */
enum class ActionKind(val wire: String) {
    Command("action_command"),
    Notify("action_notify"),
    SetSetting("action_set_setting"),
    CallAutomation("action_call_automation"),
}

/** The kind of an existing action row, for the type picker's current selection. */
fun AutomationActionInput.kind(): ActionKind =
    when (this) {
        is AutomationActionInput.Command -> ActionKind.Command
        is AutomationActionInput.Notify -> ActionKind.Notify
        is AutomationActionInput.SetSetting -> ActionKind.SetSetting
        is AutomationActionInput.CallAutomation -> ActionKind.CallAutomation
    }

/** A fresh action of [kind] with editable defaults (the web `ActionBuilder` add-row seed). */
fun createDefaultAction(kind: ActionKind): AutomationActionInput =
    when (kind) {
        ActionKind.Command -> defaultAction()
        ActionKind.Notify -> AutomationActionInput.Notify(channelId = 0L, template = "")
        ActionKind.SetSetting -> AutomationActionInput.SetSetting(settingKey = "", valueText = "")
        ActionKind.CallAutomation -> AutomationActionInput.CallAutomation(targetAutomationId = 0L)
    }

/** The web `getInitialForm()` seed action: a single `climate_on` command. */
internal fun defaultAction(): AutomationActionInput = AutomationActionInput.Command(commandName = DEFAULT_COMMAND)

/**
 * The comparison operators offered for signal triggers/conditions — the port of the web operator list. [wire] is the
 * symbol the backend reads; the label is the same symbol verbatim (the web fallbacks are the symbols).
 */
val SIGNAL_OPERATORS: List<String> = listOf("=", "!=", "<", "<=", ">", ">=", "changed", "crossed_above", "crossed_below")

/** The vehicle lifecycle events offered for event triggers (web `VEHICLE_EVENTS` values). */
val VEHICLE_EVENTS: List<String> =
    listOf(
        "drive_start", "drive_end", "charge_start", "charge_end",
        "sleep_start", "sleep_end", "online", "offline", "sentry_alert",
    )

/** The geofence transition events offered for geofence triggers (web `GEOFENCE_EVENTS` values). */
val GEOFENCE_EVENTS: List<String> = listOf("enter", "exit", "dwell")

private const val DEFAULT_CRON = "0 8 * * *"
private const val DEFAULT_TIMEZONE = "UTC"
private const val DEFAULT_EVENT_TYPE = "drive_start"
private const val DEFAULT_GEOFENCE_EVENT = "enter"
private const val DEFAULT_GEOFENCE_STATE = "inside"
private const val DEFAULT_OTHER_STATE = "active"
private const val DEFAULT_OP = "="
private const val DEFAULT_COMMAND = "climate_on"
