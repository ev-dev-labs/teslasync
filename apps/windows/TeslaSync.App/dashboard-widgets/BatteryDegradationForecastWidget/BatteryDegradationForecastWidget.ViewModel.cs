using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="BatteryDegradationForecastViewModel"/> binds to (P1/S8 state-holder seam).
/// It yields the cache-then-network sequence of parsed degradation forecasts for
/// <c>GET /analytics/battery-degradation</c> — the native analogue of the web
/// <c>useVehicles</c> + <c>useBatteryDegradation</c> hook composition (vehicle resolution included). The
/// view never performs HTTP itself; the concrete <see cref="BatteryDegradationForecastSource"/> (or a test
/// fake) drives this.
/// </summary>
public interface IBatteryDegradationForecastSource
{
    /// <summary>Stream the cache-then-network degradation-forecast snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<DegradationForecast>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Battery Forecast surface — the native mirror of the web registry
/// entry in web/src/features/dashboard/widgets/registry/battery.ts. The dashboard grid system binds this
/// surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class BatteryDegradationForecastRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "battery-degradation-forecast";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "battery";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "BatteryDegradationForecastWidget";

    /// <summary>Default footprint: 2 columns × 4 rows.</summary>
    public static BatteryDegradationForecastSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static BatteryDegradationForecastSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static BatteryDegradationForecastSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Battery Forecast").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.forecast.title", "Battery Forecast");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.forecast.description",
            "Predictive degradation: when battery hits 80%, risk factors, recommendations");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(BatteryDegradationForecastSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static BatteryDegradationForecastSize Clamp(BatteryDegradationForecastSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Battery Forecast surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a health percentage, projected date,
/// risk factor, recommendation, VIN or vehicle id — so a diagnostics line can never leak fleet data.
/// Thread-safe.
/// </summary>
public sealed class BatteryDegradationForecastDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public BatteryDegradationForecastDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=BatteryDegradationForecastWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={BatteryDegradationForecastRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="BatteryDegradationForecastWidget"/> view — the
/// native port of the web <c>BatteryDegradationForecastWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/BatteryDegradationForecastWidget.tsx). It consumes the
/// cache-then-network <see cref="IBatteryDegradationForecastSource"/>, applies the web <c>hasData</c> gate
/// (a forecast with neither a current-health value nor a projected-80% date renders the friendly empty
/// state, mirroring the outer <c>{hasData ? … : &lt;EmptyState&gt;}</c>), projects the rest through
/// <see cref="BatteryDegradationForecastProjection"/>, and exposes the mutually-exclusive <see cref="State"/>
/// plus the header freshness flags so the view is a thin renderer. Drive it from one confinement (the UI
/// thread); it is not internally synchronised.
/// </summary>
public sealed class BatteryDegradationForecastViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IBatteryDegradationForecastSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private BatteryDegradationForecastSize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<DegradationForecast>? _last;
    private bool _disposed;

    private BatteryDegradationForecastState _state = BatteryDegradationForecastState.Loading;
    private BatteryDegradationForecastDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and (optional) clock.</summary>
    public BatteryDegradationForecastViewModel(
        IBatteryDegradationForecastSource source,
        ILocalizer localizer,
        BatteryDegradationForecastSize size,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = BatteryDegradationForecastProjection.Project(DegradationForecast.Empty, _size, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public BatteryDegradationForecastState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (tier, health, projection, risks, tips).</summary>
    public BatteryDegradationForecastDisplay Display
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

    /// <summary>True when the current forecast has something to render (web <c>hasData</c>).</summary>
    public bool HasData => _display.HasData;

    /// <summary>Localized widget title (web <c>widget.forecast.title</c>).</summary>
    public string Title => BatteryDegradationForecastRegistration.Name(_localizer);

    /// <summary>Localized empty-state message (web <c>widget.forecast.noData</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.forecast.noData", "No degradation forecast data");

    /// <summary>The widget footprint; reassigning re-projects the current forecast for the new layout.</summary>
    public BatteryDegradationForecastSize Size
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
        _state is BatteryDegradationForecastState.Loaded
            or BatteryDegradationForecastState.Stale
            or BatteryDegradationForecastState.Offline;

    private void Apply(RepositoryResult<DegradationForecast> result)
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
                ApplyForecast(result.Value!, result.FetchedAt, result.IsStale, fetching: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplyForecast(result.Value!, result.FetchedAt, result.IsStale, fetching: true, error: null);
                break;

            case LoadStatus.Loaded:
                ApplyForecast(result.Value!, result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplyForecast(result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplyForecast(
        DegradationForecast forecast,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        // Web parity: the outer EmptyState is gated on hasData — a forecast with neither a current-health
        // value nor a projected-80% date renders the empty state regardless of freshness.
        if (!forecast.HasData)
        {
            SetEmpty(fetchedAt);
            return;
        }

        Display = BatteryDegradationForecastProjection.Project(forecast, _size, _localizer);

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? BatteryDegradationForecastState.Offline
            : stale ? BatteryDegradationForecastState.Stale : BatteryDegradationForecastState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { } last)
        {
            Apply(last);
        }
        else
        {
            Display = BatteryDegradationForecastProjection.Project(DegradationForecast.Empty, _size, _localizer);
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = BatteryDegradationForecastState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = BatteryDegradationForecastProjection.Project(DegradationForecast.Empty, _size, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = BatteryDegradationForecastState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = BatteryDegradationForecastState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.forecast.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.forecast.error.offline",
            _ => "widget.forecast.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view the battery forecast",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached forecast",
            _ => "Couldn't load the battery forecast",
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
