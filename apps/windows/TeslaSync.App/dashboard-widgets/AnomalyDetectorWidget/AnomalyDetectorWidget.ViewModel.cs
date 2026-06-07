using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="AnomalyDetectorViewModel"/> binds to (P1/S8 state-holder seam). It
/// yields the cache-then-network sequence of parsed anomaly reports for
/// <c>GET /analytics/anomalies</c> — the native analogue of the web <c>useAnomalies</c> hook (vehicle
/// resolution included). The view never performs HTTP itself; the concrete
/// <see cref="AnomalyDetectorSource"/> (or a test fake) drives this.
/// </summary>
public interface IAnomalyDetectorSource
{
    /// <summary>Stream the cache-then-network anomaly snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<AnomalyReport>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Anomaly Detector surface — the native mirror of the web registry
/// entry in web/src/features/dashboard/widgets/registry/analytics.ts. The dashboard grid system binds
/// this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class AnomalyDetectorRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "anomaly-detector";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "analytics";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "AnomalyDetectorWidget";

    /// <summary>The trailing window the surface requests, mirroring the web <c>useAnomalies(days = 7)</c> default.</summary>
    public const int DefaultDays = 7;

    /// <summary>Default footprint: 2 columns × 4 rows.</summary>
    public static AnomalyDetectorSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static AnomalyDetectorSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static AnomalyDetectorSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Anomaly Detector").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.anomalyDetector.title", "Anomaly Detector");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.anomalyDetector.description",
            "Statistical outlier alerts: unusual battery, temp, or driving anomalies");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(AnomalyDetectorSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static AnomalyDetectorSize Clamp(AnomalyDetectorSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Anomaly Detector surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a signal name, z-score, VIN or
/// location — so a diagnostics line can never leak what an anomaly was about. Thread-safe.
/// </summary>
public sealed class AnomalyDetectorDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AnomalyDetectorDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AnomalyDetectorWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AnomalyDetectorRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AnomalyDetectorWidget"/> view — the native
/// port of the web <c>AnomalyDetectorWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/AnomalyDetectorWidget.tsx). It consumes the cache-then-network
/// <see cref="IAnomalyDetectorSource"/>, projects each report through
/// <see cref="AnomalyDetectorProjection"/>, and exposes the mutually-exclusive <see cref="State"/> plus
/// the header freshness flags so the view is a thin renderer. Drive it from one confinement (the UI
/// thread); it is not internally synchronised.
/// </summary>
public sealed class AnomalyDetectorViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAnomalyDetectorSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private AnomalyDetectorSize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<AnomalyReport>? _last;
    private bool _disposed;

    private AnomalyDetectorState _state = AnomalyDetectorState.Loading;
    private AnomalyDetectorDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and (optional) clock.</summary>
    public AnomalyDetectorViewModel(
        IAnomalyDetectorSource source,
        ILocalizer localizer,
        AnomalyDetectorSize size,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = AnomalyDetectorProjection.Project(AnomalyReport.Empty, _size, _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public AnomalyDetectorState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (count + badge, severity-sorted tips).</summary>
    public AnomalyDetectorDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasAnomalies));
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

    /// <summary>True when the shown report is older than the freshness window.</summary>
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

    /// <summary>True when the report has at least one anomaly to render (web <c>anomalies.length &gt; 0</c>).</summary>
    public bool HasAnomalies => _display.HasAnomalies;

    /// <summary>Localized widget title (web <c>widget.anomalyDetector.title</c>).</summary>
    public string Title => AnomalyDetectorRegistration.Name(_localizer);

    /// <summary>Localized empty-state message (web <c>widget.anomalyDetector.noAnomalies</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.anomalyDetector.noAnomalies", "No anomalies");

    /// <summary>The widget footprint; reassigning re-projects the current report for the new layout.</summary>
    public AnomalyDetectorSize Size
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
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is
    /// already visible (otherwise keeps content while refreshing), and folds every emission into
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
        _state is AnomalyDetectorState.Loaded or AnomalyDetectorState.Stale or AnomalyDetectorState.Offline;

    private void Apply(RepositoryResult<AnomalyReport> result)
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
                ApplyReport(result.Value!, result.FetchedAt, result.IsStale, fetching: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplyReport(result.Value!, result.FetchedAt, result.IsStale, fetching: true, error: null);
                break;

            case LoadStatus.Loaded:
                ApplyReport(result.Value!, result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplyReport(result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplyReport(
        AnomalyReport report,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = AnomalyDetectorProjection.Project(report, _size, _localizer, _clock());

        if (!report.HasAnomalies)
        {
            SetEmpty(fetchedAt, keepDisplay: true);
            return;
        }

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline ? AnomalyDetectorState.Offline : stale ? AnomalyDetectorState.Stale : AnomalyDetectorState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { } last)
        {
            Apply(last);
        }
        else
        {
            Display = AnomalyDetectorProjection.Project(AnomalyReport.Empty, _size, _localizer, _clock());
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = AnomalyDetectorState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt, bool keepDisplay = false)
    {
        if (!keepDisplay)
        {
            Display = AnomalyDetectorProjection.Project(AnomalyReport.Empty, _size, _localizer, _clock());
        }

        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = AnomalyDetectorState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = AnomalyDetectorState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.anomalyDetector.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.anomalyDetector.error.offline",
            _ => "widget.anomalyDetector.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view anomalies",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached anomalies",
            _ => "Couldn't load anomalies",
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
