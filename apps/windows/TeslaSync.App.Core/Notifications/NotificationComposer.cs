using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Push;

namespace TeslaSync.App.Core.Notifications;

/// <summary>
/// Composes a decoded foreground <see cref="PushPayload"/> into a localized, deep-linkable,
/// optionally-redacted <see cref="NotificationContent"/> (P2/W8-0001). It is the one place toast
/// semantics live: it classifies the kind, resolves the in-app route against the real
/// <see cref="RouteRegistry"/>, picks the banner severity and toast scenario, builds the localized
/// action buttons, and (when privacy redaction is on) masks PII in the body. Pure and headless so the
/// full mapping — keys, routes, actions, redaction — is unit-tested without a resource host.
/// </summary>
public sealed class NotificationComposer
{
    private readonly RouteRegistry _registry;
    private readonly ILocalizer _localizer;
    private readonly Func<bool> _redactSensitive;

    /// <summary>Creates the composer over the route registry, a localizer and a fixed privacy-redaction flag.</summary>
    public NotificationComposer(RouteRegistry registry, ILocalizer? localizer = null, bool redactSensitive = false)
        : this(registry, localizer, () => redactSensitive)
    {
    }

    /// <summary>Creates the composer with a live privacy-redaction predicate (evaluated per compose).</summary>
    public NotificationComposer(RouteRegistry registry, ILocalizer? localizer, Func<bool> redactSensitive)
    {
        ArgumentNullException.ThrowIfNull(registry);
        ArgumentNullException.ThrowIfNull(redactSensitive);
        _registry = registry;
        _localizer = localizer ?? PassthroughLocalizer.Instance;
        _redactSensitive = redactSensitive;
    }

    /// <summary>Composes <paramref name="payload"/> into a fully-resolved notification.</summary>
    public NotificationContent Compose(PushPayload payload)
    {
        ArgumentNullException.ThrowIfNull(payload);

        var kind = NotificationKinds.Parse(payload.Kind);
        var wire = NotificationKinds.ToWire(kind);
        var route = NotificationRouteMap.Resolve(kind, payload.Data, _registry);

        var title = !string.IsNullOrWhiteSpace(payload.Title)
            ? payload.Title!
            : _localizer.GetString($"notifications.kind.{wire}.title", DefaultTitle(kind));

        var body = !string.IsNullOrWhiteSpace(payload.Body)
            ? payload.Body!
            : _localizer.GetString($"notifications.kind.{wire}.body", DefaultBody(kind));

        if (_redactSensitive())
        {
            body = NotificationRedaction.Redact(body);
        }

        var severity = SeverityFor(kind, payload.Category);
        var scenario = severity == PushBannerSeverity.Critical || kind == NotificationKind.ReauthNeeded
            ? ToastScenario.Urgent
            : ToastScenario.Default;

        return new NotificationContent(kind, title, body, severity, scenario, route.Path, route.EntityId, BuildActions(kind, route));
    }

    private List<ToastAction> BuildActions(NotificationKind kind, ResolvedRoute route)
    {
        var actions = new List<ToastAction>(2);

        var (primaryAction, primaryKey, primaryFallback) = PrimaryAction(kind);
        actions.Add(new ToastAction(
            _localizer.GetString(primaryKey, primaryFallback),
            ToastArguments.For(primaryAction, route.Path, kind, route.EntityId)));

        switch (kind)
        {
            case NotificationKind.CommandResult:
                actions.Add(new ToastAction(
                    _localizer.GetString("notifications.action.retry", "Retry"),
                    ToastArguments.For(ToastActions.Retry, route.Path, kind, route.EntityId)));
                break;
            case NotificationKind.ReauthNeeded:
            case NotificationKind.Generic:
                break;
            default:
                actions.Add(new ToastAction(
                    _localizer.GetString("notifications.action.dismiss", "Dismiss"),
                    ToastArguments.For(ToastActions.Dismiss, route.Path, kind, route.EntityId)));
                break;
        }

        return actions;
    }

    private static (string Action, string Key, string Fallback) PrimaryAction(NotificationKind kind) => kind switch
    {
        NotificationKind.ReauthNeeded => (ToastActions.Reauthenticate, "notifications.action.signIn", "Sign in"),
        NotificationKind.ChargeComplete => (ToastActions.Navigate, "notifications.action.viewCharging", "View charging"),
        NotificationKind.VehicleState => (ToastActions.Navigate, "notifications.action.viewVehicle", "View vehicle"),
        NotificationKind.Alert => (ToastActions.Navigate, "notifications.action.viewAlert", "View alert"),
        NotificationKind.Automation => (ToastActions.Navigate, "notifications.action.viewAutomation", "View automation"),
        NotificationKind.SystemIncident => (ToastActions.Navigate, "notifications.action.viewIncident", "View incident"),
        NotificationKind.CommandResult => (ToastActions.Navigate, "notifications.action.view", "View"),
        _ => (ToastActions.OpenInbox, "notifications.action.openInbox", "Open inbox"),
    };

    private static PushBannerSeverity SeverityFor(NotificationKind kind, string? category)
    {
        var fromCategory = category?.Trim().ToLowerInvariant() switch
        {
            "critical" or "alert" or "security" or "error" => PushBannerSeverity.Critical,
            "warning" or "warn" => PushBannerSeverity.Warning,
            _ => PushBannerSeverity.Info,
        };

        var floor = kind switch
        {
            NotificationKind.ReauthNeeded => PushBannerSeverity.Critical,
            NotificationKind.SystemIncident => PushBannerSeverity.Warning,
            NotificationKind.Alert => PushBannerSeverity.Warning,
            _ => PushBannerSeverity.Info,
        };

        return (PushBannerSeverity)Math.Max((int)fromCategory, (int)floor);
    }

    private static string DefaultTitle(NotificationKind kind) => kind switch
    {
        NotificationKind.Alert => "Alert",
        NotificationKind.ChargeComplete => "Charging complete",
        NotificationKind.VehicleState => "Vehicle update",
        NotificationKind.Automation => "Automation ran",
        NotificationKind.CommandResult => "Command finished",
        NotificationKind.SystemIncident => "System incident",
        NotificationKind.ReauthNeeded => "Sign-in required",
        _ => "TeslaSync",
    };

    private static string DefaultBody(NotificationKind kind) => kind switch
    {
        NotificationKind.Alert => "An alert rule fired.",
        NotificationKind.ChargeComplete => "Your vehicle finished charging.",
        NotificationKind.VehicleState => "Your vehicle changed state.",
        NotificationKind.Automation => "An automation completed.",
        NotificationKind.CommandResult => "Your vehicle command completed.",
        NotificationKind.SystemIncident => "A service incident was updated.",
        NotificationKind.ReauthNeeded => "Reconnect your Tesla account to keep syncing.",
        _ => "You have a new notification.",
    };
}
