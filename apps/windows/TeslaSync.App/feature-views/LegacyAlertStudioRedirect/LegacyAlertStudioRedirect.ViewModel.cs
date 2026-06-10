using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>LegacyAlertStudioRedirect</c> view — the native port of the web
/// component (web/src/features/notifications/components/LegacyAlertStudioRedirect.tsx). The web component is a
/// render-once redirect: it reads <c>useLocation().search</c> and returns <c>&lt;Navigate
/// to={`/notifications/studio${search}`} replace /&gt;</c>, which performs the navigation as a side effect of
/// rendering. This holder reproduces that exactly: it reads the current query from the bound
/// <see cref="ILegacyAlertStudioRedirectLocation"/> state holder, projects the render-ready
/// <see cref="Display"/> (so the view can draw a non-blank "redirecting" surface), and on <see cref="Run"/> emits
/// the <c>view.opened</c> diagnostic and asks the bound <see cref="ILegacyAlertStudioRedirectNavigator"/> to perform
/// the replace-navigation — exactly once, idempotently, so a re-entrant Loaded never double-navigates. There is no
/// fetch and therefore no loading / empty / error / stale / offline branch to model (the web source has none): the
/// surface is a single deterministic redirect. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class LegacyAlertStudioRedirectViewModel
{
    private readonly ILegacyAlertStudioRedirectNavigator _navigator;
    private readonly LegacyAlertStudioRedirectDiagnostics _diagnostics;
    private bool _redirected;

    /// <summary>
    /// Creates the holder over its current-location port, navigation port, i18n facade and (optional) diagnostics.
    /// The current query is read once here (mirroring the web component reading <c>useLocation().search</c> at
    /// render time) and projected into <see cref="Display"/>.
    /// </summary>
    /// <param name="location">The current-location port (the web <c>useLocation</c> seam) supplying the query string.</param>
    /// <param name="navigator">The navigation port the redirect is dispatched through.</param>
    /// <param name="localizer">The i18n facade the visible copy resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public LegacyAlertStudioRedirectViewModel(
        ILegacyAlertStudioRedirectLocation location,
        ILegacyAlertStudioRedirectNavigator navigator,
        ILocalizer localizer,
        LegacyAlertStudioRedirectDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(location);
        ArgumentNullException.ThrowIfNull(navigator);
        ArgumentNullException.ThrowIfNull(localizer);

        _navigator = navigator;
        _diagnostics = diagnostics ?? new LegacyAlertStudioRedirectDiagnostics();
        Display = LegacyAlertStudioRedirectProjection.ProjectDisplay(location.Search, localizer);
    }

    /// <summary>The render-ready redirect surface (target + localized title / message + Narrator name).</summary>
    public LegacyAlertStudioRedirectDisplay Display { get; }

    /// <summary>The resolved redirect intent (web <c>to</c> + <c>replace</c>).</summary>
    public LegacyAlertStudioRedirectTarget Target => Display.Target;

    /// <summary>True once the redirect has been dispatched (guards against a re-entrant <see cref="Run"/>).</summary>
    public bool HasRedirected => _redirected;

    /// <summary>
    /// Dispatch the redirect: emit the <c>view.opened</c> diagnostic and request the replace-navigation through the
    /// navigator. Idempotent — the web <c>&lt;Navigate&gt;</c> navigates once per mount, so a repeat call (a
    /// re-entrant Loaded) is a no-op.
    /// </summary>
    public void Run()
    {
        if (_redirected)
        {
            return;
        }

        _redirected = true;
        _diagnostics.RecordViewOpened();
        _navigator.Redirect(Display.Target);
    }
}
