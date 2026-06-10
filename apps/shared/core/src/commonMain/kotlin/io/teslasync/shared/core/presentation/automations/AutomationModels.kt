package io.teslasync.shared.core.presentation.automations

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonClassDiscriminator
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/*
 * The cross-platform port of the web Automations domain types
 * (web/src/types/automations.ts + the `Automation`/`AutomationPreset`/`AutomationHistory`
 * extensions in web/src/api/types.ts). Every native Automations screen (Android/Apple via
 * KMP, Windows via the C# port) binds to these shapes through the S7
 * io.teslasync.shared.core.data.repo.AutomationsRepository and the S8 AutomationsStore.
 *
 * Keys arrive snake_case from `GET /api/v1/automations*`; they are matched verbatim via
 * SerialName so the cached payload round-trips unchanged. No field is unit-bearing, so there
 * is no SI conversion at this layer — display formatting is the render boundary's job (S5).
 *
 * The step hierarchies:
 * The web models steps as discriminated unions on a `kind` field. The INPUT step shapes
 * (AutomationTriggerInput/AutomationConditionInput/AutomationActionInput) are the web
 * `Omit<Step, 'id' | 'automation_id' | 'step_id'>` types: they carry no row-identity fields.
 * The backend create/update decoder uses `DisallowUnknownFields` and its step DTOs accept
 * ONLY `kind`, `step_order`, and the kind-specific fields (internal/api/automation/dtos.go) —
 * so an id-bearing step in a mutation body is a 400. These id-free hierarchies are therefore
 * the single source of truth for steps everywhere a step is read OR written:
 *  - AutomationFullInput and AutomationPreset use them exactly as the web Input types do;
 *  - AutomationFull also decodes its triggers/conditions/actions through them — the inline
 *    id/automation_id/step_id the detail response carries are dropped on decode
 *    (ignoreUnknownKeys), and per-step identity is preserved verbatim on AutomationFull.steps
 *    (AutomationStepSummary). One hierarchy per lane (instead of a parallel id-bearing set)
 *    keeps every mutation body id-free by construction, so the strict backend never rejects it.
 */

// ── Trigger input steps ────────────────────────────────────────────────────────

/**
 * A trigger step body — the port of the web `AutomationTriggerInput` union. Serialized with a
 * `kind` discriminator (no separate `kind` property; it is supplied by [SerialName]) and only
 * the fields the backend `automationTrigger*DTO` structs accept.
 */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
@JsonClassDiscriminator("kind")
public sealed interface AutomationTriggerInput {
    /** Optional render/exec ordering hint; omitted from the wire when null. */
    public val stepOrder: Int?

    /** `trigger_signal`: fires when a live signal crosses/compares against a value. */
    @Serializable
    @SerialName("trigger_signal")
    public data class Signal(
        @SerialName("step_order") override val stepOrder: Int? = null,
        val signal: String,
        val op: String,
        @SerialName("value_num") val valueNum: Double? = null,
        @SerialName("value_text") val valueText: String? = null,
        @SerialName("value_bool") val valueBool: Boolean? = null,
    ) : AutomationTriggerInput

    /** `trigger_geofence`: fires on enter/exit/leave/both/dwell of a place. */
    @Serializable
    @SerialName("trigger_geofence")
    public data class Geofence(
        @SerialName("step_order") override val stepOrder: Int? = null,
        @SerialName("place_id") val placeId: Long,
        val event: String,
        @SerialName("dwell_minutes") val dwellMinutes: Int? = null,
    ) : AutomationTriggerInput

    /** `trigger_schedule`: fires on a cron schedule in a timezone. */
    @Serializable
    @SerialName("trigger_schedule")
    public data class Schedule(
        @SerialName("step_order") override val stepOrder: Int? = null,
        @SerialName("cron_expr") val cronExpr: String,
        val timezone: String,
    ) : AutomationTriggerInput

    /** `trigger_event`: fires on a lifecycle event (drive_start, charge_end, …). */
    @Serializable
    @SerialName("trigger_event")
    public data class Event(
        @SerialName("step_order") override val stepOrder: Int? = null,
        @SerialName("event_type") val eventType: String,
    ) : AutomationTriggerInput
}

// ── Condition input steps ──────────────────────────────────────────────────────

/** A condition step body — the port of the web `AutomationConditionInput` union. */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
@JsonClassDiscriminator("kind")
public sealed interface AutomationConditionInput {
    /** Optional render/exec ordering hint; omitted from the wire when null. */
    public val stepOrder: Int?

    /** `condition_signal`: gates on a signal comparison (incl. between/in via min/max). */
    @Serializable
    @SerialName("condition_signal")
    public data class Signal(
        @SerialName("step_order") override val stepOrder: Int? = null,
        val signal: String,
        val op: String,
        @SerialName("value_num") val valueNum: Double? = null,
        @SerialName("value_text") val valueText: String? = null,
        @SerialName("value_bool") val valueBool: Boolean? = null,
        @SerialName("value_min") val valueMin: Double? = null,
        @SerialName("value_max") val valueMax: Double? = null,
    ) : AutomationConditionInput

    /** `condition_time_window`: gates on a local time window + days-of-week. */
    @Serializable
    @SerialName("condition_time_window")
    public data class TimeWindow(
        @SerialName("step_order") override val stepOrder: Int? = null,
        @SerialName("start_time") val startTime: String,
        @SerialName("end_time") val endTime: String,
        val timezone: String,
        @SerialName("days_of_week") val daysOfWeek: List<Int> = emptyList(),
    ) : AutomationConditionInput

    /** `condition_geofence`: gates on inside/outside/dwell of a place. */
    @Serializable
    @SerialName("condition_geofence")
    public data class Geofence(
        @SerialName("step_order") override val stepOrder: Int? = null,
        @SerialName("place_id") val placeId: Long,
        val state: String,
    ) : AutomationConditionInput

    /** `condition_other_automation`: gates on another automation's state. */
    @Serializable
    @SerialName("condition_other_automation")
    public data class OtherAutomation(
        @SerialName("step_order") override val stepOrder: Int? = null,
        @SerialName("other_automation_id") val otherAutomationId: Long,
        val state: String,
    ) : AutomationConditionInput
}

// ── Action input steps ─────────────────────────────────────────────────────────

/** An action step body — the port of the web `AutomationActionInput` union. */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
@JsonClassDiscriminator("kind")
public sealed interface AutomationActionInput {
    /** Optional render/exec ordering hint; omitted from the wire when null. */
    public val stepOrder: Int?

    /** `action_command`: issues a vehicle command with optional params. */
    @Serializable
    @SerialName("action_command")
    public data class Command(
        @SerialName("step_order") override val stepOrder: Int? = null,
        @SerialName("command_name") val commandName: String,
        @SerialName("command_params") val commandParams: JsonObject? = null,
    ) : AutomationActionInput

    /** `action_notify`: sends a templated notification to a channel. */
    @Serializable
    @SerialName("action_notify")
    public data class Notify(
        @SerialName("step_order") override val stepOrder: Int? = null,
        @SerialName("channel_id") val channelId: Long,
        val template: String,
    ) : AutomationActionInput

    /** `action_set_setting`: writes a typed setting value. */
    @Serializable
    @SerialName("action_set_setting")
    public data class SetSetting(
        @SerialName("step_order") override val stepOrder: Int? = null,
        @SerialName("setting_key") val settingKey: String,
        @SerialName("value_num") val valueNum: Double? = null,
        @SerialName("value_text") val valueText: String? = null,
        @SerialName("value_bool") val valueBool: Boolean? = null,
    ) : AutomationActionInput

    /** `action_call_automation`: triggers another automation. */
    @Serializable
    @SerialName("action_call_automation")
    public data class CallAutomation(
        @SerialName("step_order") override val stepOrder: Int? = null,
        @SerialName("target_automation_id") val targetAutomationId: Long,
    ) : AutomationActionInput
}

// ── List / detail read models ───────────────────────────────────────────────────

/** A potential clash flagged on an automation — the port of the web `AutomationConflict`. */
@Serializable
public data class AutomationConflict(
    @SerialName("automation_id") val automationId: Long,
    @SerialName("automation_name") val automationName: String,
    val reason: String,
    val severity: String,
)

/**
 * One automation row — the port of the web `Automation` type (the Go `models.Automation`
 * plus the computed `next_fire_time`/`conflicts` of `automationResponse`). Every optional
 * server field defaults so a partial payload still decodes.
 */
@Serializable
public data class Automation(
    val id: Long,
    val name: String,
    val description: String? = null,
    val enabled: Boolean = false,
    @SerialName("vehicle_id") val vehicleId: Long? = null,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
    @SerialName("stop_on_failure") val stopOnFailure: Boolean = false,
    @SerialName("notify_on_run") val notifyOnRun: Boolean = false,
    @SerialName("notify_on_failure") val notifyOnFailure: Boolean = false,
    @SerialName("seasonal_start") val seasonalStart: Int? = null,
    @SerialName("seasonal_end") val seasonalEnd: Int? = null,
    @SerialName("last_triggered_at") val lastTriggeredAt: String? = null,
    @SerialName("last_success_at") val lastSuccessAt: String? = null,
    @SerialName("last_failure_at") val lastFailureAt: String? = null,
    @SerialName("execution_count") val executionCount: Long = 0,
    @SerialName("failure_count") val failureCount: Long = 0,
    @SerialName("consecutive_failures") val consecutiveFailures: Long = 0,
    @SerialName("auto_disabled") val autoDisabled: Boolean = false,
    @SerialName("auto_disabled_reason") val autoDisabledReason: String? = null,
    @SerialName("preset_id") val presetId: String? = null,
    @SerialName("next_fire_time") val nextFireTime: String? = null,
    val conflicts: List<AutomationConflict> = emptyList(),
)

/**
 * The identity row for one step on a full automation — the port of the web
 * `AutomationStepSummary`. Preserves the `id`/`automation_id`/`step_order`/`kind` the lane
 * arrays drop on decode, so a full automation never loses per-step identity.
 */
@Serializable
public data class AutomationStepSummary(
    val id: Long,
    @SerialName("automation_id") val automationId: Long,
    @SerialName("step_order") val stepOrder: Int,
    val kind: String,
)

/**
 * A fully-expanded automation — the port of the web `AutomationFull`. The lane arrays decode
 * through the id-free input step hierarchies (see the file header); [steps] carries the
 * per-step identity.
 */
@Serializable
public data class AutomationFull(
    val id: Long,
    val name: String,
    val description: String? = null,
    val enabled: Boolean = false,
    @SerialName("vehicle_id") val vehicleId: Long? = null,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
    @SerialName("stop_on_failure") val stopOnFailure: Boolean = false,
    @SerialName("notify_on_run") val notifyOnRun: Boolean = false,
    @SerialName("notify_on_failure") val notifyOnFailure: Boolean = false,
    @SerialName("seasonal_start") val seasonalStart: Int? = null,
    @SerialName("seasonal_end") val seasonalEnd: Int? = null,
    @SerialName("auto_disabled") val autoDisabled: Boolean = false,
    @SerialName("auto_disabled_reason") val autoDisabledReason: String? = null,
    @SerialName("preset_id") val presetId: String? = null,
    val steps: List<AutomationStepSummary> = emptyList(),
    val triggers: List<AutomationTriggerInput> = emptyList(),
    val conditions: List<AutomationConditionInput> = emptyList(),
    val actions: List<AutomationActionInput> = emptyList(),
)

// ── History read models ─────────────────────────────────────────────────────────

/**
 * One automation execution record — the port of the web `AutomationHistory`. The snapshot
 * blobs are carried verbatim as [JsonElement] (web `Record<string, unknown>`).
 */
@Serializable
public data class AutomationHistory(
    val id: Long,
    @SerialName("automation_id") val automationId: Long,
    @SerialName("automation_name") val automationName: String = "",
    @SerialName("vehicle_id") val vehicleId: Long? = null,
    @SerialName("triggered_at") val triggeredAt: String = "",
    @SerialName("completed_at") val completedAt: String? = null,
    @SerialName("duration_ms") val durationMs: Long? = null,
    @SerialName("trigger_type") val triggerType: String = "",
    @SerialName("trigger_snapshot") val triggerSnapshot: JsonElement? = null,
    @SerialName("conditions_met") val conditionsMet: Boolean = false,
    @SerialName("conditions_snapshot") val conditionsSnapshot: JsonElement? = null,
    @SerialName("actions_executed") val actionsExecuted: JsonElement? = null,
    @SerialName("actions_total") val actionsTotal: Long = 0,
    @SerialName("actions_succeeded") val actionsSucceeded: Long = 0,
    @SerialName("actions_failed") val actionsFailed: Long = 0,
    val status: String = "",
    val error: String? = null,
    @SerialName("fsm_state") val fsmState: String? = null,
    @SerialName("created_at") val createdAt: String = "",
)

/** Aggregate execution stats — the port of the web `AutomationHistoryStats`. */
@Serializable
public data class AutomationHistoryStats(
    @SerialName("total_executions") val totalExecutions: Long = 0,
    val succeeded: Long = 0,
    val failed: Long = 0,
    val partial: Long = 0,
    @SerialName("success_rate") val successRate: Double = 0.0,
    @SerialName("avg_duration_ms") val avgDurationMs: Double = 0.0,
)

/** Paginated history envelope — the port of the web `AutomationHistoryListResponse`. */
@Serializable
public data class AutomationHistoryListResponse(
    val items: List<AutomationHistory> = emptyList(),
    val total: Long = 0,
    val limit: Long = 0,
    val offset: Long = 0,
    val summary: AutomationHistoryStats = AutomationHistoryStats(),
)

// ── Preset read models ──────────────────────────────────────────────────────────

/** A preset category — the port of the web `AutomationPresetCategory`. */
@Serializable
public data class AutomationPresetCategory(
    val id: String,
    val name: String,
    val description: String = "",
    val icon: String = "",
)

/** A single automation preset — the port of the web `AutomationPreset`. */
@Serializable
public data class AutomationPreset(
    val id: String,
    val name: String,
    val description: String = "",
    val category: String = "",
    val icon: String = "",
    val triggers: List<AutomationTriggerInput> = emptyList(),
    val conditions: List<AutomationConditionInput> = emptyList(),
    val actions: List<AutomationActionInput> = emptyList(),
    @SerialName("stop_on_failure") val stopOnFailure: Boolean = false,
    @SerialName("notify_on_run") val notifyOnRun: Boolean = false,
    @SerialName("notify_on_failure") val notifyOnFailure: Boolean = false,
)

/** The presets gallery envelope — the port of the web `AutomationPresetsResponse`. */
@Serializable
public data class AutomationPresetsResponse(
    val categories: List<AutomationPresetCategory> = emptyList(),
    val presets: List<AutomationPreset> = emptyList(),
)

// ── Mutation inputs + results ────────────────────────────────────────────────────

/**
 * The `POST /automations` (create) and `PUT /automations/{id}` (update) body — the port of
 * the web `AutomationFullInput`. [triggers]/[conditions]/[actions] always serialize (the
 * backend requires the arrays); [description]/[vehicleId]/[enabled] are dropped from the wire
 * when null (mirroring `JSON.stringify` dropping `undefined`). Every step is id-free by type,
 * so the strict `DisallowUnknownFields` backend can never reject the body.
 */
@Serializable
public data class AutomationFullInput(
    val name: String,
    val description: String? = null,
    @SerialName("vehicle_id") val vehicleId: Long? = null,
    val enabled: Boolean? = null,
    val triggers: List<AutomationTriggerInput> = emptyList(),
    val conditions: List<AutomationConditionInput> = emptyList(),
    val actions: List<AutomationActionInput> = emptyList(),
)

/** The `PATCH /automations/{id}/toggle` response — the port of the web `{ id, enabled }`. */
@Serializable
public data class ToggleAutomationResult(
    val id: Long,
    val enabled: Boolean,
)

/**
 * The `PATCH /automations/{id}/re-enable` response — the port of the web
 * `{ id, enabled, auto_disabled }`.
 */
@Serializable
public data class ReEnableAutomationResult(
    val id: Long,
    val enabled: Boolean,
    @SerialName("auto_disabled") val autoDisabled: Boolean,
)

/** One failed row in a bulk op — the port of the web `AutomationBulkResult.failed[]`. */
@Serializable
public data class AutomationBulkFailure(
    val id: Long,
    val reason: String,
)

/** The `POST /automations/bulk` response — the port of the web `AutomationBulkResult`. */
@Serializable
public data class AutomationBulkResult(
    val updated: Int? = null,
    val deleted: Int? = null,
    val failed: List<AutomationBulkFailure> = emptyList(),
)

/**
 * The allowlisted bulk operation — the port of the web `AutomationBulkOp`
 * (`'enable' | 'disable' | 'delete'`). [wire] is the exact lower-case string sent in the
 * `POST /automations/bulk` body.
 */
public enum class AutomationBulkOp(
    public val wire: String,
) {
    ENABLE("enable"),
    DISABLE("disable"),
    DELETE("delete"),
}
