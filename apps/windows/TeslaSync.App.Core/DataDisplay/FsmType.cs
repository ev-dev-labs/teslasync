namespace TeslaSync.App.Core.DataDisplay;

/// <summary>
/// Maps an FSM domain type to a semantic badge variant + label (port of the web
/// <c>FSMBadge</c> <c>FSM_COLORS</c> table). Backs <c>TsFSMBadge</c>.
/// </summary>
public static class FsmType
{
    /// <summary>Semantic badge variant for an FSM domain key.</summary>
    public static SeverityLevel Variant(string? type) => Key(type) switch
    {
        "vehicle" => SeverityLevel.Info,
        "drive_session" => SeverityLevel.Success,
        "charge_session" => SeverityLevel.Warn,
        "command" => SeverityLevel.Critical,
        "automation" => SeverityLevel.Info,
        _ => SeverityLevel.Info, // neutral domains (notification, alert_cooldown, unknown)
    };

    /// <summary>True when the type is a "neutral" domain with no semantic colour.</summary>
    public static bool IsNeutral(string? type) => Key(type) switch
    {
        "vehicle" or "drive_session" or "charge_session" or "command" or "automation" => false,
        _ => true,
    };

    /// <summary>Short display label for an FSM domain key (falls back to the raw type).</summary>
    public static string Label(string? type) => Key(type) switch
    {
        "vehicle" => "Vehicle",
        "drive_session" => "Drive",
        "charge_session" => "Charge",
        "command" => "Command",
        "notification" => "Notify",
        "alert_cooldown" => "Cooldown",
        "automation" => "Automation",
        _ => type ?? string.Empty,
    };

    private static string Key(string? type) => (type ?? string.Empty).Trim().ToLowerInvariant();
}
