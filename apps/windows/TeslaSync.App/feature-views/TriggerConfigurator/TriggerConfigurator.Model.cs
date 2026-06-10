using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Automations;

/// <summary>
/// The trigger kind discriminator — the native mirror of the web <c>AutomationTriggerKind</c> union
/// (web/src/types/automations.ts). A trigger is exactly one of schedule / vehicle-event / geofence /
/// signal-threshold; the surface renders a different form per kind, mirroring the web
/// <c>switch (trigger.kind)</c> (web/src/features/automations/pages/TriggerConfigurator.tsx).
/// </summary>
public enum AutomationTriggerKind
{
    /// <summary>A cron-scheduled trigger (web <c>trigger_schedule</c>).</summary>
    Schedule,

    /// <summary>A vehicle lifecycle event trigger (web <c>trigger_event</c>).</summary>
    Event,

    /// <summary>A geofence enter/exit/dwell trigger (web <c>trigger_geofence</c>).</summary>
    Geofence,

    /// <summary>A signal-threshold trigger (web <c>trigger_signal</c>).</summary>
    Signal,
}

/// <summary>The vehicle lifecycle events a <see cref="EventTrigger"/> can fire on (web <c>AutomationEventType</c>).</summary>
public enum AutomationEventType
{
    /// <summary>Web <c>drive_start</c>.</summary>
    DriveStart,

    /// <summary>Web <c>drive_end</c>.</summary>
    DriveEnd,

    /// <summary>Web <c>charge_start</c>.</summary>
    ChargeStart,

    /// <summary>Web <c>charge_end</c>.</summary>
    ChargeEnd,

    /// <summary>Web <c>sleep_start</c>.</summary>
    SleepStart,

    /// <summary>Web <c>sleep_end</c>.</summary>
    SleepEnd,

    /// <summary>Web <c>online</c>.</summary>
    Online,

    /// <summary>Web <c>offline</c>.</summary>
    Offline,

    /// <summary>Web <c>sentry_alert</c>.</summary>
    SentryAlert,
}

/// <summary>The geofence transition a <see cref="GeofenceTrigger"/> fires on (web <c>AutomationGeofenceEvent</c>).</summary>
public enum AutomationGeofenceEvent
{
    /// <summary>Web <c>enter</c>.</summary>
    Enter,

    /// <summary>Web <c>exit</c>.</summary>
    Exit,

    /// <summary>Web <c>leave</c>.</summary>
    Leave,

    /// <summary>Web <c>both</c>.</summary>
    Both,

    /// <summary>Web <c>dwell</c>.</summary>
    Dwell,
}

/// <summary>The comparison operator for a <see cref="SignalTrigger"/> (web <c>AutomationTriggerSignalOp</c>).</summary>
public enum AutomationTriggerSignalOp
{
    /// <summary>Web <c>=</c>.</summary>
    Equal,

    /// <summary>Web <c>!=</c>.</summary>
    NotEqual,

    /// <summary>Web <c>&lt;</c>.</summary>
    LessThan,

    /// <summary>Web <c>&lt;=</c>.</summary>
    LessThanOrEqual,

    /// <summary>Web <c>&gt;</c>.</summary>
    GreaterThan,

    /// <summary>Web <c>&gt;=</c>.</summary>
    GreaterThanOrEqual,

    /// <summary>Web <c>changed</c> — fire on any change (no value).</summary>
    Changed,

    /// <summary>Web <c>crossed_above</c>.</summary>
    CrossedAbove,

    /// <summary>Web <c>crossed_below</c>.</summary>
    CrossedBelow,
}

/// <summary>
/// Bidirectional mapping between the strongly-typed enums and the snake-case / symbolic wire values the
/// Go API uses (the web stores these literals directly on the trigger object). Keeping the wire contract
/// in one place lets the view-model project dropdown values without literals and lets a host serialise the
/// emitted trigger back to <c>POST /automations</c> exactly as the web does.
/// </summary>
public static class TriggerWire
{
    /// <summary>The wire literal for a trigger kind (web <c>trigger.kind</c>).</summary>
    public static string ToWire(this AutomationTriggerKind kind) => kind switch
    {
        AutomationTriggerKind.Schedule => "trigger_schedule",
        AutomationTriggerKind.Event => "trigger_event",
        AutomationTriggerKind.Geofence => "trigger_geofence",
        AutomationTriggerKind.Signal => "trigger_signal",
        _ => throw new ArgumentOutOfRangeException(nameof(kind)),
    };

    /// <summary>The wire literal for a vehicle event (web <c>event_type</c>).</summary>
    public static string ToWire(this AutomationEventType value) => value switch
    {
        AutomationEventType.DriveStart => "drive_start",
        AutomationEventType.DriveEnd => "drive_end",
        AutomationEventType.ChargeStart => "charge_start",
        AutomationEventType.ChargeEnd => "charge_end",
        AutomationEventType.SleepStart => "sleep_start",
        AutomationEventType.SleepEnd => "sleep_end",
        AutomationEventType.Online => "online",
        AutomationEventType.Offline => "offline",
        AutomationEventType.SentryAlert => "sentry_alert",
        _ => throw new ArgumentOutOfRangeException(nameof(value)),
    };

    /// <summary>The wire literal for a geofence transition (web <c>event</c>).</summary>
    public static string ToWire(this AutomationGeofenceEvent value) => value switch
    {
        AutomationGeofenceEvent.Enter => "enter",
        AutomationGeofenceEvent.Exit => "exit",
        AutomationGeofenceEvent.Leave => "leave",
        AutomationGeofenceEvent.Both => "both",
        AutomationGeofenceEvent.Dwell => "dwell",
        _ => throw new ArgumentOutOfRangeException(nameof(value)),
    };

    /// <summary>The wire literal for a signal operator (web <c>op</c>).</summary>
    public static string ToWire(this AutomationTriggerSignalOp value) => value switch
    {
        AutomationTriggerSignalOp.Equal => "=",
        AutomationTriggerSignalOp.NotEqual => "!=",
        AutomationTriggerSignalOp.LessThan => "<",
        AutomationTriggerSignalOp.LessThanOrEqual => "<=",
        AutomationTriggerSignalOp.GreaterThan => ">",
        AutomationTriggerSignalOp.GreaterThanOrEqual => ">=",
        AutomationTriggerSignalOp.Changed => "changed",
        AutomationTriggerSignalOp.CrossedAbove => "crossed_above",
        AutomationTriggerSignalOp.CrossedBelow => "crossed_below",
        _ => throw new ArgumentOutOfRangeException(nameof(value)),
    };

    /// <summary>Parse a wire signal-operator literal, returning <see langword="false"/> when unrecognised.</summary>
    public static bool TryParseSignalOp(string? wire, out AutomationTriggerSignalOp op)
    {
        switch (wire)
        {
            case "=": op = AutomationTriggerSignalOp.Equal; return true;
            case "!=": op = AutomationTriggerSignalOp.NotEqual; return true;
            case "<": op = AutomationTriggerSignalOp.LessThan; return true;
            case "<=": op = AutomationTriggerSignalOp.LessThanOrEqual; return true;
            case ">": op = AutomationTriggerSignalOp.GreaterThan; return true;
            case ">=": op = AutomationTriggerSignalOp.GreaterThanOrEqual; return true;
            case "changed": op = AutomationTriggerSignalOp.Changed; return true;
            case "crossed_above": op = AutomationTriggerSignalOp.CrossedAbove; return true;
            case "crossed_below": op = AutomationTriggerSignalOp.CrossedBelow; return true;
            default: op = AutomationTriggerSignalOp.Equal; return false;
        }
    }

    /// <summary>Parse a wire vehicle-event literal, returning <see langword="false"/> when unrecognised.</summary>
    public static bool TryParseEventType(string? wire, out AutomationEventType value)
    {
        switch (wire)
        {
            case "drive_start": value = AutomationEventType.DriveStart; return true;
            case "drive_end": value = AutomationEventType.DriveEnd; return true;
            case "charge_start": value = AutomationEventType.ChargeStart; return true;
            case "charge_end": value = AutomationEventType.ChargeEnd; return true;
            case "sleep_start": value = AutomationEventType.SleepStart; return true;
            case "sleep_end": value = AutomationEventType.SleepEnd; return true;
            case "online": value = AutomationEventType.Online; return true;
            case "offline": value = AutomationEventType.Offline; return true;
            case "sentry_alert": value = AutomationEventType.SentryAlert; return true;
            default: value = AutomationEventType.Online; return false;
        }
    }

    /// <summary>Parse a wire geofence-transition literal, returning <see langword="false"/> when unrecognised.</summary>
    public static bool TryParseGeofenceEvent(string? wire, out AutomationGeofenceEvent value)
    {
        switch (wire)
        {
            case "enter": value = AutomationGeofenceEvent.Enter; return true;
            case "exit": value = AutomationGeofenceEvent.Exit; return true;
            case "leave": value = AutomationGeofenceEvent.Leave; return true;
            case "both": value = AutomationGeofenceEvent.Both; return true;
            case "dwell": value = AutomationGeofenceEvent.Dwell; return true;
            default: value = AutomationGeofenceEvent.Enter; return false;
        }
    }
}

/// <summary>
/// The configured trigger the surface edits — the native, closed-hierarchy analogue of the web
/// discriminated union <c>AutomationTriggerStepInput</c>
/// (web/src/features/automations/components/stepInputTypes.ts). Immutable: every edit produces a new
/// instance (the web spreads <c>{ ...trigger, field }</c>), so the view-model can raise change
/// notifications by reference. Construct concrete kinds via the four sealed records or
/// <see cref="CreateDefault"/>.
/// </summary>
public abstract record AutomationTrigger
{
    private protected AutomationTrigger()
    {
    }

    /// <summary>The discriminator for this trigger.</summary>
    public abstract AutomationTriggerKind Kind { get; }

    /// <summary>
    /// The default trigger for a freshly-selected kind — the native port of the web
    /// <c>createDefaultTrigger</c> (schedule at 08:00 UTC, the <c>online</c> event, an unset geofence on
    /// <c>enter</c>, and a battery-level &lt; 20 signal).
    /// </summary>
    public static AutomationTrigger CreateDefault(AutomationTriggerKind kind) => kind switch
    {
        AutomationTriggerKind.Schedule => new ScheduleTrigger("0 8 * * *", "UTC"),
        AutomationTriggerKind.Event => new EventTrigger(AutomationEventType.Online),
        AutomationTriggerKind.Geofence => new GeofenceTrigger(0, AutomationGeofenceEvent.Enter),
        AutomationTriggerKind.Signal => new SignalTrigger("battery_level", AutomationTriggerSignalOp.LessThan, ValueNum: 20),
        _ => throw new ArgumentOutOfRangeException(nameof(kind)),
    };
}

/// <summary>A cron-scheduled trigger (web <c>trigger_schedule</c>): a five-field cron expression and a timezone.</summary>
/// <param name="CronExpr">The five-field cron expression (web <c>cron_expr</c>).</param>
/// <param name="Timezone">The IANA timezone the schedule is evaluated in (web <c>timezone</c>).</param>
public sealed record ScheduleTrigger(string CronExpr, string Timezone) : AutomationTrigger
{
    /// <inheritdoc />
    public override AutomationTriggerKind Kind => AutomationTriggerKind.Schedule;
}

/// <summary>A vehicle lifecycle event trigger (web <c>trigger_event</c>).</summary>
/// <param name="EventType">The lifecycle event to fire on (web <c>event_type</c>).</param>
public sealed record EventTrigger(AutomationEventType EventType) : AutomationTrigger
{
    /// <inheritdoc />
    public override AutomationTriggerKind Kind => AutomationTriggerKind.Event;
}

/// <summary>A geofence transition trigger (web <c>trigger_geofence</c>).</summary>
/// <param name="PlaceId">The geofence id (web <c>place_id</c>); <c>0</c> means "unset".</param>
/// <param name="GeofenceEvent">The transition to fire on (web <c>event</c>).</param>
/// <param name="DwellMinutes">Minutes the vehicle must dwell before firing (web <c>dwell_minutes</c>); only set for <see cref="AutomationGeofenceEvent.Dwell"/>.</param>
public sealed record GeofenceTrigger(long PlaceId, AutomationGeofenceEvent GeofenceEvent, int? DwellMinutes = null) : AutomationTrigger
{
    /// <inheritdoc />
    public override AutomationTriggerKind Kind => AutomationTriggerKind.Geofence;
}

/// <summary>
/// A signal-threshold trigger (web <c>trigger_signal</c>). The active value field depends on the signal:
/// a boolean signal carries <see cref="ValueBool"/>, the <c>state</c> signal carries <see cref="ValueText"/>,
/// any other carries <see cref="ValueNum"/>; the <see cref="AutomationTriggerSignalOp.Changed"/> operator
/// carries no value at all.
/// </summary>
/// <param name="Signal">The signal column / API field (web <c>signal</c>).</param>
/// <param name="Op">The comparison operator (web <c>op</c>).</param>
/// <param name="ValueNum">The numeric threshold (web <c>value_num</c>).</param>
/// <param name="ValueText">The string threshold for the <c>state</c> signal (web <c>value_text</c>).</param>
/// <param name="ValueBool">The boolean threshold for boolean signals (web <c>value_bool</c>).</param>
public sealed record SignalTrigger(
    string Signal,
    AutomationTriggerSignalOp Op,
    double? ValueNum = null,
    string? ValueText = null,
    bool? ValueBool = null) : AutomationTrigger
{
    /// <inheritdoc />
    public override AutomationTriggerKind Kind => AutomationTriggerKind.Signal;

    /// <summary>True when the chosen signal is boolean (web <c>BOOL_FIELD_KEYS.has(signal)</c>).</summary>
    public bool IsBool => TriggerSignalCatalog.BoolFieldKeys.Contains(Signal);

    /// <summary>True when the chosen signal is the free-text <c>state</c> signal (web <c>signal === 'state'</c>).</summary>
    public bool IsState => string.Equals(Signal, "state", StringComparison.Ordinal);

    /// <summary>True when a value field renders (web <c>op !== 'changed'</c>).</summary>
    public bool ShowValueField => Op != AutomationTriggerSignalOp.Changed;

    /// <summary>
    /// The current value rendered in the value field — the native port of the web
    /// <c>isBool ? String(value_bool ?? true) : signal === 'state' ? (value_text ?? 'online') : String(value_num ?? 20)</c>.
    /// </summary>
    public string CurrentValueString => IsBool
        ? (ValueBool ?? true) ? "true" : "false"
        : IsState
            ? ValueText ?? "online"
            : (ValueNum ?? 20).ToString(CultureInfo.InvariantCulture);

    /// <summary>
    /// Produce the next trigger from a raw value-field string — the native port of the web
    /// <c>signalValueFromInput</c>: the <c>changed</c> operator drops the value; a boolean signal coerces
    /// "true"/"false"; the <c>state</c> signal keeps text; anything else parses a number (web
    /// <c>parseFloat(value) || 0</c>).
    /// </summary>
    public SignalTrigger WithValue(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        if (Op == AutomationTriggerSignalOp.Changed)
        {
            return new SignalTrigger(Signal, Op);
        }

        if (IsBool)
        {
            return new SignalTrigger(Signal, Op, ValueBool: string.Equals(value, "true", StringComparison.Ordinal));
        }

        return IsState
            ? new SignalTrigger(Signal, Op, ValueText: value)
            : new SignalTrigger(Signal, Op, ValueNum: TriggerSignalCatalog.ParseFloat(value));
    }

    /// <summary>The default signal trigger for a newly-chosen signal (web select <c>onChange</c> branch).</summary>
    public static SignalTrigger ForSignal(string signal)
    {
        ArgumentNullException.ThrowIfNull(signal);
        if (TriggerSignalCatalog.BoolFieldKeys.Contains(signal))
        {
            return new SignalTrigger(signal, AutomationTriggerSignalOp.Equal, ValueBool: true);
        }

        return string.Equals(signal, "state", StringComparison.Ordinal)
            ? new SignalTrigger(signal, AutomationTriggerSignalOp.Equal, ValueText: "online")
            : new SignalTrigger(signal, AutomationTriggerSignalOp.LessThan, ValueNum: 20);
    }
}

/// <summary>The parsed simple-schedule fields (web <c>parseCronExpr</c> result).</summary>
/// <param name="Hour">The hour-of-day (0–23).</param>
/// <param name="Minute">The minute-of-hour (0–59).</param>
/// <param name="Days">The selected weekday indices (0=Sun…6=Sat); empty means "every day".</param>
public sealed record CronSchedule(int Hour, int Minute, IReadOnlyList<int> Days);

/// <summary>
/// The pure cron helpers backing the simple/advanced schedule modes — the native ports of the web
/// <c>buildCronExpr</c> and <c>parseCronExpr</c>. A schedule is "simple" (the time + days picker) only when
/// it round-trips through <see cref="Parse"/>; anything else falls back to the advanced expression field.
/// </summary>
public static class TriggerCron
{
    /// <summary>
    /// Build a five-field cron expression from a time and selected days (web <c>buildCronExpr</c>): an empty
    /// or full (7-day) selection becomes the <c>*</c> day-of-week wildcard.
    /// </summary>
    public static string Build(int hour, int minute, IReadOnlyList<int> days)
    {
        ArgumentNullException.ThrowIfNull(days);
        string dow = days.Count is 0 or 7 ? "*" : string.Join(",", days);
        return string.Create(CultureInfo.InvariantCulture, $"{minute} {hour} * * {dow}");
    }

    /// <summary>
    /// Parse a five-field cron expression into the simple-mode fields, or <see langword="null"/> when it is
    /// not a simple "minute hour * * dow" schedule (web <c>parseCronExpr</c>).
    /// </summary>
    public static CronSchedule? Parse(string? expr)
    {
        string[] parts = (expr ?? string.Empty).Trim().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length != 5)
        {
            return null;
        }

        if (!string.Equals(parts[2], "*", StringComparison.Ordinal) || !string.Equals(parts[3], "*", StringComparison.Ordinal))
        {
            return null;
        }

        if (!int.TryParse(parts[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out int minute) ||
            !int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out int hour))
        {
            return null;
        }

        var days = new List<int>();
        if (!string.Equals(parts[4], "*", StringComparison.Ordinal))
        {
            foreach (string token in parts[4].Split(','))
            {
                if (int.TryParse(token, NumberStyles.Integer, CultureInfo.InvariantCulture, out int day))
                {
                    days.Add(day);
                }
            }
        }

        return new CronSchedule(hour, minute, days);
    }

    /// <summary>
    /// Toggle a weekday in the current selection — the native port of the web day-button handler: toggling
    /// from the "all days" (empty) state selects every day except the toggled one; selecting all seven days
    /// collapses back to the empty "every day" state.
    /// </summary>
    public static IReadOnlyList<int> ToggleDay(IReadOnlyList<int> days, int day)
    {
        ArgumentNullException.ThrowIfNull(days);
        if (days.Count == 0)
        {
            return Enumerable.Range(0, TriggerScheduleCatalog.Days.Count).Where(index => index != day).ToArray();
        }

        var next = days.Contains(day)
            ? days.Where(current => current != day).Order().ToList()
            : days.Append(day).Order().ToList();

        return next.Count == 7 ? Array.Empty<int>() : next;
    }
}

/// <summary>A signal field type (web <c>SignalFieldType</c>).</summary>
public enum SignalFieldKind
{
    /// <summary>A numeric signal (web <c>'numeric'</c>).</summary>
    Numeric,

    /// <summary>A boolean signal (web <c>'boolean'</c>).</summary>
    Boolean,

    /// <summary>A free-text signal (web <c>'string'</c>).</summary>
    Text,
}

/// <summary>One selectable signal field (web <c>SignalField</c>).</summary>
/// <param name="Key">The DB column / API field name (web <c>key</c>).</param>
/// <param name="Label">The English display label (web <c>label</c>; flows through the localizer at projection).</param>
/// <param name="Type">The value type that decides the value editor.</param>
public sealed record SignalFieldDef(string Key, string Label, SignalFieldKind Type);

/// <summary>One selectable signal operator (web <c>SIGNAL_OPERATORS</c> entry).</summary>
/// <param name="Op">The operator.</param>
/// <param name="LabelKey">The i18n key.</param>
/// <param name="Fallback">The English fallback.</param>
public sealed record SignalOperatorDef(AutomationTriggerSignalOp Op, string LabelKey, string Fallback);

/// <summary>
/// The canonical signal catalog — the native port of <c>web/src/lib/signals.ts</c> (the same fields in the
/// same order) plus the operator list from the web TriggerConfigurator. Headless and immutable, so the
/// catalog is asserted in unit tests.
/// </summary>
public static class TriggerSignalCatalog
{
    /// <summary>The ordered signal fields (web <c>SIGNAL_FIELDS</c>).</summary>
    public static IReadOnlyList<SignalFieldDef> SignalFields { get; } = new[]
    {
        new SignalFieldDef("battery_level", "Battery Level", SignalFieldKind.Numeric),
        new SignalFieldDef("inside_temp", "Inside Temperature", SignalFieldKind.Numeric),
        new SignalFieldDef("outside_temp", "Outside Temperature", SignalFieldKind.Numeric),
        new SignalFieldDef("speed", "Speed", SignalFieldKind.Numeric),
        new SignalFieldDef("is_locked", "Is Locked", SignalFieldKind.Boolean),
        new SignalFieldDef("is_charging", "Is Charging", SignalFieldKind.Boolean),
        new SignalFieldDef("is_climate_on", "Climate On", SignalFieldKind.Boolean),
        new SignalFieldDef("sentry_mode", "Sentry Mode", SignalFieldKind.Boolean),
        new SignalFieldDef("state", "Vehicle State", SignalFieldKind.Text),
    };

    /// <summary>The boolean signal keys (web <c>BOOL_FIELD_KEYS</c>).</summary>
    public static IReadOnlySet<string> BoolFieldKeys { get; } =
        SignalFields.Where(f => f.Type == SignalFieldKind.Boolean)
            .Select(f => f.Key)
            .ToHashSet(StringComparer.Ordinal);

    /// <summary>The ordered comparison operators (web <c>SIGNAL_OPERATORS</c>).</summary>
    public static IReadOnlyList<SignalOperatorDef> Operators { get; } = new[]
    {
        new SignalOperatorDef(AutomationTriggerSignalOp.Equal, "automations.operators.equals", "="),
        new SignalOperatorDef(AutomationTriggerSignalOp.NotEqual, "automations.operators.notEquals", "!="),
        new SignalOperatorDef(AutomationTriggerSignalOp.LessThan, "automations.operators.lessThan", "<"),
        new SignalOperatorDef(AutomationTriggerSignalOp.LessThanOrEqual, "automations.operators.lessThanOrEqual", "<="),
        new SignalOperatorDef(AutomationTriggerSignalOp.GreaterThan, "automations.operators.greaterThan", ">"),
        new SignalOperatorDef(AutomationTriggerSignalOp.GreaterThanOrEqual, "automations.operators.greaterThanOrEqual", ">="),
        new SignalOperatorDef(AutomationTriggerSignalOp.Changed, "automations.operators.changed", "Changed"),
        new SignalOperatorDef(AutomationTriggerSignalOp.CrossedAbove, "automations.operators.crossedAbove", "Crossed Above"),
        new SignalOperatorDef(AutomationTriggerSignalOp.CrossedBelow, "automations.operators.crossedBelow", "Crossed Below"),
    };

    /// <summary>Parse a value string like the web <c>parseFloat(value) || 0</c> (non-numeric → 0).</summary>
    public static double ParseFloat(string? value) =>
        !string.IsNullOrWhiteSpace(value) &&
        double.TryParse(value.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double parsed)
            ? parsed
            : 0;
}

/// <summary>One selectable vehicle event (web <c>VEHICLE_EVENTS</c> entry).</summary>
/// <param name="Value">The event.</param>
/// <param name="LabelKey">The i18n key.</param>
/// <param name="Fallback">The English fallback.</param>
public sealed record VehicleEventDef(AutomationEventType Value, string LabelKey, string Fallback);

/// <summary>One selectable geofence transition (web <c>GEOFENCE_EVENTS</c> entry).</summary>
/// <param name="Value">The transition.</param>
/// <param name="LabelKey">The i18n key.</param>
/// <param name="Fallback">The English fallback.</param>
public sealed record GeofenceEventDef(AutomationGeofenceEvent Value, string LabelKey, string Fallback);

/// <summary>One selectable trigger type (web <c>TRIGGER_TYPES</c> entry, used by the host's kind picker).</summary>
/// <param name="Value">The trigger kind.</param>
/// <param name="LabelKey">The i18n key.</param>
/// <param name="Fallback">The English fallback.</param>
public sealed record TriggerTypeDef(AutomationTriggerKind Value, string LabelKey, string Fallback);

/// <summary>The event/geofence/trigger-type catalogs (web <c>VEHICLE_EVENTS</c> / <c>GEOFENCE_EVENTS</c> / <c>TRIGGER_TYPES</c>).</summary>
public static class TriggerEventCatalog
{
    /// <summary>The ordered vehicle events (web <c>VEHICLE_EVENTS</c>).</summary>
    public static IReadOnlyList<VehicleEventDef> VehicleEvents { get; } = new[]
    {
        new VehicleEventDef(AutomationEventType.DriveStart, "automations.events.driveStart", "Drive Starts"),
        new VehicleEventDef(AutomationEventType.DriveEnd, "automations.events.driveEnd", "Drive Ends"),
        new VehicleEventDef(AutomationEventType.ChargeStart, "automations.events.chargeStart", "Charging Starts"),
        new VehicleEventDef(AutomationEventType.ChargeEnd, "automations.events.chargeEnd", "Charging Ends"),
        new VehicleEventDef(AutomationEventType.SleepStart, "automations.events.sleepStart", "Sleep Starts"),
        new VehicleEventDef(AutomationEventType.SleepEnd, "automations.events.sleepEnd", "Sleep Ends"),
        new VehicleEventDef(AutomationEventType.Online, "automations.events.online", "Comes Online"),
        new VehicleEventDef(AutomationEventType.Offline, "automations.events.offline", "Goes Offline"),
        new VehicleEventDef(AutomationEventType.SentryAlert, "automations.events.sentryAlert", "Sentry Alert"),
    };

    /// <summary>The ordered geofence transitions offered in the dropdown (web <c>GEOFENCE_EVENTS</c>).</summary>
    public static IReadOnlyList<GeofenceEventDef> GeofenceEvents { get; } = new[]
    {
        new GeofenceEventDef(AutomationGeofenceEvent.Enter, "automations.geofence.enter", "Enter"),
        new GeofenceEventDef(AutomationGeofenceEvent.Exit, "automations.geofence.exit", "Exit"),
        new GeofenceEventDef(AutomationGeofenceEvent.Dwell, "automations.geofence.dwell", "Dwell"),
    };

    /// <summary>The ordered trigger types (web <c>TRIGGER_TYPES</c>), exported for the host's kind picker.</summary>
    public static IReadOnlyList<TriggerTypeDef> TriggerTypes { get; } = new[]
    {
        new TriggerTypeDef(AutomationTriggerKind.Schedule, "automations.builder.triggerSchedule", "Schedule"),
        new TriggerTypeDef(AutomationTriggerKind.Event, "automations.builder.triggerEvent", "Vehicle Event"),
        new TriggerTypeDef(AutomationTriggerKind.Geofence, "automations.builder.triggerGeofence", "Geofence"),
        new TriggerTypeDef(AutomationTriggerKind.Signal, "automations.builder.triggerSignal", "Signal Threshold"),
    };
}

/// <summary>One selectable timezone (web <c>COMMON_TIMEZONES</c> entry).</summary>
/// <param name="Value">The IANA timezone id ("" means UTC default).</param>
/// <param name="Label">The English display label.</param>
public sealed record TimezoneDef(string Value, string Label);

/// <summary>The schedule catalogs — weekday short labels and common timezones (web <c>DAYS</c> / <c>COMMON_TIMEZONES</c>).</summary>
public static class TriggerScheduleCatalog
{
    /// <summary>The weekday short labels in cron order (web <c>DAYS</c>, Sun-first).</summary>
    public static IReadOnlyList<string> Days { get; } = new[] { "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat" };

    /// <summary>The common timezones (web <c>COMMON_TIMEZONES</c>).</summary>
    public static IReadOnlyList<TimezoneDef> CommonTimezones { get; } = new[]
    {
        new TimezoneDef(string.Empty, "UTC (Default)"),
        new TimezoneDef("America/New_York", "Eastern (US)"),
        new TimezoneDef("America/Chicago", "Central (US)"),
        new TimezoneDef("America/Denver", "Mountain (US)"),
        new TimezoneDef("America/Los_Angeles", "Pacific (US)"),
        new TimezoneDef("Europe/London", "London (UK)"),
        new TimezoneDef("Europe/Berlin", "Berlin (EU)"),
        new TimezoneDef("Europe/Paris", "Paris (EU)"),
        new TimezoneDef("Asia/Tokyo", "Tokyo (JP)"),
        new TimezoneDef("Asia/Shanghai", "Shanghai (CN)"),
        new TimezoneDef("Australia/Sydney", "Sydney (AU)"),
    };

    /// <summary>The i18n key for a timezone label (web <c>timezones.${value || 'utc'}</c>).</summary>
    public static string TimezoneKey(string value) =>
        "timezones." + (string.IsNullOrEmpty(value) ? "utc" : value);

    /// <summary>The i18n key for a weekday short label (web <c>common.days.short.${index}</c>).</summary>
    public static string DayKey(int index) =>
        string.Create(CultureInfo.InvariantCulture, $"common.days.short.{index}");
}

/// <summary>
/// One configured geofence read from <c>GET /geofences</c> (web <c>useGeofences</c>) and projected into a
/// dropdown option (web <c>{ value: String(g.id), label: g.name }</c>). Parsing is null-tolerant so a
/// partial row never throws.
/// </summary>
/// <param name="Id">The geofence id as a string (web <c>String(g.id)</c>).</param>
/// <param name="Name">The geofence name, or null when absent (web <c>g.name</c>).</param>
public sealed record TriggerGeofence(string Id, string? Name)
{
    /// <summary>Parse a <c>GET /geofences</c> JSON array into a tolerant list (non-arrays → empty).</summary>
    public static IReadOnlyList<TriggerGeofence> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<TriggerGeofence>();
        }

        var list = new List<TriggerGeofence>(element.GetArrayLength());
        int index = 0;
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(new TriggerGeofence(ReadId(item, "id", index), ReadString(item, "name")));
            }

            index++;
        }

        return list;
    }

    private static string ReadId(JsonElement obj, string property, int index)
    {
        if (obj.TryGetProperty(property, out var value))
        {
            switch (value.ValueKind)
            {
                case JsonValueKind.String:
                    return value.GetString() ?? Fallback(index);
                case JsonValueKind.Number:
                    return value.TryGetInt64(out long number)
                        ? number.ToString(CultureInfo.InvariantCulture)
                        : value.GetRawText();
            }
        }

        return Fallback(index);

        static string Fallback(int i) => i.ToString(CultureInfo.InvariantCulture);
    }

    private static string? ReadString(JsonElement obj, string property) =>
        obj.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
}

/// <summary>
/// The mutually-exclusive lifecycle state of the geofence read backing the geofence dropdown — the native
/// union of the cache-then-network branches every surface must render. The web simply renders an empty
/// dropdown until <c>useGeofences</c> resolves; the native polish fills the region in every state.
/// </summary>
public enum TriggerGeofenceLoadState
{
    /// <summary>Initial fetch with no cached list — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh (or non-stale cached) geofence list to choose from.</summary>
    Loaded,

    /// <summary>The read resolved with no geofences — render the "No geofences configured" empty surface.</summary>
    Empty,

    /// <summary>The read failed and no cached list exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached list older than the freshness window — render the list plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached list remains — render the list plus an offline chip.</summary>
    Offline,
}

/// <summary>A projected dropdown option (value + localized label).</summary>
/// <param name="Value">The option value (a wire literal or geofence id).</param>
/// <param name="Label">The localized, display-ready label.</param>
public sealed record TriggerOption(string Value, string Label);

/// <summary>
/// Canonical registry metadata for the TriggerConfigurator surface — the native anchor for the web
/// component (web/src/features/automations/pages/TriggerConfigurator.tsx). The <see cref="Slug"/> is the
/// stable diagnostics identity.
/// </summary>
public static class TriggerConfiguratorRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "trigger-configurator";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "TriggerConfigurator";
}

/// <summary>
/// PII-safe diagnostics for the TriggerConfigurator surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a cron expression, geofence id,
/// signal value, timezone or any other authored content — so a diagnostics line can never leak automation
/// configuration. Thread-safe.
/// </summary>
public sealed class TriggerConfiguratorDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public TriggerConfiguratorDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TriggerConfigurator</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TriggerConfiguratorRegistration.Slug}");
    }
}
