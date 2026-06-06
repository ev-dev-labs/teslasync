using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Widgets;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Verifies the widget quick-action deep links resolve against the real W3 route registry, round-trip
/// back to their routes, and are skipped (not faked) when a destination route is absent.
/// </summary>
public sealed class WidgetDeepLinksTests
{
    private static readonly RouteRegistry Registry = new();

    [Fact]
    public void Vehicle_uri_targets_the_per_vehicle_route()
    {
        Assert.Equal("teslasync://app/vehicles/7", WidgetDeepLinks.VehicleUri(7, Registry));
    }

    [Fact]
    public void Static_uris_target_their_routes()
    {
        Assert.Equal("teslasync://app/charging", WidgetDeepLinks.ChargingUri(Registry));
        Assert.Equal("teslasync://app/live", WidgetDeepLinks.LiveMapUri(Registry));
        Assert.Equal("teslasync://app/commands", WidgetDeepLinks.CommandsUri(Registry));
    }

    [Fact]
    public void Vehicle_uri_round_trips_through_the_registry()
    {
        var uri = new Uri(WidgetDeepLinks.VehicleUri(7, Registry)!);

        Assert.True(DeepLink.TryActivate(uri, Registry, out var match));
        Assert.Equal("VehicleDetail", match.Route.Name);
        Assert.Equal("7", match.Param("id"));
        Assert.False(match.IsCatchAll);
    }

    [Fact]
    public void Actions_returns_the_four_quick_actions_in_order()
    {
        var actions = WidgetDeepLinks.Actions(7, Registry);

        Assert.Collection(
            actions,
            a => Assert.Equal(WidgetDeepLinks.OpenVehicleVerb, a.Verb),
            a => Assert.Equal(WidgetDeepLinks.OpenChargingVerb, a.Verb),
            a => Assert.Equal(WidgetDeepLinks.OpenLiveMapVerb, a.Verb),
            a => Assert.Equal(WidgetDeepLinks.OpenCommandsVerb, a.Verb));
        Assert.All(actions, a => Assert.StartsWith("teslasync://app/", a.Uri, StringComparison.Ordinal));
        Assert.All(actions, a => Assert.False(string.IsNullOrWhiteSpace(a.Title)));
    }

    [Fact]
    public void Missing_routes_are_skipped_rather_than_faked()
    {
        // A registry whose only routes are an index and the catch-all has none of the widget targets.
        var registry = new RouteRegistry(new[]
        {
            new RouteDefinition { Name = "Home", PathPattern = string.Empty },
            new RouteDefinition { Name = "CatchAll", PathPattern = "*", IsCatchAll = true },
        });

        Assert.Null(WidgetDeepLinks.ChargingUri(registry));
        Assert.Empty(WidgetDeepLinks.Actions(7, registry));
    }
}
