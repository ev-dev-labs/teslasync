using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>StatusApiDocsPage</c> view — the native port of the web page's
/// data flow (web/src/features/system/pages/StatusApiDocsPage.tsx). The web page binds no asynchronous hook (it is
/// "Static content — no backend round-trip"), so this holder performs no HTTP: it projects the static endpoint
/// catalog through <see cref="StatusApiDocsProjection"/> into the render-ready <see cref="Display"/> and derives
/// the endpoint-region <see cref="State"/> (<see cref="StatusApiDocsState.Success"/> vs the defensive
/// <see cref="StatusApiDocsState.Empty"/>). <see cref="LoadAsync"/> / <see cref="RefreshAsync"/> honour the page
/// lifecycle contract (OnLoaded → LoadAsync) by re-resolving the projection — the native analogue of react-i18next
/// re-rendering after the active language changes — without fabricating a network call. Observable so the view
/// re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class StatusApiDocsPageViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly IReadOnlyList<StatusEndpoint> _catalog;
    private readonly StatusApiDocsDiagnostics _diagnostics;

    private StatusApiDocsDisplay _display;
    private StatusApiDocsState _state;

    /// <summary>Creates the holder over an explicit localizer, optional catalog and optional diagnostics sink.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="catalog">The documented endpoint catalog (defaults to <see cref="StatusApiEndpointCatalog.Default"/>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public StatusApiDocsPageViewModel(
        ILocalizer localizer,
        IReadOnlyList<StatusEndpoint>? catalog = null,
        StatusApiDocsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _catalog = catalog ?? StatusApiEndpointCatalog.Default;
        _diagnostics = diagnostics ?? new StatusApiDocsDiagnostics();
        _display = StatusApiDocsProjection.Project(new StatusApiDocsModel(_catalog), _localizer);
        _state = _display.State;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive endpoint-region state (success / defensive empty).</summary>
    public StatusApiDocsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public StatusApiDocsDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>The localized page title (web <c>PageContainer title</c>) — backs the header and the window title.</summary>
    public string Title => _display.Title;

    /// <summary>The localized page subtitle (web <c>PageContainer subtitle</c>).</summary>
    public string Subtitle => _display.Subtitle;

    /// <summary>The localized header back-link label (web the <c>ArrowLeft</c> "Back to System Status" link).</summary>
    public string BackLabel => _display.BackLabel;

    /// <summary>The projected, localized endpoint cards (empty in the defensive <see cref="StatusApiDocsState.Empty"/> state).</summary>
    public IReadOnlyList<StatusEndpointItem> Endpoints => _display.Endpoints;

    /// <summary>True when at least one endpoint is documented (web parity: the endpoint cards render).</summary>
    public bool HasEndpoints => _display.Endpoints.Count > 0;

    /// <summary>The localized friendly empty-state message shown when no endpoints are documented (defensive).</summary>
    public string EmptyMessage => StatusApiDocsRegistration.EmptyMessage(_localizer);

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Resolve (or re-resolve) the page's render state. The web page has no async data source, so this completes
    /// synchronously after re-projecting the static catalog through the localizer — honouring the page lifecycle
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
    /// re-rendering the copy after the active language changes. Raises change notifications so the view re-renders
    /// without being reconstructed.
    /// </summary>
    public void Reload() => Reproject();

    private void Reproject()
    {
        var display = StatusApiDocsProjection.Project(new StatusApiDocsModel(_catalog), _localizer);
        Display = display;
        State = display.State;
        Raise(nameof(Title));
        Raise(nameof(Subtitle));
        Raise(nameof(BackLabel));
        Raise(nameof(Endpoints));
        Raise(nameof(HasEndpoints));
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
