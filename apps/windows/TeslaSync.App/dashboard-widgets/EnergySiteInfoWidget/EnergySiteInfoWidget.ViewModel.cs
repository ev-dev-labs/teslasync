using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="EnergySiteInfoViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed <see cref="EnergySiteInfoSnapshot"/> values — the native analogue
/// of the web component's composed <c>useTeslaEnergySites</c> + <c>useTeslaEnergySiteInfo</c> hooks. The view
/// never performs HTTP itself; the concrete <see cref="EnergySiteInfoSource"/> (or a test fake) drives this.
/// </summary>
public interface IEnergySiteInfoSource
{
    /// <summary>Stream the cache-then-network site-info snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<EnergySiteInfoSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Energy Site surface — the native mirror of the web registry entry in
/// web/src/features/dashboard/widgets/registry/energy.ts (id <c>energy-site-info</c>). The dashboard grid
/// system binds this surface with the same <see cref="Id"/> and honours the same size constraints. The
/// generated OpenAPI operation ids are centralized here so a single test asserts they resolve against the
/// generated endpoint table (catching contract drift at build/test time rather than at runtime).
/// </summary>
public static class EnergySiteInfoRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "energy-site-info";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "energy";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "EnergySiteInfoWidget";

    /// <summary>Generated operation id for the energy-sites list (web <c>useTeslaEnergySites</c>).</summary>
    public const string SitesOperationId = "get_api_v1_tesla_energy_sites";

    /// <summary>Generated operation id for a site's site-info (web <c>useTeslaEnergySiteInfo</c>).</summary>
    public const string SiteInfoOperationId = "get_api_v1_tesla_energy_sites_siteID_site_info";

    /// <summary>Path-parameter name in the site-info endpoint template.</summary>
    public const string SitePathParam = "siteID";

    /// <summary>Default footprint: 2 columns × 4 rows.</summary>
    public static EnergySiteInfoSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static EnergySiteInfoSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static EnergySiteInfoSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Energy Site", shared with the widget title key).</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.energySiteInfo.title", "Energy Site");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.energySiteInfo.description",
            "Tesla Energy system: solar capacity, Powerwall count, gateway firmware");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(EnergySiteInfoSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static EnergySiteInfoSize Clamp(EnergySiteInfoSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Energy Site surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a site id, firmware version, or
/// timezone — so a diagnostics line can never leak a home's energy-system fingerprint. Thread-safe.
/// </summary>
public sealed class EnergySiteInfoDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public EnergySiteInfoDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=EnergySiteInfoWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={EnergySiteInfoRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="EnergySiteInfoWidget"/> view — the native port
/// of the web component's two-hook composition (web/src/features/dashboard/widgets/EnergySiteInfoWidget.tsx).
/// It consumes the cache-then-network <see cref="IEnergySiteInfoSource"/>, projects each snapshot through
/// <see cref="EnergySiteInfoProjection"/>, and exposes the mutually-exclusive <see cref="State"/> (including
/// the two distinct empty surfaces <see cref="EnergySiteInfoState.NoSite"/> and
/// <see cref="EnergySiteInfoState.NoData"/>) plus the header freshness flags so the view is a thin renderer.
/// Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class EnergySiteInfoViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IEnergySiteInfoSource _source;
    private readonly ILocalizer _localizer;

    private EnergySiteInfoSize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<EnergySiteInfoSnapshot>? _last;
    private bool _disposed;

    private EnergySiteInfoState _state = EnergySiteInfoState.Loading;
    private EnergySiteInfoDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and footprint.</summary>
    public EnergySiteInfoViewModel(
        IEnergySiteInfoSource source,
        ILocalizer localizer,
        EnergySiteInfoSize size)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _display = EnergySiteInfoProjection.Project(EnergySiteInfoSnapshot.Empty, _size, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public EnergySiteInfoState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (the four detail rows + gates).</summary>
    public EnergySiteInfoDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasSites));
            Raise(nameof(HasInfo));
        }
    }

    /// <summary>Last successful update timestamp surfaced in the header freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background refresh is in flight (header chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last load failed (drives the error surface + header chip).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown snapshot is older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Localized error message shown in the error surface.</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Number of load attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>True when a Tesla Energy site is linked.</summary>
    public bool HasSites => _display.HasSites;

    /// <summary>True when a linked site resolved a non-null site-info payload.</summary>
    public bool HasInfo => _display.HasInfo;

    /// <summary>Localized widget title (web <c>widget.energySiteInfo.title</c>).</summary>
    public string Title => EnergySiteInfoRegistration.Name(_localizer);

    /// <summary>Localized "no linked site" empty-state message (web <c>widget.energySiteInfo.noSite</c>).</summary>
    public string NoSiteMessage =>
        _localizer.GetString("widget.energySiteInfo.noSite", "No Tesla Energy site linked");

    /// <summary>Localized "no site info" empty-state message (web <c>widget.energySiteInfo.noData</c>).</summary>
    public string NoDataMessage =>
        _localizer.GetString("widget.energySiteInfo.noData", "No site info available");

    /// <summary>The widget footprint; reassigning re-projects the current snapshot for the new layout.</summary>
    public EnergySiteInfoSize Size
    {
        get => _size;
        set
        {
            if (_size == value)
            {
                return;
            }

            _size = value;
            Raise(nameof(Size));
            Reproject();
        }
    }

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps content while refreshing), and folds every emission into
    /// <see cref="State"/> + <see cref="Display"/>. A superseding load cancels the prior one.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        Attempts++;
        if (!HasContent())
        {
            SetLoading();
        }
        else
        {
            IsFetching = true;
        }

        try
        {
            await foreach (var result in _source.StreamAsync(cts.Token).ConfigureAwait(false))
            {
                Apply(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    /// <summary>Retry after a failure (or refresh on demand) — re-runs the load from the top.</summary>
    public Task RetryAsync() => LoadAsync();

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
        GC.SuppressFinalize(this);
    }

    private bool HasContent() =>
        _state is EnergySiteInfoState.Loaded
            or EnergySiteInfoState.NoSite
            or EnergySiteInfoState.NoData
            or EnergySiteInfoState.Stale
            or EnergySiteInfoState.Offline;

    private void Apply(RepositoryResult<EnergySiteInfoSnapshot> result)
    {
        _last = result;
        switch (result.Status)
        {
            case LoadStatus.Loading:
                if (!HasContent())
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
        EnergySiteInfoSnapshot snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = EnergySiteInfoProjection.Project(snapshot, _size, _localizer);

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;

        // Web parity: the no-site gate (!hasSites) and the no-data gate (info == null) are distinct empty
        // surfaces. Offline / stale freshness take precedence for the header chip (as in the sibling
        // widgets); the body still renders the right empty/content via Display.
        State = offline
            ? EnergySiteInfoState.Offline
            : stale
                ? EnergySiteInfoState.Stale
                : !Display.HasSites
                    ? EnergySiteInfoState.NoSite
                    : !Display.HasInfo
                        ? EnergySiteInfoState.NoData
                        : EnergySiteInfoState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { HasValue: true } last)
        {
            Apply(last);
        }
        else
        {
            Display = EnergySiteInfoProjection.Project(EnergySiteInfoSnapshot.Empty, _size, _localizer);
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = EnergySiteInfoState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        // The composite never resolves to the engine's generic Empty (the source returns a value for every
        // outcome), but the contract is honoured defensively: treat it as a linked site with no site info.
        Display = EnergySiteInfoProjection.Project(
            EnergySiteInfoSnapshot.NoSites with { HasSites = true }, _size, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = EnergySiteInfoState.NoData;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = EnergySiteInfoState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.energySiteInfo.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.energySiteInfo.error.offline",
            _ => "widget.energySiteInfo.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view your Tesla Energy site",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached site info",
            _ => "Couldn't load site info",
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
        Raise(name);
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
