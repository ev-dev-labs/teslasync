using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// Canonical metadata + i18n keys for the <c>AlertStudioPage</c> feature surface — the native mirror of the web
/// page at <c>web/src/features/notifications/pages/AlertStudioPage.tsx</c> (route <c>/notifications/studio</c>).
/// Carries the diagnostics slug, the nav route name and the title / subtitle keys + verbatim English fallbacks.
/// UI-free so it is asserted headlessly.
/// </summary>
public static class AlertStudioRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "AlertStudioPage";

    /// <summary>The navigation route name this page registers under (shell <c>NotificationsStudio</c>).</summary>
    public const string RouteName = "NotificationsStudio";

    /// <summary>The native route the studio deep-links resolve to (web <c>/notifications/studio</c>).</summary>
    public const string StudioRoutePath = "notifications/studio";

    /// <summary>The default test-delivery cooldown (web <c>freshEditor().cooldown_min</c>).</summary>
    public const int DefaultCooldownMinutes = 15;

    /// <summary>The localized page title (web <c>notifications.alertStudio.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("notifications.alertStudio.title", "Alert Studio");
    }

    /// <summary>The localized page subtitle (web <c>notifications.alertStudio.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "notifications.alertStudio.subtitle",
            "Create custom rules from Fleet Telemetry signals");
    }
}

/// <summary>The value type a signal operand carries (web <c>SignalValueType</c>).</summary>
public enum SignalValueType
{
    /// <summary>A numeric signal (web <c>'numeric'</c>).</summary>
    Numeric,

    /// <summary>A free-text signal (web <c>'text'</c>).</summary>
    Text,

    /// <summary>A boolean signal (web <c>'bool'</c>).</summary>
    Bool,
}

/// <summary>
/// One built-in rule template — the native mirror of a web <c>ruleTemplates[]</c> entry
/// (web AlertStudioPage.tsx). Cloning a template hydrates a fresh editor with its signal / op / value.
/// </summary>
public sealed record AlertRuleTemplate(
    string Name,
    string Category,
    string Severity,
    string Message,
    int CooldownMinutes,
    string SignalName,
    string Op,
    double? ValueNum = null,
    string? ValueText = null,
    bool? ValueBool = null,
    double? ValueMin = null,
    double? ValueMax = null);

/// <summary>One catalog signal definition derived from the template set (web <c>SignalDefinition</c>).</summary>
public sealed record AlertSignalDefinition(string Name, string Category, SignalValueType ValueType);

/// <summary>
/// The static rule-template catalog + derived signal catalog + the operator / value-kind / severity helper logic
/// — a faithful native port of the module-level constants and pure helpers in web AlertStudioPage.tsx. No WinUI
/// types so the whole thing is asserted headlessly.
/// </summary>
public static class AlertStudioCatalog
{
    /// <summary>Canonical info &lt; warn &lt; critical ordering (web <c>SEVERITY_RANK</c>).</summary>
    public static int SeverityRank(string severity) => NormalizeSeverity(severity) switch
    {
        "critical" => 3,
        "warn" => 2,
        _ => 1,
    };

    /// <summary>The numeric-signal operator set (web <c>numericOperatorOptions</c>).</summary>
    public static IReadOnlyList<string> NumericOperators { get; } =
        new[] { "=", "!=", "<", "<=", ">", ">=", "changed", "between", "outside" };

    /// <summary>The scalar (text / bool) operator set (web <c>scalarOperatorOptions</c>).</summary>
    public static IReadOnlyList<string> ScalarOperators { get; } = new[] { "=", "!=", "changed" };

    /// <summary>The marker category for a user-typed custom signal (web <c>customSignalCategory</c>).</summary>
    public const string CustomSignalCategory = "__custom__";

    /// <summary>The built-in templates (web <c>ruleTemplates</c>).</summary>
    public static IReadOnlyList<AlertRuleTemplate> Templates { get; } = new[]
    {
        new AlertRuleTemplate("Battery Low (< 20%)", "Battery", "warn", "Battery at {{BatteryLevel}}%", 30, "BatteryLevel", "<", ValueNum: 20),
        new AlertRuleTemplate("Battery Critical (< 10%)", "Battery", "critical", "Battery critically low at {{BatteryLevel}}%!", 15, "BatteryLevel", "<", ValueNum: 10),
        new AlertRuleTemplate("Battery Full (>= 90%)", "Battery", "info", "Battery reached {{BatteryLevel}}%", 60, "BatteryLevel", ">=", ValueNum: 90),
        new AlertRuleTemplate("Charge Limit Reached", "Battery", "info", "Battery at charge limit {{ChargeLimitSoc}}%", 60, "BatteryLevel", ">=", ValueNum: 80),
        new AlertRuleTemplate("Range Below 50 km", "Battery", "warn", "Range low: {{RatedRange}} km remaining", 30, "RatedRange", "<", ValueNum: 50),

        new AlertRuleTemplate("Charge Complete", "Charging", "info", "Charging complete at {{BatteryLevel}}%", 60, "ChargeState", "=", ValueText: "Complete"),
        new AlertRuleTemplate("Charging Started", "Charging", "info", "Charging started - {{DetailedChargeState}}", 15, "DetailedChargeState", "=", ValueText: "Charging"),
        new AlertRuleTemplate("Charging Stopped Unexpectedly", "Charging", "warn", "Charging stopped - {{DetailedChargeState}}", 30, "DetailedChargeState", "=", ValueText: "Stopped"),
        new AlertRuleTemplate("Supercharging (DC Fast)", "Charging", "info", "Supercharging at {{DCChargingPower}} kW", 30, "DCChargingPower", ">", ValueNum: 50),
        new AlertRuleTemplate("Slow Charge Rate", "Charging", "warn", "Charging slow: {{ChargeAmps}}A", 60, "ChargeAmps", "between", ValueMin: 0.01, ValueMax: 5),

        new AlertRuleTemplate("Drive Started", "Driving", "info", "Drive started - gear is {{Gear}}", 5, "Gear", "=", ValueText: "D"),
        new AlertRuleTemplate("Drive Ended", "Driving", "info", "Drive ended - gear is {{Gear}}", 5, "Gear", "=", ValueText: "P"),
        new AlertRuleTemplate("Speed Limit Exceeded", "Driving", "warn", "Speed {{VehicleSpeed}} km/h exceeded limit", 15, "VehicleSpeed", ">", ValueNum: 120),
        new AlertRuleTemplate("High Speed Alert (> 160 km/h)", "Driving", "critical", "Very high speed: {{VehicleSpeed}} km/h!", 5, "VehicleSpeed", ">", ValueNum: 160),
        new AlertRuleTemplate("Reverse Gear Engaged", "Driving", "info", "Vehicle in reverse", 5, "Gear", "=", ValueText: "R"),
        new AlertRuleTemplate("Odometer Milestone (100k km)", "Driving", "info", "Odometer: {{Odometer}} km", 1440, "Odometer", ">", ValueNum: 100000),

        new AlertRuleTemplate("Car Unlocked While Parked", "Security", "critical", "Vehicle is unlocked and parked!", 30, "Locked", "=", ValueBool: false),
        new AlertRuleTemplate("Vehicle Locked", "Security", "info", "Vehicle locked", 5, "Locked", "=", ValueBool: true),
        new AlertRuleTemplate("Vehicle Unlocked", "Security", "info", "Vehicle unlocked", 5, "Locked", "=", ValueBool: false),
        new AlertRuleTemplate("Sentry Mode Activated", "Security", "info", "Sentry mode activated", 30, "SentryMode", "=", ValueBool: true),
        new AlertRuleTemplate("Door Opened While Parked", "Security", "warn", "Door opened - {{DoorState}}", 15, "DoorState", "!=", ValueText: "Closed"),
        new AlertRuleTemplate("Window Left Open", "Security", "warn", "Front driver window is {{FdWindow}}", 60, "FdWindow", "!=", ValueText: "Closed"),
        new AlertRuleTemplate("Valet Mode Enabled", "Security", "info", "Valet mode enabled", 60, "ValetModeEnabled", "=", ValueBool: true),
        new AlertRuleTemplate("Guest Mode Enabled", "Security", "warn", "Guest mode enabled", 60, "GuestModeEnabled", "=", ValueBool: true),

        new AlertRuleTemplate("Cabin Overheat (> 40C)", "Climate", "warn", "Cabin temp: {{InsideTemp}}C", 30, "InsideTemp", ">", ValueNum: 40),
        new AlertRuleTemplate("Cabin Freezing (< 0C)", "Climate", "warn", "Cabin temp: {{InsideTemp}}C - freezing!", 60, "InsideTemp", "<", ValueNum: 0),
        new AlertRuleTemplate("HVAC Left On While Parked", "Climate", "info", "HVAC running while parked", 30, "HvacPower", "=", ValueBool: true),
        new AlertRuleTemplate("Climate Keeper Active", "Climate", "info", "Climate keeper: {{ClimateKeeperMode}}", 60, "ClimateKeeperMode", "!=", ValueText: "Off"),
        new AlertRuleTemplate("Steering Wheel Heater On", "Climate", "info", "Steering wheel heater level {{HvacSteeringWheelHeatLevel}}", 30, "HvacSteeringWheelHeatLevel", ">", ValueNum: 0),

        new AlertRuleTemplate("Tire Pressure Low", "Tire Pressure", "warn", "Low tire pressure detected", 60, "TpmsHardWarnings", "=", ValueBool: true),
        new AlertRuleTemplate("Tire Pressure Soft Warning", "Tire Pressure", "info", "Tire pressure slightly low", 120, "TpmsSoftWarnings", "=", ValueBool: true),
        new AlertRuleTemplate("Front Left Tire Low (< 2.2 bar)", "Tire Pressure", "warn", "FL tire: {{TpmsPressureFl}} bar", 60, "TpmsPressureFl", "<", ValueNum: 2.2),

        new AlertRuleTemplate("Arrived at Home", "Location", "info", "Vehicle arrived at home", 15, "LocatedAtHome", "=", ValueBool: true),
        new AlertRuleTemplate("Left Home", "Location", "info", "Vehicle left home", 15, "LocatedAtHome", "=", ValueBool: false),
        new AlertRuleTemplate("Arrived at Work", "Location", "info", "Vehicle arrived at work", 15, "LocatedAtWork", "=", ValueBool: true),
        new AlertRuleTemplate("Navigation Started", "Location", "info", "Navigating to {{DestinationName}}", 10, "DestinationName", "changed"),

        new AlertRuleTemplate("Driver Seatbelt Unbuckled", "Safety", "warn", "Driver seatbelt unbuckled while driving!", 5, "DriverSeatBelt", "=", ValueBool: false),
        new AlertRuleTemplate("Speed Limit Mode Active", "Safety", "info", "Speed limit mode active", 60, "SpeedLimitMode", "=", ValueBool: true),
        new AlertRuleTemplate("PIN to Drive Disabled", "Safety", "warn", "PIN to Drive has been disabled", 1440, "PinToDriveEnabled", "=", ValueBool: false),

        new AlertRuleTemplate("High Motor Temperature (> 80C)", "Motor", "warn", "Motor stator temp: {{DiStatorTempF}}C", 15, "DiStatorTempF", ">", ValueNum: 80),
        new AlertRuleTemplate("HVIL Fault", "Motor", "critical", "HV interlock fault detected!", 5, "Hvil", "=", ValueText: "Fault"),
        new AlertRuleTemplate("High Regenerative Braking", "Motor", "info", "Regen power: {{Power}} kW", 15, "Power", "<", ValueNum: -50),

        new AlertRuleTemplate("Software Update Available", "Software", "info", "Update available: {{SoftwareUpdateVersion}}", 1440, "SoftwareUpdateVersion", "changed"),
        new AlertRuleTemplate("Software Update Installing", "Software", "info", "Installing update: {{SoftwareUpdateInstallationPercentComplete}}%", 30, "SoftwareUpdateInstallationPercentComplete", ">", ValueNum: 0),

        new AlertRuleTemplate("Music Playing", "Media", "info", "Now playing: {{MediaNowPlayingTitle}} by {{MediaNowPlayingArtist}}", 60, "MediaPlaybackStatus", "=", ValueText: "Playing"),
        new AlertRuleTemplate("Volume Too High", "Media", "info", "Volume at {{MediaAudioVolume}}", 30, "MediaAudioVolume", ">", ValueNum: 8),

        new AlertRuleTemplate("Powershare Active", "Powershare", "info", "Powershare active: {{PowershareInstantaneousPowerKW}} kW", 60, "PowershareStatus", "changed"),
    };

    /// <summary>The sorted distinct template categories (web <c>templateCategories</c>).</summary>
    public static IReadOnlyList<string> Categories { get; } =
        Templates.Select(t => t.Category).Distinct(StringComparer.Ordinal).OrderBy(c => c, StringComparer.Ordinal).ToArray();

    /// <summary>The catalog signals derived from the templates (web <c>signalCatalog</c>).</summary>
    public static IReadOnlyList<AlertSignalDefinition> SignalCatalog { get; } = BuildSignalCatalog();

    private static readonly Dictionary<string, AlertSignalDefinition> SignalByName =
        SignalCatalog.ToDictionary(s => s.Name, s => s, StringComparer.Ordinal);

    /// <summary>Look up a catalog signal by name (null when user-typed / unknown).</summary>
    public static AlertSignalDefinition? FindSignal(string name) =>
        SignalByName.TryGetValue(name ?? string.Empty, out var def) ? def : null;

    /// <summary>The operators allowed for a signal value type (web <c>allowedOpsForSignalType</c>).</summary>
    public static IReadOnlyList<string> AllowedOperators(SignalValueType valueType) =>
        valueType == SignalValueType.Numeric ? NumericOperators : ScalarOperators;

    /// <summary>Coerce an op to one allowed for the value type, else "=" (web <c>coerceOperatorForSignalType</c>).</summary>
    public static string CoerceOperator(string op, SignalValueType valueType) =>
        AllowedOperators(valueType).Contains(op, StringComparer.Ordinal) ? op : "=";

    /// <summary>Whether the op needs a single numeric operand (web <c>isNumericOnlyOp</c>).</summary>
    public static bool IsNumericOnlyOp(string op) => op is "<" or "<=" or ">" or ">=";

    /// <summary>Whether the op needs a min/max range (web <c>isRangeOp</c>).</summary>
    public static bool IsRangeOp(string op) => op is "between" or "outside";

    /// <summary>The value kind implied by a value type + op (web <c>valueKindForSignalOp</c>).</summary>
    public static AlertValueKind ValueKindFor(SignalValueType valueType, string op)
    {
        if (op == "changed")
        {
            return AlertValueKind.None;
        }

        if (valueType == SignalValueType.Numeric)
        {
            return IsRangeOp(op) ? AlertValueKind.Range : AlertValueKind.Number;
        }

        return valueType == SignalValueType.Bool ? AlertValueKind.Bool : AlertValueKind.Text;
    }

    /// <summary>The value type for a signal name, falling back to a value-kind hint (web <c>signalTypeForName</c>).</summary>
    public static SignalValueType SignalTypeForName(string signalName, AlertValueKind fallbackKind) =>
        FindSignal(signalName)?.ValueType ?? SignalTypeForValueKind(fallbackKind);

    /// <summary>The value type implied by a value kind (web <c>signalTypeForValueKind</c>).</summary>
    public static SignalValueType SignalTypeForValueKind(AlertValueKind valueKind) => valueKind switch
    {
        AlertValueKind.Bool => SignalValueType.Bool,
        AlertValueKind.Text or AlertValueKind.None => SignalValueType.Text,
        _ => SignalValueType.Numeric,
    };

    /// <summary>Normalize a wire severity to <c>info | warn | critical</c> (web <c>normalizeSeverity</c>).</summary>
    public static string NormalizeSeverity(string? value) => value switch
    {
        "info" or "warn" or "critical" => value,
        "warning" => "warn",
        _ => "info",
    };

    /// <summary>Normalize a wire trigger mode to <c>once | repeat</c> (web <c>normalizeTriggerMode</c>).</summary>
    public static string NormalizeTriggerMode(string? value) => value is "once" or "repeat" ? value : "repeat";

    /// <summary>Whether a snooze timestamp is still in the future (web <c>isSnoozeActive</c>).</summary>
    public static bool IsSnoozeActive(string? snoozedUntil, DateTimeOffset now)
    {
        if (string.IsNullOrEmpty(snoozedUntil))
        {
            return false;
        }

        return DateTimeOffset.TryParse(
            snoozedUntil,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed) && parsed > now;
    }

    private static SignalValueType InferTemplateSignalType(AlertRuleTemplate template)
    {
        if (template.ValueNum != null
            || template.ValueMin != null
            || template.ValueMax != null
            || IsNumericOnlyOp(template.Op)
            || IsRangeOp(template.Op))
        {
            return SignalValueType.Numeric;
        }

        return template.ValueBool != null ? SignalValueType.Bool : SignalValueType.Text;
    }

    private static SignalValueType MergeSignalType(SignalValueType current, SignalValueType next)
    {
        if (current == next)
        {
            return current;
        }

        if (current == SignalValueType.Numeric || next == SignalValueType.Numeric)
        {
            return SignalValueType.Numeric;
        }

        return current == SignalValueType.Bool || next == SignalValueType.Bool ? SignalValueType.Bool : SignalValueType.Text;
    }

    private static AlertSignalDefinition[] BuildSignalCatalog()
    {
        var byName = new Dictionary<string, AlertSignalDefinition>(StringComparer.Ordinal);
        foreach (var template in Templates)
        {
            var valueType = InferTemplateSignalType(template);
            if (byName.TryGetValue(template.SignalName, out var existing))
            {
                byName[template.SignalName] = existing with { ValueType = MergeSignalType(existing.ValueType, valueType) };
                continue;
            }

            byName[template.SignalName] = new AlertSignalDefinition(template.SignalName, template.Category, valueType);
        }

        return byName.Values
            .OrderBy(s => s.Category, StringComparer.Ordinal)
            .ThenBy(s => s.Name, StringComparer.Ordinal)
            .ToArray();
    }
}
