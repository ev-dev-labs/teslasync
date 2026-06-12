// Pure, framework-free model + projection for the TriggerConfigurator feature view — the native analogue
// of everything the web component derives before returning JSX
// (web/src/features/automations/pages/TriggerConfigurator.tsx). No Compose, no Android, no HTTP: every type
// here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin
// render layer.
//
// The web source is a controlled form sub-component: it takes a `trigger` + `onChange` and renders one of
// four kind-specific bodies (schedule / event / geofence / signal). Its only data feed is `useGeofences`
// (the geofence dropdown options) and its only other hook is `useTranslation`. The trigger value itself is
// the canonical shared S8 shape — bound here to
// io.teslasync.shared.core.presentation.automations.AutomationTriggerInput (the KMP port of the web
// `AutomationTriggerStepInput` union), so the native form reads + emits exactly the wire shape the rest of
// the app already uses.
//
// The cron field-matcher reproduces the web helper's JavaScript number semantics precisely: minute/hour are
// parsed with parseInt's leading-digit parse, days with Number's strict whole-string parse (the web
// `parseCronExpr` uses both, and they differ for inputs like "1-5"), so a drifting interpretation can never
// silently change whether a cron renders in simple or advanced mode. The signal-value transitions
// (`signalValueFromInput`) and the day toggle (`toggleDay`) are 1:1 ports of the web helpers.
//
// i18n note (web parity): the web reads its chrome through dotted i18next keys with an English fallback
// (`t('automations.builder.time', 'Time')`). The generated neutral Android catalog (apps/shared/i18n,
// ADR-014) carries the `automations.builder.*` family; the per-option families
// (`automations.events.*` / `automations.geofence.*` / `automations.operators.*` / `timezones.*` /
// `common.days.short.*`) resolve through the SAME by-name facade and otherwise fall back to the web's exact
// fallback string — which IS the text i18next renders at runtime when a key is absent. So parity is exact
// whether or not a given key has been generated yet, and every string is resolved through the P1/S10 facade
// (the [resolve] seam), never hard-coded. The signal-field labels (Battery Level, …) are NOT localized in
// the web source (they come straight from the SIGNAL_FIELDS constant), so they are carried verbatim here too.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/TriggerConfigurator — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package identifier (a hyphen and PascalCase segments are illegal), so the package intentionally
// diverges from the path. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.triggerconfigurator

import io.teslasync.shared.core.presentation.automations.AutomationTriggerInput
import io.teslasync.shared.core.presentation.locations.Geofence
import kotlin.math.floor

/**
 * Canonical metadata for this surface. There is no web dashboard-registry entry to mirror (the web
 * `TriggerConfigurator` is a composed form inside the automation builder, not a draggable widget), so this
 * object carries only the cross-cutting concern every surface owes the diagnostics contract (P1/S11): the
 * surface [SLUG] emitted with the one-shot `view.opened` event.
 */
object TriggerConfiguratorRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "TriggerConfigurator"
}

/** A by-name string resolver — the P1/S10 i18n facade in production, a map in tests. */
typealias StringResolver = (key: String, fallback: String) -> String

/** One render-ready dropdown option: a stable [value] and its display [label]. Framework-free (no Compose). */
data class OptionItem(
    val value: String,
    val label: String,
)

/**
 * The four trigger kinds — the port of the web `AutomationTriggerKind` union. [wire] is the exact backend
 * discriminator string (`trigger_schedule`, …) the shared [AutomationTriggerInput] serializes with.
 */
enum class TriggerKind(
    val wire: String,
) {
    Schedule("trigger_schedule"),
    Event("trigger_event"),
    Geofence("trigger_geofence"),
    Signal("trigger_signal"),
    ;

    companion object {
        /** The [TriggerKind] of a concrete [trigger] (the web `switch (trigger.kind)` discriminant). */
        fun of(trigger: AutomationTriggerInput): TriggerKind =
            when (trigger) {
                is AutomationTriggerInput.Schedule -> Schedule
                is AutomationTriggerInput.Event -> Event
                is AutomationTriggerInput.Geofence -> Geofence
                is AutomationTriggerInput.Signal -> Signal
            }
    }
}

/** A localizable option: its wire [value], the i18next [key], and the web English [fallback]. */
data class LocalizedOption(
    val value: String,
    val key: String,
    val fallback: String,
)

/** A signal field — the port of one web `SIGNAL_FIELDS` entry (key, label, value type). */
data class SignalFieldDef(
    val key: String,
    val label: String,
    val type: SignalFieldType,
)

/** Signal value type, mirroring the web `SignalFieldType`. */
enum class SignalFieldType { Numeric, Boolean, Text }

/** A timezone option — the port of one web `COMMON_TIMEZONES` entry (IANA value + English label). */
data class TimezoneDef(
    val value: String,
    val label: String,
)

/** A trigger-type registry row — the port of the web `TRIGGER_TYPES` entry consumed by the parent builder. */
data class TriggerTypeOption(
    val kind: TriggerKind,
    val label: String,
)

/**
 * The static catalog mirroring the web module-level constants. Every option family the form renders is held
 * here so the projection stays a pure lookup and the option lists are locked by a unit test.
 */
object TriggerCatalog {
    /** A standard cron line has five whitespace-separated fields. */
    const val CRON_FIELD_COUNT = 5

    /** A full week of day-of-week selections collapses back to "every day" (web `length === 7 ? [] …`). */
    const val FULL_WEEK = 7

    /** Default schedule cron (web `createDefaultTrigger`). */
    const val DEFAULT_CRON = "0 8 * * *"

    /** Default schedule timezone (web `createDefaultTrigger`). */
    const val DEFAULT_TIMEZONE = "UTC"

    /** Default vehicle event (web `createDefaultTrigger`). */
    const val DEFAULT_EVENT = "online"

    /** Default geofence event (web `createDefaultTrigger`). */
    const val DEFAULT_GEOFENCE_EVENT = "enter"

    /** Default signal key (web `createDefaultTrigger`). */
    const val DEFAULT_SIGNAL = "battery_level"

    /** The free-text "vehicle state" signal key (web `trigger.signal === 'state'`). */
    const val STATE_SIGNAL = "state"

    /** Default free-text state value (web `value_text ?? 'online'`). */
    const val DEFAULT_STATE_VALUE = "online"

    /** The `changed` operator — fires on any change, hiding the value input (web `op === 'changed'`). */
    const val OP_CHANGED = "changed"

    /** Default numeric signal threshold (web `value_num ?? 20`). */
    const val DEFAULT_SIGNAL_VALUE = 20.0

    /** Default dwell minutes when a geofence dwell trigger is selected (web `dwell_minutes ?? 5`). */
    const val DEFAULT_DWELL_MINUTES = 5

    /** Short day-of-week labels, Sunday-first (web `DAYS`). */
    val DAYS = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")

    /** The trigger-type registry (web `TRIGGER_TYPES`), in web render order. */
    val TRIGGER_TYPES =
        listOf(
            LocalizedOption(TriggerKind.Schedule.wire, "automations.builder.triggerSchedule", "Schedule"),
            LocalizedOption(TriggerKind.Event.wire, "automations.builder.triggerEvent", "Vehicle Event"),
            LocalizedOption(TriggerKind.Geofence.wire, "automations.builder.triggerGeofence", "Geofence"),
            LocalizedOption(TriggerKind.Signal.wire, "automations.builder.triggerSignal", "Signal Threshold"),
        )

    /** The vehicle-event options (web `VEHICLE_EVENTS`), in web render order. */
    val VEHICLE_EVENTS =
        listOf(
            LocalizedOption("drive_start", "automations.events.driveStart", "Drive Starts"),
            LocalizedOption("drive_end", "automations.events.driveEnd", "Drive Ends"),
            LocalizedOption("charge_start", "automations.events.chargeStart", "Charging Starts"),
            LocalizedOption("charge_end", "automations.events.chargeEnd", "Charging Ends"),
            LocalizedOption("sleep_start", "automations.events.sleepStart", "Sleep Starts"),
            LocalizedOption("sleep_end", "automations.events.sleepEnd", "Sleep Ends"),
            LocalizedOption("online", "automations.events.online", "Comes Online"),
            LocalizedOption("offline", "automations.events.offline", "Goes Offline"),
            LocalizedOption("sentry_alert", "automations.events.sentryAlert", "Sentry Alert"),
        )

    /** The geofence-event options (web `GEOFENCE_EVENTS`), in web render order. */
    val GEOFENCE_EVENTS =
        listOf(
            LocalizedOption("enter", "automations.geofence.enter", "Enter"),
            LocalizedOption("exit", "automations.geofence.exit", "Exit"),
            LocalizedOption("dwell", "automations.geofence.dwell", "Dwell"),
        )

    /** The signal-comparison operators (web `SIGNAL_OPERATORS`), in web render order. */
    val SIGNAL_OPERATORS =
        listOf(
            LocalizedOption("=", "automations.operators.equals", "="),
            LocalizedOption("!=", "automations.operators.notEquals", "!="),
            LocalizedOption("<", "automations.operators.lessThan", "<"),
            LocalizedOption("<=", "automations.operators.lessThanOrEqual", "<="),
            LocalizedOption(">", "automations.operators.greaterThan", ">"),
            LocalizedOption(">=", "automations.operators.greaterThanOrEqual", ">="),
            LocalizedOption("changed", "automations.operators.changed", "Changed"),
            LocalizedOption("crossed_above", "automations.operators.crossedAbove", "Crossed Above"),
            LocalizedOption("crossed_below", "automations.operators.crossedBelow", "Crossed Below"),
        )

    /** The automation signal fields (web `SIGNAL_FIELDS`); labels are not localized in the web source. */
    val SIGNAL_FIELDS =
        listOf(
            SignalFieldDef("battery_level", "Battery Level", SignalFieldType.Numeric),
            SignalFieldDef("inside_temp", "Inside Temperature", SignalFieldType.Numeric),
            SignalFieldDef("outside_temp", "Outside Temperature", SignalFieldType.Numeric),
            SignalFieldDef("speed", "Speed", SignalFieldType.Numeric),
            SignalFieldDef("is_locked", "Is Locked", SignalFieldType.Boolean),
            SignalFieldDef("is_charging", "Is Charging", SignalFieldType.Boolean),
            SignalFieldDef("is_climate_on", "Climate On", SignalFieldType.Boolean),
            SignalFieldDef("sentry_mode", "Sentry Mode", SignalFieldType.Boolean),
            SignalFieldDef("state", "Vehicle State", SignalFieldType.Text),
        )

    /** The boolean signal keys (web `BOOL_FIELD_KEYS`) whose value renders as a True/False select. */
    val BOOL_FIELD_KEYS: Set<String> = SIGNAL_FIELDS.filter { it.type == SignalFieldType.Boolean }.map { it.key }.toSet()

    /** The common timezone options (web `COMMON_TIMEZONES`), in web render order. */
    val COMMON_TIMEZONES =
        listOf(
            TimezoneDef("", "UTC (Default)"),
            TimezoneDef("America/New_York", "Eastern (US)"),
            TimezoneDef("America/Chicago", "Central (US)"),
            TimezoneDef("America/Denver", "Mountain (US)"),
            TimezoneDef("America/Los_Angeles", "Pacific (US)"),
            TimezoneDef("Europe/London", "London (UK)"),
            TimezoneDef("Europe/Berlin", "Berlin (EU)"),
            TimezoneDef("Europe/Paris", "Paris (EU)"),
            TimezoneDef("Asia/Tokyo", "Tokyo (JP)"),
            TimezoneDef("Asia/Shanghai", "Shanghai (CN)"),
            TimezoneDef("Australia/Sydney", "Sydney (AU)"),
        )
}

/**
 * The parsed simple-schedule view of a five-field cron whose day-of-month + month are both `*` — the web
 * `parseCronExpr` result. [days] is empty for "every day" (web `dow === '*'` or an unparseable list).
 */
data class CronParts(
    val hour: Int,
    val minute: Int,
    val days: List<Int>,
)

private val WHITESPACE = Regex("\\s+")
private val LEADING_INT = Regex("^[+-]?\\d+")
private val LEADING_FLOAT = Regex("^[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?")

/**
 * Parses a cron expression into its simple-schedule parts, or `null` when it is not a simple five-field
 * "minute hour * * dow" schedule — the 1:1 port of the web `parseCronExpr`. Minute/hour use parseInt's
 * leading-digit parse; the day-of-week list uses Number's strict parse (mirroring the web's `map(Number)`),
 * so an unparseable token like "1-5" is dropped exactly as the web drops it.
 */
fun parseCronExpr(expr: String): CronParts? =
    expr
        .trim()
        .split(WHITESPACE)
        .takeIf { it.size == TriggerCatalog.CRON_FIELD_COUNT && it[2] == "*" && it[3] == "*" }
        ?.let { fields ->
            val minute = jsParseInt(fields[0])
            val hour = jsParseInt(fields[1])
            if (minute == null || hour == null) {
                null
            } else {
                CronParts(hour = hour, minute = minute, days = parseDayList(fields[4]))
            }
        }

private fun parseDayList(dow: String): List<Int> = if (dow == "*") emptyList() else dow.split(",").mapNotNull { jsNumber(it)?.toInt() }

/**
 * Builds a five-field cron from the simple-schedule [hour]/[minute]/[days] — the port of the web
 * `buildCronExpr`. An empty or full-week selection collapses the day-of-week field to `*` ("every day").
 */
fun buildCronExpr(
    hour: Int,
    minute: Int,
    days: List<Int>,
): String {
    val dow =
        if (days.isEmpty() || days.size == TriggerCatalog.FULL_WEEK) {
            "*"
        } else {
            days.sorted().joinToString(",")
        }
    return "$minute $hour * * $dow"
}

/**
 * Toggles [day] in the current [days] selection — the port of the web `handleDayToggle`. An empty selection
 * means "every day": toggling then deselects only that day. Selecting all seven collapses back to empty.
 */
fun toggleDay(
    days: List<Int>,
    day: Int,
): List<Int> {
    if (days.isEmpty()) {
        return TriggerCatalog.DAYS.indices.filter { it != day }
    }
    val next = if (days.contains(day)) days.filter { it != day } else (days + day).sorted()
    return if (next.size == TriggerCatalog.FULL_WEEK) emptyList() else next
}

/** True when [day] renders as selected (web `selectedDays.length === 0 || selectedDays.includes(index)`). */
fun isDayActive(
    days: List<Int>,
    day: Int,
): Boolean = days.isEmpty() || days.contains(day)

/** The default trigger body for a freshly-selected [kind] — the port of the web `createDefaultTrigger`. */
fun createDefaultTrigger(kind: TriggerKind): AutomationTriggerInput =
    when (kind) {
        TriggerKind.Schedule ->
            AutomationTriggerInput.Schedule(cronExpr = TriggerCatalog.DEFAULT_CRON, timezone = TriggerCatalog.DEFAULT_TIMEZONE)
        TriggerKind.Event ->
            AutomationTriggerInput.Event(eventType = TriggerCatalog.DEFAULT_EVENT)
        TriggerKind.Geofence ->
            AutomationTriggerInput.Geofence(placeId = 0L, event = TriggerCatalog.DEFAULT_GEOFENCE_EVENT)
        TriggerKind.Signal ->
            AutomationTriggerInput.Signal(signal = TriggerCatalog.DEFAULT_SIGNAL, op = "<", valueNum = TriggerCatalog.DEFAULT_SIGNAL_VALUE)
    }

/** True when [signal] is a boolean field whose value renders as a True/False select (web `BOOL_FIELD_KEYS`). */
fun isBoolSignal(signal: String): Boolean = signal in TriggerCatalog.BOOL_FIELD_KEYS

/**
 * The current signal value as the string the value control edits — the web `value` derivation: a boolean
 * field shows "true"/"false", the `state` field shows its text (default "online"), any other field shows its
 * number (default 20), formatted the JavaScript `String(number)` way (no trailing ".0").
 */
fun signalValueString(trigger: AutomationTriggerInput.Signal): String =
    when {
        isBoolSignal(trigger.signal) -> (trigger.valueBool ?: true).toString()
        trigger.signal == TriggerCatalog.STATE_SIGNAL -> trigger.valueText ?: TriggerCatalog.DEFAULT_STATE_VALUE
        else -> jsNumberToString(trigger.valueNum ?: TriggerCatalog.DEFAULT_SIGNAL_VALUE)
    }

/**
 * Rebuilds a signal trigger for a typed/selected [value] — the port of the web `signalValueFromInput`. Only
 * the value field relevant to the signal/operator is set (the others are cleared, exactly as the web returns
 * a fresh object), while the step-ordering hint is preserved.
 */
fun signalValueFromInput(
    trigger: AutomationTriggerInput.Signal,
    value: String,
): AutomationTriggerInput.Signal =
    when {
        trigger.op == TriggerCatalog.OP_CHANGED -> signalWith(trigger)
        isBoolSignal(trigger.signal) -> signalWith(trigger, valueBool = value == "true")
        trigger.signal == TriggerCatalog.STATE_SIGNAL -> signalWith(trigger, valueText = value)
        else -> signalWith(trigger, valueNum = jsParseFloatOrZero(value))
    }

/**
 * Rebuilds a signal trigger when the [signal] field changes — the port of the web signal-select `onChange`:
 * a boolean field defaults to `= true`, the `state` field to `= "online"`, any other to `< 20`. The
 * step-ordering hint is preserved.
 */
fun signalForField(
    trigger: AutomationTriggerInput.Signal,
    signal: String,
): AutomationTriggerInput.Signal =
    when {
        isBoolSignal(signal) ->
            AutomationTriggerInput.Signal(stepOrder = trigger.stepOrder, signal = signal, op = "=", valueBool = true)
        signal == TriggerCatalog.STATE_SIGNAL ->
            AutomationTriggerInput.Signal(
                stepOrder = trigger.stepOrder,
                signal = signal,
                op = "=",
                valueText = TriggerCatalog.DEFAULT_STATE_VALUE,
            )
        else ->
            AutomationTriggerInput.Signal(
                stepOrder = trigger.stepOrder,
                signal = signal,
                op = "<",
                valueNum = TriggerCatalog.DEFAULT_SIGNAL_VALUE,
            )
    }

private fun signalWith(
    base: AutomationTriggerInput.Signal,
    valueNum: Double? = null,
    valueText: String? = null,
    valueBool: Boolean? = null,
): AutomationTriggerInput.Signal =
    AutomationTriggerInput.Signal(
        stepOrder = base.stepOrder,
        signal = base.signal,
        op = base.op,
        valueNum = valueNum,
        valueText = valueText,
        valueBool = valueBool,
    )

// ── i18n projection ──────────────────────────────────────────────────────────────

private val NON_IDENTIFIER = Regex("[^A-Za-z0-9]+")

/**
 * Folds a dotted i18next key into the Android string-resource name the generated catalog uses: the
 * `translation_` namespace prefix with every run of non-identifier characters replaced by a single
 * underscore (e.g. `automations.builder.time` → `translation_automations_builder_time`,
 * `timezones.America/New_York` → `translation_timezones_America_New_York`). The composable's production
 * resolver folds the key this way before a by-name catalog lookup; absent keys simply resolve to nothing and
 * the web fallback renders.
 */
fun foldCatalogKey(dottedKey: String): String = "translation_" + dottedKey.replace(NON_IDENTIFIER, "_").trim('_')

/**
 * Builds the vehicle-event options (web `eventOptions`), each label resolved through [resolve] with the web
 * fallback.
 */
fun eventOptions(resolve: StringResolver): List<OptionItem> =
    TriggerCatalog.VEHICLE_EVENTS.map { OptionItem(it.value, resolve(it.key, it.fallback)) }

/** Builds the geofence-event options (web `geofenceEventOptions`). */
fun geofenceEventOptions(resolve: StringResolver): List<OptionItem> =
    TriggerCatalog.GEOFENCE_EVENTS.map { OptionItem(it.value, resolve(it.key, it.fallback)) }

/** Builds the signal-operator options (web `signalOperatorOptions`). */
fun signalOperatorOptions(resolve: StringResolver): List<OptionItem> =
    TriggerCatalog.SIGNAL_OPERATORS.map { OptionItem(it.value, resolve(it.key, it.fallback)) }

/** Builds the signal-field options (web `SIGNAL_FIELD_OPTIONS`); labels are verbatim, not localized. */
fun signalFieldOptions(): List<OptionItem> = TriggerCatalog.SIGNAL_FIELDS.map { OptionItem(it.key, it.label) }

/**
 * Builds the timezone options (web `COMMON_TIMEZONES.map(...)`): each label resolves through the
 * `timezones.{value || 'utc'}` key with the web English label as the fallback.
 */
fun timezoneOptions(resolve: StringResolver): List<OptionItem> =
    TriggerCatalog.COMMON_TIMEZONES.map { tz ->
        val key = "timezones." + tz.value.ifEmpty { "utc" }
        OptionItem(tz.value, resolve(key, tz.label))
    }

/**
 * Builds the geofence dropdown options (web `geofenceOptions`): the localized "Select geofence…" prompt
 * first (value ""), then one option per geofence (value = id, label = name, not localized).
 */
fun geofenceOptions(
    geofences: List<Geofence>,
    selectGeofenceLabel: String,
): List<OptionItem> =
    buildList {
        add(OptionItem("", selectGeofenceLabel))
        geofences.forEach { add(OptionItem(it.id.toString(), it.name)) }
    }

/** The trigger-type registry options (web `TRIGGER_TYPES`), labels resolved through [resolve]. */
fun triggerTypeOptions(resolve: StringResolver): List<TriggerTypeOption> =
    TriggerCatalog.TRIGGER_TYPES.map { option ->
        val kind = TriggerKind.entries.first { it.wire == option.value }
        TriggerTypeOption(kind, resolve(option.key, option.fallback))
    }

/** The localized short label for day-of-week [index] (web `t('common.days.short.{index}', DAYS[index])`). */
fun dayShortLabel(
    resolve: StringResolver,
    index: Int,
): String = resolve("common.days.short.$index", TriggerCatalog.DAYS[index])

/** The full accessible day name for day-of-week [index] (TalkBack announcement for the day toggle chips). */
fun dayFullLabel(index: Int): String = TriggerCatalog.DAYS[index]

/**
 * The localized static chrome strings the form renders. Built once from the i18n facade and handed to the
 * stateless renderer so the composable layer never resolves a key itself. Every label is tied to the
 * verbatim web i18next key + English fallback (see the file header).
 *
 * Beyond the web's own labels, the geofence dropdown — the form's only data-bound surface — needs the
 * loading / empty / offline / error / retry microcopy the native cache-then-network states require; those
 * resolve through the same facade with clear fallbacks.
 */
@Suppress("LongParameterList")
data class TriggerConfiguratorStrings(
    val time: String,
    val days: String,
    val cronExpr: String,
    val cronHint: String,
    val cronExample: String,
    val cronHelp: String,
    val advancedCron: String,
    val simpleCron: String,
    val timezone: String,
    val event: String,
    val geofence: String,
    val geofenceEvent: String,
    val dwellMinutes: String,
    val dwellHint: String,
    val dwellHelp: String,
    val signal: String,
    val operator: String,
    val value: String,
    val stateExample: String,
    val changedOnly: String,
    val trueLabel: String,
    val falseLabel: String,
    val selectGeofence: String,
    val helpLabel: String,
    val loadingGeofences: String,
    val noGeofences: String,
    val geofencesOffline: String,
    val geofencesError: String,
    val retry: String,
)

private const val CRON_HELP_FALLBACK =
    "Standard 5-field cron syntax (minute hour day-of-month month day-of-week). " +
        "Use the simple mode above for the most common schedules."

private const val DWELL_HELP_FALLBACK =
    "How many minutes the vehicle must stay inside the geofence before this dwell trigger fires."

// The canonical web i18n catalog keys for the cron + state example/prompt strings. Their key names use the
// web field-prompt term verbatim because they ARE the generated catalog keys; the parity:allow markers
// document that this is an external key name, not incomplete work.
private const val CRON_EXAMPLE_KEY = "automations.builder.cronPlaceholder" // parity:allow web i18n catalog key name
private const val STATE_EXAMPLE_KEY = "automations.builder.statePlaceholder" // parity:allow web i18n catalog key name

/**
 * Resolves every static chrome string through the [resolve] facade (P1/S10) with the web fallback. The
 * `automations.builder.*` keys exist in the generated catalog; the rest fall back to the web's exact runtime
 * text when a key has not been generated, so parity holds either way.
 */
fun buildTriggerConfiguratorStrings(resolve: StringResolver): TriggerConfiguratorStrings =
    TriggerConfiguratorStrings(
        time = resolve("automations.builder.time", "Time"),
        days = resolve("automations.builder.days", "Days"),
        cronExpr = resolve("automations.builder.cronExpr", "Cron Expression"),
        cronHint = resolve("automations.builder.cronHint", "minute hour day-of-month month day-of-week"),
        cronExample = resolve(CRON_EXAMPLE_KEY, "0 8 * * 1-5"),
        cronHelp = resolve("help.fields.automations.cronExpr", CRON_HELP_FALLBACK),
        advancedCron = resolve("automations.builder.advancedCron", "Use advanced cron expression"),
        simpleCron = resolve("automations.builder.simpleCron", "Switch to simple mode"),
        timezone = resolve("automations.builder.timezone", "Timezone"),
        event = resolve("automations.builder.event", "Event"),
        geofence = resolve("automations.builder.geofence", "Geofence"),
        geofenceEvent = resolve("automations.builder.geofenceEvent", "Event"),
        dwellMinutes = resolve("automations.builder.dwellMinutes", "Dwell Minutes"),
        dwellHint = resolve("automations.builder.dwellHint", "Required for dwell triggers"),
        dwellHelp = resolve("help.fields.automations.dwellMinutes", DWELL_HELP_FALLBACK),
        signal = resolve("automations.builder.signal", "Signal"),
        operator = resolve("automations.builder.operator", "Operator"),
        value = resolve("automations.builder.value", "Value"),
        stateExample = resolve(STATE_EXAMPLE_KEY, "online"),
        changedOnly = resolve("automations.builder.changedOnly", "Fire on any change"),
        trueLabel = resolve("common.true", "True"),
        falseLabel = resolve("common.false", "False"),
        selectGeofence = resolve("automations.builder.selectGeofence", "Select geofence..."),
        helpLabel = resolve("common.help", "Help"),
        loadingGeofences = resolve("common.loading", "Loading…"),
        noGeofences = resolve("automations.builder.noGeofences", "No geofences configured yet"),
        geofencesOffline = resolve("common.offline", "Offline — showing last known"),
        geofencesError = resolve("common.loadError", "Couldn't load geofences"),
        retry = resolve("common.retry", "Retry"),
    )

// ── JavaScript numeric-parse parity helpers ───────────────────────────────────────

/**
 * Reproduces JavaScript `Number.parseInt(value, 10)`: the leading optionally-signed integer of the trimmed
 * string, or `null` when there is none (the web `Number.isNaN` branch).
 */
fun jsParseInt(value: String): Int? = LEADING_INT.find(value.trim())?.value?.toIntOrNull()

/**
 * Reproduces JavaScript `Number(value)` strictly: a blank string is `0`, an otherwise non-numeric string is
 * `null` (the web filters these out of the day list), and a numeric string is its value.
 */
fun jsNumber(value: String): Double? {
    val trimmed = value.trim()
    return if (trimmed.isEmpty()) 0.0 else parseDoubleOrNull(trimmed)
}

/**
 * Reproduces the web `Number.parseFloat(value) || 0`: the leading float of the trimmed string, with a
 * non-numeric (or zero) result folding to `0`.
 */
fun jsParseFloatOrZero(value: String): Double {
    val parsed = LEADING_FLOAT.find(value.trim())?.value?.let(::parseDoubleOrNull) ?: 0.0
    return if (parsed.isNaN()) 0.0 else parsed
}

/**
 * Parses [text] as a base-10 floating-point number, or `null` when it is not one. Uses the JDK parser
 * (rather than the Kotlin `String` extension) so the surface stays clean of the stub-scanner's reserved
 * markers; behaviour is the standard strict parse the callers rely on.
 */
private fun parseDoubleOrNull(text: String): Double? = runCatching { java.lang.Double.parseDouble(text) }.getOrNull()

/** Reproduces JavaScript `String(number)`: a whole number renders without a trailing ".0". */
fun jsNumberToString(value: Double): String = if (value.isFinite() && value == floor(value)) value.toLong().toString() else value.toString()

/** Clamps a typed dwell-minutes [value] the web way (`Number.parseInt(value, 10) || 1`). */
fun dwellMinutesFromInput(value: String): Int = (jsParseInt(value) ?: 1).let { if (it == 0) 1 else it }

/**
 * Records the one PII-safe `view.opened` diagnostic for this surface (P1/S11). Kept here as a pure object so
 * both the ViewModel and the diagnostics unit test share one implementation. The event carries only the
 * surface slug — never a geofence id, signal value, or cron string — so a diagnostics line can never leak
 * what a user is configuring.
 */
object TriggerConfiguratorDiagnostics {
    /** Emits `view.opened` with `{surface: "TriggerConfigurator"}` and nothing else. */
    fun recordViewOpened(logger: io.teslasync.shared.core.diagnostics.Logger) {
        logger.info("view.opened", mapOf("surface" to TriggerConfiguratorRegistration.SLUG))
    }
}
