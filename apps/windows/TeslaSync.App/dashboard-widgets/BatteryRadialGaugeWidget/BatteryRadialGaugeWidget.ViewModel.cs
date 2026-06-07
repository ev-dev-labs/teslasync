using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="BatteryRadialGaugeViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the cache-then-network sequence of parsed vehicle gauge states for <c>GET /vehicles/{vehicleID}/state</c> —
/// the native analogue of the web <c>useVehicles</c> + <c>useVehicleState</c> hook composition (vehicle
/// resolution included). The view never performs HTTP itself; the concrete <see cref="BatteryRadialGaugeSource"/>
/// (or a test fake) drives this.
/// </summary>
public interface IBatteryRadialGaugeSource
{
    /// <summary>Stream the cache-then-network vehicle-state snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<RadialGaugeVehicleState>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Battery Radial Gauge surface — the native mirror of the web registry
/// entry in web/src/features/dashboard/widgets/registry/battery.ts (<c>battery-radial-gauge</c>). The dashboard
/// grid system binds this surface with the same <see cref="Id"/> and honours the same size constraints
/// (default 1×2, min 1×2, max 3×40).
/// </summary>
public static class BatteryRadialGaugeRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "battery-radial-gauge";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "battery";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "BatteryRadialGaugeWidget";

    /// <summary>Default footprint: 1 column × 2 rows.</summary>
    public static BatteryRadialGaugeSize DefaultSize => new(1, 2);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static BatteryRadialGaugeSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 3 columns × 40 rows.</summary>
    public static BatteryRadialGaugeSize MaxSize => new(3, 40);

    /// <summary>Localized display name (web registry "Battery Radial Gauge").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.batteryRadialGauge.title", "Battery Radial Gauge");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.batteryRadialGauge.description",
            "Large radial gauge showing battery percentage with color gradient (green>amber>red)");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(BatteryRadialGaugeSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static BatteryRadialGaugeSize Clamp(BatteryRadialGaugeSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Battery Radial Gauge surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a state-of-charge, charge limit, VIN or
/// vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class BatteryRadialGaugeDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public BatteryRadialGaugeDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=BatteryRadialGaugeWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={BatteryRadialGaugeRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="BatteryRadialGaugeWidget"/> view — the native port
/// of the web <c>BatteryRadialGaugeWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/BatteryRadialGaugeWidget.tsx). It consumes the cache-then-network
/// <see cref="IBatteryRadialGaugeSource"/>, projects each state through <see cref="BatteryRadialGaugeProjection"/>,
/// and exposes the mutually-exclusive <see cref="State"/> plus the header freshness flags so the view is a thin
/// renderer. A surface with a resolved state always renders the gauge (web <c>state ? gauge : empty</c>); the
/// engine collapses a stateless response to <see cref="BatteryRadialGaugeState.Empty"/>. Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class BatteryRadialGaugeViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IBatteryRadialGaugeSource _source;
    private readonly ILocalizer _localizer;

    private BatteryRadialGaugeSize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<RadialGaugeVehicleState>? _last;
    private bool _disposed;

    private BatteryRadialGaugeState _state = BatteryRadialGaugeState.Loading;
    private BatteryRadialGaugeDisplay? _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and footprint.</summary>
    public BatteryRadialGaugeViewModel(IBatteryRadialGaugeSource source, ILocalizer localizer, BatteryRadialGaugeSize size)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public BatteryRadialGaugeState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready gauge model (null until a state resolves).</summary>
    public BatteryRadialGaugeDisplay? Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasState));
        }
    }

    /// <summary>Last successful update timestamp surfaced in the freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background refresh is in flight (freshness chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last load failed (drives the error surface + freshness chip).</summary>
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

    /// <summary>True when a vehicle state has resolved and the gauge is renderable (web <c>state</c> truthy).</summary>
    public bool HasState => _display is not null;

    /// <summary>Localized widget title (web <c>widget.batteryRadial</c> → "Battery", shown when not compact).</summary>
    public string Title => _localizer.GetString("widget.batteryRadial", "Battery");

    /// <summary>Localized empty-state message (web <c>widget.noBattery</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.noBattery", "No battery data");

    /// <summary>The widget footprint; reassigning re-projects the current state for the new layout.</summary>
    public BatteryRadialGaugeSize Size
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
    /// visible (otherwise keeps the gauge while refreshing), and folds every emission into <see cref="State"/>
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
        _state is BatteryRadialGaugeState.Loaded or BatteryRadialGaugeState.Stale or BatteryRadialGaugeState.Offline;

    private void Apply(RepositoryResult<RadialGaugeVehicleState> result)
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
                ApplyState(result.Value!, result.FetchedAt, result.IsStale, fetching: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplyState(result.Value!, result.FetchedAt, result.IsStale, fetching: true, error: null);
                break;

            case LoadStatus.Loaded:
                ApplyState(result.Value!, result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplyState(result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplyState(
        RadialGaugeVehicleState state,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = BatteryRadialGaugeProjection.Project(state, _size, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline ? BatteryRadialGaugeState.Offline : stale ? BatteryRadialGaugeState.Stale : BatteryRadialGaugeState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { } last)
        {
            Apply(last);
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = BatteryRadialGaugeState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = null;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = BatteryRadialGaugeState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = BatteryRadialGaugeState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.batteryRadialGauge.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.batteryRadialGauge.error.offline",
            _ => "widget.batteryRadialGauge.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view battery",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached battery level",
            _ => "Couldn't load battery",
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
