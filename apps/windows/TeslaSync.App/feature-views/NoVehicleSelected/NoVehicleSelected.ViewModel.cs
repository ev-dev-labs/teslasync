using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="NoVehicleSelected"/> view — the native port of the
/// web component (web/src/features/onboarding/components/NoVehicleSelected.tsx). The web component is a
/// presentational empty state: it reads <c>useTranslation</c> for its copy and <c>useNavigate</c> for the
/// call-to-action, takes <c>pageTitle</c> / <c>title</c> / <c>description</c> as props, and performs no data
/// fetch of its own (the selected-vehicle check that decides whether to render it lives in the parent page /
/// <c>OnboardingGate</c>, not here). This holder reproduces that exactly: it projects the render-ready
/// <see cref="Display"/> once from the supplied page title and optional copy overrides (resolving the i18n
/// copy through the bound facade), emits the <c>view.opened</c> diagnostic on <see cref="MarkOpened"/>
/// (idempotently, so a re-entrant Loaded never double-counts), and on <see cref="RequestSetup"/> emits the
/// activation diagnostic and asks the bound <see cref="INoVehicleSelectedNavigator"/> to open the onboarding
/// flow. Because the web source performs no asynchronous read it has no loading / error / stale / offline
/// branch to model — the surface <em>is</em> the empty state a data-backed page renders when no vehicle is
/// selected. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class NoVehicleSelectedViewModel
{
    private readonly INoVehicleSelectedNavigator _navigator;
    private readonly NoVehicleSelectedDiagnostics _diagnostics;
    private bool _opened;

    /// <summary>
    /// Creates the holder over its navigation port, i18n facade, the page title, optional copy overrides and
    /// (optional) diagnostics. The render-ready <see cref="Display"/> is projected once here (mirroring the web
    /// component resolving its copy at render time).
    /// </summary>
    /// <param name="navigator">The navigation port the call-to-action is dispatched through.</param>
    /// <param name="localizer">The i18n facade the visible copy resolves through.</param>
    /// <param name="pageTitle">The localized page title forwarded to the scaffold (web <c>pageTitle</c> prop).</param>
    /// <param name="title">An explicit empty-state title (web <c>title</c> prop), or null for the i18n copy.</param>
    /// <param name="description">An explicit empty-state message (web <c>description</c> prop), or null for the i18n copy.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> / activation events.</param>
    public NoVehicleSelectedViewModel(
        INoVehicleSelectedNavigator navigator,
        ILocalizer localizer,
        string pageTitle,
        string? title = null,
        string? description = null,
        NoVehicleSelectedDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(navigator);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(pageTitle);

        _navigator = navigator;
        _diagnostics = diagnostics ?? new NoVehicleSelectedDiagnostics();
        Display = NoVehicleSelectedProjection.ProjectDisplay(pageTitle, title, description, localizer);
    }

    /// <summary>The render-ready empty-state surface (page title + localized copy + Narrator name).</summary>
    public NoVehicleSelectedDisplay Display { get; }

    /// <summary>True once the surface has emitted its <c>view.opened</c> diagnostic.</summary>
    public bool HasOpened => _opened;

    /// <summary>
    /// Mark the surface opened: emit the <c>view.opened</c> diagnostic. Idempotent — a re-entrant Loaded is a
    /// no-op so the surface is counted exactly once per mount.
    /// </summary>
    public void MarkOpened()
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    /// <summary>
    /// Dispatch the "Set up TeslaSync" call-to-action: emit the activation diagnostic and ask the navigator to
    /// open the onboarding flow (web <c>navigate('/onboarding')</c>).
    /// </summary>
    public void RequestSetup()
    {
        _diagnostics.RecordSetupRequested();
        _navigator.NavigateToOnboarding();
    }
}
