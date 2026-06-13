using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="NotFoundPage"/> view — the native port of the web
/// catch-all page (web/src/features/system/pages/NotFoundPage.tsx). The web component is presentational: it reads
/// <c>useTranslation</c> for its copy, <c>useLocation</c> for the unmatched path, <c>useNavigate</c> /
/// <c>window.history</c> for the escape hatches, computes the closest routes with <c>closestRoutes</c> (a
/// <c>useMemo</c>), and logs the unmatched path on mount; it performs no data fetch of its own. This holder
/// reproduces that exactly: it projects the render-ready <see cref="Display"/> once from the unmatched path,
/// the route table and the bound i18n facade; emits the operational 404 diagnostic on <see cref="MarkShown"/>
/// (idempotently, so a re-entrant Loaded never double-counts, mirroring the web mount-time
/// <c>console.warn('[404]', path)</c>); and on each escape hatch records the activation and asks the bound
/// <see cref="INotFoundNavigator"/> to perform the navigation. Because the web source performs no asynchronous
/// read it has no loading / error / empty branch to model — the surface always renders its single success state.
/// Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class NotFoundPageViewModel
{
    private readonly INotFoundNavigator _navigator;
    private readonly NotFoundDiagnostics _diagnostics;
    private bool _shown;

    /// <summary>
    /// Creates the holder over its navigation port, i18n facade, the unmatched path, the route table searched for
    /// suggestions and (optional) diagnostics. The render-ready <see cref="Display"/> is projected once here
    /// (mirroring the web component resolving its copy + <c>closestRoutes</c> memo at render time).
    /// </summary>
    /// <param name="navigator">The navigation port the escape hatches are dispatched through.</param>
    /// <param name="localizer">The i18n facade every visible label resolves through.</param>
    /// <param name="unmatchedPath">The unmatched path the page was reached with (web <c>location.pathname</c>).</param>
    /// <param name="routes">The route table searched for suggestions (defaults to <see cref="RouteTable.All"/>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the 404 / navigation events.</param>
    public NotFoundPageViewModel(
        INotFoundNavigator navigator,
        ILocalizer localizer,
        string? unmatchedPath = null,
        IReadOnlyList<RouteDefinition>? routes = null,
        NotFoundDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(navigator);
        ArgumentNullException.ThrowIfNull(localizer);

        _navigator = navigator;
        _diagnostics = diagnostics ?? new NotFoundDiagnostics();
        UnmatchedPath = (unmatchedPath ?? string.Empty).Trim();
        Display = NotFoundProjection.Project(UnmatchedPath, routes ?? RouteTable.All, localizer);
    }

    /// <summary>The render-ready 404 surface (localized copy + ranked suggestions + Narrator name).</summary>
    public NotFoundDisplay Display { get; }

    /// <summary>The unmatched path the page was reached with (web <c>location.pathname</c>).</summary>
    public string UnmatchedPath { get; }

    /// <summary>True once the surface has emitted its <c>notfound.shown</c> diagnostic.</summary>
    public bool HasShown => _shown;

    /// <summary>
    /// Mark the surface shown: emit the operational 404 diagnostic with the unmatched path (web mount-time
    /// <c>console.warn('[404]', path)</c>). Idempotent — a re-entrant Loaded is a no-op so the surface is counted
    /// exactly once per mount.
    /// </summary>
    public void MarkShown()
    {
        if (_shown)
        {
            return;
        }

        _shown = true;
        _diagnostics.RecordShown(Display.UnmatchedPath);
    }

    /// <summary>Dispatch the "Go back" escape hatch (web <c>window.history.back()</c>).</summary>
    public void GoBack()
    {
        _diagnostics.RecordNavigation("back");
        _navigator.GoBack();
    }

    /// <summary>Dispatch the "Go to dashboard" escape hatch (web <c>navigate('/')</c>).</summary>
    public void GoToDashboard()
    {
        _diagnostics.RecordNavigation("dashboard");
        _navigator.GoToDashboard();
    }

    /// <summary>Dispatch the "Open command palette" escape hatch (web <c>dispatchEvent('toggle-command-palette')</c>).</summary>
    public void OpenCommandPalette()
    {
        _diagnostics.RecordNavigation("command-palette");
        _navigator.OpenCommandPalette();
    }

    /// <summary>Dispatch a suggestion navigation (web <c>&lt;Link to={s.path}&gt;</c>).</summary>
    /// <param name="path">The suggestion's display path (e.g. <c>/vehicles</c>).</param>
    public void NavigateToSuggestion(string path)
    {
        ArgumentException.ThrowIfNullOrEmpty(path);
        _diagnostics.RecordNavigation(path);
        _navigator.NavigateTo(path);
    }
}
