using Microsoft.UI.Xaml;
using TeslaSync.App.Core.Navigation;

namespace TeslaSync.App.Shell;

/// <summary>
/// Resolves the content element for a matched route. Generated W7 page classes
/// register themselves here (by route name) and take precedence; until a route's page
/// module exists, the factory returns a <see cref="RoutePendingView"/> that surfaces
/// the live routing result rather than a fabricated page. This is the single seam
/// W7 plugs into — page bodies are deliberately out of scope for the W3 shell.
/// </summary>
internal sealed class ShellPageFactory
{
    private readonly Dictionary<string, Func<UIElement>> _factories = new(StringComparer.Ordinal);

    /// <summary>Register a content factory for a route name (idempotent — last registration wins).</summary>
    public void Register(string routeName, Func<UIElement> factory)
    {
        ArgumentException.ThrowIfNullOrEmpty(routeName);
        ArgumentNullException.ThrowIfNull(factory);
        _factories[routeName] = factory;
    }

    /// <summary>True when a real page (registered factory or route-level factory) exists for the route.</summary>
    public bool HasPage(RouteDefinition route)
    {
        ArgumentNullException.ThrowIfNull(route);
        return route.PageFactory is not null || _factories.ContainsKey(route.Name);
    }

    /// <summary>
    /// Create the content element for <paramref name="match"/>. Prefers a registered
    /// factory, then the route's own <see cref="RouteDefinition.PageFactory"/>, and
    /// otherwise falls back to the routing-result view.
    /// </summary>
    public UIElement Create(RouteMatch match)
    {
        var route = match.Route;

        if (_factories.TryGetValue(route.Name, out var registered))
        {
            return registered();
        }

        if (route.PageFactory?.Invoke() is UIElement element)
        {
            return element;
        }

        return new RoutePendingView(match);
    }
}
