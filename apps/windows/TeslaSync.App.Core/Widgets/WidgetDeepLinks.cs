using System.Globalization;
using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.Core.Widgets;

/// <summary>
/// One widget quick action: a stable verb, a localized title, and the <c>teslasync://app/…</c> deep
/// link the surface opens. The link is always a real, validated W3 route, so a quick action can never
/// point at a destination that was renamed or removed.
/// </summary>
/// <param name="Verb">The stable action verb (also the Adaptive Card data key suffix).</param>
/// <param name="Title">The localized action title.</param>
/// <param name="Uri">The custom-scheme deep link the action opens.</param>
public readonly record struct WidgetAction(string Verb, string Title, string Uri);

/// <summary>
/// Builds the widget's quick-action deep links (P2/W8-0003) by resolving named destinations against
/// the live W3 <see cref="RouteRegistry"/> — the same registry the shell and the jump list use — and
/// rendering each as a <c>teslasync://app/…</c> link via <see cref="DeepLink"/>. Opening a link
/// protocol-activates the app and lands on the page, so the widget never holds a background stream to
/// navigate. A destination that does not resolve (or whose required parameter is missing) is skipped
/// rather than emitted as a dead link. Pure and headless so the links are unit-tested without the shell.
/// </summary>
public static class WidgetDeepLinks
{
    /// <summary>Quick-action verb: open the vehicle detail page.</summary>
    public const string OpenVehicleVerb = "open-vehicle";

    /// <summary>Quick-action verb: open the charging page.</summary>
    public const string OpenChargingVerb = "open-charging";

    /// <summary>Quick-action verb: open the live map.</summary>
    public const string OpenLiveMapVerb = "open-live-map";

    /// <summary>Quick-action verb: open the commands page (lock / climate).</summary>
    public const string OpenCommandsVerb = "open-commands";

    /// <summary>Action verb the host invokes to request a foreground content refresh.</summary>
    public const string RefreshVerb = "refresh";

    /// <summary>The per-vehicle detail deep link, or <see langword="null"/> when the route is unavailable.</summary>
    public static string? VehicleUri(long vehicleId, RouteRegistry registry) =>
        BuildNamed(
            "VehicleDetail",
            registry,
            new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["id"] = vehicleId.ToString(CultureInfo.InvariantCulture),
            });

    /// <summary>The charging-page deep link, or <see langword="null"/> when unavailable.</summary>
    public static string? ChargingUri(RouteRegistry registry) => BuildNamed("Charging", registry);

    /// <summary>The live-map deep link, or <see langword="null"/> when unavailable.</summary>
    public static string? LiveMapUri(RouteRegistry registry) => BuildNamed("LiveMap", registry);

    /// <summary>The commands-page deep link, or <see langword="null"/> when unavailable.</summary>
    public static string? CommandsUri(RouteRegistry registry) => BuildNamed("Commands", registry);

    /// <summary>
    /// The ordered quick actions for a vehicle widget: open the vehicle, then charging, live map and
    /// commands. Only the actions whose route resolves are returned, each with a localized title.
    /// </summary>
    public static IReadOnlyList<WidgetAction> Actions(
        long vehicleId,
        RouteRegistry registry,
        ILocalizer? localizer = null)
    {
        ArgumentNullException.ThrowIfNull(registry);
        localizer ??= PassthroughLocalizer.Instance;

        var actions = new List<WidgetAction>(4);
        Add(actions, OpenVehicleVerb, "widget.action.openVehicle", "Open vehicle", VehicleUri(vehicleId, registry), localizer);
        Add(actions, OpenChargingVerb, "widget.action.openCharging", "Charging", ChargingUri(registry), localizer);
        Add(actions, OpenLiveMapVerb, "widget.action.openLiveMap", "Live map", LiveMapUri(registry), localizer);
        Add(actions, OpenCommandsVerb, "widget.action.openCommands", "Commands", CommandsUri(registry), localizer);
        return actions;
    }

    private static void Add(
        List<WidgetAction> actions,
        string verb,
        string titleKey,
        string fallbackTitle,
        string? uri,
        ILocalizer localizer)
    {
        if (string.IsNullOrEmpty(uri))
        {
            return;
        }

        actions.Add(new WidgetAction(verb, localizer.GetString(titleKey, fallbackTitle), uri));
    }

    private static string? BuildNamed(
        string routeName,
        RouteRegistry registry,
        IReadOnlyDictionary<string, string>? parameters = null)
    {
        ArgumentNullException.ThrowIfNull(registry);

        var route = registry.ByName(routeName);
        if (route is null || route.IsRedirect || route.IsCatchAll)
        {
            return null;
        }

        try
        {
            return DeepLink.BuildUri(route, parameters).ToString();
        }
        catch (ArgumentException)
        {
            // A required :param was not supplied — skip the action rather than emit a dead link.
            return null;
        }
    }
}
