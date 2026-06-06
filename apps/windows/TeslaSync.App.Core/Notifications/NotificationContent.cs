using TeslaSync.App.Core.Push;

namespace TeslaSync.App.Core.Notifications;

/// <summary>
/// The fully-composed, localized semantic notification (P2/W8-0001). It is produced by
/// <see cref="NotificationComposer"/> from a decoded <see cref="PushPayload"/> and is the single source
/// the dispatcher fans out: the inbox records it, the in-app banner renders <see cref="Title"/> /
/// <see cref="Body"/> at <see cref="Severity"/>, and the toast surface renders <see cref="ToToast"/>.
/// <see cref="RoutePath"/> is the validated in-app deep-link target the body-tap opens.
/// </summary>
public sealed record NotificationContent(
    NotificationKind Kind,
    string Title,
    string Body,
    PushBannerSeverity Severity,
    ToastScenario Scenario,
    string RoutePath,
    string? EntityId,
    IReadOnlyList<ToastAction> Actions)
{
    /// <summary>The encoded body-tap activation argument string (navigate to <see cref="RoutePath"/>).</summary>
    public string LaunchArguments => ToastArguments.For(ToastActions.Navigate, RoutePath, Kind, EntityId);

    /// <summary>Projects this notification into the toast content the platform surface renders.</summary>
    public ToastContent ToToast() => new(Title, Body, Kind, Scenario, LaunchArguments, Actions);
}
