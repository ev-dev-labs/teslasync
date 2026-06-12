using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native breadcrumb route-metadata table — the analogue of <c>ROUTE_META</c> in
/// <c>web/src/lib/routeMeta.ts</c>, derived from the same source of truth the web map is derived from. The web
/// <c>ROUTE_META</c> is built from <c>ROUTE_REGISTRY</c> (label + i18n key per route) overlaid with the
/// breadcrumb-only <c>PARENT_OVERRIDES</c>; this builder does exactly that for the native registry, projecting every
/// labelled <see cref="RouteDefinition"/> in <see cref="RouteTable.All"/> into a <see cref="BreadcrumbRouteMeta"/>
/// keyed by its path pattern and attaching the parent from <see cref="BreadcrumbParentChain"/>. Redirect entries
/// (which carry no label) are skipped — they are never a matched leaf nor a breadcrumb parent. Pure and headless.
/// </summary>
public static class DefaultBreadcrumbRouteMeta
{
    /// <summary>The breadcrumb metadata for every labelled route, keyed by path pattern (web <c>ROUTE_META</c>).</summary>
    public static IReadOnlyDictionary<string, BreadcrumbRouteMeta> Map { get; } = Build(RouteTable.All);

    /// <summary>
    /// Build the pattern → <see cref="BreadcrumbRouteMeta"/> lookup from <paramref name="routes"/>, attaching each
    /// route's breadcrumb parent (web <c>PARENT_OVERRIDES</c>). Routes without a title key (redirects) are skipped.
    /// </summary>
    /// <param name="routes">The route registry to project (web <c>ROUTE_REGISTRY</c>).</param>
    public static IReadOnlyDictionary<string, BreadcrumbRouteMeta> Build(IReadOnlyList<RouteDefinition> routes)
    {
        ArgumentNullException.ThrowIfNull(routes);

        var map = new Dictionary<string, BreadcrumbRouteMeta>(StringComparer.Ordinal);
        foreach (RouteDefinition route in routes)
        {
            if (route.TitleKey is null)
            {
                // Redirect entries carry no label; they are followed before a breadcrumb is ever drawn.
                continue;
            }

            string? parent = BreadcrumbParentChain.Patterns.TryGetValue(route.PathPattern, out string? p) ? p : null;
            map[route.PathPattern] = new BreadcrumbRouteMeta(route.PathPattern, route.TitleKey, route.DefaultTitle, parent);
        }

        return map;
    }
}

/// <summary>
/// The breadcrumb data adapter (P1/S8): projects a raw route path + the active override map into the resolved
/// breadcrumb trail — the native composition of route matching (web react-router) and <c>useBreadcrumbs</c>. It
/// matches the path against the <see cref="RouteRegistry"/> (the native router), then hands the matched pattern and
/// its extracted parameters to <see cref="BreadcrumbResolver"/> along with the route metadata. This is the seam the
/// adapter tests exercise (path → projection); the live view binds the same logic through
/// <see cref="LayoutBreadcrumbsViewModel"/>. Pure and headless.
/// </summary>
public sealed class RouteBreadcrumbProjector
{
    private readonly RouteRegistry _registry;
    private readonly IReadOnlyDictionary<string, BreadcrumbRouteMeta> _routeMeta;

    /// <summary>Creates the projector over the route registry and breadcrumb metadata (both default to the app registry).</summary>
    /// <param name="registry">The native router used to match paths; defaults to the full app registry.</param>
    /// <param name="routeMeta">The breadcrumb metadata lookup; defaults to <see cref="DefaultBreadcrumbRouteMeta.Map"/>.</param>
    public RouteBreadcrumbProjector(
        RouteRegistry? registry = null,
        IReadOnlyDictionary<string, BreadcrumbRouteMeta>? routeMeta = null)
    {
        _registry = registry ?? new RouteRegistry();
        _routeMeta = routeMeta ?? DefaultBreadcrumbRouteMeta.Map;
    }

    /// <summary>Resolve the breadcrumb trail for the raw <paramref name="path"/> with the given overrides.</summary>
    /// <param name="path">The current location path (web <c>location.pathname</c>).</param>
    /// <param name="overrides">Per-route label overrides keyed by pattern (web <c>useBreadcrumbOverrides</c>).</param>
    /// <param name="localizer">The i18n facade labels resolve through.</param>
    public IReadOnlyList<LayoutBreadcrumbItem> Project(
        string? path,
        IReadOnlyDictionary<string, string> overrides,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(overrides);
        ArgumentNullException.ThrowIfNull(localizer);

        RouteMatch match = _registry.Match(path);
        return BreadcrumbResolver.Resolve(match.Route.PathPattern, match.Parameters, overrides, _routeMeta, localizer);
    }
}

/// <summary>
/// The production matched-route context — adapts an <see cref="IRouteLocationSource"/> (the shared current-location
/// seam, the native <c>useLocation</c>) plus the <see cref="RouteRegistry"/> (the native router) into the
/// <see cref="IBreadcrumbRouteContext"/> the breadcrumb holder binds to. On every location change it matches the new
/// path to its pattern + parameters and re-raises <see cref="Changed"/>, so the holder re-resolves the trail exactly
/// when react-router would re-run <c>useBreadcrumbs</c>.
/// </summary>
public sealed class RouteRegistryBreadcrumbContext : IBreadcrumbRouteContext, IDisposable
{
    private static readonly IReadOnlyDictionary<string, string> Empty =
        new Dictionary<string, string>(0, StringComparer.Ordinal);

    private readonly IRouteLocationSource _location;
    private readonly RouteRegistry _registry;
    private string? _matchedPattern;
    private IReadOnlyDictionary<string, string> _parameters = Empty;
    private bool _disposed;

    /// <summary>Creates the context over the current-location seam and the route registry (defaults to the app registry).</summary>
    /// <param name="location">The current-location seam (web <c>useLocation</c>); the shell adapter supplies it.</param>
    /// <param name="registry">The native router used to match paths; defaults to the full app registry.</param>
    public RouteRegistryBreadcrumbContext(IRouteLocationSource location, RouteRegistry? registry = null)
    {
        ArgumentNullException.ThrowIfNull(location);

        _location = location;
        _registry = registry ?? new RouteRegistry();
        _location.Changed += OnLocationChanged;
        Recompute();
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public string? MatchedPattern => _matchedPattern;

    /// <inheritdoc />
    public IReadOnlyDictionary<string, string> Parameters => _parameters;

    private void OnLocationChanged(object? sender, EventArgs e)
    {
        if (_disposed)
        {
            return;
        }

        Recompute();
        Changed?.Invoke(this, EventArgs.Empty);
    }

    private void Recompute()
    {
        RouteMatch match = _registry.Match(_location.Path);
        _matchedPattern = match.Route.PathPattern;
        _parameters = match.Parameters;
    }

    /// <summary>Detach from the location seam (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _location.Changed -= OnLocationChanged;
    }
}

/// <summary>
/// A settable current-location seam — a concrete <see cref="IRouteLocationSource"/> the shell (or a test) drives by
/// calling <see cref="Navigate"/> as the active route changes. It is the native analogue of react-router pushing a
/// new <c>location.pathname</c>; the breadcrumb's <see cref="RouteRegistryBreadcrumbContext"/> observes it.
/// </summary>
public sealed class MutableRouteLocation : IRouteLocationSource
{
    private string _path;

    /// <summary>Creates the location at <paramref name="path"/> (defaults to the application root).</summary>
    /// <param name="path">The initial path.</param>
    public MutableRouteLocation(string path = "/") => _path = string.IsNullOrEmpty(path) ? "/" : path;

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public string Path => _path;

    /// <summary>Set the current path and notify observers (web navigation to a new pathname).</summary>
    /// <param name="path">The new path.</param>
    public void Navigate(string path)
    {
        _path = string.IsNullOrEmpty(path) ? "/" : path;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// A settable per-page override source — a concrete <see cref="IBreadcrumbOverrideSource"/> the layout drives as
/// pages register / unregister dynamic labels (the native analogue of the merged
/// <c>BreadcrumbOverridesContext</c> value). Pages push their resolved labels (for example a friendly drive name) up
/// through <see cref="Set"/>; the breadcrumb holder re-resolves on <see cref="IBreadcrumbOverrideSource.Changed"/>.
/// </summary>
public sealed class StaticBreadcrumbOverrideSource : IBreadcrumbOverrideSource
{
    private static readonly IReadOnlyDictionary<string, string> Empty =
        new Dictionary<string, string>(0, StringComparer.Ordinal);

    private IReadOnlyDictionary<string, string> _overrides;

    /// <summary>Creates the source over an initial override map (defaults to no overrides).</summary>
    /// <param name="overrides">The initial per-route override map keyed by pattern.</param>
    public StaticBreadcrumbOverrideSource(IReadOnlyDictionary<string, string>? overrides = null) =>
        _overrides = overrides ?? Empty;

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public IReadOnlyDictionary<string, string> OverrideLabels => _overrides;

    /// <summary>Replace the merged override map and notify observers (a page registered / unregistered labels).</summary>
    /// <param name="overrides">The new merged override map keyed by route pattern.</param>
    public void Set(IReadOnlyDictionary<string, string> overrides)
    {
        _overrides = overrides ?? Empty;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// The inert matched-route context used by the design-time / headless entry point — it never matches a route
/// (<see cref="MatchedPattern"/> is always <see langword="null"/>), so the holder resolves an empty trail and the
/// surface renders its suppressed (empty-slot) state, exactly like a top-level page in the web source. The
/// composition root supplies a real <see cref="RouteRegistryBreadcrumbContext"/>.
/// </summary>
public sealed class EmptyBreadcrumbRouteContext : IBreadcrumbRouteContext
{
    private static readonly IReadOnlyDictionary<string, string> NoParameters =
        new Dictionary<string, string>(0, StringComparer.Ordinal);

    /// <summary>The shared inert instance.</summary>
    public static EmptyBreadcrumbRouteContext Instance { get; } = new();

    private EmptyBreadcrumbRouteContext()
    {
    }

    /// <inheritdoc />
    public event EventHandler? Changed
    {
        add { }
        remove { }
    }

    /// <inheritdoc />
    public string? MatchedPattern => null;

    /// <inheritdoc />
    public IReadOnlyDictionary<string, string> Parameters => NoParameters;
}
