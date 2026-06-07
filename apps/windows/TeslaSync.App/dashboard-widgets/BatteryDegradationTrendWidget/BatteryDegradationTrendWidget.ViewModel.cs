using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// Canonical registry metadata for the Battery Degradation Trend surface — the native mirror of the web
/// registry entry in web/src/features/dashboard/widgets/registry/battery.ts. The dashboard grid system
/// binds this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class BatteryDegradationTrendRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "battery-degradation-trend";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "battery";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "BatteryDegradationTrendWidget";

    /// <summary>Default footprint: 2 columns × 4 rows.</summary>
    public static BatteryDegradationTrendSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static BatteryDegradationTrendSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static BatteryDegradationTrendSize MaxSize => new(4, 40);

    /// <summary>Localized registry display name (web registry "Battery Degradation Trend").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.trend.name", "Battery Degradation Trend");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.trend.description",
            "Line chart showing max range capacity over months");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(BatteryDegradationTrendSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static BatteryDegradationTrendSize Clamp(BatteryDegradationTrendSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Battery Degradation Trend surface (P1/S11 diagnostics contract). Records
/// only the operational <c>view.opened</c> event with the surface slug — never a health percentage,
/// degradation rate, cycle count, VIN or vehicle id — so a diagnostics line can never leak fleet data.
/// Thread-safe.
/// </summary>
public sealed class BatteryDegradationTrendDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public BatteryDegradationTrendDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=BatteryDegradationTrendWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={BatteryDegradationTrendRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="BatteryDegradationTrendWidget"/> view — the
/// native port of the web <c>BatteryDegradationTrendWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/BatteryDegradationTrendWidget.tsx). It consumes the
/// cache-then-network <see cref="IBatteryDegradationTrendSource"/>, applies the web <c>isEmpty</c> gate (a
/// trend with neither a current-health value nor any monthly rows renders the friendly empty state,
/// mirroring <c>WidgetChartSummary isEmpty</c>), projects the rest through
/// <see cref="BatteryDegradationTrendProjection"/>, and exposes the mutually-exclusive <see cref="State"/>
/// plus the header freshness flags so the view is a thin renderer. Drive it from one confinement (the UI
/// thread); it is not internally synchronised.
/// </summary>
public sealed class BatteryDegradationTrendViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IBatteryDegradationTrendSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private BatteryDegradationTrendSize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<BatteryDegradationTrend>? _last;
    private bool _disposed;

    private BatteryDegradationTrendState _state = BatteryDegradationTrendState.Loading;
    private BatteryDegradationTrendDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and (optional) clock.</summary>
    public BatteryDegradationTrendViewModel(
        IBatteryDegradationTrendSource source,
        ILocalizer localizer,
        BatteryDegradationTrendSize size,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = BatteryDegradationTrendProjection.Project(BatteryDegradationTrend.Empty, _size, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public BatteryDegradationTrendState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (stats + chart series).</summary>
    public BatteryDegradationTrendDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
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

    /// <summary>Localized widget title shown in the header (web <c>widget.batteryDegradation</c>).</summary>
    public string Title => _localizer.GetString("widget.batteryDegradation", "Battery Degradation");

    /// <summary>Localized empty-state message (web <c>widget.noDegradation</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.noDegradation", "No degradation data");

    /// <summary>The widget footprint; reassigning re-projects the current trend for the new layout.</summary>
    public BatteryDegradationTrendSize Size
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
        _state is BatteryDegradationTrendState.Loaded
            or BatteryDegradationTrendState.Stale
            or BatteryDegradationTrendState.Offline;

    private void Apply(RepositoryResult<BatteryDegradationTrend> result)
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
                ApplyTrend(result.Value!, result.FetchedAt, result.IsStale, fetching: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplyTrend(result.Value!, result.FetchedAt, result.IsStale, fetching: true, error: null);
                break;

            case LoadStatus.Loaded:
                ApplyTrend(result.Value!, result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplyTrend(result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplyTrend(
        BatteryDegradationTrend trend,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        // Web parity: WidgetChartSummary's isEmpty gate — a trend with neither a current-health value nor any
        // monthly rows renders the empty state regardless of freshness.
        if (trend.IsEmpty)
        {
            SetEmpty(fetchedAt);
            return;
        }

        Display = BatteryDegradationTrendProjection.Project(trend, _size, _localizer);

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? BatteryDegradationTrendState.Offline
            : stale ? BatteryDegradationTrendState.Stale : BatteryDegradationTrendState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { } last)
        {
            Apply(last);
        }
        else
        {
            Display = BatteryDegradationTrendProjection.Project(BatteryDegradationTrend.Empty, _size, _localizer);
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = BatteryDegradationTrendState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = BatteryDegradationTrendProjection.Project(BatteryDegradationTrend.Empty, _size, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = BatteryDegradationTrendState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = BatteryDegradationTrendState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.trend.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.trend.error.offline",
            _ => "widget.trend.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view battery degradation",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached trend",
            _ => "Couldn't load battery degradation",
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
