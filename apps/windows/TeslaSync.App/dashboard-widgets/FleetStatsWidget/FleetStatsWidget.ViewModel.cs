using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="FleetStatsViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// combine-latest sequence of merged fleet snapshots — analytics + vehicle counts + recent drive/charge
/// series — for the Fleet Stats surface, the native analogue of the web component's four-hook composition
/// (web/src/features/dashboard/widgets/FleetStatsWidget.tsx). The view never performs HTTP itself; the
/// concrete <see cref="FleetStatsSource"/> (or a test fake) drives this.
/// </summary>
public interface IFleetStatsSource
{
    /// <summary>Stream the cache-then-network fleet snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<FleetStatsReading>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Fleet Stats surface — the native mirror of the web registry entry in
/// web/src/features/dashboard/widgets/registry/analytics.ts (id <c>fleet-stats</c>, category
/// <c>analytics</c>, default 4×2, min 2×2, max 4×40). The dashboard grid system binds this surface with the
/// same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class FleetStatsRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "fleet-stats";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "analytics";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "FleetStatsWidget";

    /// <summary>The trailing window the analytics read requests, mirroring the web <c>useFleetAnalytics(30)</c>.</summary>
    public const int DefaultDays = 30;

    /// <summary>Default footprint: 4 columns × 2 rows.</summary>
    public static FleetStatsSize DefaultSize => new(4, 2);

    /// <summary>Minimum footprint: 2 columns × 2 rows.</summary>
    public static FleetStatsSize MinSize => new(2, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static FleetStatsSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Fleet Stats").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.fleetStats.title", "Fleet Stats");
    }

    /// <summary>Localized description (web registry "Fleet-wide metrics and totals").</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.fleetStats.description", "Fleet-wide metrics and totals");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(FleetStatsSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static FleetStatsSize Clamp(FleetStatsSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Fleet Stats surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a fleet metric, VIN or location — so a
/// diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class FleetStatsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public FleetStatsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=FleetStatsWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={FleetStatsRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="FleetStatsWidget"/> view — the native port of the
/// web <c>FleetStatsWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/FleetStatsWidget.tsx). It consumes the combine-latest
/// <see cref="IFleetStatsSource"/>, projects each merged snapshot through <see cref="FleetStatsProjection"/>
/// with the active units, and exposes the mutually-exclusive <see cref="State"/> plus the header freshness
/// flags so the view is a thin renderer. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class FleetStatsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IFleetStatsSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private FleetStatsSize _size;
    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private RepositoryResult<FleetStatsReading>? _last;
    private bool _disposed;

    private FleetStatsState _state = FleetStatsState.Loading;
    private FleetStatsDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and units.</summary>
    public FleetStatsViewModel(
        IFleetStatsSource source,
        ILocalizer localizer,
        FleetStatsSize size,
        UnitPref? units = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _units = units ?? UnitPref.Metric;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = FleetStatsProjection.Project(FleetStatsReading.Empty, _size, _units, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public FleetStatsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (the five metric cards).</summary>
    public FleetStatsDisplay Display
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

    /// <summary>True when the snapshot has fleet data to render (web parity for the empty gate).</summary>
    public bool HasData => _display.HasData;

    /// <summary>Localized widget title (web <c>widget.fleetStats.title</c>).</summary>
    public string Title => FleetStatsRegistration.Name(_localizer);

    /// <summary>Localized empty-state message.</summary>
    public string EmptyMessage => _localizer.GetString("widget.fleetStats.noData", "No fleet data");

    /// <summary>The widget footprint; reassigning re-projects the current snapshot for the new layout.</summary>
    public FleetStatsSize Size
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
    /// Run a combine-latest load: counts the attempt, shows the skeleton only when nothing is already visible
    /// (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/> +
    /// <see cref="Display"/>. A superseding load cancels the prior one.
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
        _state is FleetStatsState.Loaded or FleetStatsState.Stale or FleetStatsState.Offline;

    private void Apply(RepositoryResult<FleetStatsReading> result)
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
        FleetStatsReading reading,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = FleetStatsProjection.Project(reading, _size, _units, _localizer);

        if (!reading.HasData)
        {
            SetEmpty(fetchedAt, keepDisplay: true);
            return;
        }

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline ? FleetStatsState.Offline : stale ? FleetStatsState.Stale : FleetStatsState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { HasValue: true } last)
        {
            Apply(last);
        }
        else
        {
            Display = FleetStatsProjection.Project(FleetStatsReading.Empty, _size, _units, _localizer);
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = FleetStatsState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt, bool keepDisplay = false)
    {
        if (!keepDisplay)
        {
            Display = FleetStatsProjection.Project(FleetStatsReading.Empty, _size, _units, _localizer);
        }

        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = FleetStatsState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = FleetStatsState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.fleetStats.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.fleetStats.error.offline",
            _ => "widget.fleetStats.error",
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
