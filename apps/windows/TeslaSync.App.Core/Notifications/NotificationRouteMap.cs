using TeslaSync.App.Core.Navigation;

namespace TeslaSync.App.Core.Notifications;

/// <summary>The deep-link target a notification opens: an in-app route path plus the entity id it was built from.</summary>
public sealed record ResolvedRoute(string Path, string? EntityId);

/// <summary>
/// Maps a <see cref="NotificationKind"/> (and the push <c>data</c> bag) to a concrete in-app route
/// path (P2/W8-0001). Every candidate is validated against the real <see cref="RouteRegistry"/> — the
/// same registry the W3 shell navigates — so a toast or jump-list entry can never deep-link to a route
/// that does not exist; an unresolvable kind falls back to the always-present notifications inbox.
///
/// <para>Resolution order: (1) an explicit, valid <c>route</c> the backend supplied wins; (2) the
/// kind's parameterized candidate (with a safe entity id) then its static landing page; (3) the inbox.</para>
/// </summary>
public static class NotificationRouteMap
{
    /// <summary>The canonical, always-valid fallback route (the notifications inbox).</summary>
    public const string InboxPath = "notifications/inbox";

    private static readonly string[] VehicleIdKeys = { "vehicle_id", "vehicleId", "id" };
    private static readonly string[] SessionIdKeys = { "session_id", "sessionId", "charging_session_id", "chargingSessionId", "id" };
    private static readonly string[] IncidentIdKeys = { "incident_id", "incidentId", "id" };
    private static readonly string[] GenericIdKeys = { "id", "vehicle_id", "vehicleId" };

    /// <summary>Resolves the deep-link route for <paramref name="kind"/> given its push <paramref name="data"/>.</summary>
    public static ResolvedRoute Resolve(
        NotificationKind kind,
        IReadOnlyDictionary<string, string> data,
        RouteRegistry registry)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(registry);

        var entityId = EntityIdFor(kind, data);

        if (data.TryGetValue(ToastArguments.RouteKey, out var explicitRoute) && IsReal(registry, explicitRoute))
        {
            return new ResolvedRoute(RouteRegistry.Normalize(explicitRoute), entityId);
        }

        foreach (var candidate in CandidatesFor(kind, entityId))
        {
            if (IsReal(registry, candidate))
            {
                return new ResolvedRoute(RouteRegistry.Normalize(candidate), entityId);
            }
        }

        return new ResolvedRoute(InboxPath, entityId);
    }

    private static IEnumerable<string> CandidatesFor(NotificationKind kind, string? entityId)
    {
        switch (kind)
        {
            case NotificationKind.Alert:
                yield return "notifications/alerts";
                yield return InboxPath;
                break;
            case NotificationKind.ChargeComplete:
                if (entityId is not null)
                {
                    yield return "charging/" + entityId;
                }

                yield return "charging";
                break;
            case NotificationKind.VehicleState:
                if (entityId is not null)
                {
                    yield return "vehicles/" + entityId;
                }

                yield return "vehicles";
                break;
            case NotificationKind.Automation:
                yield return "automations";
                break;
            case NotificationKind.CommandResult:
                yield return "command-history";
                yield return "commands";
                break;
            case NotificationKind.SystemIncident:
                if (entityId is not null)
                {
                    yield return "system-status/incidents/" + entityId;
                }

                yield return "system-status";
                break;
            case NotificationKind.ReauthNeeded:
                yield return "settings";
                break;
            default:
                yield return InboxPath;
                break;
        }
    }

    private static string? EntityIdFor(NotificationKind kind, IReadOnlyDictionary<string, string> data)
    {
        var keys = kind switch
        {
            NotificationKind.ChargeComplete => SessionIdKeys,
            NotificationKind.VehicleState => VehicleIdKeys,
            NotificationKind.SystemIncident => IncidentIdKeys,
            _ => GenericIdKeys,
        };

        foreach (var key in keys)
        {
            if (data.TryGetValue(key, out var value) && IsSafeSegment(value))
            {
                return value.Trim();
            }
        }

        return null;
    }

    private static bool IsReal(RouteRegistry registry, string? path) =>
        !string.IsNullOrWhiteSpace(path) && !registry.Resolve(path).Route.IsCatchAll;

    private static bool IsSafeSegment(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        foreach (var c in value.Trim())
        {
            if (!char.IsLetterOrDigit(c) && c != '-' && c != '_' && c != '.')
            {
                return false;
            }
        }

        return true;
    }
}
