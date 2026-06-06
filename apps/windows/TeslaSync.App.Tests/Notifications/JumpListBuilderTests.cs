using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Notifications;
using Xunit;

namespace TeslaSync.App.Tests.Notifications;

/// <summary>Verifies the jump list is built from real, deep-linkable W3 routes (P2/W8-0001).</summary>
public sealed class JumpListBuilderTests
{
    private static readonly RouteRegistry Registry = new();

    [Fact]
    public void Builds_an_entry_for_every_curated_route()
    {
        var entries = JumpListBuilder.Build(Registry);
        Assert.Equal(JumpListBuilder.RouteNames.Count, entries.Count);
        Assert.Equal(JumpListBuilder.RouteNames, entries.Select(e => e.RouteName).ToList());
    }

    [Fact]
    public void Includes_all_required_destinations()
    {
        var names = JumpListBuilder.Build(Registry).Select(e => e.RouteName).ToList();
        foreach (var required in new[] { "Dashboard", "Vehicles", "Charging", "Drives", "LiveMap", "NotificationsInbox", "Settings", "Search" })
        {
            Assert.Contains(required, names);
        }
    }

    [Fact]
    public void Every_entry_deep_links_to_a_real_route()
    {
        foreach (var entry in JumpListBuilder.Build(Registry))
        {
            Assert.StartsWith("teslasync://", entry.Arguments, StringComparison.Ordinal);
            var path = DeepLink.PathFromUri(new Uri(entry.Arguments));
            Assert.False(Registry.Resolve(path).Route.IsCatchAll, $"'{entry.RouteName}' must resolve to a real page");
        }
    }

    [Fact]
    public void Dashboard_entry_targets_the_index_route()
    {
        var dashboard = JumpListBuilder.Build(Registry).Single(e => e.RouteName == "Dashboard");
        var path = DeepLink.PathFromUri(new Uri(dashboard.Arguments));

        Assert.Equal(string.Empty, path);
        Assert.Equal("Dashboard", Registry.Resolve(path).Route.Name);
    }

    [Fact]
    public void Labels_are_localized()
    {
        var localizer = new RecordingLocalizer(new Dictionary<string, string> { ["route.NotificationsInbox"] = "Inbox FR" });
        var inbox = JumpListBuilder.Build(Registry, localizer).Single(e => e.RouteName == "NotificationsInbox");

        Assert.Equal("Inbox FR", inbox.Label);
    }
}
