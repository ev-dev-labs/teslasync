// Pure, framework-free model + logic for the ConditionBuilder feature view — the native analogue of
// everything web/src/features/automations/pages/ConditionBuilder.tsx derives outside JSX (the condition
// type / operator / state registries, createDefaultCondition, conditionValueFromInput, the operator
// filtering for boolean signals, the per-signal value-string derivation, and the geofence option list).
// No Compose, no Android, no HTTP: every type here is exercised by the :app:testReleaseUnitTest gate, so
// the composable stays a thin render layer. The condition shapes mirror the backend
// AutomationConditionStep* wire contracts (internal/models) the web `AutomationConditionStepInput` union
// is derived from; enum `wire` values are the exact JSON discriminators so a future serializer round-trips
// unchanged.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ConditionBuilder) cannot form a valid Kotlin package (a hyphen and a
// PascalCase segment are illegal in a package identifier), so the package intentionally diverges from the
// path. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.conditionbuilder

import io.teslasync.android.components.ui.SelectOption
import io.teslasync.shared.core.presentation.locations.Geofence
import kotlin.math.floor

/** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
const val CONDITION_BUILDER_SLUG: String = "ConditionBuilder"

// Web defaults from `createDefaultCondition` / the value-string derivation — named so the logic reads
// intentionally (detekt MagicNumber is off, but the web's literals carry meaning worth preserving).
private const val DEFAULT_SIGNAL_KEY = "battery_level"
private const val STATE_SIGNAL_KEY = "state"
private const val DEFAULT_STATE_VALUE = "online"
private const val DEFAULT_NUM_VALUE = 20.0
private const val DEFAULT_MIN_VALUE = 0.0
private const val DEFAULT_MAX_VALUE = 100.0
private val DEFAULT_WEEKDAYS = listOf(1, 2, 3, 4, 5)
private const val DEFAULT_START_TIME = "06:00"
private const val DEFAULT_END_TIME = "09:00"
private const val DEFAULT_TIMEZONE = "UTC"

/** The four condition kinds (web `AutomationConditionKind`); [wire] is the JSON discriminator. */
enum class ConditionKind(
    val wire: String,
) {
    Signal("condition_signal"),
    TimeWindow("condition_time_window"),
    Geofence("condition_geofence"),
    OtherAutomation("condition_other_automation"),
    ;

    companion object {
        /** The kinds in the web `CONDITION_TYPES` registry order (drives the type dropdown). */
        val ordered: List<ConditionKind> = listOf(Signal, TimeWindow, Geofence, OtherAutomation)

        /** Resolve a [wire] discriminator back to its kind, or `null` when unknown. */
        fun fromWire(wire: String): ConditionKind? = entries.firstOrNull { it.wire == wire }
    }
}

/**
 * The signal-condition comparison operators (web `AutomationConditionSignalOp`). [numericOnly] marks the
 * operators the web hides for boolean signals (`!isBool || !operator.numericOnly`), and [wire] is the
 * exact JSON value.
 */
enum class SignalOp(
    val wire: String,
    val numericOnly: Boolean = false,
) {
    Equals("="),
    NotEquals("!="),
    LessThan("<", numericOnly = true),
    LessThanOrEqual("<=", numericOnly = true),
    GreaterThan(">", numericOnly = true),
    GreaterThanOrEqual(">=", numericOnly = true),
    Between("between", numericOnly = true),
    In("in"),
    ;

    companion object {
        /** The operators in web `CONDITION_SIGNAL_OPERATORS` order. */
        val ordered: List<SignalOp> = listOf(Equals, NotEquals, LessThan, LessThanOrEqual, GreaterThan, GreaterThanOrEqual, Between, In)

        fun fromWire(wire: String): SignalOp? = entries.firstOrNull { it.wire == wire }
    }
}

/** Geofence membership states (web `AutomationGeofenceState`). */
enum class GeofenceConditionState(
    val wire: String,
) {
    Inside("inside"),
    Outside("outside"),
    Dwell("dwell"),
    ;

    companion object {
        val ordered: List<GeofenceConditionState> = listOf(Inside, Outside, Dwell)

        fun fromWire(wire: String): GeofenceConditionState? = entries.firstOrNull { it.wire == wire }
    }
}

/** Other-automation states (web `AutomationOtherAutomationState`). */
enum class OtherAutomationState(
    val wire: String,
) {
    Enabled("enabled"),
    Disabled("disabled"),
    RecentlyTriggered("recently_triggered"),
    ;

    companion object {
        val ordered: List<OtherAutomationState> = listOf(Enabled, Disabled, RecentlyTriggered)

        fun fromWire(wire: String): OtherAutomationState? = entries.firstOrNull { it.wire == wire }
    }
}

/** Signal value type (web `SignalFieldType`) — decides numeric / boolean / string editing. */
enum class SignalFieldType { Numeric, Boolean, Text }

/**
 * One automation signal field — the cross-platform port of the web `SignalField` registry entry
 * (web/src/lib/signals.ts). The [label] is carried verbatim from the web registry, which is itself NOT
 * localized; it is domain data (the DB column's human label), not UI chrome, so it is modelled as data
 * rather than an i18n key (the web `SIGNAL_FIELD_OPTIONS` uses `f.label` directly, never `t()`).
 */
data class SignalField(
    val key: String,
    val label: String,
    val type: SignalFieldType,
)

/** All signals available for automation conditions — a 1:1 port of web `SIGNAL_FIELDS`. */
val SIGNAL_FIELDS: List<SignalField> =
    listOf(
        SignalField("battery_level", "Battery Level", SignalFieldType.Numeric),
        SignalField("inside_temp", "Inside Temperature", SignalFieldType.Numeric),
        SignalField("outside_temp", "Outside Temperature", SignalFieldType.Numeric),
        SignalField("speed", "Speed", SignalFieldType.Numeric),
        SignalField("is_locked", "Is Locked", SignalFieldType.Boolean),
        SignalField("is_charging", "Is Charging", SignalFieldType.Boolean),
        SignalField("is_climate_on", "Climate On", SignalFieldType.Boolean),
        SignalField("sentry_mode", "Sentry Mode", SignalFieldType.Boolean),
        SignalField("state", "Vehicle State", SignalFieldType.Text),
    )

/** Boolean signal keys (web `BOOL_FIELD_KEYS`) — the operators dropdown drops numeric-only ops for these. */
val BOOL_FIELD_KEYS: Set<String> = SIGNAL_FIELDS.filter { it.type == SignalFieldType.Boolean }.map { it.key }.toSet()

/** True when [signalKey] is a boolean signal (web `BOOL_FIELD_KEYS.has(signal)`). */
fun isBoolSignal(signalKey: String): Boolean = signalKey in BOOL_FIELD_KEYS

/**
 * One supported IANA time zone option — the port of web `COMMON_TIMEZONES`. [value] is the wire value
 * (empty string ⇒ UTC default) and [i18nSuffix] is the `timezones.{suffix}` key suffix the web builds
 * (`value || 'utc'`); [fallback] is the web's hard-coded English label used when the key is absent.
 */
data class TimezoneOption(
    val value: String,
    val i18nSuffix: String,
    val fallback: String,
)

/** The common time zones (web `COMMON_TIMEZONES`), in declaration order. */
val COMMON_TIMEZONES: List<TimezoneOption> =
    listOf(
        TimezoneOption("", "utc", "UTC (Default)"),
        TimezoneOption("America/New_York", "America/New_York", "Eastern (US)"),
        TimezoneOption("America/Chicago", "America/Chicago", "Central (US)"),
        TimezoneOption("America/Denver", "America/Denver", "Mountain (US)"),
        TimezoneOption("America/Los_Angeles", "America/Los_Angeles", "Pacific (US)"),
        TimezoneOption("Europe/London", "Europe/London", "London (UK)"),
        TimezoneOption("Europe/Berlin", "Europe/Berlin", "Berlin (EU)"),
        TimezoneOption("Europe/Paris", "Europe/Paris", "Paris (EU)"),
        TimezoneOption("Asia/Tokyo", "Asia/Tokyo", "Tokyo (JP)"),
        TimezoneOption("Asia/Shanghai", "Asia/Shanghai", "Shanghai (CN)"),
        TimezoneOption("Australia/Sydney", "Australia/Sydney", "Sydney (AU)"),
    )

/** Day indices 0 (Sun) .. 6 (Sat) — the web `DAYS.map((label, day) => ...)` index range. */
val DAY_INDICES: List<Int> = (0..6).toList()

/**
 * One automation condition being edited — the native union mirroring the web
 * `AutomationConditionStepInput`. Each variant carries exactly the fields its kind needs; the shared
 * [kind] discriminator drives the type dropdown + serialization. Pure data so every transition is
 * unit-tested without a UI host.
 */
sealed interface ConditionInput {
    val kind: ConditionKind

    /**
     * A telemetry-signal comparison (web `condition_signal`). Only the value field matching [op] /
     * [signal] is populated at a time, exactly as the web `conditionValueFromInput` rebuilds the object:
     * [valueBool] for boolean signals, [valueText] for the `state` signal or the `in` operator,
     * [valueMin]/[valueMax] for `between`, otherwise [valueNum].
     */
    @Suppress("LongParameterList") // mirrors the web union's 5 optional value fields + signal + op
    data class Signal(
        val signal: String,
        val op: SignalOp,
        val valueNum: Double? = null,
        val valueText: String? = null,
        val valueBool: Boolean? = null,
        val valueMin: Double? = null,
        val valueMax: Double? = null,
    ) : ConditionInput {
        override val kind: ConditionKind get() = ConditionKind.Signal
    }

    /** A recurring time window (web `condition_time_window`). [daysOfWeek] holds 0 (Sun)..6 (Sat). */
    data class TimeWindow(
        val startTime: String,
        val endTime: String,
        val timezone: String,
        val daysOfWeek: List<Int>,
    ) : ConditionInput {
        override val kind: ConditionKind get() = ConditionKind.TimeWindow
    }

    /** A geofence membership check (web `condition_geofence`). [placeId] 0 means "none selected". */
    data class Geofence(
        val placeId: Long,
        val state: GeofenceConditionState,
    ) : ConditionInput {
        override val kind: ConditionKind get() = ConditionKind.Geofence
    }

    /** A check on another automation's state (web `condition_other_automation`). */
    data class OtherAutomation(
        val otherAutomationId: Long,
        val state: OtherAutomationState,
    ) : ConditionInput {
        override val kind: ConditionKind get() = ConditionKind.OtherAutomation
    }
}

/**
 * The default condition for [kind] — a 1:1 port of web `createDefaultCondition`. Switching the type
 * dropdown replaces the whole condition with this default so stale value fields never leak across kinds.
 */
fun createDefaultCondition(kind: ConditionKind): ConditionInput =
    when (kind) {
        ConditionKind.Signal -> ConditionInput.Signal(signal = DEFAULT_SIGNAL_KEY, op = SignalOp.LessThan, valueNum = DEFAULT_NUM_VALUE)
        ConditionKind.TimeWindow ->
            ConditionInput.TimeWindow(
                startTime = DEFAULT_START_TIME,
                endTime = DEFAULT_END_TIME,
                timezone = DEFAULT_TIMEZONE,
                daysOfWeek = DEFAULT_WEEKDAYS,
            )
        ConditionKind.Geofence -> ConditionInput.Geofence(placeId = 0L, state = GeofenceConditionState.Inside)
        ConditionKind.OtherAutomation -> ConditionInput.OtherAutomation(otherAutomationId = 0L, state = OtherAutomationState.Enabled)
    }

/**
 * Rebuilds a signal condition from a freshly-typed [rawValue] string — the port of web
 * `conditionValueFromInput`. Boolean signals parse `"true"`/`"false"`; the `state` signal and the `in`
 * operator keep text; everything else parses a number (web `Number.parseFloat(value) || 0`). The result
 * carries ONLY the relevant value field, dropping any others.
 */
fun conditionValueFromInput(
    condition: ConditionInput.Signal,
    rawValue: String,
): ConditionInput.Signal =
    when {
        isBoolSignal(condition.signal) ->
            ConditionInput.Signal(signal = condition.signal, op = condition.op, valueBool = rawValue == "true")
        condition.signal == STATE_SIGNAL_KEY || condition.op == SignalOp.In ->
            ConditionInput.Signal(signal = condition.signal, op = condition.op, valueText = rawValue)
        else ->
            ConditionInput.Signal(signal = condition.signal, op = condition.op, valueNum = parseNumberOrZero(rawValue))
    }

/**
 * The signal condition produced when a NEW signal is chosen — the port of the web select's `onChange`:
 * a boolean signal resets to `= true`, the `state` signal to `= online` text, any other to `< 20`.
 */
fun conditionForSignalChange(signalKey: String): ConditionInput.Signal =
    when {
        isBoolSignal(signalKey) -> ConditionInput.Signal(signal = signalKey, op = SignalOp.Equals, valueBool = true)
        signalKey == STATE_SIGNAL_KEY -> ConditionInput.Signal(signal = signalKey, op = SignalOp.Equals, valueText = DEFAULT_STATE_VALUE)
        else -> ConditionInput.Signal(signal = signalKey, op = SignalOp.LessThan, valueNum = DEFAULT_NUM_VALUE)
    }

/**
 * The signal condition produced when a NEW operator is chosen — the port of the operator select's
 * `onChange`: `between` seeds min/max from the prior numeric value (web `numericValue(value_min ??
 * value_num, 0)` / `numericValue(value_max, 100)`), any other operator re-parses the current value string
 * through [conditionValueFromInput] under the new operator.
 */
fun conditionForOperatorChange(
    condition: ConditionInput.Signal,
    op: SignalOp,
): ConditionInput.Signal =
    if (op == SignalOp.Between) {
        ConditionInput.Signal(
            signal = condition.signal,
            op = op,
            valueMin = numericValue(condition.valueMin ?: condition.valueNum, DEFAULT_MIN_VALUE),
            valueMax = numericValue(condition.valueMax, DEFAULT_MAX_VALUE),
        )
    } else {
        conditionValueFromInput(condition.copy(op = op), signalValueString(condition))
    }

/**
 * The string shown in the value field for a signal condition — the port of the web `value` derivation:
 * `"true"`/`"false"` for booleans, the text for `state`/`in`, otherwise the formatted number (defaulting
 * to 20, web `String(condition.value_num ?? 20)`).
 */
fun signalValueString(condition: ConditionInput.Signal): String =
    when {
        isBoolSignal(condition.signal) -> (condition.valueBool ?: true).toString()
        condition.signal == STATE_SIGNAL_KEY || condition.op == SignalOp.In -> condition.valueText ?: ""
        else -> formatNumberInput(condition.valueNum ?: DEFAULT_NUM_VALUE)
    }

/** True when the signal value editor is a Min/Max pair (web `isRange = condition.op === 'between'`). */
fun isRange(condition: ConditionInput.Signal): Boolean = condition.op == SignalOp.Between

/** The operators offered for a signal condition — web filters numeric-only ops out for boolean signals. */
fun operatorsFor(isBool: Boolean): List<SignalOp> = SignalOp.ordered.filter { !isBool || !it.numericOnly }

/** Web `numericValue`: returns [value] when finite, else [fallback]. */
fun numericValue(
    value: Double?,
    fallback: Double,
): Double = if (value != null && value.isFinite()) value else fallback

/**
 * Renders [value] for a numeric input the way JS `String(number)` would (no trailing `.0` for whole
 * numbers): 20.0 -> "20", 20.5 -> "20.5". Non-finite collapses to "0".
 */
fun formatNumberInput(value: Double): String {
    if (!value.isFinite()) return "0"
    return if (floor(value) == value) value.toLong().toString() else value.toString()
}

/** Parses a numeric input string, mirroring web `Number.parseFloat(value) || 0` for valid input. */
fun parseNumberOrZero(raw: String): Double = raw.trim().toDoubleOrNull() ?: 0.0 // parity:allow stdlib name contains "todo"

/** Parses an integer-id input string, mirroring web `Number.parseInt(value, 10) || 0`. */
fun parseIdOrZero(raw: String): Long = raw.trim().toLongOrNull() ?: 0L

/**
 * The geofence select options — the port of the web `geofenceOptions` memo: a leading "Select
 * geofence…" sentinel (empty value) followed by one option per fence (id -> name). [selectLabel] is the
 * localized sentinel label, supplied by the render boundary so this stays pure + unit-testable.
 */
fun geofenceOptions(
    selectLabel: String,
    geofences: List<Geofence>,
): List<SelectOption> =
    buildList {
        add(SelectOption(value = "", label = selectLabel))
        geofences.forEach { add(SelectOption(value = it.id.toString(), label = it.name)) }
    }

/** The select value for a geofence condition (web `place_id > 0 ? String(place_id) : ''`). */
fun geofenceSelectValue(condition: ConditionInput.Geofence): String = if (condition.placeId > 0L) condition.placeId.toString() else ""

/** The id chosen from a geofence option value (web `event.target.value ? Number(...) : 0`). */
fun geofencePlaceIdFromValue(value: String): Long = if (value.isEmpty()) 0L else parseIdOrZero(value)

/** Toggles [day] in [days] — adds it sorted, or removes it (web's per-day toggle). */
fun toggleDay(
    days: List<Int>,
    day: Int,
): List<Int> = if (day in days) days.filter { it != day } else (days + day).sorted()
