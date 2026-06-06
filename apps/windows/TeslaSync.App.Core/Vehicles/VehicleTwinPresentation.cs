namespace TeslaSync.App.Core.Vehicles;

/// <summary>
/// Label + accent resolution for the digital twin's state indicators (port of the
/// web <c>VehicleTwin</c> <c>windowLabel</c> / <c>windowStroke</c> / <c>doorStroke</c>
/// / <c>stateLabel</c> helpers and the fixed semantic <c>C</c> color constants). The
/// semantic accent colors are intentionally paint-agnostic so status reads
/// consistently across every body color. Pure + headless.
/// </summary>
public static class VehicleTwinPresentation
{
    /// <summary>Open / amber accent (doors, windows, frunk, trunk open).</summary>
    public const string AmberOpen = "#FBBF24";

    /// <summary>Closed / neutral glass stroke.</summary>
    public const string GlassStroke = "#7DD3FC";

    /// <summary>Locked = green.</summary>
    public const string LockedGreen = "#22C55E";

    /// <summary>Unlocked = red.</summary>
    public const string UnlockedRed = "#EF4444";

    /// <summary>Charging = green.</summary>
    public const string ChargeGreen = "#22C55E";

    /// <summary>Sentry armed = red.</summary>
    public const string SentryRed = "#EF4444";

    /// <summary>Headlights on = warm white.</summary>
    public const string HeadlightOn = "#FFFFDC";

    /// <summary>Unknown / muted neutral.</summary>
    public const string Neutral = "#94A3B8";

    /// <summary>Human label for a window position (matches the web <c>windowLabel</c>).</summary>
    public static string WindowLabel(WindowPosition state) => state switch
    {
        WindowPosition.Closed => "Closed",
        WindowPosition.Open => "Open",
        WindowPosition.Partial => "Partially open",
        _ => "Unknown",
    };

    /// <summary>Stroke accent for a window position (matches the web <c>windowStroke</c>).</summary>
    public static string WindowStroke(WindowPosition state) => state switch
    {
        WindowPosition.Open => AmberOpen,
        WindowPosition.Partial => "#F59E0B",
        WindowPosition.Closed => GlassStroke,
        _ => Neutral,
    };

    /// <summary>Stroke accent for a door (open = amber, closed = neutral, unknown = muted).</summary>
    public static string DoorStroke(bool? open) => open switch
    {
        true => AmberOpen,
        false => "#FFFFFF",
        _ => Neutral,
    };

    /// <summary>
    /// Tri-state label for a boolean indicator: <paramref name="trueText"/> /
    /// <paramref name="falseText"/> / "Unknown" (matches the web <c>stateLabel</c>).
    /// </summary>
    public static string StateLabel(bool? value, string trueText, string falseText) => value switch
    {
        true => trueText,
        false => falseText,
        _ => "Unknown",
    };

    /// <summary>Lock accent: locked = green, unlocked = red, unknown = muted.</summary>
    public static string LockColor(bool? locked) => locked switch
    {
        true => LockedGreen,
        false => UnlockedRed,
        _ => Neutral,
    };

    /// <summary>Accessible lock label.</summary>
    public static string LockLabel(bool? locked) => StateLabel(locked, "Locked", "Unlocked");

    /// <summary>Accessible sentry label.</summary>
    public static string SentryLabel(bool? sentry) => StateLabel(sentry, "Sentry on", "Sentry off");
}
