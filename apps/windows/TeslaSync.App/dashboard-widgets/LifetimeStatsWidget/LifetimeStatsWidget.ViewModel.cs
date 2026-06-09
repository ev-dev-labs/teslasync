using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="LifetimeStatsViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the cache-then-network sequence of parsed lifetime snapshots for <c>GET /analytics/lifetime</c> — the
/// native analogue of the web <c>useVehicles</c> + <c>useLifetimeStats</c> hook composition (the primary
/// vehicle is resolved to scope the read, exactly like the web <c>vehicleId ?? vehicles?.[0]?.id</c>).
/// The view never performs HTTP itself; the concrete <see cref="LifetimeStatsSource"/> (or a test fake)
/// drives this.
/// </summary>
public interface ILifetimeStatsSource
{
    /// <summary>Stream the cache-then-network lifetime snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<LifetimeStats>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Lifetime Stats surface — the native mirror of the web registry
/// entry in web/src/features/dashboard/widgets/registry/analytics.ts. The dashboard grid system binds
/// this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class LifetimeStatsRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "lifetime-stats";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "analytics";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "LifetimeStatsWidget";

    /// <summary>Default footprint: 2 columns × 2 rows.</summary>
    public static LifetimeStatsSize DefaultSize => new(2, 2);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static LifetimeStatsSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static LifetimeStatsSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Lifetime Stats").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.lifetimeStats.title", "Lifetime Stats");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.lifetimeStats.description",
            "All-time totals: distance, drives, energy, CO\u2082 saved, ownership days");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(LifetimeStatsSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static LifetimeStatsSize Clamp(LifetimeStatsSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Lifetime Stats surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a distance, cost, CO₂ figure, VIN
/// or vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class LifetimeStatsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public LifetimeStatsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=LifetimeStatsWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={LifetimeStatsRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="LifetimeStatsWidget"/> view — the native port
/// of the web <c>LifetimeStatsWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/LifetimeStatsWidget.tsx). It consumes the cache-then-network
/// <see cref="ILifetimeStatsSource"/>, projects each snapshot through <see cref="LifetimeStatsProjection"/>
/// with the active units + currency, and exposes the mutually-exclusive <see cref="State"/> plus the
/// header freshness flags so the view is a thin renderer. Mirroring the web outer <c>{data ? … :
/// &lt;EmptyState&gt;}</c> gate, the empty surface is driven only by an absent response body — a populated
/// object (even all-zero totals) renders the grid. Drive it from one confinement (the UI thread); it is
/// not internally synchronised.
/// </summary>
public sealed class LifetimeStatsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILifetimeStatsSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private LifetimeStatsSize _size;
    private UnitPref _units;
    private string _currencySymbol;
    private CancellationTokenSource? _cts;
    private RepositoryResult<LifetimeStats>? _last;
    private bool _disposed;

    private LifetimeStatsState _state = LifetimeStatsState.Loading;
    private LifetimeStatsDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint, units and currency.</summary>
    public LifetimeStatsViewModel(
        ILifetimeStatsSource source,
        ILocalizer localizer,
        LifetimeStatsSize size,
        UnitPref? units = null,
        string? currencySymbol = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _units = units ?? UnitPref.Metric;
        _currencySymbol = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = LifetimeStatsProjection.Project(LifetimeStats.Empty, _size, _units, _currencySymbol, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public LifetimeStatsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (stats, compact number).</summary>
    public LifetimeStatsDisplay Display
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

    /// <summary>True when a populated snapshot is being shown (web truthy <c>data</c>).</summary>
    public bool HasData => _state is LifetimeStatsState.Loaded or LifetimeStatsState.Stale or LifetimeStatsState.Offline;

    /// <summary>Localized widget title (web <c>widget.lifetimeStats.title</c>).</summary>
    public string Title => LifetimeStatsRegistration.Name(_localizer);

    /// <summary>Localized empty-state message (web <c>widget.lifetimeStats.noData</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.lifetimeStats.noData", "No lifetime data");

    /// <summary>The widget footprint; reassigning re-projects the current snapshot for the new layout.</summary>
    public LifetimeStatsSize Size
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

    /// <summary>The currency symbol used for the total-cost tile; reassigning re-projects.</summary>
    public string CurrencySymbol
    {
        get => _currencySymbol;
        set
        {
            string resolved = string.IsNullOrWhiteSpace(value) ? "$" : value;
            if (_currencySymbol == resolved)
            {
                return;
            }

            _currencySymbol = resolved;
            Raise(nameof(CurrencySymbol));
            Reproject();
        }
    }

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/>
    /// + <see cref="Display"/>. A superseding load cancels the prior one.
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
        _state is LifetimeStatsState.Loaded or LifetimeStatsState.Stale or LifetimeStatsState.Offline;

    private void Apply(RepositoryResult<LifetimeStats> result)
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
        LifetimeStats snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        // Web parity: the outer EmptyState is gated only on `data` presence, not on the totals — a populated
        // object renders the grid even when every value is zero. The empty surface is reached solely via the
        // engine's empty-body status (LoadStatus.Empty), handled above.
        Display = LifetimeStatsProjection.Project(snapshot, _size, _units, _currencySymbol, _localizer);

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline ? LifetimeStatsState.Offline : stale ? LifetimeStatsState.Stale : LifetimeStatsState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { } last)
        {
            Apply(last);
        }
        else
        {
            Display = LifetimeStatsProjection.Project(LifetimeStats.Empty, _size, _units, _currencySymbol, _localizer);
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = LifetimeStatsState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = LifetimeStatsProjection.Project(LifetimeStats.Empty, _size, _units, _currencySymbol, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = LifetimeStatsState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = LifetimeStatsState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.lifetimeStats.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.lifetimeStats.error.offline",
            _ => "widget.lifetimeStats.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view lifetime stats",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached lifetime stats",
            _ => "Couldn't load lifetime stats",
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
