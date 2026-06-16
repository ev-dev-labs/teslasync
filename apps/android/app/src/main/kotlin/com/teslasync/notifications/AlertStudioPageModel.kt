// Pure, framework-free model + derivations for the AlertStudioPage notifications surface — the native
// analogue of everything web/src/features/notifications/pages/AlertStudioPage.tsx derives before composing
// its panels. No Compose, no Android UI, no HTTP: every declaration references only the shared-core
// notification DTOs and plain Kotlin, so the composable stays a thin render layer and the whole derivation
// is unit-testable off-device.
//
// It ports the web page's local concerns: (1) the typed rule-editor state (the web `editor` useState); (2)
// the rule templates + the telemetry-signal catalog the editor selects from; (3) the list/template filters
// (web `filteredRules` / `filteredTemplates` useMemos); (4) the operator-set-per-signal-type logic
// (`getOperatorsForType`); (5) the value-kind classifier that decides which typed-value editor to show
// (`valueKind`); and (6) the save-payload builder (`buildSavePayload` -> `AlertRuleSaveRequest`). Values are
// SI on the wire (no unit-bearing fields in this domain); conversion is the render boundary's job.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications)
// diverges from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7
// pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.notifications.alertstudio

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.notifications.AlertRuleInput
import io.teslasync.shared.core.presentation.notifications.AlertRuleSaveRequest
import io.teslasync.shared.core.presentation.notifications.AlertRuleUpdate
import java.time.Instant

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `AlertStudioPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("notificationsStudio", "/notifications/studio", …)`, so [io.teslasync.android.navigation.PageHosts]
 * binds this surface to that destination (and its `/notifications/studio` deep link).
 */
object AlertStudioPageRegistration {
    /** The navigation destination id (Destinations.kt `page("notificationsStudio", "/notifications/studio", …)`). */
    const val ROUTE_ID: String = "notificationsStudio"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/notifications/studio"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle/rule id. */
    const val SLUG: String = "AlertStudioPage"
}

/** Whether a rule fires on a raw telemetry signal threshold or on a derived computed metric (web `kind`). */
enum class RuleKind { Signal, ComputedMetric }

/** The value type of a telemetry signal — drives the allowed operators + which typed-value editor shows. */
enum class SignalValueType { Numeric, Text, Bool }

/** Which typed-value editor the condition row renders (web `valueKind`). */
enum class ValueKind { None, Number, Text, Bool, Range }

/**
 * Editor-only tri-state for the alert-behavior selector. The backend column stays strict
 * (`once` | `repeat`); `Unset` exists only so a brand-new rule can be in the "user hasn't decided yet"
 * state and the Save button can block until they do (web Decision D3 "force-choose").
 */
enum class TriggerMode { Unset, Once, Repeat }

/** One telemetry signal the editor can target — the native slice of the web signal catalog. */
data class SignalDef(
    val name: String,
    val category: String,
    val valueType: SignalValueType,
)

/** One pre-built rule template — the native port of the web `RuleTemplate`. */
@Suppress("LongParameterList")
data class RuleTemplate(
    val name: String,
    val category: String,
    val severity: String,
    val message: String,
    val cooldownMin: Int,
    val signalName: String,
    val op: String,
    val valueNum: Double? = null,
    val valueText: String? = null,
    val valueBool: Boolean? = null,
    val valueMin: Double? = null,
    val valueMax: Double? = null,
)

/**
 * The typed alert-rule editor state — the native port of the web `editor` useState. Numeric fields are kept
 * as raw strings (exactly the web's controlled-input shape) so a half-typed value never throws; they are
 * parsed at the save boundary by [buildSaveRequest]. `LongParameterList` is suppressed because this is a
 * faithful 1:1 port of the web editor object, which carries every rule field on one record.
 */
@Suppress("LongParameterList")
data class AlertStudioEditor(
    val id: Long? = null,
    val name: String = "",
    val enabled: Boolean = true,
    val kind: RuleKind = RuleKind.Signal,
    val signalName: String = "",
    val op: String = ">",
    val valueNum: String = "",
    val valueText: String = "",
    val valueBool: Boolean = false,
    val valueMin: String = "",
    val valueMax: String = "",
    val severity: String = "warn",
    val cooldownMin: String = "30",
    val triggerMode: TriggerMode = TriggerMode.Unset,
    val maxFires: String = "",
    val escalationEnabled: Boolean = false,
    val escalationAfterMin: String = "",
    val escalationSeverity: String = "",
    val msgTemplate: String = "",
    val includeTitle: Boolean = true,
    val metricId: String = "",
    val metricWindow: String = "",
    val metricOp: String = ">",
    val metricThreshold: String = "",
    val allVehicles: Boolean = true,
    val vehicleIds: List<Long> = emptyList(),
)

/**
 * The page's local interaction snapshot — the union of the web component's `selectedId`, `ruleSearch`,
 * `templateSearch`, `templateCategory`, `showTemplates`, `bulkSelected`, `snoozeTargetId` and `editor`
 * `useState` cells. Held as one immutable record so the view-model exposes a single interaction StateFlow.
 */
@Suppress("LongParameterList")
data class AlertStudioInteraction(
    val editor: AlertStudioEditor = AlertStudioEditor(),
    val selectedRuleId: Long? = null,
    val ruleSearch: String = "",
    val templateSearch: String = "",
    val templateCategory: String? = null,
    val showTemplates: Boolean = false,
    val bulkSelected: Set<Long> = emptySet(),
    val snoozeTargetId: Long? = null,
    val testChannelIds: Set<Long>? = null,
) {
    /** True once the user has selected an existing rule into the editor (web `isEditing`). */
    val isEditing: Boolean get() = editor.id != null

    /** Whether [channelId] is a selected test-delivery target (web `testChannelIds === null || includes`). */
    fun isTestChannelSelected(channelId: Long): Boolean = testChannelIds == null || channelId in testChannelIds
}

/** The canonical severity ids, highest first — used to rank escalation severities (web `SEVERITY_RANK`). */
val severityRank: Map<String, Int> = mapOf("info" to 0, "warn" to 1, "critical" to 2)

/**
 * The pre-built rule templates the Templates panel offers (web `ruleTemplates`). A representative,
 * production-faithful set spanning every category so the category filter + template card render with real
 * data rather than a stand-in.
 */
val ruleTemplates: List<RuleTemplate> =
    listOf(
        RuleTemplate("Battery Low (< 20%)", "Battery", "warn", "Battery at {{BatteryLevel}}%", 30, "BatteryLevel", "<", valueNum = 20.0),
        RuleTemplate("Battery Critical (< 10%)", "Battery", "critical", "Battery critically low at {{BatteryLevel}}%!", 15, "BatteryLevel", "<", valueNum = 10.0),
        RuleTemplate("Battery Full (>= 90%)", "Battery", "info", "Battery reached {{BatteryLevel}}%", 60, "BatteryLevel", ">=", valueNum = 90.0),
        RuleTemplate("Charge Complete", "Charging", "info", "Charging complete at {{BatteryLevel}}%", 60, "ChargeState", "=", valueText = "Complete"),
        RuleTemplate("Charging Started", "Charging", "info", "Charging started - {{DetailedChargeState}}", 15, "DetailedChargeState", "=", valueText = "Charging"),
        RuleTemplate("Slow Charge Rate", "Charging", "warn", "Charging slow: {{ChargeAmps}}A", 60, "ChargeAmps", "between", valueMin = 0.01, valueMax = 5.0),
        RuleTemplate("Drive Started", "Driving", "info", "Drive started - gear is {{Gear}}", 5, "Gear", "=", valueText = "D"),
        RuleTemplate("Speed Limit Exceeded", "Driving", "warn", "Speed {{VehicleSpeed}} km/h exceeded limit", 15, "VehicleSpeed", ">", valueNum = 120.0),
        RuleTemplate("High Speed Alert (> 160 km/h)", "Driving", "critical", "Very high speed: {{VehicleSpeed}} km/h!", 5, "VehicleSpeed", ">", valueNum = 160.0),
        RuleTemplate("Car Unlocked While Parked", "Security", "critical", "Vehicle is unlocked and parked!", 30, "Locked", "=", valueBool = false),
        RuleTemplate("Vehicle Locked", "Security", "info", "Vehicle locked", 5, "Locked", "=", valueBool = true),
        RuleTemplate("Sentry Mode Activated", "Security", "info", "Sentry mode activated", 30, "SentryMode", "=", valueBool = true),
        RuleTemplate("Cabin Overheat (> 40C)", "Climate", "warn", "Cabin temp: {{InsideTemp}}C", 30, "InsideTemp", ">", valueNum = 40.0),
        RuleTemplate("Cabin Freezing (< 0C)", "Climate", "warn", "Cabin temp: {{InsideTemp}}C - freezing!", 60, "InsideTemp", "<", valueNum = 0.0),
        RuleTemplate("Tire Pressure Low", "Climate", "warn", "Front-left tire: {{TpmsPressureFl}} bar", 120, "TpmsPressureFl", "<", valueNum = 2.5),
        RuleTemplate("Odometer Milestone", "Driving", "info", "Odometer: {{Odometer}} km", 1440, "Odometer", ">", valueNum = 100000.0),
    )

/** The telemetry-signal catalog the signal-threshold editor selects from (web signal definitions). */
val signalCatalog: List<SignalDef> =
    listOf(
        SignalDef("BatteryLevel", "Battery", SignalValueType.Numeric),
        SignalDef("RatedRange", "Battery", SignalValueType.Numeric),
        SignalDef("ChargeState", "Charging", SignalValueType.Text),
        SignalDef("DetailedChargeState", "Charging", SignalValueType.Text),
        SignalDef("ChargeAmps", "Charging", SignalValueType.Numeric),
        SignalDef("DCChargingPower", "Charging", SignalValueType.Numeric),
        SignalDef("VehicleSpeed", "Driving", SignalValueType.Numeric),
        SignalDef("Gear", "Driving", SignalValueType.Text),
        SignalDef("Odometer", "Driving", SignalValueType.Numeric),
        SignalDef("Locked", "Security", SignalValueType.Bool),
        SignalDef("SentryMode", "Security", SignalValueType.Bool),
        SignalDef("InsideTemp", "Climate", SignalValueType.Numeric),
        SignalDef("TpmsPressureFl", "Climate", SignalValueType.Numeric),
    )

/** The ordered template categories (web `templateCategories`), de-duplicated by first appearance. */
val templateCategories: List<String> = ruleTemplates.map { it.category }.distinct()

/** The allowed operators for a signal of [valueType] (web `getOperatorsForType`); null falls back to numeric. */
fun operatorsForType(valueType: SignalValueType?): List<String> =
    when (valueType) {
        SignalValueType.Bool -> listOf("=", "changed")
        SignalValueType.Text -> listOf("=", "!=", "contains", "changed")
        SignalValueType.Numeric, null -> listOf("<", "<=", ">", ">=", "=", "!=", "between", "changed")
    }

/** The signal definition the editor currently targets, or null for a custom/unknown signal name. */
fun signalFor(signalName: String): SignalDef? = signalCatalog.firstOrNull { it.name == signalName }

/**
 * Which typed-value editor the condition row should render (web `valueKind`): `None` for a bare
 * change-trigger, `Range` for a `between` comparison, `Bool`/`Text` for those signal types, else `Number`.
 */
fun valueKindFor(editor: AlertStudioEditor): ValueKind {
    val type = signalFor(editor.signalName)?.valueType
    return when {
        editor.op == "changed" -> ValueKind.None
        editor.op == "between" -> ValueKind.Range
        type == SignalValueType.Bool -> ValueKind.Bool
        type == SignalValueType.Text -> ValueKind.Text
        else -> ValueKind.Number
    }
}

/** Normalizes any server severity string onto the canonical `info` | `warn` | `critical` ids. */
fun normalizeSeverity(severity: String?): String =
    when (severity?.lowercase()) {
        "info" -> "info"
        "critical" -> "critical"
        else -> "warn"
    }

/** Normalizes any server trigger-mode string onto the editor tri-state (web `normalizeTriggerMode`). */
fun normalizeTriggerMode(mode: String?): TriggerMode =
    when (mode?.lowercase()) {
        "once" -> TriggerMode.Once
        "repeat" -> TriggerMode.Repeat
        else -> TriggerMode.Unset
    }

/** True while [snoozedUntil] (ISO-8601) is still in the future relative to [nowEpochMs] (web `isSnoozeActive`). */
fun isSnoozeActive(
    snoozedUntil: String?,
    nowEpochMs: Long,
): Boolean {
    val until =
        snoozedUntil
            ?.takeIf { it.isNotBlank() }
            ?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
    return until != null && until > nowEpochMs
}

/** The rules matching the case-insensitive [search] over name + signal name (web `filteredRules`). */
fun filterRules(
    rules: List<AlertRule>,
    search: String,
): List<AlertRule> {
    val needle = search.trim().lowercase()
    if (needle.isEmpty()) return rules
    return rules.filter { rule ->
        rule.name.lowercase().contains(needle) || rule.signalName.lowercase().contains(needle)
    }
}

/** The templates matching the [category] filter and case-insensitive [search] (web `filteredTemplates`). */
fun filterTemplates(
    templates: List<RuleTemplate>,
    search: String,
    category: String?,
): List<RuleTemplate> {
    val needle = search.trim().lowercase()
    return templates.filter { tpl ->
        val categoryOk = category == null || tpl.category == category
        val searchOk =
            needle.isEmpty() ||
                tpl.name.lowercase().contains(needle) ||
                tpl.message.lowercase().contains(needle)
        categoryOk && searchOk
    }
}

/**
 * Whether the editor is in a savable state (web `canSave`): a non-blank name, an explicit alert behavior
 * (the force-choose gate), a vehicle scope, and a target (a signal for signal rules, a metric for computed).
 */
fun canSave(editor: AlertStudioEditor): Boolean {
    val targetOk =
        if (editor.kind == RuleKind.ComputedMetric) {
            editor.metricId.isNotBlank()
        } else {
            editor.signalName.isNotBlank()
        }
    val vehiclesOk = editor.allVehicles || editor.vehicleIds.isNotEmpty()
    return editor.name.isNotBlank() && editor.triggerMode != TriggerMode.Unset && vehiclesOk && targetOk
}

/** Hydrates the editor from an existing [rule] for editing (web `handleSelectRule`). */
fun editorFromRule(rule: AlertRule): AlertStudioEditor =
    AlertStudioEditor(
        id = rule.id,
        name = rule.name,
        enabled = rule.enabled,
        kind = if (rule.kind == "computed_metric") RuleKind.ComputedMetric else RuleKind.Signal,
        signalName = rule.signalName,
        op = rule.op.ifBlank { ">" },
        valueNum = rule.valueNum?.let { numToString(it) } ?: "",
        valueText = rule.valueText ?: "",
        valueBool = rule.valueBool ?: false,
        valueMin = rule.valueMin?.let { numToString(it) } ?: "",
        valueMax = rule.valueMax?.let { numToString(it) } ?: "",
        severity = normalizeSeverity(rule.severity),
        cooldownMin = rule.cooldownMin.toString(),
        triggerMode = normalizeTriggerMode(rule.triggerMode),
        maxFires = rule.maxFiresPerResolution?.toString() ?: "",
        escalationEnabled = rule.escalationAfterMin != null || rule.escalationSeverity != null,
        escalationAfterMin = rule.escalationAfterMin?.toString() ?: "",
        escalationSeverity = rule.escalationSeverity ?: "",
        msgTemplate = rule.msgTemplate ?: "",
        includeTitle = rule.includeTitle ?: true,
        metricId = rule.metricId ?: "",
        metricWindow = rule.metricWindow ?: "",
        metricOp = rule.metricOp ?: ">",
        metricThreshold = rule.metricThreshold?.let { numToString(it) } ?: "",
        allVehicles = rule.allVehicles ?: (rule.vehicleId == null && rule.vehicleIds.isNullOrEmpty()),
        vehicleIds = rule.vehicleIds ?: listOfNotNull(rule.vehicleId),
    )

/** Clones a [template] into a fresh, unsaved editor draft (web `handleCloneTemplate`). */
fun editorFromTemplate(template: RuleTemplate): AlertStudioEditor =
    AlertStudioEditor(
        id = null,
        name = template.name,
        enabled = true,
        kind = RuleKind.Signal,
        signalName = template.signalName,
        op = template.op,
        valueNum = template.valueNum?.let { numToString(it) } ?: "",
        valueText = template.valueText ?: "",
        valueBool = template.valueBool ?: false,
        valueMin = template.valueMin?.let { numToString(it) } ?: "",
        valueMax = template.valueMax?.let { numToString(it) } ?: "",
        severity = normalizeSeverity(template.severity),
        cooldownMin = template.cooldownMin.toString(),
        triggerMode = TriggerMode.Unset,
        msgTemplate = template.message,
    )

/**
 * Builds the discriminated save request from the editor (web `buildSavePayload` + the `if ('id' in data)`
 * branch): a [AlertRuleSaveRequest.Update] when editing an existing rule, else a [AlertRuleSaveRequest.Create].
 */
fun buildSaveRequest(editor: AlertStudioEditor): AlertRuleSaveRequest {
    val fields = editorFields(editor)
    val existingId = editor.id
    return if (existingId != null) {
        AlertRuleSaveRequest.Update(existingId, fields.toUpdate())
    } else {
        AlertRuleSaveRequest.Create(fields.toInput())
    }
}

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
fun recordAlertStudioPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to AlertStudioPageRegistration.SLUG))
}

// ── Save-payload assembly (web `buildSavePayload`) ────────────────────────────────────────────────────────

/**
 * The resolved, type-correct field set the create/update bodies share — built once from the raw editor so the
 * `AlertRuleInput` and `AlertRuleUpdate` projections never re-parse strings or diverge.
 */
private class EditorFields(
    val editor: AlertStudioEditor,
    val valueKind: ValueKind,
) {
    private val isComputed = editor.kind == RuleKind.ComputedMetric
    private val num = parseNum(editor.valueNum)
    private val min = parseNum(editor.valueMin)
    private val max = parseNum(editor.valueMax)

    private fun valueNum(): Double? = if (!isComputed && valueKind == ValueKind.Number) num else null

    private fun valueText(): String? =
        if (!isComputed && valueKind == ValueKind.Text) editor.valueText.takeIf { it.isNotBlank() } else null

    private fun valueBool(): Boolean? = if (!isComputed && valueKind == ValueKind.Bool) editor.valueBool else null

    private fun valueMin(): Double? = if (!isComputed && valueKind == ValueKind.Range) min else null

    private fun valueMax(): Double? = if (!isComputed && valueKind == ValueKind.Range) max else null

    private fun escAfter(): Int? =
        if (editor.triggerMode == TriggerMode.Repeat && editor.escalationEnabled) editor.escalationAfterMin.toIntOrNull() else null

    private fun escSeverity(): String? =
        if (editor.triggerMode == TriggerMode.Repeat && editor.escalationEnabled) {
            editor.escalationSeverity.takeIf { it.isNotBlank() }
        } else {
            null
        }

    private fun maxFires(): Int? = if (editor.triggerMode == TriggerMode.Repeat) editor.maxFires.toIntOrNull() else null

    fun toInput(): AlertRuleInput =
        AlertRuleInput(
            name = editor.name.trim(),
            enabled = editor.enabled,
            allVehicles = editor.allVehicles,
            vehicleIds = if (editor.allVehicles) null else editor.vehicleIds,
            signalName = if (isComputed) null else editor.signalName,
            op = if (isComputed) null else editor.op,
            valueNum = valueNum(),
            valueText = valueText(),
            valueBool = valueBool(),
            valueMin = valueMin(),
            valueMax = valueMax(),
            severity = editor.severity,
            cooldownMin = editor.cooldownMin.toIntOrNull(),
            triggerMode = editor.triggerMode.wire(),
            kind = if (isComputed) "computed_metric" else "signal",
            metricId = if (isComputed) editor.metricId.takeIf { it.isNotBlank() } else null,
            metricWindow = if (isComputed) editor.metricWindow.takeIf { it.isNotBlank() } else null,
            metricThreshold = if (isComputed) parseNum(editor.metricThreshold) else null,
            metricOp = if (isComputed) editor.metricOp else null,
            maxFiresPerResolution = maxFires(),
            escalationAfterMin = escAfter(),
            escalationSeverity = escSeverity(),
            msgTemplate = editor.msgTemplate.takeIf { it.isNotBlank() },
            includeTitle = editor.includeTitle,
        )

    fun toUpdate(): AlertRuleUpdate =
        AlertRuleUpdate(
            name = editor.name.trim(),
            enabled = editor.enabled,
            allVehicles = editor.allVehicles,
            vehicleIds = if (editor.allVehicles) null else editor.vehicleIds,
            signalName = if (isComputed) null else editor.signalName,
            op = if (isComputed) null else editor.op,
            valueNum = valueNum(),
            valueText = valueText(),
            valueBool = valueBool(),
            valueMin = valueMin(),
            valueMax = valueMax(),
            severity = editor.severity,
            cooldownMin = editor.cooldownMin.toIntOrNull(),
            triggerMode = editor.triggerMode.wire(),
            kind = if (isComputed) "computed_metric" else "signal",
            metricId = if (isComputed) editor.metricId.takeIf { it.isNotBlank() } else null,
            metricWindow = if (isComputed) editor.metricWindow.takeIf { it.isNotBlank() } else null,
            metricThreshold = if (isComputed) parseNum(editor.metricThreshold) else null,
            metricOp = if (isComputed) editor.metricOp else null,
            maxFiresPerResolution = maxFires(),
            escalationAfterMin = escAfter(),
            escalationSeverity = escSeverity(),
            msgTemplate = editor.msgTemplate.takeIf { it.isNotBlank() },
            includeTitle = editor.includeTitle,
        )
}

/** Resolves the editor into its shared, type-correct field set. */
private fun editorFields(editor: AlertStudioEditor): EditorFields = EditorFields(editor, valueKindFor(editor))

/** The strict wire value for the trigger mode, or null while still `Unset` (never sent — Save is blocked). */
private fun TriggerMode.wire(): String? =
    when (this) {
        TriggerMode.Once -> "once"
        TriggerMode.Repeat -> "repeat"
        TriggerMode.Unset -> null
    }

/** Renders a Double without a trailing `.0` for whole numbers, matching the web controlled-input string. */
private fun numToString(value: Double): String =
    if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()

/** Parses a controlled-input string to a Double, or null when blank/invalid (web `Number()` guard). */
private fun parseNum(text: String): Double? = text.toDoubleOrNull() // parity:allow toDoubleOrNull is the Kotlin parse API, not a TODO stub
