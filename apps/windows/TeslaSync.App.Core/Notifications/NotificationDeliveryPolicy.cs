using TeslaSync.App.Core.Push;

namespace TeslaSync.App.Core.Notifications;

/// <summary>
/// The fan-out decision for one notification (P2/W8-0001): whether to record it in the inbox, raise
/// the in-app banner and/or present an OS toast. The three surfaces are independent so the policy can,
/// for example, record-and-banner a foreground notification without an OS toast, or record-only a
/// quiet-hours one.
/// </summary>
public sealed record NotificationDelivery(bool Ingest, bool InAppBanner, bool OsToast)
{
    /// <summary>Record in the inbox only (no banner, no toast).</summary>
    public static NotificationDelivery InboxOnly { get; } = new(true, false, false);
}

/// <summary>
/// Coordinates the foreground in-app banner with the OS toast and honors the user's settings, quiet
/// hours and Focus Assist (P2/W8-0001). The rules, in order:
/// <list type="number">
///   <item>The inbox always records the notification (durable state, never silenced).</item>
///   <item>The master toggle and per-kind toggle gate the user-facing surfaces — but a critical
///         notification with breakthrough enabled still surfaces.</item>
///   <item>While the app is foreground the user sees the in-app banner and the OS toast is suppressed
///         (no double notification); while backgrounded the OS toast carries it.</item>
///   <item>Quiet hours and Focus Assist silence the OS toast (inbox + banner still update) unless this
///         is a critical breakthrough.</item>
/// </list>
/// Pure and total so every combination is unit-tested.
/// </summary>
public static class NotificationDeliveryPolicy
{
    /// <summary>Decides how <paramref name="content"/> should be delivered given the current context.</summary>
    public static NotificationDelivery Decide(
        NotificationContent content,
        NotificationSettings settings,
        FocusAssistState focusAssist,
        bool isForeground,
        TimeOnly localNow)
    {
        ArgumentNullException.ThrowIfNull(content);
        ArgumentNullException.ThrowIfNull(settings);

        bool isCritical = content.Severity == PushBannerSeverity.Critical;
        bool breakthrough = isCritical && settings.AllowCriticalBreakthrough;

        bool userFacingAllowed = breakthrough || (settings.Enabled && settings.IsKindEnabled(content.Kind));
        if (!userFacingAllowed)
        {
            return NotificationDelivery.InboxOnly;
        }

        bool inAppBanner = isForeground;
        bool osToast = !isForeground;

        if (osToast && !breakthrough)
        {
            if (settings.QuietHours.IsQuiet(localNow))
            {
                osToast = false;
            }

            if (settings.RespectFocusAssist && SuppressesToasts(focusAssist))
            {
                osToast = false;
            }
        }

        return new NotificationDelivery(Ingest: true, inAppBanner, osToast);
    }

    private static bool SuppressesToasts(FocusAssistState state) =>
        state is FocusAssistState.PriorityOnly or FocusAssistState.AlarmsOnly;
}
