using TeslaSync.App.Core.Navigation;
using Xunit;

namespace TeslaSync.App.Tests;

/// <summary>
/// Routing-rule tests for the W3 shell: route-table completeness vs
/// <c>web/src/App.tsx</c>, static/parameter/catch-all matching, parameter
/// extraction, redirect following, deep-link round-tripping, the back/forward
/// stack, the recent-pages recorder and scroll restoration.
/// </summary>
public sealed class NavigationTests
{
    private static readonly RouteRegistry Registry = new();

    [Fact]
    public void Table_ContainsSingleCatchAll()
    {
        Assert.Single(RouteTable.All, r => r.IsCatchAll);
    }

    [Theory]
    // Every route group present in App.tsx is represented at least once.
    [InlineData("")]
    [InlineData("explore")]
    [InlineData("vehicles")]
    [InlineData("digital-twin")]
    [InlineData("charging")]
    [InlineData("drives")]
    [InlineData("trips")]
    [InlineData("energy")]
    [InlineData("battery")]
    [InlineData("analytics")]
    [InlineData("live")]
    [InlineData("locations")]
    [InlineData("geofences")]
    [InlineData("climate-control")]
    [InlineData("tire-pressure")]
    [InlineData("automations")]
    [InlineData("notifications/inbox")]
    [InlineData("signals")]
    [InlineData("anomaly-detection")]
    [InlineData("db-health")]
    [InlineData("dev-tools")]
    [InlineData("power/sql")]
    [InlineData("system-status")]
    [InlineData("settings")]
    [InlineData("account/2fa")]
    [InlineData("integrations/helix")]
    [InlineData("sharing/trips")]
    [InlineData("search")]
    public void Match_KnownStaticRoutes_ResolveToThemselves(string path)
    {
        var match = Registry.Match(path);
        Assert.False(match.IsCatchAll);
        Assert.Equal(RouteRegistry.Normalize(path), match.MatchedPath);
        Assert.False(match.Route.IsParameterized);
    }

    [Fact]
    public void Match_Index_ResolvesToDashboard()
    {
        Assert.Equal("Dashboard", Registry.Match("/").Route.Name);
        Assert.Equal("Dashboard", Registry.Match("").Route.Name);
    }

    [Theory]
    [InlineData("vehicles/42", "VehicleDetail", "id", "42")]
    [InlineData("vehicles/42/access", "VehicleAccess", "id", "42")]
    [InlineData("drives/7", "DriveDetail", "id", "7")]
    [InlineData("drives/7/replay", "TripReplay", "id", "7")]
    [InlineData("charging/9", "ChargeDetail", "id", "9")]
    [InlineData("trips/3", "TripDetail", "id", "3")]
    [InlineData("system-status/incidents/abc", "IncidentTimeline", "id", "abc")]
    [InlineData("s/tok123", "SharedDrive", "token", "tok123")]
    [InlineData("year-review/2025", "YearReview", "year", "2025")]
    [InlineData("automations/5/edit", "AutomationBuilder", "id", "5")]
    public void Match_ParameterRoutes_ExtractParams(string path, string name, string key, string value)
    {
        var match = Registry.Match(path);
        Assert.Equal(name, match.Route.Name);
        Assert.Equal(value, match.Param(key));
    }

    [Fact]
    public void Match_StaticBeatsParameter()
    {
        // "charging/curves" is a static alias and must win over "charging/:id".
        var match = Registry.Match("charging/curves");
        Assert.Equal("ChargingCurve", match.Route.Name);
        Assert.False(match.Route.IsParameterized);
    }

    [Fact]
    public void Match_VehicleAccess_PrefersTwoSegmentParamOverDetail()
    {
        var match = Registry.Match("vehicles/42/access");
        Assert.Equal("VehicleAccess", match.Route.Name);
    }

    [Theory]
    [InlineData("this/does/not/exist")]
    [InlineData("totally-unknown")]
    public void Match_UnknownPath_FallsToCatchAll(string path)
    {
        var match = Registry.Match(path);
        Assert.True(match.IsCatchAll);
        Assert.Equal("NotFound", match.Route.Name);
    }

    [Theory]
    [InlineData("alerts", "NotificationsAlerts")]
    [InlineData("alert-studio", "NotificationsStudio")]
    [InlineData("alert-rules", "NotificationsRules")]
    [InlineData("notifications", "NotificationsInbox")]
    [InlineData("analytics/lifetime", "LifetimeStats")]
    [InlineData("compare", "PeriodCompare")]
    [InlineData("analytics/compare", "PeriodCompare")]
    [InlineData("admin", "SystemStatus")]
    public void Resolve_FollowsRedirects(string path, string terminalName)
    {
        var match = Registry.Resolve(path);
        Assert.Equal(terminalName, match.Route.Name);
        Assert.False(match.Route.IsRedirect);
    }

    [Fact]
    public void Match_RedirectRoute_IsNotFollowedByMatch()
    {
        var match = Registry.Match("compare");
        Assert.True(match.Route.IsRedirect);
        Assert.Equal("period-compare", match.Route.RedirectTo);
    }

    [Fact]
    public void BuildPath_SubstitutesParameters()
    {
        var route = Registry.ByName("VehicleDetail")!;
        var path = RouteRegistry.BuildPath(route, new Dictionary<string, string> { ["id"] = "88" });
        Assert.Equal("vehicles/88", path);
    }

    [Fact]
    public void BuildPath_MissingParameter_Throws()
    {
        var route = Registry.ByName("VehicleDetail")!;
        Assert.Throws<ArgumentException>(() => RouteRegistry.BuildPath(route));
    }

    [Theory]
    [InlineData("teslasync://app/vehicles/42", "vehicles/42")]
    [InlineData("teslasync://vehicles/42", "vehicles/42")]
    [InlineData("teslasync://app/", "")]
    [InlineData("https://teslasync.example.com/charging/9?tab=curve", "charging/9")]
    public void DeepLink_PathFromUri_Normalizes(string uri, string expected)
    {
        Assert.Equal(expected, DeepLink.PathFromUri(new Uri(uri)));
    }

    [Fact]
    public void DeepLink_TryActivate_ResolvesRouteAndParams()
    {
        Assert.True(DeepLink.TryActivate(new Uri("teslasync://app/drives/12/replay"), Registry, out var match));
        Assert.Equal("TripReplay", match.Route.Name);
        Assert.Equal("12", match.Param("id"));
    }

    [Fact]
    public void DeepLink_TryActivate_NullUri_ReturnsFalse()
    {
        Assert.False(DeepLink.TryActivate(null, Registry, out _));
    }

    [Fact]
    public void DeepLink_BuildUri_RoundTrips()
    {
        var route = Registry.ByName("TripDetail")!;
        var uri = DeepLink.BuildUri(route, new Dictionary<string, string> { ["id"] = "55" });
        Assert.Equal("teslasync", uri.Scheme);
        Assert.Equal("trips/55", DeepLink.PathFromUri(uri));
    }

    [Fact]
    public void NavigationHistory_PushBackForward()
    {
        var h = new NavigationHistory();
        h.Push("vehicles");
        h.Push("vehicles/1");
        h.Push("charging");

        Assert.Equal("charging", h.Current);
        Assert.True(h.CanGoBack);
        Assert.False(h.CanGoForward);

        Assert.Equal("vehicles/1", h.Back());
        Assert.Equal("vehicles", h.Back());
        Assert.False(h.CanGoBack);
        Assert.Equal("vehicles/1", h.Forward());
    }

    [Fact]
    public void NavigationHistory_PushTruncatesForward()
    {
        var h = new NavigationHistory();
        h.Push("a");
        h.Push("b");
        h.Push("c");
        h.Back(); // at "b"
        h.Push("d"); // truncates "c"

        Assert.Equal("d", h.Current);
        Assert.False(h.CanGoForward);
        Assert.Equal(new[] { "a", "b", "d" }, h.Entries);
    }

    [Fact]
    public void NavigationHistory_IgnoresAdjacentDuplicate()
    {
        var h = new NavigationHistory();
        h.Push("a");
        h.Push("a");
        Assert.Equal(1, h.Count);
    }

    [Fact]
    public void NavigationHistory_RespectsCapacity()
    {
        var h = new NavigationHistory(capacity: 2);
        h.Push("a");
        h.Push("b");
        h.Push("c");
        Assert.Equal(2, h.Count);
        Assert.Equal(new[] { "b", "c" }, h.Entries);
        Assert.Equal("c", h.Current);
    }

    [Fact]
    public void RecentPages_DeduplicatesAndOrders()
    {
        var r = new RecentPages(capacity: 3);
        r.Record("vehicles", "Vehicles");
        r.Record("charging", "Charging");
        r.Record("vehicles", "Vehicles"); // moves to front

        Assert.Equal(2, r.Items.Count);
        Assert.Equal("vehicles", r.Items[0].Path);
        Assert.Equal("charging", r.Items[1].Path);
    }

    [Fact]
    public void RecentPages_EvictsLeastRecent()
    {
        var r = new RecentPages(capacity: 2);
        r.Record("a", "A");
        r.Record("b", "B");
        r.Record("c", "C");

        Assert.Equal(2, r.Items.Count);
        Assert.Equal(new[] { "c", "b" }, r.Items.Select(i => i.Path).ToArray());
    }

    [Fact]
    public void ScrollRestoration_SavesAndRestores()
    {
        var s = new ScrollRestoration();
        Assert.Equal(0, s.Restore("vehicles"));
        s.Save("vehicles", 420);
        Assert.Equal(420, s.Restore("vehicles"));
        Assert.True(s.HasOffset("vehicles"));
        s.Forget("vehicles");
        Assert.Equal(0, s.Restore("vehicles"));
    }

    [Fact]
    public void RouteGroups_CoverEveryGroupUsedByRoutes()
    {
        var groupsWithInfo = RouteGroups.Ordered.Select(g => g.Group).ToHashSet();
        var usedGroups = RouteTable.All
            .Where(r => r.Group != RouteGroup.None)
            .Select(r => r.Group)
            .Distinct();

        foreach (var group in usedGroups)
        {
            Assert.Contains(group, groupsWithInfo);
        }
    }

    [Fact]
    public void NavigableRoutes_AreVisibleNonRedirectNonCatchAll()
    {
        Assert.All(Registry.NavigableRoutes, r =>
        {
            Assert.True(r.ShowInNav);
            Assert.False(r.IsRedirect);
            Assert.False(r.IsCatchAll);
        });
        Assert.NotEmpty(Registry.RoutesInGroup(RouteGroup.Vehicles));
    }
}
