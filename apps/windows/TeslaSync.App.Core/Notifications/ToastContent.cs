namespace TeslaSync.App.Core.Notifications;

/// <summary>
/// The system toast presentation scenario (P2/W8-0001). It is mapped by the platform toast surface to
/// the Windows App SDK <c>AppNotificationScenario</c> so an urgent alert is allowed to break through
/// and a reminder behaves accordingly, while the default covers ordinary informational toasts.
/// </summary>
public enum ToastScenario
{
    /// <summary>An ordinary informational toast.</summary>
    Default = 0,

    /// <summary>A high-priority toast that should break through (critical alerts, re-auth).</summary>
    Urgent,

    /// <summary>A reminder-style toast that stays on screen until dismissed.</summary>
    Reminder,
}

/// <summary>
/// One actionable button on a toast (P2/W8-0001). <see cref="Content"/> is the already-localized
/// button label; <see cref="Arguments"/> is the opaque, <see cref="ToastArguments"/>-encoded
/// activation string the button returns when invoked, which the activation handler decodes back into
/// a route + action.
/// </summary>
public sealed record ToastAction(string Content, string Arguments);

/// <summary>
/// The fully-composed, localized, deep-linkable content of a single toast (P2/W8-0001). It is the
/// platform-agnostic projection the Windows <c>AppNotificationBuilder</c> renders: a title/body, the
/// body-on-launch <see cref="LaunchArguments"/> (the route the toast opens), zero or more
/// <see cref="Actions"/>, and the <see cref="ToastScenario"/>. It carries no secrets — the composer
/// has already applied <see cref="NotificationRedaction"/> where privacy requires it.
/// </summary>
public sealed record ToastContent(
    string Title,
    string Body,
    NotificationKind Kind,
    ToastScenario Scenario,
    string LaunchArguments,
    IReadOnlyList<ToastAction> Actions)
{
    /// <summary>A stable group tag (the wire kind) so the platform can collapse / replace by category.</summary>
    public string Group => NotificationKinds.ToWire(Kind);
}
