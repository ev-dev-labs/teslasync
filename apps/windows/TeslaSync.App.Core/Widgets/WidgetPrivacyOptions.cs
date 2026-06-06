namespace TeslaSync.App.Core.Widgets;

/// <summary>
/// The privacy posture a Windows widget (P2/W8-0003, ADR-016) renders under. Ambient surfaces are
/// visible on a shared desktop, so the defaults are privacy-first: the VIN and the vehicle location
/// are hidden unless the user has explicitly opted in. <see cref="AllowAnalytics"/> honours the W8-0002
/// telemetry opt-in (a widget interaction is only counted when analytics are enabled), and
/// <see cref="NotificationsEnabled"/> carries the notification master toggle so a future alert
/// affordance can respect it. These never affect whether the widget renders — only what it reveals.
/// </summary>
public sealed record WidgetPrivacyOptions
{
    /// <summary>Whether the VIN is withheld from the widget surface (default: hidden).</summary>
    public bool HideVin { get; init; } = true;

    /// <summary>Whether the vehicle location is withheld from the widget surface (default: hidden).</summary>
    public bool HideLocation { get; init; } = true;

    /// <summary>Whether widget interaction analytics may be recorded (mirrors the telemetry opt-in).</summary>
    public bool AllowAnalytics { get; init; }

    /// <summary>Whether user-facing notifications are enabled (the master toggle).</summary>
    public bool NotificationsEnabled { get; init; } = true;

    /// <summary>The privacy-first defaults used when no settings are available.</summary>
    public static WidgetPrivacyOptions Default { get; } = new();

    /// <summary>
    /// Builds the posture from the W8-0002 preferences. The VIN and location stay hidden by default and
    /// when <paramref name="redactSensitiveContent"/> is set; revealing them is an explicit opt-out the
    /// caller passes through <paramref name="revealVin"/> / <paramref name="revealLocation"/>.
    /// </summary>
    public static WidgetPrivacyOptions Create(
        bool redactSensitiveContent,
        bool telemetryOptIn,
        bool notificationsEnabled,
        bool revealVin = false,
        bool revealLocation = false) => new()
        {
            HideVin = redactSensitiveContent || !revealVin,
            HideLocation = redactSensitiveContent || !revealLocation,
            AllowAnalytics = telemetryOptIn,
            NotificationsEnabled = notificationsEnabled,
        };
}
