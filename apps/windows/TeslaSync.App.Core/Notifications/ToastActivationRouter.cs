using TeslaSync.App.Core.Navigation;

namespace TeslaSync.App.Core.Notifications;

/// <summary>
/// The decoded result of a toast activation (P2/W8-0001): the invoked action, the validated
/// destination route and the kind/entity it came from. <see cref="ShouldNavigate"/> is false only for
/// an explicit dismiss, so the activation handler knows when to bring the route forward versus simply
/// acknowledge the toast.
/// </summary>
public sealed record ToastActivation(
    string Action,
    string RoutePath,
    NotificationKind Kind,
    string? EntityId,
    RouteMatch Match)
{
    /// <summary>True unless the user explicitly dismissed the toast (then no navigation should occur).</summary>
    public bool ShouldNavigate => !string.Equals(Action, ToastActions.Dismiss, StringComparison.Ordinal);
}

/// <summary>
/// Decodes the opaque argument string returned when a toast (body or button) is activated and resolves
/// it to a real route (P2/W8-0001). It is the headless counterpart of the WinUI activation handler:
/// the platform receives the <c>AppNotificationActivatedEventArgs.Arguments</c> and hands them here,
/// and the result drives shell navigation. Resolution is total and defensive — a missing action
/// defaults to navigate, a missing or unknown route falls back to the notifications inbox — because
/// the arguments originate outside the app (including a cold launch from a closed app).
/// </summary>
public static class ToastActivationRouter
{
    /// <summary>Decodes <paramref name="arguments"/> and resolves the destination route against <paramref name="registry"/>.</summary>
    public static ToastActivation Resolve(string? arguments, RouteRegistry registry)
    {
        ArgumentNullException.ThrowIfNull(registry);

        var data = ToastArguments.Decode(arguments);

        var action = data.TryGetValue(ToastArguments.ActionKey, out var rawAction) && !string.IsNullOrWhiteSpace(rawAction)
            ? rawAction
            : ToastActions.Navigate;

        var requested = data.TryGetValue(ToastArguments.RouteKey, out var rawRoute) && !string.IsNullOrWhiteSpace(rawRoute)
            ? rawRoute
            : NotificationRouteMap.InboxPath;

        var kind = NotificationKinds.Parse(data.GetValueOrDefault(ToastArguments.KindKey));
        var entityId = data.GetValueOrDefault(ToastArguments.EntityKey);

        var match = registry.Resolve(requested);
        if (match.Route.IsCatchAll)
        {
            match = registry.Resolve(NotificationRouteMap.InboxPath);
        }

        return new ToastActivation(action, match.MatchedPath, kind, entityId, match);
    }
}
