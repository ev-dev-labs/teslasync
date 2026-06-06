using TeslaSync.App.Core.Navigation;

namespace TeslaSync.App.Core.Notifications;

/// <summary>
/// Builds the application's Windows jump list (P2/W8-0001) from the typed <see cref="RouteRegistry"/>:
/// the curated set of primary destinations — Dashboard, Vehicles, Charging, Drives, Live Map,
/// Notifications Inbox, Settings and Search — each resolved to a real, non-parameterized W3 route and
/// rendered as a localized task with a <c>teslasync://app/…</c> deep-link argument. Because every entry
/// is looked up by name in the live registry, a jump-list task can never point at a route that was
/// renamed or removed; an absent or parameterized route is simply skipped. Pure and headless so the
/// entries (routes, labels, deep links) are unit-tested without the shell.
/// </summary>
public static class JumpListBuilder
{
    /// <summary>The ordered route names that surface as jump-list tasks.</summary>
    public static IReadOnlyList<string> RouteNames { get; } = new[]
    {
        "Dashboard",
        "Vehicles",
        "Charging",
        "Drives",
        "LiveMap",
        "NotificationsInbox",
        "Settings",
        "Search",
    };

    /// <summary>Builds the jump-list entries against <paramref name="registry"/>, localized via <paramref name="localizer"/>.</summary>
    public static IReadOnlyList<JumpListEntry> Build(RouteRegistry registry, ILocalizer? localizer = null)
    {
        ArgumentNullException.ThrowIfNull(registry);
        localizer ??= PassthroughLocalizer.Instance;

        var group = localizer.GetString("jumplist.group.navigate", "Navigate");
        var entries = new List<JumpListEntry>(RouteNames.Count);

        foreach (var name in RouteNames)
        {
            var route = registry.ByName(name);
            if (route is null || route.IsCatchAll || route.IsRedirect || route.IsParameterized)
            {
                continue;
            }

            var path = RouteRegistry.Normalize(route.PathPattern);
            var fallback = string.IsNullOrEmpty(route.DefaultTitle) ? route.Name : route.DefaultTitle;
            var label = localizer.GetString(route.TitleKey ?? $"route.{name}", fallback);
            var arguments = DeepLink.BuildUri(path).ToString();

            entries.Add(new JumpListEntry(name, label, route.Glyph, arguments, group));
        }

        return entries;
    }
}
