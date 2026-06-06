namespace TeslaSync.App.Core.Navigation;

/// <summary>
/// Left-pane navigation groups, ported one-for-one from the route groupings in
/// <c>web/src/App.tsx</c> (the comment headers above each block of <c>&lt;Route&gt;</c>
/// elements). The shell renders one <c>NavigationViewItemHeader</c> per group and
/// nests the group's routes beneath it.
/// </summary>
public enum RouteGroup
{
    /// <summary>Unassigned — used by redirects and the catch-all, never shown as a header.</summary>
    None = 0,

    /// <summary>Dashboard, Explore, Quick-stats, Glance.</summary>
    DashboardExplore,

    /// <summary>Vehicle list/detail/access and the digital twin.</summary>
    Vehicles,

    /// <summary>Charging sessions, curves, costs, heatmap, smart-charge, powershare.</summary>
    Charging,

    /// <summary>Trips and drives (lists, detail, replay, planner, scores, dynamics).</summary>
    TripsDriving,

    /// <summary>Battery health/cells/degradation and energy flow/products.</summary>
    BatteryEnergy,

    /// <summary>Analytics, statistics, compares, mileage, TCO, digests, timelines.</summary>
    Analytics,

    /// <summary>Live map, locations, geofences, navigation, temperature impact.</summary>
    MapsLocation,

    /// <summary>Climate, tires, maintenance, software, safety, guard, media.</summary>
    VehicleSystems,

    /// <summary>Automation list/builder routes.</summary>
    Automations,

    /// <summary>Alerts, notifications inbox/channels/rules and their legacy redirects.</summary>
    Notifications,

    /// <summary>Signal explorer/log/diff/gaps, live monitor, MQTT inspector, state debugger.</summary>
    TelemetrySignals,

    /// <summary>Anomaly detection and database-health diagnostics.</summary>
    Diagnostics,

    /// <summary>Admin surfaces, DevTools, API keys/logs, Tesla account integrations.</summary>
    AdminDevTools,

    /// <summary>Power-user SQL/Grafana/dashboards.</summary>
    PowerUser,

    /// <summary>System status, incidents, commands, exports, repair, search, activity.</summary>
    SystemOps,

    /// <summary>Settings, account security, integrations, backup.</summary>
    SettingsAccountIntegrations,

    /// <summary>Public share links and authenticated trip sharing.</summary>
    Sharing,

    /// <summary>First-run onboarding.</summary>
    Onboarding,

    /// <summary>Watch face and other standalone (no-chrome) surfaces.</summary>
    Standalone,
}

/// <summary>Presentation metadata for a <see cref="RouteGroup"/> (header label + icon glyph).</summary>
/// <param name="Group">The group this metadata describes.</param>
/// <param name="TitleKey">Resource key for the localized header label.</param>
/// <param name="DefaultTitle">English fallback used when the resource is missing.</param>
/// <param name="Glyph">Segoe Fluent Icons glyph for the group header.</param>
public readonly record struct RouteGroupInfo(RouteGroup Group, string TitleKey, string DefaultTitle, string Glyph);

/// <summary>
/// Static catalogue of <see cref="RouteGroupInfo"/> for every navigable
/// <see cref="RouteGroup"/>, in left-pane display order. <see cref="RouteGroup.None"/>
/// is intentionally excluded because redirects and the catch-all never surface
/// as headers.
/// </summary>
public static class RouteGroups
{
    /// <summary>Groups in the order the shell renders them in the navigation pane.</summary>
    public static IReadOnlyList<RouteGroupInfo> Ordered { get; } = new[]
    {
        new RouteGroupInfo(RouteGroup.DashboardExplore, "nav.group.dashboard", "Dashboard", "\uE80F"),
        new RouteGroupInfo(RouteGroup.Vehicles, "nav.group.vehicles", "Vehicles", "\uE804"),
        new RouteGroupInfo(RouteGroup.Charging, "nav.group.charging", "Charging", "\uE945"),
        new RouteGroupInfo(RouteGroup.TripsDriving, "nav.group.trips", "Trips & Driving", "\uE7C0"),
        new RouteGroupInfo(RouteGroup.BatteryEnergy, "nav.group.battery", "Battery & Energy", "\uE83E"),
        new RouteGroupInfo(RouteGroup.Analytics, "nav.group.analytics", "Analytics", "\uE9D9"),
        new RouteGroupInfo(RouteGroup.MapsLocation, "nav.group.maps", "Maps & Location", "\uE707"),
        new RouteGroupInfo(RouteGroup.VehicleSystems, "nav.group.systems", "Vehicle Systems", "\uE713"),
        new RouteGroupInfo(RouteGroup.Automations, "nav.group.automations", "Automations", "\uE945"),
        new RouteGroupInfo(RouteGroup.Notifications, "nav.group.notifications", "Notifications", "\uE7E7"),
        new RouteGroupInfo(RouteGroup.TelemetrySignals, "nav.group.telemetry", "Telemetry & Signals", "\uE9D2"),
        new RouteGroupInfo(RouteGroup.Diagnostics, "nav.group.diagnostics", "Diagnostics", "\uE9F5"),
        new RouteGroupInfo(RouteGroup.AdminDevTools, "nav.group.admin", "Admin & DevTools", "\uE90F"),
        new RouteGroupInfo(RouteGroup.PowerUser, "nav.group.power", "Power User", "\uE945"),
        new RouteGroupInfo(RouteGroup.SystemOps, "nav.group.system", "System & Ops", "\uE950"),
        new RouteGroupInfo(RouteGroup.SettingsAccountIntegrations, "nav.group.settings", "Settings & Account", "\uE713"),
        new RouteGroupInfo(RouteGroup.Sharing, "nav.group.sharing", "Sharing", "\uE72D"),
        new RouteGroupInfo(RouteGroup.Onboarding, "nav.group.onboarding", "Onboarding", "\uE8FB"),
        new RouteGroupInfo(RouteGroup.Standalone, "nav.group.standalone", "Standalone", "\uE7F4"),
    };

    private static readonly Dictionary<RouteGroup, RouteGroupInfo> ByGroup =
        Ordered.ToDictionary(g => g.Group);

    /// <summary>Look up the presentation metadata for a group; throws for <see cref="RouteGroup.None"/>.</summary>
    public static RouteGroupInfo Info(RouteGroup group) =>
        ByGroup.TryGetValue(group, out var info)
            ? info
            : throw new ArgumentOutOfRangeException(nameof(group), group, "No navigation header for this group.");
}
