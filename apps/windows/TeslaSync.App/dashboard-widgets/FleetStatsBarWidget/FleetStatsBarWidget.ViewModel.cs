using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="FleetStatsBarViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the cache-then-network sequence of merged fleet snapshots — the combination of <c>GET /vehicles</c>
/// and <c>GET /analytics/fleet?days=30</c> — the native analogue of the web component's
/// <c>useVehicles</c> + <c>useFleetAnalytics(30)</c> hook composition. The view never performs HTTP
/// itself; the concrete <see cref="FleetStatsBarSource"/> (or a test fake) drives this.
/// </summary>
public interface IFleetStatsBarSource
{
    /// <summary>Stream the merged cache-then-network fleet snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<FleetStats>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Fleet Stats Bar surface — the native mirror of the web registry
/// entry in web/src/features/dashboard/widgets/registry/analytics.ts. The dashboard grid system binds
/// this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class FleetStatsBarRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "fleet-stats-bar";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "analytics";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "FleetStatsBarWidget";

    /// <summary>The trailing window the surface requests, mirroring the web <c>useFleetAnalytics(30)</c>.</summary>
    public const int DefaultDays = 30;

    /// <summary>Default footprint: 4 columns × 2 rows (web registry <c>defaultSize</c>).</summary>
    public static FleetStatsBarSize DefaultSize => new(4, 2);

    /// <summary>Minimum footprint: 3 columns × 2 rows (web registry <c>minSize</c>).</summary>
    public static FleetStatsBarSize MinSize => new(3, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows (web registry <c>maxSize</c>).</summary>
    public static FleetStatsBarSize MaxSize => new(4, 40);

    /// <summary>Localized registry display name (web registry "Fleet Stats Bar").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.fleetStatsBar.name", "Fleet Stats Bar");
    }

    /// <summary>Localized registry description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.fleetStatsBar.description",
            "Fleet-wide: total vehicles, online count, total miles today, total energy");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(FleetStatsBarSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static FleetStatsBarSize Clamp(FleetStatsBarSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Fleet Stats Bar surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a fleet metric, VIN or location —
/// so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class FleetStatsBarDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public FleetStatsBarDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=FleetStatsBarWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={FleetStatsBarRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="FleetStatsBarWidget"/> view — the native port
/// of the web <c>FleetStatsBarWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/FleetStatsBarWidget.tsx). It consumes the merged
/// cache-then-network <see cref="IFleetStatsBarSource"/>, projects each snapshot through
/// <see cref="FleetStatsBarProjection"/> with the active units, and exposes the mutually-exclusive
/// <see cref="State"/> plus the header freshness flags so the view is a thin renderer. Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class FleetStatsBarViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IFleetStatsBarSource _source;
    private readonly ILocalizer _localizer;

    private FleetStatsBarSize _size;
    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private RepositoryResult<FleetStats>? _last;
    private bool _disposed;

    private FleetStatsBarState _state = FleetStatsBarState.Loading;
    private FleetStatsBarDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and units.</summary>
    public FleetStatsBarViewModel(
        IFleetStatsBarSource source,
        ILocalizer localizer,
        FleetStatsBarSize size,
        UnitPref? units = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _units = units ?? UnitPref.Metric;
        _display = FleetStatsBarProjection.Project(FleetStats.Empty, _size, _units, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public FleetStatsBarState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (the four stat tiles).</summary>
    public FleetStatsBarDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasData));
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

    /// <summary>True when the snapshot has data to render (web <c>hasData</c>).</summary>
    public bool HasData => _display.HasData;

    /// <summary>Localized widget title (web <c>widget.fleetStatsBar.title</c>).</summary>
    public string Title => _localizer.GetString("widget.fleetStatsBar.title", "Fleet Stats");

    /// <summary>Localized empty-state message (web <c>widget.fleetStatsBar.noData</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.fleetStatsBar.noData", "No fleet data available");

    /// <summary>The widget footprint; reassigning re-projects the current snapshot for the new layout.</summary>
    public FleetStatsBarSize Size
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

    /// <summary>The user's unit preference; reassigning re-projects the current snapshot in the new units.</summary>
    public UnitPref Units
    {
        get => _units;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            if (_units == value)
            {
                return;
            }

            _units = value;
            Raise(nameof(Units));
            Reproject();
        }
    }

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps content while refreshing), and folds every merged emission into
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

    /// <summary>Retry after a failure — re-runs the load from the top.</summary>
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
        _state is FleetStatsBarState.Loaded or FleetStatsBarState.Stale or FleetStatsBarState.Offline;

    private void Apply(RepositoryResult<FleetStats> result)
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
        FleetStats stats,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = FleetStatsBarProjection.Project(stats, _size, _units, _localizer);

        if (!stats.HasData)
        {
            SetEmpty(fetchedAt, keepDisplay: true);
            return;
        }

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline ? FleetStatsBarState.Offline : stale ? FleetStatsBarState.Stale : FleetStatsBarState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { HasValue: true } last)
        {
            Apply(last);
        }
        else
        {
            Display = FleetStatsBarProjection.Project(FleetStats.Empty, _size, _units, _localizer);
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = FleetStatsBarState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt, bool keepDisplay = false)
    {
        if (!keepDisplay)
        {
            Display = FleetStatsBarProjection.Project(FleetStats.Empty, _size, _units, _localizer);
        }

        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = FleetStatsBarState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = FleetStatsBarState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.fleetStatsBar.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.fleetStatsBar.error.offline",
            _ => "widget.fleetStatsBar.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view fleet stats",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached fleet stats",
            _ => "Couldn't load fleet stats",
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
