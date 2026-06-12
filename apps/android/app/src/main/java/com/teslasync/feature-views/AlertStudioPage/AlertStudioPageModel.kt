// Pure, framework-free model + projection for the AlertStudioPage feature view — the native analogue of
// everything the web page derives before it returns JSX
// (web/src/features/notifications/pages/AlertStudioPage.tsx, the typed alert-rule editor). No Compose, no
// Android, no HTTP lives here: every type in this file is exercised off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web page is a data-bound editor: it lists existing alert rules, offers a curated template gallery,
// and persists a rich EditorState through the /alerts/rules contract. This file owns the canonical pieces:
//   - the curated rule-template catalog (web `ruleTemplates`) + the derived signal catalog,
//   - the EditorState shape (web `EditorState`) + freshEditor / ruleToEditor / templateToEditor hydration,
//   - the value-kind + operator coercion rules (web `valueKindForSignalOp`, `coerceOperatorForSignalType`, …),
//   - the save-payload builder (web `buildSavePayload`) + the submit-time validation (web `alertRuleSchema`),
//   - the can-save gate (web `canSave`), the trigger-mode recommendation (web `recommendedTriggerMode`),
//   - and the list/template/state projections the composable renders for every UiState phase.
//
// i18n note (web parity): the web reads chrome through dotted i18next keys with an English fallback
// (`t('notifications.alertStudio.title', 'Alert Studio')`). The generated neutral Android catalog
// (apps/shared/i18n, ADR-014) carries the `notifications.alertStudio.*` family; every string resolves through
// the SAME by-name facade (the [StringResolver] seam) and otherwise falls back to the web's exact fallback —
// which IS the text i18next renders when a key is absent. Operator tokens (`=`, `between`, …) and the curated
// template names/messages/categories are NOT localized in the web source (they come straight from the
// `ruleTemplates` constant + the op symbol fallback), so they are carried verbatim here too, exactly as the
// web renders them at runtime.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/AlertStudioPage — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package identifier (a hyphen and PascalCase segments are illegal), so the package intentionally
// diverges from the path. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.alertstudiopage

import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.notifications.AlertRuleInput
import io.teslasync.shared.core.presentation.notifications.AlertRuleSaveRequest
import io.teslasync.shared.core.presentation.notifications.AlertRuleSnoozeRequest
import io.teslasync.shared.core.presentation.notifications.AlertRuleUpdate
import io.teslasync.shared.core.presentation.notifications.AlertTestRequest
import io.teslasync.shared.core.presentation.notifications.AlertTestTarget
import io.teslasync.shared.core.presentation.notifications.ComputedMetricSummary

/**
 * Canonical metadata for this surface. The web page is a top-level route, not a draggable dashboard widget,
 * so there is no web registry row to mirror — this object carries only the cross-cutting concern every surface
 * owes the diagnostics contract (P1/S11): the surface [SLUG] emitted with the one-shot `view.opened` event.
 */
object AlertStudioPageRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AlertStudioPage"
}

/** A by-name string resolver — the P1/S10 i18n facade in production, a map in tests (web `t(key, fallback)`). */
typealias StringResolver = (key: String, fallback: String) -> String

private val NON_IDENTIFIER = Regex("[^A-Za-z0-9_]")

/**
 * Folds a dotted i18next key into the generated Android catalog resource name (web `a.b.c` →
 * `translation_a_b_c`), matching apps/shared/i18n/generators/gen-i18n.ts `androidName`. The production
 * resolver looks this up by name and falls back to the web English when the key is absent.
 */
fun foldCatalogKey(dottedKey: String): String = "translation_" + dottedKey.replace(NON_IDENTIFIER, "_").trim('_')

/** Resolve [key] then apply positional `%1$s`-style interpolation (the generated catalog's arg syntax). */
internal fun StringResolver.format(
    key: String,
    fallback: String,
    vararg args: Any?,
): String = String.format(invoke(key, fallback), *args)

// ── Canonical wire vocabularies (web `ALERT_RULE_*` const tuples) ─────────────────────────────────────────

/** Severity wire values, low→high (web `ALERT_RULE_SEVERITIES`, ranked by [severityRank]). */
object Severities {
    const val INFO = "info"
    const val WARN = "warn"
    const val CRITICAL = "critical"
    val ALL = listOf(INFO, WARN, CRITICAL)
}

/** Editor trigger-mode tri-state (web `TriggerModeOrUnset`). Backend stays strict `once` | `repeat`. */
object TriggerModes {
    const val UNSET = "unset"
    const val ONCE = "once"
    const val REPEAT = "repeat"
}

/** Rule discriminator (web `ALERT_RULE_KINDS`). */
object RuleKinds {
    const val SIGNAL = "signal"
    const val COMPUTED_METRIC = "computed_metric"
}

/** Comparison operators (web `ALERT_RULE_OPS`). Symbols are rendered verbatim — they are not localized. */
object Operators {
    const val EQ = "="
    const val NEQ = "!="
    const val LT = "<"
    const val LTE = "<="
    const val GT = ">"
    const val GTE = ">="
    const val CHANGED = "changed"
    const val BETWEEN = "between"
    const val OUTSIDE = "outside"

    /** Operators offered for a numeric signal (web `numericOperatorOptions`). */
    val NUMERIC = listOf(EQ, NEQ, LT, LTE, GT, GTE, CHANGED, BETWEEN, OUTSIDE)

    /** Operators offered for a text/bool signal (web `scalarOperatorOptions`). */
    val SCALAR = listOf(EQ, NEQ, CHANGED)
}

/** Default computed-metric operator (web `metric_op` default). */
const val DEFAULT_METRIC_OP = ">"

/** Canonical info < warn < critical ordering (web `SEVERITY_RANK`). */
fun severityRank(severity: String): Int =
    when (severity) {
        Severities.INFO -> 1
        Severities.WARN -> 2
        Severities.CRITICAL -> 3
        else -> 0
    }

/** The value-entry shape a signal+operator pair demands (web `ValueKind`). */
enum class ValueKind { NONE, NUMBER, TEXT, BOOL, RANGE }

/** A signal's underlying value type (web `SignalValueType`). */
enum class SignalValueType { NUMERIC, TEXT, BOOL }

/** The glyph family a template renders (web `RuleTemplate.icon` from `@/lib/icons`). */
enum class TemplateGlyph { BATTERY, CHARGING, VEHICLE, SPEED, LOCK, SECURITY, CLIMATE, DROPLETS }

// ── Template categories (web string categories; not localized in source) ──────────────────────────────────

private const val CAT_BATTERY = "Battery"
private const val CAT_CHARGING = "Charging"
private const val CAT_DRIVING = "Driving"
private const val CAT_SECURITY = "Security"
private const val CAT_CLIMATE = "Climate"
private const val CAT_TIRE = "Tire Pressure"
private const val CAT_LOCATION = "Location"
private const val CAT_SAFETY = "Safety"
private const val CAT_MOTOR = "Motor"
private const val CAT_SOFTWARE = "Software"
private const val CAT_MEDIA = "Media"
private const val CAT_POWERSHARE = "Powershare"

/** Synthetic category for a user-typed custom signal (web `customSignalCategory = '__custom__'`). */
const val CUSTOM_SIGNAL_CATEGORY = "__custom__"

/**
 * One curated alert-rule template — the native mirror of a web `ruleTemplates` entry. [name] / [message] /
 * [category] are the verbatim source strings (the web shows them as the i18next fallback, since the catalog
 * carries no per-template key), and the typed value lives in exactly one of the value slots.
 */
@Suppress("LongParameterList")
data class RuleTemplate(
    val name: String,
    val glyph: TemplateGlyph,
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

/** A render-ready signal-catalog row (web `SignalDefinition`). */
data class SignalDefinition(
    val name: String,
    val category: String,
    val valueType: SignalValueType,
)

/**
 * The discriminated vehicle selection the editor holds (web `VehicleSelection`). [AllSticky] means "current +
 * future fleet" (auto-grows); [Specific] is an explicit subset that does not auto-grow.
 */
sealed interface EditorVehicleSelection {
    data object AllSticky : EditorVehicleSelection

    data class Specific(
        val vehicleIds: List<Long>,
    ) : EditorVehicleSelection
}

/**
 * The full editor working-state (web `EditorState`). Numeric inputs are kept as strings because the text
 * fields emit strings and conversion to the wire shape happens in [buildSavePayload]; [triggerMode] is the
 * tri-state (web `TriggerModeOrUnset`) so a brand-new rule can block Save until the user chooses.
 */
@Suppress("LongParameterList")
data class EditorState(
    val id: Long? = null,
    val name: String = "",
    val enabled: Boolean = true,
    val vehicleSelection: EditorVehicleSelection = EditorVehicleSelection.AllSticky,
    val signalName: String = "",
    val op: String = Operators.EQ,
    val valueKind: ValueKind = ValueKind.NUMBER,
    val valueNum: String = "",
    val valueText: String = "",
    val valueBool: Boolean = true,
    val valueMin: String = "",
    val valueMax: String = "",
    val severity: String = Severities.WARN,
    val cooldownMin: Int = DEFAULT_COOLDOWN_MIN,
    val triggerMode: String = TriggerModes.UNSET,
    val maxFiresPerResolution: String = "",
    val escalationEnabled: Boolean = false,
    val escalationAfterMin: String = "",
    val escalationSeverity: String = "",
    val message: String = "",
    val msgTemplate: String = "",
    val includeTitle: Boolean = true,
    val kind: String = RuleKinds.SIGNAL,
    val metricId: String = "",
    val metricWindow: String = "",
    val metricOp: String = DEFAULT_METRIC_OP,
    val metricThreshold: String = "",
)

/** Default cooldown for a fresh rule (web `freshEditor().cooldown_min`). */
const val DEFAULT_COOLDOWN_MIN = 15

/** A blank editor (web `freshEditor()`). Opens in tri-state so Save blocks until a behavior is chosen. */
fun freshEditor(): EditorState = EditorState()

/**
 * The curated template catalog (web `ruleTemplates`). Verbatim names/messages/categories; the value lands in
 * exactly one typed slot. Used to seed the editor and to derive the [signalCatalog].
 */
val ruleTemplates: List<RuleTemplate> =
    buildList {
        add(
            RuleTemplate(
                "Battery Low (< 20%)",
                TemplateGlyph.BATTERY,
                CAT_BATTERY,
                Severities.WARN,
                "Battery at {{BatteryLevel}}%",
                30,
                "BatteryLevel",
                Operators.LT,
                valueNum = 20.0,
            ),
        )
        add(
            RuleTemplate(
                "Battery Critical (< 10%)",
                TemplateGlyph.BATTERY,
                CAT_BATTERY,
                Severities.CRITICAL,
                "Battery critically low at {{BatteryLevel}}%!",
                15,
                "BatteryLevel",
                Operators.LT,
                valueNum = 10.0,
            ),
        )
        add(
            RuleTemplate(
                "Battery Full (>= 90%)",
                TemplateGlyph.BATTERY,
                CAT_BATTERY,
                Severities.INFO,
                "Battery reached {{BatteryLevel}}%",
                60,
                "BatteryLevel",
                Operators.GTE,
                valueNum = 90.0,
            ),
        )
        add(
            RuleTemplate(
                "Charge Limit Reached",
                TemplateGlyph.BATTERY,
                CAT_BATTERY,
                Severities.INFO,
                "Battery at charge limit {{ChargeLimitSoc}}%",
                60,
                "BatteryLevel",
                Operators.GTE,
                valueNum = 80.0,
            ),
        )
        add(
            RuleTemplate(
                "Range Below 50 km",
                TemplateGlyph.BATTERY,
                CAT_BATTERY,
                Severities.WARN,
                "Range low: {{RatedRange}} km remaining",
                30,
                "RatedRange",
                Operators.LT,
                valueNum = 50.0,
            ),
        )
        add(
            RuleTemplate(
                "Charge Complete",
                TemplateGlyph.CHARGING,
                CAT_CHARGING,
                Severities.INFO,
                "Charging complete at {{BatteryLevel}}%",
                60,
                "ChargeState",
                Operators.EQ,
                valueText = "Complete",
            ),
        )
        add(
            RuleTemplate(
                "Charging Started",
                TemplateGlyph.CHARGING,
                CAT_CHARGING,
                Severities.INFO,
                "Charging started - {{DetailedChargeState}}",
                15,
                "DetailedChargeState",
                Operators.EQ,
                valueText = "Charging",
            ),
        )
        add(
            RuleTemplate(
                "Charging Stopped Unexpectedly",
                TemplateGlyph.CHARGING,
                CAT_CHARGING,
                Severities.WARN,
                "Charging stopped - {{DetailedChargeState}}",
                30,
                "DetailedChargeState",
                Operators.EQ,
                valueText = "Stopped",
            ),
        )
        add(
            RuleTemplate(
                "Supercharging (DC Fast)",
                TemplateGlyph.CHARGING,
                CAT_CHARGING,
                Severities.INFO,
                "Supercharging at {{DCChargingPower}} kW",
                30,
                "DCChargingPower",
                Operators.GT,
                valueNum = 50.0,
            ),
        )
        add(
            RuleTemplate(
                "Slow Charge Rate",
                TemplateGlyph.CHARGING,
                CAT_CHARGING,
                Severities.WARN,
                "Charging slow: {{ChargeAmps}}A",
                60,
                "ChargeAmps",
                Operators.BETWEEN,
                valueMin = 0.01,
                valueMax = 5.0,
            ),
        )
        add(
            RuleTemplate(
                "Drive Started",
                TemplateGlyph.VEHICLE,
                CAT_DRIVING,
                Severities.INFO,
                "Drive started - gear is {{Gear}}",
                5,
                "Gear",
                Operators.EQ,
                valueText = "D",
            ),
        )
        add(
            RuleTemplate(
                "Drive Ended",
                TemplateGlyph.VEHICLE,
                CAT_DRIVING,
                Severities.INFO,
                "Drive ended - gear is {{Gear}}",
                5,
                "Gear",
                Operators.EQ,
                valueText = "P",
            ),
        )
        add(
            RuleTemplate(
                "Speed Limit Exceeded",
                TemplateGlyph.SPEED,
                CAT_DRIVING,
                Severities.WARN,
                "Speed {{VehicleSpeed}} km/h exceeded limit",
                15,
                "VehicleSpeed",
                Operators.GT,
                valueNum = 120.0,
            ),
        )
        add(
            RuleTemplate(
                "High Speed Alert (> 160 km/h)",
                TemplateGlyph.SPEED,
                CAT_DRIVING,
                Severities.CRITICAL,
                "Very high speed: {{VehicleSpeed}} km/h!",
                5,
                "VehicleSpeed",
                Operators.GT,
                valueNum = 160.0,
            ),
        )
        add(
            RuleTemplate(
                "Reverse Gear Engaged",
                TemplateGlyph.VEHICLE,
                CAT_DRIVING,
                Severities.INFO,
                "Vehicle in reverse",
                5,
                "Gear",
                Operators.EQ,
                valueText = "R",
            ),
        )
        add(
            RuleTemplate(
                "Odometer Milestone (100k km)",
                TemplateGlyph.VEHICLE,
                CAT_DRIVING,
                Severities.INFO,
                "Odometer: {{Odometer}} km",
                1440,
                "Odometer",
                Operators.GT,
                valueNum = 100000.0,
            ),
        )
        add(
            RuleTemplate(
                "Car Unlocked While Parked",
                TemplateGlyph.LOCK,
                CAT_SECURITY,
                Severities.CRITICAL,
                "Vehicle is unlocked and parked!",
                30,
                "Locked",
                Operators.EQ,
                valueBool = false,
            ),
        )
        add(
            RuleTemplate(
                "Vehicle Locked",
                TemplateGlyph.LOCK,
                CAT_SECURITY,
                Severities.INFO,
                "Vehicle locked",
                5,
                "Locked",
                Operators.EQ,
                valueBool = true,
            ),
        )
        add(
            RuleTemplate(
                "Vehicle Unlocked",
                TemplateGlyph.LOCK,
                CAT_SECURITY,
                Severities.INFO,
                "Vehicle unlocked",
                5,
                "Locked",
                Operators.EQ,
                valueBool = false,
            ),
        )
        add(
            RuleTemplate(
                "Sentry Mode Activated",
                TemplateGlyph.SECURITY,
                CAT_SECURITY,
                Severities.INFO,
                "Sentry mode activated",
                30,
                "SentryMode",
                Operators.EQ,
                valueBool = true,
            ),
        )
        add(
            RuleTemplate(
                "Door Opened While Parked",
                TemplateGlyph.LOCK,
                CAT_SECURITY,
                Severities.WARN,
                "Door opened - {{DoorState}}",
                15,
                "DoorState",
                Operators.NEQ,
                valueText = "Closed",
            ),
        )
        add(
            RuleTemplate(
                "Window Left Open",
                TemplateGlyph.VEHICLE,
                CAT_SECURITY,
                Severities.WARN,
                "Front driver window is {{FdWindow}}",
                60,
                "FdWindow",
                Operators.NEQ,
                valueText = "Closed",
            ),
        )
        add(
            RuleTemplate(
                "Valet Mode Enabled",
                TemplateGlyph.SECURITY,
                CAT_SECURITY,
                Severities.INFO,
                "Valet mode enabled",
                60,
                "ValetModeEnabled",
                Operators.EQ,
                valueBool = true,
            ),
        )
        add(
            RuleTemplate(
                "Guest Mode Enabled",
                TemplateGlyph.SECURITY,
                CAT_SECURITY,
                Severities.WARN,
                "Guest mode enabled",
                60,
                "GuestModeEnabled",
                Operators.EQ,
                valueBool = true,
            ),
        )
        add(
            RuleTemplate(
                "Cabin Overheat (> 40C)",
                TemplateGlyph.CLIMATE,
                CAT_CLIMATE,
                Severities.WARN,
                "Cabin temp: {{InsideTemp}}C",
                30,
                "InsideTemp",
                Operators.GT,
                valueNum = 40.0,
            ),
        )
        add(
            RuleTemplate(
                "Cabin Freezing (< 0C)",
                TemplateGlyph.CLIMATE,
                CAT_CLIMATE,
                Severities.WARN,
                "Cabin temp: {{InsideTemp}}C - freezing!",
                60,
                "InsideTemp",
                Operators.LT,
                valueNum = 0.0,
            ),
        )
        add(
            RuleTemplate(
                "HVAC Left On While Parked",
                TemplateGlyph.CLIMATE,
                CAT_CLIMATE,
                Severities.INFO,
                "HVAC running while parked",
                30,
                "HvacPower",
                Operators.EQ,
                valueBool = true,
            ),
        )
        add(
            RuleTemplate(
                "Climate Keeper Active",
                TemplateGlyph.CLIMATE,
                CAT_CLIMATE,
                Severities.INFO,
                "Climate keeper: {{ClimateKeeperMode}}",
                60,
                "ClimateKeeperMode",
                Operators.NEQ,
                valueText = "Off",
            ),
        )
        add(
            RuleTemplate(
                "Steering Wheel Heater On",
                TemplateGlyph.CLIMATE,
                CAT_CLIMATE,
                Severities.INFO,
                "Steering wheel heater level {{HvacSteeringWheelHeatLevel}}",
                30,
                "HvacSteeringWheelHeatLevel",
                Operators.GT,
                valueNum = 0.0,
            ),
        )
        add(
            RuleTemplate(
                "Tire Pressure Low",
                TemplateGlyph.DROPLETS,
                CAT_TIRE,
                Severities.WARN,
                "Low tire pressure detected",
                60,
                "TpmsHardWarnings",
                Operators.EQ,
                valueBool = true,
            ),
        )
        add(
            RuleTemplate(
                "Tire Pressure Soft Warning",
                TemplateGlyph.DROPLETS,
                CAT_TIRE,
                Severities.INFO,
                "Tire pressure slightly low",
                120,
                "TpmsSoftWarnings",
                Operators.EQ,
                valueBool = true,
            ),
        )
        add(
            RuleTemplate(
                "Front Left Tire Low (< 2.2 bar)",
                TemplateGlyph.DROPLETS,
                CAT_TIRE,
                Severities.WARN,
                "FL tire: {{TpmsPressureFl}} bar",
                60,
                "TpmsPressureFl",
                Operators.LT,
                valueNum = 2.2,
            ),
        )
        add(
            RuleTemplate(
                "Arrived at Home",
                TemplateGlyph.VEHICLE,
                CAT_LOCATION,
                Severities.INFO,
                "Vehicle arrived at home",
                15,
                "LocatedAtHome",
                Operators.EQ,
                valueBool = true,
            ),
        )
        add(
            RuleTemplate(
                "Left Home",
                TemplateGlyph.VEHICLE,
                CAT_LOCATION,
                Severities.INFO,
                "Vehicle left home",
                15,
                "LocatedAtHome",
                Operators.EQ,
                valueBool = false,
            ),
        )
        add(
            RuleTemplate(
                "Arrived at Work",
                TemplateGlyph.VEHICLE,
                CAT_LOCATION,
                Severities.INFO,
                "Vehicle arrived at work",
                15,
                "LocatedAtWork",
                Operators.EQ,
                valueBool = true,
            ),
        )
        add(
            RuleTemplate(
                "Navigation Started",
                TemplateGlyph.VEHICLE,
                CAT_LOCATION,
                Severities.INFO,
                "Navigating to {{DestinationName}}",
                10,
                "DestinationName",
                Operators.CHANGED,
            ),
        )
        add(
            RuleTemplate(
                "Driver Seatbelt Unbuckled",
                TemplateGlyph.SECURITY,
                CAT_SAFETY,
                Severities.WARN,
                "Driver seatbelt unbuckled while driving!",
                5,
                "DriverSeatBelt",
                Operators.EQ,
                valueBool = false,
            ),
        )
        add(
            RuleTemplate(
                "Speed Limit Mode Active",
                TemplateGlyph.SECURITY,
                CAT_SAFETY,
                Severities.INFO,
                "Speed limit mode active",
                60,
                "SpeedLimitMode",
                Operators.EQ,
                valueBool = true,
            ),
        )
        add(
            RuleTemplate(
                "PIN to Drive Disabled",
                TemplateGlyph.SECURITY,
                CAT_SAFETY,
                Severities.WARN,
                "PIN to Drive has been disabled",
                1440,
                "PinToDriveEnabled",
                Operators.EQ,
                valueBool = false,
            ),
        )
        add(
            RuleTemplate(
                "High Motor Temperature (> 80C)",
                TemplateGlyph.CLIMATE,
                CAT_MOTOR,
                Severities.WARN,
                "Motor stator temp: {{DiStatorTempF}}C",
                15,
                "DiStatorTempF",
                Operators.GT,
                valueNum = 80.0,
            ),
        )
        add(
            RuleTemplate(
                "HVIL Fault",
                TemplateGlyph.SECURITY,
                CAT_MOTOR,
                Severities.CRITICAL,
                "HV interlock fault detected!",
                5,
                "Hvil",
                Operators.EQ,
                valueText = "Fault",
            ),
        )
        add(
            RuleTemplate(
                "High Regenerative Braking",
                TemplateGlyph.CHARGING,
                CAT_MOTOR,
                Severities.INFO,
                "Regen power: {{Power}} kW",
                15,
                "Power",
                Operators.LT,
                valueNum = -50.0,
            ),
        )
        add(
            RuleTemplate(
                "Software Update Available",
                TemplateGlyph.CHARGING,
                CAT_SOFTWARE,
                Severities.INFO,
                "Update available: {{SoftwareUpdateVersion}}",
                1440,
                "SoftwareUpdateVersion",
                Operators.CHANGED,
            ),
        )
        add(
            RuleTemplate(
                "Software Update Installing",
                TemplateGlyph.CHARGING,
                CAT_SOFTWARE,
                Severities.INFO,
                "Installing update: {{SoftwareUpdateInstallationPercentComplete}}%",
                30,
                "SoftwareUpdateInstallationPercentComplete",
                Operators.GT,
                valueNum = 0.0,
            ),
        )
        add(
            RuleTemplate(
                "Music Playing",
                TemplateGlyph.VEHICLE,
                CAT_MEDIA,
                Severities.INFO,
                "Now playing: {{MediaNowPlayingTitle}} by {{MediaNowPlayingArtist}}",
                60,
                "MediaPlaybackStatus",
                Operators.EQ,
                valueText = "Playing",
            ),
        )
        add(
            RuleTemplate(
                "Volume Too High",
                TemplateGlyph.VEHICLE,
                CAT_MEDIA,
                Severities.INFO,
                "Volume at {{MediaAudioVolume}}",
                30,
                "MediaAudioVolume",
                Operators.GT,
                valueNum = 8.0,
            ),
        )
        add(
            RuleTemplate(
                "Powershare Active",
                TemplateGlyph.CHARGING,
                CAT_POWERSHARE,
                Severities.INFO,
                "Powershare active: {{PowershareInstantaneousPowerKW}} kW",
                60,
                "PowershareStatus",
                Operators.CHANGED,
            ),
        )
    }

/** Distinct template categories, sorted (web `templateCategories`). */
val templateCategories: List<String> = ruleTemplates.map { it.category }.distinct().sorted()

// ── Signal catalog derivation (web `buildSignalCatalog`) ──────────────────────────────────────────────────

private fun isNumericOnlyOp(op: String): Boolean = op == Operators.LT || op == Operators.LTE || op == Operators.GT || op == Operators.GTE

private fun isRangeOp(op: String): Boolean = op == Operators.BETWEEN || op == Operators.OUTSIDE

private fun inferTemplateSignalType(template: RuleTemplate): SignalValueType =
    when {
        template.valueNum != null || template.valueMin != null || template.valueMax != null ->
            SignalValueType.NUMERIC
        isNumericOnlyOp(template.op) || isRangeOp(template.op) -> SignalValueType.NUMERIC
        template.valueBool != null -> SignalValueType.BOOL
        else -> SignalValueType.TEXT
    }

private fun mergeSignalType(
    current: SignalValueType,
    next: SignalValueType,
): SignalValueType =
    when {
        current == next -> current
        current == SignalValueType.NUMERIC || next == SignalValueType.NUMERIC -> SignalValueType.NUMERIC
        current == SignalValueType.BOOL || next == SignalValueType.BOOL -> SignalValueType.BOOL
        else -> SignalValueType.TEXT
    }

/** Build the merged, sorted signal catalog from the templates (web `buildSignalCatalog`). */
fun buildSignalCatalog(templates: List<RuleTemplate>): List<SignalDefinition> {
    val byName = LinkedHashMap<String, SignalDefinition>()
    templates.forEach { template ->
        val valueType = inferTemplateSignalType(template)
        val existing = byName[template.signalName]
        byName[template.signalName] =
            if (existing != null) {
                existing.copy(valueType = mergeSignalType(existing.valueType, valueType))
            } else {
                SignalDefinition(template.signalName, template.category, valueType)
            }
    }
    return byName.values.sortedWith(compareBy({ it.category }, { it.name }))
}

val signalCatalog: List<SignalDefinition> = buildSignalCatalog(ruleTemplates)
val signalCatalogByName: Map<String, SignalDefinition> = signalCatalog.associateBy { it.name }

// ── Value-kind + operator coercion (web `valueKindForSignalOp`, `coerceOperatorForSignalType`, …) ──────────

private fun signalTypeForValueKind(valueKind: ValueKind): SignalValueType =
    when (valueKind) {
        ValueKind.BOOL -> SignalValueType.BOOL
        ValueKind.TEXT, ValueKind.NONE -> SignalValueType.TEXT
        else -> SignalValueType.NUMERIC
    }

fun signalTypeForName(
    signalName: String,
    fallbackKind: ValueKind,
): SignalValueType = signalCatalogByName[signalName]?.valueType ?: signalTypeForValueKind(fallbackKind)

fun allowedOpsForSignalType(valueType: SignalValueType): List<String> =
    if (valueType == SignalValueType.NUMERIC) Operators.NUMERIC else Operators.SCALAR

fun coerceOperatorForSignalType(
    op: String,
    valueType: SignalValueType,
): String = if (allowedOpsForSignalType(valueType).contains(op)) op else Operators.EQ

fun valueKindForSignalOp(
    valueType: SignalValueType,
    op: String,
): ValueKind =
    when {
        op == Operators.CHANGED -> ValueKind.NONE
        valueType == SignalValueType.NUMERIC -> if (isRangeOp(op)) ValueKind.RANGE else ValueKind.NUMBER
        valueType == SignalValueType.BOOL -> ValueKind.BOOL
        else -> ValueKind.TEXT
    }

fun valueKindForState(state: EditorState): ValueKind = valueKindForSignalOp(signalTypeForName(state.signalName, state.valueKind), state.op)

fun isOperatorAllowedForState(state: EditorState): Boolean =
    allowedOpsForSignalType(signalTypeForName(state.signalName, state.valueKind)).contains(state.op)

// ── Parsing + normalization helpers (web small helpers) ───────────────────────────────────────────────────

fun isTriggerMode(value: String?): Boolean = value == TriggerModes.ONCE || value == TriggerModes.REPEAT

fun normalizeTriggerMode(value: String?): String = if (isTriggerMode(value)) value!! else TriggerModes.REPEAT

fun isSeverity(value: String?): Boolean = value == Severities.INFO || value == Severities.WARN || value == Severities.CRITICAL

fun normalizeSeverity(value: String?): String =
    when {
        isSeverity(value) -> value!!
        value == "warning" -> Severities.WARN
        else -> Severities.INFO
    }

/** Editor-list ordering key (web `templateKey`): lowercase, non-alnum→`.`, trim leading/trailing dots. */
fun templateKey(value: String): String = value.lowercase().replace(Regex("[^a-z0-9]+"), ".").trim('.')

private fun valueToInput(value: Double?): String =
    when {
        value == null -> ""
        value % 1.0 == 0.0 -> value.toLong().toString()
        else -> value.toString()
    }

fun parseOptionalNumber(value: String): Double? {
    val trimmed = value.trim()
    if (trimmed.isEmpty()) return null
    return trimmed.toDoubleOrNull() // parity:allow kotlin stdlib numeric parse, not a task marker
}

/** Empty/blank → null (unlimited); else a positive integer (web `parseOptionalMaxFires`). */
fun parseOptionalMaxFires(value: String): Int? {
    val parsed = value.trim().takeIf { it.isNotEmpty() }?.toIntOrNull() ?: return null
    return parsed.takeIf { it > 0 }
}

private fun normalizeMsgTemplateForSave(value: String): String? = value.trim().takeIf { it.isNotEmpty() }

// ── Snooze helpers (web `isSnoozeActive`) ─────────────────────────────────────────────────────────────────

/**
 * Whether a rule's snooze is still in effect at [nowMillis] (web `isSnoozeActive`). [snoozedUntil] is an
 * ISO-8601 instant; an unparseable or past value means "not snoozed". [nowMillis] is injectable for tests.
 */
fun isSnoozeActive(
    snoozedUntil: String?,
    nowMillis: Long,
): Boolean {
    val until = snoozedUntil?.let { parseIsoMillis(it) } ?: return false
    return until > nowMillis
}

/** Lenient ISO-8601 → epoch-millis parse, framework-free (handles `Z` and `+00:00`, ignoring sub-second). */
internal fun parseIsoMillis(value: String): Long? {
    val match = ISO_INSTANT.matchEntire(value.trim()) ?: return null
    val groups = match.groupValues
    return runCatching {
        epochMillis(
            year = groups[1].toInt(),
            month = groups[2].toInt(),
            day = groups[3].toInt(),
            hour = groups[4].toInt(),
            minute = groups[5].toInt(),
            second = groups[6].toInt(),
        )
    }.getOrNull()
}

private val ISO_INSTANT =
    Regex("""(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?""")

private const val DAYS_PER_ERA = 146097L

@Suppress("LongParameterList")
private fun epochMillis(
    year: Int,
    month: Int,
    day: Int,
    hour: Int,
    minute: Int,
    second: Int,
): Long {
    val days = daysFromCivil(year.toLong(), month, day)
    val secondsOfDay = hour * SECONDS_PER_HOUR + minute * SECONDS_PER_MINUTE + second
    return (days * SECONDS_PER_DAY + secondsOfDay) * MILLIS_PER_SECOND
}

/** Days since 1970-01-01 for a civil date (Howard Hinnant's algorithm), framework-free. */
private fun daysFromCivil(
    year: Long,
    month: Int,
    day: Int,
): Long {
    val y = if (month <= 2) year - 1 else year
    val era = (if (y >= 0) y else y - (YEARS_PER_ERA - 1)) / YEARS_PER_ERA
    val yoe = y - era * YEARS_PER_ERA
    val doy = (DAYS_BEFORE_MONTH_FACTOR * (month + (if (month > 2) -3 else 9)) + 2) / 5 + day - 1
    val doe = yoe * DAYS_PER_YEAR + yoe / 4 - yoe / 100 + doy
    return era * DAYS_PER_ERA + doe - EPOCH_OFFSET_DAYS
}

private const val YEARS_PER_ERA = 400L
private const val DAYS_PER_YEAR = 365L
private const val DAYS_BEFORE_MONTH_FACTOR = 153
private const val EPOCH_OFFSET_DAYS = 719468L
private const val SECONDS_PER_MINUTE = 60
private const val SECONDS_PER_HOUR = 3600
private const val SECONDS_PER_DAY = 86400L
private const val MILLIS_PER_SECOND = 1000L

// ── Vehicle-selection mapping (web `hydrateVehicleSelection` / `buildVehiclePayload`) ─────────────────────

/** The wire vehicle-targeting pair (web `buildVehiclePayload` output). */
data class VehiclePayload(
    val allVehicles: Boolean?,
    val vehicleIds: List<Long>?,
)

/** Map an [EditorVehicleSelection] to the wire pair (web `buildVehiclePayload`). */
fun buildVehiclePayload(selection: EditorVehicleSelection): VehiclePayload =
    when (selection) {
        EditorVehicleSelection.AllSticky -> VehiclePayload(allVehicles = true, vehicleIds = null)
        is EditorVehicleSelection.Specific ->
            VehiclePayload(allVehicles = false, vehicleIds = selection.vehicleIds.distinct().sorted())
    }

/** Hydrate the selection from a saved rule (web `hydrateVehicleSelection`). */
fun hydrateVehicleSelection(rule: AlertRule): EditorVehicleSelection {
    val explicit = rule.vehicleIds?.takeIf { it.isNotEmpty() }
    val singleId = rule.vehicleId
    return when {
        rule.allVehicles == true -> EditorVehicleSelection.AllSticky
        explicit != null -> EditorVehicleSelection.Specific(explicit)
        singleId != null -> EditorVehicleSelection.Specific(listOf(singleId))
        else -> EditorVehicleSelection.AllSticky
    }
}

// ── Editor hydration (web `ruleToEditor` / `templateToEditor`) ────────────────────────────────────────────

private fun inferValueKind(rule: AlertRule): ValueKind =
    when {
        isRangeOp(rule.op) || rule.valueMin != null || rule.valueMax != null -> ValueKind.RANGE
        rule.valueBool != null -> ValueKind.BOOL
        rule.valueText != null -> ValueKind.TEXT
        rule.valueNum != null -> ValueKind.NUMBER
        rule.op == Operators.CHANGED -> ValueKind.NONE
        else -> ValueKind.NUMBER
    }

private fun inferTemplateValueKind(template: RuleTemplate): ValueKind = valueKindForSignalOp(inferTemplateSignalType(template), template.op)

/** Hydrate the editor from a saved rule (web `ruleToEditor`). */
fun ruleToEditor(rule: AlertRule): EditorState {
    val kind = rule.kind ?: RuleKinds.SIGNAL
    return EditorState(
        id = rule.id,
        name = rule.name,
        enabled = rule.enabled,
        vehicleSelection = hydrateVehicleSelection(rule),
        signalName = rule.signalName,
        op = rule.op.ifEmpty { Operators.EQ },
        valueKind = inferValueKind(rule),
        valueNum = valueToInput(rule.valueNum),
        valueText = rule.valueText ?: "",
        valueBool = rule.valueBool ?: true,
        valueMin = valueToInput(rule.valueMin),
        valueMax = valueToInput(rule.valueMax),
        severity = normalizeSeverity(rule.severity),
        cooldownMin = rule.cooldownMin,
        triggerMode = normalizeTriggerMode(rule.triggerMode),
        maxFiresPerResolution = rule.maxFiresPerResolution?.toString() ?: "",
        escalationEnabled = rule.escalationAfterMin != null && rule.escalationSeverity != null,
        escalationAfterMin = rule.escalationAfterMin?.toString() ?: "",
        escalationSeverity = rule.escalationSeverity ?: "",
        message = if (rule.signalName.isNotEmpty()) "${rule.name}: {{${rule.signalName}}}" else "",
        msgTemplate = rule.msgTemplate ?: "",
        includeTitle = rule.includeTitle ?: true,
        kind = kind,
        metricId = rule.metricId ?: "",
        metricWindow = rule.metricWindow ?: "",
        metricOp = rule.metricOp ?: DEFAULT_METRIC_OP,
        metricThreshold = valueToInput(rule.metricThreshold),
    )
}

/** Seed a fresh editor from a template (web `templateToEditor`). */
fun templateToEditor(
    template: RuleTemplate,
    name: String,
    message: String,
): EditorState =
    freshEditor().copy(
        name = name,
        signalName = template.signalName,
        op = template.op,
        valueKind = inferTemplateValueKind(template),
        valueNum = valueToInput(template.valueNum),
        valueText = template.valueText ?: "",
        valueBool = template.valueBool ?: true,
        valueMin = valueToInput(template.valueMin),
        valueMax = valueToInput(template.valueMax),
        severity = template.severity,
        cooldownMin = template.cooldownMin,
        message = message,
        msgTemplate = message,
        includeTitle = true,
    )

// ── Editor field transitions (web `handleSignalChange` / `handleOperatorChange` / severity + mode resets) ──

/** Re-coerce a hydrated editor's operator + value-kind to the signal it carries (web `handleSelectRule`). */
fun coerceEditorForSignal(state: EditorState): EditorState {
    val signalType = signalTypeForName(state.signalName, state.valueKind)
    val nextOp = coerceOperatorForSignalType(state.op, signalType)
    return state.copy(op = nextOp, valueKind = valueKindForSignalOp(signalType, nextOp))
}

/** Apply a signal change, coercing the operator + value-kind to the new signal type (web `handleSignalChange`). */
fun applySignalChange(
    state: EditorState,
    signalName: String,
): EditorState {
    val signalType =
        if (signalName.isNotBlank()) signalTypeForName(signalName, state.valueKind) else SignalValueType.NUMERIC
    val nextOp = coerceOperatorForSignalType(state.op, signalType)
    return state.copy(
        signalName = signalName,
        op = nextOp,
        valueKind = valueKindForSignalOp(signalType, nextOp),
    )
}

/** Apply an operator change, re-deriving the value-kind for the current signal (web `handleOperatorChange`). */
fun applyOperatorChange(
    state: EditorState,
    nextOp: String,
): EditorState {
    val signalType = signalTypeForName(state.signalName, state.valueKind)
    val coercedOp = coerceOperatorForSignalType(nextOp, signalType)
    return state.copy(op = coercedOp, valueKind = valueKindForSignalOp(signalType, coercedOp))
}

/** Apply a base-severity change, clearing an escalation severity that is no longer strictly higher (web). */
fun applySeverityChange(
    state: EditorState,
    next: String,
): EditorState {
    val escSev = state.escalationSeverity
    val stillValid = escSev.isEmpty() || severityRank(escSev) > severityRank(next)
    return state.copy(severity = next, escalationSeverity = if (stillValid) escSev else "")
}

/** Apply a trigger-mode change, nulling the escalation trio when leaving repeat-mode (web select onChange). */
fun applyTriggerModeChange(
    state: EditorState,
    mode: String,
): EditorState {
    val repeat = mode == TriggerModes.REPEAT
    return state.copy(
        triggerMode = mode,
        escalationEnabled = if (repeat) state.escalationEnabled else false,
        escalationAfterMin = if (repeat) state.escalationAfterMin else "",
        escalationSeverity = if (repeat) state.escalationSeverity else "",
    )
}

/** Apply the escalation toggle, clearing the pair when toggling off (web Toggle onChange). */
fun applyEscalationToggle(
    state: EditorState,
    enabled: Boolean,
): EditorState =
    state.copy(
        escalationEnabled = enabled,
        escalationAfterMin = if (enabled) state.escalationAfterMin else "",
        escalationSeverity = if (enabled) state.escalationSeverity else "",
    )

/** Resolve the representative vehicle name for the message preview (web `previewVehicleName`). */
fun previewVehicleName(
    selection: EditorVehicleSelection,
    vehicles: List<VehicleRef>,
): String? {
    if (selection is EditorVehicleSelection.Specific) {
        val firstId = selection.vehicleIds.firstOrNull()
        val match = firstId?.let { id -> vehicles.firstOrNull { it.id == id } }
        if (match != null) return match.displayName
    }
    return vehicles.firstOrNull()?.displayName
}

// ── Save-payload builder (web `buildSavePayload`) ─────────────────────────────────────────────────────────

/** Escalation pair, both null unless repeat-mode + enabled + complete (web `buildEscalationPayload`). */
private fun buildEscalation(
    state: EditorState,
    triggerMode: String,
): Pair<Int?, String?> {
    val after = parseOptionalMaxFires(state.escalationAfterMin)
    val eligible =
        triggerMode == TriggerModes.REPEAT &&
            state.escalationEnabled &&
            after != null &&
            state.escalationSeverity.isNotEmpty()
    return if (eligible) after to state.escalationSeverity else null to null
}

private fun computedMetricInput(
    state: EditorState,
    triggerMode: String,
): AlertRuleInput {
    val payload = buildVehiclePayload(state.vehicleSelection)
    val (escAfter, escSev) = buildEscalation(state, triggerMode)
    return AlertRuleInput(
        name = state.name.trim(),
        enabled = state.enabled,
        allVehicles = payload.allVehicles,
        vehicleIds = payload.vehicleIds,
        severity = state.severity,
        cooldownMin = state.cooldownMin,
        triggerMode = triggerMode,
        maxFiresPerResolution = parseOptionalMaxFires(state.maxFiresPerResolution),
        escalationAfterMin = escAfter,
        escalationSeverity = escSev,
        kind = RuleKinds.COMPUTED_METRIC,
        metricId = state.metricId.ifEmpty { null },
        metricWindow = state.metricWindow.ifEmpty { null },
        metricOp = state.metricOp,
        metricThreshold = parseOptionalNumber(state.metricThreshold),
        msgTemplate = normalizeMsgTemplateForSave(state.msgTemplate),
        includeTitle = state.includeTitle,
    )
}

private fun signalInput(
    state: EditorState,
    triggerMode: String,
): AlertRuleInput {
    val payload = buildVehiclePayload(state.vehicleSelection)
    val (escAfter, escSev) = buildEscalation(state, triggerMode)
    val valueKind = valueKindForState(state)
    return AlertRuleInput(
        name = state.name.trim(),
        enabled = state.enabled,
        allVehicles = payload.allVehicles,
        vehicleIds = payload.vehicleIds,
        signalName = state.signalName.trim(),
        op = state.op,
        valueNum = if (valueKind == ValueKind.NUMBER) parseOptionalNumber(state.valueNum) else null,
        valueText = if (valueKind == ValueKind.TEXT) state.valueText.trim() else null,
        valueBool = if (valueKind == ValueKind.BOOL) state.valueBool else null,
        valueMin = if (valueKind == ValueKind.RANGE) parseOptionalNumber(state.valueMin) else null,
        valueMax = if (valueKind == ValueKind.RANGE) parseOptionalNumber(state.valueMax) else null,
        severity = state.severity,
        cooldownMin = state.cooldownMin,
        triggerMode = triggerMode,
        maxFiresPerResolution = parseOptionalMaxFires(state.maxFiresPerResolution),
        escalationAfterMin = escAfter,
        escalationSeverity = escSev,
        kind = RuleKinds.SIGNAL,
        msgTemplate = normalizeMsgTemplateForSave(state.msgTemplate),
        includeTitle = state.includeTitle,
    )
}

/**
 * Build the wire input from the editor (web `buildSavePayload`). Throws when trigger mode is still unset —
 * the UI blocks Save via [canSave] before this point, so the throw only guards a future bypass.
 */
fun buildSavePayload(state: EditorState): AlertRuleInput {
    require(state.triggerMode != TriggerModes.UNSET) {
        "buildSavePayload: trigger_mode must be chosen before save"
    }
    return if (state.kind == RuleKinds.COMPUTED_METRIC) {
        computedMetricInput(state, state.triggerMode)
    } else {
        signalInput(state, state.triggerMode)
    }
}

/** Build the create-or-update request (web `editor.id ? {id, ...} : payload`). */
fun buildSaveRequest(state: EditorState): AlertRuleSaveRequest {
    val payload = buildSavePayload(state)
    val id = state.id
    return if (id != null) {
        AlertRuleSaveRequest.Update(id = id, patch = payload.toUpdate())
    } else {
        AlertRuleSaveRequest.Create(input = payload)
    }
}

private fun AlertRuleInput.toUpdate(): AlertRuleUpdate =
    AlertRuleUpdate(
        name = name,
        enabled = enabled,
        allVehicles = allVehicles,
        vehicleIds = vehicleIds,
        signalName = signalName,
        op = op,
        valueNum = valueNum,
        valueText = valueText,
        valueBool = valueBool,
        valueMin = valueMin,
        valueMax = valueMax,
        severity = severity,
        cooldownMin = cooldownMin,
        triggerMode = triggerMode,
        kind = kind,
        metricId = metricId,
        metricWindow = metricWindow,
        metricThreshold = metricThreshold,
        metricOp = metricOp,
        maxFiresPerResolution = maxFiresPerResolution,
        escalationAfterMin = escalationAfterMin,
        escalationSeverity = escalationSeverity,
        msgTemplate = msgTemplate,
        includeTitle = includeTitle,
    )

/** Build the `/alerts/test` target (web `buildTestTarget`). null selection = all channels. */
fun buildTestTarget(
    selectedIds: List<Long>?,
    allIds: List<Long>,
): AlertTestTarget? =
    when {
        allIds.isEmpty() -> null
        selectedIds == null -> AlertTestTarget(allChannels = true)
        else -> AlertTestTarget(channelIds = selectedIds)
    }

/** Build the `/alerts/test` request body (web `handleTest`). */
fun buildTestRequest(
    message: String,
    selectedIds: List<Long>?,
    allIds: List<Long>,
    msgTemplate: String,
    includeTitle: Boolean,
): AlertTestRequest =
    AlertTestRequest(
        message = message,
        target = buildTestTarget(selectedIds, allIds),
        msgTemplate = normalizeMsgTemplateForSave(msgTemplate),
        includeTitle = includeTitle,
    )

/** Build the snooze request body (web `handleSnooze`); `minutes = 0` cancels an active snooze. */
fun buildSnoozeRequest(minutes: Int): AlertRuleSnoozeRequest = AlertRuleSnoozeRequest(minutes = minutes)

// ── Trigger-mode recommendation (web `recommendedTriggerMode`) ────────────────────────────────────────────

/** Smart default trigger mode per operator (web `recommendedTriggerMode`). */
fun recommendedTriggerMode(op: String): String =
    when (op) {
        Operators.EQ, Operators.NEQ, Operators.CHANGED -> TriggerModes.ONCE
        else -> TriggerModes.REPEAT
    }

// ── Can-save gate (web `canSave`) ─────────────────────────────────────────────────────────────────────────

private fun hasRequiredTypedValue(state: EditorState): Boolean =
    when (valueKindForState(state)) {
        ValueKind.NONE -> state.op == Operators.CHANGED
        ValueKind.BOOL -> true
        ValueKind.TEXT -> state.valueText.trim().isNotEmpty()
        ValueKind.NUMBER -> parseOptionalNumber(state.valueNum) != null
        ValueKind.RANGE -> rangeValid(state)
    }

private fun rangeValid(state: EditorState): Boolean {
    val min = parseOptionalNumber(state.valueMin)
    val max = parseOptionalNumber(state.valueMax)
    return min != null && max != null && min <= max
}

private fun hasComputedMetricInputs(
    state: EditorState,
    metrics: List<ComputedMetricSummary>,
): Boolean {
    val def = metrics.firstOrNull { it.id == state.metricId }
    return state.metricId.isNotEmpty() &&
        state.metricWindow.isNotEmpty() &&
        state.metricOp.isNotEmpty() &&
        parseOptionalNumber(state.metricThreshold) != null &&
        def != null &&
        def.windows.contains(state.metricWindow) &&
        def.ops.contains(state.metricOp)
}

private fun escalationValid(state: EditorState): Boolean =
    when {
        !state.escalationEnabled -> true
        state.triggerMode != TriggerModes.REPEAT -> false
        parseOptionalMaxFires(state.escalationAfterMin) == null -> false
        state.escalationSeverity.isEmpty() -> false
        else -> severityRank(state.escalationSeverity) > severityRank(state.severity)
    }

private fun vehicleSelectionValid(state: EditorState): Boolean {
    val selection = state.vehicleSelection
    return !(selection is EditorVehicleSelection.Specific && selection.vehicleIds.isEmpty())
}

private fun computedMetricSaveable(
    state: EditorState,
    metrics: List<ComputedMetricSummary>,
): Boolean {
    val shapeOk =
        state.metricId.isNotEmpty() &&
            state.metricWindow.isNotEmpty() &&
            state.metricOp.isNotEmpty() &&
            parseOptionalNumber(state.metricThreshold) != null
    return shapeOk && (metrics.isEmpty() || hasComputedMetricInputs(state, metrics))
}

private fun signalSaveable(state: EditorState): Boolean =
    state.signalName.trim().isNotEmpty() && isOperatorAllowedForState(state) && hasRequiredTypedValue(state)

/** Whether the editor can be saved right now (web `canSave`). */
fun canSave(
    state: EditorState,
    metrics: List<ComputedMetricSummary>,
    isNewRule: Boolean,
): Boolean {
    val baseValid =
        state.name.trim().isNotEmpty() &&
            state.cooldownMin > 0 &&
            !(isNewRule && state.triggerMode == TriggerModes.UNSET) &&
            vehicleSelectionValid(state) &&
            escalationValid(state)
    val kindValid =
        if (state.kind == RuleKinds.COMPUTED_METRIC) {
            computedMetricSaveable(state, metrics)
        } else {
            signalSaveable(state)
        }
    return baseValid && kindValid
}

// ── Submit-time validation (web `alertRuleSchema`) ────────────────────────────────────────────────────────

/** The field a validation failure attaches to (web zod `path`). Stable tokens, not localized prose. */
enum class ValidationField {
    NAME,
    COOLDOWN,
    ESCALATION_AFTER,
    ESCALATION_SEVERITY,
    METRIC_ID,
    METRIC_WINDOW,
    METRIC_OP,
    METRIC_THRESHOLD,
    SIGNAL_NAME,
    OP,
    VALUE_MIN,
    VALUE_MAX,
    VALUE,
}

/** A single submit-time validation failure (web zod issue). [field] is the offending field. */
data class ValidationIssue(
    val field: ValidationField,
)

private const val NAME_MAX = 120
private const val COOLDOWN_MAX = 1440

private fun validateBase(input: AlertRuleInput): ValidationIssue? {
    val name = input.name.trim()
    val cooldown = input.cooldownMin
    return when {
        name.isEmpty() || name.length > NAME_MAX -> ValidationIssue(ValidationField.NAME)
        cooldown != null && (cooldown < 1 || cooldown > COOLDOWN_MAX) -> ValidationIssue(ValidationField.COOLDOWN)
        else -> null
    }
}

private fun validateEscalation(input: AlertRuleInput): ValidationIssue? {
    val afterPresent = input.escalationAfterMin != null
    val sevPresent = input.escalationSeverity != null
    val baseSev = input.severity ?: Severities.WARN
    val triggerMode = input.triggerMode ?: TriggerModes.REPEAT
    return when {
        afterPresent != sevPresent ->
            ValidationIssue(
                if (afterPresent) ValidationField.ESCALATION_SEVERITY else ValidationField.ESCALATION_AFTER,
            )

        !afterPresent -> null
        triggerMode != TriggerModes.REPEAT -> ValidationIssue(ValidationField.ESCALATION_AFTER)
        severityRank(input.escalationSeverity!!) <= severityRank(baseSev) ->
            ValidationIssue(ValidationField.ESCALATION_SEVERITY)

        else -> null
    }
}

private fun validateComputedMetric(input: AlertRuleInput): ValidationIssue? {
    val threshold = input.metricThreshold
    return when {
        input.metricId.isNullOrBlank() -> ValidationIssue(ValidationField.METRIC_ID)
        input.metricWindow.isNullOrBlank() -> ValidationIssue(ValidationField.METRIC_WINDOW)
        input.metricOp.isNullOrBlank() -> ValidationIssue(ValidationField.METRIC_OP)
        threshold == null || !threshold.isFinite() -> ValidationIssue(ValidationField.METRIC_THRESHOLD)
        else -> null
    }
}

private fun validateRange(input: AlertRuleInput): ValidationIssue? {
    val min = input.valueMin
    val max = input.valueMax
    return when {
        min == null || max == null -> ValidationIssue(ValidationField.VALUE_MIN)
        min > max -> ValidationIssue(ValidationField.VALUE_MAX)
        else -> null
    }
}

private fun hasNoTypedValue(input: AlertRuleInput): Boolean =
    listOf(
        input.valueNum != null,
        !input.valueText.isNullOrEmpty(),
        input.valueBool != null,
    ).none { it }

private fun validateSignalValue(
    input: AlertRuleInput,
    op: String,
): ValidationIssue? =
    when {
        isRangeOp(op) -> validateRange(input)
        op == Operators.CHANGED -> null
        hasNoTypedValue(input) -> ValidationIssue(ValidationField.VALUE)
        else -> null
    }

private fun validateSignal(input: AlertRuleInput): ValidationIssue? {
    val op = input.op
    return when {
        input.signalName.isNullOrBlank() -> ValidationIssue(ValidationField.SIGNAL_NAME)
        op == null -> ValidationIssue(ValidationField.OP)
        else -> validateSignalValue(input, op)
    }
}

private fun validateByKind(input: AlertRuleInput): ValidationIssue? =
    if ((input.kind ?: RuleKinds.SIGNAL) == RuleKinds.COMPUTED_METRIC) {
        validateComputedMetric(input)
    } else {
        validateSignal(input)
    }

/** Validate the wire input at submit time (web `alertRuleSchema.safeParse`); null = valid. */
fun validateForSave(input: AlertRuleInput): ValidationIssue? = validateBase(input) ?: validateEscalation(input) ?: validateByKind(input)

// ── List + template projections (web `filteredRules` / `filteredTemplates`) ───────────────────────────────

/** Filter the saved rules by the search box (web `filteredRules`, case-insensitive name match). */
fun filterRules(
    rules: List<AlertRule>,
    search: String,
): List<AlertRule> {
    val query = search.trim().lowercase()
    if (query.isEmpty()) return rules
    return rules.filter { it.name.lowercase().contains(query) }
}

/**
 * Filter the templates by category + search (web `filteredTemplates`). [label]/[message]/[categoryLabel]
 * resolve the localized text so the search matches what the user sees.
 */
@Suppress("LongParameterList")
fun filterTemplates(
    templates: List<RuleTemplate>,
    category: String?,
    search: String,
    label: (RuleTemplate) -> String,
    message: (RuleTemplate) -> String,
    categoryLabel: (String) -> String,
): List<RuleTemplate> {
    val byCategory = if (category != null) templates.filter { it.category == category } else templates
    val query = search.trim().lowercase()
    if (query.isEmpty()) return byCategory
    return byCategory.filter {
        label(it).lowercase().contains(query) ||
            message(it).lowercase().contains(query) ||
            categoryLabel(it.category).lowercase().contains(query)
    }
}

// ── Surface state machine (web `PageContainer` loading/error + list empty/no-match branches) ──────────────

/**
 * The render branch the rules list takes for a given data phase — the union of the web's
 * `isLoading` / `error` / `rulesList.length === 0` / `filteredRules.length === 0` conditions, plus the
 * cache-then-network stale/offline overlay the P1/S8 [io.teslasync.android.data.UiState] layer carries.
 */
enum class RulesListPhase { LOADING, ERROR, EMPTY, NO_MATCHES, CONTENT }

/** The fully-projected rules-list state the composable renders (every branch reproduced, never hidden). */
data class RulesListProjection(
    val phase: RulesListPhase,
    val rules: List<AlertRule>,
    val totalCount: Int,
    val stale: Boolean,
    val offline: Boolean,
    val refreshing: Boolean,
    val showSearch: Boolean,
)

private const val SEARCH_VISIBILITY_THRESHOLD = 3

/**
 * Project the rules feed + the active search into a [RulesListProjection]. [isLoading]/[isError] come from
 * the UiState phase; [stale]/[offline]/[refreshing] from its cache-then-network flags. The search box appears
 * once there are more than [SEARCH_VISIBILITY_THRESHOLD] rules (web `rulesList.length > 3`).
 */
@Suppress("LongParameterList")
fun projectRulesList(
    rules: List<AlertRule>,
    search: String,
    isLoading: Boolean,
    isError: Boolean,
    stale: Boolean,
    offline: Boolean,
    refreshing: Boolean,
): RulesListProjection {
    val filtered = filterRules(rules, search)
    val phase =
        when {
            isLoading && rules.isEmpty() -> RulesListPhase.LOADING
            isError && rules.isEmpty() -> RulesListPhase.ERROR
            rules.isEmpty() -> RulesListPhase.EMPTY
            filtered.isEmpty() -> RulesListPhase.NO_MATCHES
            else -> RulesListPhase.CONTENT
        }
    return RulesListProjection(
        phase = phase,
        rules = filtered,
        totalCount = rules.size,
        stale = stale,
        offline = offline,
        refreshing = refreshing,
        showSearch = rules.size > SEARCH_VISIBILITY_THRESHOLD,
    )
}
