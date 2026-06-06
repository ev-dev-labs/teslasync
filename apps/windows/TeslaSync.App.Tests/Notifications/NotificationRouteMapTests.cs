using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Notifications;
using Xunit;

namespace TeslaSync.App.Tests.Notifications;

/// <summary>Verifies every notification kind maps to a real, deep-linkable W3 route (P2/W8-0001).</summary>
public sealed class NotificationRouteMapTests
{
    private static readonly RouteRegistry Registry = new();

    private static Dictionary<string, string> Data(params (string Key, string Value)[] pairs)
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var pair in pairs)
        {
            map[pair.Key] = pair.Value;
        }

        return map;
    }

    private static void AssertReal(string path) =>
        Assert.False(Registry.Resolve(path).Route.IsCatchAll, $"route '{path}' should resolve to a real page");

    [Fact]
    public void ChargeComplete_with_session_id_deep_links()
    {
        var resolved = NotificationRouteMap.Resolve(NotificationKind.ChargeComplete, Data(("session_id", "99")), Registry);
        Assert.Equal("charging/99", resolved.Path);
        Assert.Equal("99", resolved.EntityId);
        AssertReal(resolved.Path);
    }

    [Fact]
    public void ChargeComplete_without_id_lands_on_charging()
    {
        var resolved = NotificationRouteMap.Resolve(NotificationKind.ChargeComplete, Data(), Registry);
        Assert.Equal("charging", resolved.Path);
        AssertReal(resolved.Path);
    }

    [Fact]
    public void VehicleState_with_vehicle_id_deep_links()
    {
        var resolved = NotificationRouteMap.Resolve(NotificationKind.VehicleState, Data(("vehicle_id", "7")), Registry);
        Assert.Equal("vehicles/7", resolved.Path);
        AssertReal(resolved.Path);
    }

    [Fact]
    public void SystemIncident_with_id_deep_links()
    {
        var resolved = NotificationRouteMap.Resolve(NotificationKind.SystemIncident, Data(("incident_id", "5")), Registry);
        Assert.Equal("system-status/incidents/5", resolved.Path);
        AssertReal(resolved.Path);
    }

    [Theory]
    [InlineData(NotificationKind.Alert, "notifications/alerts")]
    [InlineData(NotificationKind.Automation, "automations")]
    [InlineData(NotificationKind.CommandResult, "command-history")]
    [InlineData(NotificationKind.SystemIncident, "system-status")]
    [InlineData(NotificationKind.ReauthNeeded, "settings")]
    [InlineData(NotificationKind.Generic, "notifications/inbox")]
    public void Kind_lands_on_expected_static_route(NotificationKind kind, string expected)
    {
        var resolved = NotificationRouteMap.Resolve(kind, new Dictionary<string, string>(), Registry);
        Assert.Equal(expected, resolved.Path);
        AssertReal(resolved.Path);
    }

    [Fact]
    public void Explicit_valid_route_is_honored()
    {
        var resolved = NotificationRouteMap.Resolve(NotificationKind.Generic, Data(("route", "energy")), Registry);
        Assert.Equal("energy", resolved.Path);
        AssertReal(resolved.Path);
    }

    [Fact]
    public void Explicit_invalid_route_is_ignored()
    {
        var resolved = NotificationRouteMap.Resolve(NotificationKind.ChargeComplete, Data(("route", "no-such-route-zzz")), Registry);
        Assert.Equal("charging", resolved.Path);
    }

    [Fact]
    public void Unsafe_entity_id_is_rejected()
    {
        var resolved = NotificationRouteMap.Resolve(NotificationKind.ChargeComplete, Data(("session_id", "../evil")), Registry);
        Assert.Equal("charging", resolved.Path);
        Assert.Null(resolved.EntityId);
    }

    [Fact]
    public void Every_kind_resolves_to_a_real_route()
    {
        foreach (var kind in Enum.GetValues<NotificationKind>())
        {
            AssertReal(NotificationRouteMap.Resolve(kind, new Dictionary<string, string>(), Registry).Path);
        }
    }
}
