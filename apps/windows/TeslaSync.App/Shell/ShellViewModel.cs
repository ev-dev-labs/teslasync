using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using TeslaSync.App.Core.Navigation;

namespace TeslaSync.App.Shell;

/// <summary>
/// Observable state for the navigation shell: the current route's title/path, the
/// breadcrumb trail, back/forward availability, standalone-mode flag and the status
/// line. Owns the headless navigation services (<see cref="RouteRegistry"/>,
/// <see cref="NavigationHistory"/>, <see cref="RecentPages"/>,
/// <see cref="ScrollRestoration"/>) so the window stays a thin view over tested logic.
/// </summary>
internal sealed partial class ShellViewModel : ObservableObject
{
    /// <summary>The route registry (full route table from <c>web/src/App.tsx</c>).</summary>
    public RouteRegistry Registry { get; } = new();

    /// <summary>Back/forward navigation stack.</summary>
    public NavigationHistory History { get; } = new();

    /// <summary>Recent-page recorder backing the command palette / recents.</summary>
    public RecentPages Recent { get; } = new();

    /// <summary>Per-path scroll-offset store.</summary>
    public ScrollRestoration Scroll { get; } = new();

    /// <summary>Resolves content elements for matched routes.</summary>
    public ShellPageFactory PageFactory { get; } = new();

    /// <summary>The breadcrumb trail for the current route.</summary>
    public ObservableCollection<Crumb> Breadcrumbs { get; } = [];

    [ObservableProperty]
    private string _title = string.Empty;

    [ObservableProperty]
    private string _currentPath = string.Empty;

    [ObservableProperty]
    private bool _canGoBack;

    [ObservableProperty]
    private bool _canGoForward;

    [ObservableProperty]
    private bool _isStandalone;

    [ObservableProperty]
    private string _statusText = string.Empty;

    private RouteMatch _current;

    /// <summary>The most recently resolved route match.</summary>
    public RouteMatch Current => _current;

    /// <summary>
    /// Recompute every observable chrome property from <paramref name="match"/>. Does
    /// not touch the history stack — the window decides whether a navigation is a push,
    /// a back/forward replay or an initial load.
    /// </summary>
    public void UpdateForRoute(RouteMatch match)
    {
        _current = match;
        var route = match.Route;

        Title = Localization.Title(route);
        CurrentPath = match.MatchedPath;
        IsStandalone = route.ShellMode == ShellMode.Standalone;
        CanGoBack = History.CanGoBack;
        CanGoForward = History.CanGoForward;
        StatusText = BuildStatus(match);
        RebuildBreadcrumbs(match);
    }

    /// <summary>Record the current route as a visited page (newest-first, de-duplicated).</summary>
    public void RecordVisit() => Recent.Record(CurrentPath, Title);

    private void RebuildBreadcrumbs(RouteMatch match)
    {
        var segments = RouteDefinition.SplitSegments(match.MatchedPath);
        var parts = new List<(string Label, string Key)>(segments.Count + 1)
        {
            (Localization.Get("nav.home", "Home"), string.Empty),
        };

        var cumulative = string.Empty;
        foreach (var segment in segments)
        {
            cumulative = cumulative.Length == 0 ? segment : $"{cumulative}/{segment}";
            var crumbRoute = Registry.Match(cumulative).Route;
            var label = crumbRoute.IsCatchAll ? segment : Localization.Title(crumbRoute);
            parts.Add((label, cumulative));
        }

        Breadcrumbs.Clear();
        foreach (var crumb in BreadcrumbTrail.Build(parts))
        {
            Breadcrumbs.Add(crumb);
        }
    }

    private static string BuildStatus(RouteMatch match)
    {
        var path = "/" + match.MatchedPath;
        if (match.IsCatchAll)
        {
            return Localization.Get("shell.status.notFound", "No route matches") + " " + path;
        }

        var auth = match.Route.AuthRequired
            ? Localization.Get("shell.status.secured", "Secured")
            : Localization.Get("shell.status.public", "Public");

        return $"{path}  ·  {auth}";
    }
}
