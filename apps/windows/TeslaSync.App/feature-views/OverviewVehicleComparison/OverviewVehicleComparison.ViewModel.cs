using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.OverviewVehicleComparison;

/// <summary>
/// The data port the <see cref="OverviewVehicleComparisonViewModel"/> binds to (P1/S8 state-holder seam).
/// It yields the cache-then-network sequence of parsed fleet-comparison snapshots — the native analogue of
/// the analytics page's <c>useFleetAnalytics</c> query that feeds the web <c>OverviewVehicleComparison</c>.
/// The view never performs HTTP itself; the concrete <see cref="OverviewVehicleComparisonSource"/> (or a
/// test fake) drives this.
/// </summary>
public interface IOverviewVehicleComparisonSource
{
    /// <summary>Stream the cache-then-network comparison snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<OverviewVehicleComparisonData>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the vehicle-comparison surface — the native mirror of the web analytics
/// overview tab. Diagnostics emit the <see cref="Slug"/>, and the source requests the same trailing window
/// the sibling native fleet-analytics surfaces use.
/// </summary>
public static class OverviewVehicleComparisonRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "overview-vehicle-comparison";

    /// <summary>Surface category (the web analytics feature).</summary>
    public const string Category = "analytics";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "OverviewVehicleComparison";

    /// <summary>The trailing window the surface requests from <c>GET /analytics/fleet</c>.</summary>
    public const int DefaultDays = 30;

    /// <summary>Localized surface display name.</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("analytics.overview.vehicleComparison", "Vehicle Comparison");
    }

    /// <summary>Localized surface description.</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "analytics.overview.comparisonDescription",
            "Compare fleet usage, efficiency, energy and activity across vehicles");
    }
}

/// <summary>
/// PII-safe diagnostics for the vehicle-comparison surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a vehicle name, metric or location —
/// so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class OverviewVehicleComparisonDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public OverviewVehicleComparisonDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=OverviewVehicleComparison</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={OverviewVehicleComparisonRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI vehicle-comparison view — the native port of the web
/// <c>OverviewVehicleComparison</c>'s data composition
/// (web/src/features/analytics/components/analytics/OverviewVehicleComparison.tsx). It consumes the
/// cache-then-network <see cref="IOverviewVehicleComparisonSource"/>, projects each snapshot through
/// <see cref="OverviewVehicleComparisonProjection"/> with the active units, and exposes the
/// mutually-exclusive <see cref="State"/> plus the header freshness flags so the view is a thin renderer.
/// Unlike a dashboard tile it never collapses to a single empty box: every resolved snapshot renders the
/// four panels, each of which shows its own per-panel empty state when its slice is sparse (web parity).
/// Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class OverviewVehicleComparisonViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IOverviewVehicleComparisonSource _source;
    private readonly ILocalizer _localizer;

    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private RepositoryResult<OverviewVehicleComparisonData>? _last;
    private bool _disposed;

    private OverviewVehicleComparisonState _state = OverviewVehicleComparisonState.Loading;
    private OverviewVehicleComparisonDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and units.</summary>
    public OverviewVehicleComparisonViewModel(
        IOverviewVehicleComparisonSource source,
        ILocalizer localizer,
        UnitPref? units = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _display = OverviewVehicleComparisonProjection.Project(OverviewVehicleComparisonData.Empty, _units, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public OverviewVehicleComparisonState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (the four comparison panels).</summary>
    public OverviewVehicleComparisonDisplay Display
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

    /// <summary>Localized error message shown in the error / offline surfaces.</summary>
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

    /// <summary>True when the snapshot has at least one vehicle to compare.</summary>
    public bool HasData => _display.HasVehicles;

    /// <summary>Localized surface title used for the control's accessible name.</summary>
    public string Title => _localizer.GetString("analytics.overview.comparisonSurfaceTitle", "Vehicle Comparison");

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
        _state is OverviewVehicleComparisonState.Loaded
            or OverviewVehicleComparisonState.Stale
            or OverviewVehicleComparisonState.Offline;

    private void Apply(RepositoryResult<OverviewVehicleComparisonData> result)
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
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: false);
                break;

            case LoadStatus.Refreshing:
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: true);
                break;

            case LoadStatus.Loaded:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: false, fetching: false);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplySnapshot(
                    result.Value ?? OverviewVehicleComparisonData.Empty,
                    result.FetchedAt,
                    stale: true,
                    fetching: false,
                    offline: true,
                    error: result.Error);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    // Web parity: the component always renders the four panels for any resolved snapshot; a snapshot with
    // no vehicles is NOT the surface empty state — each panel shows its own per-panel empty message.
    private void ApplySnapshot(
        OverviewVehicleComparisonData data,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        bool offline = false,
        RepositoryError? error = null)
    {
        Display = OverviewVehicleComparisonProjection.Project(data, _units, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? OverviewVehicleComparisonState.Offline
            : stale ? OverviewVehicleComparisonState.Stale : OverviewVehicleComparisonState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { HasValue: true } last)
        {
            Apply(last);
        }
        else
        {
            Display = OverviewVehicleComparisonProjection.Project(OverviewVehicleComparisonData.Empty, _units, _localizer);
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = OverviewVehicleComparisonState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = OverviewVehicleComparisonProjection.Project(OverviewVehicleComparisonData.Empty, _units, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = OverviewVehicleComparisonState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = OverviewVehicleComparisonState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "analytics.overview.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "analytics.overview.error.offline",
            _ => "analytics.overview.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view vehicle comparison",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached comparison",
            _ => "Couldn't load vehicle comparison",
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
