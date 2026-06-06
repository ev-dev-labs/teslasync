namespace TeslaSync.App.Core.Notifications;

/// <summary>
/// A local-time daily quiet-hours window during which ordinary OS toasts are suppressed (P2/W8-0001).
/// The window may wrap past midnight (e.g. 22:00–07:00). It only ever silences the OS toast surface —
/// the inbox and, when the app is foreground, the in-app banner still update — so a user never loses a
/// notification, they just are not interrupted by it. A zero-length window (start == end) is treated
/// as "never quiet" so a misconfiguration cannot accidentally silence everything.
/// </summary>
public sealed record QuietHours(bool Enabled, TimeOnly Start, TimeOnly End)
{
    /// <summary>Quiet hours turned off.</summary>
    public static QuietHours Disabled { get; } = new(false, TimeOnly.MinValue, TimeOnly.MinValue);

    /// <summary>True when <paramref name="now"/> (local time-of-day) falls inside the active window.</summary>
    public bool IsQuiet(TimeOnly now)
    {
        if (!Enabled || Start == End)
        {
            return false;
        }

        return Start < End
            ? now >= Start && now < End
            : now >= Start || now < End;
    }
}
