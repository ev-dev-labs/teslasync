using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="OdometerCounterViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the cache-then-network sequence of <see cref="OdometerSnapshot"/>s — the native analogue of the web
/// component's <c>useVehicles</c> + <c>useVehicleState</c> + <c>useDrivingStats</c> hook composition (the
/// primary vehicle is resolved to scope the reads, exactly like the web
/// <c>vehicleId ?? vehicles?.[0]?.id</c>, and the web hooks' <c>enabled: id &gt; 0</c> gate is honoured).
/// The view never performs HTTP itself; the concrete <see cref="OdometerCounterSource"/> (or a test fake)
/// drives this.
/// </summary>
public interface IOdometerCounterSource
{
    /// <summary>Stream the cache-then-network odometer snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<OdometerSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Odometer Counter surface — the native mirror of the web registry
/// entry in web/src/features/dashboard/widgets/registry/vehicle.ts. The dashboard grid system binds this
/// surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class OdometerCounterRegistration
{
    /// <summary>Stable registry id (matches the web registry <c>odometer-counter</c>).</summary>
    public const string Id = "odometer-counter";

    /// <summary>Widget category (matches the web registry <c>vehicle</c>).</summary>
    public const string Category = "vehicle";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "OdometerCounterWidget";

    /// <summary>Default footprint: 1 column × 2 rows.</summary>
    public static OdometerCounterSize DefaultSize => new(1, 2);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static OdometerCounterSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 2 columns × 40 rows.</summary>
    public static OdometerCounterSize MaxSize => new(2, 40);

    /// <summary>Localized registry display name (web registry "Odometer Counter").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.odometer.name", "Odometer Counter");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.odometer.description",
            "Animated odometer with rolling digit animation and distance breakdown");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(OdometerCounterSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static OdometerCounterSize Clamp(OdometerCounterSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Odometer Counter surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an odometer reading, distance, vehicle
/// id or VIN — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class OdometerCounterDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public OdometerCounterDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=OdometerCounterWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={OdometerCounterRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="OdometerCounterWidget"/> view — the native port
/// of the web <c>OdometerCounterWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/OdometerCounterWidget.tsx). It consumes the cache-then-network
/// <see cref="IOdometerCounterSource"/>, projects each snapshot through
/// <see cref="OdometerCounterProjection"/> with the active units, and exposes the mutually-exclusive
/// <see cref="State"/> plus the header freshness flags so the view is a thin renderer. Mirroring the web
/// inner <c>{convertedOdometer != null ? … : &lt;EmptyState&gt;}</c> gate, the empty surface is driven by an
/// odometer-less response (or the disabled no-vehicle query). Drive it from one confinement (the UI thread);
/// it is not internally synchronised.
/// </summary>
public sealed class OdometerCounterViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IOdometerCounterSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private OdometerCounterSize _size;
    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private RepositoryResult<OdometerSnapshot>? _last;
    private bool _disposed;

    private OdometerCounterState _state = OdometerCounterState.Loading;
    private OdometerDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and units.</summary>
    public OdometerCounterViewModel(
        IOdometerCounterSource source,
        ILocalizer localizer,
        OdometerCounterSize size,
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
        _display = OdometerCounterProjection.Project(EmptySnapshot, _size, _units, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public OdometerCounterState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (odometer, breakdown tiles).</summary>
    public OdometerDisplay Display
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

    /// <summary>True when a populated snapshot is being shown (web truthy <c>convertedOdometer</c>).</summary>
    public bool HasData => _state is OdometerCounterState.Loaded or OdometerCounterState.Stale or OdometerCounterState.Offline;

    /// <summary>Localized widget header title (web <c>widget.odometer.title</c>).</summary>
    public string Title => _localizer.GetString("widget.odometer.title", "Odometer");

    /// <summary>Localized empty-state message (web <c>widget.odometer.noData</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.odometer.noData", "No odometer data");

    /// <summary>The widget footprint; reassigning re-projects the current snapshot for the new layout.</summary>
    public OdometerCounterSize Size
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

    private static OdometerSnapshot EmptySnapshot => new(0, null);

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
        _state is OdometerCounterState.Loaded or OdometerCounterState.Stale or OdometerCounterState.Offline;

    private void Apply(RepositoryResult<OdometerSnapshot> result)
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
        OdometerSnapshot snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        // Web parity: the inner EmptyState is reached solely via the engine's odometer-less response
        // (LoadStatus.Empty), handled above; a value-bearing snapshot renders the odometer even at 0.
        Display = OdometerCounterProjection.Project(snapshot, _size, _units, _localizer);

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline ? OdometerCounterState.Offline : stale ? OdometerCounterState.Stale : OdometerCounterState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { } last)
        {
            Apply(last);
        }
        else
        {
            Display = OdometerCounterProjection.Project(EmptySnapshot, _size, _units, _localizer);
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = OdometerCounterState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = OdometerCounterProjection.Project(EmptySnapshot, _size, _units, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = OdometerCounterState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = OdometerCounterState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.odometer.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.odometer.error.offline",
            _ => "widget.odometer.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view the odometer",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached odometer",
            _ => "Couldn't load the odometer",
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
