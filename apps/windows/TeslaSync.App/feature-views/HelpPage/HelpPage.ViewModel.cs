using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>HelpPage</c> view — the native port of the web page's data
/// flow (web/src/features/system/pages/HelpPage.tsx). The web page binds no asynchronous hook (only
/// <c>useTranslation</c> + <c>usePageTitle</c> over the static curated catalog), so this holder performs no HTTP:
/// it projects the injected catalog through <see cref="HelpProjection"/> into the render-ready
/// <see cref="Display"/> and derives the link-region <see cref="State"/> (<see cref="HelpState.Success"/> vs the
/// defensive <see cref="HelpState.Empty"/>). <see cref="LoadAsync"/> / <see cref="RefreshAsync"/> honour the page
/// lifecycle contract (OnLoaded → LoadAsync) by re-resolving the projection — the native analogue of
/// react-i18next re-rendering after the active language changes — without fabricating a network call. Observable
/// so the view re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is
/// not internally synchronised.
/// </summary>
public sealed class HelpPageViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly IReadOnlyList<HelpLink> _catalog;
    private readonly HelpDiagnostics _diagnostics;

    private HelpDisplay _display;
    private HelpState _state;

    /// <summary>Creates the holder over an explicit localizer, optional catalog and optional diagnostics sink.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="catalog">The curated link catalog (defaults to <see cref="HelpLinkCatalog.Default"/>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public HelpPageViewModel(
        ILocalizer localizer,
        IReadOnlyList<HelpLink>? catalog = null,
        HelpDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _catalog = catalog ?? HelpLinkCatalog.Default;
        _diagnostics = diagnostics ?? new HelpDiagnostics();
        _display = HelpProjection.Project(new HelpModel(_catalog), _localizer);
        _state = _display.State;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive link-region state (success / defensive empty).</summary>
    public HelpState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public HelpDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>The localized page title (web <c>help.title</c>) — backs the header and the window title.</summary>
    public string Title => _display.Title;

    /// <summary>The localized framing intro paragraph (web <c>help.intro</c>).</summary>
    public string Intro => _display.Intro;

    /// <summary>The projected, localized curated link cards (empty in the defensive <see cref="HelpState.Empty"/> state).</summary>
    public IReadOnlyList<HelpLinkItem> Links => _display.Links;

    /// <summary>True when at least one curated link is available (web parity: the card grid renders).</summary>
    public bool HasLinks => _display.Links.Count > 0;

    /// <summary>The localized friendly empty-state message shown when no curated links are available (defensive).</summary>
    public string EmptyMessage => HelpRegistration.EmptyMessage(_localizer);

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
        var display = HelpProjection.Project(new HelpModel(_catalog), _localizer);
        Display = display;
        State = display.State;
        Raise(nameof(Title));
        Raise(nameof(Intro));
        Raise(nameof(Links));
        Raise(nameof(HasLinks));
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
