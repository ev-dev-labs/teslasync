using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>RoadmapPage</c> view — the native port of the web page's data
/// flow (web/src/features/system/pages/RoadmapPage.tsx). The web page binds no asynchronous hook (only
/// <c>useTranslation</c> + <c>usePageTitle</c> over the static curated roadmap catalog), so this holder performs
/// no HTTP: it projects the injected catalog through <see cref="RoadmapProjection"/> into the render-ready
/// <see cref="Display"/> and derives the surface <see cref="State"/> (<see cref="RoadmapState.Success"/> vs the
/// defensive <see cref="RoadmapState.Empty"/>). <see cref="LoadAsync"/> / <see cref="RefreshAsync"/> honour the
/// page lifecycle contract (OnLoaded → LoadAsync) by re-resolving the projection — the native analogue of
/// react-i18next re-rendering after the active language changes — without fabricating a network call. Observable
/// so the view re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is
/// not internally synchronised.
/// </summary>
public sealed class RoadmapPageViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly RoadmapModel _model;
    private readonly RoadmapDiagnostics _diagnostics;

    private RoadmapDisplay _display;
    private RoadmapState _state;

    /// <summary>Creates the holder over an explicit localizer, optional catalog and optional diagnostics sink.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="catalog">The curated roadmap catalog (defaults to <see cref="RoadmapCatalog.Default"/>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public RoadmapPageViewModel(
        ILocalizer localizer,
        IReadOnlyList<RoadmapEntry>? catalog = null,
        RoadmapDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = new RoadmapModel(catalog ?? RoadmapCatalog.Default);
        _diagnostics = diagnostics ?? new RoadmapDiagnostics();
        _display = RoadmapProjection.Project(_model, _localizer);
        _state = _display.State;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state (success / defensive empty).</summary>
    public RoadmapState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public RoadmapDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>The localized page title (web <c>roadmap.title</c>) — backs the header and the window title.</summary>
    public string Title => _display.Title;

    /// <summary>The localized page subtitle (web <c>roadmap.subtitle</c>).</summary>
    public string Subtitle => _display.Subtitle;

    /// <summary>The four always-visible phase legend entries (web phase progress bar).</summary>
    public IReadOnlyList<RoadmapPhaseSummary> PhaseSummaries => _display.PhaseSummaries;

    /// <summary>The non-empty phase sections, in render order (web per-phase card grids).</summary>
    public IReadOnlyList<RoadmapPhaseGroup> Groups => _display.Groups;

    /// <summary>True when at least one roadmap entry is available (web parity: the phase sections render).</summary>
    public bool HasItems => _display.State == RoadmapState.Success;

    /// <summary>The localized friendly empty-state message shown when no entries are available (defensive).</summary>
    public string EmptyMessage => RoadmapRegistration.EmptyMessage(_localizer);

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Resolve (or re-resolve) the page's render state. The web page has no async data source, so this completes
    /// synchronously after re-projecting the curated catalog through the localizer — honouring the page lifecycle
    /// contract (OnLoaded → LoadAsync) without performing any network access.
    /// </summary>
    public Task LoadAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Reproject();
        return Task.CompletedTask;
    }

    /// <summary>Re-resolve the page's render state (web auto re-render / language change).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>
    /// Re-resolve every label from the localizer and re-derive the state — the native analogue of react-i18next
    /// re-rendering the titles after the active language changes. Raises change notifications so the view
    /// re-renders without being reconstructed.
    /// </summary>
    public void Reload() => Reproject();

    private void Reproject()
    {
        var display = RoadmapProjection.Project(_model, _localizer);
        Display = display;
        State = display.State;
        Raise(nameof(Title));
        Raise(nameof(Subtitle));
        Raise(nameof(PhaseSummaries));
        Raise(nameof(Groups));
        Raise(nameof(HasItems));
    }

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        Raise(name);
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
