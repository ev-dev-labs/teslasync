using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>EnergyProductsPage</c> view — the native port of the web
/// page's top-level data flow (web/src/features/battery/pages/EnergyProductsPage.tsx). It consumes the
/// cache-then-network <see cref="IEnergyProductsSource"/> (the native <c>useTeslaEnergySites</c> +
/// <c>useRefreshTeslaEnergySites</c> hooks), projects the snapshot through <see cref="EnergyProductsProjection"/>
/// into the header + four summary stat cards, reconciles one <see cref="EnergySiteCardViewModel"/> per site
/// (keyed by site id so a refresh preserves each card's loaded configuration), and exposes the
/// mutually-exclusive <see cref="State"/> plus the header freshness flags so the view is a thin renderer.
/// Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class EnergyProductsPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IEnergyProductsSource _source;
    private readonly IEnergySiteInfoSource _siteInfoSource;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly EnergyProductsDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private EnergyProductsState _state = EnergyProductsState.Loading;
    private EnergyProductsDisplay _display;
    private IReadOnlyList<EnergySiteCardViewModel> _cards = Array.Empty<EnergySiteCardViewModel>();
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;

    /// <summary>Creates the holder over its list source, the shared site-info source, localizer and (optional) clock.</summary>
    /// <param name="source">The cache-then-network energy-sites list port (native <c>useTeslaEnergySites</c>).</param>
    /// <param name="siteInfoSource">The shared per-site configuration port handed to each card.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic freshness in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public EnergyProductsPageViewModel(
        IEnergyProductsSource source,
        IEnergySiteInfoSource siteInfoSource,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        EnergyProductsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(siteInfoSource);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _siteInfoSource = siteInfoSource;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new EnergyProductsDiagnostics();
        _display = EnergyProductsProjection.Project(EnergyProductsSnapshot.Empty, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / loaded / empty / error / stale / offline).</summary>
    public EnergyProductsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected header + four summary stat cards the view binds to.</summary>
    public EnergyProductsDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>One card holder per discovered site (web <c>sites.map(...)</c>), in snapshot order.</summary>
    public IReadOnlyList<EnergySiteCardViewModel> Cards
    {
        get => _cards;
        private set => Set(ref _cards, value);
    }

    /// <summary>Last successful update timestamp surfaced in the header freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background refresh is in flight (header chip pulses; web <c>refreshMutation.isPending</c>).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last read failed with no cached snapshot (drives the error banner; web <c>error</c>).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown snapshot is older than the freshness window (the 2-minute contract).</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Localized error message shown in the error banner.</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>The localized page title (web <c>energy.products.title</c>).</summary>
    public string Title => EnergyProductsRegistration.Title(_localizer);

    /// <summary>The localized page subtitle (web <c>energy.products.subtitle</c>).</summary>
    public string Subtitle => EnergyProductsRegistration.Subtitle(_localizer);

    /// <summary>True for the states where the summary stats and the site cards render (web truthy data).</summary>
    public bool HasContent =>
        _state is EnergyProductsState.Loaded or EnergyProductsState.Stale or EnergyProductsState.Offline;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Run a cache-then-network load of the energy-sites list: shows the skeleton only when nothing is already
    /// visible (otherwise keeps content while refreshing), folds every emission into <see cref="State"/> +
    /// <see cref="Display"/> + <see cref="Cards"/>. A superseding load cancels the prior one.
    /// </summary>
    public Task LoadAsync(CancellationToken cancellationToken = default) =>
        RunAsync(_source.StreamAsync, cancellationToken);

    /// <summary>Refresh the list from Tesla (web <c>refreshMutation.mutate()</c> → invalidate → refetch).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) =>
        RunAsync(_source.RefreshAsync, cancellationToken);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        var cts = Interlocked.Exchange(ref _cts, null);
        cts?.Cancel();
        cts?.Dispose();
        DisposeCards(_cards);
    }

    private async Task RunAsync(
        Func<CancellationToken, IAsyncEnumerable<RepositoryResult<EnergyProductsSnapshot>>> stream,
        CancellationToken cancellationToken)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        if (!HasContent)
        {
            SetLoading();
        }
        else
        {
            IsFetching = true;
        }

        try
        {
            await foreach (var result in stream(cts.Token).ConfigureAwait(false))
            {
                Apply(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    private void Apply(RepositoryResult<EnergyProductsSnapshot> result)
    {
        switch (result.Status)
        {
            case LoadStatus.Loading:
                if (!HasContent)
                {
                    SetLoading();
                }

                IsFetching = true;
                break;

            case LoadStatus.Cached:
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: true, error: null);
                break;

            case LoadStatus.Loaded:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplySnapshot(
        EnergyProductsSnapshot snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = EnergyProductsProjection.Project(snapshot, _localizer);
        ReconcileCards(snapshot.Sites);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline ? EnergyProductsState.Offline : stale ? EnergyProductsState.Stale : EnergyProductsState.Loaded;
    }

    // Reconcile the card holders against the new site list, keyed by EnergySiteId, so a refresh keeps each
    // card's already-loaded configuration (web keys EnergySiteCard by site.id). Cards no longer present are
    // disposed; the Cards reference is only re-published when the membership/order changes.
    private void ReconcileCards(IReadOnlyList<EnergySite> sites)
    {
        var existing = new Dictionary<long, EnergySiteCardViewModel>(_cards.Count);
        foreach (var card in _cards)
        {
            existing[card.EnergySiteId] = card;
        }

        var next = new List<EnergySiteCardViewModel>(sites.Count);
        bool changed = sites.Count != _cards.Count;

        for (int i = 0; i < sites.Count; i++)
        {
            var site = sites[i];
            if (existing.TryGetValue(site.EnergySiteId, out var card))
            {
                card.UpdateSite(site);
                if (i >= _cards.Count || !ReferenceEquals(_cards[i], card))
                {
                    changed = true;
                }
            }
            else
            {
                card = new EnergySiteCardViewModel(site, _siteInfoSource, _localizer, _clock);
                changed = true;
            }

            next.Add(card);
        }

        foreach (var card in _cards)
        {
            if (!next.Contains(card))
            {
                card.Dispose();
            }
        }

        if (changed)
        {
            Cards = next;
        }
    }

    private void SetLoading()
    {
        IsFetching = true;
        IsError = false;
        ErrorMessage = null;
        State = EnergyProductsState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = EnergyProductsProjection.Project(EnergyProductsSnapshot.Empty, _localizer);
        ReconcileCards(Array.Empty<EnergySite>());
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = EnergyProductsState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = EnergyProductsState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "energy.products.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "energy.products.error.offline",
            _ => "error.loadFailed",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view your energy products",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached energy products",
            _ => "Failed to load data",
        };

        return _localizer.GetString(key, fallback);
    }

    private static void DisposeCards(IReadOnlyList<EnergySiteCardViewModel> cards)
    {
        foreach (var card in cards)
        {
            card.Dispose();
        }
    }

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}

/// <summary>
/// UI-thread-free state holder backing one energy-site card and its configuration section — the native port
/// of the web <c>EnergySiteCard</c> + <c>SiteInfoSection</c> composition. It projects the already-resolved
/// <see cref="EnergySite"/> into the card display and consumes the cache-then-network
/// <see cref="IEnergySiteInfoSource"/> (the native <c>useTeslaEnergySiteInfo</c> +
/// <c>useRefreshTeslaEnergySiteInfo</c> hooks) for the site-configuration section, exposing the
/// mutually-exclusive <see cref="SiteInfoState"/> plus its freshness flags. Drive it from one confinement
/// (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class EnergySiteCardViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IEnergySiteInfoSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private EnergySite _site;
    private CancellationTokenSource? _cts;
    private RepositoryResult<EnergySiteInfo>? _last;
    private bool _disposed;

    private EnergySiteCardDisplay _cardDisplay;
    private EnergyProductsState _siteInfoState = EnergyProductsState.Loading;
    private EnergySiteInfoDisplay _siteInfoDisplay;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;

    /// <summary>Creates the holder over its already-resolved site, the shared site-info source and localizer.</summary>
    /// <param name="site">The site already resolved from the list read.</param>
    /// <param name="source">The cache-then-network per-site configuration port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic freshness in tests.</param>
    public EnergySiteCardViewModel(
        EnergySite site,
        IEnergySiteInfoSource source,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(site);
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _site = site;
        _source = source;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _cardDisplay = EnergyProductsProjection.ProjectCard(site, localizer);
        _siteInfoDisplay = EnergyProductsProjection.ProjectSiteInfo(EnergySiteInfo.Empty, site.TouCapable, localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The Tesla energy-site id this card represents (the reconciliation / web React key).</summary>
    public long EnergySiteId => _site.EnergySiteId;

    /// <summary>The projected card header, three stats and capability chips.</summary>
    public EnergySiteCardDisplay CardDisplay
    {
        get => _cardDisplay;
        private set => Set(ref _cardDisplay, value);
    }

    /// <summary>The current configuration-section data state (loading / loaded / empty / error / stale / offline).</summary>
    public EnergyProductsState SiteInfoState
    {
        get => _siteInfoState;
        private set => Set(ref _siteInfoState, value);
    }

    /// <summary>The projected configuration section the view binds to.</summary>
    public EnergySiteInfoDisplay SiteInfoDisplay
    {
        get => _siteInfoDisplay;
        private set => Set(ref _siteInfoDisplay, value);
    }

    /// <summary>Last successful site-info update timestamp surfaced in the section freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a site-info (re)fetch is in flight (web <c>refreshMutation.isPending</c>).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last site-info read failed with no cache.</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown configuration is older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Localized site-info error message.</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>True for the states where the configuration section renders its populated layout.</summary>
    public bool HasSiteInfoContent =>
        _siteInfoState is EnergyProductsState.Loaded or EnergyProductsState.Stale or EnergyProductsState.Offline;

    /// <summary>Re-point this card at a refreshed site row (re-projects the card; preserves loaded config).</summary>
    public void UpdateSite(EnergySite site)
    {
        ArgumentNullException.ThrowIfNull(site);
        _site = site;
        CardDisplay = EnergyProductsProjection.ProjectCard(site, _localizer);
        Reproject();
    }

    /// <summary>Run a cache-then-network load of this site's configuration (web <c>useTeslaEnergySiteInfo</c>).</summary>
    public Task LoadSiteInfoAsync(CancellationToken cancellationToken = default) =>
        RunAsync(ct => _source.StreamAsync(_site.EnergySiteId, ct), cancellationToken);

    /// <summary>Refresh this site's configuration from Tesla (web <c>useRefreshTeslaEnergySiteInfo</c>).</summary>
    public Task RefreshSiteInfoAsync(CancellationToken cancellationToken = default) =>
        RunAsync(ct => _source.RefreshAsync(_site.EnergySiteId, ct), cancellationToken);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        var cts = Interlocked.Exchange(ref _cts, null);
        cts?.Cancel();
        cts?.Dispose();
    }

    private async Task RunAsync(
        Func<CancellationToken, IAsyncEnumerable<RepositoryResult<EnergySiteInfo>>> stream,
        CancellationToken cancellationToken)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        if (!HasSiteInfoContent)
        {
            SetLoading();
        }
        else
        {
            IsFetching = true;
        }

        try
        {
            await foreach (var result in stream(cts.Token).ConfigureAwait(false))
            {
                Apply(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    private void Apply(RepositoryResult<EnergySiteInfo> result)
    {
        _last = result;
        switch (result.Status)
        {
            case LoadStatus.Loading:
                if (!HasSiteInfoContent)
                {
                    SetLoading();
                }

                IsFetching = true;
                break;

            case LoadStatus.Cached:
                ApplyInfo(result.Value!, result.FetchedAt, result.IsStale, fetching: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplyInfo(result.Value!, result.FetchedAt, result.IsStale, fetching: true, error: null);
                break;

            case LoadStatus.Loaded:
                ApplyInfo(result.Value!, result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplyInfo(result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplyInfo(
        EnergySiteInfo info,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        SiteInfoDisplay = EnergyProductsProjection.ProjectSiteInfo(info, _site.TouCapable, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        SiteInfoState = offline ? EnergyProductsState.Offline : stale ? EnergyProductsState.Stale : EnergyProductsState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { } last && last.HasValue)
        {
            Apply(last);
        }
        else
        {
            SiteInfoDisplay = EnergyProductsProjection.ProjectSiteInfo(EnergySiteInfo.Empty, _site.TouCapable, _localizer);
        }
    }

    private void SetLoading()
    {
        IsFetching = true;
        IsError = false;
        ErrorMessage = null;
        SiteInfoState = EnergyProductsState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        SiteInfoDisplay = EnergyProductsProjection.ProjectSiteInfo(EnergySiteInfo.Empty, _site.TouCapable, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        SiteInfoState = EnergyProductsState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        SiteInfoState = EnergyProductsState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "energy.siteInfo.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "energy.siteInfo.error.offline",
            _ => "error.loadFailed",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view this site's configuration",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached configuration",
            _ => "Failed to load data",
        };

        return _localizer.GetString(key, fallback);
    }

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
