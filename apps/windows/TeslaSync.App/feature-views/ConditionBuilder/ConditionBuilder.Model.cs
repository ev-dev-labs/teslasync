using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Automations;

/// <summary>
/// The four automation-condition kinds the builder composes — the native port of the web
/// <c>AutomationConditionKind</c> (web/src/types/automations.ts). Each maps to a server wire literal via
/// <see cref="ConditionCatalog.KindWire"/>.
/// </summary>
public enum AutomationConditionKind
{
    /// <summary>A live-signal comparison (web <c>condition_signal</c>).</summary>
    Signal,

    /// <summary>A time-of-day / day-of-week window (web <c>condition_time_window</c>).</summary>
    TimeWindow,

    /// <summary>A named-place geofence state (web <c>condition_geofence</c>).</summary>
    Geofence,

    /// <summary>Another automation's state (web <c>condition_other_automation</c>).</summary>
    OtherAutomation,
}

/// <summary>
/// The comparison operators a signal condition offers — the native port of the web
/// <c>AutomationConditionSignalOp</c>. The five numeric-only operators are hidden for boolean signals
/// (web <c>numericOnly</c>).
/// </summary>
public enum AutomationConditionSignalOp
{
    /// <summary>Equals (<c>=</c>).</summary>
    Equal,

    /// <summary>Not equals (<c>!=</c>).</summary>
    NotEqual,

    /// <summary>Less than (<c>&lt;</c>) — numeric only.</summary>
    LessThan,

    /// <summary>Less than or equal (<c>&lt;=</c>) — numeric only.</summary>
    LessThanOrEqual,

    /// <summary>Greater than (<c>&gt;</c>) — numeric only.</summary>
    GreaterThan,

    /// <summary>Greater than or equal (<c>&gt;=</c>) — numeric only.</summary>
    GreaterThanOrEqual,

    /// <summary>Inclusive range (<c>between</c>) — numeric only, expects Min + Max.</summary>
    Between,

    /// <summary>Membership (<c>in</c>) — expects a comma-separated list.</summary>
    In,
}

/// <summary>Geofence membership state (web <c>AutomationGeofenceState</c>).</summary>
public enum AutomationGeofenceState
{
    /// <summary>Inside the geofence (web <c>inside</c>).</summary>
    Inside,

    /// <summary>Outside the geofence (web <c>outside</c>).</summary>
    Outside,

    /// <summary>Dwelling within the geofence (web <c>dwell</c>).</summary>
    Dwell,
}

/// <summary>State of another automation (web <c>AutomationOtherAutomationState</c>).</summary>
public enum AutomationOtherAutomationState
{
    /// <summary>The other automation is enabled (web <c>enabled</c>).</summary>
    Enabled,

    /// <summary>The other automation is disabled (web <c>disabled</c>).</summary>
    Disabled,

    /// <summary>The other automation triggered recently (web <c>recently_triggered</c>).</summary>
    RecentlyTriggered,
}

/// <summary>
/// Which value editor a signal condition shows — the native distillation of the web's branch in
/// <c>ConditionFields</c>: a Min/Max pair for <c>between</c>, a True/False select for boolean signals, or a
/// single text/number field otherwise.
/// </summary>
public enum SignalValueEditor
{
    /// <summary>A single text or numeric field (web text/number input).</summary>
    Scalar,

    /// <summary>A True/False dropdown for boolean signals.</summary>
    Boolean,

    /// <summary>A Min + Max numeric pair for the <c>between</c> operator.</summary>
    Range,
}

/// <summary>
/// One automation condition as edited by the builder — the native port of the web discriminated union
/// <c>AutomationConditionStepInput</c> (web/src/features/automations/components/stepInputTypes.ts). A closed
/// record hierarchy: only the four nested kinds can derive, so a <c>switch</c> over them is exhaustive. Pure
/// data (no WinUI types) so every transform is unit-tested without a UI host.
/// </summary>
public abstract record AutomationCondition
{
    private AutomationCondition()
    {
    }

    /// <summary>The discriminating kind of this condition.</summary>
    public abstract AutomationConditionKind Kind { get; }

    /// <summary>
    /// A live-signal comparison (web <c>condition_signal</c>). Only one of the value fields is meaningful for
    /// a given operator/signal: <see cref="ValueBool"/> for boolean signals, <see cref="ValueText"/> for the
    /// <c>state</c> signal or the <c>in</c> operator, <see cref="ValueMin"/>/<see cref="ValueMax"/> for
    /// <c>between</c>, otherwise <see cref="ValueNum"/>.
    /// </summary>
    public sealed record SignalCondition(
        string Signal,
        AutomationConditionSignalOp Op,
        double? ValueNum = null,
        string? ValueText = null,
        bool? ValueBool = null,
        double? ValueMin = null,
        double? ValueMax = null) : AutomationCondition
    {
        /// <inheritdoc />
        public override AutomationConditionKind Kind => AutomationConditionKind.Signal;
    }

    /// <summary>A time-of-day window over selected weekdays (web <c>condition_time_window</c>).</summary>
    public sealed record TimeWindowCondition(
        string StartTime,
        string EndTime,
        string Timezone,
        IReadOnlyList<int> DaysOfWeek) : AutomationCondition
    {
        /// <inheritdoc />
        public override AutomationConditionKind Kind => AutomationConditionKind.TimeWindow;
    }

    /// <summary>A named-place geofence state (web <c>condition_geofence</c>).</summary>
    public sealed record GeofenceCondition(
        long PlaceId,
        AutomationGeofenceState State) : AutomationCondition
    {
        /// <inheritdoc />
        public override AutomationConditionKind Kind => AutomationConditionKind.Geofence;
    }

    /// <summary>Another automation's state (web <c>condition_other_automation</c>).</summary>
    public sealed record OtherAutomationCondition(
        long OtherAutomationId,
        AutomationOtherAutomationState State) : AutomationCondition
    {
        /// <inheritdoc />
        public override AutomationConditionKind Kind => AutomationConditionKind.OtherAutomation;
    }
}

/// <summary>
/// Static metadata for the builder — the native port of the web option arrays (<c>CONDITION_TYPES</c>,
/// <c>CONDITION_SIGNAL_OPERATORS</c>, <c>GEOFENCE_STATES</c>, <c>OTHER_AUTOMATION_STATES</c>,
/// <c>SIGNAL_FIELD_OPTIONS</c>/<c>BOOL_FIELD_KEYS</c>, <c>DAYS</c>, <c>COMMON_TIMEZONES</c>). Carries only the
/// i18n key + English fallback + server wire literal for each entry; the projection turns these into
/// localized <see cref="ComboOption"/>s. Pure — unit-tested without a UI host.
/// </summary>
public static class ConditionCatalog
{
    /// <summary>One signal-field option (web <c>SIGNAL_FIELDS</c> entry distilled to key/label/boolean).</summary>
    /// <param name="Key">The DB/API field key (web <c>SignalField.key</c>).</param>
    /// <param name="LabelKey">The i18n key resolving the display label.</param>
    /// <param name="Fallback">The English display label (web <c>SignalField.label</c>).</param>
    /// <param name="IsBoolean">True when the signal is boolean (web <c>BOOL_FIELD_KEYS</c>).</param>
    public sealed record SignalFieldOption(string Key, string LabelKey, string Fallback, bool IsBoolean);

    /// <summary>One operator option with its server wire literal and numeric-only guard.</summary>
    /// <param name="Op">The operator.</param>
    /// <param name="Wire">The server wire literal.</param>
    /// <param name="LabelKey">The i18n key resolving the display label.</param>
    /// <param name="Fallback">The English display label.</param>
    /// <param name="NumericOnly">True when the operator is hidden for boolean signals.</param>
    public sealed record OperatorOption(
        AutomationConditionSignalOp Op,
        string Wire,
        string LabelKey,
        string Fallback,
        bool NumericOnly);

    /// <summary>One enumerated-choice option carrying its wire literal, i18n key and fallback.</summary>
    /// <param name="Wire">The server wire literal.</param>
    /// <param name="LabelKey">The i18n key resolving the display label.</param>
    /// <param name="Fallback">The English display label.</param>
    public sealed record ChoiceOption(string Wire, string LabelKey, string Fallback);

    /// <summary>The "state" signal key whose comparisons are textual keywords (web <c>signal === 'state'</c>).</summary>
    public const string StateSignalKey = "state";

    /// <summary>The default signal a fresh signal condition reads (web <c>'battery_level'</c>).</summary>
    public const string DefaultSignalKey = "battery_level";

    /// <summary>The signal-field options in display order (web <c>SIGNAL_FIELD_OPTIONS</c>).</summary>
    public static IReadOnlyList<SignalFieldOption> Signals { get; } = new[]
    {
        new SignalFieldOption("battery_level", "automations.signals.battery_level", "Battery Level", false),
        new SignalFieldOption("inside_temp", "automations.signals.inside_temp", "Inside Temperature", false),
        new SignalFieldOption("outside_temp", "automations.signals.outside_temp", "Outside Temperature", false),
        new SignalFieldOption("speed", "automations.signals.speed", "Speed", false),
        new SignalFieldOption("is_locked", "automations.signals.is_locked", "Is Locked", true),
        new SignalFieldOption("is_charging", "automations.signals.is_charging", "Is Charging", true),
        new SignalFieldOption("is_climate_on", "automations.signals.is_climate_on", "Climate On", true),
        new SignalFieldOption("sentry_mode", "automations.signals.sentry_mode", "Sentry Mode", true),
        new SignalFieldOption("state", "automations.signals.state", "Vehicle State", false),
    };

    /// <summary>The signal operators in display order (web <c>CONDITION_SIGNAL_OPERATORS</c>).</summary>
    public static IReadOnlyList<OperatorOption> Operators { get; } = new[]
    {
        new OperatorOption(AutomationConditionSignalOp.Equal, "=", "automations.operators.equals", "=", false),
        new OperatorOption(AutomationConditionSignalOp.NotEqual, "!=", "automations.operators.notEquals", "!=", false),
        new OperatorOption(AutomationConditionSignalOp.LessThan, "<", "automations.operators.lessThan", "<", true),
        new OperatorOption(AutomationConditionSignalOp.LessThanOrEqual, "<=", "automations.operators.lessThanOrEqual", "<=", true),
        new OperatorOption(AutomationConditionSignalOp.GreaterThan, ">", "automations.operators.greaterThan", ">", true),
        new OperatorOption(AutomationConditionSignalOp.GreaterThanOrEqual, ">=", "automations.operators.greaterThanOrEqual", ">=", true),
        new OperatorOption(AutomationConditionSignalOp.Between, "between", "automations.operators.between", "Between", true),
        new OperatorOption(AutomationConditionSignalOp.In, "in", "automations.operators.in", "In", false),
    };

    /// <summary>The condition kinds in display order (web <c>CONDITION_TYPES</c>).</summary>
    public static IReadOnlyList<ChoiceOption> ConditionTypes { get; } = new[]
    {
        new ChoiceOption("condition_signal", "automations.conditions.signal", "Signal Check"),
        new ChoiceOption("condition_time_window", "automations.conditions.timeWindow", "Time Window"),
        new ChoiceOption("condition_geofence", "automations.conditions.geofence", "Geofence State"),
        new ChoiceOption("condition_other_automation", "automations.conditions.otherAutomation", "Other Automation"),
    };

    /// <summary>The geofence states in display order (web <c>GEOFENCE_STATES</c>).</summary>
    public static IReadOnlyList<ChoiceOption> GeofenceStates { get; } = new[]
    {
        new ChoiceOption("inside", "automations.geofence.inside", "Inside"),
        new ChoiceOption("outside", "automations.geofence.outside", "Outside"),
        new ChoiceOption("dwell", "automations.geofence.dwell", "Dwell"),
    };

    /// <summary>The other-automation states in display order (web <c>OTHER_AUTOMATION_STATES</c>).</summary>
    public static IReadOnlyList<ChoiceOption> OtherAutomationStates { get; } = new[]
    {
        new ChoiceOption("enabled", "automations.otherAutomation.enabled", "Enabled"),
        new ChoiceOption("disabled", "automations.otherAutomation.disabled", "Disabled"),
        new ChoiceOption("recently_triggered", "automations.otherAutomation.recentlyTriggered", "Recently Triggered"),
    };

    /// <summary>The common timezone options in display order (web <c>COMMON_TIMEZONES</c>).</summary>
    public static IReadOnlyList<ChoiceOption> Timezones { get; } = new[]
    {
        new ChoiceOption(string.Empty, "timezones.utc", "UTC (Default)"),
        new ChoiceOption("America/New_York", "timezones.America/New_York", "Eastern (US)"),
        new ChoiceOption("America/Chicago", "timezones.America/Chicago", "Central (US)"),
        new ChoiceOption("America/Denver", "timezones.America/Denver", "Mountain (US)"),
        new ChoiceOption("America/Los_Angeles", "timezones.America/Los_Angeles", "Pacific (US)"),
        new ChoiceOption("Europe/London", "timezones.Europe/London", "London (UK)"),
        new ChoiceOption("Europe/Berlin", "timezones.Europe/Berlin", "Berlin (EU)"),
        new ChoiceOption("Europe/Paris", "timezones.Europe/Paris", "Paris (EU)"),
        new ChoiceOption("Asia/Tokyo", "timezones.Asia/Tokyo", "Tokyo (JP)"),
        new ChoiceOption("Asia/Shanghai", "timezones.Asia/Shanghai", "Shanghai (CN)"),
        new ChoiceOption("Australia/Sydney", "timezones.Australia/Sydney", "Sydney (AU)"),
    };

    /// <summary>The Sunday-first weekday short labels (web <c>DAYS</c>).</summary>
    public static IReadOnlyList<string> DayFallbacks { get; } = new[]
    {
        "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat",
    };

    /// <summary>The default weekdays a fresh time-window selects (web <c>[1,2,3,4,5]</c>, Mon–Fri).</summary>
    public static IReadOnlyList<int> DefaultDays { get; } = new[] { 1, 2, 3, 4, 5 };

    /// <summary>The server wire literal for a condition <paramref name="kind"/>.</summary>
    public static string KindWire(AutomationConditionKind kind) => kind switch
    {
        AutomationConditionKind.Signal => "condition_signal",
        AutomationConditionKind.TimeWindow => "condition_time_window",
        AutomationConditionKind.Geofence => "condition_geofence",
        AutomationConditionKind.OtherAutomation => "condition_other_automation",
        _ => "condition_signal",
    };

    /// <summary>Parse a server wire literal back to a condition kind (defaults to <see cref="AutomationConditionKind.Signal"/>).</summary>
    public static AutomationConditionKind KindFromWire(string? wire) => wire switch
    {
        "condition_time_window" => AutomationConditionKind.TimeWindow,
        "condition_geofence" => AutomationConditionKind.Geofence,
        "condition_other_automation" => AutomationConditionKind.OtherAutomation,
        _ => AutomationConditionKind.Signal,
    };

    /// <summary>The server wire literal for a signal <paramref name="op"/>.</summary>
    public static string OperatorWire(AutomationConditionSignalOp op) =>
        Operators.First(o => o.Op == op).Wire;

    /// <summary>Parse a server wire literal back to a signal operator (defaults to <see cref="AutomationConditionSignalOp.Equal"/>).</summary>
    public static AutomationConditionSignalOp OperatorFromWire(string? wire)
    {
        foreach (var option in Operators)
        {
            if (string.Equals(option.Wire, wire, StringComparison.Ordinal))
            {
                return option.Op;
            }
        }

        return AutomationConditionSignalOp.Equal;
    }

    /// <summary>The server wire literal for a geofence <paramref name="state"/>.</summary>
    public static string GeofenceStateWire(AutomationGeofenceState state) => state switch
    {
        AutomationGeofenceState.Outside => "outside",
        AutomationGeofenceState.Dwell => "dwell",
        _ => "inside",
    };

    /// <summary>Parse a server wire literal back to a geofence state (defaults to <see cref="AutomationGeofenceState.Inside"/>).</summary>
    public static AutomationGeofenceState GeofenceStateFromWire(string? wire) => wire switch
    {
        "outside" => AutomationGeofenceState.Outside,
        "dwell" => AutomationGeofenceState.Dwell,
        _ => AutomationGeofenceState.Inside,
    };

    /// <summary>The server wire literal for an other-automation <paramref name="state"/>.</summary>
    public static string OtherAutomationStateWire(AutomationOtherAutomationState state) => state switch
    {
        AutomationOtherAutomationState.Disabled => "disabled",
        AutomationOtherAutomationState.RecentlyTriggered => "recently_triggered",
        _ => "enabled",
    };

    /// <summary>Parse a server wire literal back to an other-automation state (defaults to <see cref="AutomationOtherAutomationState.Enabled"/>).</summary>
    public static AutomationOtherAutomationState OtherAutomationStateFromWire(string? wire) => wire switch
    {
        "disabled" => AutomationOtherAutomationState.Disabled,
        "recently_triggered" => AutomationOtherAutomationState.RecentlyTriggered,
        _ => AutomationOtherAutomationState.Enabled,
    };

    /// <summary>True when <paramref name="signalKey"/> is a boolean signal (web <c>BOOL_FIELD_KEYS.has</c>).</summary>
    public static bool IsBooleanSignal(string? signalKey)
    {
        if (string.IsNullOrEmpty(signalKey))
        {
            return false;
        }

        foreach (var field in Signals)
        {
            if (string.Equals(field.Key, signalKey, StringComparison.Ordinal))
            {
                return field.IsBoolean;
            }
        }

        return false;
    }
}

/// <summary>
/// The render plan for a signal condition's value editor — the native distillation of the web
/// <c>ConditionFields</c> <c>case 'condition_signal'</c> branch. <see cref="ValueString"/> reproduces the web
/// <c>value</c> computation exactly. Pure data so it is asserted headlessly.
/// </summary>
/// <param name="Editor">Which value editor to show (scalar / boolean / range).</param>
/// <param name="IsText">For the scalar editor, true when a free-text field is shown (web text input).</param>
/// <param name="ValueString">The string the scalar/boolean editor binds to (web <c>value</c>).</param>
/// <param name="Min">The Min field value for the range editor (web <c>numericValue(value_min, 0)</c>).</param>
/// <param name="Max">The Max field value for the range editor (web <c>numericValue(value_max, 100)</c>).</param>
public sealed record SignalFieldPlan(
    SignalValueEditor Editor,
    bool IsText,
    string ValueString,
    double Min,
    double Max);

/// <summary>
/// The UI-thread-free transforms the builder applies as the operator edits conditions — the native port of
/// the web pure helpers <c>createDefaultCondition</c>, <c>conditionValueFromInput</c>, <c>numericValue</c>,
/// and the inline <c>ConditionFields</c> change handlers. Every method returns a fresh immutable condition so
/// the controlled list stays a value (web <c>onChange</c> replace semantics). Pure — unit-tested without a UI
/// host.
/// </summary>
public static class ConditionBuilderLogic
{
    /// <summary>
    /// The default condition for a newly-selected <paramref name="kind"/> — the native port of the web
    /// <c>createDefaultCondition</c>.
    /// </summary>
    public static AutomationCondition CreateDefault(AutomationConditionKind kind) => kind switch
    {
        AutomationConditionKind.Signal => new AutomationCondition.SignalCondition(
            ConditionCatalog.DefaultSignalKey, AutomationConditionSignalOp.LessThan, ValueNum: 20),
        AutomationConditionKind.TimeWindow => new AutomationCondition.TimeWindowCondition(
            "06:00", "09:00", "UTC", ConditionCatalog.DefaultDays),
        AutomationConditionKind.Geofence => new AutomationCondition.GeofenceCondition(
            0, AutomationGeofenceState.Inside),
        AutomationConditionKind.OtherAutomation => new AutomationCondition.OtherAutomationCondition(
            0, AutomationOtherAutomationState.Enabled),
        _ => new AutomationCondition.SignalCondition(
            ConditionCatalog.DefaultSignalKey, AutomationConditionSignalOp.LessThan, ValueNum: 20),
    };

    /// <summary>
    /// The condition produced when the signal dropdown changes to <paramref name="signalKey"/> — the native
    /// port of the web signal-select <c>onChange</c>: boolean → <c>= true</c>, <c>state</c> → <c>= "online"</c>,
    /// otherwise <c>&lt; 20</c>.
    /// </summary>
    public static AutomationCondition.SignalCondition ChangeSignal(string signalKey)
    {
        ArgumentNullException.ThrowIfNull(signalKey);

        if (ConditionCatalog.IsBooleanSignal(signalKey))
        {
            return new AutomationCondition.SignalCondition(signalKey, AutomationConditionSignalOp.Equal, ValueBool: true);
        }

        if (string.Equals(signalKey, ConditionCatalog.StateSignalKey, StringComparison.Ordinal))
        {
            return new AutomationCondition.SignalCondition(signalKey, AutomationConditionSignalOp.Equal, ValueText: "online");
        }

        return new AutomationCondition.SignalCondition(signalKey, AutomationConditionSignalOp.LessThan, ValueNum: 20);
    }

    /// <summary>
    /// The condition produced when the operator dropdown changes to <paramref name="op"/> — the native port of
    /// the web operator-select <c>onChange</c>: <c>between</c> seeds Min/Max from the current value, every other
    /// operator reflows the current value through <see cref="WithValue"/>.
    /// </summary>
    public static AutomationCondition.SignalCondition ChangeOperator(
        AutomationCondition.SignalCondition condition,
        AutomationConditionSignalOp op)
    {
        ArgumentNullException.ThrowIfNull(condition);

        if (op == AutomationConditionSignalOp.Between)
        {
            return new AutomationCondition.SignalCondition(
                condition.Signal,
                op,
                ValueMin: NumericValue(condition.ValueMin ?? condition.ValueNum, 0),
                ValueMax: NumericValue(condition.ValueMax, 100));
        }

        return WithValue(condition with { Op = op }, SignalFieldString(condition));
    }

    /// <summary>
    /// The condition produced when the value field changes to <paramref name="raw"/> — the native port of the
    /// web <c>conditionValueFromInput</c>: boolean signals set <c>value_bool</c>, the <c>state</c> signal or
    /// the <c>in</c> operator set <c>value_text</c>, everything else parses <c>value_num</c>.
    /// </summary>
    public static AutomationCondition.SignalCondition WithValue(
        AutomationCondition.SignalCondition condition,
        string raw)
    {
        ArgumentNullException.ThrowIfNull(condition);
        ArgumentNullException.ThrowIfNull(raw);

        if (ConditionCatalog.IsBooleanSignal(condition.Signal))
        {
            return new AutomationCondition.SignalCondition(
                condition.Signal, condition.Op, ValueBool: string.Equals(raw, "true", StringComparison.Ordinal));
        }

        if (string.Equals(condition.Signal, ConditionCatalog.StateSignalKey, StringComparison.Ordinal) ||
            condition.Op == AutomationConditionSignalOp.In)
        {
            return new AutomationCondition.SignalCondition(condition.Signal, condition.Op, ValueText: raw);
        }

        return new AutomationCondition.SignalCondition(condition.Signal, condition.Op, ValueNum: ParseNumber(raw));
    }

    /// <summary>The condition with its range minimum set from <paramref name="raw"/> (web Min input <c>onChange</c>).</summary>
    public static AutomationCondition.SignalCondition WithMin(AutomationCondition.SignalCondition condition, string raw)
    {
        ArgumentNullException.ThrowIfNull(condition);
        ArgumentNullException.ThrowIfNull(raw);
        return condition with { ValueMin = ParseNumber(raw) };
    }

    /// <summary>The condition with its range maximum set from <paramref name="raw"/> (web Max input <c>onChange</c>).</summary>
    public static AutomationCondition.SignalCondition WithMax(AutomationCondition.SignalCondition condition, string raw)
    {
        ArgumentNullException.ThrowIfNull(condition);
        ArgumentNullException.ThrowIfNull(raw);
        return condition with { ValueMax = ParseNumber(raw) };
    }

    /// <summary>
    /// The render plan for <paramref name="condition"/>'s value editor — the native port of the web
    /// <c>isBool</c> / <c>isRange</c> / <c>value</c> derivation in <c>ConditionFields</c>.
    /// </summary>
    public static SignalFieldPlan PlanSignal(AutomationCondition.SignalCondition condition)
    {
        ArgumentNullException.ThrowIfNull(condition);

        bool isBool = ConditionCatalog.IsBooleanSignal(condition.Signal);
        bool isText = string.Equals(condition.Signal, ConditionCatalog.StateSignalKey, StringComparison.Ordinal)
            || condition.Op == AutomationConditionSignalOp.In;

        SignalValueEditor editor = condition.Op == AutomationConditionSignalOp.Between
            ? SignalValueEditor.Range
            : isBool
                ? SignalValueEditor.Boolean
                : SignalValueEditor.Scalar;

        return new SignalFieldPlan(
            editor,
            isText,
            SignalFieldString(condition),
            NumericValue(condition.ValueMin, 0),
            NumericValue(condition.ValueMax, 100));
    }

    /// <summary>
    /// The string the scalar/boolean value editor binds to — the native port of the web <c>value</c> ternary:
    /// boolean → <c>value_bool ?? true</c>, text → <c>value_text ?? ''</c>, otherwise <c>value_num ?? 20</c>.
    /// </summary>
    public static string SignalFieldString(AutomationCondition.SignalCondition condition)
    {
        ArgumentNullException.ThrowIfNull(condition);

        if (ConditionCatalog.IsBooleanSignal(condition.Signal))
        {
            return (condition.ValueBool ?? true) ? "true" : "false";
        }

        if (string.Equals(condition.Signal, ConditionCatalog.StateSignalKey, StringComparison.Ordinal) ||
            condition.Op == AutomationConditionSignalOp.In)
        {
            return condition.ValueText ?? string.Empty;
        }

        return NumberString(condition.ValueNum ?? 20);
    }

    /// <summary>
    /// A finite numeric value or <paramref name="fallback"/> — the native port of the web <c>numericValue</c>
    /// (rejects NaN / infinity / null).
    /// </summary>
    public static double NumericValue(double? value, double fallback) =>
        value is { } v && double.IsFinite(v) ? v : fallback;

    /// <summary>
    /// Parse a numeric input, defaulting to 0 — the native port of the web <c>Number.parseFloat(value) || 0</c>.
    /// </summary>
    public static double ParseNumber(string? raw)
    {
        if (!string.IsNullOrWhiteSpace(raw) &&
            double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out double parsed) &&
            double.IsFinite(parsed))
        {
            return parsed;
        }

        return 0;
    }

    /// <summary>
    /// Parse an automation-id input, defaulting to 0 — the native port of the web
    /// <c>Number.parseInt(value, 10) || 0</c>.
    /// </summary>
    public static long ParseId(string? raw)
    {
        if (!string.IsNullOrWhiteSpace(raw) &&
            long.TryParse(raw.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out long parsed))
        {
            return parsed;
        }

        return 0;
    }

    /// <summary>Format a numeric value the way the web <c>String(num)</c> does (invariant, no thousands).</summary>
    public static string NumberString(double value) =>
        value.ToString("0.################", CultureInfo.InvariantCulture);
}

/// <summary>
/// One geofence offered in the picker — the native read-model for the web <c>useGeofences</c> data
/// (<c>{ value: String(g.id), label: g.name }</c>). <see cref="Id"/> is the stringified geofence id used as
/// the option value and parsed back into <c>place_id</c>; <see cref="Name"/> is the display label. Pure data
/// (no WinUI types) so the JSON adapter is unit-tested headlessly.
/// </summary>
/// <param name="Id">The stringified geofence id (web <c>String(g.id)</c>).</param>
/// <param name="Name">The geofence display name (web <c>g.name</c>).</param>
public sealed record GeofenceOption(string Id, string Name)
{
    /// <summary>
    /// Parse the <c>GET /geofences</c> JSON payload into geofence options — tolerant of a bare array or an
    /// <c>{ geofences|data|items: [...] }</c> envelope, of numeric or string ids, and of a missing name
    /// (falls back to the id). Entries with no usable id are skipped.
    /// </summary>
    public static IReadOnlyList<GeofenceOption> ParseList(JsonElement element)
    {
        var array = ResolveArray(element);
        if (array is not { } items)
        {
            return Array.Empty<GeofenceOption>();
        }

        var result = new List<GeofenceOption>(items.GetArrayLength());
        foreach (var item in items.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            string? id = ReadId(item);
            if (string.IsNullOrEmpty(id))
            {
                continue;
            }

            string name = ReadString(item, "name") ?? id;
            result.Add(new GeofenceOption(id, name));
        }

        return result;
    }

    private static readonly string[] EnvelopeKeys = { "geofences", "data", "items", "results" };
    private static readonly string[] IdKeys = { "id", "place_id", "geofence_id" };

    private static JsonElement? ResolveArray(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Array)
        {
            return element;
        }

        if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (var key in EnvelopeKeys)
            {
                if (element.TryGetProperty(key, out var nested) && nested.ValueKind == JsonValueKind.Array)
                {
                    return nested;
                }
            }
        }

        return null;
    }

    private static string? ReadId(JsonElement item)
    {
        foreach (var key in IdKeys)
        {
            if (!item.TryGetProperty(key, out var value))
            {
                continue;
            }

            switch (value.ValueKind)
            {
                case JsonValueKind.Number:
                    return value.TryGetInt64(out long n)
                        ? n.ToString(CultureInfo.InvariantCulture)
                        : value.GetRawText();
                case JsonValueKind.String:
                    string? s = value.GetString();
                    if (!string.IsNullOrEmpty(s))
                    {
                        return s;
                    }

                    break;
                default:
                    break;
            }
        }

        return null;
    }

    private static string? ReadString(JsonElement item, string key) =>
        item.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
}

/// <summary>
/// The mutually-exclusive lifecycle of the geofence picker — the native superset of the web
/// <c>useGeofences()</c> result the builder reads. The web component renders the form unconditionally and
/// simply maps <c>geofences ?? []</c>; this status lets the self-contained native surface reflect the real
/// cache-then-network lifecycle on the picker (loading / empty / stale / offline / error) without ever
/// fabricating data. The rest of the builder stays interactive in every state.
/// </summary>
public enum ConditionGeofenceState
{
    /// <summary>The geofence read is in flight with nothing cached yet.</summary>
    Loading,

    /// <summary>A fresh geofence list resolved with at least one place.</summary>
    Ready,

    /// <summary>The geofence read resolved with no places — the picker shows the prompt plus a hint.</summary>
    Empty,

    /// <summary>A cached geofence list older than the freshness window — picker plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached geofence list is shown — picker plus an offline chip.</summary>
    Offline,

    /// <summary>The geofence read failed with nothing cached — the picker shows an error plus a retry.</summary>
    Error,
}

/// <summary>
/// The render-ready projection of the geofence picker for one lifecycle state — the geofence dropdown
/// options (the "Select geofence…" prompt plus one option per place), the localized field label / help, and
/// the optional status chip / hint / retry copy. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record ConditionGeofencePickerDisplay(
    ConditionGeofenceState State,
    IReadOnlyList<ComboOption> Options,
    string Prompt,
    string Label,
    string HelpText,
    string? StatusChip,
    StatusKind StatusChipKind,
    string? Hint,
    string? RetryLabel);

/// <summary>
/// Pure projection from the catalogs + the resolved geofence list to render-ready
/// <see cref="ComboOption"/>s and the geofence-picker display — the native port of the web
/// <c>ConditionBuilder</c>/<c>ConditionFields</c> option building and the <c>geofenceOptions</c> memo. Every
/// label flows through the i18n facade. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class ConditionBuilderProjection
{
    /// <summary>i18n key for the geofence prompt option (web <c>automations.builder.selectGeofence</c>).</summary>
    public const string SelectGeofenceKey = "automations.builder.selectGeofence";

    /// <summary>English fallback for the geofence prompt (web <c>'Select geofence...'</c>).</summary>
    public const string SelectGeofenceFallback = "Select geofence...";

    /// <summary>The condition-type options (web <c>conditionTypeOptions</c> memo).</summary>
    public static IReadOnlyList<ComboOption> ConditionTypeOptions(ILocalizer localizer) =>
        Choices(ConditionCatalog.ConditionTypes, localizer);

    /// <summary>The signal-field options (web <c>SIGNAL_FIELD_OPTIONS</c>).</summary>
    public static IReadOnlyList<ComboOption> SignalOptions(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        var options = new List<ComboOption>(ConditionCatalog.Signals.Count);
        foreach (var field in ConditionCatalog.Signals)
        {
            options.Add(new ComboOption(field.Key, localizer.GetString(field.LabelKey, field.Fallback)));
        }

        return options;
    }

    /// <summary>
    /// The operator options for <paramref name="signalKey"/> — boolean signals drop the five numeric-only
    /// operators (web <c>operatorOptions</c> memo).
    /// </summary>
    public static IReadOnlyList<ComboOption> OperatorOptions(string signalKey, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        bool isBool = ConditionCatalog.IsBooleanSignal(signalKey);
        var options = new List<ComboOption>(ConditionCatalog.Operators.Count);
        foreach (var op in ConditionCatalog.Operators)
        {
            if (isBool && op.NumericOnly)
            {
                continue;
            }

            options.Add(new ComboOption(op.Wire, localizer.GetString(op.LabelKey, op.Fallback)));
        }

        return options;
    }

    /// <summary>The geofence-state options (web <c>GEOFENCE_STATES.map</c>).</summary>
    public static IReadOnlyList<ComboOption> GeofenceStateOptions(ILocalizer localizer) =>
        Choices(ConditionCatalog.GeofenceStates, localizer);

    /// <summary>The other-automation-state options (web <c>OTHER_AUTOMATION_STATES.map</c>).</summary>
    public static IReadOnlyList<ComboOption> OtherAutomationStateOptions(ILocalizer localizer) =>
        Choices(ConditionCatalog.OtherAutomationStates, localizer);

    /// <summary>The timezone options (web <c>timezoneOptions</c> memo, key <c>timezones.{value || 'utc'}</c>).</summary>
    public static IReadOnlyList<ComboOption> TimezoneOptions(ILocalizer localizer) =>
        Choices(ConditionCatalog.Timezones, localizer);

    /// <summary>The boolean True/False value options (web <c>common.true</c> / <c>common.false</c>).</summary>
    public static IReadOnlyList<ComboOption> BooleanValueOptions(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new[]
        {
            new ComboOption("true", localizer.GetString("common.true", "True")),
            new ComboOption("false", localizer.GetString("common.false", "False")),
        };
    }

    /// <summary>The localized short label for weekday <paramref name="day"/> (0=Sun … 6=Sat), web <c>common.days.short.{day}</c>.</summary>
    public static string DayLabel(int day, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        string fallback = day >= 0 && day < ConditionCatalog.DayFallbacks.Count
            ? ConditionCatalog.DayFallbacks[day]
            : day.ToString(CultureInfo.InvariantCulture);
        return localizer.GetString(
            string.Create(CultureInfo.InvariantCulture, $"common.days.short.{day}"),
            fallback);
    }

    /// <summary>
    /// Project the geofence picker for <paramref name="state"/> over the resolved <paramref name="geofences"/>
    /// — builds the prompt-first option list and the localized chip / hint / retry copy.
    /// </summary>
    public static ConditionGeofencePickerDisplay ProjectGeofencePicker(
        ConditionGeofenceState state,
        IReadOnlyList<GeofenceOption> geofences,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(geofences);
        ArgumentNullException.ThrowIfNull(localizer);

        string prompt = localizer.GetString(SelectGeofenceKey, SelectGeofenceFallback);
        var options = new List<ComboOption>(geofences.Count + 1)
        {
            new(string.Empty, prompt),
        };
        foreach (var geofence in geofences)
        {
            options.Add(new ComboOption(geofence.Id, geofence.Name));
        }

        string? chip = state switch
        {
            ConditionGeofenceState.Stale => localizer.GetString("automations.builder.stale", "Stale"),
            ConditionGeofenceState.Offline => localizer.GetString("automations.builder.offline", "Offline"),
            _ => null,
        };
        StatusKind chipKind = state == ConditionGeofenceState.Offline ? StatusKind.Danger : StatusKind.Warning;

        string? hint = state switch
        {
            ConditionGeofenceState.Loading => localizer.GetString(
                "automations.builder.geofenceLoading", "Loading geofences\u2026"),
            ConditionGeofenceState.Empty => localizer.GetString(
                "automations.builder.geofenceEmpty",
                "No geofences yet \u2014 add one under Settings \u2192 Locations."),
            ConditionGeofenceState.Error => localizer.GetString(
                "automations.builder.geofenceError", "Couldn\u2019t load geofences"),
            _ => null,
        };
        string? retry = state == ConditionGeofenceState.Error
            ? localizer.GetString("automations.builder.retry", "Try again")
            : null;

        return new ConditionGeofencePickerDisplay(
            state,
            options,
            prompt,
            localizer.GetString("automations.builder.geofence", "Geofence"),
            localizer.GetString(
                "help.fields.automations.geofence",
                "The named place this condition checks. Define new places under Settings \u2192 Locations."),
            chip,
            chipKind,
            hint,
            retry);
    }

    private static List<ComboOption> Choices(
        IReadOnlyList<ConditionCatalog.ChoiceOption> choices,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        var options = new List<ComboOption>(choices.Count);
        foreach (var choice in choices)
        {
            options.Add(new ComboOption(choice.Wire, localizer.GetString(choice.LabelKey, choice.Fallback)));
        }

        return options;
    }
}

/// <summary>
/// Canonical metadata for the <c>ConditionBuilder</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/automations/pages/ConditionBuilder.tsx</c>.
/// </summary>
public static class ConditionBuilderRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "ConditionBuilder";

    /// <summary>The localized surface title (Narrator name / host chrome).</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("automations.builder.title", "Conditions");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>ConditionBuilder</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a signal, value, geofence id or
/// automation id, so a diagnostics line can never leak the rule an operator is authoring. Thread-safe.
/// </summary>
public sealed class ConditionBuilderDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public ConditionBuilderDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ConditionBuilder</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ConditionBuilderRegistration.Slug}");
    }
}
