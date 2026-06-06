namespace TeslaSync.App.Core.Notifications;

/// <summary>
/// The semantic class of a TeslaSync notification (P2/W8-0001). Every foreground push and inbox item
/// maps to exactly one kind, which drives the toast scenario, the deep-link route, the in-app banner
/// severity and the per-kind delivery toggle. The wire <c>kind</c>/<c>type</c> string from the backend
/// notification-worker envelope is normalized to a kind via <see cref="NotificationKinds.Parse"/>.
/// </summary>
public enum NotificationKind
{
    /// <summary>An unrecognized or generic notification (the safe default).</summary>
    Generic = 0,

    /// <summary>A user-configured alert rule fired (battery, geofence, speed, tire pressure, …).</summary>
    Alert,

    /// <summary>A charging session reached its target or otherwise completed.</summary>
    ChargeComplete,

    /// <summary>A vehicle changed drive / charge / park / sleep / online state.</summary>
    VehicleState,

    /// <summary>An automation rule executed and reported its outcome.</summary>
    Automation,

    /// <summary>The success or failure result of a vehicle command.</summary>
    CommandResult,

    /// <summary>A system or service incident was opened, updated or resolved.</summary>
    SystemIncident,

    /// <summary>The Tesla / Authentik session expired and needs re-authentication.</summary>
    ReauthNeeded,
}

/// <summary>
/// Maps between the backend notification <c>kind</c>/<c>type</c> wire strings and the typed
/// <see cref="NotificationKind"/> (P2/W8-0001). Parsing is tolerant and case-insensitive: an unknown,
/// empty or null wire value resolves to <see cref="NotificationKind.Generic"/> so a malformed push is
/// always classifiable. The canonical wire form is the lower-snake-case token the worker emits.
/// </summary>
public static class NotificationKinds
{
    private static readonly Dictionary<NotificationKind, string> WireByKind =
        new()
        {
            [NotificationKind.Generic] = "generic",
            [NotificationKind.Alert] = "alert",
            [NotificationKind.ChargeComplete] = "charge_complete",
            [NotificationKind.VehicleState] = "vehicle_state",
            [NotificationKind.Automation] = "automation",
            [NotificationKind.CommandResult] = "command_result",
            [NotificationKind.SystemIncident] = "system_incident",
            [NotificationKind.ReauthNeeded] = "reauth_needed",
        };

    private static readonly Dictionary<string, NotificationKind> KindByToken =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["generic"] = NotificationKind.Generic,
            ["info"] = NotificationKind.Generic,
            ["alert"] = NotificationKind.Alert,
            ["alerts"] = NotificationKind.Alert,
            ["alert_rule"] = NotificationKind.Alert,
            ["charge_complete"] = NotificationKind.ChargeComplete,
            ["charging_complete"] = NotificationKind.ChargeComplete,
            ["charge_done"] = NotificationKind.ChargeComplete,
            ["vehicle_state"] = NotificationKind.VehicleState,
            ["vehicle_state_change"] = NotificationKind.VehicleState,
            ["state_change"] = NotificationKind.VehicleState,
            ["fsm"] = NotificationKind.VehicleState,
            ["automation"] = NotificationKind.Automation,
            ["automation_event"] = NotificationKind.Automation,
            ["automation_run"] = NotificationKind.Automation,
            ["command_result"] = NotificationKind.CommandResult,
            ["command"] = NotificationKind.CommandResult,
            ["command_response"] = NotificationKind.CommandResult,
            ["system_incident"] = NotificationKind.SystemIncident,
            ["incident"] = NotificationKind.SystemIncident,
            ["system"] = NotificationKind.SystemIncident,
            ["reauth_needed"] = NotificationKind.ReauthNeeded,
            ["reauth"] = NotificationKind.ReauthNeeded,
            ["reauthentication"] = NotificationKind.ReauthNeeded,
            ["auth_required"] = NotificationKind.ReauthNeeded,
        };

    /// <summary>Normalizes a wire <paramref name="kind"/> token; unknown/empty resolves to <see cref="NotificationKind.Generic"/>.</summary>
    public static NotificationKind Parse(string? kind)
    {
        if (string.IsNullOrWhiteSpace(kind))
        {
            return NotificationKind.Generic;
        }

        return KindByToken.TryGetValue(kind.Trim(), out var parsed) ? parsed : NotificationKind.Generic;
    }

    /// <summary>The canonical lower-snake-case wire token for <paramref name="kind"/>.</summary>
    public static string ToWire(NotificationKind kind) =>
        WireByKind.TryGetValue(kind, out var token) ? token : "generic";
}
